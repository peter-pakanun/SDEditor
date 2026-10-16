const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };
function environment() {
    const requests = [], released = [], listeners = [], removed = [];
    const window = { AbortController, ClientTextPortraitCatalog: { games: {} },
        addEventListener: (name, callback) => listeners.push({ name, callback }),
        removeEventListener: (name, callback) => removed.push({ name, callback }) };
    for (const file of ['clientTextPortraits.js', 'clientTextSkillCardUi.js'])
        vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public', file), 'utf8'), { window, AbortController });
    const host = { privateMediaAllowed: true, privateMediaKey: 'alice:Thai:source1:access1',
        privateMediaContext() { return { key: this.privateMediaKey }; },
        privateMediaLoad(path, kind, options) {
            const pending = deferred(), request = { path, kind, options, ...pending };
            request.finish = () => {
                const lease = { url: 'blob:image-' + requests.indexOf(request), release() { released.push(lease.url); } };
                request.lease = lease; request.resolve(lease); return lease;
            };
            requests.push(request); return pending.promise;
        } };
    async function waitForRequests(count) {
        for (let index = 0; index < 20 && requests.length < count; index++) await Promise.resolve();
        assert.equal(requests.length, count, 'expected image requests have started');
    }
    return { window, host, requests, released, listeners, removed, waitForRequests };
}
function portraitHarness() {
    const h = environment(), component = h.window.ClientTextPortraits.component;
    const app = { ...component.data(), items: [{ id: 'example', game: 'poe2' }], $root: h.host, $nextTick: async () => {} };
    for (const [name, method] of Object.entries(component.methods)) app[name] = method.bind(app);
    Object.defineProperty(app, 'mediaKey', { get: () => component.computed.mediaKey.call(app) });
    return { ...h, app, component };
}
function skillHarness() {
    const h = environment(), component = h.window.ClientTextSkillCardUI.mixin;
    const app = { ...component.data(), ...h.host, $nextTick: async () => {},
        ctSkillBaseModel: { assets: { game: 'poe2', id: 'example', icon: true, background: true } } };
    for (const [name, method] of Object.entries(component.methods)) app[name] = method.bind(app);
    Object.defineProperty(app, 'ctSkillAssetKey', { get: () => component.computed.ctSkillAssetKey.call(app) });
    return { ...h, app, component };
}

test('portrait replacement aborts prior request and releases an ignored-abort late lease', async () => {
    const h = portraitHarness(), first = h.app.loadImages(); await h.waitForRequests(1);
    const old = h.requests[0]; assert.equal(old.options.signal.aborted, false); assert.equal(old.kind, 'image');
    h.app.items = [{ id: 'replacement', game: 'poe1' }];
    const second = h.app.loadImages(); assert.equal(old.options.signal.aborted, true); await h.waitForRequests(2);
    assert.equal(h.requests[1].path, '/portraits/poe1/replacement.webp?v=4');
    old.finish(); await first;
    assert.equal(Object.keys(h.app.images).length, 0); assert.deepEqual(h.released, ['blob:image-0']);
    const current = h.requests[1].finish(); await second;
    assert.equal(h.app.url('replacement', 'poe1'), current.url); assert.equal(h.app.url('example', 'poe2'), '');
    h.app.clearImages(); assert.deepEqual(h.released, ['blob:image-0', current.url]);
});

test('portrait unmount aborts all concurrent images and rejects late results without retained leases', async () => {
    const h = portraitHarness(); h.app.items.push({ id: 'another', game: 'poe2' });
    h.component.mounted.call(h.app); const pending = h.app.loadImages(); await h.waitForRequests(2);
    assert.equal(h.requests[0].options.signal, h.requests[1].options.signal);
    h.component.beforeUnmount.call(h.app);
    assert.ok(h.requests.every(request => request.options.signal.aborted)); assert.equal(h.app._mediaAbort, null);
    h.requests.forEach(request => request.finish()); await pending;
    assert.deepEqual(h.released, ['blob:image-0', 'blob:image-1']); assert.equal(h.app._mediaLeases.length, 0);
    assert.equal(Object.keys(h.app.images).length, 0); assert.equal(h.removed[0].callback, h.listeners[0].callback);
});

test('portrait access/scope replacement clears displayed media and never starts denied requests', async () => {
    const h = portraitHarness(), pending = h.app.loadImages(); await h.waitForRequests(1);
    const lease = h.requests[0].finish(); await pending; assert.equal(h.app.images['poe2:example'], lease.url);
    const key = h.app.mediaKey; h.host.privateMediaKey = 'signed-out'; h.host.privateMediaAllowed = false;
    assert.notEqual(h.app.mediaKey, key); assert.equal(h.component.watch.mediaKey.flush, 'sync');
    h.component.watch.mediaKey.handler.call(h.app);
    assert.equal(h.requests.length, 1); assert.deepEqual(h.released, [lease.url]); assert.equal(Object.keys(h.app.images).length, 0);
    assert.equal(h.requests[0].options.signal.aborted, true);
});

