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
  const document = { hidden: false, activeElement: null, body: {}, addEventListener() {}, removeEventListener() {} };
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

function activeReplyInput({ app, document }) {
  const focusCalls = [], selections = [];
  const input = { isConnected: true, top: 400, selectionStart: 2, selectionEnd: 5, selectionDirection: 'backward',
    matches: selector => selector === '.commentsQuickReply input', getBoundingClientRect() { return { top: this.top }; },
    focus(options) { focusCalls.push(options); document.activeElement = this; },
    setSelectionRange(...selection) { selections.push(selection); },
  };
  const root = { scrollTop: 500, contains: element => element === input && input.isConnected, querySelectorAll: () => [] };
  app.editorVisible = false; app.commentsAllVisible = true; app.$refs.commentsAllList = root; document.activeElement = input;
  return { input, root, focusCalls, selections };
}

const tests = [];
const test = (name, run) => tests.push({ name, run });

test('managers can read without assignment and post in the selected language with isolated drafts', async () => {
  const { app, calls } = fixture(async (url, options) => options.method === 'POST'
    ? { item: comment(100, { body: options.body.body, scopeLanguage: options.body.language }) }
    : { items: [comment(9, { scopeLanguage: 'German' })], nextCursor: null });
  app.cloudUser = { id: 'manager', role: 'manager', language: null, assignmentVersion: 1 };
  app.cloudCanAccessAllLanguages = true;
  app.lang = 'Thai';
  assert.equal(app.commentsEligible, true);
  assert.equal(app.commentsUnavailableReason, '');
  await app.commentsRefreshFile();
  assert.equal(app.commentsFileItems[0].scopeLanguage, 'German');
  app.commentsFileDraft = 'Thai review';
  app.commentsSetReplyDraft('other.txt', 'Thai reply');
  const thaiKey = app.commentsDraftKey;
  app.lang = 'German';
  assert.notEqual(app.commentsDraftKey, thaiKey);
  assert.equal(app.commentsFileDraft, '');
  assert.equal(app.commentsReplyDraft('other.txt'), '');
  app.commentsFileDraft = 'German review';
  await app.commentsSubmit();
  const sent = calls.find(call => call.options.method === 'POST');
  assert.equal(sent.options.body.language, 'German');
  assert.equal(sent.options.body.allLanguages, false);
  app.lang = 'Thai';
  assert.equal(app.commentsFileDraft, 'Thai review');
  assert.equal(app.commentsReplyDraft('other.txt'), 'Thai reply');
});

test('manager role revocation invalidates pending comments and preserves language drafts', async () => {
  const pending = deferred();
  const { app } = fixture(() => pending.promise);
  app.cloudUser = { id: 'manager', role: 'manager', language: null, assignmentVersion: 1 };
  app.cloudCanAccessAllLanguages = true; app.lang = 'Thai'; app.commentsFileDraft = 'Saved draft';
  const oldKey = app.commentsDraftKey;
  const load = app.commentsRefreshFile();
  app.cloudUser.role = 'translator'; app.cloudCanAccessAllLanguages = false;
  assert.equal(app.commentsEligible, false);
  pending.resolve({ items: [comment(5)], nextCursor: null });
  await load;
  assert.equal(app.commentsFileItems.length, 0);
  assert.equal(app.commentsDrafts[oldKey], 'Saved draft');
});

