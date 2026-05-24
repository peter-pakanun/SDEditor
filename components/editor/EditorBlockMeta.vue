<template>
  <div class="fieldMeta flex select-none items-center gap-[calc(0.4em*var(--density))] px-[calc(0.05em*var(--density))] pb-[calc(0.05em*var(--density))] pt-[calc(0.25em*var(--density))] text-app-font opacity-[0.85]">
    <span
      class="metaPill inline-flex items-center gap-[calc(0.45em*var(--density))] rounded-full border border-[color-mix(in_srgb,var(--color-shadow)_35%,transparent)] bg-[color-mix(in_srgb,var(--color-element)_70%,transparent)] px-[calc(0.55em*var(--density))] py-[calc(0.15em*var(--density))] backdrop-blur-[6px]"
      :class="editorBlock.metaLinesTr !== editorBlock.metaLinesEn ? 'border-[color-mix(in_srgb,var(--color-line-diff)_70%,var(--color-shadow))] bg-[var(--color-line-diff)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-line-diff)_30%,transparent)] [&_.metaNum]:font-bold' : ''"
      title="Lines (translation / english)"
    ><span class="metaIcon opacity-[0.85] text-[calc(11px*var(--density))] leading-none">↵</span><span class="metaNum text-[calc(10.5px*var(--density))] tracking-[0.02em] [font-variant-numeric:tabular-nums]">{{ editorBlock.metaLinesTr }}/{{ editorBlock.metaLinesEn }}</span></span>
    <span
      v-if="editorBlock.isTable"
      class="metaPill inline-flex items-center gap-[calc(0.45em*var(--density))] rounded-full border border-[color-mix(in_srgb,var(--color-shadow)_35%,transparent)] bg-[color-mix(in_srgb,var(--color-element)_70%,transparent)] px-[calc(0.55em*var(--density))] py-[calc(0.15em*var(--density))] backdrop-blur-[6px]"
      :class="editorBlock.metaColsTr !== editorBlock.metaColsEn ? 'border-[color-mix(in_srgb,var(--color-line-diff)_70%,var(--color-shadow))] bg-[var(--color-line-diff)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-line-diff)_30%,transparent)] [&_.metaNum]:font-bold' : ''"
      title="Table columns (translation / english)"
    ><span class="metaIcon opacity-[0.85] text-[calc(11px*var(--density))] leading-none">@</span><span class="metaNum text-[calc(10.5px*var(--density))] tracking-[0.02em] [font-variant-numeric:tabular-nums]">{{ editorBlock.metaColsTr }}/{{ editorBlock.metaColsEn }}</span></span>
    <span
      class="metaPill inline-flex items-center gap-[calc(0.45em*var(--density))] rounded-full border border-[color-mix(in_srgb,var(--color-shadow)_35%,transparent)] bg-[color-mix(in_srgb,var(--color-element)_70%,transparent)] px-[calc(0.55em*var(--density))] py-[calc(0.15em*var(--density))] backdrop-blur-[6px]"
      :class="editorBlock.metaVarsTr !== editorBlock.metaVarsEn ? 'border-[color-mix(in_srgb,var(--color-line-diff)_70%,var(--color-shadow))] bg-[var(--color-line-diff)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-line-diff)_30%,transparent)] [&_.metaNum]:font-bold' : ''"
      title="Variable tags (translation / english)"
    ><span class="metaIcon opacity-[0.85] text-[calc(11px*var(--density))] leading-none">{}</span><span class="metaNum text-[calc(10.5px*var(--density))] tracking-[0.02em] [font-variant-numeric:tabular-nums]">{{ editorBlock.metaVarsTr }}/{{ editorBlock.metaVarsEn }}</span></span>
    <span
      class="metaPill inline-flex items-center gap-[calc(0.45em*var(--density))] rounded-full border border-[color-mix(in_srgb,var(--color-shadow)_35%,transparent)] bg-[color-mix(in_srgb,var(--color-element)_70%,transparent)] px-[calc(0.55em*var(--density))] py-[calc(0.15em*var(--density))] backdrop-blur-[6px]"
      :class="editorBlock.metaKwTr !== editorBlock.metaKwEn ? 'border-[color-mix(in_srgb,var(--color-line-diff)_70%,var(--color-shadow))] bg-[var(--color-line-diff)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-line-diff)_30%,transparent)] [&_.metaNum]:font-bold' : ''"
      title="Keyword tags (translation / english)"
    ><span class="metaIcon opacity-[0.85] text-[calc(11px*var(--density))] leading-none">[]</span><span class="metaNum text-[calc(10.5px*var(--density))] tracking-[0.02em] [font-variant-numeric:tabular-nums]">{{ editorBlock.metaKwTr }}/{{ editorBlock.metaKwEn }}</span></span>
    <span
      v-if="editorBlock.diagnosticWarningCount > 0"
      class="metaPill diagnosticWarningPill inline-flex items-center gap-[calc(0.45em*var(--density))] rounded-full border border-[var(--color-diagnostic-warning-border)] bg-[var(--color-diagnostic-warning)] px-[calc(0.55em*var(--density))] py-[calc(0.15em*var(--density))] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-diagnostic-warning)_45%,transparent)] backdrop-blur-[6px] [&_.metaNum]:font-bold"
      :title="blockDiagnosticTitle(editorBlock, 'warning')"
    ><span class="metaIcon opacity-[0.85] text-[calc(11px*var(--density))] leading-none">!</span><span class="metaNum text-[calc(10.5px*var(--density))] tracking-[0.02em] [font-variant-numeric:tabular-nums]">{{ editorBlock.diagnosticWarningCount }}</span></span>
    <span
      v-if="editorBlock.diagnosticErrorCount > 0"
      class="metaPill diagnosticErrorPill inline-flex items-center gap-[calc(0.45em*var(--density))] rounded-full border border-[var(--color-diagnostic-error-border)] bg-[var(--color-diagnostic-error)] px-[calc(0.55em*var(--density))] py-[calc(0.15em*var(--density))] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-diagnostic-error)_45%,transparent)] backdrop-blur-[6px] [&_.metaNum]:font-bold"
      :title="blockDiagnosticTitle(editorBlock, 'error')"
    ><span class="metaIcon opacity-[0.85] text-[calc(11px*var(--density))] leading-none">x</span><span class="metaNum text-[calc(10.5px*var(--density))] tracking-[0.02em] [font-variant-numeric:tabular-nums]">{{ editorBlock.diagnosticErrorCount }}</span></span>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  editorBlock: any;
  blockDiagnosticTitle: (editorBlock: any, level: string) => string;
}>();
</script>
