'use strict';
// Real Vue/native media controls + actual API audio route on disposable origins.
// The upstream serves generated WAV bytes; no game audio or account data is used.
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { existsSync, readFileSync, mkdirSync, mkdtempSync, rmSync } = require('node:fs');
const { resolve, join, sep } = require('node:path');
const { pathToFileURL } = require('node:url');
const express = require('express');
const runtimeModules = 'C:/Users/lpeac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || require.resolve('playwright', { paths: [runtimeModules] }));
const repo = resolve(__dirname, '..'), publicDir = join(repo, 'public'), tempBase = join(repo, 'temp');
const vuePath = process.env.FIXTURE_VUE_PATH || join(tempBase, 'clienttext-fixture-vue.min.js');
const executablePath = process.env.FIXTURE_BROWSER_PATH || [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find(existsSync);
const listen = server => new Promise(done => server.listen(0, '127.0.0.1', done));
const stop = server => new Promise(done => { server.close(done); server.closeAllConnections(); });
const urlFor = server => 'http://127.0.0.1:' + server.address().port;

function wave() {
    const sampleRate = 8000, dataSize = sampleRate * 2 * 45, bytes = Buffer.alloc(44 + dataSize);
    bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
    bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
    bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * 2, 28);
    bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(dataSize, 40);
    return bytes;
}

