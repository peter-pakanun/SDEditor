const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function dialogHarness({ mount = true } = {}) {
  const window = {};
  const document = { activeElement: null };
  window.document = document;
  const context = vm.createContext({ window, document, console, setTimeout, clearTimeout,
    Vue: { defineComponent: value => value, nextTick: fn => Promise.resolve().then(fn) } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/appDialog.js'), 'utf8'), context, { filename: 'appDialog.js' });
  const service = window.AppDialogs, component = service.component;
  const app = { ...component.data(), $refs: {}, $nextTick: fn => Promise.resolve().then(fn) };
  const control = name => ({ name, isConnected: true, focus(options) { document.activeElement = this; this.focusOptions = options; } });
  const origin = control('origin'); origin.focus();
  const dialog = Object.assign(control('dialog'), {
    open: false, shows: 0,
    contains(node) { return Object.values(app.$refs).includes(node); },
    showModal() { assert.equal(this.open, false); this.open = true; this.shows++; },
    close() { this.open = false; Promise.resolve().then(() => app.dialogClosed()); },
  });
  app.$refs = { dialog, cancelButton: control('cancel'), confirmButton: control('confirm'), promptInput: control('prompt') };
  for (const [name, method] of Object.entries(component.methods)) app[name] = method.bind(app);
  for (const [name, getter] of Object.entries(component.computed || {})) Object.defineProperty(app, name, { get: getter.bind(app) });
  let mounted = false;
  const mountHost = () => { component.mounted.call(app); mounted = true; };
  const unmount = () => { if (mounted) { component.beforeUnmount.call(app); mounted = false; } };
  if (mount) mountHost();
  return { service, component, app, dialog, document, origin, mountHost, unmount };
}

function keyEvent(key, fields = {}) {
  return { key, defaultPrevented: false, stopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.stopped = true; }, ...fields };
}

test('dangerous confirmations focus Cancel and Escape cancels without invoking native UI', async t => {
  const h = dialogHarness(); t.after(h.unmount);
  const answer = h.service.confirm('Delete this entry?', { danger: true });
  await tick();
  assert.equal(h.dialog.open, true); assert.equal(h.service.isOpen, true);
  assert.equal(h.document.activeElement, h.app.$refs.cancelButton);
  const escape = keyEvent('Escape', { target: h.app.$refs.cancelButton });
  h.app.handleKeydown(escape);
  assert.equal(await answer, false); await tick();
  assert.equal(h.dialog.open, false); assert.equal(h.service.isOpen, false);
  assert.equal(h.document.activeElement, h.origin); assert.equal(escape.defaultPrevented, true);
});

test('a dangerous confirmation cannot accept Enter from an untargeted control', async t => {
  const h = dialogHarness(); t.after(h.unmount);
  let settled = false;
  const answer = h.service.confirm('Delete this entry?', { danger: true }).then(value => { settled = true; return value; });
  await tick();
  h.app.handleKeydown(keyEvent('Enter', { target: h.app.$refs.cancelButton }));
  await tick();
  if (!settled) h.app.cancel();
  assert.equal(await answer, false);
});

test('required YES stays case-sensitive, starts empty, and cannot be accepted with another value', async t => {
  const h = dialogHarness(); t.after(h.unmount);
  const answer = h.service.prompt('Type YES to proceed:', { requiredText: 'YES', danger: true });
  await tick();
  assert.equal(h.app.inputValue, ''); assert.equal(h.app.canAccept, false);
  assert.equal(h.document.activeElement, h.app.$refs.cancelButton);
  for (const value of ['', 'yes', 'Yes', 'YES!', 'NO']) {
    h.app.inputValue = value; h.app.accept();
    assert.equal(h.app.canAccept, false); assert.equal(h.dialog.open, true, `Invalid input ${JSON.stringify(value)} must keep the dialog open`);
  }
  h.app.inputValue = ' YES ';
  assert.equal(h.app.canAccept, true); h.app.accept();
  assert.equal(await answer, ' YES ');
});

test('prompt defaultValue is preserved and cancelling returns null', async t => {
  const h = dialogHarness(); t.after(h.unmount);
  const answer = h.service.prompt('Choose a value:', { defaultValue: 'existing value' });
  await tick(); assert.equal(h.app.inputValue, 'existing value');
  h.app.cancel(); assert.equal(await answer, null);
});

test('Enter submits a deliberately entered YES but cannot submit an invalid prompt', async t => {
  const h = dialogHarness(); t.after(h.unmount);
  const answer = h.service.prompt('Type YES:', { requiredText: 'YES', danger: true });
  await tick();
  h.app.$refs.promptInput.focus(); h.app.inputValue = 'yes';
  h.app.handleKeydown(keyEvent('Enter', { target: h.app.$refs.promptInput }));
  assert.equal(h.dialog.open, true);
  h.app.inputValue = 'YES'; h.app.handleKeydown(keyEvent('Enter', { target: h.app.$refs.promptInput }));
  assert.equal(await answer, 'YES');
});

test('closing the underlying dialog directly cancels instead of accepting', async t => {
  const h = dialogHarness(); t.after(h.unmount);
  const answer = h.service.confirm('Delete?', { danger: true });
  await tick(); h.dialog.close();
  assert.equal(await answer, false); await tick(); assert.equal(h.service.isOpen, false);
});

test('dialogs requested before mount run in order and settle only once', async t => {
  const h = dialogHarness({ mount: false }); t.after(h.unmount);
  let alertCompletions = 0, confirmCompletions = 0;
  const alert = h.service.alert('First message').then(value => { alertCompletions++; return value; });
  const confirm = h.service.confirm('Second message', { danger: true }).then(value => { confirmCompletions++; return value; });
  assert.equal(h.service.isOpen, true); h.mountHost(); await tick();
  assert.equal(h.app.request.message, 'First message'); assert.equal(h.dialog.shows, 1);
  h.app.accept(); h.app.accept(); await alert; await tick();
  assert.equal(alertCompletions, 1); assert.equal(h.app.request.message, 'Second message'); assert.equal(h.dialog.shows, 2);
  assert.equal(confirmCompletions, 0); assert.equal(h.document.activeElement, h.app.$refs.cancelButton);
  h.app.cancel(); h.app.cancel(); assert.equal(await confirm, false); await tick();
  assert.equal(confirmCompletions, 1); assert.equal(h.service.isOpen, false); assert.equal(h.document.activeElement, h.origin);
});

test('Escape during IME composition does not dismiss a prompt', async t => {
  const h = dialogHarness(); t.after(h.unmount);
  const answer = h.service.prompt('Type YES:', { requiredText: 'YES' });
  await tick();
  for (const fields of [{ isComposing: true }, { keyCode: 229 }]) {
    h.app.handleKeydown(keyEvent('Escape', fields)); assert.equal(h.dialog.open, true);
  }
  h.app.cancel(); assert.equal(await answer, null);
});

test('Ctrl and Cmd Save stay inside the dialog without submitting or opening browser Save Page', async t => {
  const h = dialogHarness(); t.after(h.unmount);
  let settled = false;
  const answer = h.service.confirm('Delete this entry?', { danger: true }).then(value => { settled = true; return value; });
  await tick();
  for (const fields of [{ ctrlKey: true, key: 's' }, { metaKey: true, key: 'S' }]) {
    const event = keyEvent(fields.key, { ...fields, target: h.app.$refs.cancelButton });
    h.app.handleKeydown(event); await tick();
    assert.equal(event.defaultPrevented, true); assert.equal(h.dialog.open, true); assert.equal(settled, false);
  }
  h.app.cancel(); assert.equal(await answer, false);
});

test('unmount cancels both the active request and every queued request', async () => {
  const h = dialogHarness();
  const first = h.service.confirm('First?'), second = h.service.prompt('Second?');
  await tick(); h.unmount();
  assert.equal(await first, false); assert.equal(await second, null); assert.equal(h.service.isOpen, false);
});

function editorHarness() {
  let config;
  const cleared = [], clearCalls = [], prompts = [], confirmations = [], alerts = [];
  const location = { search: '?testMode=1&lang=Thai', reload() { cleared.push('reload'); } };
  const service = { component: {}, isOpen: false,
    alert: async (message, options) => { alerts.push({ message, options }); },
    confirm: async (message, options) => { confirmations.push({ message, options }); return false; },
    prompt: async (message, options) => { prompts.push({ message, options }); return null; } };
  const window = { location, AppDialogs: service, CloudUI: { mixin: {} }, OfflineStore: {
    clearWorkspace: async game => { cleared.push('workspace'); clearCalls.push({ store: 'workspace', game }); },
    clearSource: async game => { cleared.push('source'); clearCalls.push({ store: 'source', game }); },
    clearRevisions: async game => { cleared.push('revisions'); clearCalls.push({ store: 'revisions', game }); },
  } };
  const context = vm.createContext({ window, location, document: { activeElement: null, body: {} },
    URLSearchParams, console, setTimeout, clearTimeout,
    alert: () => assert.fail('Native alerts must not be used'),
    confirm: () => assert.fail('Native confirmations must not be used'),
    prompt: () => assert.fail('Native prompts must not be used'),
    Vue: { defineComponent(value) { config = value; return value; },
      createApp: () => ({ component() {}, directive() {}, mount() {} }) } });
  for (const file of ['workspaceState.js', 'helper.js', 'regexEngine.js', 'index.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../public', file), 'utf8'), context, { filename: file });
  const editor = Object.assign(config.data(), config.methods, { lang: 'Thai', gameVersion: 'poe1', $refs: {},
    $nextTick: fn => Promise.resolve().then(fn) });
  for (const [name, getter] of Object.entries(config.computed)) Object.defineProperty(editor, name, { get: getter.bind(editor) });
  return { editor, window, service, cleared, clearCalls, prompts, confirmations, alerts };
}