test('all comments group by latest activity with oldest-first conversation rows across languages and hashes', async () => {
  const { app } = fixture();
  assert.equal(app.commentsAllGroups.length, 0);
  const items = [
    comment(9, { filepath: 'Metadata/other.txt', language: 'Thai' }),
    comment(8),
    comment(7, { filepath: 'Metadata/other.txt', language: 'Japanese', sourceHash: HASH_B, unread: false }),
    comment(6, { filepath: 'Metadata/third.txt' }),
    comment(5, { language: 'French', sourceHash: HASH_B }),
    comment(4, { filepath: 'Metadata/Test.txt' }),
  ];
  app.commentsAllFeed.items = items;
  const groups = app.commentsAllGroups;
  assert.deepEqual(copy(groups.map(group => ({ filepath: group.filepath, ids: group.items.map(item => item.id) }))), [
    { filepath: 'Metadata/other.txt', ids: [7, 9] },
    { filepath: 'Metadata/test.txt', ids: [5, 8] },
    { filepath: 'Metadata/third.txt', ids: [6] },
    { filepath: 'Metadata/Test.txt', ids: [4] },
  ]);
  assert.equal(app.commentsAllItems, items);
  assert.deepEqual(items.map(item => item.id), [9, 8, 7, 6, 5, 4]);
  for (const group of groups) {
    for (const item of group.items) assert.equal(item, items.find(original => original.id === item.id));
  }
  assert.equal(groups[0].items[0].unread, false);
  assert.equal(groups[0].items[1].unread, true);
});

test('file groups span loaded pages and reorder by their newest comment after refresh', async () => {
  const other = { filepath: 'Metadata/other.txt' };
  const pages = [
    { items: [comment(12), comment(11, other), comment(10)], nextCursor: 10 },
    { items: [comment(9, other), comment(8), comment(7, { filepath: 'Metadata/third.txt' })], nextCursor: 7 },
    { items: [comment(13, other), comment(12)], nextCursor: 12 },
  ];
  const { app, calls } = fixture(async () => pages.shift());
  app.editorVisible = false; app.commentsAllVisible = true;
  await app.commentsRefreshAll();
  assert.deepEqual(copy(app.commentsAllGroups.map(group => group.items.map(item => item.id))), [[10, 12], [11]]);
  await app.commentsLoadMoreAll();
  assert.deepEqual(copy(app.commentsAllGroups.map(group => group.items.map(item => item.id))), [[8, 10, 12], [9, 11], [7]]);
  assert.match(calls[1].url, /before=10/);
  await app.commentsRefreshAll();
  assert.deepEqual(copy(app.commentsAllGroups.map(group => ({ filepath: group.filepath, ids: group.items.map(item => item.id) }))), [
    { filepath: 'Metadata/other.txt', ids: [9, 11, 13] },
    { filepath: 'Metadata/test.txt', ids: [8, 10, 12] },
    { filepath: 'Metadata/third.txt', ids: [7] },
  ]);
  assert.deepEqual(Array.from(app.commentsAllItems, item => item.id), [13, 12, 11, 10, 9, 8, 7]);
  assert.equal(app.commentsAllFeed.cursor, 7);
  assert.equal(app.commentsAllHasMore, true);
});

test('grouped rows retain shared references and acknowledge only the visible comment', async () => {
  const { app, calls, observers } = fixture(async () => ({ total: 1, files: [{ filepath: 'Metadata/test.txt', count: 1 }] }));
  app.editorVisible = false; app.commentsAllVisible = true;
  app.commentsAllFeed.items = [comment(9), comment(8, { sourceHash: HASH_B, language: 'Thai' })];
  const group = app.commentsAllGroups[0];
  const visible = node(9), offscreen = node(8);
  visible.dataset.commentsSurface = 'all'; offscreen.dataset.commentsSurface = 'all';
  app.$refs.commentsAllList = { querySelectorAll: () => [visible, offscreen] };
  await app.commentsObserveVisible();
  observers.at(-1).emit([
    { target: visible, isIntersecting: true, intersectionRatio: 1 },
    { target: offscreen, isIntersecting: false, intersectionRatio: 0 },
  ]);
  await app.commentsMarkVisibleRead();
  assert.deepEqual(calls[0].options.body.ids, [9]);
  assert.equal(group.items[1], app.commentsAllItems[0]);
  assert.equal(group.items[1].unread, false);
  assert.equal(group.items[0].unread, true);
  assert.equal(app.commentsUnreadTotal, 1);
});

