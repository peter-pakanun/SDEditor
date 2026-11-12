'use strict';
const assert = require('node:assert/strict');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

module.exports = async ({ page, directory }) => {
    mkdirSync(directory, { recursive: true });
    await page.evaluate(async () => {
        const h = window.__sharedFixtureApp;
        await h.editorExit(); h.appConfirm = async () => true;
        const file = (name, english, thai) => ({ filepath: 'stat/' + name + '.txt', filedir: 'stat', filename: name + '.txt', name: '',
            stats: [name], variables: ['#'], remarks: [''], translations: { English: [english], ...(thai ? { Thai: thai } : {}) } });
        const source = [file('english', 'Duelist'), file('other', 'Marauder')];
        h.importBaseline = null; h._workspaceSourceBaseline = Vue.markRaw(source); h.sourceIdentity = 'a'.repeat(64);
        h.localDescs = WorkspaceState.initializeWorkspace({ sourceHash: h.sourceIdentity, game: h.gameVersion, descs: [], status: {} },
            { source, sourceHash: h.sourceIdentity, game: h.gameVersion, language: h.lang });
        h.descs = structuredClone(source); h.applyWorkspaceOverlay(); h.filterDesc();
        await h.editFile(source[0].filepath); await h.$nextTick();
    });
    const control = page.getByRole('button', { name: 'Use English', exact: true });
    await control.waitFor(); assert.equal(await control.isEnabled(), true);
    await control.focus(); await control.press('Enter');
    await page.waitForFunction(() => window.__sharedFixtureApp.sdEnglishIntentActive === true);
    assert.equal(await page.locator('.editor [data-editor-ref="translation_0"]').inputValue(), 'Duelist');
    assert.equal(await control.getAttribute('aria-pressed'), 'true');
    for (const theme of ['light', 'grey', 'dark', 'modern-dark']) {
        await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
        await page.setViewportSize({ width: 1100, height: 900 });
        const bounds = await control.boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 1100, theme + ': the new action fits a resized desktop window');
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.screenshot({ path: join(directory, 'use-english-' + theme + '.png') });
    }
    await control.click();
    await page.waitForFunction(() => !window.__sharedFixtureApp.sdEnglishIntentActive);
    assert.equal(await page.locator('.editor [data-editor-ref="translation_0"]').inputValue(), 'Duelist', 'Revocation retains authored text.');

    await page.evaluate(async () => {
        const h = window.__sharedFixtureApp; await h.editorExit();
        const previous = { filepath: 'stat/reduced.txt', filename: 'reduced.txt', filedir: 'stat', name: '', stats: ['reduced'],
            variables: ['#'], remarks: [''], translations: { English: ['Warrior'], Thai: ['เดิม', 'รูปแบบเก่า'] } };
        const current = structuredClone(previous), other = { ...structuredClone(previous), filepath: 'stat/other.txt', filename: 'other.txt',
            translations: { English: ['Warrior'] } };
        const workspace = WorkspaceState.initializeWorkspace({ sourceHash: 'old', game: h.gameVersion, descs: [], status: {} },
            { source: [previous], sourceHash: 'old', language: h.lang, game: h.gameVersion });
        WorkspaceState.stageTranslation(workspace, { filepath: previous.filepath, translations: ['คำแปลที่บันทึก'] }, h.lang, { source: previous, sourceHash: 'old' });
        WorkspaceState.upgradeSource(workspace, { source: [current, other], previousSource: [previous], sourceHash: 'b'.repeat(64), previousSourceHash: 'old', game: h.gameVersion });
        h._workspaceSourceBaseline = Vue.markRaw([current, other]); h.sourceIdentity = workspace.sourceHash; h.localDescs = workspace;
        h.descs = structuredClone([current, other]); h.applyWorkspaceOverlay(); h.filterDesc();
        await h.editFile(current.filepath); await h.$nextTick();
    });
    await page.getByText(/Upstream may have retained obsolete variants/).waitFor();
    await page.screenshot({ path: join(directory, 'count-mismatch-info.png') });
    assert.equal(await page.evaluate(() => window.__sharedFixtureApp.editorDroppedCountInfo.actualCount), 2);
    assert.equal(await page.getByRole('button', { name: 'Use preserved translation', exact: true }).isEnabled(), true);
    await page.getByRole('button', { name: 'Close', exact: true }).last().click();
    await page.evaluate(async () => { const h = window.__sharedFixtureApp; await h.editFile('stat/other.txt'); });
    await page.locator('.editor [data-editor-ref="translation_0"]').fill('แปลไฟล์อื่น');
    await page.getByRole('button', { name: 'Save & close', exact: true }).click();
    assert.equal(await page.evaluate(() => !!window.__sharedFixtureApp.localDescs.staged.Thai['stat/other.txt']), true, 'Unresolved count mismatch does not block unrelated saves.');
    await page.evaluate(async () => { await window.__sharedFixtureApp.editFile('stat/reduced.txt'); });
    await page.getByRole('button', { name: 'Use preserved translation', exact: true }).click();
    await page.waitForFunction(() => !window.__sharedFixtureApp.editorDroppedCandidate);
    assert.deepEqual(await page.evaluate(() => [...window.__sharedFixtureApp.localDescs.staged.Thai['stat/reduced.txt'].translations]), ['คำแปลที่บันทึก']);
    await page.screenshot({ path: join(directory, 'preserved-translation-saved.png') });

    const native = await page.evaluate(async () => {
        const scope = { accountId: 'sd-english-native', game: 'poe2', branchId: 'default', sourceHash: 'c'.repeat(64) };
        const original = { filepath: 'native.txt', name: '', stats: ['native'], variables: ['#'], remarks: [''], translations: { English: ['Duelist'] } };
        OfflineStore.setWorkspaceContext(scope); await OfflineStore.setSource([original], scope);
        await OfflineStore.setWorkspace({ ...scope, descs: [structuredClone(original)], status: {}, staged: {}, stagedVersion: 1, statusMetadataVersion: 1 }, scope);
        const intent = await StatDescCodec.englishIntentFor(original, 'native-approval');
        const batch = { ...scope, jobId: 'native-english-save', language: 'Thai', origin: 'save',
            files: [{ filepath: original.filepath, translations: ['Duelist'], trackedForExport: true, englishIntent: intent }],
            descriptions: [original], revisions: [{ filepath: original.filepath, lang: 'Thai', translations: ['Duelist'], savedAt: 42, englishIntent: intent }] };
        const worker = SaveWorkerClient.create({ store: OfflineStore });
        const ack = await worker.save(batch), replay = await worker.save(batch); worker.dispose();
        const saved = await OfflineStore.getWorkspace(scope);
        const englishBytes = StatDescCodec.descEncode({ ...original, translations: { English: ['Duelist'], Thai: saved.staged.Thai['native.txt'].translations } });
        const exported = StatDescCodec.parseText(original.filepath, StatDescCodec.decodeUTF16(englishBytes), 'Thai', { strict: true });
        window.__nativeEnglish = { scope, intent, batch };
        return { ack, replay, intent: saved.staged.Thai['native.txt'].englishIntent, exported: exported.translations.Thai };
    });
    assert.equal(native.replay.duplicate, true); assert.equal(native.intent.actionId, 'native-approval'); assert.deepEqual(native.exported, ['Duelist']);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__sharedFixtureApp);
    const restored = await page.evaluate(async () => {
        const scope = { accountId: 'sd-english-native', game: 'poe2', branchId: 'default', sourceHash: 'c'.repeat(64) };
        const saved = await OfflineStore.getWorkspace(scope), stage = saved.staged.Thai['native.txt'];
        const source = (await OfflineStore.getSource(scope))[0];
        const batch = { ...scope, jobId: 'native-english-revoke', language: 'Thai', origin: 'save',
            files: [{ filepath: source.filepath, translations: stage.translations, trackedForExport: true, englishIntent: null }],
            descriptions: [source], revisions: [] };
        const worker = SaveWorkerClient.create({ store: OfflineStore }); await worker.save(batch); worker.dispose();
        const revoked = await OfflineStore.getWorkspace(scope);
        return { activeAfterReopen: stage.englishIntent, afterRevocation: revoked.staged.Thai[source.filepath].englishIntent || null,
            originalThaiAbsent: !Object.hasOwn(source.translations, 'Thai') };
    });
    assert.equal(restored.activeAfterReopen.actionId, 'native-approval'); assert.equal(restored.afterRevocation, null); assert.equal(restored.originalThaiAbsent, true);
    writeFileSync(join(directory, 'browser-results.json'), JSON.stringify({ native, restored }, null, 2));
    console.log('PASS SD Use English keyboard/pointer controls, four desktop themes, count-mismatch review and unrelated Save, native IndexedDB/worker save+receipt replay, page reopen, export and revocation.');
};
