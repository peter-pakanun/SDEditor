'use strict';
// Actual shared app in all four hosts. Synthetic references, loopback reads only.
const assert = require('node:assert/strict');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const settle = page => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));

module.exports = async function checkLookupLayout({ page, directory }) {
  mkdirSync(directory, { recursive: true });
  const measurements = [], outgoing = [], baseline = process.env.SDEDITOR_LOOKUP_BASELINE === '1';
  await page.route('**/*', route => {
    const req = route.request(), url = new URL(req.url());
    if (url.hostname !== '127.0.0.1' || !['GET', 'HEAD'].includes(req.method())) {
      outgoing.push(req.method() + ' ' + url.origin + url.pathname); return route.abort();
    }
    return route.continue();
  });
  await page.evaluate(() => {
    const h = window.__sharedFixtureApp;
    window.lookupSaveAttempts = [];
    const save = h.ctSave;
    h.ctSave = function (...args) { window.lookupSaveAttempts.push({ stage: window.lookupStage, stack: new Error('Unexpected Save').stack }); return save.apply(this, args); };
    h.saveSettings = async () => true;
    h.ctQueueDraft = () => {}; h.ctFlushDraft = async () => true; h.ctQueueCommentDraft = () => {};
    h.ctFlushCommentDraft = async () => {}; h.ctLoadComments = async () => {};
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { async writeText(text) {
      if (window.lookupCopyDenied) throw Error('Synthetic clipboard denial'); window.lookupCopied = text;
    } } });
    const source = 'LOOKUP-FILTER-REFERENCE SOURCE-SENTINEL\n' + 'Source <tag> @ literal\\n ภาษาไทย. '.repeat(60)
      + '\n' + 'LONGTOKEN'.repeat(100) + '\nSOURCE END';
    const target = 'TARGET-SENTINEL\n' + 'Translation ภาษาไทย 漢字 @ <tag>. '.repeat(80)
      + '\n' + 'TARGETTOKEN'.repeat(100) + '\nTRANSLATION END';
    window.lookupSynthetic = { source, target };
    h.descs = [...h.descs, ...Array.from({ length: 23 }, (_, i) => ({
      filepath: 'synthetic/LOOKUP-FILTER-REFERENCE-' + i + '.txt', filename: 'LOOKUP-FILTER-REFERENCE-' + i + '.txt',
      filedir: 'synthetic', stats: ['synthetic_stat_' + i], translations: { English: [source],
        Thai: [i === 22 ? '' : target], French: ['French reference ' + target] },
    }))];
    h.editorBlocks[1].translation = 'Unsaved SD draft retained';
  });

  const panel = page.getByRole('region', { name: 'Reference lookup', exact: true });
  const search = panel.getByRole('searchbox', { name: 'Search reference files' });
  const toggle = panel.getByRole('button', { name: 'Lookup filters', exact: true });
  const filters = panel.getByRole('group', { name: 'Reference search filters' });
  const results = panel.getByLabel('Reference search results', { exact: true });
  const reference = panel.getByRole('region', { name: 'Selected reference', exact: true });
  const previous = panel.getByRole('button', { name: 'Previous reference results' });
  const next = panel.getByRole('button', { name: 'Next reference results' });
  const clear = panel.getByRole('button', { name: 'Clear', exact: true });
  const query = 'LOOKUP-FILTER-REFERENCE';
  const waitCount = count => page.waitForFunction(count => window.__sharedFixtureApp.lookupResultCount === count, count);
  async function applyQuery(value, count) {
    await search.fill(value);
    await page.waitForFunction(({ value, count }) => { const h = window.__sharedFixtureApp; return h.lookupAppliedQuery === value && h.lookupResultCount === count; }, { value, count });
    await settle(page);
  }
  async function choose(label, value) {
    const select = filters.getByRole('combobox', { name: label, exact: true });
    // selectOption alone does not move focus like a real native select. Keep
    // focus in the control when changing references replaces result buttons.
    await select.focus(); await select.selectOption(value);
  }

  async function configure(mode, inline) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(async ({ mode, inline }) => {
      const h = window.__sharedFixtureApp, { source, target } = window.lookupSynthetic;
      // Match the normal editor-close lifecycle guard while this fixture moves
      // the same tools between hosts without opening real workbook storage.
      const closeRun = h._ctCloseRun; h._ctCloseRun = {};
      h.lookupQuery = ''; h.lookupAppliedQuery = ''; h.lookupLanguage = ''; h.lookupScope = 'all';
      h.lookupModeFilter = 'all'; h.lookupGroupFilter = ''; h.lookupTranslatedOnly = false; h.lookupCopyStatus = '';
      h.lookupFiltersVisible = false; h.inlineEditor = inline; h.inlineSidebarVisible = true;
      if (mode === 'sd') { h.ctActive = false; h.ctEditor = false; h.editorVisible = !inline; h.sideTab = 'lookup'; }
      else {
        h.editorVisible = false;
        if (!h.ctWorkspace) {
          const units = Array.from({ length: 23 }, (_, i) => Vue.markRaw({ id: 'normal|Sheet|lookup-' + i, role: 'normal', sheet: 'Sheet',
            recordId: 'LOOKUP-FILTER-REFERENCE-' + i, developerNotes: 'Synthetic developer note', metadata: { Context: 'Synthetic only' }, notes: [],
            fields: [{ id: 'lookup-field-' + i, name: 'Text', kind: 'text', source: source + '\r\nliteral\\n @ <img>',
              target: i === 22 ? '' : target, targetCell: 'B' + (i + 2), required: true, originalMissing: i === 22, outdated: false }] }));
          h.ctWorkspace = { scope: { accountId: 'guest', game: 'poe2', branchId: 'default', versionId: 'synthetic', groupId: 'local:lookup', language: 'Thai' },
            metadata: { version: { name: 'Synthetic Lookup' }, descriptors: [{ role: 'normal', baselineId: 'a'.repeat(64) }] } };
          h.ctUnits = Vue.markRaw(units); h._ctUnitIndex = Vue.markRaw(new Map(units.map(unit => [unit.id, unit]))); h._ctWorkUnits = Vue.markRaw(new Map());
          h.ctSelection = units[0].id; h.ctFocusedField = units[0].fields[0].id; h.ctValues = { 'lookup-field-0': 'Unsaved CT draft retained' };
          h.ctSaved = {}; h.ctReviewed = {}; h.ctSelectedFilters = ['unchanged', 'missing', 'saved', 'outdated'];
        }
        h.ctActive = true; h.ctEditor = !inline; h.ctInlineClosed = false; h.ctInitializing = false; h.ctBusy = false; h.ctTool = 'lookup';
      }
      await h.$nextTick(); await h.lookupLoadCatalog(); await h.$nextTick();
      h._ctCloseRun = closeRun;
    }, { mode, inline });
    await panel.waitFor();
    assert.equal(await page.locator('#editorLookupPanel').count(), 1, 'One shared Lookup panel is mounted');
  }

  async function snapshot() {
    return page.evaluate(() => { const h = window.__sharedFixtureApp; return {
      query: h.lookupQuery, applied: h.lookupAppliedQuery, selected: h.lookupSelectedFilepath, page: h.lookupCurrentPage,
      language: h.lookupLanguage, scope: h.lookupScope, mode: h.lookupModeFilter, group: h.lookupGroupFilter, translated: h.lookupTranslatedOnly,
      sdDraft: JSON.stringify(h.editorBlocks), ctDraft: JSON.stringify(h.ctValues), source: JSON.stringify(h.descs), saved: JSON.stringify(h.localDescs), ctSaved: JSON.stringify(h.ctSaved),
    }; });
  }

  async function measure(name, screenshot) {
    await settle(page);
    const value = await panel.evaluate(node => {
      const rect = el => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; };
      const list = node.querySelector('.lookupResults'), ref = node.querySelector('.lookupReference');
      return { panel: rect(node), query: rect(node.querySelector('input')), clear: rect(node.querySelector('.clearSearch') || node.querySelector('.sideSearchRow button')),
        results: rect(list), reference: rect(ref), pagination: rect(node.querySelector('.lookupPagination')),
        filters: node.querySelector('#editorLookupFilters')?.getBoundingClientRect().height || 0,
        overflow: [node, list, ref, ...node.querySelectorAll('.lookupText, .lookupControls')].map(el => el.scrollWidth - el.clientWidth),
        viewport: { width: innerWidth, height: innerHeight } };
    });
    measurements.push({ name, ...value });
    if (!baseline) {
      assert.ok(Math.abs(value.results.height - value.reference.height) <= 1, name + ': panes share height equally: ' + JSON.stringify(value));
      assert.ok(value.results.height >= 35 && value.reference.height >= 35, name + ': both panes remain usable: ' + JSON.stringify(value));
      assert.ok(value.pagination.height <= 34, name + ': compact pagination');
      assert.ok(value.query.width >= 60 && value.clear.width >= 30, name + ': input and Clear stay usable');
      assert.ok(value.query.top >= value.panel.top && value.query.bottom <= value.results.top && value.clear.bottom <= value.results.top,
        name + ': query and Clear remain above both scrolling panes');
      assert.ok(value.reference.bottom <= value.panel.bottom + 1 && value.results.bottom <= value.reference.top + 1, name + ': no pane overlap');
      assert.ok(value.overflow.every(x => x <= 1), name + ': no horizontal clipping in Lookup: ' + JSON.stringify(value));
    }
    if (screenshot) await page.screenshot({ path: join(directory, name + '.png') });
    return value;
  }

  for (const mode of ['sd', 'clienttext']) for (const inline of [false, true]) {
    const variant = mode + '-' + (inline ? 'inline' : 'full');
    if (process.env.SDEDITOR_LOOKUP_VARIANT && process.env.SDEDITOR_LOOKUP_VARIANT !== variant) continue;
    await page.evaluate(variant => { window.lookupStage = variant + '/configure'; }, variant);
    await configure(mode, inline);
    if (!baseline) {
      assert.equal(await clear.isVisible(), true); assert.equal(await clear.isDisabled(), true);
      assert.equal(await filters.isVisible(), false); assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      assert.equal(await page.getByRole('button', { name: 'Expand Lookup', exact: true }).count(), 0);
    }
    await applyQuery(query, 23); await results.locator('.lookupResult').first().click();
    if (baseline) { await measure('baseline-' + variant, true); continue; }
    const retained = await snapshot();
    await page.evaluate(variant => { window.lookupStage = variant + '/controls'; }, variant);
    for (let i = 0; i < 6; i++) { await toggle.click(); await filters.waitFor(); await toggle.click(); await filters.waitFor({ state: 'hidden' }); }
    assert.deepEqual(await snapshot(), retained, variant + ': repeated filter toggles preserve state');
    await toggle.focus(); await page.keyboard.press('Enter'); await filters.waitFor(); await page.keyboard.press('Tab');
    assert.equal(await filters.getByRole('combobox', { name: 'Content mode', exact: true }).evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Escape'); await filters.waitFor({ state: 'hidden' });
    await page.keyboard.press('Space'); await filters.waitFor();
    await page.evaluate(() => {
      const h = window.__sharedFixtureApp, aborter = new AbortController();
      window.lookupPreparationSignal = aborter.signal; h._lookupPreparationAbort = aborter; h.lookupPreparing = true;
    });
    await filters.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(await page.evaluate(() => window.lookupPreparationSignal.aborted && !window.__sharedFixtureApp.lookupPreparing), true);
    await page.evaluate(() => { window.__sharedFixtureApp.lookupPreparationError = 'Synthetic unavailable reference. '.repeat(40); });
    await measure(variant + '-preparation-notice', true);
    await page.evaluate(() => { window.__sharedFixtureApp.lookupPreparationError = ''; });
    await toggle.click(); await filters.waitFor({ state: 'hidden' });
    await page.mouse.move(0, 0); await search.focus();
    await toggle.hover(); await page.getByRole('tooltip').getByText('Lookup filters', { exact: true }).waitFor();
    await page.keyboard.press('Escape'); // The shared Tooltip dismisses first, per the main search convention.
    await toggle.click(); await filters.waitFor();
    await choose('Search in', 'english');
    await applyQuery('SOURCE-SENTINEL', 23);
    await choose('Search in', 'translation'); await waitCount(0);
    await choose('Search in', 'all'); await waitCount(23);
    await applyQuery(query, 23);
    await filters.getByRole('checkbox', { name: 'Only with translation' }).check(); await waitCount(22);
    await filters.getByRole('checkbox', { name: 'Only with translation' }).uncheck(); await waitCount(23);
    await choose('Content mode', mode === 'sd' ? 'clienttext' : 'statdescription'); await waitCount(0);
    await choose('Content mode', 'all'); await waitCount(23);
    await page.evaluate(() => { window.__sharedFixtureApp.lookupCatalogGroups = [{ id: 'synthetic-empty-group', label: 'Synthetic empty group' }]; });
    await choose('Content group', 'synthetic-empty-group'); await waitCount(0);
    await choose('Content group', ''); await waitCount(23);
    await choose('Reference language', mode === 'sd' ? 'French' : 'Thai');
    await waitCount(23); await results.locator('.lookupResult').first().click();
    assert.equal(await page.evaluate(() => window.__sharedFixtureApp.lookupSelectedReference.lang), mode === 'sd' ? 'French' : 'Thai');
    await choose('Reference language', ''); await waitCount(23);
    await filters.getByRole('combobox', { name: 'Search in', exact: true }).focus();
    await page.keyboard.press('Escape'); await filters.waitFor({ state: 'hidden' });
    assert.equal(await search.inputValue(), query); assert.equal(await toggle.evaluate(el => el === document.activeElement), true);
    await next.click(); await page.waitForFunction(() => window.__sharedFixtureApp.lookupCurrentPage === 2);
    assert.equal(await results.evaluate(el => el === document.activeElement), true, variant + ': last-page focus remains in Lookup');
    assert.equal(await results.locator('.lookupResult').count(), 3); assert.equal(await next.isDisabled(), true);
    await results.locator('.lookupResult').last().click();
    assert.equal(await reference.getByRole('button', { name: /^Copy Thai text/ }).first().isDisabled(), true, variant + ': empty text cannot be copied');
    await previous.click(); await page.waitForFunction(() => window.__sharedFixtureApp.lookupCurrentPage === 1);
    assert.equal(await results.evaluate(el => el === document.activeElement), true, variant + ': first-page focus remains in Lookup');
    await results.locator('.lookupResult').first().click();
    await reference.getByRole('button', { name: /^Copy English text/ }).first().click();
    assert.equal(await page.evaluate(() => window.lookupCopied), await page.evaluate(() => window.__sharedFixtureApp.lookupSelectedReference.blocks[0].english));
    if (mode === 'clienttext') assert.match(await page.evaluate(() => window.lookupCopied), /\r\nliteral\\n @ <img>$/);
    await page.evaluate(() => { window.lookupCopyDenied = true; });
    await reference.getByRole('button', { name: /^Copy Thai text/ }).first().click();
    await panel.getByText('Copy unavailable. Select the text and use your copy shortcut.').waitFor();
    await page.evaluate(() => { window.lookupCopyDenied = false; });
    await reference.getByRole('button', { name: /^Copy Thai text/ }).first().click();
    const copied = await page.evaluate(() => window.lookupCopied);
    assert.equal(copied, await page.evaluate(() => window.lookupSynthetic.target));
    const beforeKeys = await snapshot();
    await page.evaluate(variant => { window.lookupStage = variant + '/keyboard'; }, variant);
    await search.focus(); await page.keyboard.press('Control+s'); await page.keyboard.press('F2');
    await page.keyboard.press('Control+f'); assert.equal(await search.evaluate(el => el === document.activeElement), true);
    assert.deepEqual(await snapshot(), beforeKeys, variant + ': keyboard controls retain source, saved text and drafts');
    assert.deepEqual(await page.evaluate(() => window.lookupSaveAttempts), [], variant + ': Lookup never calls Save');
    await clear.click(); await waitCount(0); assert.equal(await search.inputValue(), ''); assert.equal(await search.evaluate(el => el === document.activeElement), true);
    await applyQuery(query, 23); await results.locator('.lookupResult').first().click();
    await page.evaluate(() => { window.__sharedFixtureApp.lookupCopyStatus = ''; });
    await page.evaluate(variant => { window.lookupStage = variant + '/layouts'; }, variant);
    for (const theme of ['light', 'grey', 'dark', 'modern-dark']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      for (const size of [{ width: 1440, height: 900 }, { width: 1000, height: 700 }, { width: 800, height: 600 }, { width: 720, height: 640 }, { width: 1000, height: 500 }]) {
        await page.setViewportSize(size);
        const name = variant + '-' + theme + '-' + size.width + 'x' + size.height;
        await measure(name, size.width === 1440 || theme === 'dark');
        await toggle.click(); await filters.waitFor();
        await filters.getByRole('checkbox', { name: 'Only with translation' }).focus();
        await measure(name + '-filters', theme === 'dark' && size.width === 1000 && size.height === 500);
        await page.keyboard.press('Escape'); await filters.waitFor({ state: 'hidden' });
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    const beforeScroll = await reference.evaluate(el => el.scrollTop);
    const listBox = await results.boundingBox(); await page.mouse.move(listBox.x + listBox.width / 2, listBox.y + listBox.height / 2);
    await page.mouse.wheel(0, 10000); await settle(page);
    assert.ok(await results.evaluate(el => el.scrollTop > 0 && el.querySelector('.lookupResult:last-of-type').getBoundingClientRect().bottom <= el.getBoundingClientRect().bottom));
    assert.equal(await reference.evaluate(el => el.scrollTop), beforeScroll, variant + ': results scroll independently');
    const end = await reference.evaluate(el => {
      el.scrollTop = el.scrollHeight; const text = [...el.querySelectorAll('.lookupText')].at(-1).firstChild;
      const range = document.createRange(); range.setStart(text, text.length - 'TRANSLATION END'.length); range.setEnd(text, text.length);
      const r = range.getBoundingClientRect(), box = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, refTop: box.top, refBottom: box.bottom };
    });
    assert.ok(end.top >= end.refTop && end.bottom <= end.refBottom, variant + ': final translation line is reachable');
    const y = (end.top + end.bottom) / 2; await page.mouse.move(end.left + 1, y); await page.mouse.down();
    await page.mouse.move(end.right - 1, y, { steps: 8 }); await page.mouse.up();
    assert.match(await page.evaluate(() => getSelection().toString()), /TRANSLATION EN/);
    await page.screenshot({ path: join(directory, variant + '-bottom-selection.png') });
    await toggle.click(); await filters.waitFor();
    await page.evaluate(() => { const h = window.__sharedFixtureApp; if (h.ctActive) h.ctTool = 'dictionary'; else h.sideTab = 'dictionary'; });
    await panel.waitFor({ state: 'hidden' });
    await page.evaluate(() => window.__sharedFixtureApp.openEditorLookup()); await panel.waitFor();
    assert.equal(await filters.isVisible(), false, variant + ': tool reopen starts with filters collapsed');
    assert.equal(await search.inputValue(), query);
    assert.equal(await page.evaluate(() => window.__sharedFixtureApp.editorBlocks[1].translation), 'Unsaved SD draft retained');
    if (mode === 'clienttext') assert.equal(await page.evaluate(() => window.__sharedFixtureApp.ctValues['lookup-field-0']), 'Unsaved CT draft retained');
  }
  assert.deepEqual(outgoing, []);
  if (!baseline) assert.deepEqual(await page.evaluate(() => window.lookupSaveAttempts), [], 'No Lookup interaction invokes Save');
  writeFileSync(join(directory, baseline ? 'baseline-measurements.json' : 'measurements.json'), JSON.stringify({
    browser: await page.context().browser().version(), measurements, outgoing,
    notes: ['All four real shared component hosts; synthetic references only.', 'Clipboard adapter captures full text without changing the OS clipboard.'] }, null, 2));
  console.log('PASS Lookup ' + (baseline ? 'released baseline capture' : 'filter bar: 4 variants, 4 themes, 5 viewports, repeated toggles, filter semantics, pagination, Copy, keyboard, independent scroll and final-line selection') + '.');
};