test('quick replies target the card path and current source version, including absent source files', async () => {
  const filepath = 'Metadata/removed-from-current-source.txt';
  const accepted = comment(20, { filepath, actorId: 'account-a', actorName: 'Signed-in translator', language: 'Thai', unread: false });
  const { app, calls } = fixture(async () => ({ item: accepted }));
  app.editorVisible = false; app.commentsAllVisible = true; app.descs = [];
  app.commentsAllFeed.items = [comment(10), comment(9, { filepath, sourceHash: HASH_B, language: 'French' })];
  app.commentsFileFeed.items = [comment(10)];
  const editorDesc = app.editorCurrentEditingDesc;
  app.commentsSetReplyDraft(filepath, '  Reply to the older version  ');
  assert.equal(app.commentsCanReply(filepath), true);
  assert.equal(await app.commentsSubmitReply(filepath), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/v1/comments');
  assert.deepEqual(calls[0].options.body, {
    game: 'poe1', filepath, sourceHash: HASH_A, body: 'Reply to the older version', allLanguages: false, mutationId: 'mutation-1',
  });
  assert.equal(calls[0].auth.account, 'account-a');
  assert.equal(app.commentsAllItems[0], accepted);
  assert.equal(app.commentsAllItems[0].language, 'Thai');
  assert.equal(app.editorCurrentEditingDesc, editorDesc);
  assert.deepEqual(Array.from(app.commentsFileItems, item => item.id), [10]);
  assert.equal(app.commentsAllGroups[0].filepath, filepath);
  assert.deepEqual(Array.from(app.commentsAllGroups[0].items, item => item.id), [9, 20]);
  assert.equal(app.commentsReplyDraft(filepath), '');
});

test('quick reply drafts are independent from full comments and scoped to file, account, team, game, and hash', async () => {
  const { app } = fixture();
  const filepath = app.commentsFilepath;
  app.commentsFileDraft = 'Long file composer draft';
  app.commentsSetReplyDraft(filepath, 'Quick reply');
  app.commentsSetReplyDraft('Metadata/other.txt', 'Other card reply');
  assert.equal(app.commentsFileDraft, 'Long file composer draft');
  assert.equal(app.commentsReplyDraft(filepath), 'Quick reply');
  assert.equal(app.commentsReplyDraft('Metadata/other.txt'), 'Other card reply');
  app.cloudUser.id = 'account-b'; assert.equal(app.commentsReplyDraft(filepath), ''); app.cloudUser.id = 'account-a';
  app.cloudUser.language = 'German'; assert.equal(app.commentsReplyDraft(filepath), ''); app.cloudUser.language = 'Thai';
  app.gameVersion = 'poe2'; assert.equal(app.commentsReplyDraft(filepath), ''); app.gameVersion = 'poe1';
  app.sourceIdentity = HASH_B; assert.equal(app.commentsReplyDraft(filepath), ''); app.sourceIdentity = HASH_A;
  app.lang = 'French'; assert.equal(app.commentsReplyDraft(filepath), 'Quick reply');
  assert.equal(app.commentsFileDraft, 'Long file composer draft');
});

test('quick replies refuse unassigned sessions, missing hashes, and changing source contexts', async () => {
  for (const block of [
    app => { app.cloudSignedIn = false; },
    app => { app.cloudUser.language = null; },
    app => { app.sourceIdentity = ''; },
    app => { app.sourceIdentity = 'invalid-hash'; },
    app => { app.versionStorageLoading = true; },
    app => { app._importingSource = true; },
    app => { app.gameVersion = ''; },
    app => { app._commentsDestroyed = true; },
  ]) {
    const { app, calls } = fixture();
    const filepath = 'Metadata/other.txt';
    block(app);
    app.commentsSetReplyDraft(filepath, 'Keep until available');
    assert.equal(app.commentsCanReply(filepath), false);
    assert.equal(await app.commentsSubmitReply(filepath), false);
    assert.equal(app.commentsReplyDraft(filepath), 'Keep until available');
    assert.equal(calls.length, 0);
  }
  const { app, calls } = fixture();
  assert.equal(app.commentsCanReply(''), false);
  assert.equal(await app.commentsSubmitReply(''), false);
  assert.equal(calls.length, 0);
});

test('failed quick replies keep the draft and error while an idempotent retry is pending', async () => {
  const retry = deferred(); let attempts = 0;
  const filepath = 'Metadata/other.txt';
  const { app, calls } = fixture(async () => {
    if (++attempts === 1) throw new Error('Connection lost after send');
    return retry.promise;
  });
  app.commentsSetReplyDraft(filepath, 'Keep this reply');
  assert.equal(await app.commentsSubmitReply(filepath), false);
  assert.equal(app.commentsReplyDraft(filepath), 'Keep this reply');
  assert.equal(app.commentsReplyPosting(filepath), false);
  assert.match(app.commentsReplyError(filepath), /Connection lost/);
  assert.equal(app.commentsReplyError(app.commentsFilepath), '');
  const send = app.commentsSubmitReply(filepath);
  assert.equal(app.commentsReplyPosting(filepath), true);
  assert.match(app.commentsReplyError(filepath), /Connection lost/);
  assert.equal(await app.commentsSubmitReply(filepath), false);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.body.mutationId, calls[1].options.body.mutationId);
  retry.resolve({ item: comment(20, { filepath, unread: false }) });
  assert.equal(await send, true);
  assert.equal(app.commentsReplyError(filepath), '');
  assert.equal(app.commentsReplyDraft(filepath), '');
  assert.equal(app.commentsReplyPosting(filepath), false);
});

