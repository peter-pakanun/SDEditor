const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
function harness() {
  const installed = new Set(), loads = [], released = [], faces = [];
  const window = { document: { fonts: { add: face => installed.add(face), delete: face => installed.delete(face) } }, AbortController,
    FontFace: class { constructor(family, source, descriptors) { Object.assign(this, { family, source, descriptors }); faces.push(this); } async load() { return this; } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/previewFonts.js'), 'utf8'), { window });
  const app = { privateMediaAllowed: true, privateMediaContext: () => 'scope', privateMediaCurrent: context => context === 'scope',
    gamePreviewFontFamily: '"Fontin-SmallCaps-tr-TR", "Fontin", "OptimusPrincepsSemiBold-tr-TR", "Noto Serif", serif', gamePreviewSourceFontFamily: '"Fontin", serif',
    privateMediaLoad: async (url, kind, options) => { loads.push({ url, kind, options }); return { url: 'blob:synthetic', release: () => released.push(url) }; } };
  Object.assign(app, window.PreviewFonts.mixin.methods);
  return { app, installed, loads, released, faces };
}
test('private Turkish preview fonts include both exact variants and English styles, releasing every URL', async () => {
  const h = harness(); h.app.previewFontsRefresh(); await h.app._previewFontsReady;
  assert.deepEqual(h.loads.map(item => item.url), ['/fonts/Fontin-Regular.woff2', '/fonts/Fontin-Bold.woff2', '/fonts/Fontin-Italic.woff2', '/fonts/Fontin-SmallCaps-tr-TR.ttf', '/fonts/OptimusPrincepsSemiBold-tr-TR.ttf']);
  assert.equal(h.installed.size, 5); assert.equal(h.released.length, 5);
  assert.ok(h.faces.some(face => face.family === 'Fontin' && face.descriptors.style === 'italic'));
  h.app.previewFontsClear(); assert.equal(h.installed.size, 0); assert.ok(h.loads.every(item => item.options.signal.aborted));
});
test('signed-out and alternate-language translators request no fonts; stale decoding cannot install faces', async () => {
  const h = harness(); h.app.privateMediaAllowed = false; h.app.previewFontsRefresh(); assert.equal(h.loads.length, 0);
  h.app.privateMediaAllowed = true;
  let finish; h.app.privateMediaLoad = () => new Promise(resolve => { finish = resolve; });
  h.app.gamePreviewFontFamily = 'serif'; h.app.gamePreviewSourceFontFamily = '"Fontin Smallcaps"';
  h.app.previewFontsRefresh(); h.app.previewFontsClear(); finish({ url: 'blob:late', release: () => h.released.push('late') });
  await h.app._previewFontsReady; assert.equal(h.installed.size, 0); assert.deepEqual(h.released, ['late']);
});
test('font errors leave language fallback available and font overrides determine requested families', async () => {
  const h = harness(); h.app.gamePreviewFontFamily = '"Koruri Regular", "Noto Sans JP", serif'; h.app.gamePreviewSourceFontFamily = 'serif';
  h.app.privateMediaLoad = async (url) => { h.loads.push(url); throw new Error('offline'); };
  h.app.previewFontsRefresh(); await h.app._previewFontsReady;
  assert.deepEqual(h.loads, ['/fonts/Koruri-Regular.woff2']); assert.equal(h.installed.size, 0);
});
