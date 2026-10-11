'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const window = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/editorComponents.js'), 'utf8'), { window });
const { NativeField, TextField, Tools, Preview, Autocomplete, TranslationMemory, Lookup, Comments, History } = window.EditorComponents;

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

test('shared surfaces publish DOM refs after mounting and updates and release their owner on unmount', () => {
  for (const surface of [Tools, Preview, Autocomplete, TranslationMemory, Lookup, Comments, History]) {
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
  assert.ok(html.indexOf('src="editorReferenceCatalog.js"') < html.indexOf('src="editorLookup.js"'));
  assert.ok(html.indexOf('src="editorSession.js"') < html.indexOf('src="index.js"'));
});
