'use strict';
const assert = require('node:assert/strict');
const { join } = require('node:path');

async function settle(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function previewSize(page) {
  return page.locator('.editorPreviewResizeHandle').evaluate(handle => ({
    height: handle.closest('.edit').querySelector('.editorPreviewPane').getBoundingClientRect().height,
    min: Number(handle.getAttribute('aria-valuemin')), max: Number(handle.getAttribute('aria-valuemax')),
    now: Number(handle.getAttribute('aria-valuenow')), cursor: getComputedStyle(handle).cursor,
    viewportHeight: innerHeight,
  }));
}

async function dragPreview(page, destinationY) {
  const box = await page.locator('.editorPreviewResizeHandle').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, destinationY, { steps: 8 });
  await page.mouse.up();
  await settle(page);
}

async function checkFullPreviewResize(page, mode) {
  const viewport = page.viewportSize(), ct = mode === 'clienttext';
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(async () => {
    const host = window.__sharedFixtureApp;
    window.__previewResizeSnapshot = { height: host.fullEditorPreviewHeight, saveSettings: host.saveSettings };
    host.saveSettings = async () => true;
    host.fullEditorPreviewHeight = null;
    await host.$nextTick();
  });
  try {
    const handle = page.locator('.editorPreviewResizeHandle');
    assert.equal(await handle.count(), 1, mode + ': full editor exposes one preview resize thumb');
    assert.equal(await handle.getAttribute('role'), 'separator', mode);
    assert.equal(await handle.getAttribute('aria-orientation'), 'horizontal', mode);
    assert.equal(await handle.getAttribute('tabindex'), '0', mode);
    await settle(page);
    const initial = await previewSize(page);
    assert.equal(await page.locator('.gamePreviewToolbar').count(), ct ? 0 : 1,
      mode + ': only the stacked SD full preview offers frame-size controls');
    if (ct) {
      const fills = await page.locator('.gamePreviewWindow').evaluateAll(frames => frames.map(frame => {
        const bounds = frame.getBoundingClientRect(), pane = frame.closest('.gamePreviewSourcePane, .gamePreviewTargetPane');
        return { width: bounds.width, availableWidth: pane.clientWidth, bottom: bounds.bottom,
          paneBottom: pane.getBoundingClientRect().bottom };
      }));
      for (const frame of fills) {
        assert.ok(Math.abs(frame.width - frame.availableWidth) <= 2, 'Short ClientText preview fills its pane width');
        assert.ok(Math.abs(frame.bottom - frame.paneBottom) <= 2, 'Short ClientText preview fills its pane height below the label');
      }
    }
    assert.match(initial.cursor, /^(row|ns)-resize$/, mode + ': pointer communicates vertical resizing');
    assert.ok(initial.min > 0 && initial.min < initial.height, mode + ': preview can shrink below its default height: ' + JSON.stringify(initial));
    assert.ok(Math.abs(initial.max - 450) <= 2, mode + ': maximum preview height is half the viewport');
    const originalBox = await handle.boundingBox();
    await dragPreview(page, originalBox.y + originalBox.height / 2 + 70);
    const larger = await previewSize(page);
    assert.ok(larger.height > initial.height + 50, mode + ': genuine pointer drag increases the preview height');
    assert.ok(Math.abs(larger.height - larger.now) <= 2, mode + ': separator announces its visible height');
    await dragPreview(page, 1);
    let size = await previewSize(page);
    assert.ok(Math.abs(size.height - size.min) <= 2, mode + ': pointer drag respects minimum height');
    await dragPreview(page, 899);
    size = await previewSize(page);
    assert.ok(Math.abs(size.height - size.max) <= 2, mode + ': pointer capture keeps dragging beyond the handle and respects half-screen maximum');

    await handle.focus(); await handle.press('Home');
    size = await previewSize(page);
    assert.ok(Math.abs(size.height - size.min) <= 2, mode + ': Home reaches minimum height');
    await handle.press('ArrowDown');
    const down = await previewSize(page);
    assert.ok(down.height > size.height, mode + ': ArrowDown increases the preview height');
    await handle.press('ArrowUp');
    assert.ok(Math.abs((await previewSize(page)).height - size.height) <= 2, mode + ': ArrowUp reverses one resize step');
    await handle.press('End');
    const maximum = await previewSize(page);
    assert.ok(Math.abs(maximum.height - maximum.max) <= 2, mode + ': End reaches maximum height');
    const preferredMaximum = await page.evaluate(() => window.__sharedFixtureApp.fullEditorPreviewHeight);
    await page.setViewportSize({ width: 1440, height: 700 }); await settle(page);
    const smallerWindow = await previewSize(page);
    assert.ok(smallerWindow.height <= 352 && smallerWindow.height >= smallerWindow.min - 2,
      mode + ': a shorter desktop window clamps the pane to half its current height');
    assert.equal(await page.evaluate(() => window.__sharedFixtureApp.fullEditorPreviewHeight), preferredMaximum,
      mode + ': resizing the desktop window preserves the user preference');
    await page.setViewportSize({ width: 1440, height: 900 }); await settle(page);
    assert.ok(Math.abs((await previewSize(page)).height - maximum.height) <= 2,
      mode + ': restoring the window restores the preferred preview height');

    await handle.press('ArrowUp'); await handle.press('ArrowUp');
    const remembered = (await previewSize(page)).height;
    await page.evaluate(async ct => {
      const host = window.__sharedFixtureApp;
      if (ct) host.ctEditor = false; else host.editorVisible = false;
      await host.$nextTick();
      if (ct) host.ctEditor = true; else host.editorVisible = true;
      await host.$nextTick();
    }, ct);
    await page.waitForSelector('.editorPreviewResizeHandle'); await settle(page);
    assert.ok(Math.abs((await previewSize(page)).height - remembered) <= 2,
      mode + ': closing and reopening the full editor retains the resized height');
    if (!ct) {
      assert.equal(await page.locator('.gamePreviewStrip--split').count(), 0, 'SD previews retain the stacked layout');
      const frames = await page.locator('.gamePreviewWindow').evaluateAll(nodes => nodes.map(node => {
        const rect = node.getBoundingClientRect(); return { top: rect.top, left: rect.left };
      }));
      assert.ok(frames.length > 1 && frames[1].top > frames[0].top,
        'SD source and translation previews remain top/bottom in full editor');
    }
    await page.screenshot({ path: join(__dirname, '../temp/sdeditor-preview-resize-' + mode + '.png') });
  } finally {
    await page.evaluate(async () => {
      const host = window.__sharedFixtureApp, saved = window.__previewResizeSnapshot;
      host.fullEditorPreviewHeight = saved.height; await host.$nextTick();
      host.saveSettings = saved.saveSettings; delete window.__previewResizeSnapshot;
    });
    if (viewport) await page.setViewportSize(viewport);
  }
  console.log(mode + ' full-preview pointer/keyboard resize, height limits, window clamp and reopened preference passed.');
}

