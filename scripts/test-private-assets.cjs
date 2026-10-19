const { test } = require('node:test');
const assert = require('node:assert/strict');
const Assets = require('../public/privateAssets.js');
const imagePath = '/skill-assets/poe2/example/icon';
const audioPath = '/audio/poe2db?path=' + encodeURIComponent('4.0/npc/example.ogg');
const webp = () => new Blob(['RIFF0000WEBPsynthetic'], { type: 'image/webp' });
const ogg = () => new Blob([Buffer.concat([Buffer.from('OggS\0'), Buffer.alloc(22)])], { type: 'audio/ogg' });
function harness(options = {}) {
    const calls = [], created = [], revoked = [];
    let context = 'alice:poe2:Thai:source1:access1';
    const loader = Assets.create({ request: async (...args) => { calls.push(args); return webp(); }, current: value => value === context,
        createObjectURL: blob => { const url = 'blob:synthetic-' + created.length; created.push({ blob, url }); return url; },
        revokeObjectURL: url => revoked.push(url), ...options });
    return { loader, calls, created, revoked, get context() { return context; }, change(value) { context = value; } };
}
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

test('authenticated adapter receives captured context and private no-store options; release is idempotent', async () => {
    const h = harness(), lease = await h.loader.load(imagePath, { context: h.context });
    const [path, options, context] = h.calls[0];
    assert.equal(path, imagePath); assert.equal(context, h.context);
    assert.equal(options.responseType, 'blob'); assert.equal(options.cache, 'no-store'); assert.equal(options.credentials, 'omit');
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(JSON.stringify(options).includes('token'), false);
    assert.equal(h.created[0].blob.type, 'image/webp'); assert.equal(lease.url, 'blob:synthetic-0');
    lease.release(); lease.release(); h.loader.clear(); assert.deepEqual(h.revoked, [lease.url]);
});

test('media paths cannot route credentials, arbitrary URLs, query parameters or traversal', async () => {
    const h = harness();
    for (const path of ['https://evil.test/icon.webp', '//evil.test/icon.webp', '/v1/me', imagePath + '?token=secret', imagePath + '#x',
        '/portraits/poe2/../example.webp', '/portraits/poe2/example.svg', '/skill-assets/poe2/example/unknown'])
        await assert.rejects(h.loader.load(path, { context: h.context }), { code: 'PRIVATE_ASSET_PATH' });
    for (const path of ['/audio/poe2db?path=../a.ogg', '/audio/poe2db?path=a.ogg&token=x', '/audio/poe2db?path=%2Fa.ogg', '/audio/poe2db?path=a%252Fb.ogg'])
        await assert.rejects(h.loader.load(path, { context: h.context, kind: 'audio' }), { code: 'PRIVATE_ASSET_PATH' });
    assert.equal(h.calls.length, 0);
    const lease = await h.loader.load('/portraits/poe1/example-name.webp?v=4', { context: h.context }); lease.release();
});

test('clear aborts every request promptly even if the authenticated request ignores abort', async () => {
    const pending = deferred(), calls = [];
    const h = harness({ request: (...args) => { calls.push(args); return pending.promise; } });
    const load = h.loader.load(imagePath, { context: h.context });
    h.loader.clear();
    await assert.rejects(load, { name: 'AbortError' });
    assert.equal(calls[0][1].signal.aborted, true);
    pending.resolve(webp()); await Promise.resolve();
    assert.equal(h.created.length, 0);
});

test('each account/game/language/source/access change rejects stale responses without allocating URLs', async () => {
    for (const changed of ['bob:poe2:Thai:source1:access1', 'alice:poe1:Thai:source1:access1', 'alice:poe2:French:source1:access1',
        'alice:poe2:Thai:source2:access1', 'alice:poe2:Thai:source1:access2']) {
        const pending = deferred(), h = harness({ request: () => pending.promise });
        const load = h.loader.load(imagePath, { context: h.context });
        h.change(changed); pending.resolve(webp());
        await assert.rejects(load, { code: 'PRIVATE_ASSET_STALE', stale: true });
        assert.equal(h.created.length, 0);
    }
});

test('stale context is checked before fetch and after asynchronous Blob inspection', async () => {
    const h = harness();
    await assert.rejects(h.loader.load(imagePath, { context: 'old' }), { stale: true }); assert.equal(h.calls.length, 0);
    const pending = deferred(), blob = webp();
    blob.slice = () => ({ arrayBuffer: () => pending.promise });
    const b = harness({ request: async () => blob });
    const load = b.loader.load(imagePath, { context: b.context });
    await Promise.resolve(); await Promise.resolve();
    b.change('changed'); pending.resolve(new Uint8Array(await webp().arrayBuffer()).buffer);
    await assert.rejects(load, { stale: true }); assert.equal(b.created.length, 0);
});

