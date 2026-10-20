'use strict';
// Deterministic asynchronous invalidation drills in the real shared Lookup.
const assert = require('node:assert/strict');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const settle = page => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 0)))));

module.exports = async ({ page, directory }) => {
  mkdirSync(directory, { recursive: true });
  const baseline = process.env.SDEDITOR_LOOKUP_FOCUS_BASELINE === '1', cases = [], outgoing = [];
  await page.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.hostname !== '127.0.0.1' || !['GET', 'HEAD'].includes(request.method())) { outgoing.push(request.method() + ' ' + url.pathname); return route.abort(); }
    return route.continue();
  });
  await page.evaluate(() => {
    const h = window.__sharedFixtureApp;
    window.lookupFocusSaves = []; h.ctSave = async () => { window.lookupFocusSaves.push(window.lookupFocusCase); return false; };
    h.saveSettings = async () => true; h.ctQueueDraft = () => {}; h.ctFlushDraft = async () => true;
    h.ctQueueCommentDraft = () => {}; h.ctFlushCommentDraft = async () => {}; h.ctLoadComments = async () => {};
    // Hold just the Lookup debounce created by this call, then execute its real
    // callback explicitly. No machine-speed race or global fake browser clock.
    const changed = h.lookupSearchChanged;
    h.lookupSearchChanged = function (...args) {
      if (!window.lookupHoldSearch) return changed(...args);
      const nativeTimeout = window.setTimeout;
      window.setTimeout = (callback, delay, ...values) => {
        if (delay !== 250) return nativeTimeout(callback, delay, ...values);
        const handle = nativeTimeout(() => {}, 60000);
        window.lookupReleaseSearch = () => { clearTimeout(handle); window.lookupReleaseSearch = null; callback(...values); };
        return handle;
      };
      try { return changed(...args); } finally { window.setTimeout = nativeTimeout; }
    };
    const exit = document.createElement('button'); exit.type = 'button'; exit.id = 'lookupFocusExit'; exit.textContent = 'Outside Lookup';
    exit.style.cssText = 'position:fixed;left:8px;top:8px;z-index:2147483647'; document.body.appendChild(exit);
    h.descs = [...h.descs, ...Array.from({ length: 63 }, (_, i) => ({ filepath: 'synthetic/ASYNC-REFERENCE-' + i + '.txt', filename: 'ASYNC-REFERENCE-' + i + '.txt', filedir: 'synthetic',
      stats: ['async_stat_' + i], translations: { English: ['ASYNC-REFERENCE ' + (i === 0 ? 'UNIQUE-ROW ' : '') + 'Source ' + i], Thai: ['Target ' + i] } }))];
    h.editorBlocks[1].translation = 'Retained SD draft';
  });
  const panel = page.getByRole('region', { name: 'Reference lookup', exact: true });
  const search = panel.getByRole('searchbox', { name: 'Search reference files' });
  const next = panel.getByRole('button', { name: 'Next reference results' });
  const toggle = panel.getByRole('button', { name: 'Lookup filters', exact: true });
  const cancel = panel.getByRole('button', { name: 'Cancel', exact: true });
  const exit = page.locator('#lookupFocusExit');
  async function apply(query) {
    await search.fill(query);
    await page.waitForFunction(query => window.__sharedFixtureApp.lookupAppliedQuery === query, query); await settle(page);
  }
  const state = () => page.evaluate(() => {
    const h = window.__sharedFixtureApp, active = document.activeElement;
    return { query: h.lookupAppliedQuery, count: h.lookupResultCount, page: h.lookupCurrentPage, pages: h.lookupPageCount,
      focus: active?.getAttribute('aria-label') || active?.id || active?.tagName,
      inside: !!document.querySelector('#editorLookupPanel')?.contains(active), saves: window.lookupFocusSaves.slice(),
      sdDraft: h.editorBlocks[1].translation, ctDraft: h.ctValues['focus-field-0'], filters: h.lookupFiltersVisible };
  });
  async function record(name, variant, deliberate = false) {
    await settle(page); const result = await state(); cases.push({ variant, name, deliberate, ...result });
    if (variant === 'clienttext-inline' && ['delayed-search-1', 'background-cancel-1'].includes(name)) {
      await page.screenshot({ path: join(directory, (baseline ? 'baseline-' : '') + variant + '-' + name + '.png') });
    }
    if (!baseline && !deliberate) { assert.deepEqual(result.saves, [], variant + '/' + name); assert.equal(result.inside, true, variant + '/' + name + ': focus remains in Lookup'); }
    return result;
  }
  async function clearSaves(name) { await page.evaluate(name => { window.lookupFocusCase = name; window.lookupFocusSaves = []; }, name); }
  async function prepare() {
    if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
    await page.evaluate(() => {
      const h = window.__sharedFixtureApp, controller = new AbortController();
      h._lookupPreparationAbort = controller; h.lookupPreparing = true; window.lookupFocusSignal = controller.signal;
    });
    await cancel.focus();
  }
  for (const mode of ['sd', 'clienttext']) for (const inline of [false, true]) {
    const variant = mode + '-' + (inline ? 'inline' : 'full');
    await page.evaluate(async ({ mode, inline }) => {
      const h = window.__sharedFixtureApp, closeRun = h._ctCloseRun; h._ctCloseRun = {};
      h.lookupQuery = ''; h.lookupAppliedQuery = ''; h.lookupScope = 'all'; h.lookupLanguage = ''; h.lookupModeFilter = 'all'; h.lookupGroupFilter = '';
      h.lookupTranslatedOnly = false; h.lookupFiltersVisible = false; h.inlineEditor = inline; h.inlineSidebarVisible = true;
      if (mode === 'sd') { h.ctActive = false; h.ctEditor = false; h.editorVisible = !inline; h.sideTab = 'lookup'; }
      else {
        h.editorVisible = false;
        if (!h.ctWorkspace) {
          const units = Array.from({ length: 63 }, (_, i) => Vue.markRaw({ id: 'normal|Sheet|focus-' + i, role: 'normal', sheet: 'Sheet', recordId: 'ASYNC-REFERENCE-' + i,
            notes: [], fields: [{ id: 'focus-field-' + i, name: 'Text', kind: 'text', source: 'ASYNC-REFERENCE ' + (i === 0 ? 'UNIQUE-ROW ' : '') + 'Source ' + i,
              target: 'Target ' + i, targetCell: 'B' + (i + 2), required: true, originalMissing: false, outdated: false }] }));
          h.ctWorkspace = { scope: { accountId: 'guest', game: 'poe2', branchId: 'default', versionId: 'local:async-focus', groupId: 'local:async-focus', language: 'Thai' },
            metadata: { version: { name: 'Synthetic asynchronous focus' }, descriptors: [{ role: 'normal', baselineId: 'a'.repeat(64) }] } };
          h.ctUnits = Vue.markRaw(units); h._ctUnitIndex = Vue.markRaw(new Map(units.map(unit => [unit.id, unit]))); h._ctWorkUnits = Vue.markRaw(new Map());
          h.ctSelection = units[0].id; h.ctFocusedField = units[0].fields[0].id; h.ctValues = { 'focus-field-0': 'Retained CT draft' }; h.ctSaved = {}; h.ctReviewed = {};
          h.ctSelectedFilters = ['unchanged', 'missing', 'saved', 'outdated'];
        }
        h.ctActive = true; h.ctEditor = !inline; h.ctInlineClosed = false; h.ctInitializing = false; h.ctBusy = false; h.ctTool = 'lookup';
      }
      await h.$nextTick(); await h.lookupLoadCatalog(); await h.$nextTick(); h._ctCloseRun = closeRun;
    }, { mode, inline });
    await panel.waitFor(); await apply('ASYNC-REFERENCE');
    for (let round = 1; round <= 3; round++) {
      await apply('ASYNC-REFERENCE'); await clearSaves('held-search-' + round);
      await page.evaluate(() => { window.lookupHoldSearch = true; });
      await search.fill('UNIQUE-ROW'); await next.click();
      const pending = await state(); assert.equal(pending.page, 2); assert.equal(pending.count, 63); assert.equal(pending.focus, 'Next reference results');
      await page.evaluate(() => { window.lookupHoldSearch = false; window.lookupReleaseSearch(); });
      const completed = await record('delayed-search-' + round, variant); assert.equal(completed.count, 1); assert.equal(completed.pages, 1);
      await apply('ASYNC-REFERENCE'); await clearSaves('background-cancel-' + round); await prepare();
      await page.evaluate(() => window.__sharedFixtureApp.lookupCancelPreparation());
      const cancelled = await record('background-cancel-' + round, variant);
      assert.equal(await page.evaluate(() => window.lookupFocusSignal.aborted), true);
      if (!baseline) assert.equal(cancelled.focus, 'Lookup filters');
    }
    await clearSaves('asynchronous-filter-close'); await prepare();
    await page.evaluate(() => { window.__sharedFixtureApp.lookupFiltersVisible = false; });
    await record('asynchronous-filter-close', variant);
    await page.evaluate(() => window.__sharedFixtureApp.lookupCancelPreparation());
    // Normal tool close selects another stable sidebar control. A later cancel
    // must leave that deliberate destination alone, even with Lookup hidden.
    await clearSaves('tool-close'); await prepare();
    const dictionary = page.locator('.sharedEditorSidebar').getByRole('button', { name: /Dictionary$/ });
    await dictionary.click(); await panel.waitFor({ state: 'hidden' });
    await page.evaluate(() => window.__sharedFixtureApp.lookupCancelPreparation()); await settle(page);
    const closed = await state(); cases.push({ variant, name: 'tool-close', deliberate: true, ...closed });
    if (!baseline) { assert.deepEqual(closed.saves, []); assert.equal(await dictionary.evaluate(el => el === document.activeElement), true); }
    await page.evaluate(() => window.__sharedFixtureApp.openEditorLookup()); await panel.waitFor();
    // A real user leaves Lookup before either asynchronous update runs. Preserve
    // that focus and the existing inline save-on-exit contract (Save is mocked).
    await apply('ASYNC-REFERENCE'); await clearSaves('deliberate-exit-search');
    await page.evaluate(() => { window.lookupHoldSearch = true; }); await search.fill('UNIQUE-ROW'); await next.click();
    await exit.click(); await settle(page); const leaving = await state();
    await page.evaluate(() => { window.lookupHoldSearch = false; window.lookupReleaseSearch(); });
    const afterExit = await record('deliberate-exit-search', variant, true);
    assert.equal(await exit.evaluate(el => el === document.activeElement), true); assert.deepEqual(afterExit.saves, leaving.saves);
    if (mode === 'clienttext' && inline) assert.ok(leaving.saves.length > 0, 'Deliberate inline exit still invokes the existing Save path');
    await apply('ASYNC-REFERENCE'); await clearSaves('deliberate-exit-cancel'); await prepare(); await exit.click(); await settle(page);
    const beforeCancel = await state(); await page.evaluate(() => window.__sharedFixtureApp.lookupCancelPreparation());
    const afterCancel = await record('deliberate-exit-cancel', variant, true);
    assert.equal(await exit.evaluate(el => el === document.activeElement), true); assert.deepEqual(afterCancel.saves, beforeCancel.saves);
    assert.equal(afterCancel.sdDraft, 'Retained SD draft');
    if (mode === 'clienttext') assert.equal(afterCancel.ctDraft, 'Retained CT draft');
    await search.focus(); await page.screenshot({ path: join(directory, (baseline ? 'baseline-' : '') + variant + '.png') });
  }
  assert.deepEqual(outgoing, []);
  const report = { revision: process.env.SDEDITOR_LOOKUP_FOCUS_REVISION || (baseline ? 'cf687d003ef120ba83401f5f71342f6e277e13cc' : 'working-tree'),
    baseline, browser: await page.context().browser().version(), cases, outgoing,
    unintendedSaves: cases.filter(item => !item.deliberate).reduce((sum, item) => sum + item.saves.length, 0) };
  writeFileSync(join(directory, baseline ? 'baseline-focus.json' : 'focus-verdict.json'), JSON.stringify(report, null, 2));
  console.log('Lookup asynchronous focus ' + (baseline ? 'baseline' : 'PASS') + ': ' + cases.length + ' cases; unintended Save calls=' + report.unintendedSaves);
};
