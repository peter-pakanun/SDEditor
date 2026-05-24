<template>
  <div v-if="!currentDesc" class="historyEmpty mt-[calc(0.6em*var(--density))] opacity-[0.85]">Open a file to see history</div>
  <div v-else>
    <div class="historyMeta mt-[calc(0.5em*var(--density))] bg-app-bg2 px-[calc(0.6em*var(--density))] py-[calc(0.5em*var(--density))]">
      <div class="historyTitle font-semibold">{{ currentDesc.filename }}</div>
      <div class="historySubtitle text-[calc(0.9em*var(--density))] opacity-[0.85]">
        <button class="historyModeBtn px-[calc(0.5em*var(--density))] py-[calc(0.15em*var(--density))]" :class="historyMode === 'translation' ? 'bg-app-highlight' : ''" @click="$emit('set-mode', 'translation')">Translation</button>
        <button class="historyModeBtn px-[calc(0.5em*var(--density))] py-[calc(0.15em*var(--density))]" :class="historyMode === 'source' ? 'bg-app-highlight' : ''" @click="$emit('set-mode', 'source')">Source</button>
        <span>{{ historyMode === 'source' ? 'English' : lang }}</span>
      </div>
    </div>
    <div v-if="historyLoading" class="historyLoading mt-[calc(0.6em*var(--density))] opacity-[0.85]">Loading…</div>
    <div v-else>
      <div class="historyList mt-[calc(0.5em*var(--density))]">
        <div v-for="(rev, i) in historyItems" :key="rev.id" class="historyItem mt-[calc(0.35em*var(--density))] flex items-center gap-[calc(0.4em*var(--density))]">
          <button
            class="historyPick grow text-left"
            :class="[
              String(rev.note || '').includes('(current)') ? 'font-bold' : '',
              historySelectedA && historySelectedA.id === rev.id ? 'shadow-[inset_3px_0_0_var(--color-accent)]' : '',
              historySelectedB && historySelectedB.id === rev.id ? 'shadow-[inset_-3px_0_0_var(--color-element-highlight)]' : '',
              i === 0 ? 'font-semibold' : '',
            ]"
            @click="$emit('pick', rev)"
          >{{ formatHistoryTime(rev.savedAt) }} {{ rev.note ? (' ' + rev.note) : '' }}</button>
          <button v-if="historyMode !== 'source'" class="historyRestore" title="Restore" @click="$emit('restore', rev)">↩</button>
        </div>
        <div v-if="historyItems.length === 0" class="historyEmpty mt-[calc(0.6em*var(--density))] opacity-[0.85]">No revisions yet</div>
      </div>
      <div v-if="historyItems.length > 0" class="historyCompareBar mt-[calc(0.5em*var(--density))] flex items-center gap-[calc(0.5em*var(--density))]">
        <button @click="$emit('clear')">Clear</button>
        <span v-if="!historySelectedB">Click a revision to compare against current</span>
        <span v-else>Comparing current → {{ formatHistoryTime(historySelectedB.savedAt) }}</span>
      </div>
      <div v-if="historyDiffHtml" class="historyDiff mt-[calc(0.5em*var(--density))] max-h-[40vh] overflow-auto border border-black bg-app-element font-mono text-[calc(12px*var(--density))]" v-html="historyDiffHtml"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  currentDesc: any;
  historyMode: string;
  lang: string;
  historyLoading: boolean;
  historyItems: any[];
  historySelectedA: any;
  historySelectedB: any;
  historyDiffHtml: string;
  formatHistoryTime: (savedAt: number) => string;
}>();

defineEmits<{
  "set-mode": [mode: string];
  pick: [revision: any];
  restore: [revision: any];
  clear: [];
}>();
</script>
