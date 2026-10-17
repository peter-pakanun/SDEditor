/* MTL review overlays are separate from ordinary values, drafts, history and exports. */
(function (root, factory) {
    const node = typeof module === 'object' && module.exports;
    const api = factory(root, node ? require('./clientTextState.js') : root.ClientTextState,
        node ? require('./clientTextMtlState.js') : root.ClientTextMtlState,
        node ? require('./clientTextMtlContext.js') : root.ClientTextMtlContext);
    if (node) module.exports = api; else root.ClientTextMtlUI = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root, S, M, Context) {
    'use strict';
    const copy = value => S.copy(value), raw = value => root.Vue?.markRaw ? root.Vue.markRaw(value) : value;
    const key = (unitId, fieldId) => JSON.stringify([unitId, fieldId]);
    const id = () => root.crypto.randomUUID();
    const stale = () => Object.assign(new Error('The MTL request context changed.'), { stale: true, name: 'AbortError' });
    const failureText = code => ({
        MTL_OUTPUT_INVALID: 'MTL returned an invalid or incomplete translation. The existing text is unchanged. Try a new translation when ready.',
        MTL_NOT_CONFIGURED: 'MTL is not connected. An administrator must configure the translation service.',
        MTL_PROVIDER_LIMIT: 'The translation service has reached its usage limit. Try again later.',
        MTL_PROVIDER_FAILED: 'The translation service could not complete this attempt. The existing text is unchanged.',
        MTL_REFUSED: 'The translation service declined this attempt. The existing text is unchanged.',
        MTL_CANCELLED: 'Translation stopped. The existing text is unchanged.',
        MTL_EXPIRED: 'This MTL attempt timed out. The existing text is unchanged.',
        MTL_RESULT_EXPIRED: 'The earlier MTL result is no longer available. Generate again when ready.',
    })[code];
    function permissions(host, ctx) {
        const user = host.cloudUser;
        return !!host.cloudSignedIn && !!host._cloud && !!user && String(user.id) === String(ctx.scope.accountId)
            && (host.cloudCanAccessAllLanguages || ['admin', 'manager'].includes(user.role) || user.isAdmin === true
                || user.role === 'translator' && user.language === ctx.scope.language);
    }
    function access(host) {
        return JSON.stringify([host.cloudSignedIn, host.cloudProfileId, host.cloudUser?.id, host.cloudUser?.role,
            host.cloudUser?.language, host.cloudUser?.assignmentVersion, host.cloudUser?.isAdmin, host.cloudCanAccessAllLanguages]);
    }
    const mixin = {
        data() { return { ctMtlCandidates: raw([]), ctMtlReviews: {}, ctMtlRecoveries:raw([]), ctMtlCapabilities: null, ctMtlError: '', ctMtlRequests: {}, ctMtlLive: {}, ctMtlGenerations: raw([]), ctMtlDismissals:raw([]),ctMtlDismissBusy:{},ctMtlRevision: 0 }; },
        computed: {
            ctMtlRequestScopeKey() { return JSON.stringify([this.ctActive, this.ctWorkspace?.scope, this.lang, this.gameVersion, this.branchId, access(this), this._cloud?.epoch, this.mtlConsentVersion]); },
            ctInputValues() {
                const host = this;
                if (!this._ctMtlInputProxy) this._ctMtlInputProxy = raw(new Proxy({}, {
                    get(_, property) {
                        if (typeof property !== 'string') return host.ctValues?.[property];
                        const field = host.ctCurrentUnit?.fields.find(field => field.id === property);
                        return field ? host.ctMtlFieldValue(field) : host.ctValues?.[property];
                    },
                    set(_, property, text) {
                        const field = host.ctCurrentUnit?.fields.find(field => field.id === property);
                        if (field && host.ctMtlBusy(field)) return true;
                        if (!field || !host.ctMtlEdited(field, String(text ?? ''))) host.ctValues[property] = text;
                        return true;
                    },
                    ownKeys: () => Reflect.ownKeys(host.ctValues || {}),
                    getOwnPropertyDescriptor: (_, property) => ({ enumerable: true, configurable: true, value: host.ctValues?.[property] })
                }));
                return this._ctMtlInputProxy;
            },
            ctMtlUnitIds() {
                this.ctMtlRevision; const ids = new Set();
                for (const candidate of this.ctMtlCandidates) {
                    const unit = this._ctUnitIndex?.get(candidate.unitId), field = unit?.fields.find(field => field.id === candidate.fieldId);
                    if (field && this.ctMtlApplicable(candidate, field, unit)) ids.add(unit.id);
                }
                for(const {unit} of this.ctMtlAcceptedDraftFields())ids.add(unit.id);
                return ids;
            },
            ctMtlCount() { return this.ctMtlUnitIds.size; },
            ctMtlFieldCount() {
                this.ctMtlRevision; const fields = new Set();
                for (const candidate of this.ctMtlCandidates) {
                    const unit = this._ctUnitIndex?.get(candidate.unitId), field = unit?.fields.find(field => field.id === candidate.fieldId);
                    if (field && this.ctMtlApplicable(candidate, field, unit)) fields.add(key(unit.id, field.id));
                }
                for(const {unit,field} of this.ctMtlAcceptedDraftFields())fields.add(key(unit.id,field.id));
                return fields.size;
            }
        },
        watch: { ctMtlRequestScopeKey: { flush: 'sync', handler() {
            this.ctMtlAbortRequests();this._ctMtlSync?.stop?.();this._ctMtlSync=null;this._ctMtlDismissalRead=null;this.ctMtlDismissals=raw([]);this.ctMtlDismissBusy={};
            const ctx=this.ctContext();Promise.resolve().then(()=>{if(this.ctActive&&this.ctCurrent(ctx)&&permissions(this,ctx)){this.ctMtlEnsureSync(ctx);return this.ctMtlRefreshDismissals(ctx);}}).catch(()=>{});
        } } },
        beforeUnmount() { this.ctMtlReset(); },
        methods: {
            ctMtlUnitRequestVersion(unit=this.ctCurrentUnit) { return this._ctMtlUnitRequestVersions?.get(unit?.id)||0; },
            ctMtlNoteRequest(unit) {
                const versions=this._ctMtlUnitRequestVersions ||= raw(new Map());
                versions.set(unit.id,this._ctMtlRequestSerial=(this._ctMtlRequestSerial||0)+1);
            },
            ctMtlFocusBeforeRequest(field) {
                const active=root.document?.activeElement;
                // Pointer Translate can retain focus on a choice/Restore button
                // that the request is about to disable. Avoid a blur to body and
                // its unrelated inline autosave before applying the read-only lock.
                if(active?.tagName==='BUTTON'&&this.ctEditorElement?.()?.contains(active))this.ctDictionaryTarget?.(field.id)?.focus({preventScroll:true});
            },
            ctMtlAbortRequests() {
                for (const job of this._ctMtlJobs?.values() || []) job.controller.abort();
                this._ctMtlJobs?.clear(); this.ctMtlLive = {}; this.ctMtlRequests = {};
            },
            ctMtlProgressFor(field) {
                this.ctRevision; this.ctMtlRevision;
                const name = key(this.ctSelection, field?.id), value = this.ctMtlLive[name], job = this._ctMtlJobs?.get(name);
                return value && value.requestId === job?.requestId && job.current?.() ? value : null;
            },
            ctMtlProgressUpdate(job, value) {
                if (this._ctMtlJobs?.get(job.name) !== job || !job.current?.()) return false;
                const old = this.ctMtlLive[job.name] || {}, phase = ['waiting', 'receiving', 'validating', 'reconnecting', 'cancelling'].includes(value.phase) ? value.phase : old.phase || 'waiting';
                const text = typeof value.text === 'string' && value.text.length <= 32768 ? value.text : old.text || '';
                const elapsedMs = Number.isFinite(value.elapsedMs) && value.elapsedMs >= 0 ? value.elapsedMs : Math.max(0, Date.now() - job.startedAt);
                this.ctMtlLive = { ...this.ctMtlLive, [job.name]: { requestId: job.requestId, phase, text, elapsedMs, receivedAt: Date.now(), canCancel: value.canCancel === true } };
                return true;
            },
            ctMtlProgressClear(job) {
                if (this.ctMtlLive[job.name]?.requestId !== job.requestId) return;
                const live = { ...this.ctMtlLive }; delete live[job.name]; this.ctMtlLive = live;
            },
            ctMtlRequestWait(job, delay) {
                return new Promise((resolve, reject) => {
                    const finish = error => { clearTimeout(timer); job.controller.signal.removeEventListener('abort', abort); if (job.wake === finish) job.wake = null; error ? reject(error) : resolve(); },
                        abort = () => finish(stale()), timer = setTimeout(finish, delay);
                    job.wake = finish; job.controller.signal.addEventListener('abort', abort, {once:true});
                    if (job.controller.signal.aborted) abort();
                });
            },
            async ctMtlCancel(field) {
                const job = this._ctMtlJobs?.get(key(this.ctSelection, field?.id));
                if (!job?.current?.() || !job.cancel || job.cancelling) return false;
                job.timing?.mark('cancelRequested');
                job.cancelling = true; job.cancelledByUser = true; this.ctMtlProgressUpdate(job, {phase:'cancelling'});
                const generation=this.ctMtlGenerations.find(value=>value.requestId===job.requestId);
                if(generation){generation.suppressed=true;this.ctMtlRevision++;}
                // A validated server result can win the cancellation race and
                // arrive later through sync. Keep it behind explicit Review.
                const marker=Promise.resolve().then(()=>this.ctMtlStorage({scope:job.scope}).putGeneration(job.scope,{requestId:job.requestId,suppressed:true}));
                marker.catch(()=>{});
                try {
                    const response = await job.cancel();
                    await marker;
                    if (!job.current()) return false;
                    job.cancelResponse = response; job.wake?.(); return true;
                } catch (error) {
                    if (job.current() && !error.stale) {
                        this.ctMtlError = 'The stop request could not be confirmed. The translation status will be checked automatically.';
                        job.cancelling = false; this.ctMtlProgressUpdate(job, {phase:'reconnecting',canCancel:true});
                    }
                    return false;
                }
            },
            async ctMtlPoll(job, initial) {
                let response = initial, failures = 0, delay = 250;
                const until = Date.now() + 210000, path = '/v1/mtl/requests/' + encodeURIComponent(job.requestId),
                    invalid = () => Object.assign(new Error('The MTL progress response does not match this request. The existing text is unchanged.'), {code:'MTL_INVALID_RESPONSE'});
                job.cancel = () => job.client.request(path + '/cancellations', {method:'POST',body:{},signal:job.controller.signal,timeout:10000});
                while (job.current()) {
                    if (response) {
                        if (response.candidate) return response;
                        if (response.requestId !== job.requestId || !['reserved','running','completed','failed','cancelled','expired','interrupted'].includes(response.status)) throw invalid();
                        const scope = response.scope;
                        if (!scope || scope.language !== job.scope.language || ['game','branchId'].some(name => scope[name] !== undefined && scope[name] !== job.scope[name])
                            || (String(job.scope.groupId).startsWith('local:') ? scope.local !== true : scope.groupId !== job.scope.groupId)) throw invalid();
                        if (!['reserved','running'].includes(response.status)) throw Object.assign(new Error(failureText(response.errorCode)
                            || 'This MTL attempt ended without a usable translation. The existing text is unchanged.'), {code:response.errorCode || 'MTL_FAILED',mtlFinal:true});
                        const progress = response.progress, phase = {preparing:'waiting',connecting:'waiting',generating:'receiving',validating:'validating'}[progress?.phase];
                        if (progress && (progress.provisional !== true || !Number.isSafeInteger(progress.revision) || progress.revision < 0 || !phase
                            || typeof progress.translation !== 'string' || progress.translation.length > 32768 || progress.translation.includes('\u0000')
                            || progress.translation.isWellFormed && !progress.translation.isWellFormed())) throw invalid();
                        if (progress && (job.progressRevision === undefined || progress.revision >= job.progressRevision)) {
                            job.progressRevision = progress.revision;
                            this.ctMtlProgressUpdate(job, {phase:job.cancelling ? 'cancelling' : phase,text:progress.translation,canCancel:!job.cancelling});
                            if(progress.translation&&!job.cancelledByUser){job.timing?.mark('firstProgress');if(job.timing)this.ctMtlDebugTimingFrame?.(job.timing,'firstTextFrameReady',job.fieldId,true);}
                        } else this.ctMtlProgressUpdate(job, {phase:job.cancelling ? 'cancelling' : undefined,canCancel:!job.cancelling});
                        delay = Math.max(250, Math.min(2000, Number.isFinite(response.pollAfterMs) ? response.pollAfterMs : 500));
                    }
                    if (Date.now() >= until) throw Object.assign(new Error('The MTL request could not be confirmed. Check the pending request when the connection returns.'), {code:'MTL_REQUEST_UNCERTAIN'});
                    await this.ctMtlRequestWait(job, Math.min(5000, delay * Math.pow(2, Math.min(failures,4))));
                    if (!job.current()) throw stale();
                    if (job.cancelResponse) { response = job.cancelResponse; job.cancelResponse = null; continue; }
                    try {
                        response = await job.client.request(path, {signal:job.controller.signal,timeout:10000});
                        if (!job.current()) throw stale();
                        failures = 0;
                    } catch (error) {
                        if (!job.current() || error.stale) throw stale();
                        const status = error.status || error.statusCode;
                        if (status && ![408,429].includes(status) && status < 500) {
                            if (status === 404) error.mtlFinal = true;
                            throw error;
                        }
                        failures++; response = null;
                        this.ctMtlProgressUpdate(job, {phase:job.cancelling ? 'cancelling' : 'reconnecting',canCancel:!job.cancelling});
                    }
                }
                throw stale();
            },
            ctMtlReset() {
                this.ctMtlDebugReset?.();
                this.ctMtlAbortRequests();
                this._ctMtlRun = null; this._ctMtlSync?.stop?.(); this._ctMtlSync = null;
                this._ctMtlJobs = raw(new Map()); this._ctMtlEditMutations = raw(new Map()); this._ctMtlReviewQueues = raw(new Map());
                this._ctMtlUnitRequestVersions=raw(new Map());
                this._ctMtlStoredReviews=raw(new Map());this._ctMtlRecoveryRun=null;
                this._ctMtlDescriptors = raw([]); this._ctMtlSuppressed = raw(new Set()); this._ctMtlAcceptanceClaims = {};
                this._ctMtlSyncError='';this._ctMtlSyncRun=null;this._ctMtlDismissalRead=null;
                this.ctMtlCandidates = raw([]); this.ctMtlReviews = {}; this.ctMtlRecoveries=raw([]); this.ctMtlRequests = {}; this.ctMtlGenerations = raw([]);this.ctMtlDismissals=raw([]);this.ctMtlDismissBusy={}; this.ctMtlError = ''; this.ctMtlRevision++;
            },
            ctMtlStorage(ctx = this.ctContext()) {
                const normal = this.ctStorage(ctx.scope);
                if (normal?.mtl) return normal.mtl;
                if (String(ctx.scope.groupId || '').startsWith('local:')) throw new Error('This in-memory MTL session has ended.');
                return this._ctMtlStore ||= raw(root.ClientTextMtlStore.create());
            },
            ctMtlClearOperationError() { this.ctMtlError = this._ctMtlSyncError || ''; },
            ctMtlArchiveSupported() { return this.ctMtlCapabilities?.reviewArchive===true&&this.ctMtlCapabilities?.consentVersion==='mtl-v2'; },
            ctMtlDismissBusyFor(field) { return !!this.ctMtlDismissBusy[key(this.ctSelection,field?.id)]; },
            ctMtlPendingDismissal(field,unit=this.ctCurrentUnit) { return this.ctMtlDismissals.find(value=>value.unitId===unit?.id&&(value.fieldId||value.candidate?.fieldId)===field?.id)||null; },
            ctMtlDismissalText(operation) {
                if(operation?.state==='archive-pending')return 'Dismissed on the server; its private review file is still pending. The same dismissal will be retried.';
                if(operation?.state==='conflict')return 'Dismissal needs attention. Its original request is retained; retry it after reviewing the error.';
                return 'Private review upload is pending. The same dismissal will be retried.';
            },
            async ctMtlRefreshDismissals(ctx=this.ctContext(),guard=()=>this.ctCurrent(ctx)&&permissions(this,ctx)) {
                const client=this._cloud,capturedAccess=access(this),run=this._ctMtlDismissalRead={},
                    current=()=>this.ctActive&&this.ctCurrent(ctx)&&client===this._cloud&&capturedAccess===access(this)&&permissions(this,ctx)&&guard();
                const operations=await this.ctMtlStorage(ctx).getOutbox(ctx.scope,{guard:current});
                if(!current()||this._ctMtlDismissalRead!==run)return false;this.ctMtlDismissals=raw(operations);this.ctMtlRevision++;return true;
            },
            ctMtlEnsureSync(ctx=this.ctContext()) {
                if(!this.ctActive||!permissions(this,ctx)||!this.ctMtlCapabilities||!root.ClientTextMtlSync)return null;
                const local=String(ctx.scope.groupId).startsWith('local:');
                if(local&&!this.ctMtlArchiveSupported()||this.ctMtlCapabilities?.unsupported)return null;
                if(this._ctMtlSync)return this._ctMtlSync;
                const client=this._cloud,capturedAccess=access(this),current=()=>this.ctActive&&this.ctCurrent(ctx)&&client===this._cloud&&capturedAccess===access(this)&&permissions(this,ctx);
                const refresh=()=>{if(current())this.ctMtlRefreshDismissals(ctx,current).catch(()=>{});};
                const sync=raw(root.ClientTextMtlSync.create({scope:ctx.scope,local,immediate:false,store:this.ctMtlStorage(ctx),
                    request:(path,options)=>client.request(path,options),isCurrent:current,offline:()=>root.navigator?.onLine===false,
                    onChange:()=>{refresh();if(current())this.ctMtlRefreshCandidates(ctx,current).catch(()=>{});},
                    onError:state=>{if(!current())return;refresh();const old=this._ctMtlSyncError||'';this._ctMtlSyncError=state.error;
                        if(state.error||this.ctMtlError===old)this.ctMtlError=state.error;}}));
                this._ctMtlSync=sync;sync.start();return sync;
            },
            async ctMtlRefreshCandidates(ctx,guard) {
                const store=this.ctMtlStorage(ctx),candidates=await store.list(ctx.scope,{guard});if(!guard())return;
                if(JSON.stringify(candidates)!==JSON.stringify(this.ctMtlCandidates)){this.ctMtlCandidates=raw(candidates);this.ctMtlRevision++;}
            },
            async ctMtlLoadCapabilities() {
                const client = this._cloud, captured = access(this);
                if (!client || !this.cloudSignedIn) { this.ctMtlCapabilities = null; return null; }
                try {
                    const result = await client.request('/v1/mtl/capabilities');
                    if (client === this._cloud && captured === access(this)) this.ctMtlCapabilities = result.capabilities || result;
                    return result.capabilities || result;
                } catch (error) {
                    // An API deployed before MTL has no candidate lifecycle routes.
                    // Keep ordinary workbook activation quiet until it is upgraded.
                    if ((error.status === 404 || error.statusCode === 404) && client === this._cloud && captured === access(this)) {
                        return this.ctMtlCapabilities = { enabled: false, configured: false, unsupported: true };
                    }
                    return null; /* Generation exposes an actionable connection failure on demand. */
                }
            },
            async ctMtlActivate(ctx = this.ctContext()) {
                const run = this._ctMtlRun = {}, store = this.ctMtlStorage(ctx);
                const current = () => this._ctMtlRun === run && this.ctCurrent(ctx) && this.ctActive;
                try {
                    const [candidates, metadata, generations] = await Promise.all([store.list(ctx.scope), this.ctStorage(ctx.scope).getMetadata(ctx.scope), store.getGenerations(ctx.scope)]);
                    if (!current()) return false;
                    this._ctMtlDescriptors = raw(copy(metadata?.descriptors || this.ctWorkspace?.metadata?.descriptors
                        || this.activeContentGroup?.assets?.map(asset => ({ ...asset, ...asset.descriptor })) || []));
                    this.ctMtlCandidates = raw(candidates); this.ctMtlGenerations = raw(generations); this.ctMtlRevision++;
                    if(permissions(this,ctx))await this.ctMtlRefreshDismissals(ctx,current);
                    await this.ctMtlLoadReviews(this.ctCurrentUnit, ctx); if (!current()) return false;
                    if (!String(ctx.scope.groupId).startsWith('local:')) {
                        const capabilities = await this.ctMtlLoadCapabilities();
                        if (!current()) return false;
                        if (capabilities?.unsupported) return true;
                    }
                    if (this.ctMtlEnsureSync(ctx)) {
                        await this.ctMtlSync(ctx);
                    }
                    return current();
                } catch (error) { if (current() && !error.stale) this.ctMtlError = error.message; return false; }
            },
            async ctMtlSync(ctx = this.ctContext()) {
                const sync = this._ctMtlSync;
                if (!sync || !this.ctCurrent(ctx)) return;
                if (this._ctMtlSyncRun?.sync === sync) return this._ctMtlSyncRun.promise;
                const operation = (async () => {
                    try {
                        await sync.flush(); if (!this.ctCurrent(ctx) || this._ctMtlSync !== sync) return;
                        await sync.pull(); if (!this.ctCurrent(ctx) || this._ctMtlSync !== sync) return;
                        const candidates = await this.ctMtlStorage(ctx).list(ctx.scope);
                        if (!this.ctCurrent(ctx) || this._ctMtlSync !== sync) return;
                        if (JSON.stringify(candidates) !== JSON.stringify(this.ctMtlCandidates)) { this.ctMtlCandidates = raw(candidates); this.ctMtlRevision++; }
                        const store = this.ctMtlStorage(ctx);
                        for (const generation of this.ctMtlGenerations.filter(value => ['pending', 'uncertain'].includes(value.status)))
                            if (candidates.some(candidate => candidate.requestId === generation.requestId)) await store.putGeneration(ctx.scope, {requestId:generation.requestId,status:'completed'});
                        const generations = await store.getGenerations(ctx.scope);
                        if (!this.ctCurrent(ctx) || this._ctMtlSync !== sync) return;
                        this.ctMtlGenerations = raw(generations);
                        const state=sync.snapshot();
                        if (this.ctMtlError === this._ctMtlSyncError) this.ctMtlError = state.error;
                        this._ctMtlSyncError = state.error;
                    } catch (error) { if (this.ctCurrent(ctx) && this._ctMtlSync === sync && !error.stale) this.ctMtlError = this._ctMtlSyncError = error.message; }
                    finally {if(this.ctCurrent(ctx)&&this._ctMtlSync===sync)await this.ctMtlRefreshDismissals(ctx).catch(()=>{});}
                })();
                const run = this._ctMtlSyncRun = { sync, promise: operation };
                try { await operation; } finally { if (this._ctMtlSyncRun === run) this._ctMtlSyncRun = null; }
            },
            ctMtlDescriptor(unit = this.ctCurrentUnit) {
                const descriptor = this._ctMtlDescriptors?.find(value => value.role === unit?.role);
                return descriptor ? { ...descriptor, role: unit.role, unitId: unit.id } : null;
            },
            ctMtlApplicable(candidate, field, unit = this.ctCurrentUnit) {
                return !!this.ctActive && !!unit?.fields.includes(field) && candidate?.unitId === unit.id
                    && M.applicable(candidate, field, this.ctMtlDescriptor(unit));
            },
            ctMtlPendingCandidate(field, unit = this.ctCurrentUnit) {
                return this.ctMtlCandidates.filter(candidate => this.ctMtlApplicable(candidate, field, unit))
                    .sort((a, b) => b.createdAt - a.createdAt || b.revision - a.revision || b.id.localeCompare(a.id))[0] || null;
            },
            ctMtlCandidate(field) {
                const candidate = this.ctMtlPendingCandidate(field); if (!candidate) return null;
                const review = this.ctMtlReviews[key(this.ctSelection, field.id)];
                if(this.ctMtlAccepted(field))return null;
                if (review?.candidateId === candidate.id && (review.acceptedDraft || review.suppressed)
                    || this._ctMtlSuppressed?.has(candidate.id)) return null;
                if (review && review.candidateId !== candidate.id && review.rawSourceHash===candidate.rawSourceHash&&review.dirty) return null;
                const generation = this.ctMtlGenerations.find(value=>value.requestId===candidate.requestId);
                if (!(review?.candidateId === candidate.id && (review.opened || review.dirty))
                    && (generation?.suppressed || candidate.baseTargetHash !== S.hash(String(this.ctValues[field.id] ?? '')))) return null;
                return candidate;
            },
            ctMtlFieldValue(field) {
                const candidate = this.ctMtlCandidate(field), review = this.ctMtlReviews[key(this.ctSelection, field.id)];
                return candidate ? review?.candidateId === candidate.id ? review.text : candidate.generatedText : String(this.ctValues[field.id] ?? '');
            },
            ctMtlAccepted(field) {
                return this.ctMtlAcceptedDraftField(field,this.ctCurrentUnit);
            },
            ctMtlAcceptedDraftField(field,unit) {
                if(!unit?.fields.includes(field))return false;
                const review=this.ctMtlReviews[key(unit.id,field?.id)],candidate=this.ctMtlCandidates.find(value=>value.id===review?.candidateId),descriptor=this.ctMtlDescriptor(unit);
                return !!field&&!!review?.acceptedDraft&&review.rawSourceHash===M.rawSourceHash(field.source)
                    &&candidate?.unitId===unit.id&&candidate.fieldId===field.id&&candidate.rawSourceHash===review.rawSourceHash
                    &&candidate.sourceHash===S.sourceHash(field.source)&&candidate.role===unit.role&&candidate.assetHash===descriptor?.assetHash
                    &&candidate.parserVersion===descriptor?.parserVersion
                    &&!!this._ctMtlAcceptanceClaims?.[unit.id]?.some(claim=>claim.fieldId===field.id&&claim.candidateId===review.candidateId
                        &&claim.rawSourceHash===review.rawSourceHash);
            },
            ctMtlAcceptedDraftFields() {
                const result=[];
                for(const [unitId,claims] of Object.entries(this._ctMtlAcceptanceClaims||{})){
                    const unit=this._ctUnitIndex?.get(unitId);if(!unit)continue;
                    for(const claim of claims){const field=unit.fields.find(field=>field.id===claim.fieldId);
                        if(field&&this.ctMtlAcceptedDraftField(field,unit))result.push({unit,field});}
                }
                return result;
            },
            ctMtlBusy(field) { return !!this.ctMtlRequests[key(this.ctSelection, field?.id)]; },
            ctMtlReviewFocus(field, event) {
                // Review actions can remove their own buttons. Return focus to
                // the stable field first, including for keyboard activation.
                const button = event.target?.closest?.('button');
                if (button && root.document?.activeElement === button && this.ctCurrentUnit?.fields.includes(field))
                    this.ctDictionaryTarget?.(field.id)?.focus?.({ preventScroll: true });
            },
            ctMtlHint(field) {
                if (this.ctMtlBusy(field)) return 'Generating MTL for this field';
                if(this.ctMtlDismissBusyFor(field)||this.ctMtlPendingDismissal(field))return 'Finish the pending dismissal upload before requesting another translation.';
                if (this.ctMtlPendingGeneration(field)) return 'Check the pending MTL request';
                if (this.ctMtlAccepted(field)) return 'Save the accepted translation before generating another MTL.';
                if (!M.eligible(field)) return 'MTL is available for nonblank text and grammatical-form fields.';
                if (!this.ctMtlCapabilities?.enabled) return 'MTL is not connected. Review MTL settings.';
                if(!this.ctMtlArchiveSupported())return 'The server needs an MTL review-archive upgrade before new translations can be requested.';
                if (!permissions(this, this.ctContext())) return 'MTL requires access to this language.';
                return 'MTL · Translate this field' + (this.mtlShortcut === 'f8' ? ' (F8)' : this.mtlShortcut === 'ctrl-alt-f8' ? ' (Ctrl+Alt+F8)' : '');
            },
            ctMtlCanGenerate(field) {
                return this.ctActive && !this.ctBusy && !this.ctHistoryViewer && this.ctCurrentUnit?.fields.includes(field)
                    && M.eligible(field) && !this.ctMtlBusy(field) && permissions(this, this.ctContext())
                    && !this.ctMtlAccepted(field)&&!this.ctMtlDismissBusyFor(field)&&!this.ctMtlPendingDismissal(field)
                    && (this.ctMtlCapabilities === null || this.ctMtlCapabilities?.enabled === true || !!this.ctMtlPendingGeneration(field));
            },
            ctMtlUnderlyingEdited(field) {
                const mutations = this._ctMtlEditMutations ||= raw(new Map()), name = key(this.ctSelection, field.id);
                mutations.set(name, (mutations.get(name) || 0) + 1);
                const pending = this.ctMtlPendingGeneration(field);
                if (pending && !pending.suppressed) {
                    pending.suppressed = true;
                    const ctx = this.ctContext();
                    Promise.resolve().then(()=>this.ctMtlStorage(ctx).putGeneration(ctx.scope, { requestId: pending.requestId, suppressed: true }))
                        .catch(error => { if (this.ctCurrent(ctx)) this.ctMtlError = error.message; });
                }
            },
            ctMtlEdited(field, text) {
                const candidate = this.ctMtlCandidate(field); if (!candidate) return false;
                this.ctMtlUnderlyingEdited(field);
                const name = key(this.ctSelection, field.id), before = this.ctMtlReviews[name];
                const review = { ...(before?.candidateId === candidate.id ? before : {}), candidateId: candidate.id,
                    candidateRevision: candidate.revision, rawSourceHash: candidate.rawSourceHash, text: String(text), dirty: true, acceptedDraft: false };
                this.ctMtlReviews = { ...this.ctMtlReviews, [name]: review }; this.ctMtlRevision++;
                this.ctMtlPersistReview(this.ctContext(), this.ctSelection, field.id, review);
                return true;
            },
            ctMtlPersistReview(ctx, unitId, fieldId, review) {
                const store = this.ctMtlStorage(ctx), queues = this._ctMtlReviewQueues ||= raw(new Map()), name = key(unitId, fieldId);
                const snapshot = copy(review), current = () => this.ctCurrent(ctx);
                let head = queues.get(name);
                if (!head) { head = { revision: review.revision || this.ctMtlReviews[name]?.revision || null, queue: Promise.resolve(), editRevision:0, recoveries:new Map() }; queues.set(name, head); }
                head.recoveries ||= new Map();head.editRevision=(head.editRevision||0)+1;
                const binding=JSON.stringify([review.candidateId,review.rawSourceHash]),editRevision=head.editRevision;
                if(!head.recoveries.has(binding))head.recoveries.set(binding,id());
                const recoveryId=head.recoveries.get(binding);
                const operation = head.queue.catch(() => {}).then(async () => {
                    const saved = await store.putReview(ctx.scope, unitId, fieldId, snapshot, { expectedRevision: head.revision });
                    head.revision = saved.revision;
                    if(current()){
                        this._ctMtlStoredReviews ||= raw(new Map());this._ctMtlStoredReviews.set(name,copy(saved));
                    }
                    if (current() && this.ctMtlReviews[name] === review) this.ctMtlReviews = { ...this.ctMtlReviews, [name]: { ...review, revision: saved.revision } };
                    return saved;
                }).catch(async error=>{
                    if(error.code==='MTL_REVIEW_CHANGED'){
                        try{
                            const recovery=await store.archiveReview(ctx.scope,unitId,fieldId,snapshot,{recoveryId,editRevision,reason:'review-conflict'});
                            if(current()){
                                this.ctMtlRecoveries=raw([...this.ctMtlRecoveries.filter(value=>value.recoveryId!==recovery.recoveryId),recovery]);this.ctMtlRevision++;
                            }
                        }catch(recoveryError){
                            if(current())this.ctMtlError=error.message+' This edit could not be archived: '+recoveryError.message;
                            error.recoveryError=recoveryError;
                        }
                    }
                    throw error;
                });
                head.queue = operation;
                operation.catch(error => { if (current()&&!error.recoveryError) this.ctMtlError = error.code==='MTL_REVIEW_CHANGED'
                    ? 'This MTL review changed in another tab. Your edit is retained; use Recover my review to restore it.' : error.message; });
                return operation;
            },
            async ctMtlLoadReviews(unit = this.ctCurrentUnit, ctx = this.ctContext()) {
                if (!unit || !this.ctCurrent(ctx)) return;
                const store = this.ctMtlStorage(ctx), run = this._ctMtlReviewLoadRun = {};
                const [reviews,archives] = await Promise.all([Promise.all(unit.fields.map(async field => [key(unit.id, field.id), await store.getReview(ctx.scope, unit.id, field.id)])),
                    store.listReviews(ctx.scope,{unitId:unit.id,includeArchived:true})]);
                if (!this.ctCurrent(ctx) || this.ctCurrentUnit !== unit || this._ctMtlReviewLoadRun !== run) return;
                const next = { ...this.ctMtlReviews };
                this._ctMtlStoredReviews ||= raw(new Map());
                for (const [name, review] of reviews) if(review){this._ctMtlStoredReviews.set(name,copy(review));if(!next[name]?.dirty)next[name]=review;}
                this.ctMtlReviews = next;
                this.ctMtlRecoveries=raw([...this.ctMtlRecoveries.filter(value=>value.unitId!==unit.id),...archives.filter(value=>value.reason==='review-conflict'&&value.recoveryId)]);
                this.ctMtlRevision++;
            },
            ctMtlRecoveryReviews(field) {
                this.ctMtlRevision;
                const unit=this.ctCurrentUnit,candidate=this.ctMtlPendingCandidate(field),stored=this._ctMtlStoredReviews?.get(key(unit?.id,field?.id));
                if(!candidate||this.ctMtlAccepted(field))return [];
                return this.ctMtlRecoveries.filter(value=>value.unitId===unit?.id&&value.fieldId===field?.id&&value.candidateId===candidate.id
                    &&value.rawSourceHash===candidate.rawSourceHash&&value.candidateRevision<=candidate.revision
                    &&!(stored?.candidateId===value.candidateId&&stored?.rawSourceHash===value.rawSourceHash&&stored?.text===value.text))
                    .sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)||b.editRevision-a.editRevision);
            },
            async ctMtlRecoverReview(field) {
                const recovery=this.ctMtlRecoveryReviews(field)[0],ctx=this.ctContext(),unit=this.ctCurrentUnit,candidate=this.ctMtlPendingCandidate(field);
                if(!recovery||!candidate||this.ctBusy||this.ctHistoryViewer||this.ctMtlBusy(field)||!permissions(this,ctx))return false;
                const run=this._ctMtlRecoveryRun={},capturedAccess=access(this),name=key(unit.id,field.id),
                    mutation=this._ctMtlEditMutations?.get(name)||0,value=this.ctMtlFieldValue(field),store=this.ctMtlStorage(ctx);
                const current=()=>this._ctMtlRecoveryRun===run&&this.ctCurrent(ctx)&&this.ctCurrentUnit===unit&&access(this)===capturedAccess
                    &&permissions(this,ctx)&&!this.ctMtlBusy(field)&&this.ctMtlPendingCandidate(field)?.id===candidate.id&&this.ctMtlPendingCandidate(field)?.revision===candidate.revision
                    &&M.rawSourceHash(field.source)===recovery.rawSourceHash&&(this._ctMtlEditMutations?.get(name)||0)===mutation
                    &&this.ctMtlFieldValue(field)===value;
                try{
                    await this._ctMtlReviewQueues?.get(name)?.queue.catch(()=>{});if(!current())return false;
                    const peer=await store.getReview(ctx.scope,unit.id,field.id);if(!current())return false;
                    const review={...copy(recovery),candidateRevision:candidate.revision,revision:peer?.revision||undefined,
                        acceptedDraft:false,suppressed:false,opened:true,dirty:true};
                    for(const property of ['recoveryId','editRevision','reason','archived','signature'])delete review[property];
                    const queues=this._ctMtlReviewQueues ||= raw(new Map());
                    let head=queues.get(name);if(!head){head={queue:Promise.resolve(),editRevision:0,recoveries:new Map()};queues.set(name,head);}
                    head.revision=peer?.revision||null;
                    const saved=await this.ctMtlPersistReview(ctx,unit.id,field.id,review);if(!current())return false;
                    this._ctMtlSuppressed?.delete(candidate.id);this.ctMtlReviews={...this.ctMtlReviews,[name]:{...review,...saved}};
                    if(this._ctMtlAcceptanceClaims?.[unit.id])this._ctMtlAcceptanceClaims[unit.id]=this._ctMtlAcceptanceClaims[unit.id].filter(claim=>claim.fieldId!==field.id);
                    this.ctMtlRevision++;this.ctMtlClearOperationError();return true;
                }catch(error){if(current()&&!error.recoveryError)this.ctMtlError=error.code==='MTL_REVIEW_CHANGED'
                    ?'This MTL review changed again. Both reviews are retained; use Recover my review when ready.':error.message;return false;}
            },
            ctMtlRestoreAcceptances(draft) {
                const claims = draft?.mtlAcceptances || [], unit = this.ctCurrentUnit; if (!unit) return;
                this._ctMtlAcceptanceClaims ||= {};
                this._ctMtlAcceptanceClaims[unit.id] = copy(claims);
                const reviews = { ...this.ctMtlReviews };
                for (const field of unit.fields) {
                    const name = key(unit.id, field.id), review = reviews[name]; if (!review) continue;
                    const claim = claims.find(value => value.fieldId === field.id && value.candidateId === review.candidateId
                        && value.rawSourceHash === M.rawSourceHash(field.source) && value.reviewedTextHash === S.hash(this.ctValues[field.id]));
                    reviews[name] = { ...review, acceptedDraft: !!claim };
                }
                this.ctMtlReviews = reviews; this.ctMtlRevision++;
            },
            async ctMtlShow(field) {
                const candidate = this.ctMtlPendingCandidate(field); if (!candidate || this.ctBusy||this.ctHistoryViewer||this.ctMtlBusy(field)||this.ctMtlDismissBusyFor(field)) return false;
                const ctx = this.ctContext(), name = key(this.ctSelection, field.id), before = this.ctMtlReviews[name];
                if (this.ctMtlAccepted(field)) return false;
                // An edited older generation remains recoverable. Opening a new generation is an explicit action.
                const checkpoint = before ? copy(before) : undefined; if (checkpoint) delete checkpoint.previousReview;
                const review = { ...(before?.candidateId === candidate.id ? before : { previousReview: checkpoint, revision: before?.revision }),
                    candidateId: candidate.id, candidateRevision: candidate.revision, rawSourceHash: candidate.rawSourceHash,
                    text: before?.candidateId === candidate.id ? before.text : candidate.generatedText, suppressed: false, acceptedDraft: false, opened: true };
                this._ctMtlSuppressed?.delete(candidate.id); this.ctMtlReviews = { ...this.ctMtlReviews, [name]: review }; this.ctMtlRevision++;
                await this.ctMtlPersistReview(ctx, this.ctSelection, field.id, review); return true;
            },
            async ctMtlAccept(field) {
                const candidate = this.ctMtlCandidate(field); if (!candidate || this.ctBusy||this.ctHistoryViewer || this.ctMtlBusy(field)||this.ctMtlDismissBusyFor(field) || !permissions(this, this.ctContext())) return false;
                const ctx = this.ctContext(), unit = this.ctCurrentUnit, name = key(unit.id, field.id), text = this.ctMtlFieldValue(field), check = M.validate(field, text);
                if (!check.valid) { this.ctMtlError = check.errors[0]?.message || 'Review the MTL translation before accepting it.'; return false; }
                const old = this.ctMtlReviews[name], previous = String(this.ctValues[field.id] ?? ''), mutation = this._ctMtlEditMutations?.get(name) || 0,
                    capturedAccess = access(this), review = { ...(old || {}), candidateId: candidate.id, candidateRevision: candidate.revision,
                    rawSourceHash: candidate.rawSourceHash, text, acceptedDraft: true, suppressed: false,
                    previousValue: old?.previousValue ?? String(this.ctValues[field.id] ?? ''),
                    previousDraft: old?.previousDraft || { values: copy(this.ctValues), reviewed: copy(this.ctReviewed), dirty: !!this.ctDraftDirty } };
                try {
                    await this.ctMtlPersistReview(ctx, unit.id, field.id, review);
                    if (!this.ctCurrent(ctx) || this.ctCurrentUnit !== unit || this.ctMtlBusy(field)||this.ctMtlDismissBusyFor(field) || this.ctMtlCandidate(field)?.id !== candidate.id
                        || this.ctMtlFieldValue(field) !== text || String(this.ctValues[field.id] ?? '') !== previous
                        || (this._ctMtlEditMutations?.get(name) || 0) !== mutation || capturedAccess !== access(this) || !permissions(this, ctx)) return false;
                    this.ctMtlReviews = { ...this.ctMtlReviews, [name]: review }; this.ctMtlRevision++;
                    this.ctValues[field.id] = text;
                    this._ctMtlAcceptanceClaims ||= {}; this._ctMtlAcceptanceClaims[unit.id] = [...(this._ctMtlAcceptanceClaims[unit.id] || [])
                        .filter(claim => claim.fieldId !== field.id), M.acceptance(candidate, text)];
                    this.ctEdited(field); this.ctCloseCompletion?.(); this.ctMtlClearOperationError(); return true;
                } catch (error) { if (this.ctCurrent(ctx)) this.ctMtlError = error.message; return false; }
            },
            ctMtlAcceptances(unitId = this.ctSelection, values = this.ctValues) {
                const unit = this._ctUnitIndex?.get(unitId); if (!unit) return [];
                return (this._ctMtlAcceptanceClaims?.[unitId] || []).map(claim => {
                    const candidate = this.ctMtlCandidates.find(candidate => candidate.id === claim.candidateId), field = unit.fields.find(field => field.id === claim.fieldId);
                    if (!candidate || !this.ctMtlApplicable(candidate, field, unit)) throw M.changed();
                    return M.acceptance(candidate, values[field.id]);
                });
            },
            ctMtlAcceptancesForSave(unitId, values) { return this.ctMtlAcceptances(unitId, values); },
            ctMtlCheckpointAcceptances(unitId=this.ctSelection,values=this.ctValues) {
                return (this._ctMtlAcceptanceClaims?.[unitId]||[]).map(claim=>({...copy(claim),reviewedTextHash:S.hash(String(values[claim.fieldId]??''))}));
            },
            async ctMtlUndoAccept(field) {
                const ctx = this.ctContext(), unit = this.ctCurrentUnit, name = key(unit?.id,field?.id), before = this.ctMtlReviews[name],
                    candidate = this.ctMtlCandidates.find(value=>value.id===before?.candidateId), capturedAccess = access(this),descriptor=this.ctMtlDescriptor(unit);
                if (!this.ctMtlAccepted(field) || this.ctBusy||this.ctHistoryViewer || this.ctMtlBusy(field) || !permissions(this,ctx) || !candidate || typeof before.previousValue !== 'string'
                    ||candidate.unitId!==unit.id||candidate.fieldId!==field.id||candidate.rawSourceHash!==M.rawSourceHash(field.source)
                    ||candidate.assetHash!==descriptor?.assetHash||candidate.parserVersion!==descriptor?.parserVersion) return false;
                const text = String(this.ctValues[field.id] ?? ''), mutation = this._ctMtlEditMutations?.get(name) || 0,
                    review = {...before,text,dirty:true,acceptedDraft:false,suppressed:false,opened:true};
                try {
                    await this.ctMtlPersistReview(ctx,unit.id,field.id,review);
                    if (!this.ctCurrent(ctx) || this.ctCurrentUnit !== unit || this.ctMtlBusy(field) || this.ctMtlReviews[name] !== before
                        || String(this.ctValues[field.id] ?? '') !== text || (this._ctMtlEditMutations?.get(name) || 0) !== mutation
                        || capturedAccess !== access(this) || !permissions(this,ctx)) return false;
                    this.ctMtlReviews = {...this.ctMtlReviews,[name]:review};
                    this.ctValues[field.id] = before.previousValue;
                    if (Object.prototype.hasOwnProperty.call(before.previousDraft?.reviewed || {},field.id)) this.ctReviewed[field.id] = before.previousDraft.reviewed[field.id];
                    else delete this.ctReviewed[field.id];
                    this._ctMtlAcceptanceClaims[unit.id] = (this._ctMtlAcceptanceClaims[unit.id] || []).filter(claim=>claim.fieldId!==field.id);
                    this.ctMtlRevision++;this.ctDraftDirty=true;this.ctQueueDraft?.();this.ctCloseCompletion?.();this.ctMtlClearOperationError();return true;
                } catch(error) { if(this.ctCurrent(ctx))this.ctMtlError=error.message;return false; }
            },
            ctMtlUnderlyingReplaced(unit = this.ctCurrentUnit) {
                if (!unit || unit !== this.ctCurrentUnit || unit.fields.some(field=>this.ctMtlBusy(field))) return;
                const ctx = this.ctContext();this._ctMtlAcceptanceClaims ||= {};delete this._ctMtlAcceptanceClaims[unit.id];
                this._ctMtlSuppressed ||= raw(new Set());const reviews={...this.ctMtlReviews};
                for(const field of unit.fields){
                    this.ctMtlUnderlyingEdited(field);
                    const candidate=this.ctMtlPendingCandidate(field,unit);if(!candidate)continue;
                    const name=key(unit.id,field.id),before=reviews[name],review={...(before?.candidateId===candidate.id?before:{}),
                        candidateId:candidate.id,candidateRevision:candidate.revision,rawSourceHash:candidate.rawSourceHash,
                        text:before?.candidateId===candidate.id?before.text:candidate.generatedText,acceptedDraft:false,suppressed:true};
                    this._ctMtlSuppressed.add(candidate.id);reviews[name]=review;this.ctMtlPersistReview(ctx,unit.id,field.id,review);
                }
                this.ctMtlReviews=reviews;this.ctMtlRevision++;
            },
            async ctMtlSaved(ctx, unitId) {
                if (!this.ctCurrent(ctx)) return;
                if (this._ctMtlAcceptanceClaims) delete this._ctMtlAcceptanceClaims[unitId];
                this.ctMtlRevision++;
                const candidates = await this.ctMtlStorage(ctx).list(ctx.scope); if (!this.ctCurrent(ctx)) return;
                this.ctMtlCandidates = raw(candidates); this.ctMtlRevision++;
            },
            async ctMtlDismiss(field) {
                const candidate = this.ctMtlPendingCandidate(field), ctx = this.ctContext();
                if (!candidate || this.ctBusy||this.ctHistoryViewer || this.ctMtlBusy(field)||this.ctMtlDismissBusyFor(field)||this.ctMtlPendingDismissal(field) || !permissions(this, ctx)) return false;
                if (this.ctMtlAccepted(field)) return false;
                if(!this.ctMtlArchiveSupported()){this.ctMtlError='The server needs an MTL review-archive upgrade before this suggestion can be dismissed.';return false;}
                if(this.mtlConsentVersion!=='mtl-v2'){this.ctMtlError='Review and enable the updated MTL data-sharing and private review-retention choice in MTL settings first.';return false;}
                const name=key(candidate.unitId,field.id),mutationId=id(),client=this._cloud,capturedAccess=access(this),unit=this.ctCurrentUnit,
                    current=()=>this.ctCurrent(ctx)&&this.ctActive&&client===this._cloud&&capturedAccess===access(this)&&permissions(this,ctx)&&this.mtlConsentVersion==='mtl-v2',
                    review=this.ctMtlReviews[name],options={mutationId,archiveRequired:true,consentVersion:'mtl-v2',guard:()=>current()&&this.ctMtlApplicable(candidate,field,unit)&&!this.ctMtlBusy(field)};
                if(review?.candidateId===candidate.id&&review.text!==candidate.generatedText)options.reviewedText=review.text;
                this.ctMtlDismissBusy={...this.ctMtlDismissBusy,[name]:mutationId};
                try {
                    await this.ctMtlStorage(ctx).dismiss(ctx.scope, candidate, options);
                    if (!current()) return false;
                    await this.ctMtlRefreshDismissals(ctx,current);await this.ctMtlRefreshCandidates(ctx,current);if(!current())return false;
                    const reviews = { ...this.ctMtlReviews }; delete reviews[name]; this.ctMtlReviews = reviews;
                    if (this._ctMtlAcceptanceClaims?.[candidate.unitId]) this._ctMtlAcceptanceClaims[candidate.unitId] = this._ctMtlAcceptanceClaims[candidate.unitId].filter(claim => claim.fieldId !== field.id);
                    this.ctMtlRevision++; this.ctMtlClearOperationError();this.ctMtlEnsureSync(ctx);this.ctMtlSync(ctx);return true;
                } catch (error) { if (current()&&!error.stale) this.ctMtlError = error.message; return false; }
                finally {if(this.ctMtlDismissBusy[name]===mutationId){const busy={...this.ctMtlDismissBusy};delete busy[name];this.ctMtlDismissBusy=busy;}}
            },
            async ctMtlRetryDismissals(operation) {
                const ctx=this.ctContext();if(!permissions(this,ctx)||!this.ctActive||this.ctBusy)return false;
                const sync=this.ctMtlEnsureSync(ctx);if(!sync)return false;
                const client=this._cloud,capturedAccess=access(this),current=()=>this.ctCurrent(ctx)&&permissions(this,ctx)&&client===this._cloud&&capturedAccess===access(this)&&this._ctMtlSync===sync;
                try {
                    for(const value of operation?[operation]:this.ctMtlDismissals)if(value.state==='conflict')
                        await this.ctMtlStorage(ctx).markSending(ctx.scope,value.mutationId,'pending',{guard:current});
                    if(!current())return false;await this.ctMtlSync(ctx);return current();
                }catch(error){if(this.ctCurrent(ctx)&&!error.stale)this.ctMtlError=error.message;return false;}
            },
            ctMtlCommittedGlossary(ctx = this.ctContext()) {
                const state = this._cloud?.state, profile = state?.profiles?.[state.activeProfile];
                if (!profile || String(state.activeProfile) !== String(ctx.scope.accountId)) return [];
                return copy(profile.dictionaries?.[ctx.scope.language]?.base?.entries || []);
            },
            ctMtlPendingGeneration(field, unit = this.ctCurrentUnit) {
                const descriptor = this.ctMtlDescriptor(unit);
                if (!unit || !field || !descriptor) return null;
                return this.ctMtlGenerations.find(value => ['pending', 'uncertain'].includes(value.status)
                    && value.unitId === unit?.id && value.fieldId === field?.id && value.rawSourceHash === M.rawSourceHash(field.source)
                    && value.assetHash === descriptor?.assetHash && value.parserVersion === descriptor?.parserVersion) || null;
            },
            async ctMtlAdoptCandidate(ctx, unit, field, input, generation, current, changed) {
                let candidate;
                try { candidate = M.normalizeCandidate(input); }
                catch (_) { throw Object.assign(new Error('The MTL response is invalid. The existing text is unchanged.'), {code:'MTL_INVALID_RESPONSE'}); }
                const descriptor = this.ctMtlDescriptor(unit);
                if (candidate.requestId !== generation.requestId || candidate.unitId !== unit.id || !M.applicable(candidate, field, descriptor)
                    || candidate.baseTargetHash !== generation.baseTargetHash || !M.validate(field, candidate.generatedText).valid)
                    throw Object.assign(new Error('The MTL response does not match this field or its protected tokens.'), { code: 'MTL_INVALID_RESPONSE' });
                const store = this.ctMtlStorage(ctx); await store.putCandidate(ctx.scope, candidate);
                if (!current()) throw stale();
                if (generation.suppressed || changed() || this.ctSelection === unit.id && S.hash(String(this.ctValues[field.id] ?? '')) !== generation.baseTargetHash) {
                    const name = key(unit.id, field.id), old = this.ctMtlReviews[name], review = { candidateId: candidate.id,
                        candidateRevision: candidate.revision, rawSourceHash: candidate.rawSourceHash, text: candidate.generatedText, suppressed: true, acceptedDraft: false };
                    this._ctMtlSuppressed ||= raw(new Set()); this._ctMtlSuppressed.add(candidate.id);
                    if (!old?.dirty) {
                        await this.ctMtlPersistReview(ctx, unit.id, field.id, review); if (!current()) throw stale();
                        this.ctMtlReviews = { ...this.ctMtlReviews, [name]: review };
                    }
                }
                await store.putGeneration(ctx.scope, { requestId:generation.requestId, status:'completed' });
                const [candidates, generations] = await Promise.all([store.list(ctx.scope), store.getGenerations(ctx.scope)]);
                if (!current()) throw stale();
                this.ctMtlCandidates = raw(candidates); this.ctMtlGenerations = raw(generations); this.ctMtlRevision++; this.ctMtlClearOperationError(); return true;
            },
            async ctMtlRecover(field, generation = this.ctMtlPendingGeneration(field)) {
                const ctx = this.ctContext(), unit = this.ctCurrentUnit;
                if (!generation || !unit?.fields.includes(field) || !permissions(this, ctx) || this.ctMtlBusy(field)) return false;
                const client = this._cloud, capturedAccess = access(this), controller = new AbortController(), name = key(unit.id,field.id),
                    jobs = this._ctMtlJobs ||= raw(new Map()), job = { requestId:generation.requestId, controller, name, startedAt:Date.now(), client, scope:copy(ctx.scope) },
                    mutation = this._ctMtlEditMutations?.get(name) || 0;
                jobs.set(name,job); this.ctMtlNoteRequest(unit);this.ctMtlFocusBeforeRequest(field);this.ctMtlRequests = {...this.ctMtlRequests,[name]:generation.requestId};
                const current = () => jobs.get(name) === job && !controller.signal.aborted && this.ctCurrent(ctx) && this.ctActive
                    && client === this._cloud && capturedAccess === access(this) && permissions(this,ctx)
                    && this._ctUnitIndex?.get(unit.id) === unit && M.rawSourceHash(field.source) === generation.rawSourceHash;
                job.current = current;
                this.ctMtlProgressUpdate(job, { phase:'waiting', text:'' });
                try {
                    let response = await client.request('/v1/mtl/requests/' + encodeURIComponent(generation.requestId), {signal:controller.signal});
                    if (!current()) throw stale();
                    if (this.ctMtlCapabilities?.delivery === 'poll-v1' && !response.candidate) response = await this.ctMtlPoll(job, response);
                    if (response.candidate) return await this.ctMtlAdoptCandidate(ctx,unit,field,response.candidate,generation,current,
                        () => job.cancelledByUser || (this._ctMtlEditMutations?.get(name) || 0) !== mutation);
                    const status = response.request?.status || response.job?.status || response.status;
                    if (['failed','cancelled','expired','interrupted'].includes(status) || response.errorCode === 'MTL_RESULT_EXPIRED') {
                        await this.ctMtlStorage(ctx).putGeneration(ctx.scope,{requestId:generation.requestId,status:'failed'});
                        if (!current()) throw stale();
                        this.ctMtlGenerations = raw(await this.ctMtlStorage(ctx).getGenerations(ctx.scope));
                        if (!current()) throw stale();
                        this.ctMtlError = failureText(response.errorCode || response.request?.error?.code) || response.request?.error?.message || response.error?.message || 'The earlier MTL request ended without a translation. Generate again when ready.';
                        return false;
                    }
                    this.ctMtlError = 'The earlier MTL request is still pending. Check it again shortly.'; return false;
                } catch (error) {
                    if (current() && !error.stale && error.name !== 'AbortError') {
                        if (error.mtlFinal || error.status === 404 || error.statusCode === 404 || ['MTL_INVALID_RESPONSE','REVISION_CONFLICT'].includes(error.code)) {
                            await this.ctMtlStorage(ctx).putGeneration(ctx.scope,{requestId:generation.requestId,status:'failed'});
                            if (!current()) return false;
                            this.ctMtlGenerations = raw(await this.ctMtlStorage(ctx).getGenerations(ctx.scope));
                            if (!current()) return false;
                            this.ctMtlError = error.mtlFinal || ['MTL_INVALID_RESPONSE','REVISION_CONFLICT'].includes(error.code) ? error.message : 'The earlier MTL request did not start. Generate again when ready.';
                        } else this.ctMtlError = error.message;
                    }
                    return false;
                } finally {
                    this.ctMtlProgressClear(job);
                    if (jobs.get(name) === job) jobs.delete(name);
                    if (this.ctMtlRequests[name] === generation.requestId) { const requests = {...this.ctMtlRequests}; delete requests[name]; this.ctMtlRequests = requests; }
                }
            },
            ctMtlBuildContext(field,unit=this.ctCurrentUnit,ctx=this.ctContext()) {
                return Context.create({ unit, field, units: this.ctUnits, npcIndex: this._ctNpcIndex, convoIndex: this._ctConvoIndex,
                    skillResolver: this.ctSkillResolver, dictionary: this.ctMtlCommittedGlossary(ctx), saved: this.ctSaved, scope: ctx.scope,
                    ...(this.ctToneNotesSnapshot?{toneNotes:this.ctToneNotesSnapshot(root.ClientTextToneNotes?.roleKeys(this,unit)||[])}: {}) });
            },
            async ctMtlGenerate(field) {
                const timing=this.ctMtlDebugTimingStart?.(field),early=outcome=>{timing?.finish(outcome);return false;};
                const ctx = this.ctContext();
                if (this.ctMtlCapabilities === null && this.ctActive && this.ctCurrentUnit?.fields.includes(field) && M.eligible(field) && permissions(this,ctx)) {
                    timing?.mark('capabilitiesStart');await this.ctMtlLoadCapabilities();timing?.mark('capabilitiesEnd');if(!this.ctCurrent(ctx))return early('stale');
                    if(this.ctMtlCapabilities===null){this.ctMtlError='The MTL connection could not be checked. Review MTL settings.';return early('failed');}
                }
                if (!this.ctMtlCanGenerate(field)) { this.ctMtlError = this.ctMtlCapabilities?.enabled ? 'MTL is unavailable for this field or language.' : 'MTL is not connected. Review MTL settings.'; return early('unavailable'); }
                const pending = this.ctMtlPendingGeneration(field); if (pending) {timing?.finish('recovery');return this.ctMtlRecover(field,pending);}
                if(!this.ctMtlArchiveSupported()){this.ctMtlError='The server needs an MTL review-archive upgrade before new translations can be requested. Existing work is unchanged.';return early('unavailable');}
                if (this.mtlConsentVersion !== 'mtl-v2') { this.ctMtlError = 'Review and enable the updated MTL data-sharing and private review-retention choice in MTL settings first.'; return early('unavailable'); }
                const unit = this.ctCurrentUnit, client = this._cloud, capturedAccess = access(this), descriptor = this.ctMtlDescriptor(unit);
                if (!descriptor) { this.ctMtlError = 'The original workbook identity is unavailable. Reopen this workspace.'; return early('unavailable'); }
                const name = key(unit.id, field.id), mutations = this._ctMtlEditMutations ||= raw(new Map()), mutation = mutations.get(name) || 0,
                    previous = String(this.ctValues[field.id] ?? ''), capturedSource = M.rawSourceHash(field.source), controller = new AbortController(), requestId = id();
                const asynchronous = this.ctMtlCapabilities?.delivery === 'poll-v1',
                    job = { requestId, controller, name, startedAt:Date.now(), client, scope:copy(ctx.scope), ...(timing?{timing,fieldId:field.id}:{}) }, jobs = this._ctMtlJobs ||= raw(new Map()); jobs.set(name, job);
                if(timing)this.ctMtlDebugTimingBind?.(timing,field,requestId);
                this.ctMtlNoteRequest(unit);
                this.ctMtlFocusBeforeRequest(field);
                let sent = false, generation, confirmedFailure = false;
                this.ctMtlRequests = { ...this.ctMtlRequests, [name]: requestId };
                const current = () => jobs.get(name) === job && !controller.signal.aborted && this.ctCurrent(ctx) && this.ctActive
                    && client === this._cloud && capturedAccess === access(this) && permissions(this, ctx) && this.mtlConsentVersion === 'mtl-v2'
                    && this._ctUnitIndex?.get(unit.id) === unit && unit.fields.includes(field) && M.rawSourceHash(field.source) === capturedSource;
                job.current = current;
                this.ctMtlProgressUpdate(job, { phase:'waiting', text:'' });
                try {
                    if(this.ctToneNotesPrepare){timing?.mark('roleHintsStart');const toneKeys=root.ClientTextToneNotes?.roleKeys(this,unit)||[];timing?.mark('roleHintsEnd');
                        timing?.mark('toneNotesStart');try{await this.ctToneNotesPrepare(toneKeys,ctx);}finally{timing?.mark('toneNotesEnd');}if(!current())throw stale();}
                    timing?.mark('contextStart');let context;try{context=this.ctMtlBuildContext(field,unit,ctx);}finally{timing?.mark('contextEnd');}
                    const body = { requestId, unitId: unit.id, fieldId: field.id, role: unit.role, assetHash: descriptor.assetHash || descriptor.hash,
                        parserVersion: descriptor.parserVersion, source: field.source, sourceHash: S.sourceHash(field.source), rawSourceHash: capturedSource,
                        baseTargetHash: S.hash(previous), baseRevision: this.ctSaved[unit.id]?.serverRevision || 0, clientFacts: S.clientFacts(unit),
                        context: context.initial, consentVersion: 'mtl-v2', ...(String(ctx.scope.groupId).startsWith('local:')
                            ? { language: ctx.scope.language, game:ctx.scope.game, branchId:ctx.scope.branchId || 'default' } : {}) };
                    if (new TextEncoder().encode(JSON.stringify(body)).length > Context.LIMITS.bytes) throw new Error('This MTL source and context exceed the request size limit.');
                    let path = String(ctx.scope.groupId).startsWith('local:') ? '/v1/mtl/local/requests'
                        : '/v1/content-groups/' + encodeURIComponent(ctx.scope.groupId) + '/mtl/requests?language=' + encodeURIComponent(ctx.scope.language);
                    if (asynchronous) path += (path.includes('?') ? '&' : '?') + 'async=1';
                    const store = this.ctMtlStorage(ctx);
                    timing?.mark('pendingStoreStart');
                    try { generation = await store.putGeneration(ctx.scope,{requestId,unitId:unit.id,fieldId:field.id,rawSourceHash:capturedSource,
                        sourceHash:body.sourceHash,assetHash:body.assetHash,parserVersion:body.parserVersion,baseTargetHash:body.baseTargetHash,
                        createdAt:Date.now(),status:'pending',requestBodyHash:S.hash(body)}); } finally {timing?.mark('pendingStoreEnd');}
                    if (!current()) throw stale();
                    this.ctMtlGenerations = raw([...this.ctMtlGenerations.filter(value=>value.requestId!==requestId),generation]);
                    this.ctMtlDebugBegin?.(field, body, timing);
                    sent = true;
                    let response;
                    timing?.mark('postStart');
                    try { response = await client.request(path, { method: 'POST', body, signal: controller.signal, timeout: asynchronous ? 15000 : 190000 }); }
                    catch (error) {
                        timing?.mark('postEnd');
                        const status = error.status || error.statusCode;
                        if (!asynchronous || !current() || error.stale || status && ![408,429].includes(status) && status < 500) throw error;
                        // Admission can succeed even if the short response is lost.
                        // Poll the original ID without replaying the POST body.
                        this.ctMtlProgressUpdate(job, {phase:'reconnecting'});
                        response = await this.ctMtlPoll(job, null);
                    }
                    timing?.mark('postEnd');
                    if (!current()) throw stale();
                    if (asynchronous && !response.candidate) response = await this.ctMtlPoll(job, response);
                    timing?.mark('candidateReceived');timing?.mark('adoptionStart');
                    if(!job.cancelledByUser)this.ctMtlProgressUpdate(job, { phase:'validating' });
                    let adopted;try{adopted=await this.ctMtlAdoptCandidate(ctx,unit,field,response.candidate,generation,current,()=>job.cancelledByUser || (mutations.get(name)||0)!==mutation);}finally{timing?.mark('adoptionEnd');}
                    timing?.finish(job.cancelledByUser?'cancelled':'completed');
                    if (current()) this.ctMtlDebugFinish?.(field, requestId);
                    return adopted;
                } catch (error) {
                    if (error.mtlFinal || error.status === 422 && ['MTL_OUTPUT_INVALID', 'MTL_REFUSED'].includes(error.code)) confirmedFailure = true;
                    if((error.status||error.statusCode)===409&&['MTL_TONE_NOTES_CHANGED','MTL_TONE_NOTE_SNAPSHOT_MISMATCH'].includes(error.code)){
                        confirmedFailure=true;
                        if(current())try{await this.ctToneNotesPrepare?.(root.ClientTextToneNotes?.roleKeys(this,unit)||[],ctx);}catch(_){/* Preserve the note draft/conflict and the explicit translation failure. */}
                        error.message='Shared tone notes changed before translation started. Review Tone notes, then request translation again.';
                    }
                    // A proxy can replace a failed POST with an unreadable error
                    // page. Inspect the same job once; never repeat inference.
                    if (!asynchronous && sent && current() && ['TypeError', 'NetworkError', 'SyntaxError'].includes(error.name)) {
                        let lookupFailed = false;
                        try {
                            const status = await client.request('/v1/mtl/requests/' + encodeURIComponent(requestId), { signal: controller.signal });
                            if (!current()) throw stale();
                            if (['failed', 'cancelled', 'expired', 'interrupted'].includes(status.status)) {
                                confirmedFailure = true;
                                error = Object.assign(new Error(failureText(status.errorCode) || 'This MTL attempt ended without a usable translation. The existing text is unchanged.'), { code: status.errorCode || 'MTL_FAILED' });
                            }
                        } catch (_) { lookupFailed = true; /* Keep the original request error if its status is unavailable. */ }
                        if (!confirmedFailure && !lookupFailed) error = Object.assign(new Error('The MTL request could not be confirmed. The existing text is unchanged. Check the pending request before trying again.'), { code: 'MTL_REQUEST_UNCERTAIN' });
                    }
                    if (generation) try {
                        await this.ctMtlStorage(ctx).putGeneration(ctx.scope,{requestId,status:sent && !confirmedFailure && error.code !== 'MTL_INVALID_RESPONSE' ? 'uncertain' : 'failed'});
                        if (current()) this.ctMtlGenerations = raw(await this.ctMtlStorage(ctx).getGenerations(ctx.scope));
                    } catch (_) { /* A disposed local session has no durable job. The online reservation remains recoverable. */ }
                    timing?.finish(job.cancelledByUser||error.code==='MTL_CANCELLED'?'cancelled':error.stale?'stale':'failed');
                    if (current() && !error.stale && error.name !== 'AbortError') {
                        this.ctMtlError = error.message; this.ctMtlDebugFinish?.(field, requestId, error);
                    }
                    return false;
                }
                finally {
                    timing?.finish(job.cancelledByUser?'cancelled':controller.signal.aborted?'stale':'failed');
                    this.ctMtlProgressClear(job);
                    if (jobs.get(name) === job) jobs.delete(name);
                    if (this.ctMtlRequests[name] === requestId) { const requests = { ...this.ctMtlRequests }; delete requests[name]; this.ctMtlRequests = requests; }
                    if(timing)this.ctMtlDebugTimingFrame?.(timing,'finalFrameReady',field.id);
                }
            },
            ctMtlKey(event) {
                const shortcuts = { f8: [], 'ctrl-alt-f8': ['Control', 'Alt'] }, modifiers = shortcuts[this.mtlShortcut];
                if (!modifiers || event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229
                    || event.metaKey || event.key !== 'F8' || !!event.ctrlKey !== modifiers.includes('Control')
                    || !!event.altKey !== modifiers.includes('Alt') || !!event.shiftKey !== modifiers.includes('Shift')
                    || root.AppDialogs?.isOpen || this.ctKeyboardOverlayOpen?.() || this.ctHistoryViewer) return false;
                const fieldId = event.target?.dataset?.ctTarget, field = this.ctCurrentUnit?.fields.find(field => field.id === fieldId);
                if (!field || field.id !== this.ctFocusedField || !this.ctMtlCanGenerate(field)) return false;
                event.preventDefault(); event.stopPropagation?.(); this.ctMtlGenerate(field); return true;
            }
        }
    };
    return { mixin, permissions };
});
