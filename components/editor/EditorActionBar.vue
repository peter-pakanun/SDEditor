<template>
  <div class="twoSided flex items-center justify-between gap-[calc(0.5em*var(--density))]">
    <h1 class="grow">🧾 Translation</h1>
    <span
      v-if="warningCount > 0"
      class="inline-flex select-none items-center gap-[calc(0.35em*var(--density))] rounded-full border border-[var(--color-diagnostic-warning-border)] bg-[var(--color-diagnostic-warning)] px-[calc(0.65em*var(--density))] py-[calc(0.2em*var(--density))] text-[calc(12px*var(--density))] font-bold leading-[calc(1.6em*var(--density))]"
      :title="warningTitle"
    >Warning: {{ warningCount }}</span>
    <span
      v-if="errorCount > 0"
      class="inline-flex select-none items-center gap-[calc(0.35em*var(--density))] rounded-full border border-[var(--color-diagnostic-error-border)] bg-[var(--color-diagnostic-error)] px-[calc(0.65em*var(--density))] py-[calc(0.2em*var(--density))] text-[calc(12px*var(--density))] font-bold leading-[calc(1.6em*var(--density))]"
      :title="errorTitle"
    >Error: {{ errorCount }}</span>
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
