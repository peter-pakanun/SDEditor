/* Disposable ClientText workspaces for offline workbook testing. */
(function (root, factory) {
    const state = root.ClientTextState || (typeof require === 'function' ? require('./clientTextState.js') : null);
    const store = root.ClientTextStore || (typeof require === 'function' ? require('./clientTextStore.js') : null);
    const adapters = root.ContentAdapters || (typeof require === 'function' ? require('./contentAdapters.js') : null);
    const api = factory(state, store, adapters);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.ClientTextMemoryStore = api;
})(typeof globalThis === 'object' ? globalThis : self, function (S, C, A) {
    'use strict';
    const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
    function normalizeScope(input) {
        const scope = C.normalizeScope(input);
        if (!scope.groupId.startsWith('local:test:')) throw new TypeError('Offline test sheets require a local:test: group.');
        return scope;
    }
    const scopeKey = input => C.scopeKey(normalizeScope(input));
    // Parsed sheet metadata is small; the complete unit catalog is held once.
    // Blob/File originals are immutable and retain their exact native package.
    function copyAsset(asset) {
        if (!asset) return undefined;
        const { units, ...parsed } = asset.parsed || {};
        return { ...asset, ...(asset.parsed ? { parsed: S.copy(parsed) } : {}),
            ...(asset.descriptor ? { descriptor: S.copy(asset.descriptor) } : {}) };
    }
    function create(dependencies = {}) {
        const workspaces = new Map();
        const mtlApi=globalThis.ClientTextMtlMemoryStore || (typeof require==='function' ? require('./clientTextMtlMemoryStore.js') : null);
        const mtl=mtlApi?.create();
        let disposed = false;
        const pause = dependencies.yield || (() => new Promise(resolve => setTimeout(resolve, 0)));
        function guard(options) {
            if (disposed) throw Object.assign(new Error('The offline test sheet session was closed.'), { code: 'LOCAL_TEST_DISPOSED', stale: true });
            if (options?.signal?.aborted) throw Object.assign(new Error('ClientText work was cancelled.'), { name: 'AbortError', stale: true });
            if (options?.guard && !options.guard()) throw Object.assign(new Error('ClientText context changed.'), { stale: true });
        }
        function capture(input, options) {
            guard(options);
            const scope = normalizeScope(input);
            return { scope, id: scopeKey(scope) };
        }
        function ready(captured) {
            const workspace = workspaces.get(captured.id);
            if (!workspace) throw new Error('ClientText workspace is not prepared.');
            return workspace;
        }
        async function importContent(rawScope, input, options = {}) {
            const captured = capture(rawScope, options);
            if (!Array.isArray(input?.units) || !input.units.length) throw new TypeError('ClientText import contains no units.');
            const assets = Array.isArray(input.assets) ? input.assets : Object.entries(input.assets || {}).map(([role, asset]) => ({ role, ...asset }));
            const units = [], byId = new Map(), counts = {}, summaries = {};
            // The caller transfers immutable parsed originals to this session.
            // Keep their records rather than copying/freezing a large corpus.
            for (let index = 0; index < input.units.length; index++) {
                guard(options);
                const unit = input.units[index];
                if (!unit || unit.id !== JSON.stringify([unit.role, unit.sheet, unit.recordId]) || byId.has(unit.id)
                    || !unit.sheet || !unit.recordId || !Array.isArray(unit.fields) || !unit.fields.length) throw new TypeError('Invalid or duplicate ClientText original unit.');
                byId.set(unit.id, unit); units.push(unit); counts[unit.role] = (counts[unit.role] || 0) + 1;
                if (!input.summaries) S.addOriginalSummary(summaries[unit.role] ||= S.emptySummary(), unit);
                if (index % 256 === 255) {
                    options.onProgress?.({ phase: 'originals', processed: index + 1, total: input.units.length, sheet: unit.sheet });
                    await pause(); guard(options);
                }
            }
            const built = input.descriptors ? { descriptors: input.descriptors, summaries: input.summaries || summaries }
                : await S.buildDescriptors(units, assets, { ...options, yield: pause, guard: () => { guard(options); return true; } });
            guard(options);
            if (!Array.isArray(built.descriptors) || built.descriptors.length !== Object.keys(counts).length) throw new TypeError('ClientText original descriptors do not match the workbook bundle.');
            const assetMap = new Map(), roles = new Set();
            for (const descriptor of built.descriptors) {
                const asset = assets.find(value => value.role === descriptor.role);
                if (!asset || roles.has(descriptor.role) || descriptor.unitCount !== counts[descriptor.role]) throw new TypeError('ClientText original descriptor does not match its units.');
                S.originalCacheKey(descriptor.assetHash, descriptor.parserVersion, descriptor.role, descriptor);
                if ((asset.hash || asset.assetHash || asset.artifactHash) !== descriptor.assetHash) throw new TypeError('ClientText original asset does not match its descriptor.');
                roles.add(descriptor.role);
                assetMap.set(descriptor.role, copyAsset({ ...asset, descriptor }));
            }
            const signature = S.hash({ descriptors: built.descriptors, unitCount: units.length });
            const previous = workspaces.get(captured.id);
            if (previous) {
                if (previous.metadata.signature !== signature) throw new Error('ClientText originals are immutable. Open a changed workbook as a new test sheet.');
                return S.copy(previous.metadata);
            }
            const metadata = { ...S.copy(input.metadata || {}), ...captured.scope, state: 'ready',
                storageProtocol: S.STORAGE_PROTOCOL, signature, descriptors: S.copy(built.descriptors), summaries: S.copy(built.summaries || summaries),
                imported: units.length, unitCount: units.length, createdAt: Date.now(), sequence: 0, localTest: true };
            guard(options);
            // Vue.markRaw adds its marker to this array during activation.
            // Records remain owned originals; edit/save overlays never mutate them.
            workspaces.set(captured.id, { metadata, units, byId, assets: assetMap,
                saved: new Map(), drafts: new Map(), history: new Map(), receipts: new Map(), memory: new Map(), memorySeeded: false });
            return S.copy(metadata);
        }
        async function getMetadata(rawScope, options) {
            return S.copy(workspaces.get(capture(rawScope, options).id)?.metadata);
        }
        async function listWorkspaces(filter = {}, options) {
            guard(options);
            return [...workspaces.values()].map(value => value.metadata)
                .filter(scope => ['accountId', 'game', 'branchId', 'language'].every(key => !filter[key] || scope[key] === filter[key])).map(S.copy);
        }
        async function seedPreviousVersion(rawScope, rawPreviousScope, options = {}) {
            const captured = capture(rawScope, options), previous = capture(rawPreviousScope, options);
            if (captured.id === previous.id || ['accountId', 'game', 'branchId', 'language'].some(key => captured.scope[key] !== previous.scope[key]))
                throw new TypeError('Previous test workbooks must match the current account, game, branch and language.');
            const workspace = ready(captured), predecessor = ready(previous), records = [];
            if (workspace.metadata.previousScope) {
                if (scopeKey(workspace.metadata.previousScope) !== previous.id) throw new Error('The previous test version is already selected.');
                return;
            }
            if (workspace.saved.size || workspace.history.size || workspace.drafts.size) throw new Error('Prepare the previous test version before editing.');
            for (let index = 0; index < workspace.units.length; index++) {
                const unit = workspace.units[index], old = predecessor.byId.get(unit.id);
                if (old) {
                    const state = S.carryForward(old, unit, null), markerReview = S.reviewAudioMarkerChanges(old, unit, state);
                    if (state.outdated.length || markerReview) {
                        const before = new Map(old.fields.map(field => [field.id, field])), requiredReview = {};
                        for (const field of unit.fields) if (before.has(field.id) && S.sourceHash(before.get(field.id).source) !== S.sourceHash(field.source)
                            && !S.audioOnly(field.source) && S.needsSourceReview(field, state.values[field.id])) requiredReview[field.id] = S.sourceHash(field.source);
                        const provenance = { groupId: previous.scope.groupId, unitId: unit.id, revision: 0, sourceOnly: true,
                            requiredReview, conflicts: state.conflicts, origin: 'version_import' };
                        const after = { unitId: unit.id, values: state.values, reviewed: state.reviewed, saved: false, revision: 1,
                            serverRevision: 0, provenance, conflicts: state.conflicts,
                            outdated: Object.keys(requiredReview).filter(id => state.reviewed[id] !== requiredReview[id]) };
                        records.push({ id: 'test-version-import:' + unit.id, unitId: unit.id, origin: 'version_import',
                            actor: { name: 'Previous workbook sample' }, createdAt: Date.now(),
                            before: { unitId: unit.id, values: S.valuesFor(unit), reviewed: {}, revision: 0 }, after });
                    }
                }
                if (index % 256 === 255) {
                    options.onProgress?.({ phase: 'Comparing previous workbook', processed: index + 1, total: workspace.units.length, sheet: unit.sheet });
                    await pause(); guard(options);
                }
            }
            guard(options);
            for (const entry of records) { workspace.saved.set(entry.unitId, entry.after); workspace.history.set(entry.unitId, [entry]); }
            workspace.metadata.previousScope = S.copy(previous.scope);
        }
        async function getUnits(rawScope, options) { return ready(capture(rawScope, options)).units; }
        async function getUnit(rawScope, unitId, options) { return S.copy(ready(capture(rawScope, options)).byId.get(unitId)); }
        async function getUnitsByIds(rawScope, unitIds, options) {
            const workspace=ready(capture(rawScope,options));
            return [...new Set(unitIds)].map(unitId=>{
                const unit=workspace.byId.get(unitId);
                if(!unit)throw new Error('Saved ClientText unit is absent from its immutable original: '+unitId+'.');
                return S.copy(unit);
            });
        }
        async function getSaved(rawScope, options) {
            const workspace = workspaces.get(capture(rawScope, options).id);
            return workspace ? Object.fromEntries([...workspace.saved].map(([id, value]) => [id, S.copy(value)])) : {};
        }
        async function getAsset(rawScope, role = 'normal', options) { return copyAsset(ready(capture(rawScope, options)).assets.get(role)); }
        async function putDraft(rawScope, unitId, input, options = {}) {
            const workspace = ready(capture(rawScope, options)), unit = workspace.byId.get(unitId);
            if (!unit) throw new Error('ClientText draft source is unavailable.');
            const values = S.normalizeValues(unit, input?.values), reviewed = S.normalizeReviewed(unit, input?.reviewed || {});
            const previous = workspace.drafts.get(unitId);
            if (own(options, 'expectedRevision') && (previous?.revision || null) !== options.expectedRevision) throw Object.assign(new Error('This ClientText draft changed.'), { code: 'DRAFT_CHANGED' });
            const draft = { unitId, values, reviewed, revision: (previous?.revision || 0) + 1, updatedAt: Date.now(),
                ...(input.mtlAcceptances?.length ? {mtlAcceptances:S.copy(input.mtlAcceptances)} : {}) };
            guard(options); workspace.drafts.set(unitId, draft); return S.copy(draft);
        }
        async function getDraft(rawScope, unitId, options) {
            return S.copy(workspaces.get(capture(rawScope, options).id)?.drafts.get(unitId));
        }
        async function getDraftSummaries(rawScope, options) {
            const workspace = workspaces.get(capture(rawScope, options).id);
            return workspace ? [...workspace.drafts.values()].map(({ unitId, revision, updatedAt }) => ({ unitId, revision, updatedAt })) : [];
        }
        async function discardDraft(rawScope, unitId, options = {}) {
            const workspace = workspaces.get(capture(rawScope, options).id), draft = workspace?.drafts.get(unitId);
            if (own(options, 'expectedRevision') && (draft?.revision || null) !== options.expectedRevision) throw Object.assign(new Error('This ClientText draft changed.'), { code: 'DRAFT_CHANGED' });
            guard(options); workspace?.drafts.delete(unitId); return true;
        }
        async function save(rawScope, unitId, input, options = {}) {
            const captured = capture(rawScope, options), workspace = ready(captured), unit = workspace.byId.get(unitId);
            if (!unit) throw new Error('ClientText save source is unavailable.');
            if (!input?.jobId || typeof input.jobId !== 'string') throw new TypeError('ClientText save requires a stable job ID.');
            if (own(input, 'origin') && !['save', 'restore'].includes(input.origin)) throw new TypeError('ClientText save origin must be save or restore.');
            const values = S.normalizeValues(unit, input.values), reviewed = S.normalizeReviewed(unit, input.reviewed || {});
            const command = { scope: captured.scope, unitId, values, reviewed,
                ...(input.mtlAcceptances?.length ? {mtlAcceptances:S.copy(input.mtlAcceptances)} : {}),
                ...(own(input, 'origin') ? { origin: input.origin } : {}),
                ...(own(input, 'baseRevision') ? { baseRevision: input.baseRevision } : {}),
                ...(own(input, 'expectedRevision') ? { expectedRevision: input.expectedRevision } : {}),
                ...(own(input, 'expectedDraftRevision') ? { expectedDraftRevision: input.expectedDraftRevision } : {}) };
            const signature = S.hash(command), receipt = workspace.receipts.get(input.jobId);
            if (receipt) {
                if (receipt.signature !== signature) throw Object.assign(new Error('ClientText job ID was reused for different content.'), { code: 'SAVE_RECEIPT_MISMATCH' });
                return { saved: S.copy(receipt.saved), receipt: S.copy(receipt), replayed: true };
            }
            const before = workspace.saved.get(unitId), draft = workspace.drafts.get(unitId);
            if (own(input, 'expectedRevision') && (before?.revision || 0) !== input.expectedRevision) throw Object.assign(new Error('The ClientText saved translation changed.'), { code: 'UNIT_CHANGED' });
            if (own(input, 'expectedDraftRevision') && (draft?.revision || null) !== input.expectedDraftRevision) throw Object.assign(new Error('This ClientText draft changed.'), { code: 'DRAFT_CHANGED' });
            const acceptedMtl=input.mtlAcceptances?.length ? mtl.validateAcceptances(captured.scope,unit,input.mtlAcceptances,values,workspace.metadata.descriptors.find(value=>value.role===unit.role)) : [];
            if(acceptedMtl.length && ((input.origin||options.origin)==='restore' || acceptedMtl.some(claim=>({...before?.reviewed,...reviewed})[claim.fieldId]!==claim.candidate.sourceHash)))
                throw Object.assign(new Error('MTL acceptance requires a normal Save reviewed against the current source.'),{code:'MTL_REVIEW_MISMATCH'});
            const after = { unitId, values, reviewed: { ...before?.reviewed, ...reviewed }, saved: true, revision: (before?.revision || 0) + 1,
                serverRevision: before?.serverRevision || input.baseRevision || 0, baseRevision: before?.serverRevision || input.baseRevision || 0,
                savedAt: Date.now(), jobId: input.jobId, origin: input.origin || options.origin || 'save', outdated: before?.outdated || [],
                ...(acceptedMtl.length ? {mtlAcceptances:S.copy(input.mtlAcceptances)} : {}) };
            const entry = { id: input.jobId, unitId, before: before || null, after, origin: after.origin, createdAt: after.savedAt };
            const committed = { jobId: input.jobId, signature, unitId, saved: after, committedAt: Date.now() };
            // Use the same eligibility rules as durable ClientText saves. Drafts,
            // unreviewed source changes and comparison imports never teach TM.
            const learned = A.clienttext.memoryUnits(unit, after.values, captured.scope.language,
                { game: captured.scope.game, branchId: captured.scope.branchId, jobId: input.jobId, origin: after.origin, saved: after });
            guard(options);
            if(acceptedMtl.length)mtl.resolveAcceptances(captured.scope,acceptedMtl,{jobId:input.jobId,now:after.savedAt});
            workspace.saved.set(unitId, after);
            const history = workspace.history.get(unitId) || []; history.push(entry); workspace.history.set(unitId, history);
            if (own(input, 'expectedDraftRevision')) workspace.drafts.delete(unitId);
            workspace.receipts.set(input.jobId, committed);
            for (const entry of learned) {
                const before = workspace.memory.get(entry.id);
                if (before && before.source === entry.source && before.target === entry.target && S.stableStringify(before.context) === S.stableStringify(entry.context)) continue;
                workspace.memory.set(entry.id, { ...entry, updatedAt: after.savedAt, localRevision: (before?.localRevision || 0) + 1 });
            }
            return { saved: S.copy(after), receipt: S.copy(committed), replayed: false };
        }
        async function listHistory(rawScope, unitId, options = {}) {
            const workspace = workspaces.get(capture(rawScope, options).id), records = workspace?.history.get(unitId) || [];
            return records.slice().reverse().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, options.limit || 100).map(S.copy);
        }
        async function seedMemory(rawScope, entries, options) {
            const captured = capture(rawScope, options), workspace = ready(captured);
            if (workspace.memorySeeded) return;
            const units = (entries || []).filter(entry => entry.context?.contentMode === 'clienttext'
                && (!entry.language || entry.language === captured.scope.language)
                && [captured.scope.game, 'all'].includes(entry.gameScope));
            guard(options);
            for (const entry of units) if (!workspace.memory.has(entry.id)) workspace.memory.set(entry.id, S.copy(entry));
            workspace.memorySeeded = true;
        }
        async function getMemory(rawScope, options) {
            const workspace = workspaces.get(capture(rawScope, options).id);
            const units = [...(workspace?.memory.values() || [])].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).map(S.copy);
            return { units, counts: { total: units.length, text: units.filter(unit => unit.context.fieldKind === 'text').length,
                form: units.filter(unit => unit.context.fieldKind === 'form').length } };
        }
        function dispose() { disposed = true; workspaces.clear(); mtl?.dispose(); }
        return { import: importContent, importContent, getMetadata, listWorkspaces, seedPreviousVersion, getUnits, getUnitsByIds, getUnit, getSaved, getAsset,
            putDraft, getDraft, getDraftSummaries, discardDraft, save, listHistory, seedMemory, getMemory, normalizeScope, scopeKey, mtl, dispose };
    }
    return { normalizeScope, scopeKey, create };
});
