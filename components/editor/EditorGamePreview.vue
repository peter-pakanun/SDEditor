<template>
  <div class="gamePreviewStrip sticky top-0 z-40 box-border h-[calc(160px*var(--density))] border-b border-app-element bg-app-bg2 p-[calc(0.5em*var(--density))]">
    <div class="gamePreviewToolbar twoSided absolute left-[5px] top-[5px] z-40 mb-[calc(0.45em*var(--density))] flex items-center justify-between">
      <div class="gamePreviewFrameBtns flex gap-[calc(0.25em*var(--density))]">
        <button
          type="button"
          class="gamePreviewFrameBtn cursor-pointer border border-app-element-alt bg-app-element px-[calc(0.45em*var(--density))] py-[calc(0.2em*var(--density))] text-[calc(14px*var(--density))] leading-[1.2] text-app-font hover:bg-app-element-alt"
          :class="gamePreviewFrame === 's' ? 'border-app-accent bg-app-element-alt' : ''"
          title="Small frame"
          @click="$emit('set-frame', 's')"
        >▢</button>
        <button
          type="button"
          class="gamePreviewFrameBtn cursor-pointer border border-app-element-alt bg-app-element px-[calc(0.45em*var(--density))] py-[calc(0.2em*var(--density))] text-[calc(14px*var(--density))] leading-[1.2] text-app-font hover:bg-app-element-alt"
          :class="gamePreviewFrame === 'm' ? 'border-app-accent bg-app-element-alt' : ''"
          title="Medium frame"
          @click="$emit('set-frame', 'm')"
        >▣</button>
        <button
          type="button"
          class="gamePreviewFrameBtn cursor-pointer border border-app-element-alt bg-app-element px-[calc(0.45em*var(--density))] py-[calc(0.2em*var(--density))] text-[calc(14px*var(--density))] leading-[1.2] text-app-font hover:bg-app-element-alt"
          :class="gamePreviewFrame === 'l' ? 'border-app-accent bg-app-element-alt' : ''"
          title="Large frame"
          @click="$emit('set-frame', 'l')"
        >▦</button>
      </div>
    </div>
    <div class="gamePreviewMainRow flex h-full items-center gap-[calc(0.75em*var(--density))]">
      <div class="gamePreviewFrameWrap flex min-w-0 flex-1 justify-center">
        <div
          class="gamePreviewWindow box-border flex w-full max-w-full flex-wrap rounded-[2px] border border-app-element-alt bg-app-bg px-[calc(0.75em*var(--density))] py-[calc(0.55em*var(--density))] align-top text-[calc(14px*var(--density))] leading-[1.45] text-app-font shadow-[inset_0_0_0_1px_var(--color-shadow)] break-words"
          :class="{
            '!max-w-[320px]': gamePreviewFrame === 's',
            '!max-w-[480px]': gamePreviewFrame === 'm',
            '!max-w-[720px]': gamePreviewFrame === 'l',
          }"
          :style="{ fontFamily: gamePreviewFontFamily }"
        >
          <template v-for="(seg, si) in gamePreviewSegments" :key="'gp-' + si + '-' + seg.type + (seg.type === 'var' ? seg.key : '')">
            <span v-if="seg.type === 'text'" class="gamePreviewText whitespace-pre-wrap">{{ seg.text }}</span>
            <span v-else-if="seg.type === 'kw'" class="gamePreviewKw underline decoration-dashed decoration-[1.5px] underline-offset-2" :title="seg.full">{{ seg.text }}</span>
            <span v-else-if="seg.type === 'var'" class="gamePreviewVarDisplay inline whitespace-normal">
              <span class="gamePreviewVarValue text-app-font" :title="seg.full">{{ seg.prefix + previewGggVars[seg.key] }}</span><span v-if="seg.trailingPercent" class="gamePreviewVarPct font-semibold">%</span>
            </span>
            <span v-else-if="seg.type === 'rightAlign'" class="gamePreviewRightAlign grow"></span>
            <span v-else-if="seg.type === 'break'" class="gamePreviewBreak h-0 basis-full"></span>
          </template>
          <span v-if="gamePreviewSegments.length === 0" class="gamePreviewEmpty text-[#6a6560] italic">(empty)</span>
        </div>
      </div>
      <div v-if="gamePreviewVarKeyList.length > 0" class="gamePreviewVarsColumn flex h-full max-w-[14em] min-w-[6.5em] flex-none flex-col gap-[calc(0.35em*var(--density))] overflow-y-auto p-[calc(0.15em*var(--density))]">
        <div v-for="k in gamePreviewVarKeyList" :key="'gp-var-field-' + k" class="gamePreviewVarField flex flex-col gap-[calc(0.12em*var(--density))]">
          <label class="gamePreviewVarLabel font-mono text-[calc(10px*var(--density))] font-semibold text-app-font">{{ '{' + k + '}' }}</label>
          <input
            type="text"
            class="gamePreviewVarInput m-0 box-border w-full border border-app-element-alt bg-app-element px-[calc(0.4em*var(--density))] py-[calc(0.22em*var(--density))] text-[calc(12px*var(--density))] leading-[1.35] text-app-font focus:outline focus:outline-1 focus:outline-app-accent"
            :value="previewGggVars[k]"
            :lang="translationEditorBcp47"
            :aria-label="'Variable {' + k + '}'"
            @input="updateVar(k, $event)"
          >
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  gamePreviewFrame: string;
  gamePreviewFontFamily: string;
  gamePreviewSegments: any[];
  gamePreviewVarKeyList: string[];
  previewGggVars: Record<string, string>;
  translationEditorBcp47?: string;
}>();

const emit = defineEmits<{
  "set-frame": [frame: string];
  "update-var": [payload: { key: string; value: string }];
}>();

function updateVar(key: string, event: Event) {
  emit("update-var", {
    key,
    value: event.target instanceof HTMLInputElement ? event.target.value : "",
  });
}
</script>