test('parallel card replies preserve independently edited inputs during in-flight posts', async () => {
  const filepathA = 'Metadata/first.txt', filepathB = 'Metadata/second.txt';
  const pendingA = deferred(), pendingB = deferred();
  const { app, calls } = fixture((_url, options) => options.body.filepath === filepathA ? pendingA.promise : pendingB.promise);
  app.commentsSetReplyDraft(filepathA, 'First card'); app.commentsSetReplyDraft(filepathB, 'Second card');
  const sendA = app.commentsSubmitReply(filepathA), sendB = app.commentsSubmitReply(filepathB);
  assert.equal(app.commentsReplyPosting(filepathA), true);
  assert.equal(app.commentsReplyPosting(filepathB), true);
  assert.equal(await app.commentsSubmitReply(filepathA), false);
  app.commentsSetReplyDraft(filepathA, 'Next thought typed before reply finishes');
  pendingB.resolve({ item: comment(20, { filepath: filepathB, unread: false }) });
  await sendB;
  assert.equal(app.commentsReplyDraft(filepathB), '');
  assert.equal(app.commentsReplyPosting(filepathA), true);
  pendingA.resolve({ item: comment(21, { filepath: filepathA, unread: false }) });
  await sendA;
  assert.equal(app.commentsReplyDraft(filepathA), 'Next thought typed before reply finishes');
  assert.equal(app.commentsReplyPosting(filepathA), false);
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0].options.body.mutationId, calls[1].options.body.mutationId);
});

test('late quick reply responses cannot mix account or game feeds or clear another source draft', async () => {
  for (const change of ['account', 'game', 'source']) {
    const pending = deferred(), filepath = 'Metadata/other.txt';
    const { app } = fixture(() => pending.promise);
    app.editorVisible = false; app.commentsAllVisible = true;
    app.commentsSetReplyDraft(filepath, 'Submitted in original context');
    const send = app.commentsSubmitReply(filepath);
    if (change === 'account') app.cloudUser.id = 'account-b';
    if (change === 'game') app.gameVersion = 'poe2';
    if (change === 'source') app.sourceIdentity = HASH_B;
    app.commentsSetReplyDraft(filepath, 'Keep new context draft');
    pending.resolve({ item: comment(20, { filepath, unread: false }) });
    assert.equal(await send, true);
    assert.equal(app.commentsReplyDraft(filepath), 'Keep new context draft');
    assert.equal(app.commentsReplyPosting(filepath), false);
    if (change === 'source') {
      assert.equal(app.commentsAllItems.length, 1);
      assert.equal(app.commentsDifferentHash(app.commentsAllItems[0]), true);
    } else assert.equal(app.commentsAllItems.length, 0);
  }
});

