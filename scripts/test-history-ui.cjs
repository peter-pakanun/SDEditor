const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const clone = value => JSON.parse(JSON.stringify(value));
const word = (fields = {}) => ({ _id: 'fire-main', find: 'Fire', replace: 'ไฟ', alts: [
  { _id: 'burning', find: 'Burning', replace: 'ลุกไหม้' },
  { _id: 'flame', find: 'Flame', replace: 'เปลวไฟ' },
], tlnote: 'A shared note', ...fields });
const event = (fields = {}) => ({ id: 7, entryId: 'fire-main', revision: 2, currentRevision: 5,
  before: word({ replace: 'Old translation' }), after: word(), current: word({ tlnote: 'A newer note' }),
  canRestoreBefore: true, canRestoreAfter: true, ...fields });
const page = (items = [], nextCursor = null) => ({ items, nextCursor, revision: 5, actors: [{ id: 'alice', name: 'Alice' }], coverage: { startedAt: '2026-09-29T00:00:00.000Z', legacyDeletions: 0 } });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};

function editor(client = {}) {
  const sandbox = { window: {}, document: { activeElement: null }, Date };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/cloudHistoryUi.js'), 'utf8'), sandbox);
  const mixin = sandbox.window.CloudHistoryUI.mixin;
  const instance = { ...mixin.data(), testMode: false, cloudSignedIn: true,
    cloudUser: { id: 'alice', language: 'Thai' }, lang: 'Thai', $refs: {},
    $nextTick: async callback => callback?.(), saveSettings: async () => true, _cloud: client,
  };
  for (const [name, method] of Object.entries(mixin.methods)) instance[name] = method.bind(instance);
  for (const [name, getter] of Object.entries(mixin.computed)) Object.defineProperty(instance, name, { get: getter.bind(instance) });
  instance.contextChanged = () => mixin.watch.cloudHistoryContext.call(instance);
  return instance;
}

test('entry shortcut sets the stable ID filter and settings history clears it', async () => {
  const calls = [];
  const app = editor({ getDictionaryHistory: async filters => { calls.push(clone(filters)); return page([event()]); } });
  await app.cloudOpenHistory('fire-main');
  assert.equal(app.cloudHistoryVisible, true);
  assert.deepEqual(calls[0], { entryId: 'fire-main', limit: 30 });
  assert.equal(app.cloudHistoryItems[0].entryId, 'fire-main');
  await app.cloudOpenHistory();
  assert.deepEqual(calls[1], { limit: 30 });
});

test('shared history is available for the assigned language while local-only entries cannot jump', async () => {
  const calls = [];
  const app = editor({ getDictionaryHistory: async filters => { calls.push(filters); return page(); } });
  app.lang = 'French';
  assert.equal(app.cloudHistoryAvailable, true);
  assert.equal(app.cloudEntryHistoryAvailable, false);
  await app.cloudOpenHistory('french-entry');
  assert.equal(calls.length, 0);
  await app.cloudOpenHistory();
  assert.equal(calls.length, 1);
  app.testMode = true;
  assert.equal(app.cloudHistoryAvailable, false);
  app.testMode = false; app.cloudSignedIn = false;
  assert.equal(app.cloudHistoryAvailable, false);
  app.cloudSignedIn = true; app.cloudUser.language = null;
  assert.equal(app.cloudHistoryAvailable, false);
});

test('a late list response cannot replace results for a newer filter', async () => {
  const old = deferred();
  let calls = 0;
  const app = editor({ getDictionaryHistory: () => ++calls === 1 ? old.promise : Promise.resolve(page([event({ id: 9 })])) });
  app.cloudHistoryVisible = true;
  app.cloudHistoryFilters.q = 'old';
  const first = app.cloudLoadHistory();
  app.cloudHistoryFilters.q = 'new';
  await app.cloudLoadHistory();
  old.resolve(page([event({ id: 3 })]));
  await first;
  assert.deepEqual(clone(app.cloudHistoryItems).map(item => item.id), [9]);
  assert.equal(app.cloudHistoryLoading, false);
});