async function paneGeometry(page) {
  return page.locator('.gamePreviewFramesColumn').evaluate(column => {
    const box = node => { const rect = node.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom,
      left: rect.left, right: rect.right, width: rect.width, height: rect.height }; };
    return Object.fromEntries(['source', 'target'].map(key => {
      const node = column.querySelector('.gamePreview' + (key === 'source' ? 'Source' : 'Target') + 'Pane');
      return [key, { ...box(node), scrollTop: node.scrollTop, scrollHeight: node.scrollHeight,
        clientHeight: node.clientHeight, overflowY: getComputedStyle(node).overflowY }];
    }));
  });
}

async function checkStatDescriptionPreviewScroll(page) {
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(async () => {
    const host = window.__sharedFixtureApp, index = host.editorBlocks.findIndex(block => !block.isTable), block = host.editorBlocks[index];
    window.__sdPreviewScrollSnapshot = { index, english: block.english, translation: block.translation, focused: host.editorFocusedIndex,
      hideSource: host.hideSourceInPreviewPanel, height: host.fullEditorPreviewHeight, saveSettings: host.saveSettings };
    host.saveSettings = async () => true;
    block.english = Array.from({ length: 50 }, (_, index) => 'English preview line ' + index).join('\n');
    block.translation = Array.from({ length: 50 }, (_, index) => 'Translation preview line ' + index).join('\n');
    host.editorFocusedIndex = index; host.hideSourceInPreviewPanel = false; host.fullEditorPreviewHeight = 280;
    host.refreshGamePreview(); await host.$nextTick();
  });
  try {
    const before = await paneGeometry(page);
    assert.equal(await page.locator('.gamePreviewStrip--split').count(), 0, 'SD full preview keeps the top/bottom layout');
    assert.ok(before.target.top >= before.source.bottom - 2, 'SD translation pane stays below English');
    for (const pane of Object.values(before)) {
      assert.equal(pane.overflowY, 'auto', 'SD full preview panes own independent scrollbars');
      assert.ok(pane.scrollHeight > pane.clientHeight * 2, 'SD fixture has overflowing source and translation');
    }
    await page.mouse.move(before.source.left + before.source.width / 2, before.source.top + before.source.height / 2);
    await page.mouse.wheel(0, 480);
    await page.waitForFunction(() => document.querySelector('.gamePreviewSourcePane').scrollTop > 100);
    const sourceScrolled = await paneGeometry(page);
    assert.equal(sourceScrolled.target.scrollTop, 0, 'SD source wheel scroll leaves translation at its own position');
    await page.mouse.move(before.target.left + before.target.width / 2, before.target.top + before.target.height / 2);
    await page.mouse.wheel(0, 20000);
    await page.waitForFunction(() => { const pane = document.querySelector('.gamePreviewTargetPane');
      return pane.scrollTop >= pane.scrollHeight - pane.clientHeight - 2; });
    const targetScrolled = await paneGeometry(page);
    assert.equal(targetScrolled.source.scrollTop, sourceScrolled.source.scrollTop, 'SD translation wheel scroll leaves English at its own position');
    await page.evaluate(() => {
      for (const pane of document.querySelectorAll('.gamePreviewSourcePane, .gamePreviewTargetPane')) pane.scrollTop = 0;
    });
    await settle(page);
    await page.screenshot({ path: join(__dirname, '../temp/sdeditor-preview-statdescription-stacked.png') });
  } finally {
    await page.evaluate(async () => {
      const host = window.__sharedFixtureApp, saved = window.__sdPreviewScrollSnapshot, block = host.editorBlocks[saved.index];
      block.english = saved.english; block.translation = saved.translation; host.editorFocusedIndex = saved.focused;
      host.hideSourceInPreviewPanel = saved.hideSource; host.fullEditorPreviewHeight = saved.height;
      host.refreshGamePreview(); await host.$nextTick(); host.saveSettings = saved.saveSettings; delete window.__sdPreviewScrollSnapshot;
    });
    if (viewport) await page.setViewportSize(viewport);
  }
  console.log('SD full preview keeps stacked English/translation with independent real wheel scrolling.');
}

