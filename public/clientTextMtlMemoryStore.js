/* Disposable local-workbook MTL: no IndexedDB, shared sync or translation-memory writes. */
(function (root, factory) {
    const state = root.ClientTextState || (typeof require === 'function' ? require('./clientTextState.js') : null);
    const mtl = root.ClientTextMtlState || (typeof require === 'function' ? require('./clientTextMtlState.js') : null);
    const storage = root.ClientTextMtlStore || (typeof require === 'function' ? require('./clientTextMtlStore.js') : null);
    const api = factory(state, mtl, storage);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.ClientTextMtlMemoryStore = api;
})(typeof globalThis === 'object' ? globalThis : self, function (S, M, C) {
    'use strict';
    const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
    const normalizeScope = C.normalizeScope, scopeKey = C.scopeKey, key = (...values) => JSON.stringify(values);
    function create() {
        const scopes = new Map(); let disposed = false;
        function capture(rawScope, options, create = true) {
            if (disposed) throw new Error('This local MTL session was disposed.');
            C.guard(options); const id = scopeKey(rawScope);
            if (!scopes.has(id) && create) scopes.set(id, { candidates: new Map(), reviews: new Map(), receipts: new Map(), generations: new Map(), sequence: 0 });
            return scopes.get(id);
        }
        function list(rawScope, options = {}) {
            const store = capture(rawScope, options);
            return [...store.candidates.values()].filter(candidate => !options.unitId || candidate.unitId === options.unitId)
                .sort((a, b) => b.createdAt - a.createdAt || b.revision - a.revision || a.id.localeCompare(b.id)).map(S.copy);
        }
        function getCandidate(rawScope, candidateId, options) { return S.copy(capture(rawScope, options).candidates.get(candidateId)); }
        function putCandidate(rawScope, input, options) {
            const store = capture(rawScope, options), next = M.mergeCandidate(store.candidates.get(input.id), input);
            const updates = M.generationUpdates([...store.candidates.values()], next);
            for (const update of updates) store.candidates.set(update.id, update);
            return S.copy(updates.find(update => update.id === next.id));
        }
        function getReview(rawScope, unitId, fieldId, options) {
            const store = capture(rawScope, options), current = store.reviews.get(key(unitId, fieldId));
            if (options?.recoveryId) return S.copy(store.reviews.get(key('recovery', unitId, fieldId, options.recoveryId)));
            return S.copy(!options?.candidateId || current?.candidateId === options.candidateId ? current
                : store.reviews.get(key('archive', unitId, fieldId, options.candidateId)));
        }
        function listReviews(rawScope, options = {}) {
            return [...capture(rawScope, options).reviews.values()].filter(review => (!options.unitId || review.unitId === options.unitId) && (options.includeArchived || !review.archived)).map(S.copy);
        }
        function putReview(rawScope, unitId, fieldId, input, options = {}) {
            const store = capture(rawScope, options), id = key(unitId, fieldId), previous = store.reviews.get(id), candidate = store.candidates.get(input?.candidateId);
            if (own(options, 'expectedRevision') && (previous?.revision || null) !== options.expectedRevision)
                throw Object.assign(new Error('This MTL review changed.'), { code: 'MTL_REVIEW_CHANGED' });
            if (!candidate || candidate.unitId !== unitId || candidate.fieldId !== fieldId || candidate.rawSourceHash !== input.rawSourceHash
                || candidate.revision < input.candidateRevision) throw M.changed();
            const value = C.normalizeReview(unitId, fieldId, input, previous);
            if (previous && previous.candidateId !== input.candidateId)
                store.reviews.set(key('archive', unitId, fieldId, previous.candidateId), { ...previous, archived: true });
            store.reviews.set(id, value); return S.copy(value);
        }
        function archiveReview(rawScope, unitId, fieldId, input, options = {}) {
            const store = capture(rawScope, options), id = key('recovery', unitId, fieldId, options.recoveryId), previous = store.reviews.get(id);
            const next = C.normalizeReviewRecovery(unitId, fieldId, input, options, previous);
            if (!previous || next.editRevision > previous.editRevision) store.reviews.set(id, next);
            return S.copy(next);
        }
        function getMetadata(rawScope, options) { return { sequence: capture(rawScope, options).sequence }; }
        function getGeneration(rawScope, requestId, options) { return S.copy(capture(rawScope, options).generations.get(requestId)); }
        function getGenerations(rawScope, options = {}) {
            return [...capture(rawScope, options).generations.values()].filter(record => !options.activeOnly || ['pending', 'uncertain'].includes(record.status))
                .sort((a, b) => b.createdAt - a.createdAt).map(S.copy);
        }
        function putGeneration(rawScope, input, options) {
            const store = capture(rawScope, options), next = C.normalizeGeneration(input, store.generations.get(input?.requestId));
            store.generations.set(next.requestId, next); return S.copy(next);
        }
        function deleteGeneration(rawScope, requestId, options) { return capture(rawScope, options).generations.delete(requestId); }
        function applyRemote(rawScope, input, options) {
            const store = capture(rawScope, options), sequence = input.sequence ?? store.sequence;
            if (!Number.isSafeInteger(sequence) || sequence < store.sequence) throw Object.assign(new Error('MTL replay cursor moved backwards.'), { code: 'MTL_STALE_SEQUENCE' });
            const candidates = input.candidates || input.events?.map(event => event.candidate).filter(Boolean) || [];
            if (!Array.isArray(candidates)) throw new TypeError('Invalid MTL replay.');
            const working = new Map(store.candidates), changed = [];
            for (const input of candidates) {
                const candidate = M.mergeCandidate(working.get(input.id), input);
                if (S.stableStringify(working.get(candidate.id)) !== S.stableStringify(candidate)) changed.push(candidate.unitId);
                working.set(candidate.id, candidate);
            }
            store.candidates = working;
            store.sequence = sequence; return { changed: [...new Set(changed)], sequence };
        }
        function dismiss(rawScope, input, options = {}) {
            const store = capture(rawScope, options), candidate = M.normalizeCandidate(input), mutationId = options.mutationId;
            if (typeof mutationId !== 'string' || !mutationId || mutationId.length > 256) throw new TypeError('MTL dismissal requires a stable mutation ID.');
            const signature = S.hash({ candidateId: candidate.id, body: { mutationId, candidateRevision: candidate.revision } }), previous = store.receipts.get(mutationId);
            if (previous) {
                if (previous.signature !== signature) throw Object.assign(new Error('MTL mutation ID was reused.'), { code: 'MTL_RECEIPT_MISMATCH' });
                return { ...S.copy(previous), replayed: true };
            }
            const current = store.candidates.get(candidate.id);
            if (!current || current.status !== 'pending' || current.revision !== candidate.revision || M.immutable(current) !== M.immutable(candidate)) throw M.changed();
            const next = { ...current, status: 'dismissed', revision: current.revision + 1, resolvedAt: Date.now() };
            const receipt = { mutationId, signature, candidateId: current.id, createdAt: Date.now(), acknowledged: true };
            store.candidates.set(next.id, next); store.receipts.set(mutationId, receipt); return { ...S.copy(receipt), replayed: false };
        }
        // These two methods deliberately stay synchronous. The owning memory
        // workspace validates every save guard first, then commits without an await.
        function validateAcceptances(rawScope, unit, acceptances, values, descriptor, options) {
            return M.validateAcceptances([...capture(rawScope, options).candidates.values()], unit, acceptances, values, descriptor);
        }
        function resolveAcceptances(rawScope, claims, options = {}) {
            const store = capture(rawScope, options), now = options.now ?? Date.now();
            for (const claim of claims) {
                const candidate = store.candidates.get(claim.candidateId);
                if (!candidate || candidate.status !== 'pending' || candidate.revision !== claim.candidateRevision) throw M.changed();
            }
            for (const claim of claims) {
                const candidate = store.candidates.get(claim.candidateId);
                store.candidates.set(candidate.id, { ...candidate, status: 'accepted', localDisposition: true,
                    reviewedTextHash: claim.reviewedTextHash, acceptanceJobId: options.jobId || '', resolvedAt: now });
            }
        }
        function getOutbox(rawScope, options) { capture(rawScope, options); return []; }
        function dispose() { disposed = true; scopes.clear(); }
        return { list, getCandidate, putCandidate, getReview, listReviews, putReview, archiveReview, getMetadata, getGeneration, getGenerations, putGeneration, deleteGeneration, applyRemote, dismiss,
            validateAcceptances, resolveAcceptances, getOutbox, normalizeScope, scopeKey, dispose };
    }
    return { normalizeScope, scopeKey, create };
});
