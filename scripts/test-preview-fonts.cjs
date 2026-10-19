const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
function harness({ load = async face => face } = {}) {
  const installed = new Set(), faces = [], calls = [];
  const window = { CloudUI: { apiBase: () => 'https://fonts.example.test' },
    document: { fonts: { add: face => installed.add(face), delete: face => installed.delete(face) } },
    FontFace: class { constructor(family, source, descriptors) { Object.assign(this, { family, source, descriptors }); faces.push(this); } async load() { calls.push(this.source); return load(this); } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/previewFonts.js'), 'utf8'), { window });
  const app = { cloudSignedIn: false, privateMediaAllowed: false,
    privateMediaLoad() { throw new Error('Public fonts must never use authenticated media'); },
    gamePreviewFontFamily: '"Fontin-SmallCaps-tr-TR", "Fontin", "OptimusPrincepsSemiBold-tr-TR", "Noto Serif", serif', gamePreviewSourceFontFamily: '"Fontin", serif' };
  Object.assign(app, window.PreviewFonts.mixin.methods);
  return { app, installed, faces, calls, mixin: window.PreviewFonts.mixin };
}
test('unsigned/local previews load both Turkish variants and English styles directly from public API URLs', async () => {
  const h = harness(); h.app.previewFontsRefresh(); await h.app._previewFontsReady;
  assert.equal(h.installed.size, 5); assert.equal(h.calls.length, 5);
  assert.ok(h.calls.some(url => url === 'url("https://fonts.example.test/fonts/Fontin-SmallCaps-tr-TR.ttf")'));
  assert.ok(h.calls.some(url => url === 'url("https://fonts.example.test/fonts/OptimusPrincepsSemiBold-tr-TR.ttf")'));
  assert.ok(h.faces.some(face => face.family === 'Fontin' && face.descriptors.style === 'italic'));
  assert.ok(h.calls.every(url => !/token|blob:|Authorization/.test(url)));
});
test('account/access changes do not affect public font selection or repeat native font loads', async () => {
  const h = harness(), key = h.mixin.computed.previewFontsKey.call(h.app);
  h.app.previewFontsRefresh(); await h.app._previewFontsReady;
  h.app.cloudSignedIn = true; h.app.privateMediaAllowed = true; h.app.privateMediaKey = 'another-account-language';
  assert.equal(h.mixin.computed.previewFontsKey.call(h.app), key);
  h.app.previewFontsRefresh(); await h.app._previewFontsReady;
  assert.equal(h.calls.length, 5, 'loaded faces are reused even without a new HTTP request');
});
test('a changed preview or unmount cannot install a late font; failed loads can retry online', async () => {
  let finish;
  const h = harness({ load: face => new Promise(resolve => { finish = () => resolve(face); }) });
  h.app.gamePreviewFontFamily = '"Fontin Smallcaps"'; h.app.gamePreviewSourceFontFamily = 'serif';
  h.app.previewFontsRefresh(); h.app.previewFontsClear(); finish();
  await h.app._previewFontsReady; assert.equal(h.installed.size, 0);
  const offline = harness({ load: async () => { throw new Error('offline'); } });
  offline.app.previewFontsRefresh(); await offline.app._previewFontsReady; assert.equal(offline.installed.size, 0);
  offline.app.previewFontsRefresh(); await offline.app._previewFontsReady; assert.equal(offline.calls.length, 10);
});
