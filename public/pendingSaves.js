/* Ordered local saves. Editor navigation can finish while durable writes run. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PendingSaves = api;
})(typeof window === 'object' ? window : this, function (root) {
  'use strict';

  const plain = value => JSON.parse(JSON.stringify(value));
  const asError = value => value instanceof Error ? value : new Error(value?.message || String(value));
  const reviewCodes = new Set(['DRAFT_BASE_CHANGED', 'DRAFT_CHANGED', 'DRAFT_CONFLICT', 'SAVE_SCOPE_CHANGED', 'DROPPED_PROMOTION_CHANGED',
    'DELETE_STAGED_BASE_CHANGED', 'DELETE_STAGED_NOT_FOUND', 'DELETE_STAGED_CONFLICT']);
  const requiresReview = error => reviewCodes.has(error?.code) && !error?.durableUnknown;
  let fallbackId = 0;
  const contentScope = value => value.workspaceScope || value;
  function scopeKey(batch) {
    const branch = batch.workspaceScope?.branchId || batch.branchId || 'default';
    const content = contentScope(batch);
    return JSON.stringify([batch.accountId || '', batch.game, batch.sourceHash || '', batch.language,
      ...(branch === 'default' ? [] : [branch]),
      ...(content.groupId ? [{ versionId: String(content.versionId || ''), groupId: String(content.groupId) }] : [])]);
  }
  function matchesScope(scope, batch) {
    if (typeof scope === 'string') return scope === scopeKey(batch);
    if (!scope) return false;
    const expectedContent = contentScope(scope), actualContent = contentScope(batch);
    if ((expectedContent.groupId || '') !== (actualContent.groupId || '')
      || (expectedContent.versionId || '') !== (actualContent.versionId || '')) return false;
    for (const [field, alias] of [['game'], ['language'], ['sourceHash', 'source'], ['accountId', 'account'], ['branchId', 'branch']]) {
      if (!Object.hasOwn(scope, field) && !(alias && Object.hasOwn(scope, alias))) continue;
      const expected = Object.hasOwn(scope, field) ? scope[field] : scope[alias];
      if (field === 'branchId') {
        if ((expected || 'default') !== (batch.workspaceScope?.branchId || batch.branchId || 'default')) return false;
      } else if ((expected || '') !== (batch[field] || '')) return false;
    }
    return true;
  }

  function create({ save, captureScope = batch => root.OfflineStore?.captureWorkspaceScope?.(batch), onChange = () => {}, onCommit = () => {}, onError = () => {} } = {}) {
    if (typeof save !== 'function') throw new TypeError('A local save function is required.');
    const jobs = [];
    const waiters = [];
    const holds = new Set();
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
      if (disposed || running || holds.size || timer !== null || !jobs.length || jobs[0].status === 'failed') return;
      // Yield to the browser so closing the editor can paint before storage work.
      timer = setTimeout(() => { timer = null; pump(); }, 0);
    }
    async function pump() {
      if (disposed || running) return;
      running = true;
      try {
        while (!disposed && !holds.size && jobs.length && jobs[0].status !== 'failed') {
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
      const workspaceScope = captureScope?.(captured);
      if (workspaceScope) {
        captured.workspaceScope = plain(workspaceScope); captured.branchId = workspaceScope.branchId;
      }
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
    function hold() {
      const token = {};
      holds.add(token);
      if (timer !== null) clearTimeout(timer);
      timer = null;
      // Foreground draft reads and editor preparation get priority over starting
      // another write to the same IndexedDB store. Active writes still finish.
      return () => { if (holds.delete(token)) schedule(); };
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
    function discardRejectedSubmission(id) {
      const index = jobs.findIndex(job => job.id === id), job = jobs[index];
      if (!job || !job.journaled || job.durable || job.status !== 'failed' || !requiresReview(job.error)) return false;
      // The durable journal now retains this command for explicit review.
      jobs.splice(index, 1); notify(); settle(); schedule(); return true;
    }
    function discardRejectedReset(id) {
      const index = jobs.findIndex(job => job.id === id);
      const job = jobs[index];
      if (!job || job.durable || job.status !== 'failed' || !job.batch.resetStaging || job.error?.durableUnknown
        || !['DELETE_STAGED_BASE_CHANGED', 'DELETE_STAGED_NOT_FOUND', 'DELETE_STAGED_CONFLICT'].includes(job.error?.code)) return false;
      // A stale deletion was rejected before the storage transaction committed.
      // A new explicit confirmation must capture the file's current saved text.
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
    return { enqueue, retry, drain, hold, discardRejectedDraft, discardRejectedSubmission, discardRejectedReset, overlay, pendingFor: overlay, snapshot, dispose };
  }

  return { create, scopeKey, requiresReview };
});
