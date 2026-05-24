<template>
  <div class="fieldMeta">
    <span class="metaPill" :class="{ mismatch: editorBlock.metaLinesTr !== editorBlock.metaLinesEn }" title="Lines (translation / english)"><span class="metaIcon">↵</span><span class="metaNum">{{ editorBlock.metaLinesTr }}/{{ editorBlock.metaLinesEn }}</span></span>
    <span v-if="editorBlock.isTable" class="metaPill" :class="{ mismatch: editorBlock.metaColsTr !== editorBlock.metaColsEn }" title="Table columns (translation / english)"><span class="metaIcon">@</span><span class="metaNum">{{ editorBlock.metaColsTr }}/{{ editorBlock.metaColsEn }}</span></span>
    <span class="metaPill" :class="{ mismatch: editorBlock.metaVarsTr !== editorBlock.metaVarsEn }" title="Variable tags (translation / english)"><span class="metaIcon">{}</span><span class="metaNum">{{ editorBlock.metaVarsTr }}/{{ editorBlock.metaVarsEn }}</span></span>
    <span class="metaPill" :class="{ mismatch: editorBlock.metaKwTr !== editorBlock.metaKwEn }" title="Keyword tags (translation / english)"><span class="metaIcon">[]</span><span class="metaNum">{{ editorBlock.metaKwTr }}/{{ editorBlock.metaKwEn }}</span></span>
    <span v-if="editorBlock.diagnosticWarningCount > 0" class="metaPill diagnosticWarningPill" :title="blockDiagnosticTitle(editorBlock, 'warning')"><span class="metaIcon">!</span><span class="metaNum">{{ editorBlock.diagnosticWarningCount }}</span></span>
    <span v-if="editorBlock.diagnosticErrorCount > 0" class="metaPill diagnosticErrorPill" :title="blockDiagnosticTitle(editorBlock, 'error')"><span class="metaIcon">x</span><span class="metaNum">{{ editorBlock.diagnosticErrorCount }}</span></span>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  editorBlock: any;
  blockDiagnosticTitle: (editorBlock: any, level: string) => string;
}>();
</script>
