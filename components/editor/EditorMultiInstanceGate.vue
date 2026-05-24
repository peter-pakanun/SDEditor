<template>
  <div v-if="visible" class="multiInstanceGate">
    <div class="multiInstanceGateContent">
      <h2>⚠️ Multiple Instances Detected</h2>
      <p>
        You have <strong>more than one instance of SDEditor open</strong> in your browser. This can cause data loss or conflicts if you save translations simultaneously across multiple tabs or windows.
      </p>
      <div class="multiInstanceGateWarning">
        <strong>Warning:</strong> Each instance maintains its own in-memory state and may have outdated translations from IndexedDB. Concurrent edits can cause data loss.
      </div>
      <h3 style="margin-top: calc(1.5em * var(--density)); margin-bottom: calc(0.75em * var(--density));">What should I do?</h3>
      <ul style="margin: calc(0.75em * var(--density)) 0; padding-left: calc(1.5em * var(--density)); color: var(--color-font); line-height: 1.6;">
        <li>Use only <strong>one instance at a time</strong> and close other tabs/windows before editing</li>
        <li><strong>Save frequently</strong> and reload before switching instances</li>
        <li>Consider exporting translations between instances to avoid conflicts</li>
      </ul>
      <div class="multiInstanceGateButtons">
        <button class="btnSecondary" @click="$emit('bypass')">Continue Anyway</button>
        <button class="btnPrimary" @click="$emit('close-this')">Close This Instance</button>
      </div>
      <p style="font-size: calc(11px * var(--density)); opacity: 0.7; margin-top: calc(1.5em * var(--density)); margin-bottom: 0;">
        You can close this message, but please be careful about data loss.
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  visible: boolean;
}>();

defineEmits<{
  bypass: [];
  "close-this": [];
}>();
</script>
