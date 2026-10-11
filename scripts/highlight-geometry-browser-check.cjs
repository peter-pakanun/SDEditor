'use strict';
const assert = require('node:assert/strict');

// Compare every visible glyph in the annotated DOM with a plain-text native
// control mirror. This catches wrapping changes introduced by highlight spans,
// padding/font drift, scrollbar width and scrolling in the real browser.
async function checkHighlightGeometry(page, selector, label) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const results = await page.locator(selector).evaluateAll(inputs => inputs.map(input => {
    const overlay = input.parentElement.querySelector('.HLter'), content = overlay?.querySelector('.editorHighlightContent');
    if (!content) return { field: input.dataset.ctTarget || input.dataset.ctSource || input.dataset.editorRef, error: 'No measured highlight content' };
    const style = getComputedStyle(input), rect = input.getBoundingClientRect(), overlayRect = overlay.getBoundingClientRect();
    const px = value => parseFloat(value) || 0;
    const left = rect.left + px(style.borderLeftWidth), top = rect.top + px(style.borderTopWidth);
    const width = rect.width - px(style.borderLeftWidth) - px(style.borderRightWidth)
      - Math.max(0, input.offsetWidth - input.clientWidth - px(style.borderLeftWidth) - px(style.borderRightWidth));
    const height = rect.height - px(style.borderTopWidth) - px(style.borderBottomWidth)
      - Math.max(0, input.offsetHeight - input.clientHeight - px(style.borderTopWidth) - px(style.borderBottomWidth));
    const mirror = document.createElement('div'), text = document.createElement('div');
    Object.assign(mirror.style, { position: 'fixed', left: left + 'px', top: top + 'px', width: width + 'px', height: height + 'px',
      padding: style.padding, border: 'none', margin: '0', boxSizing: 'border-box', overflow: 'hidden', pointerEvents: 'none', visibility: 'hidden',
      font: style.font, letterSpacing: style.letterSpacing, wordSpacing: style.wordSpacing, textIndent: style.textIndent,
      textAlign: style.textAlign, direction: style.direction, tabSize: style.tabSize,
      whiteSpace: input.tagName === 'TEXTAREA' ? style.whiteSpace : 'pre', overflowWrap: style.overflowWrap, wordBreak: style.wordBreak });
    text.style.transform = `translate(${-input.scrollLeft}px, ${-input.scrollTop}px)`;
    text.textContent = input.value; mirror.append(text); document.body.append(mirror);
    const characters = root => {
      const output = [], append = element => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT); let node;
        while ((node = walker.nextNode())) for (let offset = 0; offset < node.length; offset++) {
          const char = node.data[offset]; if (char === '\u200b') continue;
          const range = document.createRange(); range.setStart(node, offset); range.setEnd(node, offset + 1);
          const box = range.getBoundingClientRect(); output.push({ char, x: box.x, y: box.y, width: box.width });
        }
      };
      const lines = [...root.children].filter(element => element.classList.contains('hlLine'));
      if (lines.length) lines.forEach((line, index) => { if (index) output.push({ char: '\n' }); append(line); });
      else append(root);
      return output;
    };
    const actual = characters(content), expected = characters(text), mismatches = [];
    for (let index = 0; index < Math.min(actual.length, expected.length); index++) {
      if (/\s/.test(expected[index].char)) continue;
      const a = actual[index], e = expected[index];
      if (a.char !== e.char || Math.abs(a.x - e.x) > 0.6 || Math.abs(a.y - e.y) > 0.6 || Math.abs(a.width - e.width) > 0.6)
        mismatches.push({ index, char: e.char, actual: [a.x, a.y, a.width], expected: [e.x, e.y, e.width] });
    }
    mirror.remove();
    return { field: input.dataset.ctTarget || input.dataset.ctSource || input.dataset.editorRef,
      actualText: actual.map(item => item.char).join(''), expectedText: input.value,
      viewport: { actual: [overlayRect.left, overlayRect.top, overlayRect.width, overlayRect.height], expected: [left, top, width, height] },
      scroll: { native: [input.scrollLeft, input.scrollTop], transform: content.style.transform },
      mismatches: mismatches.slice(0, 5), glyphs: expected.filter(item => !/\s/.test(item.char)).length };
  }));
  assert.ok(results.length, label + ': fields exist');
  for (const result of results) {
    assert.equal(result.error, undefined, label + ': ' + result.field);
    assert.equal(result.actualText, result.expectedText, label + ': raw highlight text ' + result.field);
    for (let index = 0; index < 4; index++) assert.ok(Math.abs(result.viewport.actual[index] - result.viewport.expected[index]) < 0.6,
      label + ': native viewport ' + result.field + ' ' + JSON.stringify(result.viewport));
    assert.deepEqual(result.mismatches, [], label + ': glyph alignment ' + result.field + ' ' + JSON.stringify(result.mismatches));
    assert.equal(result.scroll.transform, `translate(${-result.scroll.native[0]}px, ${-result.scroll.native[1]}px)`, label + ': native scroll ' + result.field);
  }
  return results.reduce((count, result) => count + result.glyphs, 0);
}

module.exports = { checkHighlightGeometry };
