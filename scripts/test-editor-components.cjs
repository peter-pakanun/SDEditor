'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const window = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/editorComponents.js'), 'utf8'), { window });
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/clientTextUi.js'), 'utf8'), { window });
const { NativeField, TextField, Tools, Preview, Autocomplete, TranslationMemory, Lookup, Comments, History, DiagnosticScan, DictionaryEntries } = window.EditorComponents;

function lookupFocusFixture(region = 'pager') {
  const hooks = Lookup.mixins[0], moves = [], body = {}, html = {}, outside = {};
  const doc = { activeElement: null, body, documentElement: html, focused: true, hasFocus() { return this.focused; } };
  const element = name => ({ isConnected: true, disabled: false, hidden: false, inert: false,
    closest(selector) { return selector === '[inert]' ? this.inert : selector === '.lookupResults, .lookupPagination' ? region === 'pager'
      : selector === '.lookupReference' ? region === 'reference' : selector === '.lookupFilters' ? region === 'filters' : false; },
    getClientRects() { return this.hidden ? [] : [{}]; }, focus() { moves.push(name); doc.activeElement = this; } });
  const old = element('old'), refs = Object.fromEntries(['lookupSearchInput', 'lookupFiltersButton', 'lookupResultsList', 'lookupReference'].map(name => [name, element(name)]));
  const panel = { ownerDocument: doc, isConnected: true, contains: node => node === old || Object.values(refs).includes(node) };
  const host = { lookupSessionKey: 'scope-a', lookupPanelActive: true, editorReady: true }, component = { $props: { controller: host }, $el: panel, $refs: refs };
  doc.activeElement = old; hooks.mounted.call(component);
  return { hooks, moves, doc, old, refs, host, component, panel, outside };
}

test('Lookup retains focus after asynchronous controls disable, disappear or hide during rendering', () => {
  for (const [region, target, change] of [['pager', 'lookupResultsList', 'disabled'], ['filters', 'lookupFiltersButton', 'isConnected'],
    ['reference', 'lookupReference', 'disabled'], ['filters', 'lookupFiltersButton', 'hidden']]) {
    const f = lookupFocusFixture(region); f.hooks.beforeUpdate.call(f.component);
    f.old[change] = change === 'isConnected' ? false : true; f.doc.activeElement = f.doc.body;
    f.hooks.updated.call(f.component); assert.equal(f.doc.activeElement, f.refs[target]); assert.deepEqual(f.moves, [target]);
    f.hooks.updated.call(f.component); assert.deepEqual(f.moves, [target], 'A render can restore focus only once');
  }
  const hidden = lookupFocusFixture('filters'); hidden.hooks.beforeUpdate.call(hidden.component); hidden.old.hidden = true;
  hidden.hooks.updated.call(hidden.component);
  assert.equal(hidden.doc.activeElement, hidden.refs.lookupFiltersButton, 'A hidden control cannot retain focus even before the browser reports BODY');
});

test('Lookup update focus protection leaves deliberate exits and valid controls alone', () => {
  for (const kind of ['outside-before', 'outside-after', 'body-valid-control', 'document-blur']) {
    const f = lookupFocusFixture(); if (kind === 'outside-before') f.doc.activeElement = f.outside;
    f.hooks.beforeUpdate.call(f.component);
    if (kind !== 'body-valid-control') f.old.disabled = true;
    f.doc.activeElement = kind.startsWith('outside') ? f.outside : f.doc.body;
    if (kind === 'document-blur') f.doc.focused = false;
    const active = f.doc.activeElement; f.hooks.updated.call(f.component);
    assert.equal(f.doc.activeElement, active, kind); assert.deepEqual(f.moves, []);
  }
});

test('Lookup never restores update focus after close, unmount, scope replacement or target removal', () => {
  for (const kind of ['close', 'scope-before', 'scope-after', 'unmount', 'panel-replaced', 'target-hidden']) {
    const f = lookupFocusFixture();
    if (kind === 'scope-before') f.host.lookupSessionKey = 'scope-b';
    f.hooks.beforeUpdate.call(f.component); f.old.disabled = true; f.doc.activeElement = f.doc.body;
    if (kind === 'close') f.host.lookupPanelActive = false;
    if (kind === 'scope-after') f.host.lookupSessionKey = 'scope-b';
    if (kind === 'unmount') f.hooks.beforeUnmount.call(f.component);
    if (kind === 'panel-replaced') f.component.$el = {};
    if (kind === 'target-hidden') f.refs.lookupResultsList.hidden = true;
    f.hooks.updated.call(f.component); assert.deepEqual(f.moves, [], kind);
  }
});

test('MTL moves keyboard focus to its stable wrapper before disabling and leaves pointer field focus alone', () => {
  const calls=[],button={parentElement:{focus(){calls.push('focus');}}},toolbar={controller:{generate(){calls.push('generate');}}};
  window.document={activeElement:button};window.EditorComponents.FieldToolbar.methods.generateMtl.call(toolbar,{currentTarget:button});
  assert.deepEqual(calls,['focus','generate']);
  calls.length=0;window.document.activeElement={};window.EditorComponents.FieldToolbar.methods.generateMtl.call(toolbar,{currentTarget:button});
  assert.deepEqual(calls,['generate']);delete window.document;
});

