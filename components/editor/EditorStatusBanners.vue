<template>
  <div>
    <h3>📁 Filepath: {{ currentDesc?.filepath }}</h3>
    <div v-if="compareActive" class="compareBanner mt-[calc(0.5em*var(--density))] flex items-center gap-[calc(0.6em*var(--density))] border border-[rgba(80,160,255,0.35)] bg-[rgba(80,160,255,0.12)] px-[calc(0.6em*var(--density))] py-[calc(0.4em*var(--density))]">
      <span>{{ compareTitle }}</span>
      <button @click="$emit('exit-compare')">Exit compare</button>
    </div>
    <div v-if="currentDesc?.needsReview" class="needsReviewBanner mt-[calc(0.5em*var(--density))] flex items-center gap-[calc(0.6em*var(--density))] border border-[rgba(255,180,0,0.35)] bg-[rgba(255,180,0,0.12)] px-[calc(0.6em*var(--density))] py-[calc(0.4em*var(--density))]">
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
