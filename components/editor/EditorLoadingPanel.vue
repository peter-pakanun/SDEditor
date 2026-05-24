<template>
  <div
    v-if="gameVersionSelected && loadingProgress < 100 && lang !== '' && !needsInitialSettings"
    class="loadingContainer centerContainer loadingPage fixed inset-0 z-[1000] flex items-center justify-center bg-app-bg"
  >
    <div
      class="box rounded-[5px] bg-app-bg2 px-[calc(5em*var(--density))] py-[calc(3em*var(--density))] shadow-app"
      :class="needsPostMigrationImport && loadingProgress == 0 ? 'block max-w-[900px]' : 'flex items-center gap-[calc(3em*var(--density))]'"
    >
      <div v-if="loadingProgress > 0 && loadingProgress < 100" class="spinnerCon">
        <div class="lds-spinner">
          <div></div><div></div><div></div><div></div><div></div><div></div>
          <div></div><div></div><div></div><div></div><div></div><div></div>
        </div>
      </div>
      <template v-if="loadingProgress == 0 && needsPostMigrationImport">
        <h2 class="mb-[calc(0.6em*var(--density))] mt-0">Attention! Post-migration import required</h2>
        <h3 class="my-[calc(0.2em*var(--density))] font-medium">We found existing translations in your workspace, but the source (English) strings are missing.</h3>
        <h3 class="my-[calc(0.2em*var(--density))] font-medium">Please import the original <u>StatDescriptions.zip</u> you <b>used last</b> with this tool (not the _Translated export).</h3>
        <h3 class="my-[calc(0.2em*var(--density))] font-medium">If you don't want to restore your translations and version history, click the button below.</h3>
        <div class="importDialogButtons mt-[calc(1em*var(--density))] flex flex-col gap-[calc(1.6em*var(--density))]">
          <div class="importDialogOption flex flex-col gap-[calc(0.6em*var(--density))]">
            <button class="importDialogBtn mt-[calc(1em*var(--density))] w-full bg-app-accent px-[calc(1em*var(--density))] py-[calc(0.75em*var(--density))] text-left text-[calc(15px*var(--density))] text-black hover:brightness-105" @click="$emit('import-update')">📦 Import Previous Version</button>
          </div>
          <div class="importDialogOption flex flex-col gap-[calc(0.6em*var(--density))]">
            <button class="importDialogBtn mt-[calc(1em*var(--density))] w-full text-left" @click.stop.prevent="$emit('start-from-scratch')">Start from scratch</button>
          </div>
        </div>
      </template>
      <div v-if="loadingProgress == 0 && !needsPostMigrationImport" class="loadingText max-w-[900px] leading-[1.35] [&_h1]:m-0 [&_h2]:m-0 [&_h3]:m-0 [&_h3]:mt-[calc(0.35em*var(--density))] [&_h3]:font-medium">
        <p>Welcome to <b>SDEditor!</b></p>
        <p>Read the <a href="https://github.com/peter-pakanun/SDEditor/blob/master/docs/editor_guide.md" target="_blank">Editor guide</a> for more information.</p>
        <button title="Import ZIP" @click="$emit('import-update')">📦 Import StatDescriptions.zip</button>
        <p>* It is recommended to import the last version of StatDescriptions.zip first.</p>
      </div>
      <div v-if="loadingProgress == 0.001" class="loadingText max-w-[900px] leading-[1.35] [&_h1]:m-0 [&_h2]:m-0 [&_h3]:m-0 [&_h3]:mt-[calc(0.35em*var(--density))] [&_h3]:font-medium">
        <h1>Initializing...</h1>
        <h3>Please wait while we initialize the workspace. This can take a moment.</h3>
      </div>
      <div v-if="loadingProgress > 0.001 && loadingProgress < 99.95" class="loadingText max-w-[900px] leading-[1.35] [&_h1]:m-0 [&_h2]:m-0 [&_h3]:m-0 [&_h3]:mt-[calc(0.35em*var(--density))] [&_h3]:font-medium">
        <h1>Loading: {{ loadingProgress.toFixed(2) }}%</h1>
      </div>
      <template v-if="loadingProgress >= 99.95 && loadingProgress < 100">
        <div class="loadingText max-w-[900px] leading-[1.35] [&_h1]:m-0 [&_h2]:m-0 [&_h3]:m-0 [&_h3]:mt-[calc(0.35em*var(--density))] [&_h3]:font-medium">
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
