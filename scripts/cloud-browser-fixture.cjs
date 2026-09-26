// Explicit, loopback-only manual acceptance fixture. Never loaded by production.
// Requires npm ci in ../SDEditor-API. All accounts and cloud data are disposable.
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { randomUUID } = require('node:crypto');

(async () => {
  const apiRoot = resolve(__dirname, '../../SDEditor-API');
  const fromApi = createRequire(resolve(apiRoot, 'package.json'));
  const express = fromApi('express');
  const load = name => import(pathToFileURL(resolve(apiRoot, 'src', name)).href);
  const { loadConfig } = await load('config.js');
  const { openDatabase, CloudStore } = await load('database.js');
  const { createApp } = await load('app.js');
  const frontendPort = Number(process.env.FIXTURE_FRONTEND_PORT || 34191);
  const apiPort = Number(process.env.FIXTURE_API_PORT || 34192);
  const frontOrigin = `http://127.0.0.1:${frontendPort}`;
  const apiOrigin = `http://127.0.0.1:${apiPort}`;
  const config = loadConfig({ FRONTEND_ORIGIN: frontOrigin, API_PUBLIC_URL: apiOrigin, ADMIN_EMAIL: 'admin@example.test', DATABASE_PATH: ':memory:' });
  const database = openDatabase(':memory:');
  const store = new CloudStore(database, config);
  store.registerIdentity({ sub: 'fixture-admin', email: 'admin@example.test', name: 'Fixture Administrator' });
  store.registerIdentity({ sub: 'fixture-translator', email: 'translator@example.test', name: 'Fixture Translator' });
  store.assignLanguage('fixture-admin', 'fixture-translator', 'Thai');
  const term = { _id: 'fire-main', find: 'Fire', replace: 'ไฟ', alts: [{ _id: 'fire-alt', find: 'Burning', replace: 'ลุกไหม้' }], tlnote: 'Original team note' };
  store.patchDictionary('fixture-translator', 'Thai', { baseRevision: 0, mutationId: randomUUID(), upserts: [term], deletedIds: [] });
  const fixtureSettings = { lang: 'Thai', theme: 'dark', editorRegexes: [], gamePreviewFonts: null, dictionary: [{ ...term, replace: 'ไฟส่วนตัว', tlnote: 'My local note' }] };
  const fixtureDirectory = mkdtempSync(resolve(tmpdir(), 'sdeditor-browser-'));
  const fixturePath = resolve(fixtureDirectory, 'settings.json');
  writeFileSync(fixturePath, JSON.stringify(fixtureSettings));
  const transactions = new Map();
  const provider = {
    authorizationUrl({ state, nonce }) { transactions.set(state, nonce); return `${apiOrigin}/fixture/authorize?state=${encodeURIComponent(state)}`; },
    async identity({ code, nonce }) {
      const [state, user] = code.split(':');
      if (transactions.get(state) !== nonce || !['admin', 'translator'].includes(user)) throw new Error('Invalid fixture login');
      transactions.delete(state);
      return { sub: 'fixture-' + user, email: user + '@example.test', name: 'Fixture ' + user };
    },
  };
  const api = express();
  api.get('/fixture/authorize', (req, res) => {
    const state = String(req.query.state || '');
    if (!/^[A-Za-z0-9_-]+$/.test(state)) return res.status(400).end();
    res.type('html').send(`<h1>Local fixture sign-in</h1><p>This is a disposable test provider, not Google.</p><a href="/auth/google/callback?state=${state}&code=${state}:admin">Sign in as fixture admin</a><br><a href="/auth/google/callback?state=${state}&code=${state}:translator">Sign in as fixture translator</a>`);
  });
  api.get('/fixture', (req, res) => res.type('html').send(`<h1>Local cloud fixture</h1><p><a href="${frontOrigin}/?cloudApi=${encodeURIComponent(apiOrigin)}">Open editor</a></p><form method="post" action="/fixture/remote"><button>Change shared Fire remotely</button></form><p>Only disposable example.test users and an in-memory database are used.</p>`));
  api.post('/fixture/remote', (req, res) => {
    const snapshot = store.dictionary('Thai');
    store.patchDictionary('fixture-translator', 'Thai', { baseRevision: snapshot.revision, mutationId: randomUUID(), upserts: [{ ...term, replace: 'ไฟจากทีม', tlnote: 'Remote team note', alts: [...term.alts, { _id: 'remote-added', find: 'Flame', replace: 'เปลวไฟ' }] }], deletedIds: [] });
    res.redirect('/fixture');
  });
  api.use(createApp({ config, database, store, oauthProvider: provider }));
  const frontend = express();
  frontend.use(express.static(resolve(__dirname, '../public')));
  const apiServer = api.listen(apiPort, '127.0.0.1');
  const frontServer = frontend.listen(frontendPort, '127.0.0.1');
  console.log('Disposable editor: ' + frontOrigin + '/?cloudApi=' + encodeURIComponent(apiOrigin));
  console.log('Fixture controls: ' + apiOrigin + '/fixture');
  console.log('Import fixture settings: ' + fixturePath);
  const stop = () => { frontServer.close(); apiServer.close(() => { database.close(); }); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