async function run() {
    if (!executablePath || !existsSync(vuePath)) throw new Error('Install Edge/Chrome and provide FIXTURE_VUE_PATH (or temp/clienttext-fixture-vue.min.js).');
    mkdirSync(tempBase, { recursive: true });
    const folder = mkdtempSync(join(tempBase, 'clienttext-audio-browser-'));
    const { loadConfig } = await import(pathToFileURL(resolve(repo, '../SDEditor-API/src/config.js')));
    const { installAudioRoutes } = await import(pathToFileURL(resolve(repo, '../SDEditor-API/src/audio-proxy.js')));
    const frontend = express(), api = express(), frontServer = createServer(frontend), apiServer = createServer(api);
    let browser, releaseFirst;
    const firstResponse = new Promise(resolve => { releaseFirst = resolve; });
    let missingAvailable = false;
    try {
        frontend.get('/fixture/vue.js', (req, res) => res.type('js').send(readFileSync(vuePath)));
        frontend.get('/', (req, res) => res.type('html').send(`<!doctype html><html data-theme="modern-dark"><head>
            <link rel="stylesheet" href="/index.css"><link rel="stylesheet" href="/interface.css"><link rel="stylesheet" href="/client-text.css">
            <style>:root{--workspace-footer-height:76px}body{padding:24px;box-sizing:border-box}#fixture{max-width:1100px;margin:auto}.fixtureColumns{display:grid;grid-template-columns:1fr 1fr;gap:24px}section.fixturePanel{min-width:0;padding:16px;background:var(--color-element);border:1px solid var(--ui-border)}textarea{width:100%;box-sizing:border-box}.fixtureNativeField{box-sizing:border-box;min-height:110px;margin:0;padding:12px;white-space:pre-wrap;border:1px solid var(--ui-border);border-radius:5px;background:var(--color-element-alt);color:var(--color-font)}.fixtureFooter{height:76px;box-sizing:border-box}</style>
            </head><body><main id="fixture"><h1>Dialogue audio</h1><button id="toggle" @click="host.ctEditor=!host.ctEditor">Change editor view</button>
            <div v-if="!host.ctEditor" class="fixtureColumns"><section class="fixturePanel"><h2>English</h2><ct-fields :host="host" side="source"></ct-fields></section><section class="fixturePanel"><h2>Translation</h2><ct-fields :host="host" side="translation"></ct-fields></section></div>
            <section v-else class="fixturePanel ctFullEditor"><h2>English and translation</h2><ct-fields :host="host"></ct-fields></section>
            <div id="fixturePreviewHost"></div><editor-preview :controller="host" target="#fixturePreviewHost"></editor-preview>
            <ct-audio-session :host="host" :surface="host.ctEditor ? 'both' : 'source'"></ct-audio-session>
            <footer v-if="!host.ctEditor" class="workspaceFooter fixtureFooter">Fixture workspace status bar</footer></main>
            <script src="/fixture/vue.js"></script><script src="/cloudUi.js"></script><script src="/clientTextState.js"></script><script src="/editorComponents.js"></script><script src="/clientTextAudio.js"></script><script src="/clientTextUi.js"></script>
            <script>const field={id:'Text',name:'Text',kind:'text',source:'Welcome to the camp of the lost, stranger.',targetCell:'D2'};
                const host=window.fixtureHost=Vue.reactive({ctActive:true,ctBusy:false,ctEditor:false,inlineEditor:true,ctInlineClosed:false,ctAudioController:null,
                ctWorkspace:{scope:{accountId:'guest',game:'poe2',branchId:'default',versionId:'local:test:audio',groupId:'local:test:audio',language:'Thai'}},
                cloudProfileId:'guest',cloudUser:null,managedCatalogScope:'guest:poe2',gameVersion:'poe2',branchId:'default',lang:'Thai',
                ctCurrentUnit:{id:'audio-one',sheet:'NPCTextAudio',metadata:{'Audio File':'4.0/NPC/Fixture/First.wav, 4.0/NPC/Fixture/Second=StrDex4.wav, 4.0/NPC/Fixture/Missing.wav'}},
                ctNotes:()=>[],ctChoices:[],ctFieldGroups:[{key:'Text',name:'Text',source:field.source,fields:[field],forms:false}],
                ctGroupSources:group=>[{key:'Text',label:'Text',source:group.source,fieldIds:['Text']}],
                ctSourceFieldController:(group,source)=>({value:source.source}),ctClassFields:()=>[],ctFieldsKeydown:()=>{},ctResizeFields:()=>{},
                get gamePreviewFullEditor(){return this.ctEditor;},gamePreviewFrame:'s',gamePreviewIsDialogue:true,
                gamePreviewDefaultTextColor:'#fffbd6',gamePreviewFontFamily:'Arial',gamePreviewSourceFontFamily:'Arial',
                hideSourceInPreviewPanel:false,gamePreviewSourceIsTable:false,gamePreviewTargetIsTable:false,gamePreviewVarKeyList:[],
                gamePreviewVarValues:{},ctPossessivePreviewForms:null,translationEditorBcp47:'th',
                gamePreviewDisplaySource:[{type:'text',text:'First dialogue block.'},{type:'continue'},{type:'text',text:'Last dialogue block.'}],
                get gamePreviewTargetRows(){return [{key:'target',label:'',segments:this.gamePreviewDisplaySource}];},
                gamePreviewAudioSegments(segments){return ClientTextAudio.previewSegments(segments,ClientTextAudio.clipsFor(this.ctCurrentUnit));}});
                const app=Vue.createApp({data:()=>({host})});app.component('ct-fields',ClientTextUI.fieldsComponent);
                app.component('ct-audio-session',ClientTextAudio.component);app.component('ct-audio-controls',ClientTextAudio.controlsComponent);
                app.component('editor-preview',EditorComponents.Preview);
                app.directive('tooltip',{});
                app.component('editor-native-field',{props:['controller','kind'],template:'<pre class="fixtureNativeField" :data-kind="kind">{{controller.value}}</pre>'});
                app.component('ct-target',{template:'<textarea aria-label="Translation">A translation draft</textarea>'});
                app.mount('#fixture');</script></body></html>`));
        frontend.use(express.static(publicDir));
        await listen(frontServer);
        const origin = urlFor(frontServer), calls = [], requests = [];
        const config = loadConfig({ DATA_DIR: folder, FRONTEND_ORIGIN: origin, AUDIO_CACHE_MAX_BYTES: '2097152' });
        api.use((req, res, next) => {
            requests.push({ method: req.method, range: req.get('Range') || '', path: req.url });
            res.set({ 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': origin, 'X-Content-Type-Options': 'nosniff' }); next();
        });
        installAudioRoutes(api, { config, limit: (req, res, next) => next(), fetchImpl: async (url, options) => {
            calls.push(url); assert.equal(options.headers.Referer, 'https://poe2db.tw/');
            if (url.endsWith('first.wav')) await firstResponse;
            if (url.endsWith('missing.wav') && !missingAvailable) return new Response('', { status: 404 });
            return new Response(wave(), { headers: { 'Content-Type': 'audio/wav' } });
        } });
        api.use((error, req, res, next) => res.status(error.status || 500).set('Cache-Control', 'no-store').json({ error: error.message }));
        await listen(apiServer);
        browser = await chromium.launch({ executablePath, headless: true, args: ['--disable-gpu'] });
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => { errors.push(error.message); console.error('Browser error:', error.message); });
        await page.goto(origin + '/?cloudApi=' + encodeURIComponent(urlFor(apiServer)));
        const toolbar = page.locator('.ctDialogueAudio'), tracks = toolbar.locator('.ctAudioTrack'), floating = page.locator('.ctAudioFloating');
        const first = () => tracks.nth(0), second = () => tracks.nth(1), missing = () => tracks.nth(2);
        const playing = () => page.waitForFunction(() => {
            const float = document.querySelector('.ctAudioFloating'), audio = float?.querySelector('audio');
            return float && getComputedStyle(float).display !== 'none' && audio && !audio.paused && audio.currentTime > 0.05;
        });
        const stopped = () => page.waitForFunction(() => {
            const float = document.querySelector('.ctAudioFloating');
            return !float || getComputedStyle(float).display === 'none';
        });
        const rememberAudio = () => page.evaluate(() => { window.previousAudio = document.querySelector('.ctAudioFloating audio'); });
        const oldStopped = () => page.evaluate(() => previousAudio.paused && !previousAudio.hasAttribute('src'));
        await toolbar.waitFor();
        const sourcePreview=page.locator('.gamePreviewSourcePane .ctAudioTrack');
        await sourcePreview.first().waitFor();
        assert.equal(await page.locator('.gamePreviewTargetPane .ctAudioTrack').count(),0,'Only the English preview has dialogue playback buttons.');
        assert.equal(await page.locator('.gamePreviewSourcePane .ctPreviewAudioControls').count(),2,'Each nonempty continue block receives playback controls.');
        assert.equal(await page.locator('.gamePreviewSourcePane .ctPreviewAudioControls').nth(0).locator('.ctAudioTrack').count(),1);
        assert.equal(await page.locator('.gamePreviewSourcePane .ctPreviewAudioControls').nth(1).locator('.ctAudioTrack').count(),2,'Extra tracks belong to the last text block.');
        assert.equal(await toolbar.count(), 1, 'Inline source has one audio bar; translation has none.');
        assert.equal(await tracks.count(), 3, 'Every available track has its own icon button.');
        assert.equal((await toolbar.textContent()).trim(), '', 'The toolbar is icon-only.');
        assert.equal(await tracks.locator('.ctAudioSpeakIcon').count(), 3);
        assert.equal(await first().getAttribute('aria-label'), 'Play First.wav');
        assert.equal(await second().getAttribute('aria-label'), 'Play Second=StrDex4.wav');
        const placement = await toolbar.evaluate(element => {
            const field = element.closest('.ctFieldSource')?.querySelector('.fixtureNativeField');
            return { sourceField: !!field, below: field && element.getBoundingClientRect().top >= field.getBoundingClientRect().bottom - 1 };
        });
        assert.deepEqual(placement, { sourceField: true, below: true }, 'The audio bar sits beneath the English field.');
        await page.waitForTimeout(100);
        assert.equal(requests.length, 0, 'Opening a record does not request media.');
        assert.equal(await page.locator('audio').count(), 0);
        await sourcePreview.first().click();
        await page.waitForFunction(() => document.querySelector('.ctAudioTrack.loading'));
        assert.equal(await page.locator('.ctAudioTrack.loading').count(),2,'Field and English preview share loading.');
        assert.equal(await first().isDisabled(), true, 'Loading tracks cannot be clicked.');
        assert.match(await first().getAttribute('aria-label'), /Loading.*First\.wav/);
        assert.equal(await first().locator('.spinner').count(), 1);
        assert.equal(await first().locator('.ctAudioSpeakIcon').count(), 0);
        assert.equal(await floating.isVisible(), false, 'Native controls stay hidden during initial loading.');
        releaseFirst();
        await playing();
        assert.equal(await page.locator('.ctAudioTrack.active').count(),2,'Field and English preview share the playing state.');
        assert.equal(await page.locator('audio').count(),1,'All playback buttons use one media element.');
        assert.equal(calls.length, 1); assert.ok(requests.some(request => request.range.startsWith('bytes=')), 'Native playback uses range requests.');
        assert.equal(await first().getAttribute('aria-label'), 'Stop First.wav');
        assert.equal(await first().locator('.ctAudioSpeakIcon').count(), 1);
        assert.ok((await first().getAttribute('class')).includes('active'));
        assert.equal(await floating.locator('audio').getAttribute('crossorigin'), null);
        assert.equal(await floating.locator('audio').evaluate(audio => audio.controls), true, 'Floating controls are the native audio player.');
        assert.equal(await floating.evaluate(element => element.parentElement === document.body), true, 'Native player teleports outside the editor field.');
        await floating.locator('audio').evaluate(audio => { audio.currentTime = 4; });
        await page.waitForFunction(() => document.querySelector('.ctAudioFloating audio')?.currentTime >= 4);
        await rememberAudio();
        await first().click(); await stopped();
        assert.equal(await oldStopped(), true, 'Clicking the active track stops it and releases its source.');
        assert.equal(await first().getAttribute('aria-label'), 'Play First.wav');
        await second().focus(); await second().press('Enter'); await playing();
        assert.equal(calls.length, 2); assert.ok(calls[1].endsWith('/second=strdex4.wav'));
        assert.equal(await second().getAttribute('aria-label'), 'Stop Second=StrDex4.wav');
        await sourcePreview.nth(1).click(); await stopped();
        assert.equal(await second().getAttribute('aria-label'),'Play Second=StrDex4.wav','The preview can stop a track started in the field.');
        await second().click(); await playing();
        await rememberAudio(); await first().click(); await playing();
        assert.equal(await oldStopped(), true, 'Playing another icon releases the previous native player.');
        assert.equal(await first().getAttribute('aria-label'), 'Stop First.wav');
        assert.equal(await second().getAttribute('aria-label'), 'Play Second=StrDex4.wav');
        await floating.locator('audio').evaluate(audio => audio.pause()); await stopped();
        await first().click(); await playing();
        await floating.locator('audio').evaluate(audio => { audio.currentTime = audio.duration - 0.1; });
        await stopped();
        assert.equal(await first().getAttribute('aria-label'), 'Play First.wav', 'Finishing playback returns the icon to idle.');
        await first().click(); await playing();
        const screenshots = [];
        const checkLayout = async surface => {
            for (const width of [1440, 1000]) for (const theme of ['light', 'grey', 'dark', 'modern-dark']) {
                await page.setViewportSize({ width, height: 900 });
                await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
                const bounds = await floating.evaluate(element => {
                    const box = element.getBoundingClientRect(), footer = document.querySelector('.workspaceFooter')?.getBoundingClientRect();
                    const style = getComputedStyle(element), button = document.querySelector('.ctAudioTrack.active');
                    const accent = document.createElement('span'); accent.style.color = 'var(--ui-accent)'; document.body.append(accent);
                    const accentColor = getComputedStyle(accent).color; accent.remove();
                    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, viewport: innerWidth,
                        height: innerHeight, scroll: document.documentElement.scrollWidth, audio: element.querySelector('audio').getBoundingClientRect().width,
                        position: style.position, opacity: Number(style.opacity), footerTop: footer?.top,
                        activeColor: button && getComputedStyle(button).color, accentColor };
                });
                assert.ok(bounds.left >= 0 && bounds.right <= width && bounds.scroll <= width && bounds.audio > 100, JSON.stringify({ width, theme, surface, bounds }));
                assert.equal(bounds.position, 'fixed'); assert.equal(bounds.opacity, 0.7);
                assert.equal(bounds.activeColor, bounds.accentColor, 'Playing tracks use the editor toolbar active color.');
                assert.ok(width - bounds.right <= 30, 'Native controls float at the right edge.');
                if (surface === 'inline') assert.ok(bounds.bottom <= bounds.footerTop, 'Inline native controls clear the workspace status bar.');
                else assert.ok(bounds.height - bounds.bottom < 40, 'Full editor native controls sit near the lower edge.');
                if (width === 1440 && ['light', 'modern-dark'].includes(theme)) {
                    const screenshot = join(folder, 'dialogue-audio-' + surface + '-' + theme + '.png');
                    await page.screenshot({ path: screenshot }); screenshots.push(screenshot);
                }
            }
        };
        await checkLayout('inline');
        await page.evaluate(() => { document.querySelector('.workspaceFooter').style.height = '104px'; });
        await page.waitForFunction(() => document.querySelector('.ctAudioFloating')?.style.getPropertyValue('--ct-audio-footer-height') === '104px');
        assert.equal(await floating.evaluate(element => element.getBoundingClientRect().bottom < document.querySelector('.workspaceFooter').getBoundingClientRect().top), true,
            'The floating player follows a resized workspace status bar.');
        await rememberAudio();
        await page.locator('#toggle').click();
        await stopped(); assert.equal(await toolbar.count(), 1);
        assert.equal(await oldStopped(), true, 'Changing editor surfaces stops the previous playback.');
        const callsBeforeReplay = calls.length;
        await first().click(); await playing();
        assert.equal(calls.length, callsBeforeReplay, 'Replaying a clip does not re-download it upstream.');
        await checkLayout('full');
        // A full fetch has a deterministic browser-cache check in addition to
        // native media buffering (which varies between browser engines).
        const url = urlFor(apiServer) + '/audio/poe2db?path=4.0%2Fnpc%2Ffixture%2Fcache.wav';
        await page.evaluate(async url => { const response = await fetch(url); await response.arrayBuffer(); }, url);
        const beforeCacheRead = requests.length;
        await page.evaluate(async url => { const response = await fetch(url); await response.arrayBuffer(); }, url);
        assert.equal(requests.length, beforeCacheRead, 'Fresh browser HTTP cache avoids another API request.');
        await page.evaluate(() => { window.previousAudio = document.querySelector('.ctAudioFloating audio'); fixtureHost.ctWorkspace.scope.versionId = 'local:test:another'; });
        await stopped();
        assert.equal(await oldStopped(), true, 'Scope changes stop playback.');
        await missing().click();
        await page.waitForFunction(() => document.querySelector('.ctAudioTrack.error')?.getAttribute('aria-label').includes('404'));
        assert.match(await missing().getAttribute('aria-label'), /404/);
        assert.equal(await page.locator('.ctAudioTrack.error').count(),2,'An HTTP failure is shared by the field and English preview buttons.');
        assert.match(await sourcePreview.nth(2).getAttribute('aria-label'),/404/);
        assert.match(await missing().getAttribute('aria-label'), /retry/i);
        assert.equal(await missing().isDisabled(), false, 'Failed tracks remain clickable for retry.');
        assert.equal(await missing().locator('.ctAudioSpeakIcon').count(), 1, 'An error retains the speak icon.');
        for (const theme of ['light', 'grey', 'dark', 'modern-dark']) {
            await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
            const colors = await missing().evaluate(button => {
                const probe = document.createElement('span'); probe.style.color = 'var(--ui-error)'; document.body.append(probe);
                const errorColor = getComputedStyle(probe).color; probe.remove();
                return { icon: getComputedStyle(button).color, errorColor };
            });
            assert.equal(colors.icon, colors.errorColor, 'Failed tracks use the error color in ' + theme + '.');
        }
        assert.equal(await floating.isVisible(), false, 'An error does not leave the native player visible.');
        const callsBeforeRetry = calls.length; missingAvailable = true;
        await sourcePreview.nth(2).click(); await playing();
        assert.equal(await missing().getAttribute('aria-label'),'Stop Missing.wav','Retrying in the preview updates the field button.');
        assert.ok(calls.length > callsBeforeRetry, 'Retry requests the previously unavailable clip again.');
        await page.evaluate(() => { fixtureHost.ctCurrentUnit = { id: 'audio-two', sheet: 'NPCTextAudio', metadata: { 'Audio File': '4.0/NPC/Fixture/First.wav' } }; });
        await stopped();
        assert.equal(await tracks.count(), 1); assert.equal(await first().getAttribute('aria-label'), 'Play First.wav');
        await page.evaluate(() => { window.previousAudio.dispatchEvent(new Event('error')); });
        assert.equal(await toolbar.locator('.error').count(), 0, 'Late events from a released player do not affect the new record.');
        await first().click(); await playing();
        await page.evaluate(() => { window.previousAudio = document.querySelector('.ctAudioFloating audio'); fixtureHost.versionChooserVisible = true; });
        await stopped();
        assert.equal(await oldStopped(), true, 'Hidden editors stop playback.');
        await page.evaluate(() => { fixtureHost.versionChooserVisible = false; fixtureHost.ctCurrentUnit = { id: 'no-audio', sheet: 'ClientStrings', metadata: {} }; });
        assert.equal(await toolbar.count(), 0, 'Records without valid audio have no audio bar.');
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ ok: true, upstreamDownloads: calls.length, apiRequests: requests.length, themes: 4, viewports: 2, surfaces: 2,
            screenshots: process.argv.includes('--keep') ? screenshots : undefined }));
    } finally {
        releaseFirst();
        await browser?.close();
        await Promise.all([stop(frontServer), stop(apiServer)]);
        if (!process.argv.includes('--keep')) {
            assert.ok(resolve(folder).startsWith(resolve(tempBase) + sep));
            rmSync(folder, { recursive: true, force: true });
        }
    }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
