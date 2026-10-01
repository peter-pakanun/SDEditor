/* Focused checks for comments scope, network races, retry safety, and visible-only reads. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/commentsUi.js'), 'utf8');
const HASH_A = 'a'.repeat(64), HASH_B = 'b'.repeat(64);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const copy = value => JSON.parse(JSON.stringify(value));
const comment = (id, extra = {}) => ({ id, game: 'poe1', filepath: 'Metadata/test.txt', sourceHash: HASH_A,
  body: 'Comment ' + id, actorId: 'other', actorName: 'Other translator', language: 'German', createdAt: '2026-10-01T00:00:00.000Z', unread: true, ...extra });
const node = id => ({ dataset: { commentId: String(id), commentsSurface: 'file' }, isConnected: true });

function fixture(handler = async () => ({ total: 0, files: [], items: [], nextCursor: null })) {
  const timers = new Map(), observers = [], calls = [];
  let timerId = 0, uuid = 0;
  const document = { hidden: false, activeElement: null, addEventListener() {}, removeEventListener() {} };
  const window = { addEventListener() {}, removeEventListener() {} };
  class Observer {
    constructor(callback) { this.callback = callback; this.nodes = []; observers.push(this); }
    observe(element) { this.nodes.push(element); }
    disconnect() { this.disconnected = true; }
    emit(entries) { this.callback(entries); }
  }
  vm.runInNewContext(source, { window, document, URLSearchParams,
    IntersectionObserver: Observer, crypto: { randomUUID: () => 'mutation-' + (++uuid) },
    setTimeout: callback => { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id), setInterval: () => ++timerId, clearInterval() {},
  });
  const mixin = window.CommentsUI.mixin;
  const app = { ...mixin.data(), testMode: false, cloudSignedIn: true,
    cloudUser: { id: 'account-a', language: 'Thai', assignmentVersion: 1 }, gameVersion: 'poe1', lang: 'Japanese',
    sourceIdentity: HASH_A, versionStorageLoading: false, editorVisible: true, sideTab: 'comments',
    editorCurrentEditingDesc: { filepath: 'Metadata/test.txt' }, $refs: {}, $nextTick: async () => {},
  };
  app._cloud = { context: () => ({ account: app.cloudUser.id }), request: (url, options = {}, auth) => {
    calls.push(copy({ url, options, auth })); return handler(url, options, auth, app);
  } };
  for (const [key, method] of Object.entries(mixin.methods)) app[key] = method.bind(app);
  for (const [key, value] of Object.entries(mixin.computed)) {
    const get = typeof value === 'function' ? value : value.get;
    Object.defineProperty(app, key, { get: get.bind(app), ...(value.set ? { set: value.set.bind(app) } : {}) });
  }
  return { app, document, calls, observers, timers, destroy: () => mixin.beforeUnmount.call(app) };
}

const tests = [];
const test = (name, run) => tests.push({ name, run });

test('all assigned teams can read across selected language and source hash', async () => {
  const { app } = fixture();
  app.sourceIdentity = '';
  assert.equal(app.commentsEligible, true);
  assert.equal(app.commentsCanPost, false);
  app.sourceIdentity = HASH_A;
  assert.equal(app.commentsCanPost, true);
  app.lang = 'French';
  assert.equal(app.commentsEligible, true);
  assert.equal(app.commentsDifferentHash(comment(1, { sourceHash: HASH_B })), true);
  app.cloudUser.language = null;
  assert.equal(app.commentsEligible, false);
  app.cloudUser.language = 'Thai'; app.testMode = true;
  assert.equal(app.commentsEligible, false);
});

test('background refresh preserves content, empty-state and accessible busy state until confirmed changes', async () => {
  const pending = deferred();
  const { app } = fixture(() => pending.promise);
  app.commentsFileFeed.loaded = true;
  app.commentsFileFeed.items = [comment(5)];
  const items = app.commentsFileItems;
  const refresh = app.commentsRefreshFile();
  assert.equal(app.commentsFileFeed.loaded, true);
  assert.equal(app.commentsFileItems, items);
  assert.equal(app.commentsFileBusy, false);
  assert.equal(app.commentsFileFeed.loadingMore, false);
  pending.resolve({ items: [comment(5)], nextCursor: null });
  await refresh;
  app.commentsFileFeed.items = [];
  const emptyRefresh = app.commentsRefreshFile();
  assert.equal(app.commentsFileFeed.loaded && !app.commentsFileItems.length, true);
  assert.equal(app.commentsFileBusy, false);
  await emptyRefresh;
});

test('comment fetch errors stay visible through retries and clear only after success', async () => {
  const failed = deferred(), recovered = deferred();
  let attempts = 0;
  const { app } = fixture(() => ++attempts === 1 ? failed.promise : recovered.promise);
  app.commentsFileFeed.loaded = true;
  app.commentsFileFeed.items = [comment(5)];
  app.commentsFileFeed.error = 'Previous network failure';
  const retry = app.commentsRefreshFile();
  assert.equal(app.commentsFileError, 'Previous network failure');
  failed.reject(new Error('Still offline')); await retry;
  assert.match(app.commentsFileError, /Still offline/);
  const recovery = app.commentsRefreshFile();
  assert.match(app.commentsFileError, /Still offline/);
  recovered.resolve({ items: [comment(5)], nextCursor: null }); await recovery;
  assert.equal(app.commentsFileError, '');
});

test('Load older comments requested during silent refresh runs after the refresh', async () => {
  const pending = deferred();
  const { app, calls } = fixture(url => url.includes('before=')
    ? { items: [comment(4)], nextCursor: null } : pending.promise);
  Object.assign(app.commentsFileFeed, { loaded: true, items: [comment(5)], loadedIds: [5], cursor: 5 });
  const refresh = app.commentsRefreshFile();
  assert.equal(app.commentsFileBusy, false);
  await app.commentsLoadMoreFile();
  assert.equal(app.commentsFileBusy, true);
  assert.equal(calls.length, 1);
  pending.resolve({ items: [comment(6), comment(5)], nextCursor: 5 }); await refresh;
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /before=5/);
  assert.deepEqual(Array.from(app.commentsFileItems, item => item.id), [6, 5, 4]);
  assert.equal(app.commentsFileBusy, false);
});

test('successful unread-count polling does not hide a failed read acknowledgement', async () => {
  const { app } = fixture(async () => ({ total: 1, files: [{ filepath: 'Metadata/test.txt', count: 1 }] }));
  app.commentsUnreadReadError = 'Read acknowledgement failed';
  app.commentsUnreadFetchError = 'Unread counts unavailable';
  await app.commentsRefreshUnread();
  assert.equal(app.commentsUnreadFetchError, '');
  assert.equal(app.commentsUnreadError, 'Read acknowledgement failed');
});

test('a late file fetch cannot overwrite a switched file, including return to the same file', async () => {
  const pending = deferred();
  const { app } = fixture(() => pending.promise);
  const load = app.commentsRefreshFile();
  app.sideTab = 'dictionary';
  app.editorCurrentEditingDesc = { filepath: 'Metadata/other.txt' }; app.commentsResetFile();
  app.editorCurrentEditingDesc = { filepath: 'Metadata/test.txt' }; app.commentsResetFile();
  pending.resolve({ items: [comment(1)], nextCursor: null });
  await load;
  assert.equal(app.commentsFileItems.length, 0);
  assert.equal(app.commentsFileLoading, false);
});

test('account and game round trips invalidate old responses', async () => {
  for (const field of ['account', 'game']) {
    const pending = deferred();
    const { app } = fixture(() => pending.promise);
    const load = app.commentsRefreshFile();
    app.sideTab = 'dictionary'; app.commentsPoll = async () => {};
    if (field === 'account') app.cloudUser = { ...app.cloudUser, id: 'account-b' };
    else app.gameVersion = 'poe2';
    app.commentsResetContext();
    if (field === 'account') app.cloudUser = { ...app.cloudUser, id: 'account-a' };
    else app.gameVersion = 'poe1';
    app.commentsResetContext();
    pending.resolve({ items: [comment(1)], nextCursor: null });
    await load;
    assert.equal(app.commentsFileItems.length, 0);
  }
});

test('comment drafts survive file switching and stay isolated by account, game, and source hash', async () => {
  const { app } = fixture();
  app.commentsFileDraft = 'Keep this thought';
  app.editorCurrentEditingDesc = { filepath: 'Metadata/other.txt' };
  assert.equal(app.commentsFileDraft, '');
  app.commentsFileDraft = 'Other file';
  app.editorCurrentEditingDesc = { filepath: 'Metadata/test.txt' };
  assert.equal(app.commentsFileDraft, 'Keep this thought');
  app.gameVersion = 'poe2'; assert.equal(app.commentsFileDraft, ''); app.gameVersion = 'poe1';
  app.sourceIdentity = HASH_B; assert.equal(app.commentsFileDraft, ''); app.sourceIdentity = HASH_A;
  app.cloudUser.id = 'account-b'; assert.equal(app.commentsFileDraft, ''); app.cloudUser.id = 'account-a';
  app.lang = 'French'; assert.equal(app.commentsFileDraft, 'Keep this thought');
});

test('an ambiguous post failure preserves draft and reuses its mutation ID on retry', async () => {
  let attempt = 0;
  const { app, calls } = fixture(async () => {
    if (++attempt === 1) throw new Error('Connection lost after send');
    return { item: comment(5, { actorId: 'account-a', unread: false }) };
  });
  app.commentsFileDraft = '  Keep this comment  ';
  assert.equal(await app.commentsSubmit(), false);
  assert.equal(app.commentsFileDraft, '  Keep this comment  ');
  assert.equal(app.commentsPosting, false);
  assert.match(app.commentsPostError, /draft is kept/);
  assert.equal(await app.commentsSubmit(), true);
  assert.equal(calls[0].options.body.mutationId, calls[1].options.body.mutationId);
  assert.equal(calls[0].options.body.body, 'Keep this comment');
  assert.equal(calls[0].options.body.sourceHash, HASH_A);
  assert.equal(app.commentsFileDraft, '');
  assert.equal(app.commentsFileItems.length, 1);
});

test('pending posts cannot duplicate and new text typed during a post remains', async () => {
  const pending = deferred();
  const { app, calls } = fixture(() => pending.promise);
  app.commentsFileDraft = 'First thought';
  const send = app.commentsSubmit();
  assert.equal(app.commentsPosting, true);
  assert.equal(await app.commentsSubmit(), false);
  app.commentsFileDraft = 'New thought while sending';
  pending.resolve({ item: comment(5, { actorId: 'account-a', unread: false }) });
  assert.equal(await send, true);
  assert.equal(calls.length, 1);
  assert.equal(app.commentsFileDraft, 'New thought while sending');
  assert.equal(app.commentsPosting, false);
});

test('a post completing after a file switch clears only its original draft', async () => {
  const pending = deferred();
  const { app } = fixture(() => pending.promise);
  app.commentsFileDraft = 'Original file';
  const send = app.commentsSubmit();
  app.sideTab = 'dictionary';
  app.editorCurrentEditingDesc = { filepath: 'Metadata/other.txt' }; app.commentsResetFile();
  app.commentsFileDraft = 'Different file draft';
  pending.resolve({ item: comment(5, { actorId: 'account-a', unread: false }) });
  await send;
  assert.equal(app.commentsFileDraft, 'Different file draft');
  assert.equal(app.commentsFileItems.length, 0);
  app.editorCurrentEditingDesc = { filepath: 'Metadata/test.txt' };
  assert.equal(app.commentsFileDraft, '');
});

test('posting before the first successful list keeps older pages reachable', async () => {
  const { app } = fixture(async (url) => url === '/v1/comments'
    ? { item: comment(100, { actorId: 'account-a', unread: false }) }
    : { items: [comment(100, { actorId: 'account-a', unread: false }), comment(99)], nextCursor: 99 });
  app.commentsFileDraft = 'New';
  await app.commentsSubmit();
  assert.equal(app.commentsFileFeed.loaded, false);
  await app.commentsRefreshFile();
  assert.equal(app.commentsFileFeed.cursor, 99);
  assert.equal(app.commentsFileHasMore, true);
});

test('head polling preserves loaded pages on overlap and resets a gap without dropping pagination', async () => {
  const pages = [
    { items: [comment(10), comment(9)], nextCursor: 9 },
    { items: [comment(8), comment(7)], nextCursor: 7 },
    { items: [comment(11), comment(10)], nextCursor: 10 },
    { items: [comment(30), comment(29)], nextCursor: 29 },
  ];
  const { app, calls } = fixture(async () => pages.shift());
  await app.commentsRefreshFile(); await app.commentsLoadMoreFile(); await app.commentsRefreshFile();
  assert.deepEqual(Array.from(app.commentsFileItems, item => item.id), [11, 10, 9, 8, 7]);
  assert.equal(app.commentsFileFeed.cursor, 7);
  assert.match(calls[1].url, /before=9/);
  await app.commentsRefreshFile();
  assert.deepEqual(Array.from(app.commentsFileItems, item => item.id), [30, 29]);
  assert.equal(app.commentsFileFeed.cursor, 29);
});

test('an own post cannot hide a gap larger than the refresh page', async () => {
  let lists = 0;
  const { app } = fixture(async url => {
    if (url === '/v1/comments') return { item: comment(200, { unread: false, actorId: 'account-a' }) };
    return ++lists === 1 ? { items: [comment(50), comment(49)], nextCursor: null }
      : { items: [comment(200, { unread: false, actorId: 'account-a' }), comment(199)], nextCursor: 199 };
  });
  await app.commentsRefreshFile();
  app.commentsFileDraft = 'My new post after many remote comments';
  await app.commentsSubmit();
  await app.commentsRefreshFile();
  assert.equal(app.commentsFileFeed.cursor, 199);
  assert.deepEqual(Array.from(app.commentsFileItems, item => item.id), [200, 199]);
});

test('a context reset cancels and releases the pending read timer', async () => {
  const { app, timers } = fixture();
  app.commentsScheduleRead();
  const oldTimer = app._commentsReadTimer;
  assert.equal(timers.has(oldTimer), true);
  app.sideTab = 'dictionary'; app.commentsPoll = async () => {};
  app.commentsResetContext();
  assert.equal(timers.has(oldTimer), false);
  assert.equal(app._commentsReadTimer, null);
  app.commentsScheduleRead();
  assert.notEqual(app._commentsReadTimer, oldTimer);
  assert.equal(timers.has(app._commentsReadTimer), true);
});

test('only intersecting unread rows are acknowledged; loaded and future comments stay unread', async () => {
  const { app, calls, observers } = fixture(async () => ({ total: 2, files: [{ filepath: 'Metadata/test.txt', count: 2 }] }));
  app.commentsFileFeed.items = [comment(5), comment(4), comment(3, { unread: false, actorId: 'account-a' })];
  const visible = node(5), offscreen = node(4), own = node(3);
  app.$refs.commentsFileList = { querySelectorAll: () => [visible, offscreen, own] };
  await app.commentsObserveVisible();
  assert.equal(calls.length, 0);
  observers.at(-1).emit([
    { target: visible, isIntersecting: true, intersectionRatio: 0.8 },
    { target: offscreen, isIntersecting: false, intersectionRatio: 0 },
    { target: own, isIntersecting: true, intersectionRatio: 1 },
  ]);
  await app.commentsMarkVisibleRead();
  assert.deepEqual(calls[0].options.body.ids, [5]);
  assert.equal(app.commentsUnreadTotal, 2);
  assert.equal(app.commentsFileItems.find(item => item.id === 4).unread, true);
  assert.equal(app.commentsFileItems.find(item => item.id === 5).unread, false);
  await app.commentsMarkVisibleRead();
  assert.equal(calls.length, 1);
});

test('hidden pages, closed surfaces, and detached rows never clear unread state', async () => {
  for (const state of ['hidden', 'closed', 'detached', 'importDialogVisible', 'consistencyResolver', 'cloudResolverVisible',
    'cloudHistoryVisible', 'duplicateLangImportWarning', 'settingsImportDraft', 'collaborationConflictVisible', 'collaborationHistoryVisible', 'diagnostic']) {
    const { app, document, calls } = fixture();
    app.commentsFileFeed.items = [comment(5)];
    const element = node(5);
    app._commentsVisible = new Map([[element, { id: 5, surface: 'file' }]]);
    if (state === 'hidden') document.hidden = true;
    if (state === 'closed') app.sideTab = 'dictionary';
    if (state === 'detached') element.isConnected = false;
    if (state === 'diagnostic') app.$refs.diagnosticScanDialog = { open: true };
    else if (!['hidden', 'closed', 'detached'].includes(state)) app[state] = true;
    await app.commentsMarkVisibleRead();
    assert.equal(calls.length, 0);
  }
});

test('a stale unread fetch cannot restore counts after read acknowledgement', async () => {
  const oldCounts = deferred();
  const { app } = fixture((url) => url.includes('/unread') ? oldCounts.promise : Promise.resolve({ total: 1, files: [] }));
  const fetch = app.commentsRefreshUnread();
  app.commentsFileFeed.items = [comment(5)];
  app._commentsVisible = new Map([[node(5), { id: 5, surface: 'file' }]]);
  await app.commentsMarkVisibleRead();
  oldCounts.resolve({ total: 99, files: [] });
  await fetch;
  assert.equal(app.commentsUnreadTotal, 1);
});

test('failed read acknowledgements retain counts and retry without marking unseen rows', async () => {
  let attempt = 0;
  const { app, calls } = fixture(async () => {
    if (++attempt === 1) throw new Error('Offline');
    return { total: 1, files: [] };
  });
  app.commentsUnreadTotal = 2;
  app.commentsFileFeed.items = [comment(5), comment(4)];
  app._commentsVisible = new Map([[node(5), { id: 5, surface: 'file' }]]);
  await app.commentsMarkVisibleRead();
  assert.equal(app.commentsUnreadTotal, 2);
  assert.equal(app.commentsFileItems[0].unread, true);
  assert.match(app.commentsUnreadError, /Could not update/);
  await app.commentsMarkVisibleRead();
  assert.equal(app.commentsUnreadTotal, 1);
  assert.deepEqual(calls.map(call => call.options.body.ids), [[5], [5]]);
  assert.equal(app.commentsFileItems[1].unread, true);
});

test('polling and list requests do not overlap, and background tabs do not poll', async () => {
  const pending = deferred();
  const { app, calls, document } = fixture(() => pending.promise);
  const poll = app.commentsPoll();
  await app.commentsPoll(); await app.commentsRefreshFile();
  assert.equal(calls.length, 2);
  pending.resolve({ items: [], nextCursor: null, total: 0, files: [] });
  await poll;
  document.hidden = true; await app.commentsPoll();
  assert.equal(calls.length, 2);
});

test('unmount invalidates pending responses and disconnects the visibility observer', async () => {
  const pending = deferred();
  const { app, observers, destroy } = fixture(() => pending.promise);
  await app.commentsObserveVisible();
  const load = app.commentsRefreshFile();
  destroy();
  pending.resolve({ items: [comment(5)], nextCursor: null });
  await load;
  assert.equal(app.commentsFileItems.length, 0);
  assert.equal(observers.at(-1).disconnected, true);
});

(async () => {
  for (const { name, run } of tests) {
    await run();
    console.log('PASS ' + name);
  }
  console.log(`${tests.length}/${tests.length} comments UI checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
