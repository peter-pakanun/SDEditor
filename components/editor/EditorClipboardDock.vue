<template>
  <div class="fixed clipboard bottom-0 right-0 top-auto z-[1] box-border h-[calc(120px*var(--density))] w-[var(--side-width)] overflow-hidden p-[calc(0.6em*var(--density))] [&>textarea]:h-full [&>textarea]:w-full [&>textarea]:resize-none">
    <textarea placeholder="📋 Clipboard" v-model.lazy="model" :lang="translationEditorBcp47"></textarea>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  modelValue: string;
  translationEditorBcp47?: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

const model = computed({
  get: () => props.modelValue,
  set: (value) => emit("update:modelValue", value),
});
</script>