test('shared notices preserve severity semantics and explicit roles', () => {
  const { Notice } = window.EditorComponents;
  for (const [tone, role] of [['error', 'alert'], ['warning', 'alert'], ['info', 'status'], ['neutral', 'note']]) {
    assert.equal(Notice.computed.noticeRole.call({ tone, role: null }), role);
    assert.equal(Notice.props.tone.validator(tone), true);
  }
  assert.equal(Notice.props.tone.validator('unknown'), false);
  assert.equal(Notice.computed.noticeRole.call({ tone: 'info', role: 'note' }), 'note');
  assert.match(Notice.template, /class="appNoticeContent"><slot><\/slot>/);
  assert.match(Notice.template, /v-if="\$slots.actions" class="appNoticeActions"><slot name="actions">/);
});

test('notice dismissals belong to an occurrence and app scope, survive surface remounts and never clear owner state', async () => {
  const localWindow = { document: { activeElement: null } }, watches = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/editorComponents.js'), 'utf8'),
    { window: localWindow, Vue: { reactive: value => value } });
  const { Notice, revealNotice } = localWindow.EditorComponents;
  const root = { ctNotice: 'Cancelled. Saved work is retained.', ctError: 'Save failed', ctWorkspace: { scope: { groupId: 'local:test:one' } },
    ctSaved: { field: 'Saved target' }, ctValues: { field: 'Unsaved draft' }, ctBusy: true,
    _ctAbort: { abort() { assert.fail('Closing a message cannot abort an operation'); } },
    $watch(source, callback, options) { watches.push({ source, callback, options }); } };
  const before = JSON.stringify(root);
  const mount = key => {
    const component = { $root: root, dismissal: null, $el: { closest: () => null, contains: () => false }, $nextTick: async () => {} };
    Notice.watch.dismissKey.handler.call(component, key);
    return component;
  };
  const first = mount('ctNotice'), error = mount('ctError');
  await Notice.methods.dismiss.call(first);
  assert.equal(first.dismissal.hidden, true);
  assert.equal(error.dismissal.hidden, false, 'One message does not hide another');
  assert.equal(JSON.stringify(root), before, 'Notice/error values, saved work, draft and operation state remain exact');
  const remounted = mount('ctNotice');
  assert.equal(remounted.dismissal, first.dismissal);
  assert.equal(remounted.dismissal.hidden, true, 'Opening another editor surface does not reveal this same occurrence');
  assert.equal(watches.length, 3, 'Each app owns one context watch and one watch per notice field');
  assert.ok(watches.every(watch => watch.options.flush === 'sync'), 'Clear then repost in one Vue tick is still a new occurrence');
  watches.find(watch => watch.source === 'ctNotice').callback();
  assert.equal(first.dismissal.hidden, false, 'A cleared or changed message reveals the next occurrence');
  await Notice.methods.dismiss.call(first); revealNotice(root, 'ctNotice');
  assert.equal(first.dismissal.hidden, false, 'An explicit same-text operation notice can be posted again');
  await Notice.methods.dismiss.call(first); await Notice.methods.dismiss.call(error);
  const context = watches.find(watch => typeof watch.source === 'function');
  const oldScope = context.source()[0]; root.ctWorkspace = { scope: { groupId: 'local:test:two' } };
  assert.notEqual(context.source()[0], oldScope); context.callback();
  assert.equal(first.dismissal.hidden, false); assert.equal(error.dismissal.hidden, false, 'A new test/workspace scope reveals notices');
  assert.equal(mount('').dismissal, null, 'Other notices do not gain dismissal implicitly');
  assert.match(Notice.template, /type="button" class="appNoticeClose" :aria-label="dismissLabel"/);
  assert.match(Notice.template, /@keydown="dismissKeydown" @click\.stop="dismiss"/);
});

test('notice close buttons isolate native activation while preserving document and editor shortcuts', () => {
  const stopped = [], prevented = [];
  for (const event of [{ key: 'Enter' }, { key: ' ' }, { key: 's', ctrlKey: true }, { key: 's', metaKey: true },
    { key: 'Enter', shiftKey: true }, { key: 'Enter', ctrlKey: true }, { key: 'F2' }, { key: 'Escape' }, { key: 'Tab' }]) {
    window.EditorComponents.Notice.methods.dismissKeydown({ ...event,
      stopPropagation: () => stopped.push(event), preventDefault: () => prevented.push(event) });
  }
  assert.deepEqual(stopped, [{ key: 'Enter' }, { key: ' ' }]);
  assert.deepEqual(prevented, [], 'Native Enter/Space button activation and shortcut handlers keep their default behavior');
});

test('closing a focused notice restores focus to an enabled control with native focus reveal', async () => {
  const focused = [], hidden = { getClientRects: () => [] }, disabled = { disabled: true }, inert = { closest: () => true };
  const next = { disabled: false, closest: () => null, getClientRects: () => [{}], focus: (...args) => focused.push(args.length) };
  window.document = { activeElement: {} }; window.getComputedStyle = () => ({ visibility: 'visible' });
  const component = { dismissal: { hidden: false }, $nextTick: async () => {}, $el: {
    contains: () => true, closest: selector => selector === '.appNoticeStack'
      ? { querySelectorAll: () => [disabled, inert, { ...next, ...hidden }, next] } : null,
  } };
  await window.EditorComponents.Notice.methods.dismiss.call(component);
  assert.equal(component.dismissal.hidden, true); assert.deepEqual(focused, [0], 'The browser can reveal a control clipped by the scrolling notice stack');
  delete window.document; delete window.getComputedStyle;
});

