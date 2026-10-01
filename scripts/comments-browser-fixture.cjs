// Disposable loopback fixture. None of these routes or controls are served by server.js.
// Browser source/data use the editor's normal IndexedDB and API implementation.
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { createServer } = require('node:http');
const { sourceHash } = require('../public/collaborationProtocol.js');

function sourceFiles(alternate = false) {
  return Array.from({ length: 25 }, (_, index) => {
    const number = String(index + 1).padStart(2, '0');
    return {
      filepath: 'fixture/stat_' + number + '.txt', filedir: 'fixture', filename: 'stat_' + number + '.txt', name: '',
      stats: ['fixture_stat_' + number], variables: ['#', '#'], remarks: ['', ''],
      translations: {
        English: [(alternate && index === 0 ? 'Updated fire damage ' : 'Fire damage ') + number, 'Cold damage ' + number],
        Thai: ['ความเสียหายไฟ ' + number, 'ความเสียหายเย็น ' + number],
        German: ['Feuerschaden ' + number, 'Kälteschaden ' + number],
        Japanese: ['火ダメージ ' + number, '冷気ダメージ ' + number],
      },
      isMissing: false, isDNT: false, hasChanges: true, needsReview: false,
    };
  });
}

function browserControls(account, language, secret) {
  // Serialized only into fixture HTML. Production assets are read without modification.
  const panel = document.createElement('aside');
  panel.id = 'comments-fixture-controls';
  panel.setAttribute('aria-label', 'Disposable comments fixture');
  panel.style.cssText = 'position:fixed;left:12px;bottom:54px;z-index:2147483000;padding:10px;background:#fff7dc;color:#302b1c;border:2px solid #aa7300;border-radius:8px;max-width:290px;font:12px system-ui;box-shadow:0 4px 18px #0004';
  const title = document.createElement('strong'); title.textContent = 'Comments fixture · ' + language; panel.append(title);
  const actions = document.createElement('div'); actions.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-top:7px'; panel.append(actions);
  const status = document.createElement('p'); status.setAttribute('role', 'status'); status.style.margin = '7px 0 0';
  status.textContent = 'Disposable origin: use Bootstrap once, then the normal editor controls.'; panel.append(status);
  const button = (label, action) => {
    const control = document.createElement('button'); control.textContent = label;
    control.style.cssText = 'color:#222;background:#fff;border:1px solid #996d12;padding:6px;border-radius:4px;font:12px system-ui';
    control.onclick = async () => {
      control.disabled = true;
      try { await action(); } catch (error) { status.textContent = error.message; }
      finally { control.disabled = false; }
    };
    actions.append(control); return control;
  };
  const ready = async () => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const vm = window.__commentsFixtureApp;
      if (vm?._cloud?.state && vm.offlineStoreReady) return vm;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Editor initialization did not finish.');
  };
  const fixtureRequest = async (path, body = {}) => {
    const response = await fetch('/fixture/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Fixture-Key': secret }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Fixture request failed');
    return result;
  };
  button('Bootstrap ' + language, async () => {
    const vm = await ready();
    status.textContent = 'Preparing disposable account and both game workspaces…';
    const result = await fixtureRequest('bootstrap');
    await vm._cloud.acceptLogin(result.session);
    await vm.cloudApply(vm._cloud.snapshot());
    // Initialize preferences in the signed-in profile, after any first-login
    // restore. The normal language switch keeps its dictionary scope in sync.
    await vm.cloudSelectLanguage(language, vm.lang);
    await vm._cloud.saveLocal({ ...vm.cloudPayload(), theme: account === 'a' ? 'grey' : 'dark' });
    await vm.cloudApply(vm._cloud.snapshot());
    await vm._cloud.sync();
    for (const game of ['poe1', 'poe2']) {
      await OfflineStore.setSource(result.source, game);
      await OfflineStore.setWorkspace({ descs: JSON.parse(JSON.stringify(result.source)), status: {}, lastModified: 0, size: 0, sourceHash: result.sourceHash }, game);
    }
    await OfflineStore.setMigratedFromSingleVersion(true);
    vm.showSetting = false; vm.needsInitialSettings = false;
    await vm.activateGameVersion('poe1', { checkMigration: false });
    await vm.$nextTick();
    await vm.initializeCollaboration();
    status.textContent = language + ' ready · 25 files · comments across three teams and two hashes.';
  });
  button('Add German comment', async () => {
    await fixtureRequest('remote-comment');
    status.textContent = 'New German comment added to PoE1 / fixture/stat_01.txt. It will appear automatically within 20 seconds.';
  });
  let offline = false, originalFetcher;
  const offlineButton = button('Simulate offline', async () => {
    const vm = await ready(); offline = !offline;
    if (offline) {
      originalFetcher = vm._cloud.fetcher;
      vm._cloud.fetcher = async () => { throw new TypeError('Fixture: network offline'); };
      vm._collaboration?.closeSocket();
      offlineButton.textContent = 'Restore connection';
      status.textContent = 'Fixture API traffic disabled. Try posting a comment or wait for automatic sync.';
    } else {
      vm._cloud.fetcher = originalFetcher;
      offlineButton.textContent = 'Simulate offline';
      await vm.collabRetry();
      status.textContent = 'Fixture API traffic restored.';
    }
  });
  button('Switch game', async () => {
    const vm = await ready();
    await vm.activateGameVersion(vm.gameVersion === 'poe1' ? 'poe2' : 'poe1', { checkMigration: false });
    status.textContent = 'Game: ' + vm.gameVersion + '. PoE2 has a separate comment on the same file path.';
  });
  button('Switch theme', async () => {
    const vm = await ready(); vm.theme = vm.theme === 'grey' ? 'dark' : 'grey';
    status.textContent = 'Theme: ' + vm.theme;
  });
  button('Hide fixture controls', () => { panel.hidden = true; });
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
  const ports = [Number(process.env.FIXTURE_A_PORT || 34211), Number(process.env.FIXTURE_B_PORT || 34212)];
  const apiPort = Number(process.env.FIXTURE_API_PORT || 34213);
  const origins = ports.map(port => `http://127.0.0.1:${port}`);
  const apiOrigin = `http://127.0.0.1:${apiPort}`;
  const config = loadConfig({ FRONTEND_ORIGIN: origins[0], ALLOWED_ORIGINS: origins[1], API_PUBLIC_URL: apiOrigin, ADMIN_EMAIL: 'admin@example.test', DATABASE_PATH: ':memory:' });
  const database = openDatabase(':memory:');
  const store = new CloudStore(database, config);
  store.registerIdentity({ sub: 'comments-admin', email: 'admin@example.test', name: 'Fixture Administrator' });
  const teams = [{ account: 'a', language: 'Thai' }, { account: 'b', language: 'German' }, { account: 'c', language: 'Japanese' }];
  for (const { account, language } of teams) {
    store.registerIdentity({ sub: 'comments-' + account, email: account + '@example.test', name: language + ' Translator' });
    store.assignLanguage('comments-admin', 'comments-' + account, language);
  }
  const api = createApp({ config, database, store, oauthProvider: null });
  const comments = api.locals.comments;
  if (!comments) throw new Error('Comments API is unavailable. Update the sibling SDEditor-API checkout before running this fixture.');
  const sources = [sourceFiles(), sourceFiles(true)];
  const hashes = await Promise.all(sources.map(source => sourceHash(source)));
  const createComment = (account, game, filepath, hashIndex, body) => comments.create('comments-' + account, { game, filepath, sourceHash: hashes[hashIndex], body, mutationId: randomUUID() });
  for (let index = 1; index <= 55; index++) {
    const team = teams[(index - 1) % teams.length];
    createComment(team.account, 'poe1', 'fixture/stat_01.txt', index % 2,
      `Discussion ${String(index).padStart(2, '0')} · ${team.language}\nShould this modifier use the same terminology as the passive skill? ${index % 2 ? 'This note uses the updated English source.' : 'This note uses the original English source.'}`);
  }
  createComment('b', 'poe1', 'fixture/stat_02.txt', 0, 'German team: the second file needs a terminology check.');
  createComment('c', 'poe1', 'fixture/stat_25.txt', 1, 'Japanese team: please review the last file on the next page.');
  createComment('b', 'poe1', 'fixture/removed_file.txt', 1, 'This file is absent from the current source, but the discussion remains available.');
  createComment('b', 'poe1', 'fixture/stat_01.txt', 1, '<script>alert("This must remain plain text")</script>\nA literal <tag> is part of this discussion.');
  createComment('a', 'poe1', 'fixture/stat_01.txt', 0, 'My own Thai comment should not increase my unread count.');
  createComment('c', 'poe2', 'fixture/stat_01.txt', 0, 'PoE2-only discussion. It must never appear in PoE1 comments.');
  const remoteSession = store.createSession('comments-b');
  const apiServer = createServer(api);
  api.locals.collaborationRealtime.attach(apiServer);
  const frontendServers = [];
  for (let index = 0; index < ports.length; index++) {
    const { account, language } = teams[index], secret = randomUUID(), frontend = express();
    frontend.use((req, res, next) => { res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); next(); });
    frontend.use('/fixture', express.json({ limit: '1kb' }));
    frontend.use('/fixture', (req, res, next) => {
      if (req.method !== 'POST' || req.get('X-Fixture-Key') !== secret || req.get('Origin') !== origins[index]) return res.status(403).json({ error: 'Fixture request refused' });
      next();
    });
    frontend.post('/fixture/bootstrap', (req, res) => res.json({ session: store.createSession('comments-' + account), source: sources[index], sourceHash: hashes[index] }));
    frontend.post('/fixture/remote-comment', async (req, res) => {
      try {
        const response = await fetch(apiOrigin + '/v1/comments', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + remoteSession.token },
          body: JSON.stringify({ game: 'poe1', filepath: 'fixture/stat_01.txt', sourceHash: hashes[1], body: 'A fresh German comment from another source hash.\nAdded with the fixture control at ' + new Date().toISOString(), mutationId: randomUUID() }) });
        const result = await response.json();
        if (!response.ok) return res.status(response.status).json({ error: result?.error?.message || 'Remote comment failed' });
        res.json({ ok: true });
      } catch (error) { res.status(500).json({ error: error.message }); }
    });
    frontend.get('/', (req, res) => {
      const html = readFileSync(resolve(__dirname, '../public/index.html'), 'utf8');
      const script = '<script>(' + browserControls.toString() + ')(' + JSON.stringify(account) + ',' + JSON.stringify(language) + ',' + JSON.stringify(secret) + ');</script>';
      res.type('html').send(html.replace('</body>', script + '</body>'));
    });
    frontend.get('/index.js', (req, res) => {
      const source = readFileSync(resolve(__dirname, '../public/index.js'), 'utf8');
      res.type('js').send(source.replace("app.mount('#app');", "window.__commentsFixtureApp = app.mount('#app');"));
    });
    frontend.use(express.static(resolve(__dirname, '../public')));
    frontendServers.push(createServer(frontend));
  }
  const listen = (server, port) => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  await Promise.all([listen(apiServer, apiPort), ...frontendServers.map((server, index) => listen(server, ports[index]))]);
  console.log('Thai editor: ' + origins[0] + '/?cloudApi=' + encodeURIComponent(apiOrigin));
  console.log('German editor (different source hash): ' + origins[1] + '/?cloudApi=' + encodeURIComponent(apiOrigin));
  console.log('Click Bootstrap on each origin. Seed: 60 PoE1 comments (40 unread for Thai), 1 separate PoE2 comment. No real accounts or persistent API data.');
  let stopping = false;
  const stop = async () => {
    if (stopping) return; stopping = true;
    await api.locals.collaborationRealtime.close();
    await Promise.all([...frontendServers, apiServer].map(server => new Promise(resolve => server.close(resolve))));
    database.close();
  };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
