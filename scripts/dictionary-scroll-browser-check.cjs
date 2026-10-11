'use strict';
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

async function settle(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function geometry(page, selector) {
  return page.locator(selector).evaluate(sidebar => {
    const aside = sidebar.closest('.inlineEditorSidebar'), host = sidebar.parentElement;
    const box = node => { const rect = node.getBoundingClientRect(); return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }; };
    const last = sidebar.querySelector('.dictionaryEntries > .editBlock:last-child'), header = sidebar.querySelector('.sideHeader');
    return { aside: box(aside), host: box(host), sidebar: box(sidebar), header: box(header), last: box(last),
      clientHeight: sidebar.clientHeight, scrollHeight: sidebar.scrollHeight, scrollTop: sidebar.scrollTop,
      scrollbarWidth: sidebar.offsetWidth - sidebar.clientWidth, hostStyle: { flex: getComputedStyle(host).flex, minHeight: getComputedStyle(host).minHeight, overflow: getComputedStyle(host).overflow },
      viewportHeight: innerHeight, entries: sidebar.querySelectorAll('.dictionaryEntries > .editBlock').length };
  });
}

async function checkInlineDictionaryScroll(page, mode, options = {}) {
  const ct = mode === 'clienttext', hostId = ct ? 'ctInlineEditorSidebarHost' : 'inlineEditorSidebarHost';
  const selector = '#' + hostId + ' > .sharedEditorSidebar';
  await page.evaluate(async ct => {
    const host = window.__sharedFixtureApp;
    window.__scrollFixtureDictionary = host.dictionary;
    window.__scrollFixtureSidebar = document.querySelector('.sharedEditorSidebar');
    window.__scrollFixtureFocusOut = host.inlineRowFocusOut;
    host.inlineRowFocusOut = () => {};
    host.dictionary = Array.from({ length: 40 }, (_, index) => ({ _id: 'scroll-' + index.toString().padStart(2, '0'), game: 'all',
      find: 'Scroll term ' + index.toString().padStart(2, '0'), replace: 'Translation ' + index, tlnote: 'Reachable Dictionary note ' + index,
      alts: [{ _id: 'scroll-alt-' + index, find: 'Alternate ' + index, replace: 'Alternative translation ' + index }] }));
    host.inlineEditor = true; host.inlineSidebarVisible = true;
    if (ct) { host.ctEditor = false; host.ctInlineClosed = false; host.ctTool = 'dictionary'; host.ctDictionaryFilter = ''; host.ctDictionaryPage = 1; }
    else { host.editorVisible = false; host.inlineActive = true; host.sideTab = 'dictionary'; host.dictionaryFilter = ''; host.dictionaryPage = 1; }
    await host.$nextTick();
  }, ct);
  await page.waitForSelector(selector + ' .dictionaryEntries > .editBlock:nth-child(40)');
  const results = [];
  try {
    if (options.negativeControl) {
      await page.evaluate(id => document.getElementById(id).classList.remove('inlineEditorSidebarHost'), hostId);
      await settle(page);
      const before = await geometry(page, selector);
      await page.mouse.move(before.aside.left + before.aside.width / 2, before.header.bottom + 40);
      await page.mouse.wheel(0, 1200); await settle(page);
      const after = await geometry(page, selector);
      assert.ok(before.sidebar.height > before.aside.height * 2, 'negative control recreates an unbounded ClientText tool host');
      assert.equal(after.scrollTop, 0, 'negative control cannot wheel-scroll the clipped Dictionary');
      console.log('Before-fix ClientText reproduction: ' + JSON.stringify({ asideHeight: before.aside.height, hostHeight: before.host.height,
        sidebarClientHeight: before.clientHeight, sidebarScrollHeight: before.scrollHeight, wheelScrollTop: after.scrollTop, hostStyle: before.hostStyle }));
      await page.screenshot({ path: join(tmpdir(), 'sdeditor-inline-dictionary-before.png') });
      await page.evaluate(id => document.getElementById(id).classList.add('inlineEditorSidebarHost'), hostId);
    }
    for (const theme of ['light', 'grey', 'dark', 'modern-dark']) for (const width of [1440, 1100, 1000]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(({ theme, selector }) => { document.documentElement.setAttribute('data-theme', theme); document.querySelector(selector).scrollTop = 0; }, { theme, selector });
      await settle(page);
      const before = await geometry(page, selector), label = mode + ' ' + theme + '/' + width;
      assert.ok(before.sidebar.height <= before.aside.height + 1, label + ': Dictionary viewport is bounded by the inline sidebar ' + JSON.stringify(before));
      assert.ok(before.host.height <= before.aside.height + 1, label + ': host fits inside the sidebar');
      assert.ok(before.scrollHeight > before.clientHeight * 2, label + ': fixture needs vertical scrolling');
      assert.ok(before.aside.bottom < before.viewportHeight, label + ': sidebar remains above the workspace footer');
      await page.mouse.move(before.sidebar.left + before.sidebar.width / 2, before.header.bottom + 40);
      await page.mouse.wheel(0, 640);
      await page.waitForFunction(selector => document.querySelector(selector).scrollTop > 100, selector, { timeout: 2000 });
      await page.mouse.wheel(0, 20000);
      await page.waitForFunction(selector => { const node = document.querySelector(selector); return node.scrollTop >= node.scrollHeight - node.clientHeight - 2; }, selector, { timeout: 2000 });
      let end = await geometry(page, selector);
      assert.ok(end.last.bottom <= end.sidebar.bottom + 1 && end.last.top >= end.header.bottom, label + ': wheel reaches the last Dictionary entry');

      await page.locator(selector).evaluate(sidebar => { sidebar.scrollTop = 0; }); await settle(page);
      const scrollbar = await geometry(page, selector), thumbHeight = Math.max(18, scrollbar.clientHeight ** 2 / scrollbar.scrollHeight);
      assert.ok(scrollbar.scrollbarWidth > 0, label + ': native scrollbar exists');
      const barX = scrollbar.sidebar.right - scrollbar.scrollbarWidth / 2;
      await page.mouse.move(barX, scrollbar.sidebar.top + thumbHeight / 2); await page.mouse.down();
      await page.mouse.move(barX, scrollbar.sidebar.bottom - 1, { steps: 8 }); await page.mouse.up();
      await page.waitForFunction(selector => { const node = document.querySelector(selector); return node.scrollTop >= node.scrollHeight - node.clientHeight - 2; }, selector, { timeout: 2000 });
      end = await geometry(page, selector);
      assert.ok(end.last.bottom <= end.sidebar.bottom + 1 && end.last.top >= end.header.bottom, label + ': dragging the scrollbar reaches the last entry');
      const replace = page.locator(selector + ' .dictionaryEntries > .editBlock:last-child .dictRow input[placeholder="Replace"]');
      await replace.click(); assert.equal(await replace.evaluate(input => input === document.activeElement), true, label + ': last entry remains editable');
      results.push({ mode, theme, width, viewportHeight: before.clientHeight, contentHeight: before.scrollHeight });
    }
    await page.screenshot({ path: join(tmpdir(), 'sdeditor-inline-dictionary-' + mode + '.png') });
    // The same mounted tool node carries its scroll position between surfaces.
    await page.locator(selector).evaluate(sidebar => { if (sidebar.contains(document.activeElement)) document.activeElement.blur(); });
    await settle(page);
    await page.locator(selector).evaluate(sidebar => { sidebar.scrollTop = 300; });
    assert.equal(await page.locator(selector).evaluate(node => node.scrollTop), 300, mode + ': pre-handoff scroll is captured');
    const opened = await page.evaluate(async ct => {
      const host = window.__sharedFixtureApp;
      if (ct) { const field = host.ctCurrentUnit.fields.find(field => field.id === host.ctFocusedField), input = host.ctTargetInputs().find(input => input.dataset.ctTarget === field.id); return host.ctOpenInlineFull(field, input); }
      return host.openInlineFullEditor(host.editorCurrentEditingDesc.filepath, '', { returnInline: true });
    }, ct);
    assert.equal(opened, true, mode + ': actual inline/full editor action opens successfully');
    await settle(page);
    assert.equal(await page.evaluate(() => document.querySelector('.sharedEditorSidebar') === window.__scrollFixtureSidebar), true, mode + ': full handoff retains the tools node');
    const fullScroll = await page.locator('.sharedEditorSidebar').evaluate(node => node.scrollTop);
    console.log(mode + ' Dictionary full handoff scroll: 300 → ' + fullScroll);
    if (options.requireScrollRetention) assert.equal(fullScroll, 300, mode + ': full handoff retains Dictionary scroll');
    const returned = await page.evaluate(async ct => { const host = window.__sharedFixtureApp; return ct ? host.ctCloseEditor() : host.editorExit({ returnInline: true }); }, ct);
    assert.equal(returned, true, mode + ': actual Escape/Close return action succeeds');
    await settle(page);
    const inlineScroll = await page.locator(selector).evaluate(node => node.scrollTop);
    assert.equal(await page.evaluate(() => document.querySelector('.sharedEditorSidebar') === window.__scrollFixtureSidebar), true, mode + ': inline return retains the tools node');
    console.log(mode + ' Dictionary inline return scroll: ' + inlineScroll);
    if (options.requireScrollRetention) assert.equal(inlineScroll, 300, mode + ': inline return retains Dictionary scroll');
    console.log('PASS ' + mode + ' inline Dictionary wheel, scrollbar, last-entry editing and retained handoff: ' + results.length + ' theme/width cases.');
    return results;
  } finally {
    await page.evaluate(async ({ ct, hostId }) => {
      document.getElementById(hostId)?.classList.add('inlineEditorSidebarHost');
      const host = window.__sharedFixtureApp;
      host.dictionary = window.__scrollFixtureDictionary; host.inlineRowFocusOut = window.__scrollFixtureFocusOut;
      if (ct) host.ctEditor = true; else { host.inlineActive = false; host.editorVisible = true; host.inlineEditor = false; }
      await host.$nextTick();
    }, { ct, hostId });
    await page.setViewportSize({ width: 1440, height: 900 });
  }
}

module.exports = { checkInlineDictionaryScroll };
