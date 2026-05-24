<template>
  <div
    v-if="gameVersionSelected && loadingProgress < 100 && lang !== '' && !needsInitialSettings"
    class="loadingContainer centerContainer loadingPage"
    :class="{ postMigration: needsPostMigrationImport && loadingProgress == 0 }"
  >
    <div class="box">
      <div v-if="loadingProgress > 0 && loadingProgress < 100" class="spinnerCon">
        <div class="lds-spinner">
          <div></div><div></div><div></div><div></div><div></div><div></div>
          <div></div><div></div><div></div><div></div><div></div><div></div>
        </div>
      </div>
      <template v-if="loadingProgress == 0 && needsPostMigrationImport">
        <h2>Attention! Post-migration import required</h2>
        <h3>We found existing translations in your workspace, but the source (English) strings are missing.</h3>
        <h3>Please import the original <u>StatDescriptions.zip</u> you <b>used last</b> with this tool (not the _Translated export).</h3>
        <h3>If you don't want to restore your translations and version history, click the button below.</h3>
        <div class="importDialogButtons">
          <div class="importDialogOption">
            <button class="importDialogBtn primary" @click="$emit('import-update')">📦 Import Previous Version</button>
          </div>
          <div class="importDialogOption">
            <button class="importDialogBtn" @click.stop.prevent="$emit('start-from-scratch')">Start from scratch</button>
          </div>
        </div>
      </template>
      <div v-if="loadingProgress == 0 && !needsPostMigrationImport" class="loadingText">
        <p>Welcome to <b>SDEditor!</b></p>
        <p>Read the <a href="https://github.com/peter-pakanun/SDEditor/blob/master/docs/editor_guide.md" target="_blank">Editor guide</a> for more information.</p>
        <button title="Import ZIP" @click="$emit('import-update')">📦 Import StatDescriptions.zip</button>
        <p>* It is recommended to import the last version of StatDescriptions.zip first.</p>
      </div>
      <div v-if="loadingProgress == 0.001" class="loadingText">
        <h1>Initializing...</h1>
        <h3>Please wait while we initialize the workspace. This can take a moment.</h3>
      </div>
      <div v-if="loadingProgress > 0.001 && loadingProgress < 99.95" class="loadingText">
        <h1>Loading: {{ loadingProgress.toFixed(2) }}%</h1>
      </div>
      <template v-if="loadingProgress >= 99.95 && loadingProgress < 100">
        <div class="loadingText">
          <h1>Finalizing import…</h1>
          <h3>Writing revision history to offline storage. This can take a moment.</h3>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  gameVersionSelected: boolean;
  loadingProgress: number;
  lang: string;
  needsInitialSettings: boolean;
  needsPostMigrationImport: boolean;
}>();

defineEmits<{
  "import-update": [];
  "start-from-scratch": [];
}>();
</script>
