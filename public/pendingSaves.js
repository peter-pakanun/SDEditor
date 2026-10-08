/* Ordered local saves. Editor navigation can finish while durable writes run. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PendingSaves = api;
})(typeof window === 'object' ? window : this, function () {
  'use strict';

  const plain = value => JSON.parse(JSON.stringify(value));
  const asError = value => value instanceof Error ? value : new Error(value?.message || String(value));
  let fallbackId = 0;
  function scopeKey(batch) {
    return JSON.stringify([batch.accountId || '', batch.game, batch.sourceHash || '', batch.language]);
  }
  function matchesScope(scope, batch) {
    if (typeof scope === 'string') return scope === scopeKey(batch);
    if (!scope) return false;
    for (const [field, alias] of [['game'], ['language'], ['sourceHash', 'source'], ['accountId', 'account']]) {
      if (!Object.hasOwn(scope, field) && !(alias && Object.hasOwn(scope, alias))) continue;
      const expected = Object.hasOwn(scope, field) ? scope[field] : scope[alias];
      if ((expected || '') !== (batch[field] || '')) return false;
    }
    return true;
  }

  function create({ save, onChange = () => {}, onCommit = () => {}, onError = () => {} } = {}) {
    if (typeof save !== 'function') throw new TypeError('A local save function is required.');
    const jobs = [];
    const waiters = [];
    let timer = null;
    let running = false;
    let disposed = false;

    function snapshot() {
      return { pending: jobs.filter(job => !job.durable).length,
        error: jobs.find(job => job.error)?.error?.message || '', jobs: [...jobs] };
    }
    function notify() {
      // A UI observer must never interrupt a durable save or discard its record.
      try { onChange(snapshot()); } catch (_) {}
    }
    function settle() {
      const failure = jobs.find(job => job.status === 'failed');
      if (failure) {
        for (const waiter of waiters.splice(0)) waiter.reject(failure.error);
      } else if (!jobs.length) {
        for (const waiter of waiters.splice(0)) waiter.resolve();
      }
    }
    function schedule() {
      if (disposed || running || timer !== null || !jobs.length || jobs[0].status === 'failed') return;
      // Yield to the browser so closing the editor can paint before storage work.
      timer = setTimeout(() => { timer = null; pump(); }, 0);
    }
    async function pump() {
      if (disposed || running) return;
      running = true;
      try {
        while (!disposed && jobs.length && jobs[0].status !== 'failed') {
          const job = jobs[0];
          job.status = 'saving';
          notify();
          try {
            if (!job.durable) {
              job.ack = await save(job.batch, job);
              job.durable = true;
              // Record the durable acknowledgement before running UI callbacks.
              // Retrying a failed callback must not create another saved revision.
              notify();
            }
            await onCommit(job, job.ack);
            job.status = 'committed';
            jobs.shift();
            notify();
          } catch (error) {
            job.error = asError(error);
            job.status = 'failed';
            notify();
            settle();
            try { await onError(job, job.error); } catch (_) {}
            break;
          }
        }
      } finally {
        running = false;
        settle();
        schedule();
      }
    }
    function enqueue(batch, { context } = {}) {
      if (disposed) throw new Error('The local save queue is closed.');
      const captured = plain(batch);
      if (!captured || typeof captured !== 'object' || Array.isArray(captured)) throw new TypeError('A save batch is required.');
      captured.jobId ||= globalThis.crypto?.randomUUID?.() || 'local-save-' + Date.now() + '-' + (++fallbackId);
      const previous = jobs.find(job => job.id === captured.jobId);
      if (previous) {
        if (JSON.stringify(previous.batch) !== JSON.stringify(captured)) throw new Error('A save ID cannot be reused for different translations.');
        return previous;
      }
      const job = { id: captured.jobId, batch: captured, context, status: 'queued', error: null, durable: false, ack: null };
      jobs.push(job);
      notify();
      schedule();
      return job;
    }
    function drain() {
      if (disposed) return Promise.reject(new Error('The local save queue is closed.'));
      const failure = jobs.find(job => job.status === 'failed');
      if (failure) return Promise.reject(failure.error);
      if (!jobs.length) return Promise.resolve();
      return new Promise((resolve, reject) => { waiters.push({ resolve, reject }); schedule(); });
    }
    function retry() {
      if (disposed) return Promise.reject(new Error('The local save queue is closed.'));
      // Keep a failure visible during its retry, until that exact job completes.
      for (const job of jobs) if (job.status === 'failed') job.status = 'queued';
      notify();
      schedule();
      return drain();
    }
    function discardRejectedDraft(id) {
      const index = jobs.findIndex(job => job.id === id);
      const job = jobs[index];
      if (!job || job.durable || job.status !== 'failed' || !job.batch.draft
        || !['DRAFT_BASE_CHANGED', 'DRAFT_CHANGED', 'DRAFT_CONFLICT'].includes(job.error?.code)) return false;
      // These transactional rejections made no durable change. The separate
      // local draft remains recoverable and needs a fresh, reviewed submission.
      jobs.splice(index, 1);
      notify(); settle(); schedule();
      return true;
    }
    function overlay(scope, filepath) {
      for (let index = jobs.length - 1; index >= 0; index--) {
        const job = jobs[index];
        if (job.durable || job.batch.deferDisplay) continue;
        if (!matchesScope(scope, job.batch)) continue;
        const file = job.batch.files?.find(file => file.filepath === filepath);
        if (file) return file;
      }
      return null;
    }
    function dispose() {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      const error = new Error('The local save queue is closed.');
      for (const waiter of waiters.splice(0)) waiter.reject(error);
    }
    return { enqueue, retry, drain, discardRejectedDraft, overlay, pendingFor: overlay, snapshot, dispose };
  }

  return { create, scopeKey };
});