test('the YES helper rejects blank, wrong case and cancelled input before the final confirmation', async () => {
  const h = editorHarness(); let confirmations = 0;
  h.editor.appConfirm = async () => { confirmations++; return true; };
  for (const value of [null, '', 'yes', 'Yes', 'YES!', 'NO']) {
    h.editor.appPrompt = async () => value;
    assert.equal(await h.editor.confirmProceedByTypingYes('Type YES:'), false);
  }
  assert.equal(confirmations, 0);
});

test('the YES helper trims input and still requires a separate final confirmation', async () => {
  const h = editorHarness(); const final = deferred(); let confirmations = 0, settled = false;
  h.editor.appPrompt = async () => ' YES ';
  h.editor.appConfirm = (message, options) => {
    assert.equal(message, 'Last warning: Delete this data?'); assert.equal(options.danger, true);
    confirmations++; return final.promise;
  };
  const approving = h.editor.confirmProceedByTypingYes('Type YES:', { confirmMessage: 'Last warning: Delete this data?' })
    .then(value => { settled = true; return value; });
  await tick(); assert.equal(confirmations, 1); assert.equal(settled, false);
  final.resolve(false); assert.equal(await approving, false);
  h.editor.appConfirm = async () => true;
  assert.equal(await h.editor.confirmProceedByTypingYes('Type YES:'), true);
});

