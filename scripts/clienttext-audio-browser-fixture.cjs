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
    const sampleRate = 8000, dataSize = sampleRate * 2 * 12, bytes = Buffer.alloc(44 + dataSize);
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
    let browser;
    try {
        frontend.get('/fixture/vue.js', (req, res) => res.type('js').send(readFileSync(vuePath)));
        frontend.get('/', (req, res) => res.type('html').send(`<!doctype html><html data-theme="modern-dark"><head>
            <link rel="stylesheet" href="/index.css"><link rel="stylesheet" href="/interface.css"><link rel="stylesheet" href="/client-text.css">
            <style>body{padding:24px;box-sizing:border-box}#fixture{max-width:1100px;margin:auto}.fixtureColumns{display:grid;grid-template-columns:1fr 1fr;gap:24px}section.fixturePanel{min-width:0;padding:16px;background:var(--color-element);border:1px solid var(--ui-border)}textarea{width:100%;box-sizing:border-box}</style>
            </head><body><main id="fixture"><h1>Dialogue audio</h1><button id="toggle" @click="host.ctEditor=!host.ctEditor">Change editor view</button>
            <div v-if="!host.ctEditor" class="fixtureColumns"><section class="fixturePanel"><h2>English</h2><ct-fields :host="host" side="source"></ct-fields><p>Welcome to the camp of the lost, stranger.</p></section><section class="fixturePanel"><h2>Translation</h2><ct-fields :host="host" side="translation"></ct-fields><textarea aria-label="Translation">A translation draft</textarea></section></div>
            <section v-else class="fixturePanel"><h2>English and translation</h2><ct-fields :host="host"></ct-fields><p>Welcome to the camp of the lost, stranger.</p><textarea aria-label="Translation">A translation draft</textarea></section></main>
            <script src="/fixture/vue.js"></script><script src="/cloudUi.js"></script><script src="/clientTextState.js"></script><script src="/clientTextAudio.js"></script><script src="/clientTextUi.js"></script>
            <script>const host=window.fixtureHost=Vue.reactive({ctActive:true,ctBusy:false,ctEditor:false,inlineEditor:true,ctInlineClosed:false,
                ctWorkspace:{scope:{accountId:'guest',game:'poe2',branchId:'default',versionId:'local:test:audio',groupId:'local:test:audio',language:'Thai'}},
                cloudProfileId:'guest',cloudUser:null,managedCatalogScope:'guest:poe2',gameVersion:'poe2',branchId:'default',lang:'Thai',
                ctCurrentUnit:{id:'audio-one',sheet:'NPCTextAudio',metadata:{'Audio File':'4.0/NPC/Fixture/First.wav, 4.0/NPC/Fixture/Second=StrDex4.wav, 4.0/NPC/Fixture/Missing.wav'}},
                ctNotes:()=>[],ctChoices:[],ctFieldGroups:[],ctFieldsKeydown:()=>{},ctResizeFields:()=>{}});
                const app=Vue.createApp({data:()=>({host})});app.component('ct-fields',ClientTextUI.fieldsComponent);app.mount('#fixture');</script></body></html>`));
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
            if (url.endsWith('missing.wav')) return new Response('', { status: 404 });
            return new Response(wave(), { headers: { 'Content-Type': 'audio/wav' } });
        } });
        api.use((error, req, res, next) => res.status(error.status || 500).set('Cache-Control', 'no-store').json({ error: error.message }));
        await listen(apiServer);
        browser = await chromium.launch({ executablePath, headless: true, args: ['--disable-gpu'] });
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(origin + '/?cloudApi=' + encodeURIComponent(urlFor(apiServer)));
        const player = page.locator('.ctDialogueAudio'), play = () => player.locator('.ctAudioPlay').click();
        await player.waitFor();
        assert.equal(await player.count(), 1, 'Inline source has one player; translation has none.');
        assert.equal(await player.locator('select option').count(), 3);
        await page.waitForTimeout(100);
        assert.equal(requests.length, 0, 'Opening a record does not request media.');
        assert.equal(await player.locator('audio').count(), 0);
        await play();
        await page.waitForFunction(() => document.querySelector('audio')?.currentTime > 0.1);
        assert.equal(calls.length, 1); assert.ok(requests.some(request => request.range.startsWith('bytes=')), 'Native playback uses range requests.');
        assert.equal(await player.locator('audio').getAttribute('crossorigin'), null);
        await player.locator('audio').evaluate(audio => { audio.currentTime = 4; });
        await page.waitForFunction(() => document.querySelector('audio')?.currentTime >= 4);
        await page.evaluate(() => { window.previousAudio = document.querySelector('audio'); });
        await player.getByRole('combobox', { name: 'Dialogue audio clip' }).selectOption('1');
        assert.equal(await player.locator('audio').count(), 0);
        assert.equal(await page.evaluate(() => previousAudio.paused && !previousAudio.hasAttribute('src')), true);
        await play(); await page.waitForFunction(() => document.querySelector('audio')?.currentTime > 0.1);
        assert.equal(calls.length, 2); assert.ok(calls[1].endsWith('/second=strdex4.wav'));
        await page.evaluate(() => { window.previousAudio = document.querySelector('audio'); });
        await page.locator('#toggle').click();
        assert.equal(await player.count(), 1); assert.equal(await player.locator('audio').count(), 0);
        assert.equal(await page.evaluate(() => previousAudio.paused && !previousAudio.hasAttribute('src')), true);
        const callsBeforeReplay = calls.length;
        await play(); await page.waitForFunction(() => document.querySelector('audio')?.currentTime > 0.1);
        assert.equal(calls.length, callsBeforeReplay, 'Replaying a clip does not re-download it upstream.');
        // A full fetch has a deterministic browser-cache check in addition to
        // native media buffering (which varies between browser engines).
        const url = urlFor(apiServer) + '/audio/poe2db?path=4.0%2Fnpc%2Ffixture%2Fcache.wav';
        await page.evaluate(async url => { const response = await fetch(url); await response.arrayBuffer(); }, url);
        const beforeCacheRead = requests.length;
        await page.evaluate(async url => { const response = await fetch(url); await response.arrayBuffer(); }, url);
        assert.equal(requests.length, beforeCacheRead, 'Fresh browser HTTP cache avoids another API request.');
        for (const width of [1440, 1000]) for (const theme of ['light', 'grey', 'dark', 'modern-dark']) {
            await page.setViewportSize({ width, height: 900 });
            await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
            const bounds = await player.evaluate(element => ({ left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right,
                viewport: innerWidth, scroll: document.documentElement.scrollWidth, audio: element.querySelector('audio').getBoundingClientRect().width }));
            assert.ok(bounds.left >= 0 && bounds.right <= width && bounds.scroll <= width && bounds.audio > 100, JSON.stringify({ width, theme, bounds }));
        }
        await page.screenshot({ path: join(folder, 'dialogue-audio.png') });
        await page.evaluate(() => { window.previousAudio = document.querySelector('audio'); fixtureHost.ctWorkspace.scope.versionId = 'local:test:another'; });
        await page.waitForFunction(() => !document.querySelector('audio'));
        assert.equal(await page.evaluate(() => previousAudio.paused && !previousAudio.hasAttribute('src')), true, 'Scope changes stop playback.');
        await player.getByRole('combobox', { name: 'Dialogue audio clip' }).selectOption('2');
        await play(); await player.getByRole('status').waitFor();
        assert.match(await player.getByRole('status').textContent(), /unavailable/i);
        await page.evaluate(() => { fixtureHost.ctCurrentUnit = { id: 'audio-two', sheet: 'NPCTextAudio', metadata: { 'Audio File': '4.0/NPC/Fixture/First.wav' } }; });
        await page.waitForFunction(() => !document.querySelector('.ctAudioError') && !document.querySelector('audio'));
        assert.equal(await player.locator('.ctAudioPlay').count(), 1, 'New record clears the old audio error.');
        await play(); await page.waitForFunction(() => document.querySelector('audio')?.currentTime > 0.1);
        await page.evaluate(() => { window.previousAudio = document.querySelector('audio'); fixtureHost.versionChooserVisible = true; });
        await page.waitForFunction(() => !document.querySelector('audio'));
        assert.equal(await page.evaluate(() => previousAudio.paused && !previousAudio.hasAttribute('src')), true, 'Hidden editors stop playback.');
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ ok: true, upstreamDownloads: calls.length, apiRequests: requests.length, themes: 4, viewports: 2,
            screenshot: process.argv.includes('--keep') ? join(folder, 'dialogue-audio.png') : undefined }));
    } finally {
        await browser?.close();
        await Promise.all([stop(frontServer), stop(apiServer)]);
        if (!process.argv.includes('--keep')) {
            assert.ok(resolve(folder).startsWith(resolve(tempBase) + sep));
            rmSync(folder, { recursive: true, force: true });
        }
    }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
