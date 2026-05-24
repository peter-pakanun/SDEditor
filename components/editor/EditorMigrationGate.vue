<template>
  <div v-if="pendingMigration" class="multiInstanceGate versionGate">
    <div class="multiInstanceGateContent versionGateContent">
      <h2>Move Existing Data?</h2>
      <p>
        We found SDEditor data from before PoE1/PoE2 split storage. It looks like <strong>{{ formatGameVersion(pendingMigration.detectedVersion) }}</strong> data.
      </p>
      <div class="multiInstanceGateWarning">
        This copies your old source, workspace, and revision history into the new {{ formatGameVersion(pendingMigration.detectedVersion) }} storage. The old data is left untouched as a backup.
      </div>
      <p>
        Source files: <strong>{{ pendingMigration.sourceCount }}</strong><br>
        Workspace files: <strong>{{ pendingMigration.workspaceCount }}</strong><br>
        History entries: <strong>{{ pendingMigration.revisionCount }}</strong>
      </p>
      <div v-if="migrationInProgress" class="migrationProgress">
        <div class="migrationProgressSpinner"></div>
        <span>Copying your old data into the new {{ formatGameVersion(pendingMigration.detectedVersion) }} storage…</span>
      </div>
      <div class="multiInstanceGateButtons">
        <button class="btnPrimary" :disabled="migrationInProgress" @click="$emit('confirm')">
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
