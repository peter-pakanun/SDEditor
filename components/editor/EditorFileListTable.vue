<template>
  <table id="table" class="display compact cell-border w-full border-collapse [&_td]:cursor-pointer [&_td]:overflow-x-auto [&_td]:p-[calc(1em*var(--density))] [&_td]:text-left [&_th]:cursor-pointer [&_th]:overflow-x-auto [&_th]:bg-app-bg2 [&_th]:p-[calc(1em*var(--density))] [&_th]:text-left [&_th]:align-top [&_th:hover]:bg-app-highlight [&_tbody>tr:hover]:bg-app-highlight [&_tr]:bg-app-element [&_tr:nth-child(even)]:bg-app-element-alt">
    <thead>
      <tr>
        <th class="w-[10%]" @click="$emit('sort', 'filedir')">Directory
          {{ currentSort == "filedir" ? currentSortIcon : "" }}</th>
        <th class="w-[15%]" @click="$emit('sort', 'filename')">
          Filename{{ currentSort == "filename" ? currentSortIcon : "" }}</th>
        <th class="w-auto" @click="$emit('sort', 'english')">English{{ currentSort == "english" ? currentSortIcon : "" }}</th>
        <th class="w-auto" @click="$emit('sort', 'translation')">Translation{{ currentSort == "translation" ? currentSortIcon : "" }}
        </th>
      </tr>
    </thead>
    <tbody>
      <tr
        v-for="desc in descsDisplay"
        :class="[
          desc.hasChanges ? '[&>td]:!bg-[rgba(80,255,90,0.08)] even:[&>td]:!bg-[rgba(80,255,90,0.12)] hover:[&>td]:!bg-[rgba(80,255,90,0.3)] [&>td.translationTr]:font-bold' : '',
          desc.isMissing ? '[&>td.translationTr]:!bg-[rgba(255,80,90,0.08)] even:[&>td.translationTr]:!bg-[rgba(255,80,90,0.12)] hover:[&>td.translationTr]:!bg-[rgba(255,80,90,0.3)]' : '',
          desc.needsReview ? '[&>td]:shadow-[inset_3px_0_0_rgba(255,180,0,0.75)] [&>td]:!bg-[rgba(255,180,0,0.08)] even:[&>td]:!bg-[rgba(255,180,0,0.12)] hover:[&>td]:!bg-[rgba(255,180,0,0.3)]' : '',
        ]"
        @click="$emit('edit', desc.filepath)"
      >
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
