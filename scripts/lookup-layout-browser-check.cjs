'use strict';
// Real app + native dialog; synthetic references only. No API, inference or account data.
const assert = require('node:assert/strict');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const settle = page => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));

async function checkLookupLayout({ page, directory }) {
  mkdirSync(directory, { recursive: true });
  const measurements = [], outgoing = [];
  await page.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.hostname !== '127.0.0.1') { outgoing.push(url.origin); return route.abort(); }
    if (!['GET', 'HEAD'].includes(request.method())) { outgoing.push(request.method() + ' ' + url.pathname); return route.abort(); }
    return route.continue();
  });
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      async writeText(text) { if (window.__lookupCopyDenied) throw Error('Synthetic clipboard failure'); window.__lookupCopied = text; },
    } });
  });
  const longText = await page.evaluate(async () => {
    const host = window.__sharedFixtureApp;
    const source = 'LOOKUP LONG SOURCE\n' + 'Source <img> @ literal\\n ภาษาไทย. '.repeat(250)
      + '\n' + 'UNBROKEN'.repeat(140) + '\nSOURCE END';
    const target = 'LOOKUP LONG TRANSLATION\n' + 'Translation ภาษาไทย 漢字 @ <tag>. '.repeat(300)
      + '\n' + 'TARGETTOKEN'.repeat(140) + '\nTRANSLATION END';
    window.__lookupLongText = { source, target };
    host.descs = [...host.descs, ...Array.from({ length: 23 }, (_, index) => ({
      filepath: 'synthetic/LOOKUP-LONG-REFERENCE-' + index + '.txt', filename: 'LOOKUP-LONG-REFERENCE-' + index + '.txt',
      filedir: 'synthetic', stats: ['synthetic_stat_' + index],
      translations: { English: [source, 'Empty translation reference', source], Thai: [target, '', target] },
    }))];
    host.editorBlocks[1].translation = 'Unsaved draft retained during Lookup';
    host.openEditorLookup(); await host.$nextTick();
    return { source: source.replace(/\\n/g, '\n'), target };
  });

  const dialog = page.getByRole('dialog', { name: 'Lookup', exact: true });
  const search = page.getByRole('searchbox', { name: 'Search reference files' });
  const expand = page.getByRole('button', { name: 'Expand Lookup', exact: true });
  const selected = page.getByRole('region', { name: 'Selected reference', exact: true });
  await search.fill('LOOKUP-LONG-REFERENCE');
  await page.locator('.lookupResult').first().click();
  if (process.env.SDEDITOR_LOOKUP_BASELINE === '1') {
    await page.screenshot({ path: join(directory, 'released-sidebar-long-text.png') });
    const baseline = await selected.evaluate(node => {
      const box = node.getBoundingClientRect();
      return { width: box.width, height: box.height, scrollHeight: node.scrollHeight, textLength: node.textContent.length };
    });
    writeFileSync(join(directory, 'released-sidebar-measurements.json'), JSON.stringify(baseline, null, 2));
    console.log('PASS released Lookup synthetic reproduction captured: ' + JSON.stringify(baseline));
    return;
  }
  const retained = await page.evaluate(() => {
    const h = window.__sharedFixtureApp;
    return { query: h.lookupQuery, selected: h.lookupSelectedFilepath, draft: JSON.stringify(h.editorBlocks),
      source: JSON.stringify(h.descs), saved: JSON.stringify(h.localDescs) };
  });
  await page.screenshot({ path: join(directory, 'sidebar-long-text.png') });
  await expand.click();
  await dialog.waitFor();
  assert.equal(await search.evaluate(node => document.activeElement === node), true, 'Expand focuses the search box');
  const expandedWidth = await dialog.evaluate(node => node.getBoundingClientRect().width);
  assert.ok(expandedWidth > 1000, 'Expansion reclaims the desktop width');
  await page.screenshot({ path: join(directory, 'sd-expanded-overview.png') });
  const list = page.getByLabel('Reference search results', { exact: true });
  const listBox = await list.boundingBox();
  await page.mouse.move(listBox.x + listBox.width / 2, listBox.y + listBox.height / 2);
  await page.mouse.wheel(0, 10000); await settle(page);
  assert.ok(await list.evaluate(node => node.scrollTop > 0 && node.querySelector('.lookupResult:last-of-type').getBoundingClientRect().bottom <= node.getBoundingClientRect().bottom),
    'Wheel scrolling reaches the final result without scrolling the reference');
  assert.equal(await selected.evaluate(node => node.scrollTop), 0);
  await list.evaluate(node => { node.scrollTop = 0; });
  await dialog.getByRole('button', { name: 'Copy English text, Block 1', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__lookupCopied), longText.source, 'SD Copy uses the full displayed reference');
  await dialog.getByRole('button', { name: 'Copy Thai text, Block 1', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__lookupCopied), longText.target);
  assert.equal(await dialog.getByRole('button', { name: 'Copy Thai text, Block 2', exact: true }).isDisabled(), true);
  await page.evaluate(() => { window.__lookupCopyDenied = true; });
  await dialog.getByRole('button', { name: 'Copy English text, Block 1', exact: true }).click();
  await dialog.getByText('Copy unavailable. Select the text and use your copy shortcut.').waitFor();
  await page.evaluate(() => { window.__lookupCopyDenied = false; });
  await dialog.getByRole('button', { name: 'Copy Thai text, Block 1', exact: true }).click();

  // Native modal Tab behavior must contain focus, including Shift+Tab wrapping.
  const close = dialog.getByRole('button', { name: 'Close Lookup', exact: true });
  await close.focus(); await page.keyboard.press('Shift+Tab');
  assert.equal(await dialog.evaluate(node => node.contains(document.activeElement)), true);
  await page.keyboard.press('Tab');
  assert.equal(await close.evaluate(node => document.activeElement === node), true);
  await page.keyboard.press('Control+s'); await page.keyboard.press('F2');
  assert.equal(await dialog.isVisible(), true);

  async function measure(name, screenshot) {
    await selected.evaluate(node => {
      node.scrollTop = node.scrollHeight;
      const last = node.querySelector('.lookupReferenceBlock:last-of-type .lookupTextPair > section:last-child .lookupText');
      // The two language columns can have different heights. Bring the final
      // translation line into view without scrolling an ancestor/dialog header.
      node.scrollTop += last.getBoundingClientRect().bottom - node.getBoundingClientRect().bottom + 12;
    });
    await settle(page);
    const geometry = await dialog.evaluate(node => {
      const rect = element => { const r = element.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
      const reference = node.querySelector('.lookupReference'), last = reference.querySelector('.lookupReferenceBlock:last-of-type .lookupTextPair > section:last-child .lookupText');
      const text = last.firstChild, end = document.createRange(); end.setStart(text, text.length - 'TRANSLATION END'.length); end.setEnd(text, text.length);
      return { dialog: rect(node), reference: rect(reference), end: rect(end), close: rect(node.querySelector('.lookupDialogHeading button')),
        overflow: [...node.querySelectorAll('.lookupBody, .lookupReference, .lookupText, .lookupControls')].map(el => el.scrollWidth - el.clientWidth),
        viewport: { width: innerWidth, height: innerHeight }, scroll: { top: reference.scrollTop, height: reference.scrollHeight, client: reference.clientHeight } };
    });
    assert.ok(geometry.dialog.left >= 0 && geometry.dialog.top >= 0 && geometry.dialog.right <= geometry.viewport.width
      && geometry.dialog.bottom <= geometry.viewport.height, name + ': dialog stays in viewport');
    assert.ok(geometry.reference.height >= 70, name + ': selected text keeps useful height: ' + JSON.stringify(geometry));
    assert.ok(geometry.end.top >= geometry.reference.top && geometry.end.bottom <= geometry.reference.bottom
      && geometry.end.right <= geometry.reference.right && geometry.end.left >= geometry.reference.left,
      name + ': final bottom-right line is reachable: ' + JSON.stringify(geometry));
    assert.ok(geometry.overflow.every(value => value <= 1), name + ': long tokens wrap without horizontal clipping');
    assert.ok(geometry.close.bottom <= geometry.dialog.bottom && geometry.close.right <= geometry.dialog.right, name + ': close control remains reachable');
    measurements.push({ name, ...geometry });
    if (screenshot) await page.screenshot({ path: join(directory, name + '.png') });
    return geometry;
  }

  for (const theme of ['light', 'grey', 'dark', 'modern-dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    for (const size of [{ width: 1440, height: 900 }, { width: 1000, height: 700 }, { width: 640, height: 500 },
      { width: 360, height: 640 }, { width: 720, height: 450 }]) {
      await page.setViewportSize(size); await settle(page);
      const name = 'sd-' + theme + '-' + size.width + 'x' + size.height;
      if (size.width <= 720) {
        const next = dialog.getByRole('button', { name: 'Next reference results' });
        await close.focus();
        await next.focus();
        assert.ok(await next.evaluate(node => {
          const box = node.getBoundingClientRect(), controls = node.closest('.lookupControls').getBoundingClientRect();
          return box.top >= controls.top && box.bottom <= controls.bottom;
        }), name + ': keyboard focus reveals controls below the short search area');
      }
      await measure(name, size.width === 1440 || theme === 'dark');
    }
  }
  // Real pointer selection of the final line, at the bottom of the reference scroller.
  await page.setViewportSize({ width: 1440, height: 900 });
  const geometry = await measure('sd-pointer-selection', false);
  const y = (geometry.end.top + geometry.end.bottom) / 2;
  await page.mouse.move(geometry.end.left + 1, y); await page.mouse.down();
  await page.mouse.move(geometry.end.right - 1, y, { steps: 10 }); await page.mouse.up();
  assert.match(await page.evaluate(() => getSelection().toString()), /TRANSLATION EN/);
  await page.screenshot({ path: join(directory, 'sd-bottom-right-selection.png') });
  await page.mouse.move(geometry.end.left + 1, y); await page.mouse.down();
  await page.mouse.move(geometry.end.left + 20, 899, { steps: 10 }); await page.mouse.up();
  assert.equal(await dialog.isVisible(), true, 'Dragging a text selection outside the dialog never closes the editor');
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
  assert.equal(await expand.evaluate(node => node === document.activeElement), true, 'Close returns focus to Expand Lookup');
  const after = await page.evaluate(() => {
    const h = window.__sharedFixtureApp;
    return { query: h.lookupQuery, selected: h.lookupSelectedFilepath, draft: JSON.stringify(h.editorBlocks), source: JSON.stringify(h.descs), saved: JSON.stringify(h.localDescs) };
  });
  assert.deepEqual(after, retained, 'Expand, copy, shortcuts and close preserve source, saved data, query, selection and the unsaved draft');
  await expand.click(); await close.click(); await dialog.waitFor({ state: 'hidden' });
  assert.equal(await expand.evaluate(node => node === document.activeElement), true);
  await page.evaluate(async () => {
    const h = window.__sharedFixtureApp; h.inlineEditor = true; h.inlineSidebarVisible = true; h.editorVisible = false; await h.$nextTick();
  });
  await expand.click(); await dialog.waitFor(); await measure('sd-inline-expanded', true);
  await close.click(); await dialog.waitFor({ state: 'hidden' });

  // Reuse the production ClientText controller with a synthetic literal field.
  const literal = await page.evaluate(async () => {
    const h = window.__sharedFixtureApp; h.editorVisible = false; h.inlineEditor = false;
    const { source, target } = window.__lookupLongText;
    const field = { id: 'lookup-literal', name: 'Text', kind: 'text', source: source + '\r\nliteral\\n @ <img>', target: target,
      targetCell: 'B2', required: true, originalMissing: false, outdated: false };
    const unit = Vue.markRaw({ id: 'normal|Sheet|lookup', role: 'normal', sheet: 'Sheet', recordId: 'LOOKUP-LONG-REFERENCE', fields: [field],
      developerNotes: 'Synthetic developer notes', metadata: { Context: 'Synthetic only' }, notes: [] });
    h.ctWorkspace = { scope: { accountId: 'guest', game: 'poe2', branchId: 'default', versionId: 'fixture', groupId: 'local:fixture', language: 'Thai' },
      metadata: { version: { name: 'Synthetic Lookup' }, descriptors: [{ role: 'normal', baselineId: 'a'.repeat(64) }] } };
    h.ctUnits = Vue.markRaw([unit]); h._ctUnitIndex = Vue.markRaw(new Map([[unit.id, unit]])); h._ctWorkUnits = Vue.markRaw(new Map());
    h.ctSelection = unit.id; h.ctFocusedField = field.id; h.ctValues = { [field.id]: 'Unsaved literal draft' };
    h.ctSaved = {}; h.ctReviewed = {}; h.ctEditor = true; h.ctActive = true; h.ctInitializing = false; h.ctBusy = false;
    h.ctQueueDraft = () => {}; h.ctFlushDraft = async () => true; h.ctQueueCommentDraft = () => {};
    h.ctFlushCommentDraft = async () => {}; h.ctLoadComments = async () => {}; h.ctTool = 'lookup';
    h.lookupQuery = 'LOOKUP-LONG-REFERENCE'; h.lookupAppliedQuery = ''; h.lookupSelectedFilepath = '';
    await h.$nextTick(); await h.lookupLoadCatalog(); h.lookupApplySearch(); await h.$nextTick();
    return field.source;
  });
  await page.locator('.lookupResult').first().click(); await expand.click(); await dialog.waitFor();
  await dialog.getByRole('button', { name: /Copy English text/ }).click();
  assert.equal(await page.evaluate(() => window.__lookupCopied), literal, 'ClientText copy retains literal backslash-n, CRLF, tags and @');
  for (const theme of ['light', 'grey', 'dark', 'modern-dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await measure('clienttext-' + theme + '-1440x900', true);
  }
  await close.click(); await dialog.waitFor({ state: 'hidden' });
  await page.evaluate(async () => {
    const h = window.__sharedFixtureApp; h.inlineEditor = true; h.inlineSidebarVisible = true; h.ctEditor = false; h.ctInlineClosed = false;
    h.ctSelectedFilters = ['unchanged', 'missing', 'saved', 'outdated']; await h.$nextTick();
  });
  await expand.click(); await dialog.waitFor(); await measure('clienttext-inline-expanded', true);
  await page.evaluate(() => { window.__sharedFixtureApp.ctTool = 'dictionary'; });
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => window.__sharedFixtureApp.ctValues['lookup-literal']), 'Unsaved literal draft');
  assert.deepEqual(outgoing, [], 'Layout checks make no external or mutation requests');
  writeFileSync(join(directory, 'measurements.json'), JSON.stringify({ browser: await page.context().browser().version(),
    notes: ['720x450 is the CSS viewport available when a 1440x900 desktop is zoomed to 200%.', 'Clipboard adapter captures exact arguments without touching the user clipboard.'],
    measurements, outgoing }, null, 2));
  console.log('PASS Lookup expansion: 4 themes, narrow/short windows, 200% equivalent reflow, native modal focus, bottom-right pointer selection, exact copy/failure, safe close, CT full/inline and retained drafts.');
}
module.exports = checkLookupLayout;
