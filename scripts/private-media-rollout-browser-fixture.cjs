'use strict';
// Actual frontend + browser CORS, old 94e727a route/CORS contract and current real API.
// All sessions/media are disposable; no external requests or user browser state.
const assert = require('node:assert/strict');
const { readFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } = require('node:fs');
const { resolve, join } = require('node:path'), { pathToFileURL } = require('node:url');
const { createServer } = require('node:http'), express = require('express');
const modules = 'C:/Users/lpeac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || require.resolve('playwright', { paths: [modules] }));
const root = resolve(__dirname, '..'), apiRoot = resolve(root, '../SDEditor-API');
const executablePath = process.env.FIXTURE_BROWSER_PATH || ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
// Copied verbatim from 94e727a src/app.js OPTIONS allow-list. Language selector absent.
const oldHeaders = 'Authorization,Content-Type,Content-Encoding,Range,If-Range,If-None-Match,X-SDEditor-Dictionary-Version,X-SDEditor-Workspace-Version,X-SDEditor-ClientText-Protocol';
const listen = server => new Promise(done => server.listen(0, '127.0.0.1', done));
const stop = server => new Promise(done => { server.close(done); server.closeAllConnections(); });
const base = server => 'http://127.0.0.1:' + server.address().port;
const image = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');
const audio = Buffer.alloc(44 + 16000); audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8); audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22); audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(16000, 40);
const paths = ['/portraits/poe2/witch.webp?v=4', '/audio/poe2db?path=synthetic%2Fexample.wav'];
const catalogPath = '/v1/skill-card-catalogs/poe2/v1';
const unit = { id: '["normal","ActiveSkills","synthetic"]', role: 'normal', sheet: 'ActiveSkills', recordId: 'synthetic', metadata: {}, fields: [{ id: 'Description', name: 'Description', kind: 'text', source: 'Original synthetic ability description.', target: 'Translated synthetic ability description.' }] };
(async () => {
    mkdirSync(join(root, 'temp'), { recursive: true }); const folder = mkdtempSync(join(root, 'temp/private-media-rollout-'));
    const front = express(), old = express(), requests = [], servers = [], checks = [];
    let browser, db, currentApp, oldDenial = 0;
    const frontServer = createServer(front), oldServer = createServer(old); servers.push(frontServer, oldServer);
    try {
        // Serve dependencies locally, without Playwright route interception:
        // interception can satisfy CORS preflights without contacting the server.
        front.get('/', (_req, res) => {
            const html = readFileSync(join(root, 'public/index.html'), 'utf8')
                .replace(/<link\b[^>]*https:\/\/[^>]*>/g, '')
                .replace(/<script src="https:\/\/[^\"]+"[^>]*><\/script>/g, tag => tag.includes('vue.global') ? '<script src="/fixture/vue.js"></script>' : tag.includes('jszip.min') ? '<script src="/fixture/jszip.js"></script>' : '');
            res.set('Content-Security-Policy', "default-src 'self' blob: data:;script-src 'self' 'unsafe-inline' 'unsafe-eval';style-src 'self' 'unsafe-inline';connect-src 'self' http://127.0.0.1:*;font-src 'self' data:;img-src 'self' blob: data:;media-src 'self' blob:").type('html').send(html);
        });
        front.get('/fixture/vue.js', (_req, res) => res.type('js').send(readFileSync(process.env.FIXTURE_VUE_PATH || join(root, 'temp/clienttext-fixture-vue.min.js'))));
        front.get('/fixture/jszip.js', (_req, res) => res.type('js').send(readFileSync(join(apiRoot, 'node_modules/jszip/dist/jszip.min.js'))));
        front.get('/index.js', (_req, res) => res.type('js').send(readFileSync(join(root, 'public/index.js'), 'utf8').replace("app.mount('#app');", "window.fixtureApp=app.mount('#app');")));
        front.use(express.static(join(root, 'public'))); await listen(frontServer); const origin = base(frontServer);
        const record = label => (req, res, next) => { const item = { label, method: req.method, path: req.originalUrl, authorization: !!req.get('Authorization'), languageHeader: !!req.get('X-SDEditor-Language'), preflight: req.get('Access-Control-Request-Headers') || '' }; requests.push(item); res.on('finish', () => item.status = res.statusCode); next(); };
        old.use(record('old-94e727a'));
        old.use((req, res, next) => {
            res.set({ 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': origin });
            if (req.method === 'OPTIONS') return res.set({ 'Access-Control-Allow-Methods': 'GET,HEAD,POST,PUT,PATCH,OPTIONS', 'Access-Control-Allow-Headers': oldHeaders, 'Access-Control-Max-Age': '600' }).status(204).end(); next();
        });
        // Old media routes precede /v1 authentication; frontend must still send bearer.
        old.get('/portraits/poe2/witch.webp', (_req, res) => oldDenial ? res.status(oldDenial).json({ error: { code: 'FIXTURE_DENIED' } }) : res.type('webp').send(image));
        old.get('/audio/poe2db', (_req, res) => oldDenial ? res.status(oldDenial).json({ error: { code: 'FIXTURE_DENIED' } }) : res.type('audio/wav').send(audio));
        old.use('/v1', (req, res, next) => req.get('Authorization') === 'Bearer ' + 'x'.repeat(43) ? next() : res.status(401).json({ error: { code: 'SESSION_EXPIRED' } }));
        old.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'This API endpoint does not exist.' } })); await listen(oldServer);
        const [{ createApp }, { loadConfig }, { openDatabase, CloudStore }] = await Promise.all(['app.js', 'config.js', 'database.js'].map(name => import(pathToFileURL(join(apiRoot, 'src', name)))));
        const config = loadConfig({ ADMIN_GOOGLE_SUB: 'rollout-admin', DATA_DIR: join(folder, 'api'), FRONTEND_ORIGIN: origin, PORTRAIT_DIR: join(apiRoot, 'assets/portraits') });
        db = openDatabase(':memory:'); const store = new CloudStore(db, config);
        for (const id of ['rollout-admin', 'rollout-manager', 'rollout-translator', 'rollout-unassigned', 'rollout-viewer']) store.registerIdentity({ sub: id, name: id, email: id + '@test.invalid' });
        store.assignRole('rollout-admin', 'rollout-manager', 'manager'); store.assignLanguage('rollout-admin', 'rollout-translator', 'Thai');
        const readUser = store.user.bind(store); store.user = id => id === 'rollout-viewer' ? { ...readUser(id), role: 'viewer' } : readUser(id);
        const sessions = Object.fromEntries(['rollout-admin', 'rollout-manager', 'rollout-translator', 'rollout-unassigned', 'rollout-viewer'].map(id => [id, store.createSession(id)]));
        currentApp = createApp({ config, store, oauthProvider: null, audioFetch: async () => new Response(audio, { headers: { 'content-type': 'audio/wav' } }), skillAssetRequest: async () => new Response(image, { headers: { 'content-type': 'image/webp' } }), logger: { error() {}, warn() {} } });
        const current = express(); current.use(record('current')); current.use(currentApp); const currentServer = createServer(current); servers.push(currentServer); await listen(currentServer);
        browser = await chromium.launch({ executablePath, headless: true });
        async function open(apiBase, user, token) {
            const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.goto(origin + '/?testMode=1&lang=Thai'); await page.waitForFunction(() => window.fixtureApp?.startupReady);
            await page.evaluate(async ({ apiBase, user, token, unit }) => {
                const host = fixtureApp; host.gameVersion = 'poe2'; await host.$nextTick(); await host.$nextTick();
                let state = CloudSync.initializeState({ ...CloudSync.completeSettings({ lang: 'Thai' }), dictionary: [] }); state.profiles[user.id] = structuredClone(state.profiles.guest); state.activeProfile = user.id; state.auth = { token, user };
                const client = new CloudSync.Client({ apiBase, fetch: fetch.bind(window), merge: DictionarySync, store: { updateHybridState: async fn => state = fn(state) }, onChange: snapshot => { host.privateMediaRefreshAccess(); host.cloudSignedIn = snapshot.signedIn; host.cloudUser = snapshot.user; host.cloudProfileId = snapshot.profileId; } }); client.state = state;
                host._cloud = Vue.markRaw(client); host.cloudUser = user; host.cloudProfileId = user.id; host.cloudSignedIn = true;
                await host.$nextTick(); await host.$nextTick();
                host.ctWorkspace = { metadata: {}, scope: { accountId: user.id, game: 'poe2', language: 'Thai', branchId: 'default', groupId: 'local:test:rollout', versionId: 'local:test:rollout' } };
                const store = ClientTextMemoryStore.create(); await store.import(host.ctWorkspace.scope, { units: [unit], assets: [{ role: 'normal', name: 'Thai.xlsx', hash: 'a'.repeat(64), blob: new Blob(['synthetic']) }] }); host._ctTestStores = new Map([[host.ctWorkspace.scope.groupId, store]]);
                host.ctUnits = Vue.markRaw([unit]); host._ctUnitIndex = Vue.markRaw(new Map([[unit.id, unit]])); host.ctSaved = Vue.markRaw({}); host.ctSelection = unit.id; host.ctFocusedField = 'Description'; host.ctValues = ClientTextState.valuesFor(unit); host.ctSheet = JSON.stringify(['normal', 'ActiveSkills']); host.ctTool = 'preview'; host.inlineEditor = true; host.ctEditor = true; host.versionChooserVisible = false; host.showSetting = false; host.ctActive = true; host.ctRevision++;
                await host.$nextTick();
            }, { apiBase, user, token, unit });
            return { page, errors };
        }
        const manager = { id: 'rollout-manager', role: 'manager', language: null, canAccessAllLanguages: true, assignmentVersion: 1 };
        let { page, errors } = await open(base(oldServer), manager, 'x'.repeat(43));
        await page.waitForFunction(() => fixtureApp._ctSkillCatalogRun && fixtureApp.ctSkillCatalog === null);
        await page.waitForTimeout(150); assert.equal(await page.locator('.ctSkillCard').count(), 0); assert.equal(await page.locator('.gamePreviewWindow').count(), 2); assert.match(await page.locator('.gamePreviewSourcePane').innerText(), /Original synthetic ability description/); assert.equal(await page.evaluate(() => fixtureApp.ctError), '');
        for (const [index, path] of paths.entries()) {
            const url = await page.evaluate(async ({ path, kind }) => { const lease = await fixtureApp.privateMediaLoad(path, kind); window.rolloutLease = lease; return lease.url; }, { path, kind: index ? 'audio' : 'image' }); assert.match(url, /^blob:/); await page.evaluate(() => rolloutLease.release());
        }
        assert.equal(requests.filter(r => r.label === 'old-94e727a' && r.method === 'GET' && r.path === catalogPath).length, 1); assert.ok(requests.filter(r => r.label === 'old-94e727a' && r.method === 'GET').every(r => r.authorization && !r.languageHeader)); assert.deepEqual(errors, []); checks.push('old CORS permits bearer-only media; catalog 404 retains actual text preview'); await page.close();
        for (const id of ['rollout-admin', 'rollout-manager', 'rollout-translator']) {
            ({ page, errors } = await open(base(currentServer), store.user(id), sessions[id].token)); await page.waitForFunction(() => !!fixtureApp.ctSkillCatalog);
            for (const [index, path] of [...paths, '/skill-assets/poe2/spark/icon'].entries()) await page.evaluate(async ({ path, kind }) => { const lease = await fixtureApp.privateMediaLoad(path, kind); if (!lease.url.startsWith('blob:')) throw new Error('Expected Blob URL'); lease.release(); }, { path, kind: index === 1 ? 'audio' : 'image' });
            assert.deepEqual(errors, []); checks.push('current API accepts bearer-only ' + store.user(id).role + ' without assignment selector'); await page.close();
        }
        // Both failure statuses terminate the same media request without retry/public fallback.
        for (const status of [401, 403]) {
            oldDenial = status; ({ page, errors } = await open(base(oldServer), manager, 'x'.repeat(43))); await page.waitForTimeout(150); const before = requests.length;
            const denied = await page.evaluate(async path => { try { await fixtureApp.privateMediaLoad(path, 'image'); return 0; } catch (error) { return error.status || (error.name === 'AbortError' ? 401 : -1); } }, paths[0]);
            assert.equal(denied, status); const attempts = requests.slice(before).filter(r => r.method !== 'OPTIONS'); assert.equal(attempts.length, 1); assert.equal(attempts[0].path, paths[0]); assert.equal(attempts[0].authorization, true); assert.deepEqual(errors, []); checks.push('HTTP ' + status + ' has one bearer request and no public/anonymous retry'); await page.close();
        }
        for (const id of ['rollout-unassigned', 'rollout-viewer']) {
            // Stale optimistic UI claims are still rejected by the current stored-account guard.
            const started = requests.length; ({ page, errors } = await open(base(currentServer), { ...manager, id }, sessions[id].token)); await page.waitForTimeout(150); const before = requests.length;
            assert.ok(requests.slice(started).some(r => r.path === catalogPath && r.method === 'GET' && r.status === 403));
            const denied = await page.evaluate(async path => { try { await fixtureApp.privateMediaLoad(path, 'image'); return {}; } catch (error) { return { status: error.status, name: error.name, allowed: fixtureApp.privateMediaAllowed }; } }, paths[0]);
            const attempts = requests.slice(before).filter(r => r.method !== 'OPTIONS');
            if (denied.status === 403) assert.equal(attempts.length, 1);
            else { assert.equal(denied.name, 'AbortError'); assert.equal(denied.allowed, false); assert.equal(attempts.length, 0, 'refreshed access blocks further media locally'); }
            assert.deepEqual(errors, []); checks.push('current stored ' + id.split('-').at(-1) + ' denied without selector/fallback'); await page.close();
        }
        const deniedStart = requests.length; ({ page, errors } = await open(base(currentServer), manager, 'z'.repeat(43))); await page.waitForTimeout(150);
        const deniedCatalog = requests.slice(deniedStart).filter(r => r.method !== 'OPTIONS'); assert.equal(deniedCatalog.length, 1); assert.equal(deniedCatalog[0].path, catalogPath); assert.equal(deniedCatalog[0].status, 401); assert.equal(deniedCatalog[0].authorization, true); assert.equal(await page.evaluate(() => fixtureApp.ctSkillCatalog), null); assert.deepEqual(errors, []); checks.push('current catalog 401 has no media or public/anonymous fallback'); await page.close();
        const preflights = requests.filter(r => r.method === 'OPTIONS'); writeFileSync(join(folder, 'requests.json'), JSON.stringify({ origin, old: base(oldServer), current: base(currentServer), checks, requests }, null, 2)); assert.ok(preflights.some(r => r.label === 'old-94e727a'), 'old browser preflight: ' + folder); assert.ok(preflights.some(r => r.label === 'current')); assert.ok(preflights.every(r => r.preflight.toLowerCase() === 'authorization'));
        writeFileSync(join(folder, 'results.json'), JSON.stringify({ passed: true, checks, requests }, null, 2)); console.log(JSON.stringify({ passed: true, checks, preflights: preflights.length, evidence: folder }));
    } finally { await browser?.close(); await currentApp?.locals.collaborationRealtime?.close(); await Promise.all(servers.map(stop)); db?.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
