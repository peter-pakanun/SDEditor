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
        data() { return { ctMtlCandidates: raw([]), ctMtlReviews: {}, ctMtlRecoveries:raw([]), ctMtlCapabilities: null, ctMtlError: '', ctMtlRequests: {}, ctMtlGenerations: raw([]), ctMtlRevision: 0 }; },
        computed: {
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
        beforeUnmount() { this.ctMtlReset(); },
        methods: {
            ctMtlReset() {
                this.ctMtlDebugReset?.();
                this._ctMtlRun = null; this._ctMtlSync?.stop?.(); this._ctMtlSync = null;
                for (const request of this._ctMtlJobs?.values() || []) request.controller.abort();
                this._ctMtlJobs = raw(new Map()); this._ctMtlEditMutations = raw(new Map()); this._ctMtlReviewQueues = raw(new Map());
                this._ctMtlStoredReviews=raw(new Map());this._ctMtlRecoveryRun=null;
                this._ctMtlDescriptors = raw([]); this._ctMtlSuppressed = raw(new Set()); this._ctMtlAcceptanceClaims = {};
                this._ctMtlSyncError='';this._ctMtlSyncRun=null;
                this.ctMtlCandidates = raw([]); this.ctMtlReviews = {}; this.ctMtlRecoveries=raw([]); this.ctMtlRequests = {}; this.ctMtlGenerations = raw([]); this.ctMtlError = ''; this.ctMtlRevision++;
            },
            ctMtlStorage(ctx = this.ctContext()) {
                const normal = this.ctStorage(ctx.scope);
                if (normal?.mtl) return normal.mtl;
                if (String(ctx.scope.groupId || '').startsWith('local:')) throw new Error('This in-memory MTL session has ended.');
                return this._ctMtlStore ||= raw(root.ClientTextMtlStore.create());
            },
            ctMtlClearOperationError() { this.ctMtlError = this._ctMtlSyncError || ''; },
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
                    await this.ctMtlLoadReviews(this.ctCurrentUnit, ctx); if (!current()) return false;
                    if (!String(ctx.scope.groupId).startsWith('local:')) {
                        const capabilities = await this.ctMtlLoadCapabilities();
                        if (!current()) return false;
                        if (capabilities?.unsupported) return true;
                    }
                    if (!String(ctx.scope.groupId).startsWith('local:') && permissions(this, ctx) && root.ClientTextMtlSync) {
                        const client = this._cloud, capturedAccess = access(this);
                        this._ctMtlSync = raw(root.ClientTextMtlSync.create({ scope: ctx.scope, store,
                            request: (path, options) => client.request(path, options),
                            isCurrent: () => current() && client === this._cloud && capturedAccess === access(this) }));
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
                        if (this.ctMtlError === this._ctMtlSyncError) this.ctMtlError = '';
                        this._ctMtlSyncError = '';
                    } catch (error) { if (this.ctCurrent(ctx) && this._ctMtlSync === sync && !error.stale) this.ctMtlError = this._ctMtlSyncError = error.message; }
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
                if (this.ctMtlPendingGeneration(field)) return 'Check the pending MTL request';
                if (this.ctMtlAccepted(field)) return 'Save the accepted translation before generating another MTL.';
                if (!M.eligible(field)) return 'MTL is available for nonblank text and grammatical-form fields.';
                if (!this.ctMtlCapabilities?.enabled) return 'MTL is not connected. Review MTL settings.';
                if (!permissions(this, this.ctContext())) return 'MTL requires access to this language.';
                return 'MTL · Translate this field' + (this.mtlShortcut === 'f8' ? ' (F8)' : this.mtlShortcut === 'ctrl-alt-f8' ? ' (Ctrl+Alt+F8)' : '');
            },
            ctMtlCanGenerate(field) {
                return this.ctActive && !this.ctBusy && !this.ctHistoryViewer && this.ctCurrentUnit?.fields.includes(field)
                    && M.eligible(field) && !this.ctMtlBusy(field) && permissions(this, this.ctContext())
                    && !this.ctMtlAccepted(field)
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
                if(!recovery||!candidate||this.ctBusy||this.ctHistoryViewer||!permissions(this,ctx))return false;
                const run=this._ctMtlRecoveryRun={},capturedAccess=access(this),name=key(unit.id,field.id),
                    mutation=this._ctMtlEditMutations?.get(name)||0,value=this.ctMtlFieldValue(field),store=this.ctMtlStorage(ctx);
                const current=()=>this._ctMtlRecoveryRun===run&&this.ctCurrent(ctx)&&this.ctCurrentUnit===unit&&access(this)===capturedAccess
                    &&permissions(this,ctx)&&this.ctMtlPendingCandidate(field)?.id===candidate.id&&this.ctMtlPendingCandidate(field)?.revision===candidate.revision
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
                const candidate = this.ctMtlPendingCandidate(field); if (!candidate || this.ctBusy||this.ctHistoryViewer) return false;
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
                const candidate = this.ctMtlCandidate(field); if (!candidate || this.ctBusy||this.ctHistoryViewer || !permissions(this, this.ctContext())) return false;
                const ctx = this.ctContext(), unit = this.ctCurrentUnit, name = key(unit.id, field.id), text = this.ctMtlFieldValue(field), check = M.validate(field, text);
                if (!check.valid) { this.ctMtlError = check.errors[0]?.message || 'Review the MTL translation before accepting it.'; return false; }
                const old = this.ctMtlReviews[name], previous = String(this.ctValues[field.id] ?? ''), mutation = this._ctMtlEditMutations?.get(name) || 0,
                    capturedAccess = access(this), review = { ...(old || {}), candidateId: candidate.id, candidateRevision: candidate.revision,
                    rawSourceHash: candidate.rawSourceHash, text, acceptedDraft: true, suppressed: false,
                    previousValue: old?.previousValue ?? String(this.ctValues[field.id] ?? ''),
                    previousDraft: old?.previousDraft || { values: copy(this.ctValues), reviewed: copy(this.ctReviewed), dirty: !!this.ctDraftDirty } };
                try {
                    await this.ctMtlPersistReview(ctx, unit.id, field.id, review);
                    if (!this.ctCurrent(ctx) || this.ctCurrentUnit !== unit || this.ctMtlCandidate(field)?.id !== candidate.id
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
                if (!this.ctMtlAccepted(field) || this.ctBusy||this.ctHistoryViewer || !permissions(this,ctx) || !candidate || typeof before.previousValue !== 'string'
                    ||candidate.unitId!==unit.id||candidate.fieldId!==field.id||candidate.rawSourceHash!==M.rawSourceHash(field.source)
                    ||candidate.assetHash!==descriptor?.assetHash||candidate.parserVersion!==descriptor?.parserVersion) return false;
                const text = String(this.ctValues[field.id] ?? ''), mutation = this._ctMtlEditMutations?.get(name) || 0,
                    review = {...before,text,dirty:true,acceptedDraft:false,suppressed:false,opened:true};
                try {
                    await this.ctMtlPersistReview(ctx,unit.id,field.id,review);
                    if (!this.ctCurrent(ctx) || this.ctCurrentUnit !== unit || this.ctMtlReviews[name] !== before
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
                if (!unit || unit !== this.ctCurrentUnit) return;
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
                if (!candidate || this.ctBusy||this.ctHistoryViewer || !permissions(this, ctx)) return false;
                if (this.ctMtlAccepted(field)) return false;
                try {
                    await this.ctMtlStorage(ctx).dismiss(ctx.scope, candidate, { mutationId: id() });
                    if (!this.ctCurrent(ctx)) return false;
                    this.ctMtlCandidates = raw(await this.ctMtlStorage(ctx).list(ctx.scope)); if (!this.ctCurrent(ctx)) return false;
                    const name = key(candidate.unitId, field.id), reviews = { ...this.ctMtlReviews }; delete reviews[name]; this.ctMtlReviews = reviews;
                    if (this._ctMtlAcceptanceClaims?.[candidate.unitId]) this._ctMtlAcceptanceClaims[candidate.unitId] = this._ctMtlAcceptanceClaims[candidate.unitId].filter(claim => claim.fieldId !== field.id);
                    this.ctMtlRevision++; this.ctMtlClearOperationError(); this.ctMtlSync(ctx); return true;
                } catch (error) { if (this.ctCurrent(ctx)) this.ctMtlError = error.message; return false; }
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
                    jobs = this._ctMtlJobs ||= raw(new Map()), job = { requestId:generation.requestId, controller },
                    mutation = this._ctMtlEditMutations?.get(name) || 0;
                jobs.set(name,job); this.ctMtlRequests = {...this.ctMtlRequests,[name]:generation.requestId};
                const current = () => jobs.get(name) === job && !controller.signal.aborted && this.ctCurrent(ctx) && this.ctActive
                    && client === this._cloud && capturedAccess === access(this) && permissions(this,ctx)
                    && this._ctUnitIndex?.get(unit.id) === unit && M.rawSourceHash(field.source) === generation.rawSourceHash;
                try {
                    const response = await client.request('/v1/mtl/requests/' + encodeURIComponent(generation.requestId), {signal:controller.signal});
                    if (!current()) throw stale();
                    if (response.candidate) return await this.ctMtlAdoptCandidate(ctx,unit,field,response.candidate,generation,current,
                        () => (this._ctMtlEditMutations?.get(name) || 0) !== mutation);
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
                        if (error.status === 404 || error.statusCode === 404 || ['MTL_INVALID_RESPONSE','REVISION_CONFLICT'].includes(error.code)) {
                            await this.ctMtlStorage(ctx).putGeneration(ctx.scope,{requestId:generation.requestId,status:'failed'});
                            if (!current()) return false;
                            this.ctMtlGenerations = raw(await this.ctMtlStorage(ctx).getGenerations(ctx.scope));
                            if (!current()) return false;
                            this.ctMtlError = ['MTL_INVALID_RESPONSE','REVISION_CONFLICT'].includes(error.code) ? error.message : 'The earlier MTL request did not start. Generate again when ready.';
                        } else this.ctMtlError = error.message;
                    }
                    return false;
                } finally {
                    if (jobs.get(name) === job) jobs.delete(name);
                    if (this.ctMtlRequests[name] === generation.requestId) { const requests = {...this.ctMtlRequests}; delete requests[name]; this.ctMtlRequests = requests; }
                }
            },
            ctMtlBuildContext(field) {
                const ctx = this.ctContext();
                return Context.create({ unit: this.ctCurrentUnit, field, units: this.ctUnits, npcIndex: this._ctNpcIndex, convoIndex: this._ctConvoIndex,
                    skillResolver: this.ctSkillResolver, dictionary: this.ctMtlCommittedGlossary(ctx), scope: ctx.scope });
            },
            async ctMtlGenerate(field) {
                const ctx = this.ctContext();
                if (this.ctMtlCapabilities === null && this.ctActive && this.ctCurrentUnit?.fields.includes(field) && M.eligible(field) && permissions(this,ctx)) {
                    await this.ctMtlLoadCapabilities();if(!this.ctCurrent(ctx))return false;
                    if(this.ctMtlCapabilities===null){this.ctMtlError='The MTL connection could not be checked. Review MTL settings.';return false;}
                }
                if (!this.ctMtlCanGenerate(field)) { this.ctMtlError = this.ctMtlCapabilities?.enabled ? 'MTL is unavailable for this field or language.' : 'MTL is not connected. Review MTL settings.'; return false; }
                const pending = this.ctMtlPendingGeneration(field); if (pending) return this.ctMtlRecover(field,pending);
                if (this.mtlConsentVersion !== 'mtl-v1') { this.ctMtlError = 'Review and enable the provider data-transmission choice in MTL settings first.'; return false; }
                const unit = this.ctCurrentUnit, client = this._cloud, capturedAccess = access(this), descriptor = this.ctMtlDescriptor(unit);
                if (!descriptor) { this.ctMtlError = 'The original workbook identity is unavailable. Reopen this workspace.'; return false; }
                const name = key(unit.id, field.id), mutations = this._ctMtlEditMutations ||= raw(new Map()), mutation = mutations.get(name) || 0,
                    previous = String(this.ctValues[field.id] ?? ''), capturedSource = M.rawSourceHash(field.source), controller = new AbortController(), requestId = id();
                const job = { requestId, controller }, jobs = this._ctMtlJobs ||= raw(new Map()); jobs.set(name, job);
                let sent = false, generation, confirmedFailure = false;
                this.ctMtlRequests = { ...this.ctMtlRequests, [name]: requestId };
                const current = () => jobs.get(name) === job && !controller.signal.aborted && this.ctCurrent(ctx) && this.ctActive
                    && client === this._cloud && capturedAccess === access(this) && permissions(this, ctx) && this.mtlConsentVersion === 'mtl-v1'
                    && this._ctUnitIndex?.get(unit.id) === unit && unit.fields.includes(field) && M.rawSourceHash(field.source) === capturedSource;
                try {
                    const context = this.ctMtlBuildContext(field);
                    const body = { requestId, unitId: unit.id, fieldId: field.id, role: unit.role, assetHash: descriptor.assetHash || descriptor.hash,
                        parserVersion: descriptor.parserVersion, source: field.source, sourceHash: S.sourceHash(field.source), rawSourceHash: capturedSource,
                        baseTargetHash: S.hash(previous), baseRevision: this.ctSaved[unit.id]?.serverRevision || 0, clientFacts: S.clientFacts(unit),
                        context: context.initial, consentVersion: 'mtl-v1', ...(String(ctx.scope.groupId).startsWith('local:')
                            ? { language: ctx.scope.language, game:ctx.scope.game, branchId:ctx.scope.branchId || 'default' } : {}) };
                    if (new TextEncoder().encode(JSON.stringify(body)).length > Context.LIMITS.bytes) throw new Error('This MTL source and context exceed the request size limit.');
                    const path = String(ctx.scope.groupId).startsWith('local:') ? '/v1/mtl/local/requests'
                        : '/v1/content-groups/' + encodeURIComponent(ctx.scope.groupId) + '/mtl/requests?language=' + encodeURIComponent(ctx.scope.language);
                    const store = this.ctMtlStorage(ctx);
                    generation = await store.putGeneration(ctx.scope,{requestId,unitId:unit.id,fieldId:field.id,rawSourceHash:capturedSource,
                        sourceHash:body.sourceHash,assetHash:body.assetHash,parserVersion:body.parserVersion,baseTargetHash:body.baseTargetHash,
                        createdAt:Date.now(),status:'pending',requestBodyHash:S.hash(body)});
                    if (!current()) throw stale();
                    this.ctMtlGenerations = raw([...this.ctMtlGenerations.filter(value=>value.requestId!==requestId),generation]);
                    this.ctMtlDebugBegin?.(field, body);
                    sent = true;
                    const response = await client.request(path, { method: 'POST', body, signal: controller.signal, timeout: 190000 });
                    if (!current()) throw stale();
                    const adopted = await this.ctMtlAdoptCandidate(ctx,unit,field,response.candidate,generation,current,()=>(mutations.get(name)||0)!==mutation);
                    if (current()) this.ctMtlDebugFinish?.(field, requestId);
                    return adopted;
                } catch (error) {
                    if (error.status === 422 && ['MTL_OUTPUT_INVALID', 'MTL_REFUSED'].includes(error.code)) confirmedFailure = true;
                    // A proxy can replace a failed POST with an unreadable error
                    // page. Inspect the same job once; never repeat inference.
                    if (sent && current() && ['TypeError', 'NetworkError', 'SyntaxError'].includes(error.name)) {
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
                    if (current() && !error.stale && error.name !== 'AbortError') {
                        this.ctMtlError = error.message; this.ctMtlDebugFinish?.(field, requestId, error);
                    }
                    return false;
                }
                finally {
                    if (jobs.get(name) === job) jobs.delete(name);
                    if (this.ctMtlRequests[name] === requestId) { const requests = { ...this.ctMtlRequests }; delete requests[name]; this.ctMtlRequests = requests; }
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
