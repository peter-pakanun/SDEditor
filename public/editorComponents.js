/* Shared native Vue fields for the full editor and the focused workspace row. */
(function (global) {
  'use strict';

  const TextField = {
    name: 'EditorTextField',
    props: {
      controller: { type: Object, required: true },
      block: { type: Object, required: true },
      blockIndex: { type: Number, required: true },
      columnIndex: { type: Number, default: null },
      kind: { type: String, required: true },
    },
    computed: {
      field() { return this.columnIndex == null ? this.block : this.block.tableColumns[this.columnIndex]; },
      source() { return this.kind === 'english'; },
      refName() { return this.controller.editorRefName(this.kind, this.blockIndex, this.columnIndex); },
      highlightRefName() { return this.controller.editorRefName(this.kind + 'HLter', this.blockIndex, this.columnIndex); },
      highlight() { return this.source ? this.field.englishHLter : this.field.translationHLter; },
      column() { return this.columnIndex == null ? 0 : this.columnIndex; },
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
    template: `
      <div class="textHL editorTextField" :class="{ multiline: field.isMultiline }">
        <template v-if="source">
          <input v-if="!field.isMultiline" type="text" placeholder="English" readonly lang="en" :value="field.english" :data-editor-ref="refName" tabindex="-1" @scroll="controller.syncHlScroll(kind, blockIndex, columnIndex)">
          <textarea v-else placeholder="English" readonly lang="en" :value="field.english" :data-editor-ref="refName" tabindex="-1" rows="3" @scroll="controller.syncHlScroll(kind, blockIndex, columnIndex)"></textarea>
        </template>
        <template v-else>
          <input v-if="!field.isMultiline" type="text" placeholder="Translation" v-model="field.translation" :lang="controller.translationEditorBcp47" :readonly="controller.editorTranslationReadOnly" :data-editor-ref="refName" @focus="controller.setEditorFocus(blockIndex, column)" @keydown="controller.translationKeydown($event, blockIndex, column)" @compositionend="controller.translationCompositionEnd($event, blockIndex, column)" @keyup.alt="controller.hotkeyPasteHL($event, block, blockIndex, column)" @input="input" @scroll="controller.syncHlScroll(kind, blockIndex, columnIndex)" @mousemove="controller.translationTooltipMouseMove($event, blockIndex, column)" @mouseleave="controller.hideTooltip">
          <textarea v-else class="multilineField" rows="4" placeholder="Translation" v-model="field.translation" :lang="controller.translationEditorBcp47" :readonly="controller.editorTranslationReadOnly" :data-editor-ref="refName" @focus="controller.setEditorFocus(blockIndex, column)" @keydown="controller.translationKeydown($event, blockIndex, column)" @compositionend="controller.translationCompositionEnd($event, blockIndex, column)" @keyup.alt="controller.hotkeyPasteHL($event, block, blockIndex, column)" @input="input" @scroll="controller.syncHlScroll(kind, blockIndex, columnIndex)" @mousemove="controller.translationTooltipMouseMove($event, blockIndex, column)" @mouseleave="controller.hideTooltip"></textarea>
        </template>
        <div v-if="controller.editorReady" class="HLter" :class="{ noPointer: !source }" :data-editor-ref="highlightRefName" v-html="highlight" @mousemove="source && controller.htmlTooltipMouseMove($event)" @mouseout="source && controller.hideTooltip()" @mouseleave="controller.hideTooltip" @click="source && sourceClick($event)"></div>
      </div>
    `,
  };

  const DictionaryEntries = {
    name: 'EditorDictionaryEntries',
    props: { controller: { type: Object, required: true } },
    template: `
      <div class="dictionaryEntries" :inert="!controller.editorReady || undefined">
        <div class="editBlock" v-for="word in controller.visibleDictionary" :key="word._id" :data-dict-id="word._id" :class="{ dictFound: controller.isDictionaryEntryFound(word), dictNew: word._id === controller.dictionaryFlashId }" @focusin="controller.dictionaryEntryFocusIn" @focusout="controller.dictionaryEntryFocusOut">
          <div class="twoSided dictEntryBlock">
            <div>
              <div class="dictRow" :data-dict-id="word._id">
                <textarea v-if="controller.dictionaryMultiline" rows="2" v-model="word.find" @input="controller.dictionaryEntryInput(word)" placeholder="Find" aria-label="Dictionary Find" lang="en" :class="{ dictExactMatchFind: controller.isDictionaryEntryFindMatched(word) }"></textarea>
                <input v-else type="text" v-model="word.find" @input="controller.dictionaryEntryInput(word)" placeholder="Find" lang="en" :class="{ dictExactMatchFind: controller.isDictionaryEntryFindMatched(word) }">
                <textarea v-if="controller.dictionaryMultiline" rows="2" v-model="word.replace" @input="controller.dictionaryEntryInput(word)" placeholder="Replace" aria-label="Dictionary Replace" :lang="controller.translationEditorBcp47" @keydown.ctrl.enter="controller.useDictionaryTranslation(word,null,$event)" @keydown.meta.enter="controller.useDictionaryTranslation(word,null,$event)"></textarea>
                <input v-else type="text" v-model="word.replace" @input="controller.dictionaryEntryInput(word)" placeholder="Replace" :lang="controller.translationEditorBcp47" @keydown.enter="controller.onDictionaryReplaceEnter">
              </div>
              <button v-if="controller.useDictionaryTranslation" type="button" class="dictUseBtn" @click="controller.useDictionaryTranslation(word)" :disabled="!controller.dictionaryCanUse" title="Insert into the focused translation · Ctrl+Enter from Replace">Use translation</button>
              <div class="dictAltHeader">
                <span>Alternates</span>
                <select class="dictScopeSelect" :value="controller.dictionaryEntryScope(word)" @change="controller.setDictionaryEntryScope(word, $event.target.value)" :aria-label="'Game for ' + (word.find || 'this Dictionary entry')" title="Dictionary entry game">
                  <option value="poe1">PoE1</option><option value="poe2">PoE2</option><option value="all">All</option>
                </select>
                <span v-if="controller.dictionaryEntryScopeWarning(word)" class="dictScopeWarning" role="img" :aria-label="controller.dictionaryEntryScopeWarning(word)" :title="controller.dictionaryEntryScopeWarning(word)">⚠</span>
                <button type="button" class="dictHistoryBtn" @click="controller.cloudOpenHistory(word._id)" :disabled="!controller.cloudEntryHistoryAvailable" :aria-label="'View shared history for ' + (word.find || 'this dictionary entry')" :title="controller.cloudEntryHistoryHint"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 11a9 9 0 1 1 2.6 7.4M3 4v7h7M12 7v5l3 2"/></svg></button>
                <button type="button" @click="controller.addDictionaryAltRow(word)" title="Add an alternate translation" :aria-label="'Add an alternate for ' + (word.find || 'this Dictionary entry')">➕</button>
              </div>
              <div class="dictAltRow" v-for="alt in (word.alts || [])" :key="alt._id" :data-dict-id="word._id" :data-dict-alt-id="alt._id">
                <textarea v-if="controller.dictionaryMultiline" rows="2" v-model="alt.find" @input="controller.dictionaryEntryInput(word)" placeholder="Find" :aria-label="'Alternate Dictionary Find '+(alt.find || '')" lang="en" :class="{ dictExactMatchFind: controller.isDictionaryAltFindMatched(word, alt) }"></textarea>
                <input v-else type="text" v-model="alt.find" @input="controller.dictionaryEntryInput(word)" placeholder="Find" lang="en" :class="{ dictExactMatchFind: controller.isDictionaryAltFindMatched(word, alt) }">
                <textarea v-if="controller.dictionaryMultiline" rows="2" v-model="alt.replace" @input="controller.dictionaryEntryInput(word)" placeholder="Replace" :aria-label="'Alternate Dictionary Replace '+(alt.find || '')" :lang="controller.translationEditorBcp47" @keydown.ctrl.enter="controller.useDictionaryTranslation(word,alt,$event)" @keydown.meta.enter="controller.useDictionaryTranslation(word,alt,$event)"></textarea>
                <input v-else type="text" v-model="alt.replace" @input="controller.dictionaryEntryInput(word)" placeholder="Replace" :lang="controller.translationEditorBcp47" @keydown.enter="controller.onDictionaryReplaceEnter">
                <button v-if="controller.useDictionaryTranslation" type="button" class="dictUseBtn" @click="controller.useDictionaryTranslation(word,alt)" :disabled="!controller.dictionaryCanUse" title="Insert alternate into the focused translation · Ctrl+Enter from Replace">Use translation</button>
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
  const Preview = portal('EditorPreview');
  const Assistance = portal('EditorAssistance');
  global.EditorComponents = { TextField, Preview, Assistance, DictionaryEntries };
})(typeof window !== 'undefined' ? window : globalThis);
