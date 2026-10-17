/* Separate, account-scoped MTL candidates, personal review buffers and receipts. */
(function (root, factory) {
    const state = root.ClientTextState || (typeof require === 'function' ? require('./clientTextState.js') : null);
    const storage = root.ClientTextStore || (typeof require === 'function' ? require('./clientTextStore.js') : null);
    const mtl = root.ClientTextMtlState || (typeof require === 'function' ? require('./clientTextMtlState.js') : null);
    const api = factory(root, state, storage, mtl);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.ClientTextMtlStore = api;
})(typeof globalThis === 'object' ? globalThis : self, function (root, S, C, M) {
    'use strict';
    const stores = Object.freeze({ candidates: 'clienttext_mtl_candidates', reviews: 'clienttext_mtl_reviews', meta: 'clienttext_mtl_meta',
        outbox: 'clienttext_mtl_outbox', receipts: 'clienttext_mtl_receipts' });
    const names = Object.freeze(Object.values(stores)), own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
    const key = (...values) => JSON.stringify(values), normalizeScope = C.normalizeScope, scopeKey = C.scopeKey;
    const request = req => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    const completed = tx => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(tx.error || new Error('MTL transaction aborted.')); });
    const get = async (tx, name, scope, id) => (await request(tx.objectStore(name).get(key(scope, id))))?.value;
    const put = (tx, name, scope, id, value) => tx.objectStore(name).put({ key: key(scope, id), scope, value: S.copy(value) });
    const del = (tx, name, scope, id) => tx.objectStore(name).delete(key(scope, id));
    const reviewId = (unitId, fieldId) => key(unitId, fieldId);
    const archivedReviewId = (unitId, fieldId, candidateId) => key('archive', unitId, fieldId, candidateId);
    const recoveryReviewId = (unitId, fieldId, recoveryId) => key('recovery', unitId, fieldId, recoveryId);
    function dismissalInput(candidate, options={}, local=false){
        const mutationId=options.mutationId;
        if(typeof mutationId!=='string'||!mutationId||mutationId.length>256)throw new TypeError('MTL dismissal requires a stable mutation ID.');
        if(options.archiveRequired&&options.consentVersion!=='mtl-v2'||own(options,'consentVersion')&&options.consentVersion!=='mtl-v2')
            throw Object.assign(new Error('Review and enable the updated MTL data-sharing and private review-retention choice in MTL settings first.'),{code:'MTL_REVIEW_CONSENT_REQUIRED'});
        const body={mutationId,...(local?{candidateId:candidate.id}:{}),candidateRevision:candidate.revision,...(local?{generatedText:candidate.generatedText}:{})};
        if(own(options,'consentVersion'))body.consentVersion=options.consentVersion;
        if(own(options,'reviewedText')){
            if(typeof options.reviewedText!=='string'||options.reviewedText.length>M.MAX_TEXT)throw new TypeError('The rejected MTL review exceeds the 32768-character limit.');
            body.reviewedText=options.reviewedText;
        }
        return{body,signature:S.hash({candidateId:candidate.id,body})};
    }
    function archiveReceipt(input,required=false){
        if(!input&&!required)return undefined;
        if(!input||typeof input.id!=='string'||!/^mtl-review_[a-f0-9]{64}$/.test(input.id)
            ||input.format!=='sdeditor-mtl-dismissal-v1'||input.status!=='saved')throw Object.assign(new Error('The dismissal archive could not be confirmed. Its exact request is retained for retry.'),{code:'MTL_REVIEW_ARCHIVE_UNCONFIRMED'});
        return{id:input.id,format:input.format,status:input.status};
    }
    function upgrade(db, tx) {
        for (const name of names) {
            const store = db.objectStoreNames.contains(name) ? tx.objectStore(name) : db.createObjectStore(name, { keyPath: 'key' });
            if (!store.indexNames.contains('by_scope')) store.createIndex('by_scope', 'scope');
        }
    }
    function normalizeReview(unitId, fieldId, input, previous, now = Date.now()) {
        if (typeof unitId !== 'string' || !unitId || typeof fieldId !== 'string' || !fieldId || !input
            || typeof input.candidateId !== 'string' || !input.candidateId || !Number.isSafeInteger(input.candidateRevision) || input.candidateRevision < 1
            || typeof input.text !== 'string' || input.text.length > M.MAX_TEXT || !/^[a-f0-9]{64}$/.test(input.rawSourceHash || ''))
            throw new TypeError('Invalid MTL review buffer.');
        const review = { unitId, fieldId, candidateId: input.candidateId, candidateRevision: input.candidateRevision,
            rawSourceHash: input.rawSourceHash, text: input.text, revision: (previous?.revision || 0) + 1,
            createdAt: previous?.createdAt || now, updatedAt: now, acceptedDraft: !!input.acceptedDraft, suppressed: !!input.suppressed,
            dirty: !!input.dirty, opened: !!input.opened };
        for (const name of ['previousDraft', 'previousValue', 'acceptance']) if (own(input, name)) review[name] = S.copy(input[name]);
        if (input.previousReview) {
            const before = input.previousReview;
            if (typeof before.text !== 'string' || before.text.length > M.MAX_TEXT) throw new TypeError('Invalid previous MTL review.');
            review.previousReview = Object.fromEntries(['candidateId', 'candidateRevision', 'rawSourceHash', 'text', 'dirty', 'revision',
                'createdAt', 'updatedAt', 'acceptedDraft', 'suppressed', 'opened'].filter(name => own(before, name)).map(name => [name, S.copy(before[name])]));
        }
        return review;
    }
    function normalizeReviewRecovery(unitId, fieldId, input, options, previous, now = Date.now()) {
        const recoveryId = options?.recoveryId, editRevision = options?.editRevision;
        if (typeof recoveryId !== 'string' || !recoveryId || recoveryId.length > 256 || !Number.isSafeInteger(editRevision) || editRevision < 1
            || options.reason && options.reason !== 'review-conflict') throw new TypeError('Invalid MTL review recovery identity.');
        if (unitId?.length > 4096 || fieldId?.length > 4096 || input?.candidateId?.length > 256) throw new TypeError('Invalid MTL review recovery binding.');
        // Recovery is the rejected authored field, not a recursive snapshot of
        // another draft or workbook. It must remain writable after a peer has
        // resolved/superseded the candidate whose review failed its CAS.
        const review = normalizeReview(unitId, fieldId, Object.fromEntries(['candidateId', 'candidateRevision', 'rawSourceHash', 'text',
            'acceptedDraft', 'suppressed', 'dirty', 'opened'].filter(name => own(input, name)).map(name => [name, input[name]])), null, now);
        const body = Object.fromEntries(['unitId', 'fieldId', 'candidateId', 'candidateRevision', 'rawSourceHash', 'text',
            'acceptedDraft', 'suppressed', 'dirty', 'opened'].map(name => [name, review[name]]));
        if (own(input, 'previousValue')) {
            if (typeof input.previousValue !== 'string' || input.previousValue.length > M.MAX_TEXT) throw new TypeError('Invalid MTL previous value recovery.');
            body.previousValue = input.previousValue;
        }
        const signature = S.hash(body);
        if (previous) {
            if (editRevision < previous.editRevision) return S.copy(previous);
            if (editRevision === previous.editRevision) {
                if (signature !== previous.signature) throw Object.assign(new Error('An MTL recovery revision was reused for different text.'), { code: 'MTL_RECOVERY_MISMATCH' });
                return S.copy(previous);
            }
            if (previous.candidateId !== body.candidateId || previous.rawSourceHash !== body.rawSourceHash)
                throw Object.assign(new Error('An MTL recovery ID was reused for another candidate or source.'), { code: 'MTL_RECOVERY_MISMATCH' });
        }
        return { ...body, recoveryId, editRevision, revision: editRevision, signature, reason: 'review-conflict', archived: true,
            createdAt: previous?.createdAt || now, updatedAt: now };
    }
    function normalizeGeneration(input, previous) {
        const merged = { ...previous, ...input }, fields = ['requestId', 'unitId', 'fieldId', 'rawSourceHash', 'assetHash',
            'parserVersion', 'baseTargetHash', 'sourceHash', 'createdAt', 'requestBodyHash'];
        for (const name of ['requestId', 'unitId', 'fieldId', 'parserVersion']) if (typeof merged[name] !== 'string' || !merged[name] || merged[name].length > (['unitId', 'fieldId'].includes(name) ? 4096 : 256))
            throw new TypeError('Invalid MTL generation identity.');
        if (!['rawSourceHash', 'assetHash', 'baseTargetHash', 'sourceHash'].every(name => /^[a-f0-9]{64}$/.test(merged[name] || ''))
            || merged.requestBodyHash && !/^[a-f0-9]{64}$/.test(merged.requestBodyHash)
            || !S.PARSER_VERSIONS.includes(merged.parserVersion) || !Number.isFinite(merged.createdAt) || merged.createdAt < 0
            || !['pending', 'uncertain', 'completed', 'failed'].includes(merged.status)) throw new TypeError('Invalid MTL generation journal.');
        if (previous && (fields.some(name => own(input, name) && S.stableStringify(input[name]) !== S.stableStringify(previous[name]))
            || ['completed', 'failed'].includes(previous.status) && merged.status !== previous.status))
            throw Object.assign(new Error('An MTL request ID was reused for another generation.'), { code: 'MTL_REQUEST_MISMATCH' });
        return { kind: 'generation', ...Object.fromEntries(fields.filter(name => own(merged, name)).map(name => [name, S.copy(merged[name])])),
            status: merged.status, suppressed: !!previous?.suppressed || !!input?.suppressed, updatedAt: Date.now() };
    }
    function guard(options) {
        if (options?.signal?.aborted) throw Object.assign(new Error('MTL work was cancelled.'), { name: 'AbortError', stale: true });
        if (options?.guard && !options.guard()) throw Object.assign(new Error('MTL context changed.'), { stale: true });
    }
    async function validateAcceptancesTx(tx, rawScope, unit, acceptances, values, descriptor) {
        if (!acceptances?.length) return M.validateAcceptances([], unit, acceptances, values, descriptor);
        const id = scopeKey(rawScope), candidates = [];
        for (const claim of acceptances) candidates.push(await get(tx, stores.candidates, id, claim?.candidateId));
        return M.validateAcceptances(candidates.filter(Boolean), unit, acceptances, values, descriptor);
    }
    async function resolveAcceptancesTx(tx, rawScope, claims, options = {}) {
        const id = scopeKey(rawScope), now = options.now ?? Date.now();
        for (const claim of claims) {
            const current = await get(tx, stores.candidates, id, claim.candidateId);
            if (!current || current.status !== 'pending' || current.revision !== claim.candidateRevision) throw M.changed();
            put(tx, stores.candidates, id, current.id, { ...current, status: 'accepted', localDisposition: true,
                reviewedTextHash: claim.reviewedTextHash, acceptanceJobId: options.jobId || '', resolvedAt: now });
            // Retain the exact review text/checkpoint until server acknowledgement; it is recovery, never an export input.
        }
    }
    function create(dependencies = {}) {
        const getDb = dependencies.openDb || (() => {
            const offline = root.OfflineStore || root.window?.OfflineStore || root.self?.OfflineStore;
            if (!offline?.openClientTextDb) throw new Error('MTL storage is unavailable. Reload the editor.');
            return offline.openClientTextDb();
        });
        const capture = (raw, options) => { guard(options); return { scope: normalizeScope(raw), id: scopeKey(raw) }; };
        async function transaction(selected, mode, action, options) {
            guard(options); const db = await getDb(); guard(options);
            if (!names.every(name => db.objectStoreNames.contains(name))) throw new Error('MTL storage upgrade is incomplete. Reload the editor.');
            const tx = db.transaction([...new Set(selected)], mode), done = completed(tx);
            try { const result = await Promise.race([action(tx), done.then(() => new Promise(() => {}))]); guard(options); await done; return S.copy(result); }
            catch (error) { try { tx.abort(); } catch (_) {} await done.catch(() => {}); throw error; }
        }
        const scoped = async (tx, name, id) => (await request(tx.objectStore(name).index('by_scope').getAll(id))).map(row => row.value);
        async function list(rawScope, options = {}) {
            const { id } = capture(rawScope, options);
            return transaction([stores.candidates], 'readonly', async tx => (await scoped(tx, stores.candidates, id))
                .filter(candidate => !options.unitId || candidate.unitId === options.unitId)
                .sort((a, b) => b.createdAt - a.createdAt || b.revision - a.revision || a.id.localeCompare(b.id)), options);
        }
        async function getCandidate(rawScope, candidateId, options) {
            const { id } = capture(rawScope, options); return transaction([stores.candidates], 'readonly', tx => get(tx, stores.candidates, id, candidateId), options);
        }
        async function putCandidate(rawScope, candidate, options = {}) {
            const { id } = capture(rawScope, options), normalized = M.normalizeCandidate(candidate);
            return transaction([stores.candidates], 'readwrite', async tx => {
                const current = await get(tx, stores.candidates, id, normalized.id), value = M.mergeCandidate(current, normalized);
                const updates = M.generationUpdates(await scoped(tx, stores.candidates, id), value);
                for (const update of updates) put(tx, stores.candidates, id, update.id, update);
                return updates.find(update => update.id === value.id);
            }, options);
        }
        async function getReview(rawScope, unitId, fieldId, options) {
            const { id } = capture(rawScope, options); return transaction([stores.reviews], 'readonly', async tx => {
                if (options?.recoveryId) return get(tx, stores.reviews, id, recoveryReviewId(unitId, fieldId, options.recoveryId));
                const current = await get(tx, stores.reviews, id, reviewId(unitId, fieldId));
                return !options?.candidateId || current?.candidateId === options.candidateId ? current
                    : get(tx, stores.reviews, id, archivedReviewId(unitId, fieldId, options.candidateId));
            }, options);
        }
        async function listReviews(rawScope, options = {}) {
            const { id } = capture(rawScope, options); return transaction([stores.reviews], 'readonly', async tx =>
                (await scoped(tx, stores.reviews, id)).filter(review => (!options.unitId || review.unitId === options.unitId) && (options.includeArchived || !review.archived)), options);
        }
        async function putReview(rawScope, unitId, fieldId, input, options = {}) {
            const { id } = capture(rawScope, options), detached = S.copy(input);
            return transaction([stores.reviews, stores.candidates], 'readwrite', async tx => {
                const previous = await get(tx, stores.reviews, id, reviewId(unitId, fieldId));
                if (own(options, 'expectedRevision') && (previous?.revision || null) !== options.expectedRevision) throw Object.assign(new Error('This MTL review changed.'), { code: 'MTL_REVIEW_CHANGED' });
                const candidate = await get(tx, stores.candidates, id, detached.candidateId);
                if (!candidate || candidate.unitId !== unitId || candidate.fieldId !== fieldId || candidate.rawSourceHash !== detached.rawSourceHash
                    || candidate.revision < detached.candidateRevision) throw M.changed();
                if (previous && previous.candidateId !== detached.candidateId)
                    put(tx, stores.reviews, id, archivedReviewId(unitId, fieldId, previous.candidateId), { ...previous, archived: true });
                const value = normalizeReview(unitId, fieldId, detached, previous);
                put(tx, stores.reviews, id, reviewId(unitId, fieldId), value); return value;
            }, options);
        }
        async function archiveReview(rawScope, unitId, fieldId, input, options = {}) {
            const { id } = capture(rawScope, options), detached = S.copy(input), recoveryOptions = { recoveryId: options.recoveryId,
                editRevision: options.editRevision, reason: options.reason };
            return transaction([stores.reviews], 'readwrite', async tx => {
                const recoveryKey = recoveryReviewId(unitId, fieldId, recoveryOptions.recoveryId), previous = await get(tx, stores.reviews, id, recoveryKey);
                const next = normalizeReviewRecovery(unitId, fieldId, detached, recoveryOptions, previous);
                if (!previous || next.editRevision > previous.editRevision) put(tx, stores.reviews, id, recoveryKey, next);
                return next;
            }, options);
        }
        async function getMetadata(rawScope, options) {
            const { id } = capture(rawScope, options); return transaction([stores.meta], 'readonly', tx => get(tx, stores.meta, id, 'meta'), options);
        }
        async function getGeneration(rawScope, requestId, options) {
            const { id } = capture(rawScope, options); return transaction([stores.meta], 'readonly', tx => get(tx, stores.meta, id, key('generation', requestId)), options);
        }
        async function getGenerations(rawScope, options = {}) {
            const { id } = capture(rawScope, options); return transaction([stores.meta], 'readonly', async tx =>
                (await scoped(tx, stores.meta, id)).filter(record => record.kind === 'generation'
                    && (!options.activeOnly || ['pending', 'uncertain'].includes(record.status))).sort((a, b) => b.createdAt - a.createdAt), options);
        }
        async function putGeneration(rawScope, input, options) {
            const { id } = capture(rawScope, options), detached = S.copy(input);
            return transaction([stores.meta], 'readwrite', async tx => {
                const previous = await get(tx, stores.meta, id, key('generation', detached?.requestId)), next = normalizeGeneration(detached, previous);
                put(tx, stores.meta, id, key('generation', next.requestId), next); return next;
            }, options);
        }
        async function deleteGeneration(rawScope, requestId, options) {
            const { id } = capture(rawScope, options); return transaction([stores.meta], 'readwrite', tx => {
                del(tx, stores.meta, id, key('generation', requestId)); return true;
            }, options);
        }
        async function applyRemote(rawScope, input, options = {}) {
            const { id } = capture(rawScope, options), detached = S.copy(input);
            const candidates = detached?.candidates || detached?.events?.map(event => event.candidate).filter(Boolean) || [];
            if (!Array.isArray(candidates)) throw new TypeError('Invalid MTL replay.');
            const normalized = candidates.map(M.normalizeCandidate);
            if (own(detached, 'sequence') && (!Number.isSafeInteger(detached.sequence) || detached.sequence < 0)) throw new TypeError('Invalid MTL sequence.');
            return transaction([stores.candidates, stores.meta], 'readwrite', async tx => {
                const metadata = await get(tx, stores.meta, id, 'meta'), changed = [];
                if (own(detached, 'sequence') && detached.sequence < (metadata?.sequence || 0)) throw Object.assign(new Error('MTL replay cursor moved backwards.'), { code: 'MTL_STALE_SEQUENCE' });
                for (const candidate of normalized) {
                    const previous = await get(tx, stores.candidates, id, candidate.id), next = M.mergeCandidate(previous, candidate);
                    if (S.stableStringify(previous) !== S.stableStringify(next)) { put(tx, stores.candidates, id, next.id, next); changed.push(next.unitId); }
                }
                if (own(detached, 'sequence')) put(tx, stores.meta, id, 'meta', { ...metadata, sequence: detached.sequence });
                return { changed: [...new Set(changed)], sequence: detached.sequence ?? metadata?.sequence ?? 0 };
            }, options);
        }
        async function dismiss(rawScope, candidate, options = {}) {
            const { id } = capture(rawScope, options), detached = M.normalizeCandidate(candidate), mutationId = options.mutationId;
            if (typeof mutationId !== 'string' || !mutationId || mutationId.length > 256) throw new TypeError('MTL dismissal requires a stable mutation ID.');
            const {body,signature}=dismissalInput(detached,options);
            return transaction([stores.candidates, stores.outbox, stores.receipts], 'readwrite', async tx => {
                const receipt = await get(tx, stores.receipts, id, mutationId);
                if (receipt) {
                    if (receipt.signature !== signature) throw Object.assign(new Error('MTL mutation ID was reused.'), { code: 'MTL_RECEIPT_MISMATCH' });
                    return { ...receipt, replayed: true };
                }
                const current = await get(tx, stores.candidates, id, detached.id);
                if (!current || current.status !== 'pending' || current.revision !== detached.revision || M.immutable(current) !== M.immutable(detached)) throw M.changed();
                const value = { ...current, status: 'dismissed', localDisposition: true, resolvedAt: Date.now() };
                const operation = { mutationId, candidateId: current.id, unitId: current.unitId, signature, requestBody: body,
                    fieldId:current.fieldId,requestId:current.requestId,...(options.archiveRequired?{archiveRequired:true}:{}),state: 'pending', createdAt: Date.now(), candidate: value };
                const accepted = { mutationId, signature, candidateId: current.id, createdAt: operation.createdAt, acknowledged: false };
                put(tx, stores.candidates, id, current.id, value); put(tx, stores.outbox, id, mutationId, operation);
                put(tx, stores.receipts, id, mutationId, accepted); return { ...accepted, replayed: false };
            }, options);
        }
        async function getOutbox(rawScope, options) {
            const { id } = capture(rawScope, options); return transaction([stores.outbox], 'readonly', async tx =>
                (await scoped(tx, stores.outbox, id)).sort((a, b) => a.createdAt - b.createdAt || a.mutationId.localeCompare(b.mutationId)), options);
        }
        async function markSending(rawScope, mutationId, state, options) {
            const { id } = capture(rawScope, options);
            if (!['sending', 'uncertain', 'conflict', 'pending','archive-pending'].includes(state)) throw new TypeError('Invalid MTL upload state.');
            return transaction([stores.outbox], 'readwrite', async tx => {
                const current = await get(tx, stores.outbox, id, mutationId); if (!current) return null;
                const next = { ...current, state }; put(tx, stores.outbox, id, mutationId, next); return next;
            }, options);
        }
        async function acknowledge(rawScope, operation, response, options) {
            const { id } = capture(rawScope, options), candidate = M.normalizeCandidate(response?.candidate || response),archive=archiveReceipt(response?.archive,operation.archiveRequired===true);
            return transaction([stores.candidates, stores.outbox, stores.receipts], 'readwrite', async tx => {
                const current = await get(tx, stores.outbox, id, operation.mutationId), receipt = await get(tx, stores.receipts, id, operation.mutationId);
                if (candidate.id !== operation.candidateId || !receipt || receipt.signature !== operation.signature
                    || current && current.signature !== operation.signature) throw Object.assign(new Error('MTL acknowledgement identifies another operation.'), { code: 'MTL_RECEIPT_MISMATCH' });
                const previous = await get(tx, stores.candidates, id, candidate.id), next = M.mergeCandidate(previous, candidate);
                if (candidate.status !== 'dismissed' || candidate.revision <= operation.requestBody.candidateRevision) throw new Error('MTL dismissal acknowledgement is invalid.');
                put(tx, stores.candidates, id, next.id, next); del(tx, stores.outbox, id, operation.mutationId);
                put(tx, stores.receipts, id, operation.mutationId, { ...receipt, acknowledged: true, candidateRevision: candidate.revision,...(archive?{archive}:{}) });
                return next;
            }, options);
        }
        return { list, getCandidate, putCandidate, getReview, listReviews, putReview, archiveReview, getMetadata, getGeneration, getGenerations, putGeneration, deleteGeneration, applyRemote, dismiss,
            getOutbox, markSending, acknowledge, normalizeScope, scopeKey };
    }
    return { stores, names, upgrade, normalizeScope, scopeKey, normalizeReview, normalizeReviewRecovery, normalizeGeneration,dismissalInput,archiveReceipt, guard, create, validateAcceptancesTx, resolveAcceptancesTx };
});