test('changing a failed reply body creates a new mutation while leaving other drafts untouched', async () => {
  const { app, calls } = fixture(async () => { throw new Error('Offline'); });
  const filepath = app.commentsFilepath;
  app.commentsFileDraft = 'Full composer stays';
  app.commentsSetReplyDraft(filepath, 'First reply'); await app.commentsSubmitReply(filepath);
  app.commentsSetReplyDraft(filepath, 'Changed reply'); await app.commentsSubmitReply(filepath);
  assert.notEqual(calls[0].options.body.mutationId, calls[1].options.body.mutationId);
  assert.equal(app.commentsReplyDraft(filepath), 'Changed reply');
  assert.equal(app.commentsFileDraft, 'Full composer stays');
});

test('posting a quick reply retains input focus, selection, and viewport position when its card moves', async () => {
  const filepath = 'Metadata/other.txt';
  const state = fixture(async () => ({ item: comment(20, { filepath, unread: false }) }));
  const { app, document } = state;
  const { input, root, focusCalls, selections } = activeReplyInput(state);
  app.commentsAllFeed.items = [comment(10), comment(9, { filepath })];
  app.commentsSetReplyDraft(filepath, 'New reply');
  let moved = false;
  app.$nextTick = async () => {
    if (!moved && app.commentsAllItems[0]?.id === 20) {
      moved = true; input.top = 100; document.activeElement = document.body;
    }
  };
  await app.commentsSubmitReply(filepath);
  assert.equal(document.activeElement, input);
  assert.deepEqual(copy(focusCalls), [{ preventScroll: true }]);
  assert.deepEqual(selections, [[2, 5, 'backward']]);
  assert.equal(root.scrollTop, 200);
});

test('background and older-page feed changes preserve an active quick reply at its viewport offset', async () => {
  for (const append of [false, true]) {
    const state = fixture(async () => ({ items: append ? [comment(8)] : [comment(11), comment(10)], nextCursor: append ? null : 10 }));
    const { app, document } = state;
    const { input, root, focusCalls } = activeReplyInput(state);
    Object.assign(app.commentsAllFeed, { items: [comment(10)], loaded: true, loadedIds: [10], cursor: 10 });
    let moved = false;
    app.$nextTick = async () => {
      if (!moved) { moved = true; input.top = 460; document.activeElement = document.body; }
    };
    await (append ? app.commentsLoadMoreAll() : app.commentsRefreshAll());
    assert.equal(document.activeElement, input);
    assert.equal(root.scrollTop, 560);
    assert.equal(focusCalls.length, 1);
  }
});

test('background card reordering preserves audience checkbox focus and viewport without text-selection operations', async () => {
  const state = fixture(async () => ({ items: [comment(11), comment(10)], nextCursor: 10 }));
  const { app, document } = state;
  const { input, root, focusCalls, selections } = activeReplyInput(state);
  input.selectionStart = null; input.selectionEnd = null; input.selectionDirection = null;
  input.setSelectionRange = () => { selections.push('unsupported'); throw new Error('Checkboxes do not support text selections.'); };
  Object.assign(app.commentsAllFeed, { items: [comment(10)], loaded: true, loadedIds: [10], cursor: 10 });
  let moved = false;
  app.$nextTick = async () => {
    if (!moved) { moved = true; input.top = 460; document.activeElement = document.body; }
  };
  await app.commentsRefreshAll();
  assert.equal(document.activeElement, input);
  assert.equal(root.scrollTop, 560);
  assert.deepEqual(copy(focusCalls), [{ preventScroll: true }]);
  assert.deepEqual(selections, []);
});