test('account change clears history and discards an outstanding list response', async () => {
  const pending = deferred();
  const app = editor({ getDictionaryHistory: () => pending.promise });
  app.cloudHistoryVisible = true;
  const loading = app.cloudLoadHistory();
  app.cloudUser = { id: 'bob', language: 'Thai' };
  app.contextChanged();
  pending.resolve(page([event()]));
  await loading;
  assert.equal(app.cloudHistoryVisible, false);
  assert.equal(app.cloudHistoryItems.length, 0);
  assert.equal(app.cloudHistoryActors.length, 0);
  assert.equal(app.cloudHistoryCoverage, null);
  assert.equal(app.cloudHistoryLoading, false);
});

test('a late detail response cannot replace a newly selected event', async () => {
  const old = deferred();
  const app = editor({ getDictionaryHistoryEvent: id => id === 3 ? old.promise : Promise.resolve(event({ id })) });
  app.cloudHistoryVisible = true;
  const first = app.cloudSelectHistoryEvent({ id: 3 });
  await app.cloudSelectHistoryEvent({ id: 9 });
  old.resolve(event({ id: 3 }));
  await first;
  assert.equal(app.cloudHistoryEvent.id, 9);
  assert.equal(app.cloudHistoryDetailLoading, false);
});

test('closing history discards an outstanding detail response and error', async () => {
  for (const failure of [false, true]) {
    const pending = deferred();
    const app = editor({ getDictionaryHistoryEvent: () => pending.promise });
    app.cloudHistoryVisible = true;
    const loading = app.cloudSelectHistoryEvent({ id: 7 });
    app.cloudCloseHistory();
    if (failure) pending.reject(new Error('A stale network error'));
    else pending.resolve(event());
    await loading;
    assert.equal(app.cloudHistoryVisible, false);
    assert.equal(app.cloudHistoryEvent, null);
    assert.equal(app.cloudHistoryError, '');
    assert.equal(app.cloudHistoryDetailLoading, false);
  }
});

test('pagination uses applied filters instead of partially edited form fields', async () => {
  const calls = [];
  const app = editor({ getDictionaryHistory: async filters => {
    calls.push(clone(filters));
    return calls.length === 1 ? page([event({ id: 9 })], 9) : page([event({ id: 3 })]);
  } });
  app.cloudHistoryVisible = true;
  app.cloudHistoryFilters.entryId = '  fire-main  ';
  app.cloudHistoryFilters.q = 'Burning';
  await app.cloudLoadHistory();
  app.cloudHistoryFilters.entryId = 'ice-main';
  app.cloudHistoryFilters.q = 'Unsubmitted filter';
  app.cloudHistoryFilters.action = 'delete';
  await app.cloudLoadHistory(true);
  assert.deepEqual(calls[1], { entryId: 'fire-main', q: 'Burning', limit: 30, cursor: 9 });
  assert.deepEqual(clone(app.cloudHistoryItems).map(item => item.id), [9, 3]);
  assert.equal(app.cloudHistoryNextCursor, null);
});

test('account switch while local save is pending prevents a restore under the new account', async () => {
  const saving = deferred();
  const calls = [];
  const app = editor({ restoreDictionaryHistory: async (...args) => calls.push(args) });
  app.cloudHistoryVisible = true; app.cloudHistoryEvent = event(); app.cloudHistoryRestoreVersion = 'after';
  app.saveSettings = () => saving.promise;
  const restoring = app.cloudConfirmHistoryRestore();
  app.cloudUser = { id: 'bob', language: 'Thai' }; app.contextChanged();
  saving.resolve(true);
  await restoring;
  assert.equal(calls.length, 0);
  assert.equal(app.cloudHistoryNotice, '');
  assert.equal(app.cloudHistoryRestoring, false);
});

