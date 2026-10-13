/* Disposable ClientText workspaces for offline workbook testing. */
(function (root, factory) {
    const state = root.ClientTextState || (typeof require === 'function' ? require('./clientTextState.js') : null);
    const store = root.ClientTextStore || (typeof require === 'function' ? require('./clientTextStore.js') : null);
    const api = factory(state, store);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.ClientTextMemoryStore = api;
})(typeof globalThis === 'object' ? globalThis : self, function (S, C) {
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
                saved: new Map(), drafts: new Map(), history: new Map(), receipts: new Map() });
            return S.copy(metadata);
        }
        async function getMetadata(rawScope, options) {
            return S.copy(workspaces.get(capture(rawScope, options).id)?.metadata);
        }
        async function getUnits(rawScope, options) { return ready(capture(rawScope, options)).units; }
        async function getUnit(rawScope, unitId, options) { return S.copy(ready(capture(rawScope, options)).byId.get(unitId)); }
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
            const draft = { unitId, values, reviewed, revision: (previous?.revision || 0) + 1, updatedAt: Date.now() };
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
            const after = { unitId, values, reviewed: { ...before?.reviewed, ...reviewed }, saved: true, revision: (before?.revision || 0) + 1,
                serverRevision: before?.serverRevision || input.baseRevision || 0, baseRevision: before?.serverRevision || input.baseRevision || 0,
                savedAt: Date.now(), jobId: input.jobId, origin: input.origin || options.origin || 'save', outdated: before?.outdated || [] };
            const entry = { id: input.jobId, unitId, before: before || null, after, origin: after.origin, createdAt: after.savedAt };
            const committed = { jobId: input.jobId, signature, unitId, saved: after, committedAt: Date.now() };
            guard(options);
            workspace.saved.set(unitId, after);
            const history = workspace.history.get(unitId) || []; history.push(entry); workspace.history.set(unitId, history);
            if (own(input, 'expectedDraftRevision')) workspace.drafts.delete(unitId);
            workspace.receipts.set(input.jobId, committed);
            return { saved: S.copy(after), receipt: S.copy(committed), replayed: false };
        }
        async function listHistory(rawScope, unitId, options = {}) {
            const workspace = workspaces.get(capture(rawScope, options).id), records = workspace?.history.get(unitId) || [];
            return records.slice().reverse().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, options.limit || 100).map(S.copy);
        }
        async function getMemory(rawScope, options) {
            capture(rawScope, options); return { units: [], counts: { total: 0, text: 0, form: 0 } };
        }
        function dispose() { disposed = true; workspaces.clear(); }
        return { import: importContent, importContent, getMetadata, getUnits, getUnit, getSaved, getAsset,
            putDraft, getDraft, getDraftSummaries, discardDraft, save, listHistory, getMemory, normalizeScope, scopeKey, dispose };
    }
    return { normalizeScope, scopeKey, create };
});
