'use strict';
// Actual app, shared inline/full preview, parser and app-owned overlay in a
// disposable Edge/Chrome profile. No production accounts or storage are used.
const assert = require('node:assert/strict');
const { readFileSync, existsSync, mkdirSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { createServer } = require('node:http');
const express = require('express');
const modules = 'C:/Users/lpeac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || require.resolve('playwright', { paths: [modules] }));
const executablePath = process.env.FIXTURE_BROWSER_PATH || ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const root = resolve(__dirname, '..'), folder = join(root, 'temp/keyword-popups-browser');
const app = express();
app.get('/index.js', (_req, res) => res.type('js').send(readFileSync(join(root, 'public/index.js'), 'utf8').replace("app.mount('#app');", "window.fixtureApp = app.mount('#app');")));
app.use(express.static(join(root, 'public')));
const server = createServer(app);
const settle = page => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
async function enterAdjacentCard(page, trigger, card) {
  const a = await trigger.boundingBox(), b = await card.boundingBox();
  let from, to;
  if (Math.abs(b.y - a.y - a.height) < 1) {
    const x = Math.max(b.x + 2, Math.min(a.x + a.width / 2, b.x + b.width - 2));
    from = [x, a.y + a.height - 1]; to = [x, b.y + 2];
  } else if (Math.abs(b.y + b.height - a.y) < 1) {
    const x = Math.max(b.x + 2, Math.min(a.x + a.width / 2, b.x + b.width - 2));
    from = [x, a.y + 1]; to = [x, b.y + b.height - 2];
  } else if (Math.abs(b.x - a.x - a.width) < 1) {
    const y = Math.max(b.y + 2, Math.min(a.y + a.height / 2, b.y + b.height - 2));
    from = [a.x + a.width - 1, y]; to = [b.x + 2, y];
  } else {
    assert.ok(Math.abs(b.x + b.width - a.x) < 1, 'card touches a keyword edge: ' + JSON.stringify({ a, b }));
    const y = Math.max(b.y + 2, Math.min(a.y + a.height / 2, b.y + b.height - 2));
    from = [a.x + 1, y]; to = [b.x + b.width - 2, y];
  }
  await page.mouse.move(...from); await page.mouse.move(...to, { steps: 5 });
  assert.equal(await card.count(), 1, 'crossing the touching edge retains the card without a timeout');
}
async function dragCard(page, card, x, y) {
  const box = await card.boundingBox(), header = await card.locator('.keywordPreviewHeader').boundingBox();
  const start = { x: header.x + header.width / 2, y: header.y + header.height / 2 };
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(start.x + x - box.x, start.y + y - box.y, { steps: 8 });
  await page.mouse.up(); await settle(page);
}
async function checkPointerBehavior(page, target, source, windows) {
  await target.hover(); await page.waitForSelector('.keywordPreviewWindow');
  await page.mouse.move(5, 5);
  assert.equal(await windows.count(), 0, 'unpinned popup disappears on the leave event, without waiting');
  await target.hover(); const parent = windows.first(), parentId = await parent.getAttribute('id');
  await enterAdjacentCard(page, target, parent);
  const keyword = parent.locator('.keywordPreviewContent .gamePreviewKw').first();
  await keyword.hover(); const child = windows.last(), childId = await child.getAttribute('id');
  assert.equal(await windows.count(), 2); await enterAdjacentCard(page, keyword, child);
  // Dragging a previously unpinned child pins it. Leaving the whole branch
  // immediately removes its unpinned parent, while the child remains independent.
  await dragCard(page, child, 350, 350); await page.mouse.move(5, 5);
  assert.equal(await page.locator('#' + parentId).count(), 0);
  assert.equal(await page.locator('#' + childId).count(), 1);
  assert.equal(await child.locator('.keywordPreviewClose').count(), 1);
  assert.equal(await child.evaluate(node => document.activeElement === node), true);
  assert.equal(await page.evaluate(() => String(getSelection())), '', 'header dragging never selects workbook text');
  await dragCard(page, child, -1000, -1000);
  let box = await child.boundingBox(); assert.equal(box.x, 8); assert.equal(box.y, 8);
  await dragCard(page, child, 3000, 3000);
  box = await child.boundingBox(); assert.ok(box.x + box.width <= 1432 && box.y + box.height <= 892);
  await page.keyboard.press('Escape'); assert.equal(await windows.count(), 0);
  assert.equal(await page.evaluate(() => fixtureApp.ctEditor), true);

  await target.hover(); await windows.first().locator('.keywordPreviewTitle').click();
  const pinnedParent = windows.first(), pinnedParentId = await pinnedParent.getAttribute('id');
  const coveredKeyword = pinnedParent.locator('.keywordPreviewContent .gamePreviewKw').first();
  await coveredKeyword.hover(); const covering = windows.last(), coveringId = await covering.getAttribute('id');
  // The top card must block both a lower card's keyword and a preview keyword.
  for (const trigger of [coveredKeyword, source]) {
    const a = await trigger.boundingBox(), point = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
    await dragCard(page, covering, point.x - 80, point.y - 40);
    await page.mouse.move(point.x, point.y);
    assert.equal(await page.evaluate(point => document.elementFromPoint(point.x, point.y)?.closest('[data-keyword-window]')?.id, point), coveringId);
    assert.equal(await windows.count(), 2, 'covered keyword cannot open a popup through the top card');
  }
  await page.keyboard.press('Escape'); assert.equal(await windows.count(), 1);
  assert.equal(await windows.first().getAttribute('id'), pinnedParentId);
  await windows.first().locator('.keywordPreviewClose').click(); assert.equal(await windows.count(), 0);

  // Removing a keyboard-focused child can expose background under the pointer.
  // Focus returns to its parent's keyword; the next real mouse departure still
  // dismisses the unpinned branch immediately.
  await page.setViewportSize({ width: 700, height: 650 }); await settle(page); await target.hover();
  const keyboardParent = windows.first(), keyboardParentId = await keyboardParent.getAttribute('id');
  const keyboardTrigger = keyboardParent.locator('.keywordPreviewContent .gamePreviewKw').first();
  await keyboardTrigger.hover(); const keyboardChild = windows.last();
  await keyboardChild.hover(); await keyboardChild.focus(); await page.keyboard.press('Escape'); await settle(page);
  assert.equal(await windows.count(), 1); assert.equal(await windows.first().getAttribute('id'), keyboardParentId);
  await page.mouse.move(5, 5); assert.equal(await windows.count(), 0);
  await page.setViewportSize({ width: 1440, height: 900 });

  // Pin and move the parent to each viewport edge, then verify that every child
  // is placed against its own keyword, including the left fallback at the right edge.
  for (const x of [8, 1052]) {
    await target.hover(); await windows.first().locator('.keywordPreviewTitle').click();
    const parent = windows.first(); await dragCard(page, parent, x, 250);
    const trigger = parent.locator('.keywordPreviewContent .gamePreviewKw').first();
    await trigger.hover(); const child = windows.last(); await enterAdjacentCard(page, trigger, child);
    const b = await child.boundingBox(); assert.ok(b.x >= 8 && b.x + b.width <= 1432 && b.y >= 8 && b.y + b.height <= 892);
    await page.mouse.move(5, 5); assert.equal(await windows.count(), 1, 'only the pinned parent remains after leaving');
    await windows.first().locator('.keywordPreviewClose').click();
  }
  for (const [y, side] of [[80, 'bottom'], [500, 'top']]) {
    await target.hover(); await windows.first().locator('.keywordPreviewTitle').click();
    const parent = windows.first(); await page.setViewportSize({ width: 700, height: 650 }); await settle(page);
    const trigger = parent.locator('.keywordPreviewContent .gamePreviewKw').first();
    const a = await trigger.boundingBox(), p = await parent.boundingBox();
    await dragCard(page, parent, 350 - (a.x + a.width / 2 - p.x), y);
    await trigger.hover(); const child = windows.last(); await enterAdjacentCard(page, trigger, child);
    const b = await child.boundingBox(), k = await trigger.boundingBox();
    assert.ok(Math.abs(side === 'bottom' ? b.y - k.y - k.height : b.y + b.height - k.y) < 1, 'nested ' + side + ' fallback touches keyword');
    await page.screenshot({ path: join(folder, 'nested-' + side + '.png') });
    await page.mouse.move(5, 5); assert.equal(await windows.count(), 1);
    await windows.first().locator('.keywordPreviewClose').click(); await page.setViewportSize({ width: 1440, height: 900 });
  }
}
(async () => {
  let browser;
  try {
    mkdirSync(folder, { recursive: true });
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    browser = await chromium.launch({ executablePath, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message)); page.on('console',message=>{if(message.type()==='error' && !message.text().includes('Failed to load resource')){errors.push(message.text());console.log('browser error',message.text());}});
    await page.route('https://**/*', route => {
      const url = route.request().url();
      if (url.includes('vue.global')) return route.fulfill({ contentType: 'text/javascript', body: readFileSync(process.env.FIXTURE_VUE_PATH || join(root, 'temp/clienttext-fixture-vue.min.js')) });
      if (url.includes('jszip.min')) return route.fulfill({ contentType: 'text/javascript', body: readFileSync(join(root, '../SDEditor-API/node_modules/jszip/dist/jszip.min.js')) });
      return route.fulfill({ contentType: 'text/javascript', body: '' });
    });
    await page.goto('http://127.0.0.1:' + server.address().port + '/?testMode=1&lang=Thai');
    await page.waitForFunction(() => window.fixtureApp?.startupReady);
    await page.evaluate(async () => {
      const host = window.fixtureApp;
      const field = (name, source, target) => ({ id: name, name, source, target, kind: 'text', required: true });
      const popup = (id, en, th, content, target) => ({ id, role: 'normal', sheet: 'KeywordPopups', recordId: id, metadata: {}, fields: [field('Info Title', en, th), field('Info Content', content, target)] });
      const units = [popup('Physical', 'Physical Damage', 'Thai Physical', 'English body [Armour] <b>{Bold} <img src=x onerror=alert(1)>', 'Thai body [Armour|Thai Armour]'),
        popup('Armour', 'English Armour', 'Thai Armour Title', 'English nested body [Physical]', 'Thai nested body [Physical|Thai Physical]'),
        popup('Blank', 'English must not leak', '', 'English must not leak either', ''),
        { id: 'dialogue', role: 'normal', sheet: 'NPCTextAudio', recordId: 'Dialogue', metadata: {}, fields: [field('Text', '[Physical] [Blank]', '[Physical|Thai Physical] [Blank|Thai Blank]')] }];
      host.ctWorkspace = { metadata: {}, scope: { accountId: 'guest', game: 'poe1', language: 'Thai', branchId: 'default', groupId: 'local:test:keyword', versionId: 'local:test:keyword' } };
      host.ctUnits = Vue.markRaw(units); host._ctUnitIndex = Vue.markRaw(new Map(units.map(unit => [unit.id, unit])));
      window.fixtureKeywordSources = [{ mode: 'clienttext', units, saved: {}, scope: { ...host.ctWorkspace.scope } }];
      host.ctSelection = 'dialogue'; host.ctFocusedField = 'Text'; host.ctValues = { Text: units[3].fields[0].target };
      host.ctSheet = JSON.stringify(['normal', 'NPCTextAudio']); host.ctTool = 'preview'; host.ctActive = true; host.inlineEditor = true; host.ctEditor = true;
      host.versionChooserVisible = false; host.showSetting = false; host.ctRevision++;
      await host.$nextTick();
    });
    await settle(page);
    const source = page.locator('.gamePreviewSourcePane .gamePreviewKw').first();
    const target = page.locator('.gamePreviewTargetPane .gamePreviewKw').first();
    const windows = page.locator('.keywordPreviewWindow');
    await checkPointerBehavior(page, target, source, windows);
    await target.hover(); await page.waitForSelector('.keywordPreviewWindow');
    assert.equal(await windows.locator('.keywordPreviewTitle').innerText(), 'Thai Physical');
    assert.match(await windows.locator('.keywordPreviewContent').innerText(), /^Thai body/);
    const parentId = await windows.getAttribute('id');
    await windows.locator('.keywordPreviewContent .gamePreviewKw').hover();
    await page.waitForFunction(() => document.querySelectorAll('.keywordPreviewWindow').length === 2);
    const nested = windows.last();
    assert.equal(await nested.locator('.keywordPreviewTitle').innerText(), 'Thai Armour Title');
    await nested.hover(); await page.waitForTimeout(600);
    assert.equal(await windows.count(), 2, 'nested hover retains its unpinned ancestor');
    await nested.locator('.keywordPreviewTitle').click();
    assert.equal(await nested.locator('.keywordPreviewClose').count(), 1, 'clicking content pins its popup');
    await page.keyboard.press('Escape');
    assert.equal(await windows.count(), 1, 'Escape closes only the focused child');
    assert.equal(await page.evaluate(() => fixtureApp.ctEditor), true, 'Escape never reaches the full editor');
    // Focus restored to the parent keyword must not immediately reopen the child.
    await page.waitForTimeout(80); assert.equal(await windows.count(), 1);
    await page.locator('#' + parentId + ' .keywordPreviewTitle').click();
    await source.hover(); await page.waitForFunction(() => document.querySelectorAll('.keywordPreviewWindow').length === 2);
    const englishId = await windows.last().getAttribute('id');
    assert.equal(await page.locator('#' + englishId + ' .keywordPreviewTitle').innerText(), 'Physical Damage');
    assert.match(await page.locator('#' + englishId + ' .keywordPreviewContent').innerText(), /^English body/);
    assert.equal(await windows.locator('img,script').count(), 0, 'workbook HTML never becomes DOM');
    await page.locator('#' + englishId + ' .keywordPreviewTitle').click();
    await page.locator('#' + parentId + ' .keywordPreviewTitle').click();
    assert.equal(await windows.last().getAttribute('id'), parentId, 'most recently clicked window comes forward');
    await page.keyboard.press('Escape');
    assert.equal(await windows.count(), 1); assert.equal(await windows.getAttribute('id'), englishId);
    await page.locator('.gamePreviewTargetPane .gamePreviewKw').nth(1).focus();
    await page.keyboard.press('Enter'); await settle(page);
    assert.match(await windows.last().innerText(), /Missing Thai translation/);
    assert.doesNotMatch(await windows.last().innerText(), /English must not leak/);
    await page.keyboard.press('Escape');
    // Exiting full editor and selecting another record retains pinned windows.
    await page.evaluate(async () => {
      fixtureApp.ctEditor = false; await fixtureApp.$nextTick();
      fixtureApp.ctSelection = 'Armour'; fixtureApp.ctValues = { 'Info Title': 'New file title', 'Info Content': 'New file body' }; await fixtureApp.$nextTick();
    });
    assert.equal(await windows.count(), 1); assert.match(await windows.innerText(), /English body/);
    await windows.locator('.keywordPreviewContent .gamePreviewKw').first().hover();
    assert.equal(await windows.last().locator('.keywordPreviewTitle').innerText(), 'English Armour', 'nested lookup retains the original English context');
    await windows.last().locator('.keywordPreviewTitle').click();
    // Inline preview opens translated records as well.
    await page.evaluate(async () => {
      fixtureApp.ctSelection = 'dialogue'; fixtureApp.ctValues = { Text: '[Physical|Thai inline]' }; await fixtureApp.$nextTick();
    });
    const inlineTarget = page.locator('#inlineEditorPreviewHost .gamePreviewTargetPane .gamePreviewKw').first();
    await inlineTarget.focus(); await page.keyboard.press('Space'); await settle(page);
    assert.equal(await windows.last().locator('.keywordPreviewTitle').innerText(), 'Thai Physical');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => fixtureApp.ctActive), true, 'Escape does not end the inline editor');
    // A new game/language/source cannot retarget an already pinned branch.
    await page.evaluate(async () => {
      fixtureApp.ctWorkspace.scope = { ...fixtureApp.ctWorkspace.scope, game: 'poe2', language: 'German', versionId: 'next' };
      fixtureApp.ctUnits = []; fixtureApp.ctRevision++; await fixtureApp.$nextTick();
    });
    const oldChild = page.locator('.keywordPreviewWindow').filter({ hasText: 'English nested body' });
    await oldChild.locator('.gamePreviewKw').hover(); await settle(page);
    assert.equal(await windows.last().locator('.keywordPreviewTitle').innerText(), 'Physical Damage');
    assert.equal(await windows.last().getAttribute('data-language'), 'English');
    await page.mouse.move(5, 640); await page.waitForTimeout(550);
    // Exercise the same shared triggers in StatDescription, using a read-only
    // verified-reference adapter response rather than another workbook import.
    while (await windows.count()) await windows.last().locator('.keywordPreviewClose').click();
    await page.evaluate(async () => {
      const host = fixtureApp; host.ctActive = false; host.ctWorkspace = null;
      host._keywordCatalog = { load: async () => ({ sources: window.fixtureKeywordSources }), dispose() {} };
      const desc = host.descs.find(desc => desc.translations.English?.length && !desc.isDNT);
      await host.openEditorFile(desc.filepath);
      host.editorBlocks[0].english = '[Physical]'; host.editorBlocks[0].translation = '[Physical|Thai SD]';
      host.refreshGamePreview();
      host.sideTab = 'preview'; await host.$nextTick();
    });
    await page.locator('.gamePreviewTargetPane .gamePreviewKw').first().focus(); await page.keyboard.press('Enter'); await settle(page);
    assert.equal(await windows.last().locator('.keywordPreviewTitle').innerText(), 'Thai Physical');
    await page.keyboard.press('Escape'); assert.equal(await page.evaluate(() => fixtureApp.editorVisible), true);
    await page.locator('.gamePreviewSourcePane .gamePreviewKw').first().focus(); await page.keyboard.press('Enter'); await settle(page);
    assert.equal(await windows.last().locator('.keywordPreviewTitle').innerText(), 'Physical Damage');
    await page.evaluate(async () => { fixtureApp.editorVisible = false; fixtureApp.inlineActive = true; await fixtureApp.$nextTick(); });
    assert.equal(await windows.count(), 1, 'SD pinned popup survives full-to-inline transition');
    await page.locator('#inlineEditorPreviewHost .gamePreviewTargetPane .gamePreviewKw').first().focus(); await page.keyboard.press('Space'); await settle(page);
    assert.equal(await windows.last().locator('.keywordPreviewTitle').innerText(), 'Thai Physical');
    await page.keyboard.press('Escape'); assert.equal(await page.evaluate(() => fixtureApp.inlineActive), true);
    await windows.locator('.keywordPreviewContent .gamePreviewKw').first().hover(); await settle(page);
    await windows.last().locator('.keywordPreviewTitle').click();
    for (const theme of ['light', 'grey', 'dark', 'modern-dark']) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      await page.setViewportSize({ width: 900, height: 650 }); await settle(page);
      const bounds = await windows.evaluateAll(items => items.map(item => {
        const rect = item.getBoundingClientRect(), style = getComputedStyle(item);
        return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, bg: style.backgroundColor, opacity: style.opacity };
      }));
      for (const rect of bounds) { assert.ok(rect.x >= 7 && rect.y >= 7 && rect.right <= 893 && rect.bottom <= 643, JSON.stringify(rect)); assert.match(rect.bg, /0\.7\)/); assert.equal(rect.opacity, '1'); }
      await page.screenshot({ path: join(folder, theme + '.png') });
    }
    await windows.last().locator('.keywordPreviewClose').click();
    // Long pinned content must remain scrollable and fully reachable after a
    // resized desktop viewport becomes shorter than the original card.
    await page.evaluate(async () => {
      const item = fixtureApp.keywordWindows[0];
      item.content = Array.from({ length: 100 }, (_, i) => [{ type: 'text', text: 'Long popup line ' + i }, { type: 'break' }]).flat();
      await fixtureApp.$nextTick();
    });
    await page.setViewportSize({ width: 700, height: 350 }); await settle(page);
    const long = await windows.first().evaluate(node => ({ bottom: node.getBoundingClientRect().bottom, scrollable: node.scrollHeight > node.clientHeight }));
    assert.ok(long.bottom <= 342 && long.scrollable, 'tall pinned card stays within resized viewport and scrolls');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ browser: executablePath, checks: 'immediate dismissal, contiguous root/nested pointer paths, hover blocking over cards and previews, captured header drag/pin/clamping, nested edge placement, translation/source, pin/close/focus/z-order, Escape isolation, file/game/language/source lifetime, SD and ClientText inline/full, safe markup, all themes, viewport bounds', screenshots: folder }));
  } finally {
    await browser?.close(); await new Promise(done => { server.close(done); server.closeAllConnections(); });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
