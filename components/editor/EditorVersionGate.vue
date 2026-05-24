<template>
  <div v-if="!testMode && !gameVersionSelected" class="multiInstanceGate versionGate">
    <div class="multiInstanceGateContent versionGateContent">
      <h2>Select Game Version</h2>
      <p>Choose the Path of Exile version you are translating. Source files, workspace data, and history are stored separately for each version.</p>
      <div class="versionGateButtons">
        <button class="versionChoiceBtn" @click="$emit('select', 'poe1')">
          <span class="versionChoiceMain">PoE1</span>
          <span class="versionChoiceSub">Path of Exile 1</span>
        </button>
        <button class="versionChoiceBtn" @click="$emit('select', 'poe2')">
          <span class="versionChoiceMain">PoE2</span>
          <span class="versionChoiceSub">Path of Exile 2</span>
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