test('portrait unmount before next paint makes no request; aborted errors leave placeholders usable', async () => {
    const h = portraitHarness(), tick = deferred(); h.app.$nextTick = () => tick.promise;
    const pending = h.app.loadImages(); h.component.beforeUnmount.call(h.app); tick.resolve(); await pending;
    assert.equal(h.requests.length, 0);
    const b = portraitHarness(), load = b.app.loadImages(); await b.waitForRequests(1);
    b.app.clearImages(); b.requests[0].reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); await load;
    assert.equal(Object.keys(b.app.images).length, 0); assert.equal(b.released.length, 0);
});

test('skill replacement aborts pending images and releases both settled and late obsolete leases', async () => {
    const h = skillHarness(), first = h.app.ctLoadSkillImages(); await h.waitForRequests(2);
    assert.equal(h.requests[0].options.signal, h.requests[1].options.signal);
    assert.equal(h.requests[0].options.context.key, h.app.privateMediaKey);
    assert.equal(h.requests[0].path, '/skill-assets/poe2/example/icon');
    assert.equal(h.requests[1].path, '/skill-assets/poe2/example/background');
    const oldIcon = h.requests[0].finish(); await Promise.resolve(); await Promise.resolve();
    assert.equal(h.app.ctSkillImages.icon, oldIcon.url);
    h.app.ctSkillBaseModel = { assets: { game: 'poe2', id: 'replacement', icon: true, background: false } };
    const second = h.app.ctLoadSkillImages(); assert.equal(h.requests[1].options.signal.aborted, true);
    assert.deepEqual(h.released, [oldIcon.url]); assert.equal(Object.keys(h.app.ctSkillImages).length, 0);
    await h.waitForRequests(3); const staleBackground = h.requests[1].finish(); await first;
    assert.deepEqual(h.released, [oldIcon.url, staleBackground.url]); assert.equal(Object.keys(h.app.ctSkillImages).length, 0);
    const current = h.requests[2].finish(); await second; assert.equal(h.app.ctSkillImages.icon, current.url);
    h.app.ctClearSkillImages(); assert.deepEqual(h.released, [oldIcon.url, staleBackground.url, current.url]);
});

test('skill scope/access change aborts requests and never publishes previous-scope art', async () => {
    for (const denied of [false, true]) {
        const h = skillHarness(), pending = h.app.ctLoadSkillImages(); await h.waitForRequests(2);
        const previous = h.app.ctSkillAssetKey; h.app.privateMediaKey = 'alice:French:source2:access2';
        if (denied) h.app.privateMediaAllowed = false;
        assert.notEqual(h.app.ctSkillAssetKey, previous); assert.equal(h.component.watch.ctSkillAssetKey.flush, 'sync');
        h.component.watch.ctSkillAssetKey.handler.call(h.app);
        assert.ok(h.requests.slice(0, 2).every(request => request.options.signal.aborted));
        h.requests.slice(0, 2).forEach(request => request.finish()); await pending;
        assert.equal(Object.keys(h.app.ctSkillImages).length, 0); assert.equal(h.released.length, 2);
        if (!denied) {
            await h.waitForRequests(4);
            assert.equal(h.requests[2].options.context.key, h.app.privateMediaKey);
            h.app.ctClearSkillImages(); h.requests.slice(2).forEach(request => request.finish());
            await Promise.resolve(); await Promise.resolve();
        } else assert.equal(h.requests.length, 2);
    }
});

test('skill unmount aborts both images, releases late leases and removes online listener', async () => {
    const h = skillHarness(); h.component.mounted.call(h.app);
    const pending = h.app.ctLoadSkillImages(); await h.waitForRequests(2);
    h.component.beforeUnmount.call(h.app);
    assert.ok(h.requests.every(request => request.options.signal.aborted)); assert.equal(h.app._ctSkillImageAbort, null);
    h.requests.forEach(request => request.finish()); await pending;
    assert.deepEqual(h.released, ['blob:image-0', 'blob:image-1']); assert.equal(h.app._ctSkillImageLeases.length, 0);
    assert.equal(Object.keys(h.app.ctSkillImages).length, 0); assert.equal(h.removed[0].callback, h.listeners[0].callback);
});

test('skill cancellation before next paint avoids requests and image failures preserve text-only fallback', async () => {
    const h = skillHarness(), tick = deferred(); h.app.$nextTick = () => tick.promise;
    const pending = h.app.ctLoadSkillImages(); h.component.beforeUnmount.call(h.app); tick.resolve(); await pending;
    assert.equal(h.requests.length, 0);
    const b = skillHarness(), load = b.app.ctLoadSkillImages(); await b.waitForRequests(2);
    b.requests.forEach(request => request.reject(Object.assign(new Error('denied'), { status: 403 })));
    await load; assert.equal(Object.keys(b.app.ctSkillImages).length, 0); assert.equal(b.released.length, 0);
});
