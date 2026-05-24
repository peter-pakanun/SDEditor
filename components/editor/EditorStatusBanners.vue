<template>
  <div>
    <h3>📁 Filepath: {{ currentDesc?.filepath }}</h3>
    <div v-if="compareActive" class="compareBanner">
      <span>{{ compareTitle }}</span>
      <button @click="$emit('exit-compare')">Exit compare</button>
    </div>
    <div v-if="currentDesc?.needsReview" class="needsReviewBanner">
      <span>⚠ Source changed since your last translation save.</span>
      <button @click="$emit('show-source-history')">Show source history</button>
      <button @click="$emit('toggle-english-diff')">Toggle inline diff</button>
      <button @click="$emit('confirm-unchanged')">Confirm unchanged</button>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  currentDesc: any;
  compareActive: boolean;
  compareTitle: string;
}>();

defineEmits<{
  "exit-compare": [];
  "show-source-history": [];
  "toggle-english-diff": [];
  "confirm-unchanged": [];
}>();
</script>
