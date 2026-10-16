const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const Cloud = require('../public/cloudSync.js');
const Dictionary = require('../public/dictionarySync.js');
const read = name => fs.readFileSync(path.join(__dirname, '../public', name), 'utf8');
const secret = 'synthetic-private-session';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function cloudHarness() {
    const calls = [];
    const client = new Cloud.Client({ store: {}, merge: Dictionary, apiBase: 'https://api.example.test',
        fetch: async (url, options) => { calls.push({ url, options }); return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } }); } });
    client.state = Cloud.initializeState({ ...Cloud.completeSettings({ lang: 'Thai' }), dictionary: [] });
    client.state.profiles.alice = structuredClone(client.state.profiles.guest);
    client.state.activeProfile = 'alice';
    client.state.auth = { token: secret, user: { id: 'alice', role: 'translator', language: 'Thai', assignmentVersion: 1 } };
    return { client, calls };
}
function harness(changes = {}) {
    const h = cloudHarness(), calls = { clear: 0, dispose: 0, reset: [], create: [], load: [], request: [] };
    const loader = { clear: () => calls.clear++, dispose: () => calls.dispose++,
        load: async (...args) => { calls.load.push(args); return { url: 'blob:synthetic', release() {} }; } };
    const window = { CloudSync: Cloud, DictionarySync: Dictionary, PrivateAssets: { create(options) { calls.create.push(options); return loader; } } };
    vm.runInNewContext(read('privateMediaUi.js'), { window });
    vm.runInNewContext(read('cloudUi.js'), { window });
    const mixin = window.PrivateMediaUI.mixin;
    const app = { ...Cloud.completeSettings({ lang: 'Thai' }), ...window.CloudUI.mixin.data(), ...mixin.data(),
        cloudUser: structuredClone(h.client.state.auth.user), cloudSignedIn: true, cloudProfileId: 'alice',
        gameVersion: 'poe2', branchId: 'default', sourceIdentity: 'source1', dictionary: [], editorClipboard: '',
        ctActive: false, _cloud: h.client, ctAudioController: { reset: value => calls.reset.push(value) },
        $nextTick: async () => {}, ...changes };
    for (const [name, method] of Object.entries(mixin.methods)) app[name] = method.bind(app);
    for (const [name, getter] of Object.entries(mixin.computed)) Object.defineProperty(app, name, { get: () => getter.call(app) });
    return { ...h, calls, app, mixin, loader, window };
}

test('media requires a signed-in allowed role; only legacy role-less pinned administrators use isAdmin', () => {
    const h = harness();
    for (const [user, expected] of [
        [{ role: 'translator', language: 'Thai' }, true], [{ role: 'translator', language: null }, false],
        [{ role: 'manager', language: null }, true], [{ role: 'admin', language: null }, true],
        [{ isAdmin: true }, true], [{ role: 'viewer', language: 'Thai' }, false],
        [{ role: 'viewer', language: 'Thai', isAdmin: true }, false], [null, false]
    ]) { h.app.cloudUser = user; assert.equal(h.app.privateMediaAllowed, expected, JSON.stringify(user)); }
    h.app.cloudUser = { role: 'manager' }; h.app.cloudSignedIn = false; assert.equal(h.app.privateMediaAllowed, false);
});

test('translator media follows selected workspace language and blocks local alternate language', () => {
    const h = harness(); h.app.lang = 'French'; assert.equal(h.app.privateMediaAllowed, false);
    h.app.ctActive = true; h.app.ctWorkspace = { scope: { language: 'Thai', source: 's1' } }; assert.equal(h.app.privateMediaAllowed, true);
    h.app.ctWorkspace.scope.language = 'French'; assert.equal(h.app.privateMediaAllowed, false);
    h.app.cloudUser = { role: 'manager', language: null }; assert.equal(h.app.privateMediaAllowed, true);
    h.app.ctWorkspace.scope.language = ''; assert.equal(h.app.privateMediaAllowed, false);
});

test('raw session data stays in private fields and never enters reactive data, public keys or snapshots', () => {
    const h = harness(); h.app.privateMediaRefreshAccess(); const context = h.app.privateMediaContext();
    assert.deepEqual(Object.keys(h.mixin.data()), ['privateMediaEpoch']);
    assert.equal(h.app._privateMediaAccess.token, secret); assert.equal(context.auth.token, secret);
    assert.equal(context.client, h.client); assert.equal(context.key, h.app.privateMediaKey);
    assert.equal(context.language, 'Thai');
    assert.equal(h.app.privateMediaKey.includes(secret), false); assert.equal(JSON.stringify(h.client.snapshot()).includes(secret), false);
    const publicState = Object.fromEntries(Object.entries(h.app).filter(([key, value]) => !key.startsWith('_') && typeof value !== 'function'));
    assert.equal(JSON.stringify(publicState).includes(secret), false);
});

