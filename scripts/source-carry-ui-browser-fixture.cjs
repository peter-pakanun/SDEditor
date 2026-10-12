// Disposable desktop rendering/keyboard checks. Persistence is covered by
// normalized-storage-browser-fixture.cjs; this fixture uses test-mode UI only.
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { readFileSync, existsSync, mkdtempSync, rmSync } = require('node:fs');
const { resolve, join, extname, basename, sep } = require('node:path');
const { tmpdir } = require('node:os');
const runtime = 'C:/Users/lpeac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || require.resolve('playwright', { paths: [runtime] }));
const executablePath = process.env.FIXTURE_BROWSER_PATH || ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);

async function run() {
    const publicDir = resolve(__dirname, '../public'), directory = mkdtempSync(join(tmpdir(), 'sdeditor-carry-ui-'));
    const server = createServer((req, res) => {
        const pathname = decodeURIComponent(new URL(req.url, 'http://fixture').pathname);
        const file = resolve(publicDir, '.' + (pathname === '/' ? '/index.html' : pathname));
        if (!file.startsWith(publicDir + sep) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(file)] || 'application/octet-stream');
        const content = readFileSync(file);
        res.end(pathname === '/index.js' ? content.toString().replace("app.mount('#app');", "window.__carryApp = app.mount('#app');") : content);
    });
    let browser;
    try {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        browser = await chromium.launch({ executablePath, headless: true });
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true }), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto('http://127.0.0.1:' + server.address().port + '/?testMode=1&lang=Thai');
        await page.waitForFunction(() => window.__carryApp?.sourceLoaded);
        const prepared = await page.evaluate(async () => {
            const app = window.__carryApp, copy = value => JSON.parse(JSON.stringify(value));
            const old = { filepath: 'carry/metadata.txt', filename: 'metadata.txt', filedir: 'carry', stats: ['fixture_stat'],
                variables: ['#'], remarks: ['old_keyword'], translations: { English: ['Damage'], Thai: ['ความเสียหาย'], German: ['Schaden'] } };
            const next = copy(old); next.variables = ['# #']; next.remarks = ['new_keyword'];
            const workspace = { game: app.gameVersion, sourceHash: 'carry-ui-before', descs: [] };
            WorkspaceState.initializeWorkspace(workspace, { source: [old], sourceHash: workspace.sourceHash, game: app.gameVersion, language: 'Thai' });
            for (const language of ['Thai', 'German']) WorkspaceState.stageTranslation(workspace,
                { filepath: old.filepath, translations: old.translations[language] }, language, { source: old, savedAt: 1, saveOrigin: 'save' });
            WorkspaceState.upgradeSource(workspace, { previousSource: [old], source: [next], previousSourceHash: 'carry-ui-before',
                sourceHash: 'carry-ui-after', game: app.gameVersion, language: 'Thai' });
            app._workspaceSourceBaseline = [copy(next)]; app.sourceIdentity = 'carry-ui-after'; app.localDescs = workspace;
            app.descs = [copy(next)]; app.lang = 'Thai'; app.applyWorkspaceOverlay(); await app.$nextTick();
            return { summary: app.getSourceImportCarrySummary({ staged: {} }, [old], [next], 'carry-ui-before'),
                encoded: StatDescCodec.generateTranslationBlock(app.descs[0], 'Thai') };
        });
        assert.match(prepared.summary, /2 translations saved with updated English metadata/);
        assert.match(prepared.encoded, /# # "ความเสียหาย" new_keyword/);
        const label = page.locator('.fileMetadataLabel');
        await label.waitFor({ state: 'visible' });
        await label.focus();
        await page.waitForFunction(() => document.body.textContent.includes('Entry variables: ["#"]'));
        assert.match(await page.locator('.fileIdentityCell').innerText(), /Metadata updated/);
        await page.getByRole('button', { name: 'Open full editor for metadata.txt', exact: true }).click();
        const panel = page.locator('.metadataCorrectionPanel');
        await panel.waitFor({ state: 'visible' });
        await panel.locator('summary').focus(); await page.keyboard.press('Enter');
        assert.match(await panel.locator('pre').innerText(), /old_keyword.*new_keyword/);
        for (const theme of ['light', 'grey', 'dark', 'modern-dark']) {
            await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
            const box = await panel.boundingBox(); assert.ok(box && box.width > 250 && box.x >= 0 && box.x + box.width <= 1441);
            await page.screenshot({ path: join(directory, theme + '.png') });
        }
        await page.evaluate(async () => { const app = window.__carryApp; await app.editorExit(); app.lang = 'German';
            await app._cloudLanguageSwitch; app.applyWorkspaceOverlay(); await app.$nextTick(); });
        await label.waitFor({ state: 'visible' });
        await page.getByRole('button', { name: 'Open full editor for metadata.txt', exact: true }).click();
        await panel.waitFor({ state: 'visible' });
        await panel.locator('summary').click();
        assert.match(await panel.locator('pre').innerText(), /Entry remarks/);
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ passed: true, themes: 4, keyboardDetails: true, languages: ['Thai', 'German'],
            artifacts: process.argv.includes('--keep') ? directory : undefined }));
    } finally {
        await browser?.close(); await new Promise(resolve => server.close(resolve));
        if (!process.argv.includes('--keep')) {
            assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep) && basename(directory).startsWith('sdeditor-carry-ui-'));
            rmSync(directory, { recursive: true, force: true });
        }
    }
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { run };