test('notice stacks measure wrapping and overflow, expose keyboard access, and release observers on unmount', () => {
  const observed = [], disconnected = [], listeners = new Map(), emitted = [], localWindow = {};
  let notifyResize, boxHeight = 73.25;
  class ResizeObserver {
    constructor(callback) { notifyResize = callback; }
    observe(element) { observed.push(element); }
    disconnect() { disconnected.push(true); }
  }
  localWindow.addEventListener = (type, listener) => listeners.set(type, listener);
  localWindow.removeEventListener = (type, listener) => { assert.equal(listeners.get(type), listener); listeners.delete(type); };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/editorComponents.js'), 'utf8'), { window: localWindow, ResizeObserver });
  const { NoticeStack } = localWindow.EditorComponents;
  const element = { scrollHeight: 250, clientHeight: 74, getBoundingClientRect: () => ({ height: boxHeight }) }, content = {};
  const component = { $el: element, $refs: { content }, overflowing: false, $emit: (...args) => emitted.push(args) };
  component.measure = NoticeStack.methods.measure.bind(component);
  NoticeStack.mounted.call(component);
  assert.deepEqual(observed, [element, content]);
  assert.equal(component.overflowing, true);
  assert.deepEqual(emitted, [['resize', 74]]);
  notifyResize(); assert.equal(emitted.length, 1, 'Identical observer measurements do not loop through the parent');
  boxHeight = 118; notifyResize(); assert.deepEqual(emitted.at(-1), ['resize', 118]);
  element.scrollHeight = 118; element.clientHeight = 118; listeners.get('resize')();
  assert.equal(component.overflowing, false);
  boxHeight = 0; NoticeStack.updated.call(component); assert.deepEqual(emitted.at(-1), ['resize', 0]);
  assert.match(NoticeStack.template, /:tabindex="overflowing \? 0 : undefined"/);
  assert.match(NoticeStack.template, /:role="overflowing \? 'region' : undefined" :aria-label="overflowing \? label : undefined"/);
  NoticeStack.beforeUnmount.call(component);
  assert.deepEqual(disconnected, [true]); assert.equal(listeners.size, 0);
  assert.deepEqual(emitted.at(-1), ['resize', 0], 'Unmount removes the old owner offset');
});

test('notice scrolling keeps native keyboard behavior without triggering workspace file navigation', () => {
  const { NoticeStack } = window.EditorComponents;
  const stopped = [], prevented = [], element = {};
  for (const key of ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Escape', 'Tab', 's']) {
    NoticeStack.methods.keydown.call({ overflowing: true, $el: element }, {
      key, target: element, currentTarget: element,
      stopPropagation: () => stopped.push(key), preventDefault: () => prevented.push(key),
    });
  }
  assert.deepEqual(stopped, ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);
  assert.deepEqual(prevented, [], 'The browser retains native scrolling, button activation and focus navigation');
});

test('local history source errors remain inside the settled history branch and cannot hide translated revisions', () => {
  assert.match(History.template, /<div v-if="historyLoading" class="historyLoading">Loading…<\/div>\s*<div v-else>\s*<app-notice v-if="sdHistorySourceError" tone="error">/,
    'Vue v-else must bind to historyLoading; the error belongs inside the visible settled history.');
  const error = History.template.indexOf('<app-notice v-if="sdHistorySourceError"'), list = History.template.indexOf('class="historyList"');
  assert.ok(error >= 0 && list > error);
  assert.doesNotMatch(History.template.slice(error, list), /v-else/,
    'The revision list cannot depend on the absence of a source-context error.');
});