test('healthy cloud onChange applications preserve media epoch; token and access changes invalidate it', async () => {
    const h = harness(); h.app.privateMediaLoad('/portraits/poe2/example.webp', 'image');
    const apply = h.window.CloudUI.mixin.methods.cloudApply.bind(h.app);
    await apply(h.client.snapshot()); const epoch = h.app.privateMediaEpoch, clears = h.calls.clear;
    h.client.state.profiles.alice.dictionaries.Thai.revision++;
    await apply(h.client.snapshot()); await apply(h.client.snapshot());
    assert.equal(h.app.privateMediaEpoch, epoch); assert.equal(h.calls.clear, clears);
    h.client.state.auth.token = 'rotated-private-session'; await apply(h.client.snapshot());
    assert.equal(h.app.privateMediaEpoch, epoch + 1); assert.equal(h.calls.clear, clears + 1);
    h.client.state.auth.user.assignmentVersion++; await apply(h.client.snapshot());
    assert.equal(h.app.privateMediaEpoch, epoch + 2); assert.equal(h.calls.clear, clears + 2);
});

test('each captured identity/access field invalidates an old context but identical refreshes stay stable', () => {
    for (const [key, value] of [['epoch', 2], ['profile', 'bob'], ['token', 'rotated'], ['role', 'manager'],
        ['assignedLanguage', 'French'], ['assignmentVersion', 2], ['allLanguages', true]]) {
        const h = harness(); let auth = h.client.context(); h.client.context = () => ({ ...auth });
        h.app.privateMediaRefreshAccess(); const epoch = h.app.privateMediaEpoch;
        h.app.privateMediaRefreshAccess(); assert.equal(h.app.privateMediaEpoch, epoch);
        auth = { ...auth, [key]: value }; h.app.privateMediaRefreshAccess();
        assert.equal(h.app.privateMediaEpoch, epoch + 1, key);
    }
});

test('captured key, cloud client identity and live permission checks fence requests', () => {
    for (const change of [h => h.app.lang = 'French', h => h.app.gameVersion = 'poe1', h => h.app.branchId = 'branch2',
        h => h.app.sourceIdentity = 'source2', h => h.app.cloudProfileId = 'bob', h => h.app.cloudSignedIn = false,
        h => h.client.state.auth.user.assignmentVersion++, h => h.app._cloud = cloudHarness().client]) {
        const h = harness(), context = h.app.privateMediaContext(); assert.equal(h.app.privateMediaCurrent(context), true);
        change(h); assert.equal(h.app.privateMediaCurrent(context), false);
        assert.throws(() => h.app.privateMediaRequest('/v1/skill-card-catalogs/poe2/v1', {}, context), { stale: true });
    }
    const h = harness(); h.client.state.auth.token = null;
    assert.throws(() => h.app.privateMediaContext(), { stale: true });
    h.client.state.auth.token = secret; h.client.permissionsCurrent = () => false;
    assert.throws(() => h.app.privateMediaContext(), { stale: true });
    h.window.PrivateAssets = null; assert.throws(() => h.app.privateMediaContext(), { stale: true });
});

test('context watch clears leases and stops audio; unmount disposes loader and forgets private access', async () => {
    const h = harness(); h.app.privateMediaRefreshAccess();
    await h.app.privateMediaLoad('/portraits/poe2/example.webp', 'image');
    const before = h.calls.clear;
    assert.equal(h.mixin.watch.privateMediaKey.flush, 'sync');
    h.mixin.watch.privateMediaKey.handler.call(h.app);
    assert.equal(h.calls.clear, before + 1); assert.deepEqual(h.calls.reset, [true]);
    h.mixin.beforeUnmount.call(h.app); assert.equal(h.calls.dispose, 1); assert.equal(h.app._privateMediaAccess, null);
});

test('language-neutral adapter captures immutable scoped auth and drops caller headers for old CORS compatibility', async () => {
    const h = harness(), controller = new AbortController();
    await h.app.privateMediaLoad('/portraits/poe2/example.webp', 'image', { signal: controller.signal });
    await h.app.privateMediaLoad('/skill-assets/poe2/example/icon', 'image');
    assert.equal(h.calls.create.length, 1); assert.equal(h.calls.load.length, 2);
    const [path, options] = h.calls.load[0]; assert.equal(path, '/portraits/poe2/example.webp');
    assert.equal(options.kind, 'image'); assert.equal(options.signal, controller.signal);
    let actual;
    h.client.request = (...args) => { actual = args; return Promise.resolve({ ok: true }); };
    await h.calls.create[0].request(path, { headers: { Authorization: 'Bearer forged', 'X-SDEditor-Language': 'French', Cookie: 'forged' } }, options.context);
    assert.deepEqual(Object.keys(actual[1].headers), []);
    assert.equal(actual[2], options.context.auth); assert.equal(h.calls.create[0].current(options.context), true);
    h.app.privateMediaEpoch++; assert.equal(h.calls.create[0].current(options.context), false);
});

