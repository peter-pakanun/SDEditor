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
    <div class="settingPage centerContainer fixed inset-0 z-[2] flex items-center justify-center bg-app-bg">
      <div class="box rounded-[5px] bg-app-bg2 px-[calc(5em*var(--density))] py-[calc(3em*var(--density))] shadow-app">
        <h1>{{ title }}</h1>
        <p>{{ message }}</p>
        <button class="btnPrimary bg-app-accent text-app-bg" type="button" @click="goHome">Back to editor</button>
      </div>
    </div>
  </div>
</template>
