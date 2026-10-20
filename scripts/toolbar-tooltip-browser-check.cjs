'use strict';
// Real SPA surfaces; synthetic editor data and stubbed MTL actions only.
const assert = require('node:assert/strict');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

module.exports = async function ({ page, context, failures, directory }) {
    mkdirSync(directory, { recursive: true });
    const results = [], requests = [], accessibility = [], escapeChecks = [];
    const axSession = await context.newCDPSession(page);
    page.on('request', request => { if (request.method() === 'POST' && /\/mtl\//.test(request.url())) requests.push(request.url()); });
    const tooltip = page.getByRole('tooltip');
    const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const clear = async () => {
        await page.mouse.move(1, 1);
        await page.evaluate(() => { document.activeElement?.blur(); window.__sharedFixtureApp.hideTooltip(); });
    };
    async function readAccessibility(control, name) {
        const id = 'toolbar-ax-' + accessibility.length;
        await control.evaluate((element, id) => element.dataset.toolbarAx = id, id);
        const { result } = await axSession.send('Runtime.evaluate', { expression: `document.querySelector('[data-toolbar-ax="${id}"]')` });
        const { node } = await axSession.send('DOM.describeNode', { objectId: result.objectId });
        const { nodes } = await axSession.send('Accessibility.getPartialAXTree', { backendNodeId: node.backendNodeId, fetchRelatives: false });
        await axSession.send('Runtime.releaseObject', { objectId: result.objectId });
        const entry = nodes.find(value => value.backendDOMNodeId === node.backendNodeId);
        const authored = await control.getAttribute('aria-description');
        assert.ok(authored, name + ': descriptive hint available before hover/focus');
        assert.equal(entry?.description?.value?.replace(/\s+/g, ' ').trim(), authored.replace(/\s+/g, ' ').trim(), name + ': Chromium accessibility tree retains the complete description');
        const snapshot = { case: name, name: entry.name?.value, role: entry.role?.value, description: entry.description.value, ignored: entry.ignored };
        accessibility.push(snapshot); return snapshot;
    }
    async function checkHint(control, name, keyboard = true) {
        await clear(); await control.scrollIntoViewIfNeeded();
        const expected = await control.evaluate(element => String(element.__sdTooltipValue || ''));
        assert.ok(expected, name + ': shared directive has a nonempty hint');
        await readAccessibility(control, name);
        await control.hover({ force: true }); await tooltip.waitFor(); await settle();
        async function check(phase) {
            assert.equal(await tooltip.innerText(), expected, name + '/' + phase + ': complete shared hint');
            assert.equal(await tooltip.count(), 1, name + ': one component tooltip');
            const bounds = await tooltip.evaluate(element => {
                const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: innerWidth, height: innerHeight };
            });
            assert.ok(bounds.left >= 7.5 && bounds.top >= 7.5 && bounds.right <= bounds.width - 7.5 && bounds.bottom <= bounds.height - 7.5,
                name + '/' + phase + ': tooltip stays in viewport ' + JSON.stringify(bounds));
            assert.equal(await control.evaluate(element => !!element.closest('[title]')), false, name + ': no duplicate native tooltip');
        }
        await check('hover');
        await page.mouse.move(1, 1); await tooltip.waitFor({ state: 'detached' });
        if (keyboard) {
            await control.focus(); await tooltip.waitFor(); await settle(); await check('focus');
            assert.equal(await control.evaluate(element => document.activeElement === element), true, name + ': native focus retained');
            await control.hover({ force: true });
            await page.keyboard.press('Escape'); await tooltip.waitFor({ state: 'detached' });
            assert.equal(await control.evaluate(element => document.activeElement === element), true, name + ': Escape dismisses only the hint and retains trigger focus');
            const box = await control.boundingBox(); await page.mouse.move(box.x + box.width / 2 + 1, box.y + box.height / 2);
            await settle(); assert.equal(await tooltip.count(), 0, name + ': pointer movement does not reopen a dismissed hint');
            escapeChecks.push(name);
            await control.evaluate(element => element.blur()); await tooltip.waitFor({ state: 'detached' });
        }
        results.push(name);
    }
    async function checkVisibleHints(selector, mode) {
        const controls = page.locator(selector);
        for (let i = 0; i < await controls.count(); i++) {
            const control = controls.nth(i);
            if (!await control.isVisible() || !await control.evaluate(element => !!element.__sdTooltipValue)) continue;
            const name = await control.getAttribute('aria-label') || (await control.innerText()).trim();
            await checkHint(control, mode + '/' + name, !await control.isDisabled());
        }
    }
    await checkVisibleHints('.editor .editorFieldToolbar button, .editor .editorActions button, .editor .gamePreviewFrameBtn, .editor .sideSearchRow button, .editor .dictionaryEntries button', 'SD full');
    const rawFile = accessibility.find(entry => entry.name === 'Show raw file');
    assert.equal(rawFile?.description, 'View and download this file as text', 'released raw-file description is preserved before hover');
    await page.evaluate(async () => { const h = window.__sharedFixtureApp; await h.editorExit(); h.inlineRowFocusOut = () => {}; h.gameVersionSelected = true; h.inlineEditor = true; await h.$nextTick(); if (!await h.activateInlineRow(h.descs[0].filepath)) throw Error('SD inline fixture activation failed'); await h.$nextTick(); });
    await page.waitForSelector('.workspace [data-editor-ref^="translation_"]');
    await checkVisibleHints('.workspace .editorFieldToolbar button, .workspace .workspaceActions button, .workspace .workspacePagination button, .workspace .inlineFileActions button', 'SD inline/workspace');
    await page.evaluate(async () => { const h = window.__sharedFixtureApp; h.inlineEditor = false; await h.editFile(h.descs[0].filepath); await h.$nextTick(); });
    await page.evaluate(async () => {
        const host = window.__sharedFixtureApp; await host.editorExit();
        const field = { id: 'toolbar-text', kind: 'text', name: 'Text', source: 'Source text', target: '', targetCell: 'C2', required: true, originalMissing: true, outdated: false };
        const unit = Vue.markRaw({ id: 'normal|Toolbar|record', role: 'normal', sheet: 'Toolbar', recordId: 'record', fields: [field], developerNotes: '', notes: [] });
        host.ctWorkspace = { scope: { accountId: 'guest', game: 'poe2', branchId: 'default', versionId: 'fixture', groupId: 'local:toolbar', language: 'Thai' },
            metadata: { version: { name: 'Toolbar fixture' }, descriptors: [{ role: 'normal', baselineId: 'a'.repeat(64) }] } };
        host.ctUnits = Vue.markRaw([unit]); host._ctUnitIndex = Vue.markRaw(new Map([[unit.id, unit]])); host._ctWorkUnits = Vue.markRaw(new Map());
        host.ctSelection = unit.id; host.ctFocusedField = field.id; host.ctValues = { [field.id]: '' }; host.ctSaved = {}; host.ctReviewed = {};
        host.ctPolicy = { clientTextEnglishIntent: ClientTextState.ENGLISH_INTENT_PROTOCOL, clientTextEnglishEligibility: ClientTextState.ENGLISH_ELIGIBILITY_PROTOCOL };
        host.ctEditor = true; host.ctActive = true; host.ctInitializing = false; host.ctBusy = false; host.ctTool = 'dictionary';
        host.ctQueueDraft = () => {}; host.ctFlushDraft = async () => true; host.ctQueueCommentDraft = () => {};
        host.ctFlushCommentDraft = async () => {}; host.ctLoadComments = async () => {};
        host.ctChooseEnglish = (field, revoke) => {
            window.__englishActions = (window.__englishActions || 0) + 1;
            const sourceHash = ClientTextState.sourceHash(field.source);
            host.ctValues = { [field.id]: '' };
            host.ctSaved = { [unit.id]: { values: { [field.id]: '' }, reviewed: { [field.id]: sourceHash }, englishIntent: { [field.id]: { state: revoke ? 'revoked' : 'active', sourceHash } } } };
            return true;
        };
        await host.$nextTick();
    });
    await page.waitForSelector('.ctFullEditor [data-ct-target="toolbar-text"]');
    await checkVisibleHints('.ctFullEditor .editorFieldToolbar button, .ctFullEditor .ctEditorActions button, .ctFullEditor .sideSearchRow button, .ctFullEditor .dictionaryEntries button', 'ClientText full');
    const english = page.getByRole('button', { name: 'Use English', exact: true }).first();
    assert.equal((await english.innerText()).trim(), 'Eng');
    await english.focus(); await page.keyboard.press('Space');
    assert.equal(await english.getAttribute('aria-pressed'), 'true');
    assert.match(await tooltip.innerText(), /Use English is active/, 'focused Eng hint follows the active state');
    assert.match((await readAccessibility(english, 'Eng active state')).description, /Use English is active/);
    await page.keyboard.press('Enter'); assert.equal(await english.getAttribute('aria-pressed'), 'false');
    assert.equal(await page.evaluate(() => window.__englishActions), 2, 'Eng preserves native Space/Enter activation');
    const target = page.locator('.ctFullEditor [data-ct-target="toolbar-text"]');
    await target.fill('Format selection'); await target.evaluate(element => { element.focus(); element.setSelectionRange(0, element.value.length); element.dispatchEvent(new Event('select', { bubbles: true })); });
    await page.getByRole('button', { name: 'Bold', exact: true }).last().click();
    assert.equal(await target.inputValue(), '<b>{Format selection}', 'toolbar pointer capture preserves formatting selection');
    await page.evaluate(async () => { window.__sharedFixtureApp.ctPolicy = null; await window.__sharedFixtureApp.$nextTick(); });
    const englishDisabled = page.locator('.ctFullEditor .fieldEnglishTarget').first();
    assert.equal(await english.isDisabled(), true); assert.equal(await englishDisabled.getAttribute('tabindex'), '0');
    await checkHint(englishDisabled, 'ClientText disabled Eng scope explanation');
    assert.match(await englishDisabled.evaluate(element => element.__sdTooltipValue), /compatible shared-service update/);
    await page.evaluate(async () => { window.__sharedFixtureApp.ctPolicy = { clientTextEnglishIntent: ClientTextState.ENGLISH_INTENT_PROTOCOL, clientTextEnglishEligibility: ClientTextState.ENGLISH_ELIGIBILITY_PROTOCOL }; await window.__sharedFixtureApp.$nextTick(); });

    // Exercise MTL/admin/cancellation branches without requesting any generation.
    await page.evaluate(() => {
        const original = window.__sharedFixtureApp, mount = document.createElement('div'); mount.id = 'toolbarMtlFixture'; Object.assign(mount.style, { position: 'fixed', left: '20px', top: '20px', zIndex: '3000' }); document.body.append(mount);
        const controller = Vue.reactive({ side: 'translation', mtl: true, mtlDisabled: true, mtlHint: 'Sign in with language access to translate', mtlSettings: true, mtlDebug: true,
            formatting: false, disabled: false, open: false, menuOpen: false, choices: [], entries: [], groups: [], mtlBusy: false,
            toggle() {}, menu() { this.menuOpen = !this.menuOpen; }, closeMenu() { this.menuOpen = false; }, options() {}, generate() { window.__mtlActions = 'generate'; }, cancelMtl() { window.__mtlActions = 'cancel'; }, toggleMtlSettings() {}, debugMtl() {} });
        const root = Vue.createApp({ data: () => ({ controller }), methods: { showTooltip: (...args) => original.showTooltip(...args), hideTooltip: () => original.hideTooltip() },
            template: '<editor-field-toolbar :controller="controller"><input aria-label="MTL fixture input"></editor-field-toolbar>' });
        root.component('editor-field-toolbar', EditorComponents.FieldToolbar);
        root.directive('tooltip', original.$.appContext.directives.tooltip);
        window.__toolbarMtl = root.mount(mount);
    });
    const mtlTarget = page.locator('#toolbarMtlFixture .fieldMtlTarget');
    await checkHint(mtlTarget, 'MTL disabled sign-in explanation');
    for (const name of ['Model settings · Admin', 'MTL request details · Admin']) await checkHint(page.getByRole('button', { name, exact: true }), name);
    await page.evaluate(async () => { window.__toolbarMtl.controller.mtlDisabled = false; await window.__toolbarMtl.$nextTick(); });
    const mtl = page.locator('#toolbarMtlFixture .ctMtlButton'); await checkHint(mtl, 'MTL enabled');
    await mtl.focus(); await page.keyboard.press('Enter'); assert.equal(await page.evaluate(() => window.__mtlActions), 'generate');
    await page.evaluate(async () => { const c = window.__toolbarMtl.controller; c.mtlBusy = true; c.mtlProgress = { phase: 'running', canCancel: true }; await window.__toolbarMtl.$nextTick(); });
    await checkHint(mtl, 'MTL stop'); await mtl.focus(); await page.keyboard.press('Space'); assert.equal(await page.evaluate(() => window.__mtlActions), 'cancel');
    await page.evaluate(async () => { window.__toolbarMtl.controller.mtlProgress = { phase: 'cancelling', canCancel: false }; await window.__toolbarMtl.$nextTick(); });
    await checkHint(mtlTarget, 'MTL stopping explanation');
    await page.evaluate(async () => { window.__toolbarMtl.controller.menuOpen = true; await window.__toolbarMtl.$nextTick(); });
    const menuTrigger = page.locator('#toolbarMtlFixture .fieldHistoryMenuButton');
    await clear(); await menuTrigger.focus(); await tooltip.waitFor(); await page.keyboard.press('Escape'); await tooltip.waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => window.__toolbarMtl.controller.menuOpen), true, 'first Escape dismisses the hint before the menu');
    assert.equal(await menuTrigger.evaluate(element => document.activeElement === element), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => window.__toolbarMtl.controller.menuOpen), false, 'second Escape still closes the actual revision menu');
    assert.equal(await menuTrigger.evaluate(element => document.activeElement === element), true);
    escapeChecks.push('revision menu: hint first, then close');
    await page.evaluate(() => document.getElementById('toolbarMtlFixture').remove());

    console.log('PASS SD/ClientText hover, keyboard focus, native activation and MTL disabled/admin states.');
    const layout = [], cdp = await context.newCDPSession(page);
    for (const theme of ['light', 'grey', 'dark', 'modern-dark']) for (const density of ['compact', 'spacious']) for (const width of [1440, 1100, 1000]) for (const zoom of [1, 1.25, 1.5, 2]) {
        // Match desktop zoom's effective CSS viewport and device-pixel density.
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: Math.round(width / zoom), height: Math.round(900 / zoom), deviceScaleFactor: zoom, mobile: false });
        await page.evaluate(async ({ theme, density }) => { document.documentElement.dataset.theme = theme; window.__sharedFixtureApp.uiDensity = density; await window.__sharedFixtureApp.$nextTick(); }, { theme, density });
        await english.scrollIntoViewIfNeeded();
        const rect = await english.evaluate(element => {
            const box = element.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(element); const text = range.getBoundingClientRect();
            return { width: box.width, height: box.height, font: getComputedStyle(element).fontSize, clipped: text.left < box.left + 1 || text.right > box.right - 1 || text.top < box.top + 1 || text.bottom > box.bottom - 1 };
        });
        assert.ok(Math.abs(rect.width - rect.height) < .1 && !rect.clipped, JSON.stringify({ theme, density, width, zoom, rect }));
        layout.push({ theme, density, width, zoom, ...rect });
    }
    await cdp.send('Emulation.clearDeviceMetricsOverride'); await page.setViewportSize({ width: 1100, height: 800 });
    await page.evaluate(() => { window.__sharedFixtureApp.uiDensity = 'compact'; document.documentElement.dataset.theme = 'dark'; });
    await checkHint(english, 'Eng narrow desktop placement');
    await english.screenshot({ path: join(directory, 'eng-square.png') });
    await english.hover(); await tooltip.waitFor(); await settle();
    await page.screenshot({ path: join(directory, 'toolbar-tooltip-desktop.png') });
    await english.focus(); await page.keyboard.press('Space');
    assert.equal(await english.getAttribute('aria-pressed'), 'true');
    await page.screenshot({ path: join(directory, 'toolbar-tooltip-eng-active.png') });
    await clear();
    await page.evaluate(async () => { const h = window.__sharedFixtureApp; h.ctSave = async () => true; h.ctInlineFocusOut = () => {}; h.inlineEditor = true; h.ctEditor = false; h.ctInlineClosed = false; await h.$nextTick(); });
    await page.waitForSelector('.ctListWorkspace [data-ct-target="toolbar-text"]');
    await checkVisibleHints('.ctListWorkspace .editorFieldToolbar button, .ctListWorkspace .workspaceActions button, .ctListWorkspace .workspacePagination button', 'ClientText inline/workspace');
    await page.getByRole('button', { name: 'Use English', exact: true }).first().hover(); await tooltip.waitFor();
    await page.screenshot({ path: join(directory, 'toolbar-tooltip-inline.png') });
    assert.deepEqual(failures, []); assert.deepEqual(requests, []);
    writeFileSync(join(directory, 'results.json'), JSON.stringify({ ok: true, hints: results, accessibility, escapeChecks, layout, browserErrors: failures, inferenceRequests: requests,
        limits: 'Synthetic test-mode SPA and stubbed MTL/English action handlers; persistence and hosted deployment are outside this presentation change. Zoom uses effective CSS viewport/device density emulation.' }, null, 2));
    console.log('PASS Chromium AX descriptions: ' + accessibility.length + '; Escape focus/dismissal cases: ' + escapeChecks.length);
    console.log('PASS toolbar hover/focus/disabled placement: ' + results.length + ' hints; square unclipped Eng: ' + layout.length + ' theme/density/width/zoom cases. Evidence: ' + directory);
};