test('private catalog JSON rechecks scope after asynchronous completion and forwards cancellation', async () => {
    const h = harness(), pending = deferred(), controller = new AbortController(); let actual;
    h.client.request = (...args) => { actual = args; return pending.promise; };
    const context = h.app.privateMediaContext();
    const operation = h.app.privateMediaJson('/v1/skill-card-catalogs/poe2/v1', { context, signal: controller.signal });
    assert.equal(actual[1].signal, controller.signal); assert.deepEqual(Object.keys(actual[1].headers), []);
    h.app.sourceIdentity = 'changed'; pending.resolve({ private: 'stale' }); await assert.rejects(operation, { stale: true });
    h.client.request = async () => ({ ok: true });
    assert.equal((await h.app.privateMediaJson('/v1/skill-card-catalogs/poe2/v1')).ok, true);
});

test('actual CloudSync private routes send bearer only; caller language/auth headers cannot change authority', async () => {
    const { client, calls } = cloudHarness();
    const injected = { Authorization: 'Bearer forged', Cookie: 'forged', 'X-Role': 'admin', 'X-User-Id': 'bob',
        'X-SDEditor-Language': 'Thai', 'X-Unreviewed': 'no', 'X-SDEditor-ClientText-Protocol': 'forged' };
    for (const route of ['/audio/poe2db?path=example.ogg', '/portraits/poe2/example.webp', '/skill-assets/poe2/example/icon', '/v1/skill-card-catalogs/poe2/v1']) {
        await client.request(route, { headers: injected }); const sent = calls.at(-1);
        assert.equal(sent.url, client.apiBase + route); assert.equal(sent.options.cache, 'no-store'); assert.equal(sent.options.credentials, 'omit');
        assert.deepEqual(sent.options.headers, { Authorization: 'Bearer ' + secret });
        assert.equal(sent.url.includes(secret), false);
    }
    for (const route of ['/v1/me', '/auth/session/refresh', '/v1/settings', '/audioish/example', '/skill-cards-evil/poe2/catalog', '/portraits?path=x']) {
        await client.request(route, { headers: injected });
        assert.deepEqual(calls.at(-1).options.headers, { Authorization: 'Bearer ' + secret });
    }
    await client.request('/audio/poe2db?path=example.ogg', { headers: { 'X-SDEditor-Language': 42 } });
    assert.deepEqual(calls.at(-1).options.headers, { Authorization: 'Bearer ' + secret });
});

test('actual CloudSync retains negotiated protocol headers without leaking private language onto other routes', async () => {
    const { client, calls } = cloudHarness();
    const headers = { 'X-SDEditor-Language': 'Thai', 'X-SDEditor-ClientText-Protocol': 'clienttext-trusted-v1', Authorization: 'forged' };
    await client.request('/v1/content-groups/example', { headers });
    assert.deepEqual(calls.at(-1).options.headers, { Authorization: 'Bearer ' + secret, 'X-SDEditor-ClientText-Protocol': 'clienttext-trusted-v1' });
    await client.request('/v1/dictionaries/Thai', { headers });
    assert.deepEqual(calls.at(-1).options.headers, { Authorization: 'Bearer ' + secret, 'X-SDEditor-Dictionary-Version': '2' });
    await client.request('/v1/collaboration/example', { headers });
    assert.deepEqual(calls.at(-1).options.headers, { Authorization: 'Bearer ' + secret, 'X-SDEditor-Workspace-Version': '2' });
});

test('actual CloudSync refuses stale requests and drops media responses after access revisions change', async () => {
    const { client, calls } = cloudHarness(), context = client.context();
    client.state.auth.user.assignmentVersion++;
    await assert.rejects(client.request('/skill-assets/poe2/example/icon', { responseType: 'blob' }, context), { stale: true }); assert.equal(calls.length, 0);
    const pending = deferred(); client.fetcher = () => pending.promise;
    const operation = client.request('/portraits/poe2/example.webp', { responseType: 'blob' });
    client.state.auth.token = 'revoked-and-replaced'; pending.resolve(new Response(new Blob(['synthetic'], { type: 'image/webp' })));
    await assert.rejects(operation, { stale: true });
});