async function checkClientTextPreviewSplit(page) {
  const viewport = page.viewportSize();
  await page.evaluate(async () => {
    const host = window.__sharedFixtureApp, unit = host.ctCurrentUnit, field = host.ctPreviewField;
    window.__previewSplitSnapshot = { units: host.ctUnits, index: host._ctUnitIndex, values: host.ctValues,
      workspace: host.ctWorkspace, hideSource: host.hideSourceInPreviewPanel, height: host.fullEditorPreviewHeight,
      saveSettings: host.saveSettings, theme: document.documentElement.getAttribute('data-theme') };
    host.saveSettings = async () => true;
    const source = Array.from({ length: 50 }, (_, index) => 'English preview line ' + index).join('\n');
    const target = Array.from({ length: 50 }, (_, index) => 'Translation preview line ' + index).join('\n')
      + '\n<if:possessive>{Possessive ending}';
    const replacement = Vue.markRaw({ ...unit, fields: unit.fields.map(item => item.id === field.id ? { ...item, source, target } : item) });
    host.ctWorkspace = { ...host.ctWorkspace, scope: { ...host.ctWorkspace.scope, language: 'Turkish' } };
    host._ctUnitIndex = Vue.markRaw(new Map([[replacement.id, replacement]])); host.ctUnits = Vue.markRaw([replacement]);
    host.ctValues = { ...host.ctValues, [field.id]: target }; host.hideSourceInPreviewPanel = false;
    host.fullEditorPreviewHeight = 260;
    await host.$nextTick();
  });
  try {
    assert.equal(await page.locator('.gamePreviewStrip--split').count(), 1, 'ClientText full preview uses the split layout');
    assert.equal(await page.locator('.gamePreviewSourcePane .gamePreviewWindow').count(), 1, 'English stays in its own pane');
    assert.equal(await page.locator('.gamePreviewTargetPane .gamePreviewWindow').count(), 3, 'all three Turkish target variants share the translation pane');
    assert.deepEqual(await page.locator('.gamePreviewWindow').evaluateAll(nodes => nodes.map(node => node.closest('.gamePreviewSourcePane') ? 'EN' : 'TL')),
      ['EN', 'TL', 'TL', 'TL'], 'preview DOM order remains English followed by all target variants');
    for (const theme of ['light', 'grey', 'dark', 'modern-dark']) for (const width of [1920, 1440, 1000]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(theme => {
        document.documentElement.setAttribute('data-theme', theme);
        for (const pane of document.querySelectorAll('.gamePreviewSourcePane, .gamePreviewTargetPane')) pane.scrollTop = 0;
      }, theme);
      await settle(page);
      const before = await paneGeometry(page), message = 'ClientText preview ' + theme + '/' + width;
      assert.ok(Math.abs(before.source.top - before.target.top) <= 2 && Math.abs(before.source.height - before.target.height) <= 2,
        message + ': English and translation occupy parallel columns');
      assert.ok(before.target.left >= before.source.right - 2, message + ': English is left of translation');
      assert.ok(await page.locator('.gamePreviewWindow').evaluateAll(frames => frames.every(frame =>
        Math.abs(frame.getBoundingClientRect().width - frame.closest('.gamePreviewLine').clientWidth) <= 2)),
      message + ': preview frames fill the pane width regardless of saved frame size');
      for (const pane of Object.values(before)) {
        assert.equal(pane.overflowY, 'auto', message + ': each pane owns a vertical scrollbar');
        assert.ok(pane.scrollHeight > pane.clientHeight * 2, message + ': fixture has substantial overflowing preview content');
      }
      await page.mouse.move(before.source.left + before.source.width / 2, before.source.top + before.source.height / 2);
      await page.mouse.wheel(0, 480);
      await page.waitForFunction(() => document.querySelector('.gamePreviewSourcePane').scrollTop > 100);
      const sourceScrolled = await paneGeometry(page);
      assert.equal(sourceScrolled.target.scrollTop, 0, message + ': wheeling English leaves the translation scroll untouched');
      await page.mouse.move(before.target.left + before.target.width / 2, before.target.top + before.target.height / 2);
      await page.mouse.wheel(0, 20000);
      await page.waitForFunction(() => { const pane = document.querySelector('.gamePreviewTargetPane');
        return pane.scrollTop >= pane.scrollHeight - pane.clientHeight - 2; });
      const targetScrolled = await paneGeometry(page);
      assert.equal(targetScrolled.source.scrollTop, sourceScrolled.source.scrollTop,
        message + ': wheeling the translation leaves English at its own position');
      const last = await page.locator('.gamePreviewTargetPane [data-preview-variant="both"]').boundingBox();
      assert.ok(last.y + last.height <= targetScrolled.target.bottom + 2,
        message + ': translation scrollbar reaches the final target variant');
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => {
      for (const pane of document.querySelectorAll('.gamePreviewSourcePane, .gamePreviewTargetPane')) pane.scrollTop = 0;
    });
    await settle(page);
    await page.screenshot({ path: join(__dirname, '../temp/sdeditor-preview-clienttext-split.png') });
  } finally {
    await page.evaluate(async () => {
      const host = window.__sharedFixtureApp, saved = window.__previewSplitSnapshot;
      host._ctUnitIndex = saved.index; host.ctUnits = saved.units; host.ctValues = saved.values; host.ctWorkspace = saved.workspace;
      host.hideSourceInPreviewPanel = saved.hideSource; host.fullEditorPreviewHeight = saved.height;
      document.documentElement.setAttribute('data-theme', saved.theme); await host.$nextTick();
      host.saveSettings = saved.saveSettings; delete window.__previewSplitSnapshot;
    });
    if (viewport) await page.setViewportSize(viewport);
  }
  console.log('ClientText full preview left/right geometry, full pane sizing and independent real wheel scrolling, including all three target variants, passed in four themes and three desktop widths.');
}

async function checkInlinePreviewLayout(page) {
  assert.equal(await page.locator('.editorPreviewResizeHandle').count(), 0, 'inline editor has no full-preview resize handle');
  assert.equal(await page.locator('.gamePreviewStrip--split').count(), 0, 'inline preview retains its stacked layout');
  const frames = await page.locator('#inlineEditorPreviewHost .gamePreviewWindow').evaluateAll(nodes => nodes.map(node => {
    const rect = node.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom };
  }));
  assert.equal(frames.length, 2, 'inline English and translation remain present');
  assert.ok(frames[1].top >= frames[0].bottom - 2, 'inline English and translation remain top/bottom');
  console.log('Inline previews retain their stacked layout and omit the full-editor resize handle.');
}

module.exports = { checkFullPreviewResize, checkStatDescriptionPreviewScroll, checkClientTextPreviewSplit, checkInlinePreviewLayout };