test('Start from scratch waits for trimmed YES and final confirmation before clearing only the selected PoE2 storage', async () => {
  const h = editorHarness(); const typed = deferred(), final = deferred();
  h.editor.gameVersion = 'poe2';
  h.editor.appPrompt = () => typed.promise; h.editor.appConfirm = () => final.promise;
  const deleting = h.editor.startFromScratch();
  await tick(); assert.deepEqual(h.cleared, []);
  typed.resolve(' YES '); await tick(); assert.deepEqual(h.cleared, []);
  final.resolve(true); await deleting;
  assert.deepEqual(h.cleared, ['workspace', 'source', 'revisions', 'reload']);
  assert.deepEqual(h.clearCalls, ['workspace', 'source', 'revisions'].map(store => ({ store, game: 'poe2' })));
});

test('cancelling Start from scratch leaves storage and the current page unchanged', async () => {
  const h = editorHarness(); const answer = deferred();
  h.editor.confirmProceedByTypingYes = () => answer.promise;
  const deleting = h.editor.startFromScratch(); await tick(); assert.deepEqual(h.cleared, []);
  answer.resolve(false); await deleting; assert.deepEqual(h.cleared, []);
});

test('repeated Start from scratch actions do not queue duplicate destructive dialogs', async () => {
  const h = editorHarness(); const answer = deferred(); let confirmations = 0;
  h.editor.confirmProceedByTypingYes = () => { confirmations++; return answer.promise; };
  const deleting = h.editor.startFromScratch();
  await tick(); await h.editor.startFromScratch();
  assert.equal(confirmations, 1); assert.deepEqual(h.cleared, []);
  answer.resolve(false); await deleting; assert.deepEqual(h.cleared, []);
});

test('a reset confirmation cannot clear a workspace selected while its dialog was pending', async () => {
  const h = editorHarness(); const answer = deferred();
  h.editor.confirmProceedByTypingYes = () => answer.promise;
  const deleting = h.editor.startFromScratch(); await tick();
  h.editor.gameVersion = 'poe2'; answer.resolve(true); await deleting;
  assert.deepEqual(h.cleared, []); assert.deepEqual(h.clearCalls, []);
});

test('app dialog wrappers forward to the component service and prevent global navigation shortcuts', async () => {
  const h = editorHarness();
  await h.editor.appAlert('Message', { title: 'Details' });
  assert.equal(h.alerts[0].message, 'Message'); assert.equal(h.alerts[0].options.title, 'Details');
  assert.equal(await h.editor.appConfirm('Proceed?', { danger: true }), false);
  assert.equal(await h.editor.appPrompt('Type YES:', { requiredText: 'YES' }), null);
  h.service.isOpen = true; h.editor.editorVisible = true;
  h.editor.editorSave = () => assert.fail('A dialog must block the editor Save shortcut');
  h.editor.editorExit = () => assert.fail('A dialog must block closing its underlying editor');
  h.editor.handleKeydown(keyEvent('s', { code: 'KeyS', ctrlKey: true }));
  h.editor.handleKeydown(keyEvent('Escape'));
  assert.equal(h.editor.fileListNavigationBlocked(), true);
});