test('Lookup reference metadata displays mapped English with the shared focusable tooltip before notes', () => {
  assert.match(Lookup.template, /<ct-context :host="\$props\.controller" :items="lookupSelectedReference\.referenceMetadata \|\| \[\]"><\/ct-context>/);
  const context = window.ClientTextUI.contextComponent.template;
  assert.match(context, /v-for="item in items"[^>]*><dt>\{\{ item\.name \}\}<\/dt>/);
  assert.match(context, /v-for="\(part,index\) in item\.parts"[^>]*>\{\{ part\.text \}\}/);
  assert.match(context, /:tabindex="part\.tooltip \? 0 : undefined" :aria-label="part\.tooltip \|\| undefined" v-tooltip="part\.tooltip"/);
  assert.doesNotMatch(context, /:title="(?:item|part)\./);
  assert.ok(Lookup.template.indexOf('lookupSelectedReference.referenceMetadata') < Lookup.template.indexOf('lookupSelectedReference.developerNotes'));
  const css = fs.readFileSync(path.join(__dirname, '../public/editor-lookup.css'), 'utf8');
  assert.match(css, /\.lookupText\s*\{[^}]*user-select:\s*text/);
});

test('Lookup tooltip bindings call the current editor host through the shared surface', () => {
  const Session = require('../public/editorSession.js');
  const calls = [], event = { clientX: 40, clientY: 80 };
  const host = { ctActive: true, showTooltip(value, text) { assert.equal(this, host); calls.push(['show', value, text]); },
    hideTooltip() { assert.equal(this, host); calls.push(['hide']); } };
  const props = { controller: Session.create(host) }, bindings = Lookup.setup(props);
  bindings.showTooltip(event, 'Character: Metadata/Characters/Dex/DexFourb\nEnglish: Huntress');
  bindings.hideTooltip();
  const nextHost = { ctActive: false, showTooltip(value, text) { assert.equal(this, nextHost); calls.push(['next', value, text]); } };
  props.controller = Session.create(nextHost);
  bindings.showTooltip(event, 'Next reference');
  assert.deepEqual(calls, [['show', event, 'Character: Metadata/Characters/Dex/DexFourb\nEnglish: Huntress'], ['hide'], ['next', event, 'Next reference']]);
});

test('shared native fields keep raw ClientText characters and publish committed IME text only', () => {
  const calls = [];
  const controller = { field: { translation: '', readonly: false },
    input: event => calls.push(['input', event.target.value]),
    compositionend: event => calls.push(['compositionend', event.target.value]) };
  const component = { controller, field: controller.field, source: false };
  const events = NativeField.computed.events.call(component);
  const target = { value: 'raw @ literal\\n\nจริง' };
  events.input({ target });
  assert.equal(controller.field.translation, target.value);
  events.compositionstart({ target }); target.value += ' unfinished';
  events.input({ target, isComposing: true });
  assert.equal(controller.field.translation, 'raw @ literal\\n\nจริง');
  target.value = 'committed 日本語'; events.compositionend({ target });
  assert.equal(controller.field.translation, 'committed 日本語');
  assert.deepEqual(calls, [['input', 'raw @ literal\\n\nจริง'], ['input', 'committed 日本語'], ['compositionend', 'committed 日本語']]);
  controller.field.readonly = true; target.value = 'blocked edit'; events.input({ target });
  assert.equal(controller.field.translation, 'committed 日本語');
});

test('raw native history controllers commit input once without a preceding lossy model assignment', () => {
  const calls = [], field = { translation: 'raw\r\noriginal', readonly: false }, controller = { field,
    commitInput: event => { calls.push([field.translation, event.inputType, event.target.value]); },
    input: () => { throw Error('Native history controller must own the complete input commit'); } };
  const events = NativeField.computed.events.call({ controller, field, source: false });
  events.input({ target: { value: 'raw\noriginal' }, inputType: 'historyUndo' });
  assert.deepEqual(calls, [['raw\r\noriginal', 'historyUndo', 'raw\noriginal']]);
  assert.equal(field.translation, 'raw\r\noriginal');
});
test('native textarea values normalize display-only newlines without changing raw descriptors', () => {
  const field = { english: 'source\r\nline\rtail', translation: 'raw@literal\\n\r\nline', isMultiline: true };
  assert.equal(NativeField.computed.nativeValue.call({ field, source: true }), 'source\nline\ntail');
  assert.equal(NativeField.computed.nativeValue.call({ field, source: false }), 'raw@literal\\n\nline');
  assert.equal(field.translation, 'raw@literal\\n\r\nline');
  field.isMultiline = false;
  assert.equal(NativeField.computed.nativeValue.call({ field, source: false }), field.translation);
});

test('native overlay observers follow input/textarea replacements and release detached fields', () => {
  const observed = [], unobserved = [], disconnected = [], styleObserved = [], appRoot = {}, documentRoot = {}, localWindow = {};
  class ResizeObserver {
    observe(element) { observed.push(element); }
    unobserve(element) { unobserved.push(element); }
    disconnect() { disconnected.push('resize'); }
  }
  class MutationObserver {
    observe(element) { styleObserved.push(element); }
    disconnect() { disconnected.push('style'); }
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/editorComponents.js'), 'utf8'), {
    window: localWindow, ResizeObserver, MutationObserver, document: { documentElement: documentRoot },
    getComputedStyle: () => ({ borderLeftWidth: '1px', borderTopWidth: '1px', padding: '7px 8px', font: '13px / 20.8px sans-serif', tabSize: '4' }),
  });
  const field = tagName => ({ tagName, style: {}, offsetWidth: 301, offsetHeight: 100, clientWidth: 299, clientHeight: 98,
    offsetLeft: 0, offsetTop: 0, scrollLeft: 0, scrollTop: 0, lang: 'en', getBoundingClientRect: () => ({ width: 300.5, height: 100.25 }) });
  const input = field('INPUT'), textarea = field('TEXTAREA'), overlay = { style: {} }, content = { style: {} };
  const surface = localWindow.EditorComponents.NativeField;
  const component = { $el: { closest: () => appRoot }, $refs: { nativeInput: input, highlightOverlay: overlay, highlightContent: content } };
  for (const [name, method] of Object.entries(surface.methods)) component[name] = method.bind(component);
  surface.mounted.call(component); surface.updated.call(component);
  assert.deepEqual(observed, [component.$el, input]); assert.deepEqual(styleObserved, [documentRoot, appRoot]);
  component.$refs.nativeInput = textarea; surface.updated.call(component);
  assert.deepEqual(unobserved, [input]); assert.deepEqual(observed, [component.$el, input, textarea]);
  assert.equal(overlay.style.width, '298.5px'); assert.equal(overlay.style.height, '98.25px');
  assert.equal(overlay.style.left, '1px'); assert.equal(overlay.style.top, '1px'); assert.equal(overlay.style.tabSize, '4');
  textarea.scrollLeft = 17; textarea.scrollTop = 34; component.syncHighlightScroll();
  assert.equal(content.style.transform, 'translate(-17px, -34px)'); assert.equal(overlay.style.transform, '');
  surface.beforeUnmount.call(component); assert.deepEqual(disconnected, ['resize', 'style']);
});

