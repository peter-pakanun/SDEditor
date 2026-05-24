<template>
  <table id="table" class="display compact cell-border">
    <thead>
      <tr>
        <th style="width: 10%;" @click="$emit('sort', 'filedir')">Directory
          {{ currentSort == "filedir" ? currentSortIcon : "" }}</th>
        <th style="width: 15%;" @click="$emit('sort', 'filename')">
          Filename{{ currentSort == "filename" ? currentSortIcon : "" }}</th>
        <th style="width: auto;" @click="$emit('sort', 'english')">English{{ currentSort == "english" ? currentSortIcon : "" }}</th>
        <th style="width: auto;" @click="$emit('sort', 'translation')">Translation{{ currentSort == "translation" ? currentSortIcon : "" }}
        </th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="desc in descsDisplay" v-bind:class="{ isMissing: desc.isMissing, hasChanges: desc.hasChanges, needsReview: desc.needsReview }" @click="$emit('edit', desc.filepath)">
        <td v-bind:title="desc.filedir">{{ elipsisRenderer(desc.filedir) }}</td>
        <td v-bind:title="desc.filename">{{ (desc.needsReview ? '⚠ ' : '') + desc.filename }}</td>
        <td><span v-html="desc.english"></span></td>
        <td class="translationTr"><span v-html="desc.translation"></span></td>
      </tr>
    </tbody>
  </table>
</template>

<script setup lang="ts">
defineProps<{
  descsDisplay: any[];
  currentSort: string;
  currentSortIcon: string;
  elipsisRenderer: (value: string) => string;
}>();

defineEmits<{
  sort: [field: string];
  edit: [filepath: string];
}>();
</script>
