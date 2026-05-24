<template>
  <div v-if="visible" class="multiInstanceGate fixed inset-0 z-[10000] flex h-full w-full items-center justify-center bg-[rgba(0,0,0,0.5)] backdrop-blur-[2px]">
    <div class="multiInstanceGateContent max-h-[80vh] w-[90%] max-w-[500px] overflow-y-auto rounded-lg border-2 border-app-accent bg-app-bg2 p-[calc(2em*var(--density))] text-app-font shadow-[0_0_40px_var(--color-shadow),0_0_20px_rgba(0,0,0,0.3)] [&_h2]:mb-[calc(1em*var(--density))] [&_h2]:mt-0 [&_h2]:text-[calc(20px*var(--density))] [&_h2]:font-bold [&_h2]:text-app-accent [&_p]:my-[calc(0.75em*var(--density))] [&_p]:leading-[1.6] [&_p]:text-app-font">
      <h2>⚠️ Multiple Instances Detected</h2>
      <p>
        You have <strong>more than one instance of SDEditor open</strong> in your browser. This can cause data loss or conflicts if you save translations simultaneously across multiple tabs or windows.
      </p>
      <div class="multiInstanceGateWarning my-[calc(1em*var(--density))] rounded border-l-4 border-app-accent bg-[color-mix(in_srgb,var(--color-line-diff)_15%,transparent)] p-[calc(1em*var(--density))] text-app-font [&_strong]:font-bold [&_strong]:text-app-accent">
        <strong>Warning:</strong> Each instance maintains its own in-memory state and may have outdated translations from IndexedDB. Concurrent edits can cause data loss.
      </div>
      <h3 class="mb-[calc(0.75em*var(--density))] mt-[calc(1.5em*var(--density))]">What should I do?</h3>
      <ul class="my-[calc(0.75em*var(--density))] pl-[calc(1.5em*var(--density))] leading-[1.6] text-app-font">
        <li>Use only <strong>one instance at a time</strong> and close other tabs/windows before editing</li>
        <li><strong>Save frequently</strong> and reload before switching instances</li>
        <li>Consider exporting translations between instances to avoid conflicts</li>
      </ul>
      <div class="multiInstanceGateButtons mt-[calc(2em*var(--density))] flex flex-wrap justify-end gap-[calc(1em*var(--density))] [&_button]:cursor-pointer [&_button]:rounded [&_button]:border [&_button]:border-black [&_button]:px-[calc(1.5em*var(--density))] [&_button]:py-[calc(0.7em*var(--density))] [&_button]:text-[calc(14px*var(--density))] [&_button]:font-semibold [&_button]:transition-all [&_button]:duration-200 [&_button:disabled]:cursor-wait [&_button:disabled]:opacity-[0.65] [&_button:disabled]:shadow-none [&_button:disabled]:transform-none [&_button:disabled:hover]:opacity-[0.65] [&_button:disabled:hover]:shadow-none [&_button:disabled:hover]:transform-none">
        <button class="btnSecondary bg-app-element-alt text-app-font hover:bg-app-highlight" @click="$emit('bypass')">Continue Anyway</button>
        <button class="btnPrimary bg-app-accent text-app-bg hover:-translate-y-0.5 hover:opacity-90 hover:shadow-[0_4px_12px_rgba(0,0,0,0.3)] disabled:hover:translate-y-0" @click="$emit('close-this')">Close This Instance</button>
      </div>
      <p class="mb-0 mt-[calc(1.5em*var(--density))] text-[calc(11px*var(--density))] opacity-70">
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
