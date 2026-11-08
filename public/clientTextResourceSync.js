/* Optional account Dictionary/TM sync; private workbook state stays in this browser. */
(function (root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.ClientTextResourceSync = api;
})(typeof window === 'object' ? window : globalThis, function (root) {
    'use strict';
    const memory = () => root.TranslationMemory || require('./translationMemory.js');
    const adapters = () => root.ContentAdapters || require('./contentAdapters.js');
    const copy = value => JSON.parse(JSON.stringify(value));
    const mixin = {
        data: () => ({ ctUploadSyncResources: false, ctResourceIssue: '' }),
        computed: {
            ctResourceSyncEnabled() {
                return !!(this.ctOfflineTest && this.ctWorkspace?.metadata.syncResources && this.ctResourceAccess());
            },
            ctUploadResourceAccess() {
                const languages = [...new Set((this.ctUploadFiles || []).map(item => item.language).filter(Boolean))];
                return languages.length === 1 && this.ctResourceAccess({ accountId: this.cloudProfileId, language: languages[0] }, false);
            },
            ctEditorMemory() {
                if (!this.ctResourceSyncEnabled) return this.ctMemory;
                const TM = memory(), cache = this._ctMemoryIdentities ||= new WeakMap();
                // Stored TM snapshots keep each unit/context immutable. Reuse
                // identities when a one-ID save replaces the surrounding array.
                const identity = unit => {
                    let entry = cache.get(unit);
                    if (!entry || entry.source !== unit.source || entry.gameScope !== unit.gameScope || entry.context !== unit.context) {
                        entry = { source: unit.source, gameScope: unit.gameScope, context: unit.context, key: TM.identityFor(unit) };
                        cache.set(unit, entry);
                    }
                    return entry.key;
                };
                const deleted = new Set((this.tmTombstones || []).map(identity)), units = new Map();
                for (const rows of [this.ctMemory || [], this.tmUnits || []]) for (const unit of rows) {
                    if (unit.context?.contentMode !== 'clienttext'
                        || ![this.gameVersion, 'all'].includes(unit.gameScope)) continue;
                    const key = identity(unit);
                    if (!deleted.has(key)) units.set(key, unit);
                }
                return [...units.values()];
            },
        },
        methods: {
            ctResourceAccess(scope = this.ctWorkspace?.scope, selected = true) {
                const user = this.cloudUser, client = this._cloud;
                return !!(!this.testMode && this.cloudSignedIn && user && client && !client.destroyed
                    && scope?.accountId === this.cloudProfileId && user.id === this.cloudProfileId
                    && (!selected || this.lang === scope.language)
                    && (this.cloudCanAccessAllLanguages || user.role === 'translator' && user.language === scope.language));
            },
            async ctQueueResourceMemory(ctx, unit, saved) {
                if (!this.ctCurrent(ctx) || !this.ctResourceSyncEnabled) return true;
                const units = adapters().clienttext.memoryUnits(unit, saved.values, ctx.scope.language,
                    { game: ctx.scope.game, branchId: ctx.scope.branchId, jobId: saved.jobId, origin: saved.origin, saved });
                if (!units.length) return true;
                const jobs = this._ctResourceJobs ||= new Map();
                jobs.set(saved.jobId, { ctx: copy(ctx), key: this.tmScopeKey, units, mutationId: 'clienttext:' + saved.jobId });
                return this.ctFlushResourceMemory();
            },
            async ctFlushResourceMemory() {
                if (this._ctResourceDrain) return this._ctResourceDrain;
                const drain = async () => {
                    for (const [id, job] of this._ctResourceJobs || []) {
                        const current = () => this.ctCurrent(job.ctx) && this.ctResourceSyncEnabled && this.tmScopeKey === job.key;
                        if (!current()) { this._ctResourceJobs.delete(id); continue; }
                        try {
                            const scope = { profile: job.ctx.scope.accountId, language: job.ctx.scope.language };
                            const result = await root.OfflineStore.putTranslationMemoryUnits(scope,
                                copy(job.units), { origin: 'learn', mutationId: job.mutationId, guard: current, returnChanges: true, notify: false });
                            this._ctResourceJobs.delete(id);
                            if (!current()) continue;
                            this.ctResourceIssue = '';
                            if (!this.applyClientTextMemoryPatch?.(result?.patch)) this.loadTranslationMemory?.();
                            if (result?.changed !== false) root.OfflineStore.notifyTranslationMemoryChange?.(scope);
                            this._cloud?.schedule(0);
                        } catch (error) {
                            if (current()) this.ctResourceIssue = 'Workbook saved locally, but TM could not be queued. Keep this session open and use Sync now: ' + error.message;
                            return false;
                        }
                    }
                    return true;
                };
                this._ctResourceDrain = drain().finally(() => { this._ctResourceDrain = null; });
                return this._ctResourceDrain;
            },
            ctClearResourceSync() { this._ctResourceJobs?.clear(); this.ctResourceIssue = ''; },
        },
    };
    return { mixin };
});
