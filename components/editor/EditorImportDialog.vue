<template>
  <div v-if="visible" class="importDialogOverlay" @click.self="$emit('close')">
    <div class="box importDialogBox">
      <h3>Import</h3>
      <div class="importDialogButtons">
        <div class="importDialogOption">
          <button class="importDialogBtn primary" @click="$emit('import-next-version')">🆕📦 Import Next Version</button>
          <div class="importDialogCaption">This is what you normally do when you get a new export.</div>
        </div>
        <div class="importDialogOption">
          <button class="importDialogBtn" @click="$emit('import-translated')">🔁📦 Import Translated</button>
          <div class="importDialogCaption">This is rarely used; it is for when you want to move translated data between PCs.</div>
        </div>
      </div>
      <div class="importDialogHint">Click outside to cancel.</div>
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
