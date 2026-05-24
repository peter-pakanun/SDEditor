<template>
  <ClientOnly>
    <LazyEditorSdeEditorApp />
    <template #fallback>
      <div class="appRoot" data-density="compact">
        <div class="loadingContainer centerContainer loadingPage">
          <div class="box">
            <div class="loadingText">
              <h1>Loading SDEditor...</h1>
            </div>
          </div>
        </div>
      </div>
    </template>
  </ClientOnly>
</template>
