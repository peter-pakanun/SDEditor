/* Incremental language-shared TM coordination. Authentication stays in CloudSync. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TMCloudSync = api;
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  const stale = () => Object.assign(new Error('TM account or language changed.'), { stale: true });
  class Client {
    constructor({ cloud, store, onChange = () => {}, onIssue = () => {}, onWork = () => {} }) {
      this.cloud = cloud; this.store = store; this.onChange = onChange; this.onIssue = onIssue; this.onWork = onWork;
      this.running = null; this.destroyed = false;
      this.publishedVersions = new Map();
      this.backoff = 1000;
    }
    scope(ctx) { return { profile: ctx.profile, language: ctx.language }; }
    current(ctx) {
      return !this.destroyed && this.cloud.permissionsCurrent(ctx)
        && this.cloud.state.profiles[ctx.profile]?.settings.lang === ctx.language;
    }
    check(ctx) { if (!this.current(ctx)) throw stale(); }
    async request(ctx, suffix = '', options = {}) {
      this.check(ctx);
      const result = await this.cloud.request('/v1/translation-memories/' + encodeURIComponent(ctx.language) + suffix, options, ctx);
      this.check(ctx); return result;
    }
    async apply(ctx, value, options = {}) {
      this.check(ctx);
      await this.store.applyTranslationMemoryRemote(this.scope(ctx), value, { ...options, notify: false, guard: () => this.current(ctx) });
      this.check(ctx);
    }
    async state(scope) { return this.store.getTranslationMemoryState(scope); }
    async publish(ctx, state, notify = false) {
      const scope = this.scope(ctx), scopeKey = JSON.stringify([scope.profile, scope.language]);
      let conflictCount = state.conflicts;
      if (!this.publishedVersions.has(scopeKey) || this.publishedVersions.get(scopeKey) !== state.localVersion) {
        const snapshot = await this.store.getTranslationMemory(scope);
        this.check(ctx); this.onChange(scope, snapshot);
        this.publishedVersions.set(scopeKey, snapshot.localVersion);
        conflictCount = snapshot.conflicts?.length || 0;
      }
      if (notify) this.store.notifyTranslationMemoryChange?.(scope);
      return conflictCount;
    }
    async changes(ctx, after, bootstrap = false) {
      let more = true;
      while (more) {
        const page = await this.request(ctx, '/changes?' + new URLSearchParams({ after: String(after), limit: '100' }));
        if (!Array.isArray(page.changes) || !Number.isSafeInteger(page.nextAfter) || page.nextAfter < after
          || (page.hasMore && page.nextAfter === after)) throw new Error('Invalid TM change cursor.');
        const units = [], tombstones = [];
        for (const change of page.changes) { units.push(...(change.units || [])); tombstones.push(...(change.tombstones || [])); }
        await this.apply(ctx, { revision: page.nextAfter, units, tombstones }, { bootstrap, complete: false });
        after = page.nextAfter; more = !!page.hasMore;
      }
      return after;
    }
    async run(ctx, hints, restarted = false) {
      const scope = this.scope(ctx);
      if (this.cloud.state.profiles[ctx.profile]?.tmAdoptGuest) {
        await this.store.adoptTranslationMemoryProfile('guest', ctx.profile, { guard: () => this.current(ctx) });
        this.check(ctx);
        await this.cloud.updateShared((state, profile) => { delete profile.tmAdoptGuest; }, ctx, false);
      }
      let state = await this.state(scope);
      const initialVersion = state.localVersion;
      this.runVersion = { scope, version: initialVersion };
      this.check(ctx);
      if (!state.bootstrapped) {
        let cursor = '', watermark = null;
        do {
          const page = await this.request(ctx, '?' + new URLSearchParams({ limit: '500', ...(cursor ? { cursor } : {}) }));
          if (!Array.isArray(page.units) || !Array.isArray(page.tombstones) || !Number.isSafeInteger(page.revision)) throw new Error('Invalid TM snapshot.');
          watermark ??= page.revision;
          await this.apply(ctx, page, { bootstrap: true, complete: false });
          if (page.nextCursor && page.nextCursor === cursor) throw new Error('TM snapshot did not advance.');
          cursor = page.nextCursor || '';
        } while (cursor);
        const staged = await this.state(scope);
        let revision;
        try { revision = await this.changes(ctx, staged.bootstrapAnchor ?? watermark, true); }
        catch (error) { return this.recoverCursor(ctx, error, restarted); }
        await this.apply(ctx, { revision, units: [], tombstones: [] }, { bootstrap: true, complete: true, cursorRevision: revision });
      } else if (hints?.tmRevision == null || Number(hints.tmRevision) !== state.revision) {
        try { await this.changes(ctx, state.revision || 0); }
        catch (error) { return this.recoverCursor(ctx, error, restarted); }
      }
      this.check(ctx);
      let pending = await this.store.getTranslationMemoryPending(scope);
      try {
        while (pending?.length) {
          this.onWork({ active: true, label: 'Uploading translation memory' });
          const operation = pending[0];
          const body = operation.request || { mutationId: operation.mutationId, upserts: operation.upserts, deletions: operation.deletions };
          try {
            const response = await this.request(ctx, '', { method: 'PATCH', body });
            if (response.mutationId !== body.mutationId || !Number.isSafeInteger(response.appliedRevision)) throw new Error('Invalid TM save acknowledgement.');
            await this.store.acknowledgeTranslationMemoryWrite(scope, body.mutationId, response, { notify: false, guard: () => this.current(ctx) });
          } catch (error) {
            if (error.status !== 409) throw error;
            const conflicts = error.details?.conflicts || [];
            if (!conflicts.length) throw error;
            await this.store.rejectTranslationMemoryWrite(scope, body.mutationId, conflicts, { notify: false, guard: () => this.current(ctx) });
            break;
          }
          this.check(ctx);
          pending = await this.store.getTranslationMemoryPending(scope);
        }
      } finally { this.onWork({ active: false }); }
      this.check(ctx);
      state = await this.state(scope);
      this.check(ctx);
      const conflictCount = await this.publish(ctx, state, state.localVersion !== initialVersion);
      this.onIssue(conflictCount ? 'TM corrections conflict with shared work. Open Manage TM to choose which to keep.' : '');
      this.backoff = 1000;
    }
    async recoverCursor(ctx, error, restarted) {
      if (restarted || error.status !== 409 || error.code !== 'TM_REVISION_INVALID') throw error;
      this.check(ctx);
      await this.store.resetTranslationMemoryBootstrap(this.scope(ctx), { notify: false, guard: () => this.current(ctx) });
      this.check(ctx);
      return this.run(ctx, null, true);
    }
    async sync(ctx = this.cloud.context(), hints = this.cloud.hints(ctx)) {
      if (!ctx.token || !ctx.language || !this.current(ctx)) return;
      if (this.running) return this.running;
      this.running = this.run(ctx, hints).catch(async error => {
        if (error.stale || !this.current(ctx)) return;
        try {
          const state = await this.state(this.scope(ctx));
          this.check(ctx);
          const changed = this.runVersion?.scope.profile === ctx.profile && this.runVersion?.scope.language === ctx.language
            && state.localVersion !== this.runVersion.version;
          const scopeKey = JSON.stringify([ctx.profile, ctx.language]);
          if (state.bootstrapped && (changed || this.publishedVersions.has(scopeKey) && this.publishedVersions.get(scopeKey) !== state.localVersion))
            await this.publish(ctx, state, changed);
        } catch (_) { /* Preserve the original failure when storage or scope cannot be read. */ }
        if (!this.current(ctx)) return;
        this.onIssue(error.status === 404 ? 'TM cloud sync requires the updated API. Your TM is saved locally.'
          : 'TM is saved locally; cloud sync needs attention: ' + error.message);
        if (![401, 403].includes(error.status)) { this.backoff = Math.min(60000, this.backoff * 2); this.cloud.schedule(this.backoff); }
      }).finally(() => { this.running = null; });
      return this.running;
    }
    destroy() { this.destroyed = true; }
  }
  return { Client };
});
