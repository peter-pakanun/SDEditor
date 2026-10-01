// Disposable loopback acceptance fixture. It never runs in the production server.
// Two editor origins isolate browser storage; both connect to the real API and WS server.
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { createServer } = require('node:http');

function browserControls(account, secret) {
  // This function is serialized only into fixture-served pages, never public/index.html.
  const panel = document.createElement('aside');
  panel.id = 'collaboration-fixture-controls';
  panel.setAttribute('aria-label', 'Disposable collaboration fixture');
  panel.style.cssText = 'position:fixed;right:12px;bottom:60px;z-index:2147483000;padding:10px;background:#fff7dc;color:#302b1c;border:2px solid #aa7300;border-radius:8px;max-width:310px;font:13px system-ui;box-shadow:0 4px 18px #0004';
  const title = document.createElement('strong'); title.textContent = 'Disposable fixture · Translator ' + account.toUpperCase(); panel.append(title);
  const actions = document.createElement('div'); actions.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-top:7px'; panel.append(actions);
  const status = document.createElement('p'); status.setAttribute('role', 'status'); status.style.margin = '7px 0 0'; status.textContent = 'Bootstrapping replaces only this fixture origin’s local source.'; panel.append(status);
  const button = (label, action) => {
    const control = document.createElement('button'); control.textContent = label;
    control.style.cssText = 'color:#222;background:#fff;border:1px solid #996d12;padding:6px;border-radius:4px;font:12px system-ui';
    control.onclick = async () => { control.disabled = true; try { await action(); } catch (error) { status.textContent = error.message; } finally { control.disabled = false; } };
    actions.append(control); return control;
  };
  const getApp = () => window.__collaborationFixtureApp || document.querySelector('#app').__vue_app__?._instance?.proxy;
  const ready = async () => {
    for (let index = 0; index < 200; index++) {
      const vm = getApp();
      if (vm?._cloud?.snapshot() && vm.offlineStoreReady && !vm._cloudInitializing) return vm;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Editor initialization did not finish. Inspect visible storage or script errors.');
  };
  let offline = false;
  const seed = Array.from({ length: 25 }, (_, index) => {
    const number = String(index + 1).padStart(2, '0');
    return { filepath: 'fixture/stat_' + number + '.txt', filedir: 'fixture', filename: 'stat_' + number + '.txt', name: '',
      stats: ['fixture_stat_' + number], variables: ['#', '#'], remarks: ['', ''],
      translations: { English: ['Fire damage ' + number, 'Cold damage ' + number], Thai: ['ความเสียหายไฟ ' + number, 'ความเสียหายเย็น ' + number] },
      isMissing: false, isDNT: false, hasChanges: true, needsReview: false };
  });
  button('Bootstrap translator ' + account.toUpperCase(), async () => {
    const vm = await ready();
    status.textContent = 'Preparing disposable account and source…';
    await vm._cloud.finishLogin('fixture-' + account, secret);
    await vm.cloudApply(vm._cloud.snapshot());
    const previousLanguage = vm.lang;
    vm._cloudApplying = true;
    vm.lang = 'Thai'; vm.theme = account === 'a' ? 'grey' : 'dark';
    await vm.$nextTick();
    vm._cloudApplying = false;
    await vm.cloudSelectLanguage('Thai', previousLanguage);
    await vm.saveSettings();
    const source = JSON.parse(JSON.stringify(seed));
    const workspace = { descs: JSON.parse(JSON.stringify(seed)), status: {}, lastModified: 0, size: 0, sourceHash: await CollaborationProtocol.sourceHash(source) };
    const snapshot = await OfflineStore.getWorkspaceSnapshot('poe1');
    await OfflineStore.replaceWorkspace({ game: 'poe1', source, workspace, generation: snapshot.generation,
      revision: snapshot.revision, requestId: crypto.randomUUID() });
    vm.showSetting = false; vm.needsInitialSettings = false;
    await vm.activateGameVersion('poe1', { checkMigration: false });
    await vm.$nextTick();
    await vm.initializeCollaboration();
    status.textContent = 'Translator ' + account.toUpperCase() + ' ready · 25 files · real API + WebSocket.';
  });
  const offlineButton = button('Simulate offline', async () => {
    const vm = await ready();
    offline = !offline;
    const response = await fetch('/fixture/network', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Fixture-Key': secret }, body: JSON.stringify({ offline }) });
    if (!response.ok) throw new Error('Fixture network control refused');
    if (offline) {
      offlineButton.textContent = 'Restore connection';
      status.textContent = 'Fixture network disabled. Editor Save still writes to IndexedDB.';
    } else {
      offlineButton.textContent = 'Simulate offline';
      await vm.collabRetry();
      status.textContent = 'Fixture network restored. Pending saves are retrying.';
    }
  });
  button('Switch theme', async () => {
    const vm = await ready(); vm.theme = vm.theme === 'grey' ? 'dark' : 'grey';
    status.textContent = 'Theme: ' + vm.theme;
  });
  button('Inspect shared storage', async () => {
    const vm = await ready();
    const snapshot = await OfflineStore.getWorkspaceSnapshot(vm.gameVersion || 'poe1');
    const collab = vm._collaboration?.snapshot();
    status.textContent = JSON.stringify({ mode: vm.instanceMode, generation: snapshot.generation, revision: snapshot.revision,
      pending: collab?.pending, conflicts: collab?.conflicts?.length, session: collab?.sessionId,
      peers: collab?.peers?.length, error: vm.cloudStorageError, notice: vm.collaborationNotice,
      files: snapshot.workspace?.descs?.slice(0, 3).map(file => ({ path: file.filepath, translations: file.translations })) });
  });
  button('Load shared workspace', async () => {
    const vm = await ready(); vm.showSetting = false;
    await vm.activateGameVersion('poe1', { checkMigration: false });
    await vm.initializeCollaboration(); status.textContent = 'Shared workspace loaded.';
  });
  document.body.append(panel);
}

(async () => {
  const apiRoot = resolve(__dirname, '../../SDEditor-API');
  const fromApi = createRequire(resolve(apiRoot, 'package.json'));
  const express = fromApi('express');
  const load = name => import(pathToFileURL(resolve(apiRoot, 'src', name)).href);
  const { loadConfig } = await load('config.js');
  const { openDatabase, CloudStore } = await load('database.js');
  const { createApp } = await load('app.js');
  const ports = [Number(process.env.FIXTURE_A_PORT || 34201), Number(process.env.FIXTURE_B_PORT || 34202)];
  const apiPort = Number(process.env.FIXTURE_API_PORT || 34203);
  const origins = ports.map(port => `http://127.0.0.1:${port}`);
  const apiOrigin = `http://127.0.0.1:${apiPort}`;
  const config = loadConfig({ FRONTEND_ORIGIN: origins[0], ALLOWED_ORIGINS: origins[1], API_PUBLIC_URL: apiOrigin, ADMIN_EMAIL: 'admin@example.test', DATABASE_PATH: ':memory:' });
  const database = openDatabase(':memory:');
  const store = new CloudStore(database, config);
  store.registerIdentity({ sub: 'fixture-admin', email: 'admin@example.test', name: 'Fixture Administrator' });
  for (const account of ['a', 'b']) {
    store.registerIdentity({ sub: 'fixture-' + account, email: account + '@example.test', name: 'Translator ' + account.toUpperCase() });
    store.assignLanguage('fixture-admin', 'fixture-' + account, 'Thai');
  }
  const api = createApp({ config, database, store, oauthProvider: null });
  const secrets = ports.map(() => randomUUID());
  const offlineOrigins = new Set();
  const apiHost = express();
  apiHost.use((req, res, next) => {
    const origin = req.get('Origin');
    if (origins.includes(origin)) res.set({ 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Authorization,Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,OPTIONS', 'Access-Control-Allow-Credentials': 'true' });
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (offlineOrigins.has(origin)) return res.status(503).json({ error: { code: 'FIXTURE_OFFLINE', message: 'Fixture network disabled' } });
    next();
  });
  apiHost.post('/auth/exchange', express.json(), (req, res, next) => {
    const index = origins.indexOf(req.get('Origin'));
    if (index < 0 || req.body.verifier !== secrets[index] || req.body.code !== 'fixture-' + ['a', 'b'][index]) return next();
    res.json(store.createSession('fixture-' + ['a', 'b'][index]));
  });
  apiHost.use(api);
  const apiServer = createServer(apiHost);
  api.locals.collaborationRealtime.attach(apiServer);
  const frontendServers = [];
  for (let index = 0; index < ports.length; index++) {
    const account = ['a', 'b'][index], secret = secrets[index], frontend = express();
    frontend.use((req, res, next) => {
      res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      next();
    });
    frontend.post('/fixture/session', (req, res) => {
      if (req.get('X-Fixture-Key') !== secret || req.get('Origin') !== origins[index]) return res.status(403).json({ error: 'Fixture request refused' });
      res.json(store.createSession('fixture-' + account));
    });
    frontend.post('/fixture/network', express.json(), (req, res) => {
      if (req.get('X-Fixture-Key') !== secret || req.get('Origin') !== origins[index]) return res.status(403).end();
      if (req.body.offline) offlineOrigins.add(origins[index]); else offlineOrigins.delete(origins[index]);
      res.json({ offline: offlineOrigins.has(origins[index]) });
    });
    frontend.get('/', (req, res) => {
      const html = readFileSync(resolve(__dirname, '../public/index.html'), 'utf8');
      const script = '<script>(' + browserControls.toString() + ')(' + JSON.stringify(account) + ',' + JSON.stringify(secret) + ');</script>';
      const patched = req.query.fallback === '1' ? html.replace('<head>', '<head><script>Object.defineProperty(window,"SharedWorker",{value:undefined});</script>') : html;
      res.type('html').send(patched.replace('</body>', script + '</body>'));
    });
    frontend.get('/index.js', (req, res) => {
      const source = readFileSync(resolve(__dirname, '../public/index.js'), 'utf8');
      res.type('js').send(source.replace("app.mount('#app');", "window.__collaborationFixtureApp = app.mount('#app');"));
    });
    frontend.use(express.static(resolve(__dirname, '../public')));
    frontendServers.push(createServer(frontend));
  }
  const listen = (server, port) => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  await Promise.all([listen(apiServer, apiPort), ...frontendServers.map((server, index) => listen(server, ports[index]))]);
  console.log('Translator A: ' + origins[0] + '/?cloudApi=' + encodeURIComponent(apiOrigin));
  console.log('Translator B: ' + origins[1] + '/?cloudApi=' + encodeURIComponent(apiOrigin));
  console.log('Click each visible Bootstrap translator button. Isolated browser storage; disposable in-memory API.');
  let stopping = false;
  const stop = async () => {
    if (stopping) return; stopping = true;
    await api.locals.collaborationRealtime.close();
    await Promise.all([...frontendServers, apiServer].map(server => new Promise(resolve => server.close(resolve))));
    database.close();
  };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
