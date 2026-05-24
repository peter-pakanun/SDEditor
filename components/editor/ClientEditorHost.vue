<template>
  <ClientOnly>
    <LazyEditorSdeEditorApp />
    <template #fallback>
      <div class="appRoot" data-density="compact">
        <div class="loadingContainer centerContainer loadingPage fixed inset-0 z-[1000] flex items-center justify-center bg-app-bg">
          <div class="box flex items-center gap-[calc(3em*var(--density))] rounded-[5px] bg-app-bg2 px-[calc(5em*var(--density))] py-[calc(3em*var(--density))] shadow-app">
            <div class="loadingText max-w-[900px] leading-[1.35] [&_h1]:m-0">
              <h1>Loading SDEditor...</h1>
            </div>
          </div>
        </div>
      </div>
    </template>
  </ClientOnly>
</template>