test('SD field adapters preserve table column callbacks and stable native highlight refs', () => {
  const calls = [], block = { isTable: true, tableColumns: [{ english: 'source', translation: 'old', isMultiline: true }] };
  const controller = { editorReady: true, editorTranslationReadOnly: false, translationEditorBcp47: 'th',
    editorRefName: (kind, index, column) => `${kind}_${index}_${column}`,
    tableColumnInput: (...args) => calls.push(['input', ...args]),
    setEditorFocus: (...args) => calls.push(['focus', ...args]),
    translationKeydown: (...args) => calls.push(['keydown', ...args]),
    translationCompositionEnd() {}, hotkeyPasteHL() {}, syncHlScroll: (...args) => calls.push(['scroll', ...args]),
    translationTooltipMouseMove() {}, hideTooltip() {},
  };
  const component = { controller, block, blockIndex: 3, columnIndex: 0, kind: 'translation' };
  for (const [name, computed] of Object.entries(TextField.computed)) Object.defineProperty(component, name, { get: computed.bind(component) });
  for (const [name, action] of Object.entries(TextField.methods)) component[name] = action.bind(component);
  const native = component.nativeController;
  const events = NativeField.computed.events.call({ controller: native, field: native.field, source: false, syncHighlightScroll() {} });
  const target = { value: 'changed' }, event = { target, key: 'Tab' };
  events.input(event); events.focus(event); events.keydown(event); events.scroll(event);
  assert.equal(block.tableColumns[0].translation, 'changed');
  assert.deepEqual(JSON.parse(JSON.stringify(native.field.dataAttrs)), { 'data-editor-ref': 'translation_3_0',
    'aria-autocomplete': 'list', 'aria-controls': 'sharedEditorAutocompleteList', 'aria-expanded': false });
  assert.deepEqual(JSON.parse(JSON.stringify(native.highlightAttrs)), { 'data-editor-ref': 'translationHLter_3_0' });
  assert.equal(calls[0][1], block); assert.deepEqual(calls[0].slice(2), [3, 0, event]);
  assert.deepEqual(calls.slice(1), [['focus', 3, 0], ['keydown', event, 3, 0], ['scroll', 'translation', 3, 0]]);
});

test('English descriptors stay read-only and reject writes in ordinary, multiline and table fields', () => {
  for (const shape of ['ordinary', 'multiline', 'table']) {
    const calls = [], field = { english: 'Fixed source', translation: 'Preserved translation', isMultiline: shape === 'multiline' };
    const block = shape === 'table' ? { isTable: true, tableColumns: [field] } : field;
    const controller = { editorReady: true, editorTranslationReadOnly: false,
      editorRefName: (kind, index, column) => `${kind}_${index}_${column}`,
      translationInput: () => calls.push('ordinary'), normalizeMultilineEditorBlock: () => calls.push('multiline'),
      tableColumnInput: () => calls.push('table') };
    const component = { controller, block, blockIndex: 0, columnIndex: shape === 'table' ? 0 : null, kind: 'english' };
    for (const [name, computed] of Object.entries(TextField.computed)) Object.defineProperty(component, name, { get: computed.bind(component) });
    for (const [name, action] of Object.entries(TextField.methods)) component[name] = action.bind(component);
    const native = component.nativeController;
    assert.equal(native.field.readonly, true, shape);
    const events = NativeField.computed.events.call({ controller: native, field: native.field, source: true });
    for (const event of ['input', 'keydown', 'paste', 'compositionstart', 'compositionend', 'change']) assert.equal(events[event], undefined, event);
    native.field.translation = 'Rejected descriptor write';
    native.input({ target: { value: 'Rejected input' } });
    assert.equal(field.english, 'Fixed source');
    assert.equal(field.translation, 'Preserved translation');
    assert.deepEqual(calls, []);
  }
});

test('SD source click modifiers retain insertion, clipboard and Dictionary actions', () => {
  const calls = [], field = { english: 'source' };
  const component = { field, blockIndex: 1, column: 2, controller: {
    altClickHighlight: (...args) => calls.push(['dictionary', ...args]),
    copySpanToClipboard: (...args) => calls.push(['clipboard', ...args]),
    copySpanToTranslation: (...args) => calls.push(['insert', ...args]),
  } };
  const plain = {}, alt = { altKey: true }, ctrl = { ctrlKey: true };
  TextField.methods.sourceClick.call(component, plain);
  TextField.methods.sourceClick.call(component, alt);
  TextField.methods.sourceClick.call(component, ctrl);
  TextField.methods.sourceClick.call(component, { ctrlKey: true, altKey: true });
  assert.deepEqual(calls, [['insert', plain, field, 1, 2], ['clipboard', alt], ['dictionary', ctrl, field]]);
});

