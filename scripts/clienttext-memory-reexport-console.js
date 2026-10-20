/* Run only after downloading the JSON recovery snapshot from this same open tab.
 * Select the SAME original workbook(s), possibly at their new location. Their
 * complete SHA-256 identities must match before a dedicated worker exports the
 * session's committed values. No app/store method is replaced or written.
 * Unsaved drafts remain in the JSON snapshot and are excluded from this export.
 */
(async () => {
    const container = document.querySelector('#app');
    const editor = container?.__vue_app__?._instance?.proxy || container?._vnode?.component?.proxy;
    if (!editor?.ctOfflineTest || !editor.ctWorkspace?.scope?.groupId?.startsWith('local:test:')) throw new Error('No active temporary ClientText workbook. Keep the affected tab open.');
    if (editor.ctBusy || editor.ctScanRunning || editor._ctExportRun) throw new Error('Wait for the operation to finish; keep this tab open.');
    const scope = JSON.parse(JSON.stringify(editor.ctWorkspace.scope)), store = editor._ctTestStores?.get(scope.groupId);
    const workerAPI = globalThis.ClientTextWorkerClient;
    if (!store?.getUnits || !store.getSaved || !store.getAsset || !crypto.subtle || !workerAPI?.create) throw new Error('Recovery interfaces are unavailable. Keep the JSON snapshot and this tab open.');
    const current = () => JSON.stringify(editor.ctWorkspace?.scope) === JSON.stringify(scope) && !editor.ctBusy && !editor._ctExportRun;
    const metadata = await store.getMetadata(scope), saved = await store.getSaved(scope), units = await store.getUnits(scope), assets = [];
    const unitIds = new Set(units.map(unit => unit.id));
    if (Object.keys(saved).some(id => !unitIds.has(id))) throw new Error('A committed record lacks its original record metadata. Keep the JSON snapshot and this tab open.');
    const savedIdentity = JSON.stringify(saved);
    for (const descriptor of metadata.descriptors) {
        const asset = await store.getAsset(scope, descriptor.role);
        if (!asset?.parsed || asset.parsed.artifactHash !== descriptor.assetHash) throw new Error('Original identity metadata differs. Keep this tab open.');
        assets.push({ ...asset, descriptor });
    }
    const selected = await new Promise((resolve, reject) => {
        if (document.getElementById('ct-memory-original-recovery')) { reject(new Error('A recovery file selection is already open.')); return; }
        const input = document.createElement('input'); input.type = 'file'; input.multiple = true; input.accept = '.xlsx,.xlsm'; input.id = 'ct-memory-original-recovery'; input.hidden = true;
        input.onchange = () => { const files = [...input.files]; input.remove(); resolve(files); };
        input.oncancel = () => { input.remove(); reject(new Error('Selection cancelled; the session was unchanged.')); };
        document.body.append(input); input.click();
    });
    if (selected.length !== assets.length) throw new Error('Select every original workbook in this group, once each. No session data was changed.');
    const originals = [];
    for (const file of selected) {
        const bytes = await file.arrayBuffer(), hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
        originals.push({ name: file.name, bytes, hash, used: false });
    }
    for (const asset of assets) {
        const matches = originals.filter(original => !original.used && original.hash === asset.descriptor.assetHash);
        const original = matches.find(original => original.name === asset.name) || matches[0];
        if (!original) throw new Error('A selected file differs from the exact original workbook. No session data was changed.');
        original.used = true; asset.recoveryBytes = original.bytes;
    }
    const worker = workerAPI.create(), outputs = [];
    try {
        for (const asset of assets) {
            if (!current()) throw new Error('The session changed during recovery. Keep it open.');
            const roleUnits = units.filter(unit => unit.role === asset.role), roleSaved = Object.fromEntries(roleUnits.filter(unit => saved[unit.id]).map(unit => [unit.id, saved[unit.id]]));
            const bytes = await worker.exportWorkbook(asset.recoveryBytes, { ...asset.parsed, units: roleUnits }, roleSaved);
            outputs.push({ name: asset.name || asset.parsed.filename, bytes });
        }
        const bytes = outputs.length === 1 ? outputs[0].bytes : await worker.packageWorkbooks(outputs);
        if (!current() || savedIdentity !== JSON.stringify(await store.getSaved(scope))) throw new Error('Committed values changed during recovery. Keep the tab open and retry.');
        const blob = new Blob([bytes]), url = URL.createObjectURL(blob), link = document.createElement('a');
        link.href = url; link.download = outputs.length === 1 ? outputs[0].name : 'SDEditor-ClientText-recovered.zip'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        return { downloadInitiated: true, workbooks: outputs.length, committedRecords: Object.keys(saved).length, bytes: blob.size, draftsExcluded: true };
    } finally { worker.dispose(); }
})();
