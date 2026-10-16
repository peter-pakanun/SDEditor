/* Shared native Vue fields for the full editor and the focused workspace row. */
(function (global) {
  'use strict';

  // Notices stay in their owning surface. The stack bounds the occupied space
  // and publishes it so sticky editor controls can sit below the messages.
  const Notice = {
    name: 'AppNotice',
    props: {
      tone: { type: String, default: 'error', validator: value => ['error', 'warning', 'info', 'neutral'].includes(value) },
      role: { type: String, default: null },
    },
    computed: {
      noticeRole() { return this.role || (this.tone === 'error' || this.tone === 'warning' ? 'alert' : this.tone === 'info' ? 'status' : 'note'); },
    },
    template: `<div class="appNotice" :class="'appNotice--' + tone" :role="noticeRole">
      <div class="appNoticeContent"><slot></slot></div>
      <div v-if="$slots.actions" class="appNoticeActions"><slot name="actions"></slot></div>
    </div>`,
  };
  const NoticeStack = {
    name: 'AppNoticeStack',
    props: { sticky: Boolean, label: { type: String, default: 'Workspace notices' } },
    emits: ['resize'],
    data() { return { overflowing: false }; },
    mounted() {
      this._noticeResizeObserver = new ResizeObserver(() => this.measure());
      this._noticeResizeObserver.observe(this.$el);
      this._noticeResizeObserver.observe(this.$refs.content);
      this._noticeWindowResize = () => this.measure();
      window.addEventListener('resize', this._noticeWindowResize);
      this.measure();
    },
    updated() { this.measure(); },
    beforeUnmount() {
      this._noticeResizeObserver?.disconnect();
      window.removeEventListener('resize', this._noticeWindowResize);
      this.$emit('resize', 0);
    },
    methods: {
      keydown(event) {
        // Native scrolling belongs to this focused region, including when the
        // workspace's file navigation listens for the same keys above it.
        if (['Home', 'End', 'PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', ' '].includes(event.key)) event.stopPropagation();
      },
      measure() {
        const element = this.$el;
        const overflowing = element.scrollHeight > element.clientHeight + 1;
        if (overflowing !== this.overflowing) this.overflowing = overflowing;
        const height = Math.ceil(element.getBoundingClientRect().height);
        if (height !== this._noticeMeasuredHeight) {
          this._noticeMeasuredHeight = height;
          this.$emit('resize', height);
        }
      },
    },
    template: `<div class="appNoticeStack" :class="{ appNoticeStackSticky: sticky }" :tabindex="overflowing ? 0 : undefined" :role="overflowing ? 'region' : undefined" :aria-label="overflowing ? label : undefined" @keydown="keydown">
      <div ref="content" class="appNoticeStackContent"><slot></slot></div>
    </div>`,
  };

  // The descriptor owns raw values and mode-specific actions. This component
  // owns only the native control and SD's highlight overlay presentation.
  const NativeField = {
    name: 'EditorNativeField',
    props: {
      controller: { type: Object, required: true },
      kind: { type: String, required: true },
      compact: Boolean,
    },
    computed: {
      field() { return this.controller.field; },
      source() { return this.kind === 'english'; },
      nativeValue() {
        const raw = this.source ? this.field.english : this.field.translation;
        return this.field.isMultiline ? String(raw ?? '').replace(/\r\n?/g, '\n') : raw;
      },
      events() {
        const control = this.controller;
        const input = event => {
          if (this.field.readonly || event.isComposing || event.target.composing) return;
          if (control.commitInput) control.commitInput(event);
          else {
            this.field.translation = event.target.value;
            control.input?.(event);
          }
        };
        const compositionend = event => {
          event.target.composing = false;
          // Match native v-model: publish only committed IME text.
          input({ target: event.target, inputType: 'insertCompositionText' });
          control.compositionend?.(event);
        };
        return {
          focus: event => control.focus?.(event),
          scroll: event => { this.syncHighlightScroll(); control.scroll?.(event); },
          ...(!this.source ? {
            input,
            keydown: event => control.keydown?.(event),
            compositionstart: event => { event.target.composing = true; },
            compositionend,
            change: event => { if (event.target.composing) compositionend(event); },
            keyup: event => { control.selection?.(event); if (event.altKey) control.altKeyup?.(event); },
            select: event => control.selection?.(event),
            selectionchange: event => control.selection?.(event),
            click: event => control.selection?.(event),
            blur: event => control.blur?.(event),
            paste: event => control.paste?.(event),
            mousemove: event => control.tooltip?.(event),
            mouseleave: () => control.hideTooltip?.(),
          } : {}),
        };
      },
    },
    mounted() {
      this._highlightResizeObserver = new ResizeObserver(() => this.syncHighlightGeometry());
      this._highlightResizeObserver.observe(this.$el);
      this._highlightStyleObserver = new MutationObserver(() => this.syncHighlightGeometry());
      this._highlightStyleObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      const appRoot = this.$el.closest('.appRoot');
      if (appRoot) this._highlightStyleObserver.observe(appRoot, { attributes: true, attributeFilter: ['data-density'] });
      this.syncHighlightGeometry();
    },
    updated() { this.syncHighlightGeometry(); },
    beforeUnmount() { this._highlightResizeObserver?.disconnect(); this._highlightStyleObserver?.disconnect(); },
    methods: {
      syncHighlightScroll() {
        const input = this.$refs.nativeInput, content = this.$refs.highlightContent;
        if (input && content) content.style.transform = `translate(${-input.scrollLeft}px, ${-input.scrollTop}px)`;
      },
      syncHighlightGeometry() {
        const input = this.$refs.nativeInput, overlay = this.$refs.highlightOverlay;
        if (input !== this._highlightNativeInput) {
          if (this._highlightNativeInput) this._highlightResizeObserver?.unobserve(this._highlightNativeInput);
          this._highlightNativeInput = input;
          if (input) this._highlightResizeObserver?.observe(input);
        }
        if (!input || !overlay) return;
        const nativeStyle = getComputedStyle(input), rect = input.getBoundingClientRect();
        const borderLeft = parseFloat(nativeStyle.borderLeftWidth) || 0;
        const borderTop = parseFloat(nativeStyle.borderTopWidth) || 0;
        // clientWidth excludes borders and native scrollbars. Retain the native
        // control's fractional layout size so wrapping also agrees at odd widths.
        Object.assign(overlay.style, {
          left: input.offsetLeft + borderLeft + 'px', top: input.offsetTop + borderTop + 'px',
          width: rect.width - input.offsetWidth + input.clientWidth + 'px',
          height: rect.height - input.offsetHeight + input.clientHeight + 'px',
          padding: nativeStyle.padding, transform: '',
          font: nativeStyle.font, letterSpacing: nativeStyle.letterSpacing, wordSpacing: nativeStyle.wordSpacing,
          textIndent: nativeStyle.textIndent, textAlign: nativeStyle.textAlign, direction: nativeStyle.direction,
          tabSize: nativeStyle.tabSize,
          whiteSpace: input.tagName === 'TEXTAREA' ? nativeStyle.whiteSpace : 'pre',
          overflowWrap: nativeStyle.overflowWrap, wordBreak: nativeStyle.wordBreak,
        });
        overlay.lang = input.lang;
        this.syncHighlightScroll();
      },
    },
    template: `
      <div class="textHL editorTextField" :class="{ multiline: field.isMultiline }">
        <template v-if="source">
          <input ref="nativeInput" v-if="!field.isMultiline" type="text" v-bind="field.dataAttrs" :value="nativeValue" :placeholder="field.placeholder || 'English'" :lang="field.lang || 'en'" :spellcheck="field.spellcheck" readonly tabindex="-1" v-on="events">
          <textarea ref="nativeInput" v-else v-bind="field.dataAttrs" :value="nativeValue" :placeholder="field.placeholder || 'English'" :lang="field.lang || 'en'" :spellcheck="field.spellcheck" readonly tabindex="-1" :rows="compact ? 1 : 3" v-on="events"></textarea>
        </template>
        <template v-else>
          <input ref="nativeInput" v-if="!field.isMultiline" type="text" v-bind="field.dataAttrs" :value="nativeValue" :placeholder="field.placeholder || 'Translation'" :lang="field.lang" :spellcheck="field.spellcheck" :readonly="field.readonly" v-on="events">
          <textarea ref="nativeInput" v-else v-bind="field.dataAttrs" :class="{ multilineField: !compact }" :value="nativeValue" :placeholder="field.placeholder || 'Translation'" :lang="field.lang" :spellcheck="field.spellcheck" :readonly="field.readonly" :rows="compact ? 1 : 4" v-on="events"></textarea>
        </template>
        <div ref="highlightOverlay" v-if="controller.ready" class="HLter" data-editor-native-overlay :class="{ noPointer: !source }" v-bind="controller.highlightAttrs" @mousemove="source && controller.tooltip?.($event)" @mouseout="source && controller.hideTooltip?.()" @mouseleave="controller.hideTooltip?.()" @click="source && controller.sourceClick?.($event)"><div ref="highlightContent" class="editorHighlightContent" v-html="controller.highlight"></div></div>
      </div>
    `,
  };

  const TextField = {
    name: 'EditorTextField',
    props: {
      controller: { type: Object, required: true },
      block: { type: Object, required: true },
      blockIndex: { type: Number, required: true },
      columnIndex: { type: Number, default: null },
      kind: { type: String, required: true },
    },
    components: { 'editor-native-field': NativeField },
    computed: {
      field() { return this.columnIndex == null ? this.block : this.block.tableColumns[this.columnIndex]; },
      source() { return this.kind === 'english'; },
      refName() { return this.controller.editorRefName(this.kind, this.blockIndex, this.columnIndex); },
      highlightRefName() { return this.controller.editorRefName(this.kind + 'HLter', this.blockIndex, this.columnIndex); },
      highlight() { return this.source ? this.field.englishHLter : this.field.translationHLter; },
      column() { return this.columnIndex == null ? 0 : this.columnIndex; },
      nativeController() {
        const component = this, host = this.controller;
        return {
          field: {
            get english() { return component.field.english; },
            get translation() { return component.field.translation; },
            set translation(value) { if (!component.source && !host.editorTranslationReadOnly) component.field.translation = value; },
            get isMultiline() { return component.field.isMultiline; },
            get readonly() { return component.source || host.editorTranslationReadOnly; },
            get lang() { return component.source ? 'en' : host.translationEditorBcp47; },
            get dataAttrs() {
              if (component.source) return { 'data-editor-ref': component.refName };
              const active = host.hlPopup?.visible && host.hlPopup.editorIndex === component.blockIndex
                && (host.hlPopup.columnIndex || 0) === component.column;
              return { 'data-editor-ref': component.refName, 'aria-autocomplete': 'list',
                'aria-controls': 'sharedEditorAutocompleteList', 'aria-expanded': !!active,
                'aria-activedescendant': active && host.hlPopup.filtered?.length
                  ? 'sharedEditorAutocompleteOption-' + host.hlPopup.selectedIndex : undefined };
            },
          },
          get ready() { return host.editorReady; },
          get highlight() { return component.highlight; },
          get highlightAttrs() { return { 'data-editor-ref': component.highlightRefName }; },
          input: event => component.input(event),
          focus: () => { if (!component.source) host.setEditorFocus(component.blockIndex, component.column); },
          keydown: event => host.translationKeydown(event, component.blockIndex, component.column),
          compositionend: event => host.translationCompositionEnd(event, component.blockIndex, component.column),
          altKeyup: event => host.hotkeyPasteHL(event, component.block, component.blockIndex, component.column),
          scroll: () => host.syncHlScroll(component.kind, component.blockIndex, component.columnIndex),
          tooltip: event => component.source ? host.htmlTooltipMouseMove(event) : host.translationTooltipMouseMove(event, component.blockIndex, component.column),
          hideTooltip: () => host.hideTooltip(),
          sourceClick: event => component.sourceClick(event),
        };
      },
    },
    methods: {
      input(event) {
        if (this.source || this.controller.editorTranslationReadOnly) return;
        if (this.columnIndex != null) this.controller.tableColumnInput(this.block, this.blockIndex, this.columnIndex, event);
        else if (this.field.isMultiline) this.controller.normalizeMultilineEditorBlock(this.block, this.blockIndex, event);
        else this.controller.translationInput(this.block, this.blockIndex, event);
      },
      sourceClick(event) {
        if (event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) this.controller.altClickHighlight(event, this.field);
        else if (event.altKey && !event.ctrlKey && !event.shiftKey && !event.metaKey) this.controller.copySpanToClipboard(event);
        else if (!event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) this.controller.copySpanToTranslation(event, this.field, this.blockIndex, this.column);
      },
    },
    template: '<editor-native-field :controller="nativeController" :kind="kind"></editor-native-field>',
  };

  const DictionaryEntries = {
    name: 'EditorDictionaryEntries',
    props: { controller: { type: Object, required: true } },
    computed: {
      ready() { return this.controller.dictionaryReady ?? this.controller.editorReady; },
      useButtons() { return this.controller.dictionaryUseButtons === true && typeof this.controller.useDictionaryTranslation === 'function'; },
    },
    template: `
      <div class="dictionaryEntries" :inert="!ready || undefined">
        <div class="editBlock" v-for="word in controller.visibleDictionary" :key="word._id" :data-dict-id="word._id" :class="{ dictFound: controller.isDictionaryEntryFound(word), dictNew: word._id === controller.dictionaryFlashId }" @focusin="controller.dictionaryEntryFocusIn" @focusout="controller.dictionaryEntryFocusOut">
          <div class="twoSided dictEntryBlock">
            <div>
              <div class="dictRow" :data-dict-id="word._id" :class="{ hlPopupDictActive: controller.isDictionaryPopupSelected?.(word) }">
                <input type="text" v-model="word.find" @input="controller.dictionaryEntryInput(word)" placeholder="Find" lang="en" :class="{ dictExactMatchFind: controller.isDictionaryEntryFindMatched(word) }">
                <input type="text" v-model="word.replace" @input="controller.dictionaryEntryInput(word)" placeholder="Replace" :lang="controller.translationEditorBcp47" @keydown.enter="controller.onDictionaryReplaceEnter($event,word)">
              </div>
              <button v-if="useButtons" type="button" class="dictUseBtn" @click="controller.useDictionaryTranslation(word)" :disabled="!controller.dictionaryCanUse" title="Insert into the focused translation · Ctrl+Enter from Replace">Use translation</button>
              <div class="dictAltHeader">
                <span>Alternates</span>
                <select class="dictScopeSelect" :value="controller.dictionaryEntryScope(word)" @change="controller.setDictionaryEntryScope(word, $event.target.value)" :aria-label="'Game for ' + (word.find || 'this Dictionary entry')" title="Dictionary entry game">
                  <option value="poe1">PoE1</option><option value="poe2">PoE2</option><option value="all">All</option>
                </select>
                <span v-if="controller.dictionaryEntryScopeWarning(word)" class="dictScopeWarning" role="img" :aria-label="controller.dictionaryEntryScopeWarning(word)" :title="controller.dictionaryEntryScopeWarning(word)">⚠</span>
                <button type="button" class="dictHistoryBtn" @click="controller.cloudOpenHistory(word._id)" :disabled="!controller.cloudEntryHistoryAvailable" :aria-label="'View shared history for ' + (word.find || 'this dictionary entry')" :title="controller.cloudEntryHistoryHint"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 11a9 9 0 1 1 2.6 7.4M3 4v7h7M12 7v5l3 2"/></svg></button>
                <button type="button" @click="controller.addDictionaryAltRow(word)" title="Add an alternate translation" :aria-label="'Add an alternate for ' + (word.find || 'this Dictionary entry')">➕</button>
              </div>
              <div class="dictAltRow" v-for="alt in (word.alts || [])" :key="alt._id" :data-dict-id="word._id" :data-dict-alt-id="alt._id" :class="{ hlPopupDictActive: controller.isDictionaryPopupSelected?.(word,alt) }">
                <input type="text" v-model="alt.find" @input="controller.dictionaryEntryInput(word)" placeholder="Find" lang="en" :class="{ dictExactMatchFind: controller.isDictionaryAltFindMatched(word, alt) }">
                <input type="text" v-model="alt.replace" @input="controller.dictionaryEntryInput(word)" placeholder="Replace" :lang="controller.translationEditorBcp47" @keydown.enter="controller.onDictionaryReplaceEnter($event,word,alt)">
                <button v-if="useButtons" type="button" class="dictUseBtn" @click="controller.useDictionaryTranslation(word,alt)" :disabled="!controller.dictionaryCanUse" title="Insert alternate into the focused translation · Ctrl+Enter from Replace">Use translation</button>
                <button type="button" @click="controller.removeDictionaryAltRow(word, alt)" title="Remove this alternate" :aria-label="'Remove alternate ' + (alt.find || alt.replace || 'translation')">🗑️</button>
              </div>
              <details class="dictTlnote">
                <summary>TL note</summary>
                <textarea rows="3" v-model="word.tlnote" @input="controller.dictionaryEntryInput(word)" placeholder="Translator note (shared)" :lang="controller.translationEditorBcp47"></textarea>
              </details>
            </div>
            <button type="button" class="dictDeleteBtn" @click="controller.removeVocab(word)" title="Delete this Dictionary entry" :aria-label="'Delete Dictionary entry ' + (word.find || 'without a Find value')">🗑️</button>
          </div>
        </div>
      </div>
    `,
  };

  // Slots retain the owning editor's refs and event scope. Each surface owns its
  // placement, while the shared assistance and preview content is mounted once.
  const portal = name => ({
    name,
    props: { target: { type: String, required: true } },
    template: '<teleport :to="target"><slot></slot></teleport>',
  });
  const Assistance = portal('EditorAssistance');
  // Both modes use these native layout containers. Slots keep mode-specific
  // fields and actions in their own adapters without adding DOM wrappers.
  const WorkspaceShell = {
    name: 'EditorWorkspaceShell',
    props: { inline: Boolean, contentClass: [String, Object, Array] },
    template: `<div class="workspace" :class="{ inlineEditorMode: inline }">
      <header class="workspaceHeader"><slot name="header"></slot></header>
      <main class="workspaceContent" :class="contentClass"><slot name="content"></slot></main>
      <footer class="workspaceFooter"><slot name="footer"></slot></footer>
      <slot></slot>
    </div>`,
  };
  const FullEditorShell = {
    name: 'EditorFullShell',
    components: { 'app-notice-stack': NoticeStack },
    props: { controller: { type: Object, required: true }, previewHostId: { type: String, required: true },
      sidebarHostId: { type: String, required: true } },
    data() { return { noticeHeight: 0, previewDragHeight: null, previewMeasuredHeight: 0, previewMinHeight: 160, previewMaxHeight: 450 }; },
    computed: {
      previewStyle() {
        const height = this.previewDragHeight ?? this.controller.fullEditorPreviewHeight;
        const portraits = this.controller.ctPreviewPortraits?.length > 0;
        const defaultHeight = this.controller.gamePreviewTargetRows?.length > 1 ? 340 : 200;
        return {
          '--editor-notice-height': this.noticeHeight + 'px',
          '--editor-preview-requested-height': Number.isFinite(height) ? height + 'px' : '',
          '--editor-preview-min-height': portraits ? 'calc(160px * var(--density) + 192px)' : '',
          '--editor-preview-default-height': `calc(${defaultHeight}px * var(--density)${portraits ? ' + 192px' : ''})`,
        };
      },
    },
    mounted() {
      this._previewObserver = new ResizeObserver(() => this.measurePreview());
      this._previewObserver.observe(this.$refs.previewPane);
      this._previewWindowResize = () => this.measurePreview();
      window.addEventListener('resize', this._previewWindowResize);
      this.measurePreview();
    },
    beforeUnmount() {
      this._previewObserver?.disconnect();
      window.removeEventListener('resize', this._previewWindowResize);
      this.finishPreviewResize();
    },
    methods: {
      measurePreview() {
        const pane = this.$refs.previewPane;
        if (!pane) return;
        const density = parseFloat(getComputedStyle(this.$el).getPropertyValue('--density')) || 1;
        this.previewMaxHeight = window.innerHeight / 2;
        this.previewMinHeight = Math.min(160 * density + (this.controller.ctPreviewPortraits?.length ? 192 : 0), this.previewMaxHeight);
        this.previewMeasuredHeight = Math.round(pane.getBoundingClientRect().height);
      },
      clampPreviewHeight(height) { return Math.max(this.previewMinHeight, Math.min(this.previewMaxHeight, height)); },
      rememberPreviewHeight(height) { this.controller.fullEditorPreviewHeight = Math.max(100, Math.min(2000, Math.round(height))); },
      startPreviewResize(event) {
        if (event.button !== 0 || this._previewDrag) return;
        this.measurePreview();
        this._previewDrag = { pointerId: event.pointerId, startY: event.clientY,
          startHeight: this.$refs.previewPane.getBoundingClientRect().height, handle: event.currentTarget };
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.focus({ preventScroll: true });
      },
      movePreviewResize(event) {
        const drag = this._previewDrag;
        if (!drag || event.pointerId !== drag.pointerId) return;
        this.previewDragHeight = this.clampPreviewHeight(drag.startHeight + event.clientY - drag.startY);
      },
      finishPreviewResize(event) {
        const drag = this._previewDrag;
        if (!drag || event && event.pointerId !== drag.pointerId) return;
        this._previewDrag = null;
        if (this.previewDragHeight != null) this.rememberPreviewHeight(this.previewDragHeight);
        this.previewDragHeight = null;
        if (drag.handle.hasPointerCapture(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId);
      },
      previewResizeKeydown(event) {
        const steps = { ArrowUp: -10, ArrowDown: 10, PageUp: -50, PageDown: 50 };
        if (!(event.key in steps) && event.key !== 'Home' && event.key !== 'End') return;
        event.preventDefault(); event.stopPropagation();
        this.measurePreview();
        const height = event.key === 'Home' ? this.previewMinHeight : event.key === 'End' ? this.previewMaxHeight
          : this.$refs.previewPane.getBoundingClientRect().height + steps[event.key];
        this.rememberPreviewHeight(this.clampPreviewHeight(height));
      },
    },
    template: `<div class="editor" :class="{ clipboardHidden: controller.hideEditorClipboard, editorPreviewResizing: previewDragHeight != null }" :style="previewStyle" aria-label="Translation editor">
      <app-notice-stack v-if="$slots.notice" class="editorNotice" sticky label="Editor notices" @resize="noticeHeight = $event"><slot name="notice"></slot></app-notice-stack>
      <div class="edit"><div ref="previewPane" class="editorPreviewPane">
        <div :id="previewHostId"></div>
        <div class="editorPreviewResizeHandle" role="separator" aria-orientation="horizontal" aria-label="Preview height" tabindex="0"
          :aria-controls="previewHostId" :aria-valuemin="Math.round(previewMinHeight)" :aria-valuemax="Math.round(previewMaxHeight)" :aria-valuenow="previewMeasuredHeight"
          :aria-valuetext="previewMeasuredHeight + ' pixels'" title="Drag to resize preview · Up/Down to adjust · Home/End for minimum/maximum"
          @pointerdown.prevent="startPreviewResize" @pointermove="movePreviewResize" @pointerup="finishPreviewResize" @pointercancel="finishPreviewResize" @lostpointercapture="finishPreviewResize" @keydown="previewResizeKeydown">
          <span class="editorPreviewResizeThumb" aria-hidden="true"></span>
        </div>
      </div><slot></slot></div>
      <div :id="sidebarHostId" class="side fixed editorSidebarHost"></div>
      <div class="fixed clipboard" v-show="!controller.hideEditorClipboard">
        <textarea placeholder="📋 Clipboard" aria-label="Editor clipboard" :value="controller.editorClipboard" @change="controller.editorClipboard = $event.target.value" :lang="controller.translationEditorBcp47"></textarea>
      </div>
    </div>`,
  };
  // Components own their DOM, while controllers retain the existing editor
  // behavior. Publishing refs keeps focus, popup placement and visible reads
  // working across component and teleport boundaries.
  const sharedSurface = (name, template, teleport = false) => ({
    name,
    components: { 'app-notice': Notice },
    props: {
      controller: { type: Object, required: true },
      ...(teleport ? { target: { type: String, required: true } } : {}),
    },
    setup(props) {
      // A mode switch can replace the popup controller while retaining the
      // component. Always resolve bindings against the current prop.
      return new Proxy({}, {
        get: (_target, name) => props.controller[name],
        set: (_target, name, value) => { props.controller[name] = value; return true; },
        has: (_target, name) => name in props.controller,
        ownKeys: () => Reflect.ownKeys(props.controller),
        getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
      });
    },
    mounted() { this.$props.controller.registerRefs?.(this.$refs, this); },
    updated() { this.$props.controller.registerRefs?.(this.$refs, this); },
    beforeUnmount() { this.$props.controller.unregisterRefs?.(this); },
    template: teleport ? '<teleport :to="$props.target">' + template + '</teleport>' : template,
  });
  const TranslationMemory = sharedSurface('EditorTranslationMemory', String.raw`<section v-if="sideTab === 'tm'" id="tmResultsPanel" ref="tmResultsPanel" class="tmResultsPanel" tabindex="0" @keydown.stop="tmPanelKeydown" aria-label="Translation memory suggestions">
          <div class="tmToolbar"><label>Minimum match <input type="number" v-model.number="tmThreshold" min="1" max="99" aria-label="Minimum TM match percentage">%</label><button v-if="tmManageAvailable !== false" @click="openTMManager">Manage TM</button></div>
          <div class="tmToolbar"><span>Entry {{ (editorFocusedIndex || 0) + 1 }} · {{ tmUnits.length.toLocaleString() }} remembered</span><button v-if="tmPrefillAvailable !== false" @click="previewTMPrefill" :disabled="tmBusy || editorTranslationReadOnly">Prefill blanks…</button></div>
          <app-notice v-if="tmLocalIssue || tmIssue" class="tmIssue" tone="warning">{{ tmLocalIssue || tmIssue }}</app-notice>
          <p v-if="!tmEditorKey" class="tmEmpty">Focus an entry to see remembered translations.</p>
          <p v-else-if="!tmMatches.length" class="tmEmpty">No matching translation. Save translated entries or build TM from existing work.</p>
          <div class="tmResultList" role="listbox" aria-label="TM matches">
            <button v-for="(match, matchIndex) in tmMatches" :key="match.id" type="button" role="option" :aria-selected="tmSelectedIndex === matchIndex" :class="{ selected: tmSelectedIndex === matchIndex }" @focus="tmSelectedIndex = matchIndex" @click="tmSelectedIndex = matchIndex" @dblclick.prevent="useTMMatch(match)" title="Double-click to use translation">
              <span class="tmMatchHeading"><strong>{{ match.score }}%</strong><span>{{ tmMatchLabel(match) }}</span><small>{{ tmGameLabel(match.unit.gameScope) }}</small></span>
              <span class="tmSourceSnippet">{{ tmText(match.source) }}</span><span class="tmTargetSnippet" :lang="translationEditorBcp47">{{ tmText(match.target) }}</span>
            </button>
          </div>
          <section v-if="tmSelectedMatch" class="tmMatchDetail" aria-label="Selected TM match comparison">
            <h4>Remembered English</h4><div class="tmDiff"><template v-for="(part, partIndex) in tmSelectedMatch.diff.oldSource" :key="partIndex"><span :class="{ tmRemoved: part.changed }">{{ part.text }}</span></template></div>
            <h4>Current English</h4><div class="tmDiff"><template v-for="(part, partIndex) in tmSelectedMatch.diff.currentSource" :key="partIndex"><span :class="{ tmAdded: part.changed }">{{ part.text }}</span></template></div>
            <h4>Suggested translation</h4><div class="tmTargetPreview" :lang="translationEditorBcp47">{{ tmText(tmSelectedMatch.target) }}</div>
            <ul v-if="tmSelectedMatch.warnings.length" class="tmWarnings"><li v-for="warning in tmSelectedMatch.warnings" :key="warning.code">{{ warning.message }}</li></ul>
            <p class="tmProvenance">{{ tmMatchContext(tmSelectedMatch.unit) }}<br><span v-if="tmSelectedMatch.unit.author">{{ tmSelectedMatch.unit.author.name || tmSelectedMatch.unit.author }}</span><span v-if="tmSelectedMatch.unit.provenance?.sourceHash" :title="tmSelectedMatch.unit.provenance.sourceHash"> · Source {{ tmSelectedMatch.unit.provenance.sourceHash.slice(0, 12) }}</span></p>
            <button class="tmUseButton" @click="useTMMatch()" :disabled="editorTranslationReadOnly || editorCompareActive || tmLastMatchKey !== tmEditorKey">Use translation</button>
          </section>
        </section>`);
  const Lookup = sharedSurface('EditorLookup', String.raw`<section v-show="sideTab === 'lookup' && editorReady" id="editorLookupPanel" class="editorLookupPanel" aria-label="Reference lookup" @keydown.stop="lookupPanelKeydown">
          <div class="lookupControls sideControls">
            <div class="sideSearchRow">
              <label class="srOnly" for="editorLookupSearch">Search reference files</label>
              <input id="editorLookupSearch" class="sideFilter" type="search" ref="lookupSearchInput" v-model="lookupQuery" @input="lookupSearchChanged" placeholder="Filename, stat, English, or translation…" autocomplete="off">
              <button v-if="lookupQuery" type="button" @click="lookupClearSearch">Clear</button>
            </div>
            <div class="lookupOptions">
              <label for="editorLookupMode">Content mode<select id="editorLookupMode" v-model="lookupModeFilter"><option value="all">All modes</option><option value="statdescription">StatDescription</option><option value="clienttext">ClientText</option></select></label>
              <label for="editorLookupGroup">Content group<select id="editorLookupGroup" v-model="lookupGroupFilter"><option value="">All prepared groups</option><option v-for="group in lookupGroups" :key="group.id" :value="group.id">{{ group.label }}</option></select></label>
              <label for="editorLookupLanguage">Reference language<select id="editorLookupLanguage" v-model="lookupLanguage"><option value="">{{ lang }} (editor language)</option><option v-for="language in lookupLanguages" :key="language" :value="language">{{ language }}</option></select></label>
              <label for="editorLookupScope">Search in<select id="editorLookupScope" v-model="lookupScope"><option value="all">All text</option><option value="path">Filename / ID / metadata</option><option value="english">English</option><option value="translation">Translation</option></select></label>
            </div>
            <label class="lookupTranslationFilter"><input type="checkbox" v-model="lookupTranslatedOnly"> Only with translation</label>
            <div v-if="lookupPreparationAvailable || lookupPreparing" class="lookupPreparation">
              <button v-if="!lookupPreparing" type="button" @click="lookupPrepareReferences">Prepare missing references<template v-if="lookupMissingReferenceCount"> ({{ lookupMissingReferenceCount }})</template></button>
              <template v-else><span role="status">Preparing reference groups…</span><button type="button" @click="lookupCancelPreparation">Cancel</button></template>
            </div>
            <app-notice v-if="lookupPreparationError" class="cloudWarning" tone="error">{{ lookupPreparationError }}</app-notice>
            <div class="lookupPagination sidePagination" aria-label="Reference result pages">
              <span role="status">{{ lookupRangeLabel }}</span>
              <button type="button" @click="lookupGoToPage(lookupPage - 1)" :disabled="lookupPage <= 1" aria-label="Previous reference results">Previous</button>
              <button type="button" @click="lookupGoToPage(lookupPage + 1)" :disabled="lookupPage >= lookupPageCount" aria-label="Next reference results">Next</button>
            </div>
          </div>
          <div class="lookupResults" ref="lookupResultsList" tabindex="0" aria-label="Reference search results">
            <button v-for="result in lookupVisibleResults" :key="result.key || result.filepath" type="button" class="lookupResult" :class="{ active: lookupSelectedKey === (result.key || result.filepath) }" :aria-pressed="lookupSelectedKey === (result.key || result.filepath)" @click="lookupSelect(result.key || result.filepath)">
              <strong><template v-for="(part, pi) in result.filepathParts" :key="pi"><mark v-if="part.matched" class="lookupQueryMatch">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template></strong>
              <small v-if="result.groupLabel">{{ result.mode === 'clienttext' ? 'ClientText' : 'StatDescription' }} · {{ result.groupLabel }}</small>
              <span v-if="result.metadataParts?.length" class="lookupResultStats"><template v-for="(part, pi) in result.metadataParts" :key="pi"><mark v-if="part.matched" class="lookupQueryMatch">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template></span>
              <span v-if="result.statsParts.length" class="lookupResultStats">{{ result.mode === 'clienttext' ? 'Metadata' : 'Stat' }}: <template v-for="(part, pi) in result.statsParts" :key="pi"><mark v-if="part.matched" class="lookupQueryMatch">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template></span>
              <span class="lookupResultEnglish" lang="en"><template v-for="(part, pi) in result.englishParts" :key="pi"><mark v-if="part.matched" class="lookupQueryMatch">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template><template v-if="!result.englishPreview">(No English text)</template></span>
              <span :lang="lookupReferenceBcp47"><template v-for="(part, pi) in result.translationParts" :key="pi"><mark v-if="part.matched" class="lookupQueryMatch">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template><template v-if="!result.translationPreview">(No translation)</template></span>
            </button>
            <p v-if="!lookupHasAppliedQuery" class="lookupEmpty">Enter a query to search reference files.</p>
            <p v-else-if="!lookupResultCount" class="lookupEmpty">No reference files match. Try another search or language.</p>
          </div>
          <section class="lookupReference" ref="lookupReference" tabindex="0" aria-label="Selected reference">
            <template v-if="lookupSelectedReference">
              <header><h3>{{ lookupSelectedReference.filepath }}</h3><p v-if="lookupSelectedReference.isDNT">Do not translate</p><details v-if="lookupSelectedReference.stats.length"><summary>Stat identifiers</summary><pre class="lookupStats">{{ lookupSelectedReference.stats.join('\n') }}</pre></details></header>
              <ct-context :host="$props.controller" :items="lookupSelectedReference.referenceMetadata || []"></ct-context>
              <section v-if="lookupSelectedReference.developerNotes" class="lookupReferenceBlock"><h4>Developer notes</h4><pre class="lookupText">{{ lookupSelectedReference.developerNotes }}</pre></section>
              <article v-for="block in lookupSelectedReference.blocks" :key="block.index" class="lookupReferenceBlock">
                <h4>{{ block.label || ('Block ' + (block.index + 1)) }}<span v-if="block.form"> · {{ block.form }}</span><span v-if="block.isTable"> · Table (@ separates columns)</span></h4>
                <div class="lookupTextLabel">English</div><pre class="lookupText" lang="en">{{ block.english || '(No English text)' }}</pre>
                <div class="lookupTextLabel">{{ lookupActiveLanguage }}</div><pre class="lookupText" :lang="lookupReferenceBcp47">{{ block.translation || '(No translation)' }}</pre>
              </article>
              <p v-if="!lookupSelectedReference.blocks.length" class="lookupEmpty">This file has no text blocks.</p>
            </template>
            <p v-else class="lookupEmpty">Select a result to read its full text. You can select and copy reference text.</p>
          </section>
        </section>`);
  const Comments = sharedSurface('EditorComments', String.raw`<section v-if="sideTab === 'comments' && editorReady" class="fileCommentsPanel" aria-label="File comments" @keydown.stop>
          <header class="commentsPanelHeader"><div><h2>File comments</h2><p class="commentsFilepath">{{ commentsFileLabel || commentsFilepath }}</p></div></header>
          <p v-if="!commentsEligible && commentsUnavailableReason" class="commentsEmpty">{{ commentsUnavailableReason }}</p>
          <template v-else>
            <app-notice v-if="commentsFileError" class="commentsError" tone="error">{{ commentsFileError }}</app-notice>
            <app-notice v-if="commentsUnreadError" class="commentsError" tone="error">{{ commentsUnreadError }}</app-notice>
            <div ref="commentsFileList" class="commentsList" tabindex="0" aria-label="Comments on this file" :aria-busy="commentsFileBusy">
              <article v-for="comment in commentsFileItems" :key="comment.id" class="commentCard" :class="{ unread: comment.unread }" :data-comment-id="comment.id" data-comments-surface="file">
                <div class="commentByline"><strong>{{ comment.actorName }}</strong><span v-if="comment.language" class="commentLanguage" title="Comment language">{{ comment.language }}</span><span v-if="commentsIsGlobal(comment)" class="commentScope">All languages</span></div>
                <div class="commentMeta"><span v-if="comment.unread" class="commentUnreadLabel">Unread</span><time>{{ commentsTime(comment) }}</time><span v-if="commentsDifferentHash(comment)" class="commentVersionIcon" tabindex="0" role="img" :aria-label="'Different version. This comment was posted from another source version. Source hash: ' + comment.sourceHash" v-tooltip="'Different version. This comment was posted from another source version.\nSource hash: ' + comment.sourceHash"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><path class="commentVersionSymbol" d="M11 6h2v2h-2zM11 10h2v7h-2z"></path></svg></span></div>
                <p class="commentBody">{{ comment.body }}</p>
              </article>
              <p v-if="commentsFileFeed.loaded && !commentsFileItems.length && !commentsFileError" class="commentsEmpty">No comments yet. Share a thought about this file.</p>
              <button v-if="commentsFileHasMore" type="button" class="commentsLoadMore" @click="commentsLoadMoreFile" :disabled="commentsFileFeed.loadingMore">Load older comments</button>
            </div>
            <form class="commentsComposer" @submit.prevent="commentsSubmit">
              <textarea id="fileCommentDraft" v-model="commentsFileDraft" rows="3" maxlength="10000" aria-label="Add a comment" placeholder="Add a comment..." :disabled="!commentsCanPost" @keydown.ctrl.enter.prevent="commentsSubmit" @keydown.meta.enter.prevent="commentsSubmit"></textarea>
              <p v-if="!commentsIdentity.sourceHash" class="commentsEmpty">Load a source version to post a comment.</p>
              <app-notice v-if="commentsPostError" class="commentsError" tone="error">{{ commentsPostError }}</app-notice>
              <div class="commentsComposerActions">
                <label class="commentsScopeOption"><input type="checkbox" v-model="commentsFileAllLanguages" :disabled="!commentsCanPost || commentsPosting">Post to all languages</label>
                <button type="submit" class="btnPrimary" :disabled="!commentsCanPost || commentsPosting || !commentsFileDraft.trim()">{{ commentsPosting ? 'Posting…' : 'Post comment' }}</button>
              </div>
            </form>
          </template>
        </section>`);
  const History = sharedSurface('EditorHistory', String.raw`<div v-if="sideTab === 'history' && editorReady && !historyClientText" class="historyPanel">
          <div v-if="!editorCurrentEditingDesc" class="historyEmpty">Open a file to see history</div>
          <div v-else>
            <div class="historyMeta">
              <div class="historyTitle">{{ editorCurrentEditingDesc.filename }}</div>
              <p class="collaborationLocalHistoryLabel">Local history · saved in this browser</p>
              <label class="collaborationLocalHistoryLabel"><input type="checkbox" v-model="historyIncludeLegacy" @change="refreshHistory"> Show legacy local references</label>
              <p v-if="historyIncludeLegacy" class="collaborationLocalHistoryLabel">Older or ambiguous source records are retained for comparison. These reference copies cannot be restored directly into this version.</p>
              <button class="collaborationHistoryButton" @click="collaborationOpenHistory(editorCurrentEditingDesc.filepath)" :disabled="!collaborationAvailable" :title="collaborationAvailable ? 'View shared translation changes for this source version' : 'Sign in with language access and load a matching source version'">Shared translation history</button>
              <div class="historySubtitle">
                <button class="historyModeBtn" :class="{ active: historyMode === 'translation' }" @click="setHistoryMode('translation')">Translation</button>
                <button class="historyModeBtn" :class="{ active: historyMode === 'source' }" @click="setHistoryMode('source')">Source</button>
                <span>{{ historyMode === 'source' ? 'English' : lang }}</span>
              </div>
            </div>
            <div v-if="historyLoading" class="historyLoading">Loading…</div>
            <div v-else>
              <app-notice v-if="sdHistorySourceError" tone="error">{{ sdHistorySourceError }}</app-notice>
              <div class="historyList">
                <div v-for="rev in historyItems" :key="rev.id" class="historyItem" :class="{ selectedA: historySelectedA && historySelectedA.id === rev.id, selectedB: historySelectedB && historySelectedB.id === rev.id }">
                  <button class="historyPick" :class="{ current: String(rev.note || '').includes('(current)') }" @click="pickHistoryRevision(rev)" :disabled="!!entryAlignment">{{ formatHistoryTime(rev.savedAt) }} {{ rev.note ? (' ' + rev.note) : '' }}</button>
                  <button v-if="historyMode !== 'source' && !rev.legacyReference && !rev.incompleteRecovery" class="historyRestore" title="Restore this saved translation" :aria-label="'Restore translation saved ' + formatHistoryTime(rev.savedAt)" @click="restoreHistoryRevision(rev)" :disabled="!!entryAlignment">↩</button>
                  <button v-if="historyMode !== 'source' && (rev.incompleteRecovery || String(rev.note || '').startsWith('Before entry alignment'))" type="button" @click="alignHistoryRevision(rev)" :disabled="editorSaving || !!entryAlignment">{{ rev.incompleteRecovery ? 'Recover into draft' : 'Align these blocks' }}</button>
                </div>
                <div v-if="historyItems.length === 0" class="historyEmpty">No revisions yet</div>
              </div>
              <div class="historyCompareBar" v-if="historyItems.length > 0">
                <button @click="clearHistorySelection()">Clear</button>
                <span v-if="!historySelectedB">Click a revision to compare against current</span>
                <span v-else>Comparing current → {{ formatHistoryTime(historySelectedB.savedAt) }}</span>
              </div>
              <div v-if="historyDiffHtml" class="historyDiff" v-html="historyDiffHtml"></div>
            </div>
          </div>
        </div>`);
  const Tools = sharedSurface('EditorTools', String.raw`<div class="side sharedEditorSidebar" ref="editorSide" data-inline-focus-surface @focusout="inlineRowFocusOut" :inert="!editorReady" :class="{ ctTools: historyClientText, commentsActive: sideTab === 'comments', lookupActive: sideTab === 'lookup' }">
        <div class="sideHeader">
          <div class="sideTabs">
            <button class="tabBtn" :class="{ active: sideTab === 'dictionary' }" @click="sideTab = 'dictionary'">📚 Dictionary</button>
            <button type="button" class="tabBtn lookupTab" :class="{ active: sideTab === 'lookup' }" @click="openEditorLookup" :aria-pressed="sideTab === 'lookup'" aria-controls="editorLookupPanel"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"></circle><path d="m16 16 5 5"></path></svg> Lookup</button>
            <button type="button" class="tabBtn" :class="{ active: sideTab === 'tm' }" @click="sideTab = 'tm'" aria-controls="tmResultsPanel">TM<span v-if="tmConflicts.length"> ⚡ {{ tmConflicts.length }}</span></button>
            <button v-if="editorVisible && !historyClientText" class="tabBtn" :class="{ active: sideTab === 'history' }" @click="sideTab = 'history'">🕒 History</button>
            <button v-if="!editorVisible" type="button" class="tabBtn" :class="{ active: sideTab === 'preview' }" @click="sideTab = 'preview'">Preview</button>
            <button class="tabBtn commentsTab" :class="{ active: sideTab === 'comments' }" @click="sideTab = 'comments'" :aria-label="'Comments' + (commentsFileUnread ? ', ' + commentsFileUnread + ' unread' : '')"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 4h16v13H8l-4 4V4Z"></path><path d="M7 8h10M7 11h10M7 14h7"></path></svg> Comments<span v-if="commentsFileUnread" class="commentsUnreadBadge" aria-hidden="true">{{ commentsBadge(commentsFileUnread) }}</span></button>
          </div>
          <div v-if="sideTab === 'dictionary'" class="dictionaryControls sideControls">
            <div class="sideSearchRow"><input class="sideFilter" type="search" v-model="dictionaryFilter" ref="dictionaryFilterInput" placeholder="Search dictionary…" aria-label="Search dictionary entries" @keydown.esc="dictionaryFilter = ''"><button type="button" @click="sideAddClicked()" :disabled="!(dictionaryReady ?? editorReady)" title="Add a Dictionary entry">Add entry</button></div>
            <div class="dictionaryPagination sidePagination" aria-label="Dictionary pages">
              <span><template v-if="editorReady">{{ dictionaryRangeLabel }}<template v-if="editorCurrentEditingDesc"> · Matches in this file first</template></template><template v-else>&nbsp;</template></span>
              <button type="button" @click="setDictionaryPage(Math.min(dictionaryPage, dictionaryPageCount) - 1)" :disabled="!editorReady || dictionaryPage <= 1" aria-label="Previous dictionary page">Previous</button>
              <button type="button" @click="setDictionaryPage(dictionaryPage + 1)" :disabled="!editorReady || dictionaryPage >= dictionaryPageCount" aria-label="Next dictionary page">Next</button>
            </div>
          </div>
        </div>

        <div v-show="!editorVisible && sideTab === 'preview'" id="inlineEditorPreviewHost" class="inlinePreviewHost"></div>
        <editor-dictionary-entries v-if="sideTab === 'dictionary'" :controller="$props.controller"></editor-dictionary-entries>

        <editor-translation-memory-panel :controller="$props.controller"></editor-translation-memory-panel>
        <editor-lookup-panel :controller="$props.controller"></editor-lookup-panel>
        <editor-comments-panel :controller="$props.controller"></editor-comments-panel>
        <editor-history-panel :controller="$props.controller"></editor-history-panel>
      </div>`, true);
  Tools.components = { 'editor-translation-memory-panel': TranslationMemory, 'editor-lookup-panel': Lookup, 'editor-comments-panel': Comments, 'editor-history-panel': History };
  const PreviewAudio = {
    name: 'EditorPreviewAudio',
    props: { segment: { type: Object, required: true }, controller: { type: Object, required: true } },
    methods: {
      showTooltip(event, text) { this.controller.showTooltip?.(event, text); },
      hideTooltip() { this.controller.hideTooltip?.(); },
    },
    template: String.raw`<span class="gamePreviewAudioMarker" :data-audio-marker="segment.full" tabindex="0" role="img" :aria-label="segment.tooltip" v-tooltip="segment.tooltip"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 9h4l5-4v14l-5-4H3z"></path><path d="M19 6v7"></path><circle class="gamePreviewAudioDot" cx="19" cy="17" r="1"></circle></svg></span>`,
  };
  const SharedPreview = sharedSurface('EditorPreview', String.raw`<div class="gamePreviewStrip" :class="{ 'gamePreviewStrip--variants': gamePreviewTargetRows.length > 1, 'gamePreviewStrip--split': gamePreviewFullEditor && ctActive, 'gamePreviewStrip--source-hidden': hideSourceInPreviewPanel, 'gamePreviewStrip--portraits': ctActive && ctPreviewPortraits.length > 0 }">
          <div v-if="ctActive && ctPreviewPortraits.length" class="ctPreviewPortraitBand"><ct-portraits :items="ctPreviewPortraits"></ct-portraits></div>
          <div v-if="gamePreviewFullEditor && !ctActive" class="gamePreviewToolbar twoSided">
            <span class="gamePreviewLabel">Preview size</span>
            <div class="gamePreviewFrameBtns">
              <button type="button" class="gamePreviewFrameBtn" :class="{ active: gamePreviewFrame === 's' }" :aria-pressed="gamePreviewFrame === 's'" title="Use a small preview frame" @click="setGamePreviewFrame('s')">Small</button>
              <button type="button" class="gamePreviewFrameBtn" :class="{ active: gamePreviewFrame === 'm' }" :aria-pressed="gamePreviewFrame === 'm'" title="Use a medium preview frame" @click="setGamePreviewFrame('m')">Medium</button>
              <button type="button" class="gamePreviewFrameBtn" :class="{ active: gamePreviewFrame === 'l' }" :aria-pressed="gamePreviewFrame === 'l'" title="Use a large preview frame" @click="setGamePreviewFrame('l')">Large</button>
            </div>
          </div>
          <div class="gamePreviewMainRow">
            <div class="gamePreviewFrameWrap">
              <div class="gamePreviewFramesColumn">
                <div v-if="!hideSourceInPreviewPanel" class="gamePreviewSourcePane" :tabindex="gamePreviewFullEditor ? 0 : undefined" :role="gamePreviewFullEditor ? 'region' : undefined" :aria-label="gamePreviewFullEditor ? 'English preview' : undefined">
                <div class="gamePreviewLine">
                  <div class="gamePreviewLineLabel">EN</div>
                  <div class="gamePreviewWindow" :class="['gamePreviewWindow--' + gamePreviewFrame, { 'gamePreviewWindow--dialogue': gamePreviewIsDialogue }]" :style="{ fontFamily: gamePreviewSourceFontFamily, color: gamePreviewDefaultTextColor }">
                    <template v-for="(seg, si) in gamePreviewAudioSegments(gamePreviewDisplaySource)" :key="'gps-' + si + '-' + seg.type + (seg.type === 'var' ? seg.key : '')">
                      <span v-if="seg.type === 'text'" class="gamePreviewText" :class="seg.decorTag ? 'gamePreviewDecor--' + seg.decorTag : ''" :style="seg.decorStyle">{{ seg.text }}</span>
                      <span v-else-if="seg.type === 'kw'" class="gamePreviewKw" :class="seg.decorTag ? 'gamePreviewDecor--' + seg.decorTag : ''" :style="seg.decorStyle" v-tooltip="seg.full">
                        <template v-if="seg.parts"><template v-for="(part, pi) in seg.parts" :key="'gps-part-' + si + '-' + pi">
                          <span v-if="part.type === 'text'" class="gamePreviewText" :class="part.decorTag ? 'gamePreviewDecor--' + part.decorTag : ''" :style="part.decorStyle">{{ part.text }}</span>
                          <span v-else-if="part.type === 'var'" class="gamePreviewVarDisplay" :class="part.decorTag ? 'gamePreviewDecor--' + part.decorTag : ''" :style="part.decorStyle">
                            <span class="gamePreviewVarValue" v-tooltip="part.full">{{ part.prefix + (gamePreviewVarValues[part.key] ?? defaultPreviewVarValue(part.key)) }}</span><span v-if="part.trailingPercent" class="gamePreviewVarPct">%</span>
                          </span>
                          <br v-else-if="part.type === 'break'" class="gamePreviewBreak">
                        </template></template><template v-else>{{ gamePreviewKeywordText(seg) }}</template>
                      </span>
                      <span v-else-if="seg.type === 'var'" class="gamePreviewVarDisplay" :class="seg.decorTag ? 'gamePreviewDecor--' + seg.decorTag : ''" :style="seg.decorStyle">
                        <span class="gamePreviewVarValue" v-tooltip="seg.full">{{ seg.prefix + gamePreviewVarValues[seg.key] }}</span><span v-if="seg.trailingPercent" class="gamePreviewVarPct">%</span>
                      </span>
                      <editor-preview-audio v-else-if="seg.type === 'audio'" :segment="seg" :controller="$props.controller"></editor-preview-audio>
                      <ct-audio-controls v-else-if="seg.type === 'playback'" :host="$props.controller" :indices="seg.tracks" preview></ct-audio-controls>
                      <span v-else-if="seg.type === 'continue'" class="gamePreviewContinue">Continue</span>
                      <span v-else-if="seg.type === 'rightAlign'" class="gamePreviewRightAlign"></span>
                      <span v-else-if="seg.type === 'break' && gamePreviewSourceIsTable" class="gamePreviewBreak"></span>
                      <br v-else-if="seg.type === 'break'" class="gamePreviewBreak">
                    </template>
                    <span v-if="gamePreviewDisplaySource.length === 0" class="gamePreviewEmpty">(empty)</span>
                  </div>
                </div>
                </div>
                <div class="gamePreviewTargetPane" :tabindex="gamePreviewFullEditor ? 0 : undefined" :role="gamePreviewFullEditor ? 'region' : undefined" :aria-label="gamePreviewFullEditor ? 'Translation preview' : undefined">
                <template v-for="row in gamePreviewTargetRows" :key="row.key">
                <div v-if="row.label" class="gamePreviewVariantLabel">{{ row.label }}</div>
                <div class="gamePreviewLine" :data-preview-variant="row.key">
                  <div class="gamePreviewLineLabel">{{ translationEditorBcp47 || lang || 'TL' }}</div>
                  <div class="gamePreviewWindow" :class="['gamePreviewWindow--' + gamePreviewFrame, { 'gamePreviewWindow--dialogue': gamePreviewIsDialogue }]" :style="{ fontFamily: gamePreviewFontFamily, color: gamePreviewDefaultTextColor }">
                    <template v-for="(seg, si) in row.segments" :key="'gp-' + si + '-' + seg.type + (seg.type === 'var' ? seg.key : '')">
                      <span v-if="seg.type === 'text'" class="gamePreviewText" :class="seg.decorTag ? 'gamePreviewDecor--' + seg.decorTag : ''" :style="seg.decorStyle">{{ seg.text }}</span>
                      <span v-else-if="seg.type === 'kw'" class="gamePreviewKw" :class="seg.decorTag ? 'gamePreviewDecor--' + seg.decorTag : ''" :style="seg.decorStyle" v-tooltip="seg.full">
                        <template v-if="seg.parts"><template v-for="(part, pi) in seg.parts" :key="'gp-part-' + si + '-' + pi">
                          <span v-if="part.type === 'text'" class="gamePreviewText" :class="part.decorTag ? 'gamePreviewDecor--' + part.decorTag : ''" :style="part.decorStyle">{{ part.text }}</span>
                          <span v-else-if="part.type === 'var'" class="gamePreviewVarDisplay" :class="part.decorTag ? 'gamePreviewDecor--' + part.decorTag : ''" :style="part.decorStyle">
                            <span class="gamePreviewVarValue" v-tooltip="part.full">{{ part.prefix + (gamePreviewVarValues[part.key] ?? defaultPreviewVarValue(part.key)) }}</span><span v-if="part.trailingPercent" class="gamePreviewVarPct">%</span>
                          </span>
                          <br v-else-if="part.type === 'break'" class="gamePreviewBreak">
                        </template></template><template v-else>{{ gamePreviewKeywordText(seg) }}</template>
                      </span>
                      <span v-else-if="seg.type === 'var'" class="gamePreviewVarDisplay" :class="seg.decorTag ? 'gamePreviewDecor--' + seg.decorTag : ''" :style="seg.decorStyle">
                        <span class="gamePreviewVarValue" v-tooltip="seg.full">{{ seg.prefix + gamePreviewVarValues[seg.key] }}</span><span v-if="seg.trailingPercent" class="gamePreviewVarPct">%</span>
                      </span>
                      <editor-preview-audio v-else-if="seg.type === 'audio'" :segment="seg" :controller="$props.controller"></editor-preview-audio>
                      <span v-else-if="seg.type === 'continue'" class="gamePreviewContinue">Continue</span>
                      <span v-else-if="seg.type === 'rightAlign'" class="gamePreviewRightAlign"></span>
                      <span v-else-if="seg.type === 'break' && gamePreviewTargetIsTable" class="gamePreviewBreak"></span>
                      <br v-else-if="seg.type === 'break'" class="gamePreviewBreak">
                    </template>
                    <span v-if="row.segments.length === 0" class="gamePreviewEmpty">(empty)</span>
                  </div>
                </div>
                </template>
                </div>
              </div>
            </div>
            <div class="gamePreviewVarsColumn" :class="{ isEmpty: gamePreviewVarKeyList.length === 0 && !(ctActive && ctPossessivePreviewForms) }">
              <div class="gamePreviewVarsPanel" :class="{ isEmpty: gamePreviewVarKeyList.length === 0 && !(ctActive && ctPossessivePreviewForms) }">
                <template v-if="ctActive && ctPossessivePreviewForms">
                  <label class="gamePreviewVarField"><span class="gamePreviewVarLabel">Example</span>
                    <select class="gamePreviewVarInput" :value="ctPreviewAffixes.example" aria-label="Affix example" @change="ctSetPreviewAffixExample($event.target.value)">
                      <option v-for="example in ctPreviewAffixExamples" :key="example.key" :value="example.key">{{ example.label }}</option>
                    </select>
                  </label>
                  <label class="gamePreviewVarField"><span class="gamePreviewVarLabel">Prefix</span>
                    <input type="text" class="gamePreviewVarInput" v-model="ctPreviewAffixes.prefix" :lang="translationEditorBcp47" aria-label="Preview prefix">
                  </label>
                  <label class="gamePreviewVarField"><span class="gamePreviewVarLabel">Suffix</span>
                    <input type="text" class="gamePreviewVarInput" v-model="ctPreviewAffixes.suffix" :lang="translationEditorBcp47" aria-label="Preview suffix">
                  </label>
                </template>
                <div v-if="gamePreviewVarKeyList.length === 0 && !(ctActive && ctPossessivePreviewForms)" class="gamePreviewVarField gamePreviewVarsPlaceholder">
                  <div class="gamePreviewVarLabel">{}</div>
                  <div class="gamePreviewVarInput gamePreviewVarInputPlaceholder">No variables</div>
                </div>
                <template v-if="gamePreviewVarKeyList.length">
                  <div class="gamePreviewVarField" v-for="k in gamePreviewVarKeyList" :key="'gp-var-field-' + k">
                    <label class="gamePreviewVarLabel">{{ '{' + k + '}' }}</label>
                    <input type="text" class="gamePreviewVarInput" v-model="gamePreviewVarValues[k]" :lang="translationEditorBcp47"
                      :aria-label="'Variable {' + k + '}'">
                  </div>
                </template>
              </div>
            </div>
          </div>
        </div>`, true);
  SharedPreview.components = { 'editor-preview-audio': PreviewAudio };
  const Autocomplete = sharedSurface('EditorAutocomplete', String.raw`<div v-if="hlPopup.visible" class="hlPopupBackdrop" data-inline-focus-surface @focusout="inlineRowFocusOut" @mousedown="closeHlPopup">
        <div class="hlPopup" ref="hlPopupPanel" :style="{ left: hlPopup.x + 'px', top: hlPopup.y + 'px', width: hlPopup.width + 'px', maxHeight: hlPopup.maxHeight ? hlPopup.maxHeight + 'px' : '' }" @mousedown.stop>
          <input class="hlPopupFilter" type="text" ref="hlPopupFilter" v-model="hlPopup.filter" placeholder="Filter highlights" aria-label="Filter highlights" aria-autocomplete="list" aria-controls="sharedEditorAutocompleteList" :aria-expanded="hlPopup.visible" :aria-activedescendant="hlPopup.filtered.length ? 'sharedEditorAutocompleteOption-' + hlPopup.selectedIndex : undefined" @keydown="hlPopupFilterKeydown" @input="applyHlPopupFilter">
          <div id="sharedEditorAutocompleteList" class="hlPopupList" role="listbox" aria-label="Highlights">
            <div v-for="(item, i) in hlPopup.filtered" :id="'sharedEditorAutocompleteOption-' + i" :key="i" class="hlPopupItem" role="option" :aria-selected="i === hlPopup.selectedIndex" :class="{ active: i === hlPopup.selectedIndex, alt: item.isAlt, exact: item.exactMatch, mustCreate: item.mustCreate }" @mouseenter="hlPopup.selectedIndex = i" @mousedown.prevent="insertHlPopupItem(item)">
              <span class="hlPopupItemLabel">{{ item.label }}</span>
              <span v-if="i === hlPopup.selectedIndex && hlPopupCtrlEnterPillText(item)" class="hlPopupHotkeyPill">{{ hlPopupCtrlEnterPillText(item) }}</span>
            </div>
            <div v-if="hlPopup.filtered.length === 0" class="hlPopupEmpty">No highlights</div>
          </div>
        </div>
        <aside v-if="hlPopupTlnote" class="hlPopupTlnote" :style="{ left: hlPopup.noteX + 'px', top: hlPopup.noteY + 'px', width: hlPopup.noteWidth + 'px', maxHeight: hlPopup.noteMaxHeight + 'px' }" role="note" aria-label="TL note" @mousedown.stop>
          <strong>TL note</strong>
          <div class="hlPopupTlnoteText" :lang="translationEditorBcp47">{{ hlPopupTlnote }}</div>
        </aside>
      </div>`);
  const DiagnosticMeta = {
    name: 'EditorDiagnosticMeta',
    props: { presentation: { type: Object, required: true } },
    methods: {
      showTooltip(event, text) { this.$root.showTooltip(event, text); },
      hideTooltip() { this.$root.hideTooltip(); },
    },
    template: `<span v-if="presentation.warningCount > 0" class="metaPill diagnosticWarningPill" v-tooltip="presentation.warningTitle"><span class="metaIcon">!</span><span class="metaNum">{{ presentation.warningCount }}</span></span>
      <span v-if="presentation.errorCount > 0" class="metaPill diagnosticErrorPill" v-tooltip="presentation.errorTitle"><span class="metaIcon">x</span><span class="metaNum">{{ presentation.errorCount }}</span></span>
      <span v-for="tag in presentation.missingTags || []" :key="tag.key" class="metaPill diagnosticMissingTagPill" role="note" tabindex="0" v-tooltip="tag.title">{{ tag.label }}</span>`,
  };
  const DiagnosticScan = sharedSurface('EditorDiagnosticScan', String.raw`    <dialog ref="diagnosticScanDialog" class="diagnosticScanDialog" aria-labelledby="diagnosticScanDialogTitle" aria-describedby="diagnosticScanDialogDescription" @cancel.prevent="closeDiagnosticScanDialog" @close="diagnosticScanDialogClosed" @keydown.stop="diagnosticScanDialogKeydown">
      <form class="diagnosticScanForm" @submit.prevent="startDiagnosticScan">
        <header class="diagnosticScanHeading">
          <div>
            <h2 id="diagnosticScanDialogTitle" ref="diagnosticScanHeading" tabindex="-1">Scan diagnostics</h2>
            <p id="diagnosticScanDialogDescription">{{ diagnosticScanDescription }}</p>
          </div>
          <button type="button" class="diagnosticScanClose" @click="closeDiagnosticScanDialog" aria-label="Close diagnostic scan (Esc)">Close</button>
        </header>
        <div class="diagnosticScanBody">
          <section v-if="diagnosticScanRunning || diagnosticScanCompleted || diagnosticScanStopped || diagnosticScanError" class="diagnosticScanStatus" :class="{ diagnosticScanFailed: diagnosticScanError }" aria-label="Scan status">
            <p class="diagnosticScanStatusText" role="status" aria-live="polite" aria-atomic="true">
              <template v-if="diagnosticScanRunning">{{ diagnosticScanPhase }} {{ diagnosticScanProcessed }} of {{ diagnosticScanTotal }} {{ diagnosticScanUnitLabel(diagnosticScanTotal) }} · {{ diagnosticScanPercent }}%</template>
              <template v-else-if="diagnosticScanCompleted">Scan complete · {{ diagnosticScanTotal }} {{ diagnosticScanUnitLabel(diagnosticScanTotal) }} checked</template>
              <template v-else-if="diagnosticScanStopped">Scan stopped after {{ diagnosticScanProcessed }} of {{ diagnosticScanTotal }} {{ diagnosticScanUnitLabel(diagnosticScanTotal) }}. Start again to get complete results.</template>
              <template v-else>{{ diagnosticScanError }}</template>
            </p>
            <progress v-if="diagnosticScanRunning" :value="diagnosticScanProcessed" :max="Math.max(1, diagnosticScanTotal)" :aria-label="diagnosticScanProgressLabel"></progress>
            <div v-if="diagnosticScanRunning || diagnosticScanCompleted" class="diagnosticScanCounts">
              <span class="diagnosticScanCount diagnosticScanCountError"><strong>{{ diagnosticScanErrorFileCount }}</strong> {{ diagnosticScanUnitLabel(diagnosticScanErrorFileCount) }} with errors<span v-if="diagnosticScanCompleted"> · {{ diagnosticScanIssueCounts.errors }} {{ diagnosticScanIssueCounts.errors === 1 ? 'issue' : 'issues' }}</span></span>
              <span class="diagnosticScanCount diagnosticScanCountWarning"><strong>{{ diagnosticScanWarningFileCount }}</strong> {{ diagnosticScanUnitLabel(diagnosticScanWarningFileCount) }} with warnings<span v-if="diagnosticScanCompleted"> · {{ diagnosticScanIssueCounts.warnings }} {{ diagnosticScanIssueCounts.warnings === 1 ? 'issue' : 'issues' }}</span></span>
              <span v-if="diagnosticScanCompleted" class="diagnosticScanCount"><strong>{{ diagnosticScanTotal - diagnosticScanResultFiles.length }}</strong> {{ diagnosticScanUnitLabel(diagnosticScanTotal - diagnosticScanResultFiles.length) }} without findings</span>
            </div>
            <p v-if="diagnosticScanRunning" class="diagnosticScanBackgroundHint">You can close this window while the scan runs and reopen it from Scan diagnostics.</p>
          </section>
          <details class="diagnosticScanChecksDisclosure" :open="!diagnosticScanRunning && !diagnosticScanCompleted">
            <summary>Diagnostic checks <span>{{ diagnosticScanTypes.filter(type => diagnosticScanChecks[type.key]).length }} selected</span></summary>
            <fieldset class="diagnosticScanOptions" :disabled="diagnosticScanRunning">
              <legend class="visuallyHidden">Diagnostic types</legend>
              <label v-for="type in diagnosticScanTypes" :key="type.key" class="diagnosticScanOption">
                <input type="checkbox" v-model="diagnosticScanChecks[type.key]" :aria-labelledby="'diagnosticScanLabel-' + type.key" :aria-describedby="'diagnosticScanHint-' + type.key">
                <span><strong :id="'diagnosticScanLabel-' + type.key">{{ type.label }}</strong><small :id="'diagnosticScanHint-' + type.key">{{ type.description }}</small></span>
              </label>
            </fieldset>
            <p class="diagnosticScanHint">{{ diagnosticScanCheckHint }}</p>
          </details>
          <section v-if="diagnosticScanCompleted" class="diagnosticScanResults" aria-label="Scan results">
            <div class="diagnosticScanResultsHeading">
              <h3>{{ diagnosticScanResultFiles.length ? diagnosticScanResultsTitle : 'No issues found' }}</h3>
              <span v-if="diagnosticScanResultFiles.length">{{ diagnosticScanResultFiles.length }} {{ diagnosticScanUnitLabel(diagnosticScanResultFiles.length) }}</span>
            </div>
            <nav v-if="diagnosticScanResultPageCount > 1" class="diagnosticScanResultPagination" aria-label="Scan result pages">
              <span class="fileRange" role="status" aria-live="polite" aria-atomic="true">{{ diagnosticScanResultRangeLabel }}</span>
              <button type="button" class="paginationArrow" :disabled="diagnosticScanResultsPage <= 1" @click="diagnosticScanResultsPage--" aria-label="Previous scan results" title="Previous scan results"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m14 7-5 5 5 5"></path></svg></button>
              <button type="button" class="paginationArrow" :disabled="diagnosticScanResultsPage >= diagnosticScanResultPageCount" @click="diagnosticScanResultsPage++" aria-label="Next scan results" title="Next scan results"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m10 7 5 5-5 5"></path></svg></button>
            </nav>
            <p v-if="!diagnosticScanResultFiles.length" class="diagnosticScanEmpty">The selected checks found no errors or warnings.</p>
            <article v-for="entry in diagnosticScanVisibleResults" :key="entry.filepath" class="diagnosticScanResultCard">
              <div class="diagnosticScanResultHeading">
                <div>
                  <h4><bdi>{{ entry.label || entry.filepath }}</bdi></h4>
                  <div class="diagnosticScanResultCounts">
                    <span v-if="entry.result.errorCount" class="diagnosticScanResultError">{{ entry.result.errorCount }} {{ entry.result.errorCount === 1 ? 'error' : 'errors' }}</span>
                    <span v-if="entry.result.warningCount" class="diagnosticScanResultWarning">{{ entry.result.warningCount }} {{ entry.result.warningCount === 1 ? 'warning' : 'warnings' }}</span>
                  </div>
                </div>
                <button type="button" @click="openDiagnosticResult(entry.filepath)" :aria-label="'Open ' + (entry.label || entry.filepath)">{{ openDiagnosticResultLabel }}</button>
              </div>
              <ul class="diagnosticScanIssues">
                <li v-for="(issue, index) in entry.result.diagnostics.slice(0, 3)" :key="index">
                  <span class="diagnosticScanIssueLocation">{{ diagnosticScanIssueLocation(issue) }} · {{ issue.level }}</span>
                  <span>{{ issue.message || issue.code }}</span>
                </li>
              </ul>
              <details v-if="entry.result.diagnostics.length > 3" class="diagnosticScanMoreIssues">
                <summary>{{ entry.result.diagnostics.length - 3 }} more {{ entry.result.diagnostics.length - 3 === 1 ? 'issue' : 'issues' }}</summary>
                <ul class="diagnosticScanIssues">
                  <li v-for="(issue, index) in entry.result.diagnostics.slice(3)" :key="index">
                    <span class="diagnosticScanIssueLocation">{{ diagnosticScanIssueLocation(issue) }} · {{ issue.level }}</span>
                    <span>{{ issue.message || issue.code }}</span>
                  </li>
                </ul>
              </details>
              <p v-if="entry.result.diagnosticsTruncated" class="diagnosticScanTruncated">{{ entry.result.diagnosticsTruncated }} more {{ entry.result.diagnosticsTruncated === 1 ? 'finding' : 'findings' }}. {{ diagnosticScanTruncatedHint }}</p>
            </article>
          </section>
        </div>
        <footer class="diagnosticScanActions">
          <span class="diagnosticScanEscapeHint">Esc to close</span>
          <button type="button" @click="closeDiagnosticScanDialog">Close</button>
          <button v-if="diagnosticScanRunning" type="button" class="diagnosticScanStop" @click="stopDiagnosticScan">Stop scan</button>
          <button v-else type="submit" class="diagnosticScanStart" :disabled="!hasDiagnosticScanSelection">{{ diagnosticScanCompleted ? 'Scan again' : 'Start scan' }}</button>
        </footer>
      </form>
    </dialog>`);
  const AttentionNavigation = {
    name: 'EditorAttentionNavigation',
    props: { controller: { type: Object, required: true } },
    methods: {
      showTooltip(event, text) { this.controller.showTooltip(event, text); },
      hideTooltip() { this.controller.hideTooltip(); }
    },
    template: `<span class="attentionNavigation" role="group" aria-label="Files needing attention" data-inline-focus-surface>
      <span v-for="direction in [-1, 1]" :key="direction" class="attentionNavigationTarget" :tabindex="controller.attentionNavigationBlocked || !controller.attentionNavigationTargets[direction < 0 ? 'previous' : 'next'] ? 0 : -1" :aria-label="controller.attentionNavigationTooltip(direction)" v-tooltip="controller.attentionNavigationTooltip(direction)">
        <button type="button" class="paginationArrow attentionArrow" @click="controller.navigateAttention(direction)" :disabled="controller.attentionNavigationBlocked || !controller.attentionNavigationTargets[direction < 0 ? 'previous' : 'next']" :aria-label="direction < 0 ? 'Previous file needing attention' : 'Next file needing attention'" :aria-keyshortcuts="direction < 0 ? 'Control+Shift+,' : 'Control+Shift+.'" v-tooltip="controller.attentionNavigationTooltip(direction)">
          <svg aria-hidden="true" viewBox="0 0 24 24"><path v-if="direction < 0" d="m9 7-5 5 5 5M17 6v7m0 4v.1"></path><path v-else d="m15 7 5 5-5 5M7 6v7m0 4v.1"></path></svg>
        </button>
      </span>
    </span>`
  };
  const FieldToolbar = {
    name: 'EditorFieldToolbar', props: { controller: { type: Object, required: true } },
    components: { 'app-notice': Notice },
    methods:{closeMenu(){this.controller.closeMenu();this.$nextTick(()=>this.$refs.menuButton?.focus({preventScroll:true}));},toolbarKeydown(event){if(event.key==='Escape' && event.target.closest('.editorFieldToolbar,.editorFieldComparisonControls,.fieldHistoryMenu')){event.preventDefault();event.stopPropagation();this.closeMenu();}}},
    template: `<div class="editorFieldTools" :data-comparison-side="controller.side" data-inline-focus-surface @click.stop @dblclick.stop @keydown="toolbarKeydown($event)">
      <div class="editorFieldFrame" :class="controller.tone"><slot></slot>
      <div class="editorFieldToolbar" role="group" :aria-label="controller.side === 'source' ? 'English field tools' : 'Translation field tools'">
        <template v-if="controller.formatting"><button v-for="style in ['b','i','u']" :key="style" type="button" :class="['fieldStyleButton','fieldStyle-'+style,{active:controller.styleActive(style)}]" @pointerdown.prevent="controller.capture()" @click="controller.format(style)" :disabled="controller.formattingDisabled" :aria-pressed="controller.styleActive(style)" :aria-label="({b:'Bold',i:'Italic',u:'Underline'})[style]" :aria-keyshortcuts="'Control+'+style" :title="({b:'Bold',i:'Italic',u:'Underline'})[style]+' · Ctrl+'+style.toUpperCase()">{{ style.toUpperCase() }}</button></template>
        <span class="fieldToolbarSeparator" role="separator" aria-orientation="vertical"></span>
        <button type="button" class="fieldDiffButton" :class="{active:controller.open}" @click="controller.toggle()" :disabled="controller.disabled" :aria-expanded="controller.open" :aria-label="controller.side === 'source' ? 'Compare English source' : 'Compare translation'" :title="controller.side === 'source' ? 'Compare an earlier English source with this version' : 'Compare a revision with the current draft'"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 11a9 9 0 1 1 2.6 7.4M3 4v7h7M12 7v5l3 2"/></svg></button>
        <button ref="menuButton" type="button" class="fieldHistoryMenuButton" :class="{active:controller.menuOpen}" @click="controller.menu()" :disabled="controller.disabled" :aria-expanded="controller.menuOpen" aria-label="Comparison options and revision history" title="Comparison options and revision history"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m9.5 2-.6 2.4-1.8 1-2.4-.7-2.5 4.3 1.8 1.7v2l-1.8 1.7 2.5 4.3 2.4-.7 1.8 1 .6 2.4h5l.6-2.4 1.8-1 2.4.7 2.5-4.3-1.8-1.7v-2l1.8-1.7-2.5-4.3-2.4.7-1.8-1-.6-2.4Z"/><circle cx="12" cy="12" r="3"/></svg></button>
      </div></div>
      <div v-if="controller.open" class="editorFieldComparisonControls"><select :value="controller.reference" @change="controller.select($event.target.value)" :disabled="controller.disabled" :title="controller.choices.find(choice=>choice.key===controller.reference)?.label" :aria-label="controller.side === 'source' ? 'English version to compare' : 'Translation revision to compare'"><option v-if="!controller.choices.length" value="">Earlier original unavailable</option><optgroup v-for="group in controller.groups" :key="group" :label="group"><option v-for="choice in controller.choices.filter(value=>value.group===group)" :key="choice.key" :value="choice.key">{{ choice.label }}</option></optgroup></select><span class="fieldDiffArrow" aria-hidden="true">→</span><span class="fieldDiffLatest">Latest</span></div>
      <app-notice v-if="controller.open && controller.error" class="ctHistoryError" tone="error">{{ controller.error }}</app-notice>
      <p v-if="controller.open && !controller.parts" class="fieldDiffUnavailable">{{ controller.busy ? 'Preparing earlier original…' : 'Earlier original unavailable. Open the menu to load previous versions.' }}</p>
      <pre v-if="controller.open && controller.side === 'translation' && controller.parts" class="ctInlineDiff ctTranslationDiff" aria-label="Translation differences"><span v-for="(part,index) in controller.parts" :key="index" :class="{diffInlineAdd:part.added,diffInlineDel:part.removed}">{{ controller.display(part.value) }}</span></pre>
      <section v-if="controller.menuOpen" class="fieldHistoryMenu" aria-label="Revision history and comparison options">
        <div class="fieldHistoryOptions"><label><input type="checkbox" :checked="controller.whitespace" @change="controller.options('whitespace',$event.target.checked)"> Show whitespace</label><label><input type="checkbox" :checked="controller.characters" @change="controller.options('characters',$event.target.checked)"> Character differences</label><button type="button" @click="closeMenu()" aria-label="Close revision menu">Close</button></div>
        <app-notice v-if="controller.error" class="ctHistoryError" tone="error">{{ controller.error }}</app-notice>
        <button v-if="controller.moreVersions" type="button" @click="controller.olderVersions()" :disabled="controller.busy">{{ controller.busy ? 'Preparing earlier original…' : 'Load earlier version' }}</button>
        <button v-if="controller.moreHistory" type="button" @click="controller.olderHistory()" :disabled="controller.busy">Load older history</button>
        <p>Restoring creates a saved revision of the whole record.</p>
        <div class="fieldHistoryEntries"><article v-for="entry in controller.entries" :key="entry.key" class="ctHistoryEvent"><p>{{ controller.label(entry) }}</p><small>{{ entry.action }}</small><div class="ctHistoryActions"><template v-for="part in ['before','after']" :key="part"><span v-if="!entry[part].available" class="fieldDiffUnavailable">{{ part }} revision unavailable</span><button type="button" @click="controller.details(entry,part)" :disabled="!entry[part].available">Details {{ part }}</button><button type="button" @click="controller.restore(entry,part)" :disabled="controller.disabled || !entry[part].available">Restore {{ part }}</button></template></div></article><p v-if="!controller.entries.length">No saved history for this record.</p></div>
        <div class="fieldHistoryDetails"><article v-for="row in controller.detailRows" :key="row.id"><strong>{{ row.name }}{{ row.removed ? ' · Removed field' : '' }}</strong><label>English changes</label><pre class="ctInlineDiff"><span v-for="(part,index) in row.source" :key="index" :class="{diffInlineAdd:part.added,diffInlineDel:part.removed}">{{ controller.display(part.value) }}</span></pre><label>Translation changes</label><pre class="ctInlineDiff"><span v-for="(part,index) in row.target" :key="index" :class="{diffInlineAdd:part.added,diffInlineDel:part.removed}">{{ controller.display(part.value) }}</span></pre></article><template v-if="controller.detailNotes"><strong>Developer notes</strong><pre class="ctInlineDiff"><span v-for="(part,index) in controller.detailNotes" :key="index" :class="{diffInlineAdd:part.added,diffInlineDel:part.removed}">{{ controller.display(part.value) }}</span></pre></template></div>
      </section>
    </div>`
  };
  global.EditorComponents = { Notice, NoticeStack, FieldToolbar, NativeField, TextField, WorkspaceShell, FullEditorShell, Preview: SharedPreview, Assistance, DictionaryEntries, TranslationMemory, Lookup, Comments, History, Tools, Autocomplete, DiagnosticMeta, DiagnosticScan, AttentionNavigation };
})(typeof window !== 'undefined' ? window : globalThis);