test('Dictionary edit readiness can lock ClientText writes while its History panel remains ready', () => {
  const entries = window.EditorComponents.DictionaryEntries;
  assert.equal(entries.computed.ready.call({ controller: { editorReady: true, dictionaryReady: false } }), false);
  assert.equal(entries.computed.ready.call({ controller: { editorReady: true } }), true);
  assert.equal(entries.computed.ready.call({ controller: { editorReady: false } }), false);
  assert.match(entries.template, /:inert="!ready \|\| undefined"/);
});

test('Dictionary uses the compact SD controls unless insertion buttons are explicitly requested', () => {
  const entries = window.EditorComponents.DictionaryEntries, useDictionaryTranslation = () => {};
  assert.equal(entries.computed.useButtons.call({ controller: { useDictionaryTranslation } }), false);
  assert.equal(entries.computed.useButtons.call({ controller: { dictionaryUseButtons: true } }), false);
  assert.equal(entries.computed.useButtons.call({ controller: { dictionaryUseButtons: true, useDictionaryTranslation } }), true);
});

test('diagnostic badges delegate hover details to the shared application tooltip', () => {
  const calls = [], event = { clientX: 120, clientY: 240 }, component = {
    $root: { showTooltip: (...args) => calls.push(['show', ...args]), hideTooltip: () => calls.push(['hide']) },
  };
  window.EditorComponents.DiagnosticMeta.methods.showTooltip.call(component, event, 'Missing [Trigger]');
  window.EditorComponents.DiagnosticMeta.methods.hideTooltip.call(component);
  assert.deepEqual(calls, [['show', event, 'Missing [Trigger]'], ['hide']]);
});

test('shared surfaces publish DOM refs after mounting and updates and release their owner on unmount', () => {
  for (const surface of [Tools, Preview, Autocomplete, TranslationMemory, Lookup, Comments, History, DiagnosticScan]) {
    const refs = [], removed = [], controller = { registerRefs: (value, owner) => refs.push([value, owner]), unregisterRefs: owner => removed.push(owner) };
    const component = { $props: { controller }, $refs: { editorSide: {} } };
    const props = { controller }, bindings = surface.setup(props);
    assert.equal(bindings.registerRefs, controller.registerRefs);
    props.controller = { value: 'next mode' };
    assert.equal(bindings.value, 'next mode'); bindings.value = 'updated mode';
    assert.equal(props.controller.value, 'updated mode');
    surface.mounted.call(component); component.$refs = { lookupSearchInput: {} }; surface.updated.call(component);
    surface.beforeUnmount.call(component);
    assert.equal(refs.length, 2); assert.equal(refs[1][0], component.$refs); assert.equal(refs[1][1], component);
    assert.equal(removed[0], component);
  }
});

test('one shared tool surface and common preview and popup replace both mode templates', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert.equal((html.match(/<editor-tools\b/g) || []).length, 1);
  assert.doesNotMatch(html, /<ct-tools\b|class="hlPopupFilter"|class="side sharedEditorSidebar"/);
  assert.match(Tools.template, /<teleport :to="\$props.target">/);
  assert.ok(Tools.template.includes('editor-dictionary-entries'));
  for (const [tag, surface, marker] of [['editor-translation-memory-panel', TranslationMemory, 'tmResultsPanel'],
    ['editor-lookup-panel', Lookup, 'editorLookupPanel'], ['editor-comments-panel', Comments, 'fileCommentsPanel'], ['editor-history-panel', History, 'historyPanel']]) {
    assert.ok(Tools.template.includes('<' + tag), tag);
    assert.equal(Tools.components[tag], surface); assert.ok(surface.template.includes(marker), marker);
    assert.equal(Tools.template.includes('class="' + marker + '"'), false, 'panel markup has one owner');
  }
  assert.match(Preview.template, /gamePreviewWindow/); assert.match(Autocomplete.template, /hlPopupTlnote/);
  assert.match(html, /sidebar-host-id="ctFullEditorSidebarHost"/);
  assert.equal((html.match(/<editor-workspace-shell\b/g) || []).length, 2);
  assert.equal((html.match(/<editor-full-shell\b/g) || []).length, 2);
  assert.match(window.EditorComponents.WorkspaceShell.template, /<header class="workspaceHeader">/);
  assert.match(window.EditorComponents.FullEditorShell.template, /class="fixed clipboard"/);
  assert.match(Autocomplete.template, /role="listbox"/); assert.match(Autocomplete.template, /role="option" :aria-selected/);
  for (const [dependency, consumer] of [['editorReferenceCatalog.js', 'editorLookup.js'], ['editorSession.js', 'index.js']]) {
    const dependencyAt = html.indexOf('src="' + dependency + '"'), consumerAt = html.indexOf('src="' + consumer + '"');
    assert.ok(dependencyAt >= 0, dependency + ' is loaded');
    assert.ok(consumerAt >= 0, consumer + ' is loaded');
    assert.ok(dependencyAt < consumerAt, dependency + ' loads before ' + consumer);
  }
});


