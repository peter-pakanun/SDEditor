<template>
  <div v-if="!testMode && !gameVersionSelected" class="multiInstanceGate versionGate fixed inset-0 z-[10001] flex h-full w-full items-center justify-center bg-[rgba(0,0,0,0.5)] backdrop-blur-[2px]">
    <div class="multiInstanceGateContent versionGateContent max-h-[80vh] w-[90%] max-w-[680px] overflow-y-auto rounded-lg border-2 border-app-accent bg-app-bg2 p-[calc(2em*var(--density))] text-app-font shadow-[0_0_40px_var(--color-shadow),0_0_20px_rgba(0,0,0,0.3)] [&_h2]:mb-[calc(1em*var(--density))] [&_h2]:mt-0 [&_h2]:text-[calc(20px*var(--density))] [&_h2]:font-bold [&_h2]:text-app-accent [&_p]:my-[calc(0.75em*var(--density))] [&_p]:leading-[1.6] [&_p]:text-app-font">
      <h2>Select Game Version</h2>
      <p>Choose the Path of Exile version you are translating. Source files, workspace data, and history are stored separately for each version.</p>
      <div class="versionGateButtons mt-[calc(1.5em*var(--density))] grid grid-cols-2 gap-[calc(1em*var(--density))] max-[640px]:grid-cols-1">
        <button class="versionChoiceBtn flex min-h-[calc(150px*var(--density))] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-app-accent bg-app-element-alt text-app-font transition-[transform,background-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:bg-app-highlight hover:shadow-[0_8px_18px_rgba(0,0,0,0.25)] max-[640px]:min-h-[calc(118px*var(--density))]" @click="$emit('select', 'poe1')">
          <span class="versionChoiceMain text-[calc(52px*var(--density))] font-extrabold leading-none text-app-accent max-[640px]:text-[calc(40px*var(--density))]">PoE1</span>
          <span class="versionChoiceSub mt-[calc(0.6em*var(--density))] text-[calc(13px*var(--density))] opacity-[0.85]">Path of Exile 1</span>
        </button>
        <button class="versionChoiceBtn flex min-h-[calc(150px*var(--density))] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-app-accent bg-app-element-alt text-app-font transition-[transform,background-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:bg-app-highlight hover:shadow-[0_8px_18px_rgba(0,0,0,0.25)] max-[640px]:min-h-[calc(118px*var(--density))]" @click="$emit('select', 'poe2')">
          <span class="versionChoiceMain text-[calc(52px*var(--density))] font-extrabold leading-none text-app-accent max-[640px]:text-[calc(40px*var(--density))]">PoE2</span>
          <span class="versionChoiceSub mt-[calc(0.6em*var(--density))] text-[calc(13px*var(--density))] opacity-[0.85]">Path of Exile 2</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  testMode: boolean;
  gameVersionSelected: boolean;
}>();

defineEmits<{
  select: [version: string];
}>();
</script>