test('reply focus preservation respects a newly focused control, detached card, or changed context', async () => {
  for (const interruption of ['focus', 'detached', 'account', 'source']) {
    const state = fixture();
    const { app, document } = state;
    const { input, root, focusCalls } = activeReplyInput(state);
    const saved = app.commentsCaptureReplyFocus();
    const anotherControl = { name: 'Newly focused button' };
    app.$nextTick = async () => {
      document.activeElement = interruption === 'focus' ? anotherControl : document.body;
      if (interruption === 'detached') input.isConnected = false;
      if (interruption === 'account') app.cloudUser.id = 'account-b';
      if (interruption === 'source') app.sourceIdentity = HASH_B;
      input.top = 100;
    };
    await app.commentsRestoreReplyFocus(saved);
    assert.equal(focusCalls.length, 0);
    assert.equal(root.scrollTop, 500);
    assert.equal(document.activeElement, interruption === 'focus' ? anotherControl : document.body);
  }
});

test('a pending reply response does not reclaim an input the user already left', async () => {
  const pending = deferred(), state = fixture(() => pending.promise);
  const { app, document } = state;
  const { focusCalls } = activeReplyInput(state);
  app.commentsSetReplyDraft(app.commentsFilepath, 'Send this');
  const send = app.commentsSubmitReply(app.commentsFilepath);
  const anotherControl = { name: 'Open file' };
  document.activeElement = anotherControl;
  pending.resolve({ item: comment(20, { unread: false }) });
  await send;
  assert.equal(document.activeElement, anotherControl);
  assert.equal(focusCalls.length, 0);
});

