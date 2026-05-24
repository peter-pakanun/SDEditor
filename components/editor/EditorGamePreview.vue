<template>
  <div class="gamePreviewStrip">
    <div class="gamePreviewToolbar twoSided">
      <div class="gamePreviewFrameBtns">
        <button type="button" class="gamePreviewFrameBtn" :class="{ active: gamePreviewFrame === 's' }" title="Small frame" @click="$emit('set-frame', 's')">▢</button>
        <button type="button" class="gamePreviewFrameBtn" :class="{ active: gamePreviewFrame === 'm' }" title="Medium frame" @click="$emit('set-frame', 'm')">▣</button>
        <button type="button" class="gamePreviewFrameBtn" :class="{ active: gamePreviewFrame === 'l' }" title="Large frame" @click="$emit('set-frame', 'l')">▦</button>
      </div>
    </div>
    <div class="gamePreviewMainRow">
      <div class="gamePreviewFrameWrap">
        <div class="gamePreviewWindow" :class="'gamePreviewWindow--' + gamePreviewFrame" :style="{ fontFamily: gamePreviewFontFamily }">
          <template v-for="(seg, si) in gamePreviewSegments" :key="'gp-' + si + '-' + seg.type + (seg.type === 'var' ? seg.key : '')">
            <span v-if="seg.type === 'text'" class="gamePreviewText">{{ seg.text }}</span>
            <span v-else-if="seg.type === 'kw'" class="gamePreviewKw" :title="seg.full">{{ seg.text }}</span>
            <span v-else-if="seg.type === 'var'" class="gamePreviewVarDisplay">
              <span class="gamePreviewVarValue" :title="seg.full">{{ seg.prefix + previewGggVars[seg.key] }}</span><span v-if="seg.trailingPercent" class="gamePreviewVarPct">%</span>
            </span>
            <span v-else-if="seg.type === 'rightAlign'" class="gamePreviewRightAlign"></span>
            <span v-else-if="seg.type === 'break'" class="gamePreviewBreak"></span>
          </template>
          <span v-if="gamePreviewSegments.length === 0" class="gamePreviewEmpty">(empty)</span>
        </div>
      </div>
      <div v-if="gamePreviewVarKeyList.length > 0" class="gamePreviewVarsColumn">
        <div v-for="k in gamePreviewVarKeyList" :key="'gp-var-field-' + k" class="gamePreviewVarField">
          <label class="gamePreviewVarLabel">{{ '{' + k + '}' }}</label>
          <input
            type="text"
            class="gamePreviewVarInput"
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
