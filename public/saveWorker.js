/* IndexedDB persistence lives off the editor's rendering thread. */
'use strict';
importScripts('workspaceState.js', 'collaborationProtocol.js', 'regexEngine.js', 'translationDiagnostics.js', 'translationMemory.js', 'normalizedStore.js', 'normalizedRooms.js', 'offlineStore.js');

let saves = Promise.resolve();
self.onmessage = event => {
  const message = event.data;
  if (message?.type !== 'saveTranslations' || typeof message.id !== 'string') return;
  // The queue also defines ordering for callers outside the main app coordinator.
  const operation = saves.then(() => self.OfflineStore.saveTranslationBatch(message.batch));
  saves = operation.catch(() => {});
  operation.then(result => self.postMessage({ type: 'saved', id: message.id, result }), error => {
    self.postMessage({ type: 'error', id: message.id, error: {
      name: error?.name || 'Error', message: error?.message || String(error),
      ...(error?.code ? { code: error.code } : {}), ...(error?.stale ? { stale: true } : {}),
    } });
  });
};
self.postMessage({ type: 'ready', version: 1 });
