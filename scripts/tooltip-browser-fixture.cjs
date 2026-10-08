// Disposable loopback-only layout check: real Vue, tooltip implementation and footer CSS.
// Optional --baseline <index.js> and --baseline-css <index.css> reproduce the old placement.
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const { createServer } = require('node:http');
const { tmpdir } = require('node:os');
const { randomUUID } = require('node:crypto');
const express = require('express');

const runtimeModules = 'C:/Users/lpeac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const playwright = require(process.env.PLAYWRIGHT_MODULE_PATH || require.resolve('playwright', { paths: [runtimeModules] }));
const executablePath = process.env.FIXTURE_BROWSER_PATH || [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(existsSync);
if (!executablePath) throw new Error('No installed Edge/Chrome found. Set FIXTURE_BROWSER_PATH; no browser download is needed.');

const publicDir = join(__dirname, '../public');
const option = name => {
  const at = process.argv.indexOf(name);
  if (at < 0) return null;
  if (!process.argv[at + 1]) throw new Error(name + ' requires a file path.');
  return process.argv[at + 1];
};
const source = readFileSync(option('--baseline') || join(publicDir, 'index.js'), 'utf8');
const css = readFileSync(option('--baseline-css') || join(publicDir, 'index.css'), 'utf8');
const between = (start, end) => {
  const first = source.indexOf(start), last = source.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, 'Fixture source markers must still exist: ' + start);
  return source.slice(first, last);
};
const component = between('const AppTooltip = {', 'function escapeTooltipAttr');
const methods = between('    normalizeTooltipText(value) {', '    htmlTooltipMouseMove(e) {');
const directive = between("app.directive('tooltip', {", "app.mount('#app');");
const versionLabel = readFileSync(join(publicDir, 'index.html'), 'utf8').split(/\r?\n/)
  .find(line => line.includes('v-else-if="managedStatusName"') && line.includes('versionStatusIdentity'));
assert.ok(versionLabel, 'Use the current workspace footer version label.');
const fixtureJs = `${component}
const managed = window.ManagedVersions.mixin;
const app = Vue.createApp({
  data() { return {
    tooltip: { visible: false, text: '', x: 0, y: 0, maxWidth: 360 },
    testMode: false, uiDensity: 'compact', branchId: 'default', lang: 'Thai', gameVersionLabel: 'PoE2',
    managedStatusName: '2026-10-05_POE2', managedStatusLocalVersion: null, managedStatusReminder: '',
    managedActiveVersion: { deadlineAt: '2026-10-11T20:00:00.000Z', status: 'published' },
    managedActiveTeam: null, collaborationExportHash: '1a2a6115f7807e0c95d0d4f537dac0d8fd3eb1f2c551d1e48d8ff14ee4d3f884',
    sourceIdentity: 'b8083c295bc4fe6e5728b33bba6ccd0c03533fc09c774182822d00b1dcc433b3'
  }; },
  computed: { managedStatusTooltip: managed.computed.managedStatusTooltip },
  methods: { ${methods}
    managedFormatDeadline: managed.methods.managedFormatDeadline,
    showVersionChooser() {}
  }
});
app.component('app-tooltip', AppTooltip);
${directive}
window.__tooltipFixture = app.mount('#app');`;

