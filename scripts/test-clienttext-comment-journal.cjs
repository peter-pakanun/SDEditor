'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const { randomUUID } = require('node:crypto');
const State = require('../public/clientTextState.js'), Store = require('../public/clientTextStore.js');
const { fixture, scope, unit } = require('./clienttext-storage-fixture.cjs');
const copy = value => structuredClone(value);
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const authored = '  Exact \\n literal\r\nsecond\n@value <img>\t  ';
function harness(store, changes = {}) {
    const timers = new Map(); let timerId = 0;
    const window = { ClientTextState: State, ClientTextStore: Store, crypto: { randomUUID }, Vue: { markRaw: value => value } };
    const context = vm.createContext({ window, console, Blob, File, TextEncoder, AbortController,
        setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; }, clearTimeout(id) { timers.delete(id); },
        setInterval() {}, clearInterval() {} });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/clientTextUi.js'), 'utf8'), context);
    const original = unit(), mixin = window.ClientTextUI.mixin;
    const app = { ...mixin.data(), managedCatalogScope: 'alice:poe2:default', cloudProfileId: scope.accountId,
        gameVersion: scope.game, branchId: scope.branchId, lang: scope.language,
        cloudUser: { id: scope.accountId, role: 'manager', language: scope.language }, cloudCanAccessAllLanguages: true,
        managedOnlineAvailable: true, ctWorkspace: { scope: copy(scope) }, ctActive: true, ctSelection: original.id,
        _ctStore: store, _ctUnitIndex: new Map([[original.id, original]]), ctCommentPostError: '', ...changes };
    for (const [name, method] of Object.entries(mixin.methods)) app[name] = method.bind(app);
    const owner = { accountId: scope.accountId, game: scope.game, branchId: scope.branchId };
    return { app, original, owner, timers, key: () => app.ctReplyCommentKey(app.ctContext(), original.id) };
}
async function replyJournal(store, owner, key) { return (await store.getRequest(owner, key))?.payload; }
function changeScope(app, kind) {
    app.ctWorkspace = { scope: { ...scope, ...(kind === 'account' ? { accountId: 'bob' } : { groupId: 'new-group' }) } };
    app.managedCatalogScope = kind === 'account' ? 'bob:poe2:default' : app.managedCatalogScope;
    app.cloudProfileId = kind === 'account' ? 'bob' : scope.accountId;
    app.ctCommentPostError = 'Current workspace warning'; app.ctCommentText = 'Current composer'; app.ctBusy = false;
}
test('All-comments drafts roundtrip exact raw text, audience and captured per-record identities', async () => {
    const f = fixture(), { app, original, owner, key } = harness(f.store), firstKey = key();
    app.ctQueueReplyCommentDraft(original.id, { body: authored, allLanguages: true }); await app.ctFlushReplyCommentDrafts();
    const secondId = JSON.stringify(['normal', 'OtherSheet', 'ID/1']);
    app.ctQueueReplyCommentDraft(secondId, { body: 'Other record', allLanguages: false }); await app.ctFlushReplyCommentDrafts();
    assert.equal((await replyJournal(f.store, owner, firstKey)).text, authored);
    assert.notEqual(app.ctReplyCommentKey(app.ctContext(), secondId), firstKey);
    const reloaded = harness(f.store);
    assert.deepEqual(plain(await reloaded.app.ctLoadReplyCommentDraft(original.id)), { body: authored, allLanguages: true });
    assert.deepEqual(plain(await reloaded.app.ctLoadReplyCommentDraft(secondId)), { body: 'Other record', allLanguages: false });
});
test('failed All-comments POST keeps its exact frozen envelope for replay after reload', async () => {
    const f = fixture(), sent = [], { app, original, owner, key } = harness(f.store);
    app._cloud = { async request(route, options) { sent.push({ route, body: plain(options.body) }); throw new Error('Uncertain response'); } };
    assert.equal(await app.ctPostReplyComment(original.id, { body: authored, allLanguages: true }), false);
    const pending = await replyJournal(f.store, owner, key()); assert.equal(pending.text, authored); assert.deepEqual(plain(pending.post), sent[0].body);
    assert.equal(app.ctCommentPostError, 'Uncertain response');
    const reloaded = harness(f.store); reloaded.app._cloud = { async request(route, options) { sent.push({ route, body: plain(options.body) }); } };
    const restored = await reloaded.app.ctLoadReplyCommentDraft(original.id);
    assert.equal(await reloaded.app.ctPostReplyComment(original.id, restored), true);
    assert.deepEqual(sent[1], sent[0]); assert.equal(await replyJournal(f.store, owner, key()), undefined);
});
test('earlier uncertain reply replays first and retains a newer authored draft for its separate POST', async () => {
    const f = fixture(), sent = [], { app, original, owner, key } = harness(f.store);
    app._cloud = { async request(_route, options) { sent.push(plain(options.body)); throw new Error('Lost ACK'); } };
    await app.ctPostReplyComment(original.id, { body: authored, allLanguages: false });
    const reloaded = harness(f.store), newer = { body: ' Newer\r\ndraft \\n ', allLanguages: true };
    reloaded.app._cloud = { async request(_route, options) { sent.push(plain(options.body)); } };
    assert.equal(await reloaded.app.ctPostReplyComment(original.id, newer), false, 'Only the earlier envelope was confirmed');
    assert.deepEqual(sent[1], sent[0]);
    const retained = await replyJournal(f.store, owner, key()); assert.equal(retained.text, newer.body); assert.equal(retained.audience, 'global'); assert.equal(retained.post, undefined);
    assert.match(reloaded.app.ctCommentPostError, /earlier comment was confirmed/);
    assert.equal(await reloaded.app.ctPostReplyComment(original.id, newer), true);
    assert.equal(sent[2].text, newer.body); assert.equal(sent[2].audience, 'global'); assert.notEqual(sent[2].idempotencyKey, sent[0].idempotencyKey);
    assert.equal(await replyJournal(f.store, owner, key()), undefined);
});
test('queued authored text completing beside an ACK keeps the new checkpoint and consumes only the old envelope', async () => {
    const f = fixture(), started = deferred(), posted = deferred(), writing = deferred(), writeHeld = deferred();
    const store = { ...f.store, async putRequest(owner, key, payload, options) {
        if (payload.text === 'Newer during ACK') { writing.resolve(); await writeHeld.promise; }
        return f.store.putRequest(owner, key, payload, options);
    } };
    const { app, original, owner, key } = harness(store);
    app._cloud = { async request() { started.resolve(); await posted.promise; } };
    const posting = app.ctPostReplyComment(original.id, { body: authored, allLanguages: false }); await started.promise;
    app.ctQueueReplyCommentDraft(original.id, { body: 'Newer during ACK', allLanguages: true });
    const checkpoint = app.ctFlushReplyCommentDrafts(); await writing.promise;
    posted.resolve(); writeHeld.resolve(); await Promise.all([posting, checkpoint]);
    const retained = await replyJournal(f.store, owner, key()); assert.equal(retained.text, 'Newer during ACK'); assert.equal(retained.audience, 'global'); assert.equal(retained.post, undefined);
});
test('typing after frozen-envelope creation retains that envelope across failed acknowledgement', async () => {
    const f = fixture(), started = deferred(), posted = deferred(), { app, original, owner, key } = harness(f.store);
    app._cloud = { async request() { started.resolve(); await posted.promise; throw new Error('Lost ACK'); } };
    const posting = app.ctPostReplyComment(original.id, { body: authored, allLanguages: false }); await started.promise;
    const frozen = (await replyJournal(f.store, owner, key())).post;
    app.ctQueueReplyCommentDraft(original.id, { body: 'Typed after sending', allLanguages: true }); await app.ctFlushReplyCommentDrafts();
    posted.resolve(); assert.equal(await posting, false);
    const retained = await replyJournal(f.store, owner, key()); assert.equal(retained.text, 'Typed after sending'); assert.deepEqual(retained.post, frozen);
});
test('typing during slow POST preparation cannot change the explicitly submitted comment body', async () => {
    const f = fixture(), entered = deferred(), held = deferred(); let first = true;
    const { app, original, owner, key } = harness({ ...f.store, async getRequest(...args) {
        if (first) { first = false; entered.resolve(); await held.promise; } return f.store.getRequest(...args);
    } }), sent = [];
    app._cloud = { async request(_route, options) { sent.push(plain(options.body)); } };
    const posting = app.ctPostReplyComment(original.id, { body: authored, allLanguages: false }); await entered.promise;
    app.ctQueueReplyCommentDraft(original.id, { body: 'Typed during preparation', allLanguages: true });
    const checkpoint = app.ctFlushReplyCommentDrafts(); held.resolve();
    await checkpoint; assert.equal(await posting, true);
    assert.equal(sent[0].text, authored); assert.equal(sent[0].audience, 'language');
    const retained = await replyJournal(f.store, owner, key()); assert.equal(retained.text, 'Typed during preparation'); assert.equal(retained.audience, 'global'); assert.equal(retained.post, undefined);
});
test('blanking a newer draft does not discard or prevent replay of an earlier frozen reply', async () => {
    const f = fixture(), { app, original, owner, key } = harness(f.store), sent = [];
    app._cloud = { async request(_route, options) { sent.push(plain(options.body)); throw new Error('Lost ACK'); } };
    await app.ctPostReplyComment(original.id, { body: authored, allLanguages: false });
    app.ctQueueReplyCommentDraft(original.id, { body: '', allLanguages: true }); await app.ctFlushReplyCommentDrafts();
    app._cloud = { async request(_route, options) { sent.push(plain(options.body)); } };
    assert.equal(await app.ctPostReplyComment(original.id, { body: '', allLanguages: true }), false);
    assert.equal(sent.length, 2); assert.deepEqual(sent[1], sent[0]);
    const retained = await replyJournal(f.store, owner, key()); assert.equal(retained.text, ''); assert.equal(retained.post, undefined);
});
test('late reply checkpoints use captured accounts/groups while stale loads cannot enter the new composer', async () => {
    for (const kind of ['account', 'group']) {
        const f = fixture(), entered = deferred(), held = deferred(); let first = true;
        const wrapped = { ...f.store, async getRequest(...args) { if (first) { first = false; entered.resolve(); await held.promise; } return f.store.getRequest(...args); } };
        const { app, original, owner, key } = harness(wrapped), oldKey = key();
        app.ctQueueReplyCommentDraft(original.id, { body: authored, allLanguages: true }); const saving = app.ctFlushReplyCommentDrafts(); await entered.promise;
        changeScope(app, kind); held.resolve(); await saving;
        const saved = await replyJournal(f.store, owner, oldKey); assert.equal(saved.text, authored); assert.equal(saved.groupId, scope.groupId);
        assert.equal(await replyJournal(f.store, { ...owner, accountId: app.cloudProfileId }, key()), undefined);
        const loading = deferred(), loadEntered = deferred(); app._ctStore = { async getRequest() { loadEntered.resolve(); await loading.promise; return { payload: saved }; } };
        const request = app.ctLoadReplyCommentDraft(original.id); await loadEntered.promise; app._ctEpoch = 1; loading.resolve(); assert.equal(await request, null);
        assert.equal(app.ctCommentText, 'Current composer'); assert.equal(app.ctCommentPostError, 'Current workspace warning');
    }
});
test('ctFence drains pending replies into their captured scope before clearing the active workspace', async () => {
    const f = fixture(), { app, original, owner, key } = harness(f.store), oldKey = key();
    app.ctFlushDraft = async () => true; app.ctResetHistory = () => {};
    app.ctQueueReplyCommentDraft(original.id, { body: authored, allLanguages: true }); app.ctFence();
    changeScope(app, 'account'); await app._ctReplyQueue;
    assert.equal((await replyJournal(f.store, owner, oldKey)).text, authored);
    assert.equal((await f.store.listRequests({ ...owner, accountId: 'bob' })).length, 0);
});
test('account/group changes during reply freeze stop network and retain recoverable authored text', async () => {
    for (const kind of ['account', 'group']) {
        const f = fixture(), entered = deferred(), held = deferred(); let count = 0;
        const { app, original, owner, key } = harness({ ...f.store, async getRequest(...args) {
            if (++count === 2) { entered.resolve(); await held.promise; } return f.store.getRequest(...args);
        } });
        const oldKey = key(), requests = []; app._cloud = { async request(...args) { requests.push(args); } };
        const posting = app.ctPostReplyComment(original.id, { body: authored, allLanguages: false }); await entered.promise;
        changeScope(app, kind); held.resolve(); assert.equal(await posting, false); assert.equal(requests.length, 0);
        assert.equal((await replyJournal(f.store, owner, oldKey)).text, authored); assert.equal(app.ctCommentPostError, 'Current workspace warning');
    }
});
test('late reply success/failure leaves replacement account/group warning and draft untouched', async () => {
    for (const kind of ['account', 'group']) for (const fail of [true, false]) {
        const f = fixture(), started = deferred(), result = deferred(), { app, original, owner, key } = harness(f.store), oldKey = key();
        app._cloud = { async request() { started.resolve(); await result.promise; if (fail) throw new Error('Old scope error'); } };
        const posting = app.ctPostReplyComment(original.id, { body: authored, allLanguages: false }); await started.promise;
        changeScope(app, kind); result.resolve(); assert.equal(await posting, false);
        assert.equal(app.ctCommentText, 'Current composer'); assert.equal(app.ctCommentPostError, 'Current workspace warning');
        assert.equal(!!await replyJournal(f.store, owner, oldKey), fail, 'Only a durable successful ACK consumes the captured old journal');
    }
});
test('main ClientText composer replays an unchanged exact draft after reload with the same durable idempotency key', async () => {
    const f = fixture(), { app, original, owner } = harness(f.store), sent = [];
    app.ctCommentText = authored; app.ctCommentGlobal = true;
    app._cloud = { async request(_route, options) { sent.push(plain(options.body)); throw new Error('Uncertain main reply'); } };
    assert.equal(await app.ctPostComment(), false); assert.equal(app.ctCommentText, authored);
    const reloaded = harness(f.store); await reloaded.app.ctLoadCommentDraft(reloaded.app.ctContext(), original.id);
    assert.equal(reloaded.app.ctCommentText, authored); assert.equal(reloaded.app.ctCommentGlobal, true);
    reloaded.app._cloud = { async request(_route, options) { sent.push(plain(options.body)); } };
    assert.equal(await reloaded.app.ctPostComment(), true); assert.deepEqual(sent[1], sent[0]);
    assert.equal(sent[1].text, authored); assert.equal(sent[1].audience, 'global'); assert.equal(sent[1].language, scope.language);
    assert.equal(await f.store.getRequest(owner, app.ctCommentKey(app.ctContext(), original.id)), undefined);
    assert.equal(reloaded.app.ctCommentText, ''); assert.equal(reloaded.app.ctCommentGlobal, false);
});
test('main composer ACK preserves a newer exact checkpoint without adopting reply-envelope semantics', async () => {
    const f = fixture(), started = deferred(), result = deferred(), { app, original, owner } = harness(f.store);
    app.ctCommentText = authored; app._cloud = { async request() { started.resolve(); await result.promise; } };
    const posting = app.ctPostComment(); await started.promise;
    const newer = ' New main text\r\n \\n '; app.ctCommentText = newer; app.ctCommentGlobal = true; await app.ctFlushCommentDraft();
    result.resolve(); assert.equal(await posting, true);
    const latest = await f.store.getRequest(owner, app.ctCommentKey(app.ctContext(), original.id));
    assert.equal(latest.payload.text, newer); assert.equal(latest.payload.audience, 'global'); assert.equal(app.ctCommentText, newer); assert.equal(app.ctCommentGlobal, true);
});
test('main composer sends its exact submitted checkpoint while newer typing is queued before POST', async () => {
    const f = fixture(), { app, original, owner } = harness(f.store), sent = [], flush = app.ctFlushCommentDraft;
    app.ctCommentText = authored; app.ctCommentGlobal = false;
    app._cloud = { async request(_route, options) { sent.push(plain(options.body)); } };
    // A newer checkpoint can finish before the posting continuation resumes.
    // The caller must consume the captured first command, not re-read the head.
    app.ctFlushCommentDraft = async () => {
        const command = await flush();
        app.ctCommentText = 'Newer while main POST prepares'; app.ctCommentGlobal = true; await flush();
        return command;
    };
    assert.equal(await app.ctPostComment(), true);
    assert.equal(sent[0].text, authored); assert.equal(sent[0].audience, 'language');
    const retained = await f.store.getRequest(owner, app.ctCommentKey(app.ctContext(), original.id));
    assert.equal(retained.payload.text, 'Newer while main POST prepares'); assert.equal(retained.payload.audience, 'global');
});
