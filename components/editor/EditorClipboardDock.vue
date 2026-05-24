<template>
  <div class="fixed clipboard">
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