test('field toolbar hints share the app Tooltip while retaining native actions and disabled explanations', () => {
  const toolbar = window.EditorComponents.FieldToolbar, calls = [], event = { clientX: 7, clientY: 9 };
  const component = { $root: { showTooltip: (...args) => calls.push(args), hideTooltip: () => calls.push('hide') } };
  for (const surface of [toolbar, DictionaryEntries]) {
    surface.methods.showTooltip.call(component, event, 'Current action explanation');
    surface.methods.hideTooltip.call(component);
  }
  assert.deepEqual(calls, [[event, 'Current action explanation'], 'hide', [event, 'Current action explanation'], 'hide']);
  assert.doesNotMatch(toolbar.template, /(?:\s|:)title=/);
  assert.match(toolbar.template, /v-tooltip="controller.englishHint"/);
  assert.match(toolbar.template, /:tabindex="controller.englishDisabled \? 0 : undefined"/);
  assert.match(toolbar.template, /aria-label="Use English"[^>]+>Eng<\/button>/);
  assert.match(toolbar.template, /class="fieldMtlTarget" v-tooltip=/);
  assert.match(toolbar.template, /:tabindex="controller.mtlBusy \|\| controller.mtlDisabled \? 0 : -1"/);
  assert.match(toolbar.template, /@pointerdown.prevent="controller.capture\(\)" @click="controller.format\(style\)"/);
  assert.match(toolbar.template, /:aria-pressed="controller.englishActive"/);
});

