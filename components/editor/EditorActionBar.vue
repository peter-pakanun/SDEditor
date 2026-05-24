<template>
  <div class="twoSided">
    <h1 style="flex-grow: 1;">🧾 Translation</h1>
    <span v-if="warningCount > 0" class="editorDiagPill warning" :title="warningTitle">Warning: {{ warningCount }}</span>
    <span v-if="errorCount > 0" class="editorDiagPill error" :title="errorTitle">Error: {{ errorCount }}</span>
    <button :disabled="translationReadOnly" title="Save (Ctrl+S)" @click="$emit('save')">💾</button>
    <button title="Exit (ESC)" @click="$emit('exit')">❌</button>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  warningCount: number;
  warningTitle: string;
  errorCount: number;
  errorTitle: string;
  translationReadOnly: boolean;
}>();

defineEmits<{
  save: [];
  exit: [];
}>();
</script>
