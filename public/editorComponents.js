/* Shared native Vue fields for the full editor and the focused workspace row. */
(function (global) {
  'use strict';

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
          scroll: event => control.scroll?.(event),
          ...(!this.source ? {
            input,
            keydown: event => control.keydown?.(event),
            compositionstart: event => { event.target.composing = true; },
            compositionend,
            change: event => { if (event.target.composing) compositionend(event); },
            keyup: event => { control.selection?.(event); if (event.altKey) control.altKeyup?.(event); },
            select: event => control.selection?.(event),
            click: event => control.selection?.(event),
            blur: event => control.blur?.(event),
            paste: event => control.paste?.(event),
            mousemove: event => control.tooltip?.(event),
            mouseleave: () => control.hideTooltip?.(),
          } : {}),
        };
      },
    },
    template: `
      <div class="textHL editorTextField" :class="{ multiline: field.isMultiline }">
        <template v-if="source">
          <input v-if="!field.isMultiline" type="text" v-bind="field.dataAttrs" :value="nativeValue" :placeholder="field.placeholder || 'English'" :lang="field.lang || 'en'" :spellcheck="field.spellcheck" readonly tabindex="-1" v-on="events">
          <textarea v-else v-bind="field.dataAttrs" :value="nativeValue" :placeholder="field.placeholder || 'English'" :lang="field.lang || 'en'" :spellcheck="field.spellcheck" readonly tabindex="-1" :rows="compact ? 1 : 3" v-on="events"></textarea>
        </template>
        <template v-else>
          <input v-if="!field.isMultiline" type="text" v-bind="field.dataAttrs" :value="nativeValue" :placeholder="field.placeholder || 'Translation'" :lang="field.lang" :spellcheck="field.spellcheck" :readonly="field.readonly" v-on="events">
          <textarea v-else v-bind="field.dataAttrs" :class="{ multilineField: !compact }" :value="nativeValue" :placeholder="field.placeholder || 'Translation'" :lang="field.lang" :spellcheck="field.spellcheck" :readonly="field.readonly" :rows="compact ? 1 : 4" v-on="events"></textarea>
        </template>
        <div v-if="controller.ready" class="HLter" :class="{ noPointer: !source }" v-bind="controller.highlightAttrs" v-html="controller.highlight" @mousemove="source && controller.tooltip?.($event)" @mouseout="source && controller.hideTooltip?.()" @mouseleave="controller.hideTooltip?.()" @click="source && controller.sourceClick?.($event)"></div>
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
            set translation(value) { component.field.translation = value; },
            get isMultiline() { return component.field.isMultiline; },
            get readonly() { return host.editorTranslationReadOnly; },
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
    props: { controller: { type: Object, required: true }, previewHostId: { type: String, required: true },
      sidebarHostId: { type: String, required: true } },
    template: `<div class="editor" :class="{ clipboardHidden: controller.hideEditorClipboard }" aria-label="Translation editor">
      <div class="edit"><div :id="previewHostId"></div><slot></slot></div>
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
          <p v-if="tmLocalIssue || tmIssue" class="tmIssue" role="alert">{{ tmLocalIssue || tmIssue }}</p>
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
            <p v-if="lookupPreparationError" class="cloudWarning" role="alert">{{ lookupPreparationError }}</p>
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
            <p v-if="commentsFileError" class="commentsError" role="alert">{{ commentsFileError }}</p>
            <p v-if="commentsUnreadError" class="commentsError" role="alert">{{ commentsUnreadError }}</p>
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
              <p v-if="commentsPostError" class="commentsError" role="alert">{{ commentsPostError }}</p>
              <div class="commentsComposerActions">
                <label class="commentsScopeOption"><input type="checkbox" v-model="commentsFileAllLanguages" :disabled="!commentsCanPost || commentsPosting">Post to all languages</label>
                <button type="submit" class="btnPrimary" :disabled="!commentsCanPost || commentsPosting || !commentsFileDraft.trim()">{{ commentsPosting ? 'Posting…' : 'Post comment' }}</button>
              </div>
            </form>
          </template>
        </section>`);
  const History = sharedSurface('EditorHistory', String.raw`<section v-if="sideTab === 'history' && editorReady && historyClientText" class="ctHistoryPanel historyPanel"><h3>History</h3>
                <p>Local and shared saved changes for this group and language.</p>
                <button @click="ctOpenHistoryViewer()">Compare original and current</button>
                <button v-if="ctHistoryPreviousProvenance" class="ctHistoryPrevious" @click="ctLoadPreviousHistory()" :disabled="ctBusy || ctHistoryPreviousLoading">{{ ctHistoryPreviousLoading ? 'Preparing previous version…' : 'Compare previous version' }}</button>
                <p v-if="ctHistoryError" class="ctHistoryError" role="alert">{{ ctHistoryError }}</p>
                <article v-for="entry in ctHistory" :key="entry.key" class="ctHistoryEvent" :data-history-origin="entry.origin">
                    <p>{{ ctHistoryLabel(entry) }}</p><small>{{ entry.action }}</small>
                    <div class="ctHistoryActions"><button @click="ctPickHistory(entry)">Compare change</button><button @click="ctPickHistory(entry,'current')">Compare with current</button>
                    <button @click="ctRestoreHistory(entry,'before')" :disabled="ctBusy || !entry.before.available">Restore before</button><button @click="ctRestoreHistory(entry,'after')" :disabled="ctBusy || !entry.after.available">Restore after</button></div>
                </article>
                <p v-if="ctHistoryLoading" role="status">Loading history…</p><p v-else-if="!ctHistory.length">No saved history for this ID.</p>
                <button v-if="ctHistoryCursor || ctHistoryLocalMore" class="ctHistoryOlder" @click="ctLoadOlderHistory()" :disabled="ctHistoryLoading">Load older history</button>
                <Teleport to="body"><div v-if="ctHistoryViewer" class="ctHistoryBackdrop" @keydown.esc.stop.prevent="ctCloseHistoryViewer()" @keydown.tab="ctTrapHistoryFocus($event)">
                    <section class="ctHistoryViewer" role="dialog" aria-modal="true" aria-labelledby="ctHistoryTitle">
                        <header><h3 id="ctHistoryTitle">Compare · {{ ctCurrentUnit.sheet }} · {{ ctCurrentUnit.recordId }}</h3><button id="ctHistoryClose" @click="ctCloseHistoryViewer()" aria-label="Close history comparison">Close</button></header>
                        <div class="ctHistoryCompareControls"><label>Before<select v-model="ctHistoryCompareA"><option v-for="choice in ctHistoryChoices" :key="choice.key" :value="choice.key" :disabled="choice.unavailable">{{ choice.label }}</option></select></label>
                        <label>After<select v-model="ctHistoryCompareB"><option v-for="choice in ctHistoryChoices" :key="choice.key" :value="choice.key" :disabled="choice.unavailable">{{ choice.label }}</option></select></label><label><input type="checkbox" v-model="ctHistoryWhitespace"> Show whitespace</label><label><input type="checkbox" v-model="ctHistoryCharacters"> Character differences</label></div>
                        <p class="ctHistoryContext">English, field layout and Developer notes come from verified originals. This group's history uses its immutable original; Compare previous version explicitly loads the earlier original and accepted revision. Unavailable saved revisions are labelled. This comparison is read only; restoring requires confirmation and saves the selected translation.</p>
                        <p v-if="ctHistoryError" class="ctHistoryError" role="alert">{{ ctHistoryError }}</p>
                        <div v-if="ctHistoryComparison" class="ctHistoryComparison">
                            <article v-for="row in ctHistoryComparison.rows" :key="row.id" class="ctHistoryDiffField" :data-field-id="row.id" :data-field-kind="row.kind" :data-form="row.form">
                                <h4>{{ ctHistoryFieldLabel(row) }}</h4><p v-if="row.added || row.removed">{{ row.added ? 'Added field' : 'Removed field' }}</p>
                                <div class="ctHistoryColumns"><section v-for="side in ['before','after']" :key="side" :class="'ctHistory-'+side"><h5>{{ side === 'before' ? 'Before' : 'After' }}</h5>
                                    <label>English source</label><pre class="ctHistorySource"><span v-for="(part,index) in row.sourceParts.filter(part=>side === 'before' ? !part.added : !part.removed)" :key="index" :class="{diffInlineAdd:part.added,diffInlineDel:part.removed}">{{ ctHistoryDisplay(part.value) }}</span></pre>
                                    <label>{{ row.kind === 'gender' ? 'Gender metadata' : 'Translation · '+ctWorkspace.scope.language }}</label><pre class="ctHistoryTarget"><span v-for="(part,index) in row.targetParts.filter(part=>side === 'before' ? !part.added : !part.removed)" :key="index" :class="{diffInlineAdd:part.added,diffInlineDel:part.removed}">{{ ctHistoryDisplay(part.value) }}</span></pre>
                                </section></div>
                            </article>
                            <article v-if="ctHistoryComparison.hasNotes" class="ctHistoryNotes"><h4>Developer notes</h4><div class="ctHistoryColumns"><section v-for="side in ['before','after']" :key="side"><h5>{{ side === 'before' ? 'Before' : 'After' }}</h5><pre><span v-for="(part,index) in ctHistoryComparison.notes.filter(part=>side === 'before' ? !part.added : !part.removed)" :key="index" :class="{diffInlineAdd:part.added,diffInlineDel:part.removed}">{{ ctHistoryDisplay(part.value) }}</span></pre></section></div></article>
                        </div>
                    </section>
                </div></Teleport>
            </section>
        <div v-if="sideTab === 'history' && editorReady && !historyClientText" class="historyPanel">
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
              <div class="historyList">
                <div v-for="rev in historyItems" :key="rev.id" class="historyItem" :class="{ selectedA: historySelectedA && historySelectedA.id === rev.id, selectedB: historySelectedB && historySelectedB.id === rev.id }">
                  <button class="historyPick" :class="{ current: String(rev.note || '').includes('(current)') }" @click="pickHistoryRevision(rev)" :disabled="!!entryAlignment">{{ formatHistoryTime(rev.savedAt) }} {{ rev.note ? (' ' + rev.note) : '' }}</button>
                  <button v-if="historyMode !== 'source' && !rev.legacyReference" class="historyRestore" title="Restore this saved translation" :aria-label="'Restore translation saved ' + formatHistoryTime(rev.savedAt)" @click="restoreHistoryRevision(rev)" :disabled="!!entryAlignment">↩</button>
                  <button v-if="historyMode !== 'source' && String(rev.note || '').startsWith('Before entry alignment')" type="button" @click="alignHistoryRevision(rev)" :disabled="editorSaving || !!entryAlignment">Align these blocks</button>
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
            <button v-if="editorVisible" class="tabBtn" :class="{ active: sideTab === 'history' }" @click="sideTab = 'history'">🕒 History</button>
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
  const SharedPreview = sharedSurface('EditorPreview', String.raw`<div class="gamePreviewStrip">
          <div v-if="gamePreviewFullEditor" class="gamePreviewToolbar twoSided">
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
                <div v-if="!hideSourceInPreviewPanel" class="gamePreviewLine">
                  <div class="gamePreviewLineLabel">EN</div>
                  <div class="gamePreviewWindow" :class="'gamePreviewWindow--' + gamePreviewFrame" :style="{ fontFamily: gamePreviewSourceFontFamily }">
                    <template v-for="(seg, si) in gamePreviewDisplaySource" :key="'gps-' + si + '-' + seg.type + (seg.type === 'var' ? seg.key : '')">
                      <span v-if="seg.type === 'text'" class="gamePreviewText" :class="seg.decorTag ? 'gamePreviewDecor--' + seg.decorTag : ''">{{ seg.text }}</span>
                      <span v-else-if="seg.type === 'kw'" class="gamePreviewKw" :class="seg.decorTag ? 'gamePreviewDecor--' + seg.decorTag : ''" v-tooltip="seg.full">{{ gamePreviewKeywordText(seg) }}</span>
                      <span v-else-if="seg.type === 'var'" class="gamePreviewVarDisplay" :class="seg.decorTag ? 'gamePreviewDecor--' + seg.decorTag : ''">
                        <span class="gamePreviewVarValue" v-tooltip="seg.full">{{ seg.prefix + gamePreviewVarValues[seg.key] }}</span><span v-if="seg.trailingPercent" class="gamePreviewVarPct">%</span>
                      </span>
                      <span v-else-if="seg.type === 'rightAlign'" class="gamePreviewRightAlign"></span>
                      <span v-else-if="seg.type === 'break'" class="gamePreviewBreak"></span>
                    </template>
                    <span v-if="gamePreviewDisplaySource.length === 0" class="gamePreviewEmpty">(empty)</span>
                  </div>
                </div>
                <div class="gamePreviewLine">
                  <div class="gamePreviewLineLabel">{{ translationEditorBcp47 || lang || 'TL' }}</div>
                  <div class="gamePreviewWindow" :class="'gamePreviewWindow--' + gamePreviewFrame" :style="{ fontFamily: gamePreviewFontFamily }">
                    <template v-for="(seg, si) in gamePreviewDisplayTarget" :key="'gp-' + si + '-' + seg.type + (seg.type === 'var' ? seg.key : '')">
                      <span v-if="seg.type === 'text'" class="gamePreviewText" :class="seg.decorTag ? 'gamePreviewDecor--' + seg.decorTag : ''">{{ seg.text }}</span>
                      <span v-else-if="seg.type === 'kw'" class="gamePreviewKw" :class="seg.decorTag ? 'gamePreviewDecor--' + seg.decorTag : ''" v-tooltip="seg.full">{{ gamePreviewKeywordText(seg) }}</span>
                      <span v-else-if="seg.type === 'var'" class="gamePreviewVarDisplay" :class="seg.decorTag ? 'gamePreviewDecor--' + seg.decorTag : ''">
                        <span class="gamePreviewVarValue" v-tooltip="seg.full">{{ seg.prefix + gamePreviewVarValues[seg.key] }}</span><span v-if="seg.trailingPercent" class="gamePreviewVarPct">%</span>
                      </span>
                      <span v-else-if="seg.type === 'rightAlign'" class="gamePreviewRightAlign"></span>
                      <span v-else-if="seg.type === 'break'" class="gamePreviewBreak"></span>
                    </template>
                    <span v-if="gamePreviewDisplayTarget.length === 0" class="gamePreviewEmpty">(empty)</span>
                  </div>
                </div>
              </div>
            </div>
            <div class="gamePreviewVarsColumn" :class="{ isEmpty: gamePreviewVarKeyList.length === 0 }">
              <div class="gamePreviewVarsPanel" :class="{ isEmpty: gamePreviewVarKeyList.length === 0 }">
                <div v-if="gamePreviewVarKeyList.length === 0" class="gamePreviewVarField gamePreviewVarsPlaceholder">
                  <div class="gamePreviewVarLabel">{}</div>
                  <div class="gamePreviewVarInput gamePreviewVarInputPlaceholder">No variables</div>
                </div>
                <template v-else>
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
  global.EditorComponents = { NativeField, TextField, WorkspaceShell, FullEditorShell, Preview: SharedPreview, Assistance, DictionaryEntries, TranslationMemory, Lookup, Comments, History, Tools, Autocomplete };
})(typeof window !== 'undefined' ? window : globalThis);