test('clear revokes all retained leases and dispose prevents new requests', async () => {
    const h = harness(), first = await h.loader.load(imagePath, { context: h.context }), second = await h.loader.load(imagePath, { context: h.context });
    h.loader.clear(); first.release(); second.release();
    assert.deepEqual(h.revoked, [first.url, second.url]);
    h.loader.dispose(); await assert.rejects(h.loader.load(imagePath, { context: h.context }), { name: 'AbortError' });
    assert.equal(h.calls.length, 2);
});

test('external abort and timeout cancel with no URL allocation', async () => {
    const h = harness({ request: () => new Promise(() => {}) }), controller = new AbortController();
    const load = h.loader.load(imagePath, { context: h.context, signal: controller.signal }); controller.abort();
    await assert.rejects(load, { name: 'AbortError' });
    await assert.rejects(h.loader.load(imagePath, { context: h.context, timeoutMs: 5 }), { name: 'AbortError' });
    await assert.rejects(h.loader.load(imagePath, { context: h.context, signal: controller.signal }), { name: 'AbortError' });
    assert.equal(h.created.length, 0);
});

test('bounded typed Blobs reject HTML, SVG, mismatched magic, empty/oversized data and wrong expected MIME', async () => {
    for (const blob of [new Blob(['<html>'], { type: 'text/html' }), new Blob(['<svg/>'], { type: 'image/svg+xml' }),
        new Blob(['invalid'], { type: 'image/webp' }), new Blob([], { type: 'image/webp' }),
        new Blob([Buffer.alloc(Assets.LIMITS.image + 1)], { type: 'image/webp' })]) {
        const h = harness({ request: async () => blob });
        await assert.rejects(h.loader.load(imagePath, { context: h.context })); assert.equal(h.created.length, 0);
    }
    const h = harness();
    await assert.rejects(h.loader.load(imagePath, { context: h.context, mime: 'image/png' }), { code: 'PRIVATE_ASSET_TYPE' });
    for (const maxBytes of [0, -1, Infinity, Assets.LIMITS.image + 1])
        await assert.rejects(h.loader.load(imagePath, { context: h.context, maxBytes }), { code: 'PRIVATE_ASSET_OPTIONS' });
});

test('Ogg and WAV audio get bounded Blob URLs with no native authenticated URL', async () => {
    const h = harness({ request: async () => ogg() });
    const lease = await h.loader.load(audioPath, { context: h.context, kind: 'audio' });
    assert.match(lease.url, /^blob:/); lease.release();
    const wav = Buffer.alloc(44); wav.write('RIFF'); wav.write('WAVE', 8);
    const w = harness({ request: async () => new Blob([wav], { type: 'audio/wav' }) });
    (await w.loader.load('/audio/poe2db?path=example.wav', { context: w.context, kind: 'audio' })).release();
});

test('fetch Response path rejects HTTP failures, oversized declared/streamed bodies and length mismatch', async () => {
    const scenarios = [
        () => new Response('denied', { status: 403 }),
        () => new Response(webp(), { headers: { 'content-type': 'text/html' } }),
        () => new Response(webp(), { headers: { 'content-type': 'image/webp', 'content-length': String(Assets.LIMITS.image + 1) } }),
        () => new Response(Buffer.alloc(100), { headers: { 'content-type': 'image/webp' } }),
        () => new Response(webp(), { headers: { 'content-type': 'image/webp', 'content-length': '10' } })
    ];
    for (const response of scenarios) {
        const h = harness({ request: async () => response() });
        await assert.rejects(h.loader.load(imagePath, { context: h.context, maxBytes: 50 })); assert.equal(h.created.length, 0);
    }
    const h = harness({ request: async () => new Response(webp()) });
    (await h.loader.load(imagePath, { context: h.context })).release();
});

test('stream cancellation and synchronous context changes during URL allocation cannot leak leases', async () => {
    let cancelled = 0;
    const h = harness({ request: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(60)); }, cancel() { cancelled++; } }), { headers: { 'content-type': 'image/webp' } }) });
    await assert.rejects(h.loader.load(imagePath, { context: h.context, maxBytes: 50 }), { code: 'PRIVATE_ASSET_SIZE' });
    assert.equal(cancelled, 1);
    const revoked = []; let valid = true;
    const loader = Assets.create({ request: async () => webp(), current: () => valid, createObjectURL: () => { valid = false; return 'blob:changed'; }, revokeObjectURL: url => revoked.push(url) });
    await assert.rejects(loader.load(imagePath), { stale: true }); assert.deepEqual(revoked, ['blob:changed']);
});
