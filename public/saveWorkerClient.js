/* Only touched descriptions cross the worker boundary; an ACK means committed. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SaveWorkerClient = api;
})(typeof window === 'object' ? window : globalThis, function (root) {
  'use strict';

  class Client {
    constructor({ store = root.OfflineStore, Worker = root.Worker, url = 'saveWorker.js', readyTimeout = 5000 } = {}) {
      this.store = store; this.worker = null; this.pending = new Map(); this.queue = Promise.resolve();
      this.disposed = false; this.fallback = false;
      this.ready = new Promise(resolve => { this.resolveReady = resolve; });
      if (typeof Worker !== 'function') { this.useFallback(); return; }
      try {
        this.worker = new Worker(url);
        this.worker.onmessage = event => this.receive(event.data);
        this.worker.onerror = () => this.workerFailed('The background save worker stopped.');
        this.worker.onmessageerror = () => this.workerFailed('The background save response could not be read.');
        this.readyTimer = setTimeout(() => this.workerFailed('The background save worker could not start.'), readyTimeout);
      } catch (_) { this.useFallback(); }
    }
    useFallback() {
      clearTimeout(this.readyTimer); this.fallback = true;
      this.worker?.terminate(); this.worker = null;
      this.resolveReady(false);
    }
    workerFailed(message) {
      // A request already delivered to a worker may have committed. Preserve its
      // identifier so a retry can read the durable receipt instead of duplicating.
      for (const request of this.pending.values()) {
        request.reject(Object.assign(new Error(message + ' Keep this tab open and retry the local save.'), {
          durableUnknown: true, code: 'SAVE_WORKER_STOPPED', jobId: request.jobId,
        }));
      }
      this.pending.clear(); this.useFallback();
    }
    receive(message) {
      if (message?.type === 'ready' && message.version === 1) {
        clearTimeout(this.readyTimer); this.resolveReady(true); return;
      }
      const request = this.pending.get(message?.id);
      if (!request) return;
      if (message.type !== 'saved' && message.type !== 'error') return;
      this.pending.delete(message.id);
      if (message.type === 'saved') request.resolve(message.result);
      else request.reject(Object.assign(new Error(message.error?.message || 'The local save failed.'), message.error || {}));
    }
    save(batch) {
      const operation = this.queue.then(() => this.dispatch(batch));
      this.queue = operation.catch(() => {});
      return operation;
    }
    async dispatch(batch) {
      if (this.disposed) throw new Error('The local save worker has been closed.');
      if (!batch?.jobId) throw new TypeError('A local save requires an identifier.');
      await this.ready;
      if (this.disposed) throw new Error('The local save worker has been closed.');
      if (this.fallback) {
        if (!this.store?.saveTranslationBatch) throw new Error('Local storage is unavailable. Keep this tab open before retrying the save.');
        return this.store.saveTranslationBatch(batch);
      }
      return new Promise((resolve, reject) => {
        this.pending.set(batch.jobId, { resolve, reject, jobId: batch.jobId });
        try { this.worker.postMessage({ type: 'saveTranslations', id: batch.jobId, batch }); }
        catch (error) {
          this.pending.delete(batch.jobId);
          // A synchronous structured-clone failure sends no message. Do not
          // disguise a non-plain payload as a successful background request.
          if (error?.name === 'DataCloneError') { reject(error); return; }
          this.useFallback();
          Promise.resolve().then(() => {
            if (!this.store?.saveTranslationBatch) throw error;
            return this.store.saveTranslationBatch(batch);
          }).then(resolve, reject);
        }
      });
    }
    dispose() {
      this.disposed = true;
      this.workerFailed('The background save worker was closed.');
    }
  }
  return { Client, create: options => new Client(options) };
});
