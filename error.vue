<script setup lang="ts">
const props = defineProps<{
  error: {
    statusCode?: number;
    statusMessage?: string;
    message?: string;
  };
}>();

const title = computed(() => props.error.statusCode ? String(props.error.statusCode) : "Error");
const message = computed(() => props.error.statusMessage || props.error.message || "Something went wrong.");

function goHome() {
  clearError({ redirect: "/" });
}
</script>

<template>
  <div class="appRoot" data-density="compact">
    <div class="settingPage centerContainer">
      <div class="box">
        <h1>{{ title }}</h1>
        <p>{{ message }}</p>
        <button class="btnPrimary" type="button" @click="goHome">Back to editor</button>
      </div>
    </div>
  </div>
</template>
