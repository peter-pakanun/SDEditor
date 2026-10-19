'use strict';
// Actual shared preview panels, with disposable in-memory SD/ClientText drafts.
// Uses anonymous public-font API reads; no account, login or durable workspace.
// Google/Spoqa fallback font access is required.
const assert = require('node:assert/strict');
const { readFileSync, existsSync, mkdirSync, writeFileSync } = require('node:fs');
const { resolve, join } = require('node:path');
const express = require('express');
const runtime = 'C:/Users/lpeac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || require.resolve('playwright', { paths: [runtime] }));
const executablePath = process.env.FIXTURE_BROWSER_PATH || [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(existsSync);
const samples = {
    French: 'Dégâts élémentaires à l’ennemi ÉÈÊË ÀÂ Ç Œ œ',
    German: 'Erhöhter Feuerschaden ÄÖÜ äöü ß',
    Japanese: '火ダメージが増加する 日本語 カタカナ ひらがな',
    Korean: '화염 피해 증가 한국어',
    Polish: 'Zażółć gęślą jaźń ĄĆĘŁŃÓŚŹŻ ąćęłńóśźż',
    Portuguese: 'Dano de Fogo e Resistência à Corrupção ÃÕ ÁÉÍÓÚ âêô ç',
    Russian: 'Увеличение урона от огня Ёё Жж Щщ Ыы Ъъ Ьь Ээ Юю Яя',
    'Simplified Chinese': '提高火焰伤害 简体中文',
    Spanish: 'Daño de fuego y resistencia ÁÉÍÓÚÜÑ áéíóúüñ ¿¡',
    Thai: 'ความเสียหายไฟเพิ่มขึ้น ทดสอบภาษาไทย กำ กิ กี้ กุ กู',
    'Traditional Chinese': '增加火焰傷害 繁體中文',
    Turkish: 'Çığ Şöleni İı Ğğ Şş Çç Öö Üü',
};
const expected = {
    French: /Fontin/, German: /Fontin/, Portuguese: /Fontin/, Spanish: /Fontin Small[Cc]aps/,
    Russian: /Noto Serif/, Polish: /Noto Serif/, Turkish: /^Fontin-SmallCaps-tr-TR$/,
    Thai: /^Kanit$/, Japanese: /^Koruri Regular$/, Korean: /^Spoqa Han Sans Neo$/,
    'Traditional Chinese': /Noto Sans (?:CJK )?TC/, 'Simplified Chinese': /Noto Sans (?:CJK )?SC/,
};
const themes = ['light', 'grey', 'dark', 'modern-dark'];

async function run() {
    assert.ok(executablePath, 'Set FIXTURE_BROWSER_PATH to an installed Edge/Chrome.');
    const publicDir = resolve(__dirname, '../public'), outputDir = resolve(__dirname, '../temp/preview-font-panels');
    mkdirSync(outputDir, { recursive: true });
    const app = express();
    const vuePath = process.env.FIXTURE_VUE_PATH || resolve(__dirname, '../temp/clienttext-fixture-vue.min.js');
    app.get('/', (_request, response) => response.type('html').send(readFileSync(join(publicDir, 'index.html'), 'utf8')
        .replace('https://cdnjs.cloudflare.com/ajax/libs/vue/3.0.11/vue.global.prod.js', existsSync(vuePath) ? '/fixture/vue.js' : 'https://cdnjs.cloudflare.com/ajax/libs/vue/3.0.11/vue.global.prod.js')
        .replace('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', '/fixture/jszip.js')));
    app.get('/fixture/vue.js', (_request, response) => response.type('js').send(readFileSync(vuePath)));
    app.get('/fixture/jszip.js', (_request, response) => response.type('js').send(readFileSync(require.resolve('jszip/dist/jszip.min.js', { paths: [runtime] }))));
    app.get('/index.js', (_request, response) => response.type('js').send(readFileSync(join(publicDir, 'index.js'), 'utf8')
        .replace("app.mount('#app');", "window.__fontPanelApp=app.mount('#app');")));
    app.use(express.static(publicDir));
    const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    const { pathToFileURL } = require('node:url');
    const apiRoot = resolve(__dirname, '../../SDEditor-API');
    const { createApp } = await import(pathToFileURL(join(apiRoot, 'src/app.js')));
    const { loadConfig } = await import(pathToFileURL(join(apiRoot, 'src/config.js')));
    const { openDatabase } = await import(pathToFileURL(join(apiRoot, 'src/database.js')));
    const config = loadConfig({ ADMIN_GOOGLE_SUB: 'fixture-admin', FRONTEND_ORIGIN: 'http://127.0.0.1:' + server.address().port });
    const db = openDatabase(':memory:'), api = createApp({ config, database: db, oauthProvider: null, logger: { warn() {}, error() {} } });
    const apiServer = await new Promise(resolve => { const instance = api.listen(0, '127.0.0.1', () => resolve(instance)); });
    const apiBase = 'http://127.0.0.1:' + apiServer.address().port;
    const cases = [], networkFailures = [], cancelledFontRequests = [], errors = [], fontRequests = [];
    let browser;
    try {
        browser = await chromium.launch({ executablePath, headless: true });
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        const requested = process.env.PREVIEW_FONT_LANGUAGES?.split('|');
        for (const [language, sample] of Object.entries(samples).filter(([language]) => !requested || requested.includes(language))) {
            const page = await context.newPage();
            page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/fonts/')) fontRequests.push({ url: request.url(), authorization: request.headers().authorization || null, cookie: request.headers().cookie || null }); });
            page.on('pageerror', error => errors.push(language + ': ' + error.message));
            page.on('requestfailed', request => {
                const result = { language, url: request.url(), error: request.failure()?.errorText };
                // Changing preview scope intentionally aborts obsolete font fetches.
                if (new URL(result.url).pathname.startsWith('/fonts/') && result.error === 'net::ERR_ABORTED') cancelledFontRequests.push(result);
                else networkFailures.push(result);
            });
            const cdp = await context.newCDPSession(page);
            await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
            await page.goto('http://127.0.0.1:' + server.address().port + '/?testMode=1&cloudApi=' + encodeURIComponent(apiBase) + '&lang=' + encodeURIComponent(language));
            await page.waitForFunction(() => window.__fontPanelApp?.sourceLoaded);
            const fontSetup = await page.evaluate(async () => {
                const host = window.__fontPanelApp; await host._previewFontsReady;
                return { signedIn: host.cloudSignedIn, account: !!host._cloud, faces: [...document.fonts].filter(face => /Fontin|Koruri|Friz|Optimus/.test(face.family)).map(face => face.family) };
            });
            assert.equal(fontSetup.signedIn, false, language + ': unsigned preview');
            assert.equal(fontSetup.account, false, language + ': no cloud client needed');
            assert.ok(fontSetup.faces.includes('Fontin'), language + ': anonymous source font');
            const source = 'Fire damage {0} [Fire|Fire]';
            async function inspect(mode, surface, mismatchedSettings = false) {
                const key = [language, mode, surface, mismatchedSettings ? 'different-settings' : 'matching-settings'].join('/');
                const targetSelector = '.gamePreviewTargetPane .gamePreviewWindow';
                try { await page.waitForSelector(targetSelector); } catch (error) {
                    const diagnostic = await page.evaluate(() => { const h = window.__fontPanelApp; return { ctActive: h.ctActive, editor: h.ctEditor, inline: h.inlineEditor, previewMounted: h.ctPreviewMounted, unit: !!h.ctCurrentUnit, chooser: h.versionChooserVisible, settings: h.showSetting, current: h.ctContext(), tool: h.ctTool, host: document.querySelector('.gamePreviewTargetPane')?.closest('[id]')?.id }; });
                    throw new Error(key + ': hidden fixture preview ' + JSON.stringify(diagnostic));
                }
                await page.evaluate(async () => {
                    await window.__fontPanelApp._previewFontsReady;
                    await document.fonts.ready;
                    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                });
                const state = await page.evaluate(() => {
                    const host = window.__fontPanelApp, frame = document.querySelector('.gamePreviewTargetPane .gamePreviewWindow');
                    const source = document.querySelector('.gamePreviewSourcePane .gamePreviewWindow');
                    return { language: host.ctActive ? host.ctWorkspace.scope.language : host.lang, settings: host.lang,
                        stack: host.gamePreviewFontFamily, font: getComputedStyle(frame).fontFamily, text: frame.textContent,
                        sourceFont: getComputedStyle(source).fontFamily,
                        variants: [...frame.querySelectorAll('.gamePreviewText')].map(node => ({ text: node.textContent, font: getComputedStyle(node).fontFamily,
                            weight: getComputedStyle(node).fontWeight, style: getComputedStyle(node).fontStyle })),
                        host: frame.closest('#fullEditorPreviewHost,#inlineEditorPreviewHost,#ctFullEditorPreviewHost')?.id,
                    };
                });
                assert.equal(state.language, language, key + ': language');
                assert.equal(state.font, await page.evaluate(stack => { const node = document.createElement('span'); node.style.fontFamily = stack; return node.style.fontFamily; }, state.stack), key + ': live frame receives language stack');
                assert.ok(state.text.includes(sample), key + ': exact sample appears');
                assert.match(state.sourceFont, /^Fontin,/, key + ': English uses Fontin');
                assert.equal(state.host, surface === 'inline' ? 'inlineEditorPreviewHost' : mode === 'sd' ? 'fullEditorPreviewHost' : 'ctFullEditorPreviewHost', key + ': actual preview host');
                assert.ok(state.variants.some(part => part.style === 'italic'), key + ': italic text rendered');
                assert.ok(state.variants.some(part => Number(part.weight) >= 700), key + ': bold text rendered');
                const { root } = await cdp.send('DOM.getDocument');
                const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: targetSelector });
                const fonts = (await cdp.send('CSS.getPlatformFontsForNode', { nodeId })).fonts;
                assert.ok(fonts.some(font => expected[language].test(font.familyName)), key + ': expected actual glyph font: ' + JSON.stringify(fonts));
                assert.ok(fonts.every(font => font.isCustomFont || /Fontin-SmallCaps-tr-TR|OptimusPrincepsSemiBold-tr-TR|Noto Sans CJK TC/.test(font.familyName)), key + ': unexpected system glyph fallback: ' + JSON.stringify(fonts));
                for (const theme of themes) {
                    await page.evaluate(async theme => {
                        document.documentElement.setAttribute('data-theme', theme);
                        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                    }, theme);
                    const geometry = await page.locator(targetSelector).evaluate(frame => {
                        const box = frame.getBoundingClientRect();
                        return { font: getComputedStyle(frame).fontFamily, width: box.width, x: box.x, right: box.right, viewport: innerWidth,
                            visible: frame.checkVisibility(), scrollWidth: frame.scrollWidth, clientWidth: frame.clientWidth };
                    });
                    assert.equal(geometry.font, state.font, key + '/' + theme + ': font remains stable');
                    assert.ok(geometry.visible && geometry.width > 100 && geometry.x >= -1 && geometry.right <= geometry.viewport + 1, key + '/' + theme + ': visible desktop preview: ' + JSON.stringify(geometry));
                    assert.ok(geometry.scrollWidth <= geometry.clientWidth + 1, key + '/' + theme + ': sample wraps inside panel');
                    if (theme === 'dark') await page.screenshot({ path: join(outputDir, key.replaceAll('/', '-').replaceAll(' ', '-') + '.png') });
                }
                cases.push({ key, ...state, fonts });
            }
            await page.evaluate(async ({ source, sample }) => {
                const host = window.__fontPanelApp;
                host.saveSettings = async () => true; host.showSetting = false; host.needsInitialSettings = false;
                host.versionChooserVisible = false; host.inlineEditor = true; host.inlineSidebarVisible = true; host.sideTab = 'preview';
                await host.activateInlineRow(host.descs[0].filepath);
                const index = host.editorBlocks.findIndex(block => !block.isTable), block = host.editorBlocks[index];
                block.english = source;
                block.translation = sample + ' <b>{{' + sample + '}} <i>{{' + sample + '}} {0} [Fire|' + sample + ']';
                host.editorFocusedIndex = index; host.refreshGamePreview(); await host.$nextTick();
            }, { source, sample });
            await inspect('sd', 'inline');
            await page.evaluate(async () => { const host = window.__fontPanelApp; await host.openInlineFullEditor(); await host.$nextTick(); });
            await inspect('sd', 'full');
            for (const mismatchedSettings of [false, true]) {
                // Let Settings watchers finish before opening a synthetic workbook.
                await page.evaluate(async ({ language, mismatchedSettings }) => {
                    const host = window.__fontPanelApp; host.ctActive = false;
                    host.lang = mismatchedSettings ? (language === 'Thai' ? 'German' : 'Thai') : language;
                    await host.$nextTick();
                }, { language, mismatchedSettings });
                await page.evaluate(async () => { await window.__fontPanelApp._previewFontsReady; });
                await page.evaluate(async ({ language, sample, source, mismatchedSettings }) => {
                    const host = window.__fontPanelApp;
                    host.ctActive = false; host.editorVisible = false; host.inlineActive = false; host._draftSession = null;
                    host.lang = mismatchedSettings ? (language === 'Thai' ? 'German' : 'Thai') : language;
                    await host.$nextTick();
                    const field = { id: 'font-field', kind: 'text', name: 'Text', source,
                        target: sample + ' <b>{' + sample + '} <i>{' + sample + '} {0} [Fire|' + sample + ']', targetCell: 'B2', required: true };
                    const unit = Vue.markRaw({ id: 'normal|Sheet|font', role: 'normal', sheet: 'Sheet', recordId: 'font', fields: [field] });
                    host.ctWorkspace = { scope: { accountId: host.cloudProfileId, game: host.gameVersion, branchId: 'default', versionId: 'font', groupId: 'local:test:fonts', language },
                        metadata: { version: { name: 'Fonts ' + language }, descriptors: [] } };
                    host.ctUnits = Vue.markRaw([unit]); host._ctUnitIndex = Vue.markRaw(new Map([[unit.id, unit]])); host._ctWorkUnits = Vue.markRaw(new Map());
                    host.ctSelection = unit.id; host.ctFocusedField = field.id; host.ctValues = { [field.id]: field.target };
                    host.ctSaved = {}; host.ctReviewed = {}; host.ctEditor = true; host.ctActive = true; host.ctInitializing = false; host.ctBusy = false;
                    host.ctTool = 'preview'; host.ctInlineClosed = false; host.ctSelectedFilters = ['unchanged', 'missing', 'saved', 'outdated'];
                    host.ctQueueDraft = () => {}; host.ctFlushDraft = async () => true; host.ctQueueCommentDraft = () => {};
                    host.ctFlushCommentDraft = async () => {}; host.ctLoadComments = async () => {}; host.ctSave = async () => true; host.ctInlineFocusOut = () => {};
                    await host.$nextTick();
                }, { language, sample, source, mismatchedSettings });
                await inspect('clienttext', 'full', mismatchedSettings);
                await page.evaluate(async () => { const host = window.__fontPanelApp; host.ctEditor = false; host.inlineEditor = true; host.inlineSidebarVisible = true; await host.$nextTick(); });
                await inspect('clienttext', 'inline', mismatchedSettings);
            }
            if (language === 'Turkish') {
                await page.evaluate(async () => {
                    const host = window.__fontPanelApp;
                    host.gamePreviewFonts = { Turkish: '"OptimusPrincepsSemiBold-tr-TR"' };
                    await host.$nextTick(); await host._previewFontsReady;
                    const probe = document.createElement('span'); probe.id = 'fixture-turkish-font-probe';
                    probe.style.fontFamily = host.getGamePreviewFontFamily('Turkish');
                    probe.textContent = '\u00c7\u00e7\u011e\u011f\u0130\u0131\u00d6\u00f6\u015e\u015f\u00dc\u00fc ^|~'; document.body.append(probe);
                    await document.fonts.ready;
                });
                const { root } = await cdp.send('DOM.getDocument');
                const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#fixture-turkish-font-probe' });
                const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
                assert.ok(fonts.some(font => font.familyName === 'OptimusPrincepsSemiBold-tr-TR' && font.isCustomFont), JSON.stringify(fonts));
                assert.ok(fonts.some(font => font.familyName === 'Fontin-SmallCaps-tr-TR' && font.isCustomFont), 'missing punctuation uses Turkish Fontin: ' + JSON.stringify(fonts));
                const beforeOffline = fontRequests.length;
                await context.setOffline(true);
                await page.evaluate(async () => { const h = window.__fontPanelApp; h.previewFontsRefresh(); await h._previewFontsReady; await document.fonts.ready; });
                const cached = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
                assert.ok(cached.fonts.some(font => font.familyName === 'OptimusPrincepsSemiBold-tr-TR' && font.isCustomFont), 'loaded fonts still render offline');
                assert.equal(fontRequests.length, beforeOffline, 'offline refresh reuses loaded public faces');
                await context.setOffline(false);
            }
            console.log('PASS ' + language + ': SD and ClientText inline/full, matching and different Settings, actual glyph fonts, four themes');
            await page.close();
        }
        assert.ok(fontRequests.length > 0, 'Browser requested public fonts');
        assert.ok(fontRequests.every(request => request.authorization === null && request.cookie === null), 'Native font reads carry no credentials');
        assert.deepEqual(errors, [], 'Browser errors');
        assert.deepEqual(networkFailures, [], 'Network errors');
        const report = { passed: true, languageCount: new Set(cases.map(item => item.language)).size, cases: cases.length,
            themeChecks: cases.length * themes.length, results: cases, errors, networkFailures, cancelledFontRequests, fontRequests };
        writeFileSync(join(outputDir, 'report.json'), JSON.stringify(report, null, 2));
        console.log(JSON.stringify({ passed: true, languageCount: report.languageCount, panels: report.cases, themeChecks: report.themeChecks, report: join(outputDir, 'report.json') }));
    } catch (error) {
        writeFileSync(join(outputDir, 'failure.json'), JSON.stringify({ error: error.stack, cases, errors, networkFailures }, null, 2));
        throw error;
    } finally { await browser?.close(); await api.locals.collaborationRealtime.close(); apiServer.closeAllConnections(); await new Promise(resolve => apiServer.close(resolve)); db.close(); await new Promise(resolve => server.close(resolve)); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
