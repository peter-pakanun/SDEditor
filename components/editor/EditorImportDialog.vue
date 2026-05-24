<template>
  <div v-if="visible" class="importDialogOverlay fixed inset-0 z-[2000] flex items-center justify-center bg-[rgba(0,0,0,0.35)]" @click.self="$emit('close')">
    <div class="box importDialogBox w-[min(520px,calc(100vw-2.5em))] rounded-[5px] bg-app-bg2 px-[calc(2em*var(--density))] py-[calc(1.5em*var(--density))] shadow-app">
      <h3>Import</h3>
      <div class="importDialogButtons mt-[calc(1em*var(--density))] flex flex-col gap-[calc(1.6em*var(--density))]">
        <div class="importDialogOption flex flex-col gap-[calc(0.6em*var(--density))]">
          <button class="importDialogBtn w-full bg-app-accent px-[calc(1em*var(--density))] py-[calc(0.75em*var(--density))] text-left text-[calc(15px*var(--density))] text-black hover:brightness-105" @click="$emit('import-next-version')">🆕📦 Import Next Version</button>
          <div class="importDialogCaption opacity-90">This is what you normally do when you get a new export.</div>
        </div>
        <div class="importDialogOption flex flex-col gap-[calc(0.6em*var(--density))]">
          <button class="importDialogBtn w-full text-left" @click="$emit('import-translated')">🔁📦 Import Translated</button>
          <div class="importDialogCaption opacity-90">This is rarely used; it is for when you want to move translated data between PCs.</div>
        </div>
      </div>
      <div class="importDialogHint mt-[calc(0.9em*var(--density))] opacity-[0.85]">Click outside to cancel.</div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  visible: boolean;
}>();

defineEmits<{
  close: [];
  "import-next-version": [];
  "import-translated": [];
}>();
</script>
