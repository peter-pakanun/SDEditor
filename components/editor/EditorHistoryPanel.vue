<template>
  <div v-if="!currentDesc" class="historyEmpty">Open a file to see history</div>
  <div v-else>
    <div class="historyMeta">
      <div class="historyTitle">{{ currentDesc.filename }}</div>
      <div class="historySubtitle">
        <button class="historyModeBtn" :class="{ active: historyMode === 'translation' }" @click="$emit('set-mode', 'translation')">Translation</button>
        <button class="historyModeBtn" :class="{ active: historyMode === 'source' }" @click="$emit('set-mode', 'source')">Source</button>
        <span>{{ historyMode === 'source' ? 'English' : lang }}</span>
      </div>
    </div>
    <div v-if="historyLoading" class="historyLoading">Loading…</div>
    <div v-else>
      <div class="historyList">
        <div v-for="rev in historyItems" :key="rev.id" class="historyItem" :class="{ selectedA: historySelectedA && historySelectedA.id === rev.id, selectedB: historySelectedB && historySelectedB.id === rev.id }">
          <button class="historyPick" :class="{ current: String(rev.note || '').includes('(current)') }" @click="$emit('pick', rev)">{{ formatHistoryTime(rev.savedAt) }} {{ rev.note ? (' ' + rev.note) : '' }}</button>
          <button v-if="historyMode !== 'source'" class="historyRestore" title="Restore" @click="$emit('restore', rev)">↩</button>
        </div>
        <div v-if="historyItems.length === 0" class="historyEmpty">No revisions yet</div>
      </div>
      <div v-if="historyItems.length > 0" class="historyCompareBar">
        <button @click="$emit('clear')">Clear</button>
        <span v-if="!historySelectedB">Click a revision to compare against current</span>
        <span v-else>Comparing current → {{ formatHistoryTime(historySelectedB.savedAt) }}</span>
      </div>
      <div v-if="historyDiffHtml" class="historyDiff" v-html="historyDiffHtml"></div>
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
