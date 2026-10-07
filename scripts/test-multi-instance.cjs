const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/index.js'), 'utf8');

function harness({ broadcast = true, postFails = false } = {}) {
  const channels = new Set(), created = [], intervals = new Map(), storage = new Map();
  const removedListeners = [];
  let now = 1000, nextTimer = 1, posts = 0, deliveries = 0, config;
  class Channel {
    constructor(name) { this.name = name; this.closed = false; channels.add(this); created.push(this); }
    postMessage(data) {
      if (postFails) throw new Error('Channel unavailable');
      assert.equal(this.closed, false);
      posts++;
      for (const channel of channels) {
        if (channel === this || channel.name !== this.name || !channel.onmessage) continue;
        deliveries++;
        channel.onmessage({ data: { ...data } });
      }
    }
    close() { this.closed = true; this.onmessage = null; channels.delete(this); }
  }
  const document = { documentElement: { getAttribute() { return 'light'; } },
    removeEventListener(name, handler) { removedListeners.push(['document', name, handler]); } };
  const context = vm.createContext({ window: { location: { search: '' }, CloudUI: { mixin: {} },
    removeEventListener(name, handler) { removedListeners.push(['window', name, handler]); } }, document,
    localStorage: { getItem(key) { return storage.get(key) ?? null; }, setItem(key, value) { storage.set(key, value); } },
    Date: class extends Date { static now() { return now; } }, URLSearchParams, console,
    setTimeout() { return nextTimer++; }, clearTimeout() {},
    setInterval(callback, delay) { const id = nextTimer++; intervals.set(id, { callback, delay }); return id; },
    clearInterval(id) { intervals.delete(id); },
    ...(broadcast ? { BroadcastChannel: Channel } : {}),
    Vue: { defineComponent(value) { config = value; return value; },
      createApp() { return { component() {}, directive() {}, mount() {} }; } },
  });
  vm.runInContext(source, context, { filename: 'index.js' });
  return {
    editor(id) { return Object.assign(config.data(), config.methods, { instanceTabId: id }); },
    unmount(editor) { config.beforeUnmount.call(editor); },
    advance(milliseconds) { now += milliseconds; },
    tick() { for (const { callback } of [...intervals.values()]) callback(); },
    channels, created, intervals, storage, removedListeners,
    get posts() { return posts; }, get deliveries() { return deliveries; },
  };
}

test('long-lived tabs reuse one channel and heartbeat delivery stays linear', () => {
  const api = harness(), first = api.editor('first'), second = api.editor('second');
  for (let index = 0; index < 1800; index++) {
    first.checkMultipleInstances(); second.checkMultipleInstances(); api.advance(2000);
  }
  assert.equal(api.created.length, 2);
  assert.equal(api.channels.size, 2);
  assert.equal(api.posts, 3600);
  assert.equal(api.deliveries, 3599);
  assert.equal(first.showMultiInstanceGate, true);
  assert.equal(second.showMultiInstanceGate, true);
});

test('a closed peer expires and the remaining tab dismisses its gate', () => {
  const api = harness(), first = api.editor('first'), second = api.editor('second');
  first.checkMultipleInstances(); second.checkMultipleInstances(); first.checkMultipleInstances();
  assert.equal(first.showMultiInstanceGate, true);
  assert.equal(second.showMultiInstanceGate, true);
  api.unmount(second);
  api.advance(5001); first.checkMultipleInstances();
  assert.equal(first.showMultiInstanceGate, false);
  assert.equal(first._instancePeers.size, 0);
  assert.equal(api.channels.size, 1);
});

test('bypass keeps the active tab advertised while suppressing its own gate', () => {
  const api = harness(), first = api.editor('first'), second = api.editor('second');
  first.checkMultipleInstances(); second.checkMultipleInstances(); first.checkMultipleInstances();
  second.bypassMultiInstanceGate(); second.startMultiInstanceCheck();
  api.advance(6000); first.checkMultipleInstances();
  assert.equal(first.showMultiInstanceGate, false);
  api.tick();
  assert.equal(first.showMultiInstanceGate, true);
  assert.equal(second.showMultiInstanceGate, false);
  assert.equal(second.multiInstanceBypass, true);
});

test('Vue 3 unmount disposes the interval, channel, and keyboard listener', () => {
  const api = harness(), editor = api.editor('single');
  editor.checkMultipleInstances(); editor.startMultiInstanceCheck(); editor.startMultiInstanceCheck();
  assert.equal(api.intervals.size, 1);
  const channel = editor._broadcastChannel;
  const handler = channel.onmessage;
  api.unmount(editor);
  assert.equal(api.intervals.size, 0);
  assert.equal(api.channels.size, 0);
  assert.equal(channel.closed, true);
  assert.equal(editor._broadcastChannel, null);
  assert.equal(editor.multiInstanceCheckTimer, null);
  assert.equal(api.removedListeners.some(([target, name]) => target === 'document' && name === 'keydown'), true);
  handler({ data: { type: 'instance_check', id: 'late-message' } });
  assert.equal(editor._instancePeers.size, 0);
});

for (const options of [{ broadcast: false }, { postFails: true }]) {
  test('localStorage detection clears expired peers when ' + (options.postFails ? 'channel posting fails' : 'BroadcastChannel is unavailable'), () => {
    const api = harness(options), first = api.editor('first'), second = api.editor('second');
    first.checkMultipleInstances(); second.checkMultipleInstances(); first.checkMultipleInstances();
    assert.equal(first.showMultiInstanceGate, true);
    assert.equal(second.showMultiInstanceGate, true);
    assert.equal(api.channels.size, 0);
    api.advance(5001); first.checkMultipleInstances();
    assert.equal(first.showMultiInstanceGate, false);
    assert.equal(first._instancePeers.size, 0);
  });
}

test('own and malformed heartbeat messages cannot create a false gate', () => {
  const api = harness(), editor = api.editor('single');
  editor.checkMultipleInstances();
  const receive = editor._broadcastChannel.onmessage;
  for (const data of [null, {}, { type: 'other', id: 'peer' }, { type: 'instance_check' },
    { type: 'instance_check', id: '' }, { type: 'instance_check', id: 'single' }]) receive({ data });
  assert.equal(editor.showMultiInstanceGate, false);
  assert.equal(editor._instancePeers.size, 0);
});