test('local storage failure stops restore before sending any shared mutation', async () => {
  let calls = 0;
  const app = editor({ restoreDictionaryHistory: async () => { calls++; } });
  app.cloudHistoryVisible = true; app.cloudHistoryEvent = event(); app.cloudHistoryRestoreVersion = 'before';
  app.saveSettings = async () => false;
  await app.cloudConfirmHistoryRestore();
  assert.equal(calls, 0);
  assert.match(app.cloudHistoryError, /Save your local changes/);
  assert.equal(app.cloudHistoryRestoring, false);
});

test('stale revision clears restore selection and requires a fresh preview', async () => {
  const calls = [];
  const app = editor({ restoreDictionaryHistory: async (...args) => {
    calls.push(args); throw Object.assign(new Error('Shared dictionary changed'), { status: 409 });
  } });
  app.cloudHistoryVisible = true; app.cloudHistoryEvent = event(); app.cloudHistoryRestoreVersion = 'before';
  await app.cloudConfirmHistoryRestore();
  assert.deepEqual(calls, [[7, 'before', 5]]);
  assert.equal(app.cloudHistoryEvent, null);
  assert.equal(app.cloudHistoryRestoreVersion, '');
  assert.equal(app.cloudHistoryRestoring, false);
  assert.equal(app.cloudHistoryNotice, '');
  assert.match(app.cloudHistoryError, /Shared dictionary changed/);
  await app.cloudConfirmHistoryRestore();
  assert.equal(calls.length, 1, 'Cannot blindly retry the stale confirmation.');
});

test('Already current compares full content including stable IDs and alternate ordering', async () => {
  let calls = 0;
  const app = editor({ restoreDictionaryHistory: async () => { calls++; } });
  app.cloudHistoryVisible = true;
  const original = word();
  app.cloudHistoryEvent = event({ after: original, current: clone(original) });
  assert.equal(app.cloudHistoryVersionCurrent('after'), true);
  for (const change of [
    current => { current._id = 'another-entry'; },
    current => { current.find = 'Flame'; },
    current => { current.replace = 'Other translation'; },
    current => { current.tlnote = 'Different note'; },
    current => { current.alts[0]._id = 'different-alt-id'; },
    current => { current.alts[0].find = 'Ignite'; },
    current => { current.alts[0].replace = 'Different alternate'; },
    current => { current.alts.reverse(); },
  ]) {
    app.cloudHistoryEvent.current = clone(original); change(app.cloudHistoryEvent.current);
    assert.equal(app.cloudHistoryVersionCurrent('after'), false);
  }
  app.cloudHistoryEvent.current = { tlnote: original.tlnote, alts: original.alts.map(alt => ({ replace: alt.replace, find: alt.find, _id: alt._id })), replace: original.replace, find: original.find, _id: original._id };
  assert.equal(app.cloudHistoryVersionCurrent('after'), true, 'Object property order is not a content change.');
  app.cloudPrepareHistoryRestore('after');
  assert.equal(app.cloudHistoryRestoreVersion, '');
  app.cloudHistoryRestoreVersion = 'after'; await app.cloudConfirmHistoryRestore();
  assert.equal(calls, 0, 'An already current version does not create a misleading restore event.');
});

test('known deleted versions can be restored but unknown pre-baseline content cannot', async () => {
  const app = editor();
  app.cloudHistoryVisible = true;
  app.cloudHistoryEvent = event({ before: null, current: null });
  assert.equal(app.cloudHistoryVersionCurrent('before'), true);
  app.cloudHistoryEvent.current = word();
  assert.equal(app.cloudHistoryVersionCurrent('before'), false);
  app.cloudPrepareHistoryRestore('before');
  assert.equal(app.cloudHistoryRestoreVersion, 'before');
  assert.equal(app.cloudHistoryRestoreEntry, null);
  app.cloudHistoryRestoreVersion = '';
  app.cloudHistoryEvent.canRestoreBefore = false;
  assert.equal(app.cloudHistoryVersionCurrent('before'), false);
  app.cloudPrepareHistoryRestore('before');
  assert.equal(app.cloudHistoryRestoreVersion, '');
});