async function run() {
  const frontend = express(), server = createServer(frontend);
  frontend.get('/', (req, res) => res.type('html').send(`<!doctype html><html data-theme="dark"><head>
    <meta charset="utf-8"><link rel="stylesheet" href="/index.css"><link rel="stylesheet" href="/interface.css">
    <link rel="stylesheet" href="/managed-versions.css"></head><body>
    <div id="app"><div class="appRoot" :data-density="uiDensity">
      <main class="workspaceContent"><h1>Tooltip footer layout fixture</h1><button id="nextControl">Next control</button></main>
      <footer class="workspaceFooter"><div class="workspaceFooterSummary"><div class="workspaceStatus">
        <span v-if="false"></span>${versionLabel}
        <span class="workspaceLoaded"><strong>417</strong> loaded files</span>
        <span class="statusPill saved"><span class="statusDot"></span>Saved <strong>417</strong></span>
      </div></div></footer><app-tooltip :state="tooltip"></app-tooltip></div></div>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/vue/3.0.11/vue.global.prod.js"></script>
    <script src="/managedVersions.js"></script><script src="/fixture.js"></script></body></html>`));
  frontend.get('/index.css', (req, res) => res.type('css').send(css));
  frontend.get('/fixture.js', (req, res) => res.type('js').send(fixtureJs));
  frontend.use(express.static(publicDir));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  const results = [], errors = [];
  try {
    browser = await playwright.chromium.launch({ executablePath, headless: true, args: ['--disable-gpu'] });
    const context = await browser.newContext({ viewport: { width: 1000, height: 590 }, locale: 'en-US', timezoneId: 'Asia/Bangkok', ignoreHTTPSErrors: true });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.waitForFunction(() => !!window.__tooltipFixture);
    const label = page.locator('.workspaceStatus .versionStatusName');
    const tooltip = page.getByRole('tooltip');
    const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const checkBounds = async name => {
      await tooltip.waitFor(); await settle();
      const bounds = await tooltip.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const textRects = [...element.querySelectorAll('div')].flatMap(line => {
          const range = document.createRange(); range.selectNodeContents(line);
          return [...range.getClientRects()].map(rect => ({ top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }));
        });
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
          width: rect.width, height: rect.height, viewportWidth: innerWidth, viewportHeight: innerHeight,
          text: [...element.children].map(line => line.textContent).join('\n'), textRects };
      });
      assert.ok(bounds.left >= 7.5 && bounds.top >= 7.5 && bounds.right <= bounds.viewportWidth - 7.5
        && bounds.bottom <= bounds.viewportHeight - 7.5, name + ': tooltip border box cut off: ' + JSON.stringify(bounds));
      for (const rect of bounds.textRects) assert.ok(rect.top >= 0 && rect.bottom <= bounds.viewportHeight
        && rect.left >= 0 && rect.right <= bounds.viewportWidth, name + ': a wrapped text line is cut off.');
      assert.equal(bounds.text, await page.evaluate(() => window.__tooltipFixture.managedStatusTooltip), name + ': complete content');
      assert.match(bounds.text, /ZIP SHA-256: [a-f0-9]{64}\nSource baseline: [a-f0-9]{64}\nImport deadline: .*New Zealand.*local\nOpen source versions\./);
      results.push({ name, width: Math.round(bounds.width), height: Math.round(bounds.height), bottom: Math.round(bounds.bottom) });
    };
    for (const theme of ['light', 'grey', 'dark', 'modern-dark']) for (const density of ['compact', 'spacious']) {
      await page.evaluate(({ theme, density }) => {
        document.documentElement.setAttribute('data-theme', theme); window.__tooltipFixture.uiDensity = density;
      }, { theme, density });
      await label.hover(); await checkBounds(theme + '/' + density + ' mouse footer');
      await page.mouse.move(5, 5); await tooltip.waitFor({ state: 'detached' });
      await label.focus(); await checkBounds(theme + '/' + density + ' keyboard footer');
      await page.keyboard.press('Shift+Tab'); await tooltip.waitFor({ state: 'detached' });
    }
    // Keep keyboard focus and the pointer anchor stationary during viewport resize.
    await label.focus();
    for (const viewport of [{ width: 1440, height: 900 }, { width: 800, height: 450 }, { width: 740, height: 360 }]) {
      await page.setViewportSize(viewport); await checkBounds('visible resize ' + viewport.width + 'x' + viewport.height);
    }
    // The viewport corners exercise horizontal clamping beyond the footer's left alignment.
    for (const [x, y] of [[0, 0], [739, 0], [0, 359], [739, 359]]) {
      await page.evaluate(({ x, y }) => window.__tooltipFixture.showTooltip({ clientX: x, clientY: y }, window.__tooltipFixture.managedStatusTooltip), { x, y });
      await checkBounds('corner ' + x + ',' + y);
    }
    // ResizeObserver must also handle wrapping changes while an existing tooltip stays mounted.
    await page.evaluate(() => { window.__tooltipFixture.uiDensity = 'compact'; });
    await checkBounds('visible density compact');
    await page.evaluate(() => { window.__tooltipFixture.uiDensity = 'spacious'; });
    await checkBounds('visible density spacious');
    await page.evaluate(() => window.__tooltipFixture.showTooltip({ clientX: 730, clientY: 340 }, 'Short detail'));
    await settle();
    const shortWidth = (await tooltip.boundingBox()).width;
    await page.evaluate(() => window.__tooltipFixture.showTooltip({ clientX: 730, clientY: 340 }, window.__tooltipFixture.managedStatusTooltip));
    await checkBounds('short to metadata at right edge');
    assert.ok((await tooltip.boundingBox()).width > shortWidth + 50, 'Long replacement content must expand beyond the measured short width.');
    await page.setViewportSize({ width: 800, height: 600 });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await label.hover(); await checkBounds('screenshot footer 800x600 spacious/dark');
    const screenshot = join(tmpdir(), 'sdeditor-tooltip-' + randomUUID() + '.png');
    await page.screenshot({ path: screenshot });
    assert.deepEqual(errors, [], 'No browser page errors');
    console.log(JSON.stringify({ passed: results.length, screenshot, results }, null, 2));
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
