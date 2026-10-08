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

  // Slots retain the owning editor's refs and event scope. Each surface owns its
  // placement, while the shared assistance and preview content is mounted once.
  const portal = name => ({
    name,
    props: { target: { type: String, required: true } },
    template: '<teleport :to="target"><slot></slot></teleport>',
  });
  const Preview = portal('EditorPreview');
  const Assistance = portal('EditorAssistance');
  global.EditorComponents = { TextField, Preview, Assistance };
})(typeof window !== 'undefined' ? window : globalThis);