test('existing editor action hints use one shared Tooltip across full and inline modes', () => {
  const titledButtons = text => [...text.matchAll(/<button\b(?:[^">]|"[^"]*")*>/g)].filter(match => /(?:\s|:)title=/.test(match[0]));
  for (const surface of [DictionaryEntries, Tools, Preview, TranslationMemory, History, DiagnosticScan, window.EditorComponents.AttentionNavigation]) {
    assert.equal(titledButtons(surface.template).length, 0, surface.name);
  }
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  for (const match of html.matchAll(/<button\b(?:[^">]|"[^"]*")*>/g)) {
    if (/(?:editorActions|editorCopyFilePath)/.test(match[0]) || /@click="(?:editorSave|editorExit|ctCloseEditor|openSettings\(\)|prevPage|nextPage)"/.test(match[0])) assert.doesNotMatch(match[0], /(?:\s|:)title=/);
  }
  const audio = fs.readFileSync(path.join(__dirname, '../public/clientTextAudio.js'), 'utf8');
  assert.doesNotMatch(audio, /:title=/);
  assert.match(audio, /:aria-label="session.trackTooltip\(track.clip,track.index\)" v-tooltip=/);
});


test('shared Tooltip refreshes a visible action hint in place and does not reopen a blurred control', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/index.js'), 'utf8');
  const first = source.indexOf("app.directive('tooltip', {"), last = source.indexOf("app.mount('#app');", first);
  let directive; vm.runInNewContext(source.slice(first, last), { app: { directive: (_name, value) => { directive = value; } } });
  const listeners = {}, calls = [], el = { addEventListener: (name, fn) => { listeners[name] = fn; }, removeEventListener: name => { delete listeners[name]; },
    removeAttribute() {}, getBoundingClientRect: () => ({ left: 10, top: 20, width: 28, height: 28 }) };
  const instance = { showTooltip: (anchor, text) => calls.push(['show', anchor.clientX, anchor.clientY, text]), hideTooltip: () => calls.push(['hide']) };
  directive.mounted(el, { instance, value: 'Translate' }); listeners.focus();
  directive.updated(el, { instance, value: 'Stop translation', oldValue: 'Translate' });
  assert.deepEqual(calls, [['show', 24, 34, 'Translate'], ['show', 24, 34, 'Stop translation']]);
  listeners.blur(); directive.updated(el, { instance, value: 'Stopping translation', oldValue: 'Stop translation' });
  assert.equal(calls.length, 3); assert.deepEqual(calls.at(-1), ['hide']);
  directive.unmounted(el); assert.equal(Object.keys(listeners).length, 0); assert.equal(el.__sdTooltipAnchor, undefined);
});


test('nested toolbar hints keep ownership while pointer events bubble through a tooltip row', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/index.js'), 'utf8');
  const first = source.indexOf("app.directive('tooltip', {"), last = source.indexOf("app.mount('#app');", first);
  let directive; vm.runInNewContext(source.slice(first, last), { app: { directive: (_name, value) => { directive = value; } } });
  const calls = [], make = parentElement => ({ parentElement, handlers: {}, addEventListener(name, fn) { this.handlers[name] = fn; }, removeAttribute() {} });
  const row = make(null), button = make(row), icon = make(button), instance = { showTooltip: (_event, text) => calls.push(text), hideTooltip() {} };
  directive.mounted(row, { value: 'Row details', instance }); directive.mounted(button, { value: 'Toolbar action', instance });
  row.handlers.mouseenter({ target: row }); button.handlers.mouseenter({ target: icon }); row.handlers.mousemove({ target: icon });
  assert.deepEqual(calls, ['Row details', 'Toolbar action']);
  directive.updated(row, { value: 'Updated row', oldValue: 'Row details', instance });
  assert.equal(calls.at(-1), 'Toolbar action', 'background row updates cannot replace the nested hint');
  button.handlers.mousemove({ target: icon }); row.handlers.mousemove({ target: icon });
  assert.equal(calls.at(-1), 'Toolbar action');
  row.handlers.mousemove({ target: row }); assert.equal(calls.at(-1), 'Updated row');
});


function tooltipDirectiveFixture() {
  const source=fs.readFileSync(path.join(__dirname,'../public/index.js'),'utf8');
  let directive;const first=source.indexOf("app.directive('tooltip', {");
  vm.runInNewContext(source.slice(first,source.indexOf("app.mount('#app');",first)),{app:{directive:(_name,value)=>{directive=value;}}});
  const keys=new Set(),doc={addEventListener(name,fn,capture){assert.equal(capture,true);keys.add(fn);},removeEventListener(name,fn){keys.delete(fn);}},calls=[];
  const make=(initial={})=>{const attrs={...initial},listeners={};return{ownerDocument:doc,listeners,attrs,getAttribute:name=>attrs[name]??null,
    setAttribute:(name,value)=>{attrs[name]=value;},removeAttribute:name=>{delete attrs[name];},addEventListener:(name,fn)=>{listeners[name]=fn;},removeEventListener:name=>{delete listeners[name];},
    getBoundingClientRect:()=>({left:1,top:2,width:28,height:28})};};
  const instance={showTooltip:(anchor,text)=>calls.push(['show',text]),hideTooltip:()=>calls.push(['hide'])};
  return{directive,doc,keys,calls,make,instance};
}

test('Tooltip Escape captures before toolbar actions, retains the trigger and stays dismissed until a new interaction',()=>{
  const f=tooltipDirectiveFixture(),el=f.make();f.directive.mounted(el,{instance:f.instance,value:'Bold shortcut'});el.listeners.focus();
  let prevented=0,stopped=0;const event={key:'Escape',preventDefault(){prevented++;},stopImmediatePropagation(){stopped++;}};
  [...f.keys][0]({...event,isComposing:true});[...f.keys][0]({...event,keyCode:229});assert.equal(prevented,0,'IME cancellation stays with composition');
  [...f.keys][0](event);assert.equal(prevented,1);assert.equal(stopped,1);assert.equal(el.__sdTooltipShown,false);assert.equal(f.keys.size,0);
  const after=f.calls.length;el.listeners.mousemove({target:el});f.directive.updated(el,{instance:f.instance,value:'Changed hint',oldValue:'Bold shortcut'});
  assert.equal(f.calls.length,after,'pointer movement and state updates do not reopen a dismissed hint');
  el.listeners.blur();el.listeners.focus();assert.equal(f.calls.at(-1)[1],'Changed hint');
  f.directive.updated(el,{instance:f.instance,value:'',oldValue:'Changed hint'});assert.equal(f.keys.size,0);assert.equal(el.attrs['aria-description'],undefined);
  f.directive.unmounted(el);assert.equal(f.keys.size,0);assert.equal(f.doc.__sdTooltipTrigger,undefined);
  assert.doesNotThrow(()=>window.EditorComponents.FieldToolbar.methods.toolbarKeydown.call({}, {defaultPrevented:true,key:'Escape'}));
});

test('Tooltip preserves explicit descriptions and associations, updates generated descriptions and removes only its own attribute',()=>{
  const f=tooltipDirectiveFixture(),el=f.make({'aria-describedby':'existing-help'});
  f.directive.mounted(el,{instance:f.instance,value:'View and download this file as text'});
  assert.equal(el.attrs['aria-description'],'View and download this file as text');assert.equal(el.attrs['aria-describedby'],'existing-help');
  f.directive.updated(el,{instance:f.instance,value:'Updated explanation',oldValue:'View and download this file as text'});
  assert.equal(el.attrs['aria-description'],'Updated explanation');f.directive.unmounted(el);assert.equal(el.attrs['aria-description'],undefined);assert.equal(el.attrs['aria-describedby'],'existing-help');
  const explicit=f.make({'aria-description':'Authored description'});f.directive.mounted(explicit,{instance:f.instance,value:'Hint'});
  f.directive.updated(explicit,{instance:f.instance,value:'Other hint',oldValue:'Hint'});f.directive.unmounted(explicit);assert.equal(explicit.attrs['aria-description'],'Authored description');
  const changed=f.make();f.directive.mounted(changed,{instance:f.instance,value:'Hint'});changed.attrs['aria-description']='Later authored text';f.directive.updated(changed,{instance:f.instance,value:'New hint',oldValue:'Hint'});f.directive.unmounted(changed);assert.equal(changed.attrs['aria-description'],'Later authored text');
});

test('only the visible Tooltip owner handles Escape when pointer and focus are on different controls',()=>{
  const f=tooltipDirectiveFixture(),focused=f.make(),hovered=f.make();f.directive.mounted(focused,{instance:f.instance,value:'Focused'});f.directive.mounted(hovered,{instance:f.instance,value:'Hovered'});
  focused.listeners.focus();hovered.listeners.mouseenter({target:hovered});assert.equal(focused.__sdTooltipShown,false);assert.equal(f.keys.size,1);
  let stopped=0;[...f.keys][0]({key:'Escape',preventDefault(){},stopImmediatePropagation(){stopped++;}});assert.equal(stopped,1);assert.equal(hovered.__sdTooltipDismissed,true);assert.equal(focused.__sdTooltipDismissed,false);
  const count=f.calls.length;hovered.listeners.mousemove({target:hovered});assert.equal(f.calls.length,count);
  f.directive.unmounted(focused);f.directive.unmounted(hovered);assert.equal(f.keys.size,0);
});