test('comment eligibility follows the assigned team independently of selected language and source hash', async () => {
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

test('file comments and quick replies default to their assigned language and explicitly opt into all languages', async () => {
  for (const reply of [false, true]) {
    for (const allLanguages of [false, true]) {
      const { app, calls } = fixture(async () => ({ item: comment(20, { actorId: 'account-a', unread: false }) }));
      const filepath = app.commentsFilepath;
      assert.equal(app.commentsFileAllLanguages, false);
      assert.equal(app.commentsReplyAllLanguages(filepath), false);
      if (reply) {
        app.commentsSetReplyDraft(filepath, 'Reply audience');
        app.commentsSetReplyAllLanguages(filepath, allLanguages);
      } else {
        app.commentsFileDraft = 'File audience';
        app.commentsFileAllLanguages = allLanguages;
      }
      assert.equal(await (reply ? app.commentsSubmitReply(filepath) : app.commentsSubmit()), true);
      assert.equal(calls[0].options.body.allLanguages, allLanguages);
      assert.equal(Object.hasOwn(calls[0].options.body, 'language'), false);
      assert.equal(Object.hasOwn(calls[0].options.body, 'scopeLanguage'), false);
      assert.equal(reply ? app.commentsReplyDraft(filepath) : app.commentsFileDraft, '');
      assert.equal(reply ? app.commentsReplyAllLanguages(filepath) : app.commentsFileAllLanguages, false);
    }
  }
});

test('comment audience selections stay with each draft across composer, file, account, team, game, and source switches', async () => {
  const { app } = fixture();
  const filepath = app.commentsFilepath;
  app.commentsFileDraft = 'File draft'; app.commentsFileAllLanguages = true;
  assert.equal(app.commentsReplyAllLanguages(filepath), false);
  app.commentsSetReplyDraft(filepath, 'Quick reply'); app.commentsSetReplyAllLanguages(filepath, true);
  assert.equal(app.commentsReplyAllLanguages('Metadata/other.txt'), false);
  app.editorCurrentEditingDesc = { filepath: 'Metadata/other.txt' };
  assert.equal(app.commentsFileAllLanguages, false);
  app.editorCurrentEditingDesc = { filepath };
  for (const [field, value] of [['account', 'account-b'], ['team', 'German'], ['game', 'poe2'], ['source', HASH_B]]) {
    const previous = field === 'account' ? app.cloudUser.id : field === 'team' ? app.cloudUser.language : field === 'game' ? app.gameVersion : app.sourceIdentity;
    const change = next => {
      if (field === 'account') app.cloudUser.id = next;
      if (field === 'team') app.cloudUser.language = next;
      if (field === 'game') app.gameVersion = next;
      if (field === 'source') app.sourceIdentity = next;
    };
    change(value);
    assert.equal(app.commentsFileAllLanguages, false, field + ' file scope');
    assert.equal(app.commentsReplyAllLanguages(filepath), false, field + ' reply scope');
    change(previous);
    assert.equal(app.commentsFileAllLanguages, true, field + ' restored file scope');
    assert.equal(app.commentsReplyAllLanguages(filepath), true, field + ' restored reply scope');
  }
  app.lang = 'French';
  assert.equal(app.commentsFileAllLanguages, true);
  assert.equal(app.commentsReplyAllLanguages(filepath), true);
  assert.equal(app.commentsFileDraft, 'File draft');
  assert.equal(app.commentsReplyDraft(filepath), 'Quick reply');
});

test('failed posts preserve audience and reuse mutations only for an unchanged body and audience', async () => {
  for (const reply of [false, true]) {
    const { app, calls } = fixture(async () => { throw new Error('Connection lost after send'); });
    const filepath = app.commentsFilepath;
    const setAudience = value => reply ? app.commentsSetReplyAllLanguages(filepath, value) : (app.commentsFileAllLanguages = value);
    const send = () => reply ? app.commentsSubmitReply(filepath) : app.commentsSubmit();
    if (reply) app.commentsSetReplyDraft(filepath, 'Keep this audience');
    else app.commentsFileDraft = 'Keep this audience';
    setAudience(true);
    assert.equal(await send(), false);
    assert.equal(reply ? app.commentsReplyAllLanguages(filepath) : app.commentsFileAllLanguages, true);
    assert.equal(await send(), false);
    assert.equal(calls[0].options.body.allLanguages, true);
    assert.equal(calls[0].options.body.mutationId, calls[1].options.body.mutationId);
    setAudience(false);
    assert.equal(await send(), false);
    assert.equal(calls[2].options.body.allLanguages, false);
    assert.notEqual(calls[2].options.body.mutationId, calls[1].options.body.mutationId);
    assert.equal(await send(), false);
    assert.equal(calls[3].options.body.mutationId, calls[2].options.body.mutationId);
    assert.equal(reply ? app.commentsReplyDraft(filepath) : app.commentsFileDraft, 'Keep this audience');
  }
});

test('a completed post preserves new text and its audience in the same composer', async () => {
  for (const reply of [false, true]) {
    const pending = deferred();
    const { app, calls } = fixture(() => pending.promise);
    const filepath = app.commentsFilepath;
    if (reply) {
      app.commentsSetReplyDraft(filepath, 'First thought'); app.commentsSetReplyAllLanguages(filepath, true);
    } else {
      app.commentsFileDraft = 'First thought'; app.commentsFileAllLanguages = true;
    }
    const send = reply ? app.commentsSubmitReply(filepath) : app.commentsSubmit();
    if (reply) app.commentsSetReplyDraft(filepath, 'New thought while sending');
    else app.commentsFileDraft = 'New thought while sending';
    pending.resolve({ item: comment(20, { actorId: 'account-a', unread: false, allLanguages: true, scopeLanguage: null }) });
    assert.equal(await send, true);
    assert.equal(calls[0].options.body.allLanguages, true);
    assert.equal(reply ? app.commentsReplyDraft(filepath) : app.commentsFileDraft, 'New thought while sending');
    assert.equal(reply ? app.commentsReplyAllLanguages(filepath) : app.commentsFileAllLanguages, true);
  }
});

test('late posts reset the original audience without clearing another account, team, game, source, or file draft', async () => {
  for (const reply of [false, true]) {
    for (const change of ['account', 'team', 'game', 'source', 'file']) {
      const pending = deferred(), filepath = 'Metadata/test.txt';
      const { app } = fixture(() => pending.promise);
      const originalKey = reply ? app.commentsReplyKey(filepath) : app.commentsDraftKey;
      if (reply) {
        app.commentsSetReplyDraft(filepath, 'Original context'); app.commentsSetReplyAllLanguages(filepath, true);
      } else {
        app.commentsFileDraft = 'Original context'; app.commentsFileAllLanguages = true;
      }
      const send = reply ? app.commentsSubmitReply(filepath) : app.commentsSubmit();
      if (change === 'account') app.cloudUser.id = 'account-b';
      if (change === 'team') app.cloudUser.language = 'German';
      if (change === 'game') app.gameVersion = 'poe2';
      if (change === 'source') app.sourceIdentity = HASH_B;
      if (change === 'file') app.editorCurrentEditingDesc = { filepath: 'Metadata/other.txt' };
      const newPath = change === 'file' ? app.commentsFilepath : filepath;
      if (reply) {
        app.commentsSetReplyDraft(newPath, 'New context draft'); app.commentsSetReplyAllLanguages(newPath, true);
      } else {
        app.commentsFileDraft = 'New context draft'; app.commentsFileAllLanguages = true;
      }
      pending.resolve({ item: comment(20, { actorId: 'account-a', unread: false, allLanguages: true, scopeLanguage: null }) });
      assert.equal(await send, true);
      assert.equal(reply ? app.commentsReplyDraft(newPath) : app.commentsFileDraft, 'New context draft', change);
      assert.equal(reply ? app.commentsReplyAllLanguages(newPath) : app.commentsFileAllLanguages, true, change);
      assert.equal(app.commentsDrafts[originalKey] || '', '');
      assert.equal(app.commentsDraftScopes[originalKey] || false, false);
    }
  }
});

test('global audience labels include legacy comments and distinguish explicit language-only responses', async () => {
  const { app } = fixture();
  assert.equal(app.commentsIsGlobal(comment(1)), true);
  assert.equal(app.commentsIsGlobal(comment(2, { scopeLanguage: null })), true);
  assert.equal(app.commentsIsGlobal(comment(3, { allLanguages: true, scopeLanguage: null })), true);
  assert.equal(app.commentsIsGlobal(comment(4, { allLanguages: false, scopeLanguage: 'Thai' })), false);
  assert.equal(app.commentsIsGlobal(comment(5, { scopeLanguage: 'German' })), false);
  assert.equal(app.commentsIsGlobal(comment(6, { allLanguages: false })), false);
});

test('confirmed unassignment closes comment views and clears shared rows while keeping drafts', async () => {
  const { app, calls } = fixture();
  app.commentsAllVisible = true; app.commentsFileFeed.items = [comment(1)]; app.commentsAllFeed.items = [comment(1)];
  app.commentsUnreadTotal = 1; app.commentsUnreadFiles = { 'Metadata/test.txt': 1 };
  const draftKey = app.commentsDraftKey;
  app.commentsFileDraft = 'Keep this unsent comment';
  app.cloudUser.language = null;
  app.commentsResetContext();
  await app.commentsPoll(); await app.commentsRefreshFile(); await app.commentsRefreshAll();
  assert.equal(app.cloudSignedIn, true);
  assert.equal(app.commentsEligible, false);
  assert.equal(app.commentsAllVisible, false);
  assert.equal(app.commentsFileItems.length, 0);
  assert.equal(app.commentsAllItems.length, 0);
  assert.equal(app.commentsUnreadTotal, 0);
  assert.equal(app.commentsDrafts[draftKey], 'Keep this unsent comment');
  assert.equal(calls.length, 0);
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
