/* IndexedDB v9: durable facts are records; aggregate objects are read views. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NormalizedStore = api;
})(typeof window === 'object' ? window : typeof self === 'object' ? self : globalThis, function () {
  'use strict';
  const stores = {
    meta: 'translation_workspaces', baseline: 'baseline_files', assets: 'baseline_assets',
    files: 'workspace_files', records: 'workspace_records', drafts: 'translation_drafts',
    rooms: 'collaboration_rooms', shared: 'collaboration_files', operations: 'collaboration_operations',
    roomRecords: 'collaboration_records', submissions: 'save_submissions', receipts: 'save_receipts', migration: 'storage_migrations',
  };
  const names = Object.values(stores);
  const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(name => [name, canonical(value[name])])) : value;
  const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
  async function fingerprint(value) {
    const bytes = new TextEncoder().encode(JSON.stringify(canonical(value)));
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  const key = (...parts) => JSON.stringify(parts);
  const scopeKey = scope => key(scope.accountId || 'guest', scope.game, scope.branchId || 'default', scope.sourceHash || '');
  const baselineKey = scope => key(scope.game, scope.sourceHash || '');
  const request = req => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
  const done = tx => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(tx.error || new Error('Storage transaction aborted.')); });
  function upgrade(db, tx) {
    for (const name of names) {
      const store = db.objectStoreNames.contains(name) ? tx.objectStore(name) : db.createObjectStore(name, { keyPath: 'key' });
      if (!store.indexNames.contains('by_scope')) store.createIndex('by_scope', 'scope');
      if ([stores.records, stores.shared, stores.files].includes(name) && !store.indexNames.contains('by_path')) store.createIndex('by_path', 'pathKey');
      if ([stores.records, stores.roomRecords].includes(name) && !store.indexNames.contains('by_kind')) store.createIndex('by_kind', 'kindScope');
      if ([stores.operations, stores.roomRecords, stores.submissions].includes(name) && !store.indexNames.contains('by_path')) store.createIndex('by_path', 'paths', { multiEntry: true });
      if (name === stores.drafts && !store.indexNames.contains('by_profile_lang')) store.createIndex('by_profile_lang', 'profileLanguage');
      if (name === stores.drafts && !store.indexNames.contains('by_scope_language')) store.createIndex('by_scope_language', 'scopeLanguage');
    }
  }
  function create(dependencies) {
    const { openDb, W, legacyGet, workspaceKey, sourceKey, receiptKey, revisionStoreName, scopedRevision, normalizeScope, legacyBaseline } = dependencies;
    const migrations = new Map();
    const row = (scope, id, value, extra = {}) => ({ key: key(scope, id), scope, value: copy(value), ...extra });
    const get = async (tx, name, id) => (await request(tx.objectStore(name).get(id)))?.value;
    const all = (tx, name, scope) => request(tx.objectStore(name).index('by_scope').getAll(scope));
    async function transaction(selected, mode, action) {
      const db = await openDb(), tx = db.transaction([...new Set(selected)], mode), completion = done(tx);
      try { const result = await action(tx); await completion; return result; }
      catch (error) { try { tx.abort(); } catch (_) {} await completion.catch(() => {}); throw error; }
    }
    async function available() { return !!(await openDb()).objectStoreNames?.contains(stores.meta); }
    async function normalizeHistory(game, selectedStore) {
      const name = selectedStore || revisionStoreName(game), marker = key('history', name);
      let progress = await transaction([stores.migration], 'readonly', tx => get(tx, stores.migration, marker));
      if (progress?.state === 'ready') return;
      for (;;) {
        progress = await transaction([name, stores.migration], 'readwrite', async tx => {
          const current = await get(tx, stores.migration, marker);
          if (current?.state === 'ready') return current;
          const range = current?.lastId == null ? undefined : IDBKeyRange.lowerBound(current.lastId, true);
          const rows = await request(tx.objectStore(name).getAll(range, 128));
          for (const value of rows) {
            const normalized = { ...value, accountId: String(value.accountId || value.collaborationAccountId || 'guest'), branchId: value.branchId || 'default', sourceHash: value.sourceHash || '' };
            if (!same(value, normalized)) tx.objectStore(name).put(normalized);
          }
          const next = rows.length < 128 ? { state: 'ready' } : { state: 'converting', lastId: rows[rows.length - 1].id };
          tx.objectStore(stores.migration).put({ key: marker, scope: marker, value: next });
          return next;
        });
        if (progress.state === 'ready') return;
      }
    }
    const fieldMaps = ['status', 'staged', 'dropped', 'droppedArchive', 'droppedOutbox', 'droppedAliases', 'droppedConflicts', 'droppedAssignments', 'placeholderRepairArchive'];
    const languageMaps = new Set(['staged', 'dropped', 'droppedConflicts', 'droppedAssignments']);
    function splitWorkspace(scope, workspace, originals = new Map()) {
      const id = scopeKey(scope), meta = {}, files = [], records = [];
      for (const [field, value] of Object.entries(workspace || {})) if (!['_storageSelection', '_storageArchiveKinds', 'descs', 'importRecovery'].includes(field) && !fieldMaps.includes(field)) meta[field] = value;
      if (meta.importArchive) {
        const { decisions, ...descriptor } = meta.importArchive;
        meta.importArchive = descriptor;
      }
      meta.nextDroppedOrder = Math.max(Number(meta.nextDroppedOrder || 0), workspace?.droppedOutbox?.length || 0);
      if (Array.isArray(workspace?.importRecovery) || workspace?._storageArchiveKinds?.includes('importRecovery')) meta._storageArchiveKinds = ['importRecovery'];
      for (const desc of workspace?.descs || []) {
        const original = originals.get(desc.filepath), overrides = {};
        for (const [field, value] of Object.entries(desc)) if (field !== 'translations' && !['hasChanges', 'isMissing', 'needsReview', 'isDropped', 'isRevised', 'languageStatus', 'statusLanguage'].includes(field)
          && (!original || !same(value, original[field]))) overrides[field] = value;
        const value = { filepath: desc.filepath, overrides, languages: Object.keys(desc.translations || {}) };
        if (!original) value.fallback = desc;
        files.push(row(id, desc.filepath, value, { pathKey: key(id, desc.filepath) }));
      }
      for (const field of fieldMaps) {
        const map = workspace?.[field] || {};
        for (const [outer, value] of Object.entries(map)) {
          if (languageMaps.has(field)) for (const [entry, item] of Object.entries(value || {})) records.push(row(id, [field, outer, entry], { field, language: outer, entry, data: item }, { pathKey: key(id, item?.filepath || entry), kindScope: key(id, field) }));
          else {
            const entry = field === 'droppedOutbox' ? key(value.id, value.kind) : outer;
            const path = value?.filepath || value?.candidate?.filepath || workspace.droppedArchive?.[outer]?.filepath || workspace.droppedArchive?.[value?.id]?.filepath || outer;
            records.push(row(id, [field, entry], { field, entry, data: value, ...(field === 'droppedOutbox' ? { order: Number(outer) } : {}) }, { pathKey: key(id, path), kindScope: key(id, field) }));
          }
        }
      }
      for (const [entry, recovery] of (workspace?.importRecovery || []).entries()) {
        const metadata = copy(recovery);
        if (Array.isArray(metadata?.descs)) metadata.descs = [];
        if (metadata?.status && typeof metadata.status === 'object' && !Array.isArray(metadata.status)) metadata.status = {};
        // Archived work is cold data. These records intentionally have no
        // by_path entry, so ordinary saves never read or rewrite them.
        records.push(row(id, ['importRecovery', entry, 'group'], { field: 'importRecovery', kind: 'group', entry, data: metadata }, { kindScope: key(id, 'importRecovery') }));
        for (const [order, desc] of (Array.isArray(recovery?.descs) ? recovery.descs : []).entries()) records.push(row(id, ['importRecovery', entry, 'desc', order],
          { field: 'importRecovery', kind: 'desc', entry, order, data: desc }, { kindScope: key(id, 'importRecovery') }));
        for (const [statusKey, data] of Object.entries(recovery?.status && typeof recovery.status === 'object' && !Array.isArray(recovery.status) ? recovery.status : {})) records.push(row(id, ['importRecovery', entry, 'status', statusKey],
          { field: 'importRecovery', kind: 'status', entry, statusKey, data }, { kindScope: key(id, 'importRecovery') }));
      }
      return { meta, files, records };
    }
    function assembleWorkspace(meta, fileRows, recordRows, originals, includeArchives = true) {
      if (!meta) return undefined;
      const workspace = { ...copy(meta), descs: [] };
      for (const field of fieldMaps) workspace[field] = field === 'droppedOutbox' ? [] : {};
      const archives = [];
      for (const item of recordRows) {
        const { field, language, entry, data } = item.value;
        if (field === 'importRecovery') archives.push(item.value);
        else if (field === 'droppedOutbox') workspace[field].push(copy(data));
        else if (language != null) (workspace[field][language] ||= {})[entry] = copy(data);
        else workspace[field][entry] = copy(data);
      }
      for (const item of fileRows) {
        const file = item.value, original = originals.get(file.filepath);
        const desc = { ...copy(original || file.fallback || { filepath: file.filepath, translations: {} }), ...copy(file.overrides) };
        desc.translations ||= {};
        for (const [language, entries] of Object.entries(workspace.staged)) if (Object.hasOwn(entries, file.filepath)) desc.translations[language] = copy(entries[file.filepath].translations);
        workspace.descs.push(desc);
      }
      if (includeArchives) {
        if (meta._storageArchiveKinds?.includes('importRecovery') || archives.length) workspace.importRecovery = [];
        for (const { entry, data } of archives.filter(value => value.kind === 'group')) workspace.importRecovery[entry] = copy(data);
        for (const item of archives) {
          if (item.kind === 'desc') workspace.importRecovery[item.entry].descs[item.order] = copy(item.data);
          else if (item.kind === 'status') workspace.importRecovery[item.entry].status[item.statusKey] = copy(item.data);
        }
        delete workspace._storageArchiveKinds;
      } else delete workspace.importRecovery;
      return workspace;
    }
    async function readWorkspace(tx, scope, filepaths, includeDropped = true, allDropped = false) {
      const id = scopeKey(scope), meta = await get(tx, stores.meta, id);
      if (!meta) return undefined;
      let files, records;
      if (filepaths == null) { [files, records] = await Promise.all([all(tx, stores.files, id), all(tx, stores.records, id)]); }
      else {
        files = (await Promise.all(filepaths.map(path => request(tx.objectStore(stores.files).get(key(id, path)))))).filter(Boolean);
        records = (await Promise.all(filepaths.map(path => request(tx.objectStore(stores.records).index('by_path').getAll(key(id, path)))))).flat();
        // Alias/provenance keys are IDs rather than paths. Include only records
        // referring to the selected candidates, never all translation files.
        if (allDropped) records.push(...(await Promise.all(fieldMaps.filter(field => field.startsWith('dropped')).map(field => request(tx.objectStore(stores.records).index('by_kind').getAll(key(id, field)))))).flat());
        if (includeDropped) {
          const ids = new Set(records.filter(r => r.value.field === 'dropped').map(r => r.value.data?.id));
          const related = await Promise.all([...ids].filter(Boolean).flatMap(candidate => ['droppedArchive', 'droppedAliases', 'droppedOutbox'].map(field => request(tx.objectStore(stores.records).get(key(id, [field, candidate]))))));
          records.push(...related.filter(Boolean));
        }
      }
      const originals = new Map((await Promise.all(files.map(item => get(tx, stores.baseline, key(baselineKey(scope), item.value.filepath))))).filter(Boolean).map(desc => [desc.filepath, desc]));
      const workspace = assembleWorkspace(meta, files, [...new Map(records.map(r => [r.key, r])).values()].sort((a,b) => (a.value.order || 0) - (b.value.order || 0)), originals, filepaths == null);
      if (filepaths == null && workspace.importArchive) {
        const retained = await get(tx, stores.assets, baselineKey(scope));
        if (!retained?.archive) throw new Error('The accepted archive descriptor is unavailable. Reimport its matching original ZIP.');
        workspace.importArchive = copy(retained.archive);
      }
      if (filepaths != null) workspace._storageSelection = { filepaths, allDropped };
      return workspace;
    }
    async function writeDifference(tx, name, previous, next) {
      const before = new Map(previous.map(item => [item.key, item])), after = new Map(next.map(item => [item.key, item]));
      const store = tx.objectStore(name);
      for (const [id, item] of after) if (!same(before.get(id), item)) store.put(item);
      for (const id of before.keys()) if (!after.has(id)) store.delete(id);
    }
    async function writeWorkspace(tx, scope, workspace, filepaths) {
      if (!workspace) return;
      W.pruneWorkspaceStatus(workspace);
      const id = scopeKey(scope), paths = filepaths || workspace.descs.map(file => file.filepath);
      const originals = new Map((await Promise.all(paths.map(path => get(tx, stores.baseline, key(baselineKey(scope), path))))).filter(Boolean).map(desc => [desc.filepath, desc]));
      const parts = splitWorkspace(scope, workspace, originals), beforeMeta = await get(tx, stores.meta, id);
      if (filepaths != null) parts.records = parts.records.filter(item => item.value.field !== 'importRecovery');
      let oldFiles, oldRecords;
      if (filepaths == null) [oldFiles, oldRecords] = await Promise.all([all(tx, stores.files, id), all(tx, stores.records, id)]);
      else {
        oldFiles = (await Promise.all(paths.map(path => request(tx.objectStore(stores.files).get(key(id, path)))))).filter(Boolean);
        oldRecords = (await Promise.all(paths.map(path => request(tx.objectStore(stores.records).index('by_path').getAll(key(id, path)))))).flat();
        for (const candidate of Object.keys(workspace.droppedAliases || {})) {
          const previous = await request(tx.objectStore(stores.records).get(key(id, ['droppedAliases', candidate])));
          if (previous) oldRecords.push(previous);
        }
      }
      if (filepaths != null) {
        const previous = new Map(oldRecords.map(item => [item.key, item]));
        let nextOrder = Number(beforeMeta?.nextDroppedOrder || 0);
        for (const item of parts.records) if (item.value.field === 'droppedOutbox') {
          item.value.order = previous.get(item.key)?.value.order ?? nextOrder++;
        }
        parts.meta.nextDroppedOrder = nextOrder;
      }
      if (!same(beforeMeta, parts.meta)) tx.objectStore(stores.meta).put({ key: id, scope: id, value: copy(parts.meta) });
      await writeDifference(tx, stores.files, oldFiles, parts.files);
      await writeDifference(tx, stores.records, [...new Map(oldRecords.map(r => [r.key, r])).values()], parts.records);
    }
    async function migrate(scope, legacyWorkspace, legacySource, baseline) {
      const id = scopeKey(scope);
      if (migrations.has(id)) return migrations.get(id);
      const work = (async () => {
        const ready = await transaction([stores.migration], 'readonly', tx => get(tx, stores.migration, id));
        if (ready?.state === 'ready') return;
        const workspace = legacyWorkspace ?? await dependencies.prepareWorkspace?.(scope) ?? await legacyGet(workspaceKey(scope));
        if (!workspace) return;
        baseline ||= await legacyBaseline?.(workspace, scope);
        const source = legacySource ?? baseline?.source ?? await legacyGet(sourceKey(scope));
        if (!Array.isArray(source)) throw new Error('The original source is unavailable. Reimport its matching ZIP to finish storage conversion. Existing work has been retained.');
        if (baseline && !same(baseline.source, source)) throw new Error('Retained source records disagree. Existing work has been kept for recovery.');
        const P = typeof window === 'object' ? window.CollaborationProtocol : typeof self === 'object' ? self.CollaborationProtocol : null;
        if (workspace.importArchive) {
          if (!baseline || baseline.archive?.baselineId !== scope.sourceHash || baseline.tree?.root !== baseline.archive.treeRoot)
            throw new Error('The accepted baseline evidence is incomplete. Reimport the matching original ZIP.');
          if (P) {
            const archive = await P.finalizeArchive(baseline.archive), tree = await P.buildBaselineTree(source);
            if (archive.baselineId !== scope.sourceHash || tree.root !== archive.treeRoot) throw new Error('The retained files do not reproduce their accepted baseline.');
          }
        } else if (P && /^[a-f0-9]{64}$/.test(scope.sourceHash) && await P.sourceHash(source) !== scope.sourceHash) {
          throw new Error('The retained source differs from its saved version identity.');
        }
        W.initializeWorkspace(workspace, { source, sourceHash: scope.sourceHash, game: scope.game });
        W.pruneWorkspaceStatus(workspace);
        const originals = new Map(source.map(desc => [desc.filepath, desc])), parts = splitWorkspace(scope, workspace, originals);
        const baseId = baselineKey(scope);
        const items = [...source.map((desc, order) => [stores.baseline, row(baseId, desc.filepath, desc, { order })]), ...parts.files.map(value => [stores.files, value]), ...parts.records.map(value => [stores.records, value])];
        const evidenceHash = await fingerprint([source, parts, scope]);
        let offset = ready?.fingerprint === evidenceHash ? ready.offset || 0 : 0;
        if (!offset && await transaction([stores.files, stores.records, stores.migration], 'readwrite', async tx => {
          if ((await get(tx, stores.migration, id))?.state === 'ready') return true;
          for (const name of [stores.files, stores.records]) for (const item of await all(tx, name, id)) tx.objectStore(name).delete(item.key);
          tx.objectStore(stores.migration).put({ key: id, scope: id, value: { state: 'converting', offset: 0, fingerprint: evidenceHash } });
          return false;
        })) return;
        for (; offset < items.length; offset += 256) {
          const batch = items.slice(offset, offset + 256);
          if (await transaction([...batch.map(item => item[0]), stores.migration], 'readwrite', async tx => {
            if ((await get(tx, stores.migration, id))?.state === 'ready') return true;
            for (const [name, value] of batch) if (name === stores.baseline) {
              const prior = await get(tx, name, value.key);
              if (prior && !same(prior, value.value)) throw new Error('Retained baselines disagree for one accepted source identity. Original data has been retained.');
            }
            for (const [name, value] of batch) tx.objectStore(name).put(value);
            tx.objectStore(stores.migration).put({ key: id, scope: id, value: { state: 'converting', offset: offset + batch.length, fingerprint: evidenceHash } });
            return false;
          })) return;
        }
        const receipts = await legacyGet(receiptKey(scope)) || [];
        await normalizeHistory(scope.game);
        await transaction([stores.meta, stores.assets, stores.migration, stores.receipts, stores.baseline, stores.files, stores.records], 'readwrite', async tx => {
          if ((await get(tx, stores.migration, id))?.state === 'ready') return;
          const savedSource = await all(tx, stores.baseline, baseId), savedFiles = await all(tx, stores.files, id), savedRecords = await all(tx, stores.records, id);
          const restored = assembleWorkspace(parts.meta, savedFiles, savedRecords, new Map(savedSource.map(r => [r.value.filepath, r.value])));
          if (!same(savedSource.map(r => r.value).sort((a,b) => a.filepath.localeCompare(b.filepath)), source.slice().sort((a,b) => a.filepath.localeCompare(b.filepath))))
            throw new Error('Baseline conversion verification failed. Original data has been retained.');
          for (const field of fieldMaps) if (!same(restored[field] || {}, workspace[field] || {})) throw new Error('Workspace conversion verification failed: ' + field);
          if (!same(restored.importRecovery, workspace.importRecovery)) throw new Error('Import recovery conversion verification failed.');
          tx.objectStore(stores.meta).put({ key: id, scope: id, value: parts.meta });
          const assets = baseline ? { ...copy(baseline), source: undefined } : { sourceHash: scope.sourceHash };
          tx.objectStore(stores.assets).put({ key: baseId, scope: baseId, value: assets });
          for (const receipt of receipts) tx.objectStore(stores.receipts).put(row(id, receipt.jobId, receipt));
          tx.objectStore(stores.migration).put({ key: id, scope: id, value: { state: 'ready' } });
        });
      })();
      migrations.set(id, work);
      try { return await work; } finally { migrations.delete(id); }
    }
    async function ensure(scope) { if (scope?.sourceHash) await migrate(scope); }
    async function workspace(scope, options = {}) {
      await ensure(scope);
      return transaction([stores.meta, stores.files, stores.records, stores.baseline, stores.assets], 'readonly', tx => readWorkspace(tx, scope, options.filepaths, options.includeDropped, options.allDropped));
    }
    async function source(scope) {
      await ensure(scope);
      return transaction([stores.baseline], 'readonly', async tx => (await all(tx, stores.baseline, baselineKey(scope))).sort((a,b) => (a.order || 0) - (b.order || 0)).map(row => row.value));
    }
    async function saveWorkspace(scope, value, options = {}) {
      await ensure(scope);
      return transaction([stores.meta, stores.files, stores.records, stores.baseline, stores.assets, ...(options.revisions?.length ? [revisionStoreName(scope.game)] : [])], 'readwrite', async tx => {
        const current = await readWorkspace(tx, scope, options.filepaths, options.includeDropped);
        const next = typeof value === 'function' ? value(current) : value;
        if (next?.then) throw new Error('Workspace changes must be synchronous.');
        await writeWorkspace(tx, scope, next, options.filepaths);
        for (const revision of options.revisions || []) tx.objectStore(revisionStoreName(scope.game)).add(scopedRevision(revision, scope));
        return next;
      });
    }
    async function importScope(scope, source, workspace, revisions, assets, metadataRows = []) {
      if (!Array.isArray(source)) throw new TypeError('A source import requires its immutable files.');
      W.initializeWorkspace(workspace, { source, sourceHash: scope.sourceHash, game: scope.game, branchId: scope.branchId, accountId: scope.accountId });
      W.pruneWorkspaceStatus(workspace);
      const id = scopeKey(scope), baseId = baselineKey(scope), originals = new Map(source.map(file => [file.filepath, file]));
      const parts = splitWorkspace(scope, workspace, originals);
      await transaction([stores.meta, stores.baseline, stores.assets, stores.files, stores.records, stores.migration, 'kv', revisionStoreName(scope.game)], 'readwrite', async tx => {
        // Existing identities are immutable. An import may update staged facts,
        // but cannot change an accepted source under the same identity.
        for (const [order, file] of source.entries()) {
          const previous = await get(tx, stores.baseline, key(baseId, file.filepath));
          if (previous && !same(previous, file)) throw new Error('The imported source differs from its accepted baseline identity.');
          if (!previous) tx.objectStore(stores.baseline).put(row(baseId, file.filepath, file, { order }));
        }
        await writeDifference(tx, stores.files, await all(tx, stores.files, id), parts.files);
        await writeDifference(tx, stores.records, await all(tx, stores.records, id), parts.records);
        tx.objectStore(stores.meta).put({ key: id, scope: id, value: parts.meta });
        const previousAssets = await get(tx, stores.assets, baseId);
        if (workspace.importArchive && !assets?.archive && !previousAssets?.archive) throw new Error('The accepted archive assets are required for an atomic source import.');
        const retained = assets ? { ...copy(assets) } : previousAssets || { sourceHash: scope.sourceHash };
        delete retained.source;
        if (!same(previousAssets, retained)) tx.objectStore(stores.assets).put({ key: baseId, scope: baseId, value: retained });
        for (const revision of revisions || []) tx.objectStore(revisionStoreName(scope.game)).add(scopedRevision(revision, scope));
        for (const item of metadataRows) tx.objectStore('kv').put(item);
        tx.objectStore(stores.migration).put({ key: id, scope: id, value: { state: 'ready' } });
      });
    }
    async function assets(scope) {
      await ensure(scope);
      return transaction([stores.assets, stores.baseline], 'readonly', async tx => {
        const value = await get(tx, stores.assets, baselineKey(scope));
        return value && { ...value, source: (await all(tx, stores.baseline, baselineKey(scope))).sort((a,b) => (a.order || 0) - (b.order || 0)).map(row => row.value) };
      });
    }
    async function hasScope(scope) {
      return transaction([stores.meta], 'readonly', async tx => !!await get(tx, stores.meta, scopeKey(scope)));
    }
    async function clearScope(scope) {
      await ensure(scope);
      return transaction([stores.meta, stores.files, stores.records, stores.migration], 'readwrite', async tx => {
        const id = scopeKey(scope);
        for (const name of [stores.files, stores.records]) for (const item of await all(tx, name, id)) tx.objectStore(name).delete(item.key);
        tx.objectStore(stores.meta).delete(id);
        tx.objectStore(stores.migration).put({ key: id, scope: id, value: { state: 'ready', removed: true } });
      });
    }
    function mergeWorkspaceRecords(target, patch) {
      if (!patch?._storageSelection) return patch;
      if (!target) return patch;
      const { filepaths, allDropped } = patch._storageSelection, selected = new Set(filepaths || []), merged = { ...target, ...patch };
      delete merged._storageSelection;
      delete merged._storageArchiveKinds;
      if (target.importArchive && target.importArchive.baselineId === patch.importArchive?.baselineId && !Object.hasOwn(patch.importArchive || {}, 'decisions')) merged.importArchive = target.importArchive;
      if (!Object.hasOwn(patch, 'importRecovery') && Object.hasOwn(target, 'importRecovery')) merged.importRecovery = target.importRecovery;
      const replacement = new Map((patch.descs || []).map(file => [file.filepath, file]));
      merged.descs = (target.descs || []).filter(file => !selected.has(file.filepath)).concat([...replacement.values()]);
      for (const field of fieldMaps) {
        if (allDropped && field.startsWith('dropped')) { merged[field] = copy(patch[field]); continue; }
        if (field === 'droppedOutbox') {
          merged[field] = [...(target[field] || []).filter(item => !selected.has(item.candidate?.filepath || item.filepath)), ...(patch[field] || [])]; continue;
        }
        if (languageMaps.has(field)) {
          merged[field] = copy(target[field] || {});
          for (const language of new Set([...Object.keys(target[field] || {}), ...Object.keys(patch[field] || {})])) {
            const map = merged[field][language] ||= {};
            for (const [entry, value] of Object.entries(map)) if (selected.has(value?.filepath || entry)) delete map[entry];
            Object.assign(map, copy(patch[field]?.[language] || {}));
          }
        } else {
          const map = merged[field] = copy(target[field] || {});
          for (const [entry, value] of Object.entries(map)) if (selected.has(value?.filepath || target.droppedArchive?.[entry]?.filepath || entry)) delete map[entry];
          Object.assign(map, copy(patch[field] || {}));
        }
      }
      return merged;
    }
    async function beginBatch(batch, scope, logical, rooms) {
      await ensure(scope);
      const paths = batch.files.map(file => file.filepath), checkpoint = batch.checkpoint || batch.draft;
      if (checkpoint?.key) await draftGet(checkpoint.key);
      if (batch.collaboration) await rooms.ensureRoom(batch.collaboration.key);
      const db = await openDb(), tx = db.transaction([stores.meta, stores.baseline, stores.files, stores.records, stores.drafts,
        stores.rooms, stores.shared, stores.operations, stores.roomRecords, stores.submissions, stores.receipts, revisionStoreName(scope.game)], 'readwrite');
      let roomSelection;
      const fail = error => { tx._normalizedError = error; try { tx.abort(); } catch (_) {} };
      const synthetic = work => {
        const req = {};
        Promise.resolve().then(work).then(value => { req.result = { value }; req.onsuccess?.(); }, fail);
        return req;
      };
      const id = scopeKey(scope);
      const kv = {
        get(logicalKey) {
          return synthetic(async () => {
            if (logicalKey === logical.workspace) return readWorkspace(tx, scope, paths);
            if (logicalKey === logical.source) return (await Promise.all(paths.map(path => get(tx, stores.baseline, key(baselineKey(scope), path))))).filter(Boolean);
            if (logicalKey === logical.receipts) { const receipt = await get(tx, stores.receipts, key(id, batch.jobId)); return receipt ? [receipt] : []; }
            if (logicalKey === 'collaboration_v1') {
              const read = await rooms.readRoom(tx, batch.collaboration.key, paths, { includeOutbox: 'paths', includeConflicts: true, includeDropped: true });
              roomSelection = read.selection;
              return { rooms: { [batch.collaboration.key]: read.room } };
            }
            return hydrateDraft(tx, await get(tx, stores.drafts, logicalKey));
          });
        },
        put(item) {
          (async () => {
            if (item.key === logical.workspace) return writeWorkspace(tx, scope, item.value, paths);
            if (item.key === 'collaboration_v1') return rooms.writeRoom(tx, batch.collaboration.key, item.value.rooms[batch.collaboration.key], roomSelection?.filepaths || paths, roomSelection?.operationIds);
            if (item.key === logical.receipts) {
              for (const receipt of item.value) tx.objectStore(stores.receipts).put(row(id, receipt.jobId, receipt));
              tx.objectStore(stores.submissions).delete(key(id, batch.jobId));
              if (batch.resetStaging) for (const item of await request(tx.objectStore(stores.submissions).index('by_path').getAll(key(id, batch.language, paths[0]))))
                if (item.value.state === 'review' && item.value.batch.resetStaging) tx.objectStore(stores.submissions).delete(item.key);
              return;
            }
            const original = await get(tx, stores.baseline, key(baselineKey(scope), item.value.filepath));
            tx.objectStore(stores.drafts).put(draftRow(item.value, original));
            if (item.value.state === 'promoted') for (const jobId of new Set([item.value.submissionJobId, ...(item.value.submissionJobIds || [])].filter(Boolean)))
              tx.objectStore(stores.submissions).delete(key(id, jobId));
          })().catch(fail);
        },
      };
      const consumeJournal = () => {
        get(tx, stores.submissions, key(id, batch.jobId)).then(value => {
          if (value) tx.objectStore(stores.submissions).delete(key(id, batch.jobId));
        }).catch(fail);
      };
      return { tx, kv, consumeJournal };
    }
    function draftRow(value, original) {
      const scope = normalizeScope({ accountId: value.profile, game: value.game, branchId: value.branchId, sourceHash: value.sourceHash });
      const data = copy(value);
      const compact = record => {
        if (!record) return;
        if (record.source && original && record.game === scope.game && record.sourceHash === scope.sourceHash && record.filepath === data.filepath) {
          if (same(record.source, original)) {
            record.sourceRef = { game: record.game, sourceHash: record.sourceHash, filepath: record.filepath }; delete record.source;
          } else delete record.sourceRef;
        }
        for (const variant of [...(record.conflicts || []), ...(record.recovery || [])]) compact(variant);
      };
      compact(data);
      return { key: value.key, scope: scopeKey(scope), profileLanguage: key(value.profile, value.game, value.branchId || 'default', value.language),
        scopeLanguage: key(scopeKey(scope), value.language), value: data };
    }
    async function hydrateDraft(tx, value, sources = new Map()) {
      if (!value) return value;
      const record = { ...value };
      if (value.sourceRef) {
        const ref = value.sourceRef, id = key(baselineKey(ref), ref.filepath);
        if (!sources.has(id)) sources.set(id, get(tx, stores.baseline, id));
        record.source = await sources.get(id) || value.source || null;
      }
      for (const field of ['conflicts', 'recovery']) if (value[field]?.length) record[field] = await Promise.all(value[field].map(variant => hydrateDraft(tx, variant, sources)));
      return record;
    }
    async function draftGet(id) {
      const normalized = await transaction([stores.drafts, stores.baseline], 'readonly', async tx => hydrateDraft(tx, await get(tx, stores.drafts, id)));
      if (normalized !== undefined) return normalized;
      const transferred = await transaction([stores.migration], 'readonly', tx => get(tx, stores.migration, key('draft', id)));
      if (transferred) return undefined;
      const legacy = await legacyGet(id);
      return transaction([stores.drafts, stores.baseline, stores.migration], 'readwrite', async tx => {
        let current = await get(tx, stores.drafts, id);
        if (legacy && !current) {
          const original = await get(tx, stores.baseline, key(baselineKey(legacy), legacy.filepath));
          const retained = draftRow(legacy, original);
          tx.objectStore(stores.drafts).put(retained);
          current = retained.value;
        }
        tx.objectStore(stores.migration).put({ key: key('draft', id), scope: key('draft', id), value: { state: 'ready' } });
        return hydrateDraft(tx, current);
      });
    }
    async function draftUpdate(id, change) {
      await draftGet(id);
      return transaction([stores.drafts, stores.baseline, stores.submissions], 'readwrite', async tx => {
        const current = await hydrateDraft(tx, await get(tx, stores.drafts, id)), result = change(current || null);
        if (result.write !== false) {
          const record = result.record, original = await get(tx, stores.baseline, key(baselineKey(record), record.filepath));
          tx.objectStore(stores.drafts).put(draftRow(record, original));
          if (record.state === 'discarded') for (const jobId of new Set([current?.submissionJobId, ...(current?.submissionJobIds || [])].filter(Boolean)))
            tx.objectStore(stores.submissions).delete(key(scopeKey(normalizeScope({ ...record, accountId: record.profile })), jobId));
        }
        return result;
      });
    }
    async function draftList(scope) {
      // One-time transfer preserves consumed receipts and recovery variants.
      const marker = key('drafts', scope.profile, scope.game, scope.branchId || 'default', scope.language);
      await transaction([stores.migration], 'readonly', tx => get(tx, stores.migration, marker)).then(async ready => {
        if (ready) return;
        const prefix = 'translation_draft_v1:', range = typeof IDBKeyRange === 'undefined' ? undefined : IDBKeyRange.bound(prefix, prefix + '\uffff');
        const rows = (await transaction(['kv'], 'readonly', tx => request(tx.objectStore('kv').getAll(range))))
          .filter(item => item.key.startsWith(prefix) && item.value.profile === scope.profile && item.value.game === scope.game
            && item.value.language === scope.language && (item.value.branchId || 'default') === (scope.branchId || 'default'));
        // Bound each transfer transaction. Readiness follows the final batch;
        // interrupted transfers reuse the rows already copied without rewriting.
        for (let offset = 0; offset < Math.max(rows.length, 1); offset += 128) {
          await transaction([stores.drafts, stores.baseline, stores.migration], 'readwrite', async tx => {
            for (const item of rows.slice(offset, offset + 128)) if (!await get(tx, stores.drafts, item.key)) {
                const original = await get(tx, stores.baseline, key(baselineKey(item.value), item.value.filepath));
                tx.objectStore(stores.drafts).put(draftRow(item.value, original));
              }
            if (offset + 128 >= rows.length) tx.objectStore(stores.migration).put({ key: marker, scope: marker, value: { state: 'ready' } });
          });
        }
      });
      return transaction([stores.drafts, stores.baseline], 'readonly', async tx => {
        const rows = scope.sourceHash == null
          ? await request(tx.objectStore(stores.drafts).index('by_profile_lang').getAll(key(scope.profile, scope.game, scope.branchId || 'default', scope.language)))
          : await request(tx.objectStore(stores.drafts).index('by_scope_language').getAll(key(scopeKey(normalizeScope({ ...scope, accountId: scope.profile })), scope.language)));
        return Promise.all(rows.map(row => hydrateDraft(tx, row.value)).filter(Boolean)).then(values => values.filter(value => (scope.sourceHash == null || value.sourceHash === scope.sourceHash) && (value.state === 'active' || value.conflicts?.length)));
      });
    }
    async function putSubmission(batch) {
      const scope = normalizeScope(batch.workspaceScope || { ...batch, accountId: batch.accountId || 'guest' }), id = scopeKey(scope);
      await ensure(scope);
      return transaction([stores.submissions, stores.receipts, stores.migration], 'readwrite', async tx => {
        const previous = await get(tx, stores.submissions, key(id, batch.jobId));
        if (previous && !same(previous.batch, batch)) throw new Error('A save identifier cannot be reused for different content.');
        if (previous) return previous;
        const receipt = await get(tx, stores.receipts, key(id, batch.jobId));
        // The worker still verifies the original receipt signature before
        // acknowledging a retry. A completed command needs no new journal.
        if (receipt) return { batch: copy(batch), state: 'completed', createdAt: receipt.createdAt || 0 };
        const sequenceKey = key('submission-order', id), last = await get(tx, stores.migration, sequenceKey);
        const sequence = Number(last?.sequence || 0) + 1;
        if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error('The save submission sequence is invalid.');
        const value = { batch: copy(batch), state: 'queued', createdAt: Date.now(), sequence };
        tx.objectStore(stores.submissions).put(row(id, batch.jobId, value, { paths: batch.files.map(file => key(id, batch.language, file.filepath)) }));
        tx.objectStore(stores.migration).put({ key: sequenceKey, scope: sequenceKey, value: { sequence } });
        return value;
      });
    }
    async function listSubmissions(scope) {
      const normalized = normalizeScope(scope), id = scopeKey(normalized);
      return transaction([stores.submissions], 'readonly', async tx => (await all(tx, stores.submissions, id)).map(row => row.value)
        .filter(value => ['queued', 'pending', 'review'].includes(value.state) && (!scope.language || value.batch.language === scope.language))
        .sort((a,b) => {
          const orderedA = Number.isSafeInteger(a.sequence), orderedB = Number.isSafeInteger(b.sequence);
          if (orderedA && orderedB) return a.sequence - b.sequence;
          if (orderedA !== orderedB) return orderedA ? 1 : -1;
          return a.createdAt - b.createdAt || a.batch.jobId.localeCompare(b.batch.jobId);
        }));
    }
    async function updateSubmission(batch, patch) {
      const scope = normalizeScope(batch.workspaceScope || { ...batch, accountId: batch.accountId || 'guest' }), id = scopeKey(scope);
      return transaction([stores.submissions, stores.drafts, stores.baseline], 'readwrite', async tx => {
        const current = await get(tx, stores.submissions, key(id, batch.jobId));
        if (!current) return;
        if (!same(current.batch, batch)) throw new Error('A submitted save cannot be updated with different content.');
        const value = { ...current, ...copy(patch), batch: current.batch, createdAt: current.createdAt };
        if (!same(value, current)) tx.objectStore(stores.submissions).put(row(id, batch.jobId, value, { paths: batch.files.map(file => key(id, batch.language, file.filepath)) }));
        if (patch.state === 'review' && !batch.resetStaging && batch.files.length === 1) {
          const path = batch.files[0].filepath, checkpoint = batch.checkpoint || batch.draft;
          const draftKey = checkpoint?.key || 'translation_draft_v1:' + key(scope.accountId, scope.game, scope.sourceHash, batch.language, path, ...(scope.branchId === 'default' ? [] : [scope.branchId]));
          const previous = await hydrateDraft(tx, await get(tx, stores.drafts, draftKey));
          const recovered = { profile: scope.accountId, game: scope.game, sourceHash: scope.sourceHash, language: batch.language, filepath: path,
            ...(scope.branchId === 'default' ? {} : { branchId: scope.branchId }), key: draftKey, id: 'submission:' + batch.jobId, revision: 'submission:' + batch.jobId,
            state: 'active', submissionJobId: batch.jobId, translations: batch.files[0].translations, base: batch.bases?.[path] || batch.draft?.base || { translations: [] },
            sourceRef: { game: scope.game, sourceHash: scope.sourceHash, filepath: path }, updatedAt: Date.now() };
          const submissionJobIds = [...new Set([previous?.submissionJobId, ...(previous?.submissionJobIds || []), batch.jobId].filter(Boolean))];
          if (!previous || previous.state !== 'active') tx.objectStore(stores.drafts).put(draftRow({ ...recovered, submissionJobIds,
            conflicts: previous?.conflicts || [], recovery: previous?.recovery || [] }));
          else {
            const conflicts = previous.conflicts || [], known = conflicts.some(variant => variant.submissionJobId === batch.jobId);
            const different = !same(previous.translations, recovered.translations) || !same(previous.base, recovered.base);
            const record = { ...previous, submissionJobIds,
              ...(different && !known ? { revision: previous.revision + ':submission:' + batch.jobId, conflicts: [...conflicts, recovered] } : {}) };
            if (!same(record, previous)) {
              const original = await get(tx, stores.baseline, key(baselineKey(scope), path));
              tx.objectStore(stores.drafts).put(draftRow(record, original));
            }
          }
        }
        return value;
      });
    }
    return { stores, dependencies, available, ensure, migrate, workspace, source, saveWorkspace, transaction, get, all, row, key, scopeKey, baselineKey, readWorkspace, writeWorkspace,
      importScope, assets, hasScope, clearScope, mergeWorkspaceRecords, beginBatch, fingerprint, normalizeHistory,
      draftGet, draftUpdate, draftList, draftRow, hydrateDraft, putSubmission, listSubmissions, updateSubmission, copy, same };
  }
  return { stores, names, upgrade, create, scopeKey, baselineKey };
});
