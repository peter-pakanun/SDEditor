<script setup lang="ts">
const route = useRoute();
const version = String(route.params.gameVersion || "").toLowerCase();

if (!["poe1", "poe2"].includes(version)) {
  throw createError({ statusCode: 404, statusMessage: "Unknown game version" });
}
</script>

<template>
  <EditorClientEditorHost />
</template>
