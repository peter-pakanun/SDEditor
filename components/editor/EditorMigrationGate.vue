<template>
  <div v-if="pendingMigration" class="multiInstanceGate versionGate fixed inset-0 z-[10001] flex h-full w-full items-center justify-center bg-[rgba(0,0,0,0.5)] backdrop-blur-[2px]">
    <div class="multiInstanceGateContent versionGateContent max-h-[80vh] w-[90%] max-w-[680px] overflow-y-auto rounded-lg border-2 border-app-accent bg-app-bg2 p-[calc(2em*var(--density))] text-app-font shadow-[0_0_40px_var(--color-shadow),0_0_20px_rgba(0,0,0,0.3)] [&_h2]:mb-[calc(1em*var(--density))] [&_h2]:mt-0 [&_h2]:text-[calc(20px*var(--density))] [&_h2]:font-bold [&_h2]:text-app-accent [&_p]:my-[calc(0.75em*var(--density))] [&_p]:leading-[1.6] [&_p]:text-app-font">
      <h2>Move Existing Data?</h2>
      <p>
        We found SDEditor data from before PoE1/PoE2 split storage. It looks like <strong>{{ formatGameVersion(pendingMigration.detectedVersion) }}</strong> data.
      </p>
      <div class="multiInstanceGateWarning my-[calc(1em*var(--density))] rounded border-l-4 border-app-accent bg-[color-mix(in_srgb,var(--color-line-diff)_15%,transparent)] p-[calc(1em*var(--density))] text-app-font [&_strong]:font-bold [&_strong]:text-app-accent">
        This copies your old source, workspace, and revision history into the new {{ formatGameVersion(pendingMigration.detectedVersion) }} storage. The old data is left untouched as a backup.
      </div>
      <p>
        Source files: <strong>{{ pendingMigration.sourceCount }}</strong><br>
        Workspace files: <strong>{{ pendingMigration.workspaceCount }}</strong><br>
        History entries: <strong>{{ pendingMigration.revisionCount }}</strong>
      </p>
      <div v-if="migrationInProgress" class="migrationProgress mt-[calc(1em*var(--density))] flex items-center gap-[calc(0.75em*var(--density))] rounded bg-app-element-alt p-[calc(0.85em*var(--density))] leading-[1.4] text-app-font">
        <div class="migrationProgressSpinner h-[calc(18px*var(--density))] w-[calc(18px*var(--density))] flex-none animate-spin rounded-full border-[3px] border-[color-mix(in_srgb,var(--color-accent)_25%,transparent)] border-t-app-accent"></div>
        <span>Copying your old data into the new {{ formatGameVersion(pendingMigration.detectedVersion) }} storage…</span>
      </div>
      <div class="multiInstanceGateButtons mt-[calc(2em*var(--density))] flex flex-wrap justify-end gap-[calc(1em*var(--density))] [&_button]:cursor-pointer [&_button]:rounded [&_button]:border [&_button]:border-black [&_button]:px-[calc(1.5em*var(--density))] [&_button]:py-[calc(0.7em*var(--density))] [&_button]:text-[calc(14px*var(--density))] [&_button]:font-semibold [&_button]:transition-all [&_button]:duration-200 [&_button:disabled]:cursor-wait [&_button:disabled]:opacity-[0.65] [&_button:disabled]:shadow-none [&_button:disabled]:transform-none [&_button:disabled:hover]:opacity-[0.65] [&_button:disabled:hover]:shadow-none [&_button:disabled:hover]:transform-none">
        <button class="btnPrimary bg-app-accent text-app-bg hover:-translate-y-0.5 hover:opacity-90 hover:shadow-[0_4px_12px_rgba(0,0,0,0.3)] disabled:hover:translate-y-0" :disabled="migrationInProgress" @click="$emit('confirm')">
          {{ migrationInProgress ? 'Copying…' : 'Copy To ' + formatGameVersion(pendingMigration.detectedVersion) }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  pendingMigration: any;
  migrationInProgress: boolean;
  formatGameVersion: (version: string) => string;
}>();

defineEmits<{
  confirm: [];
}>();
</script>
