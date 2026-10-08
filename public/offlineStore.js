(() => {
  const WorkspaceState = (typeof window === 'object' ? window : self).WorkspaceState;
  const DB_NAME = 'sdeditor';
  // v4 cannot read staged records; v5 cannot retain a shared staging reset.
  // v6 dictionary writers cannot preserve per-entry game scope; v7 writers
  // cannot preserve named-version/profile isolation. Keep every
  // store and durable retry receipt while excluding older editors/workers.
  const DB_VERSION = 8;

  const STORE_KV = 'kv';
  const STORE_REVISIONS_LEGACY = 'revisions';
  const STORE_REVISIONS_POE1 = 'revisions_poe1';
  const STORE_REVISIONS_POE2 = 'revisions_poe2';
  const REVISION_STORES = [STORE_REVISIONS_LEGACY, STORE_REVISIONS_POE1, STORE_REVISIONS_POE2];

  const KV_SETTINGS = 'settings';
  const KV_WORKSPACE_LEGACY = 'workspace';
  const KV_SOURCE_LEGACY = 'source';
  const KV_WORKSPACE_PREFIX = 'workspace_';
  const KV_SOURCE_PREFIX = 'source_';
  const KV_MIGRATED = 'migratedFromLocalStorage';
  const KV_MIGRATED_SINGLE_VERSION = 'migratedFromSingleVersion';
  const KV_TRANSLATION_DRAFT_PREFIX = 'translation_draft_v1:';

  let currentGameVersion = 'poe1';
  const DEFAULT_BRANCH = 'default';
  const VERSION_PREFIX = 'workspace_version_v1:';
  const ACTIVE_PREFIX = 'workspace_active_v1:';
  const CATALOG_PREFIX = 'version_catalog_v1:';
  let workspaceContext = null;
  const activeScopes = new Map();

  function normalizeWorkspaceScope(value = {}) {
    const defaults = workspaceContext || {};
    const game = normalizeGameVersion(value.game || value.version || defaults.game);
    const accountId = String(value.accountId ?? value.profile ?? defaults.accountId ?? 'guest') || 'guest';
    const branchId = String(value.branchId || defaults.branchId || DEFAULT_BRANCH);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(branchId)) throw new TypeError('Invalid workspace branch.');
    const sourceHash = String(value.sourceHash ?? value.baselineId ?? '');
    return { accountId, game, branchId, sourceHash };
  }
  function activeKey(scope) { return ACTIVE_PREFIX + JSON.stringify([scope.accountId, scope.game, scope.branchId]); }
  function versionKey(scope) { return VERSION_PREFIX + JSON.stringify([scope.accountId, scope.game, scope.branchId, scope.sourceHash]); }
  function scopedVersion(value) {
    if (value && typeof value === 'object') return normalizeWorkspaceScope(value);
    if (!workspaceContext) return null;
    const scope = normalizeWorkspaceScope({ game: value || currentGameVersion });
    if (workspaceContext.sourceHash && workspaceContext.game === scope.game && workspaceContext.accountId === scope.accountId
      && workspaceContext.branchId === scope.branchId) return { ...workspaceContext };
    return activeScopes.get(activeKey(scope)) || scope;
  }
  function captureWorkspaceScope(value = {}) {
    if (value.workspaceScope) return normalizeWorkspaceScope(value.workspaceScope);
    if (!workspaceContext && !value.branchId) return null;
    return normalizeWorkspaceScope({ ...value, sourceHash: value.sourceHash ?? scopedVersion(value.game)?.sourceHash ?? '' });
  }
  function setWorkspaceContext(value) {
    workspaceContext = normalizeWorkspaceScope(value);
    currentGameVersion = workspaceContext.game;
    if (workspaceContext.sourceHash) activeScopes.set(activeKey(workspaceContext), { ...workspaceContext });
    else activeScopes.delete(activeKey(workspaceContext));
    return { ...workspaceContext };
  }
  function scopedRevision(revision, scope) {
    return scope?.sourceHash ? { ...revision, sourceHash: revision.sourceHash || scope.sourceHash,
      accountId: scope.accountId, branchId: scope.branchId } : revision;
  }
  function matchesCollaborationIdentity(key, identity) {
    const branch = identity?.branchId || DEFAULT_BRANCH;
    return key === JSON.stringify([String(identity?.accountId), identity?.game, branch, identity?.sourceHash, identity?.language])
      || (branch === DEFAULT_BRANCH && key === JSON.stringify([String(identity?.accountId), identity?.game, identity?.sourceHash, identity?.language]));
  }

  function pruneWorkspace(workspace) {
    if (Number(workspace?.stagedVersion) >= 1) WorkspaceState.pruneWorkspaceStatus(workspace);
    return workspace;
  }

  function isAvailable() {
    return typeof indexedDB !== 'undefined' && indexedDB;
  }

  function requestToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB request failed'));
    });
  }

  function txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    });
  }

  let _dbPromise = null;
  function openDb() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
      if (!isAvailable()) {
        reject(new Error('IndexedDB unavailable'));
        return;
      }

      const req = indexedDB.open(DB_NAME, DB_VERSION);
      let blocked = false;
      req.onblocked = () => {
        blocked = true;
        reject(new Error('Close every other SDEditor tab, then reload this tab to finish the storage upgrade. Your saved translations have been kept.'));
      };
      req.onupgradeneeded = () => {
        const db = req.result;

        if (!db.objectStoreNames.contains(STORE_KV)) {
          db.createObjectStore(STORE_KV, { keyPath: 'key' });
        }

        for (const storeName of REVISION_STORES) {
          if (!db.objectStoreNames.contains(storeName)) {
            const store = db.createObjectStore(storeName, { keyPath: 'id', autoIncrement: true });
            store.createIndex('by_file_lang_time', ['filepath', 'lang', 'savedAt']);
            store.createIndex('by_file_time', ['filepath', 'savedAt']);
          }
        }
      };
      req.onsuccess = () => {
        if (blocked) { req.result.close(); return; }
        req.result.onversionchange = () => { req.result.close(); _dbPromise = null; };
        console.log('openDb success');
        resolve(req.result);
      };
      req.onerror = () => {
        if (req.error?.name === 'VersionError') {
          reject(Object.assign(new Error('This browser storage was upgraded by a newer SDEditor. Open the latest editor and reload this tab before saving again. Your saved translations have been kept.'),
            { name: 'VersionError', code: 'STORAGE_VERSION_OUTDATED', cause: req.error }));
        } else reject(req.error || new Error('IndexedDB open failed'));
      };
    });
    return _dbPromise;
  }

  async function withStore(storeName, mode, fn) {
    const db = await openDb();
    const tx = db.transaction([storeName], mode);
    const done = txDone(tx);
    const store = tx.objectStore(storeName);
    let out;
    try { out = await fn(store, tx); } catch (error) {
      try { tx.abort(); } catch (_) {}
      await done.catch(() => {});
      throw error;
    }
    await done;
    return out;
  }

  // Read/modify/write one durable hybrid snapshot in a single transaction. The
  // callback must be synchronous so the transaction never becomes inactive.
  async function updateHybridState(update) {
    const db = await openDb();
    const tx = db.transaction([STORE_KV], 'readwrite');
    const done = txDone(tx);
    const store = tx.objectStore(STORE_KV);
    let result;
    const req = store.get('hybrid_v1');
    req.onsuccess = () => {
      try {
        result = update(req.result?.value);
        if (result && typeof result.then === 'function') throw new Error('Hybrid storage update must be synchronous');
        store.put({ key: 'hybrid_v1', value: result });
      } catch (error) {
        tx._hybridError = error;
        tx.abort();
      }
    };
    try { await done; } catch (error) { throw tx._hybridError || error; }
    return result;
  }

  async function kvGet(key) {
    return withStore(STORE_KV, 'readonly', async (store) => {
      const row = await requestToPromise(store.get(key));
      return row ? row.value : undefined;
    });
  }

  async function kvSet(key, value) {
    return withStore(STORE_KV, 'readwrite', async (store) => {
      if (typeof key === 'string' && (key === KV_WORKSPACE_LEGACY || key.startsWith(KV_WORKSPACE_PREFIX))) pruneWorkspace(value);
      store.put({ key, value });
    });
  }

  async function getWorkspace(version, language) {
    if (workspaceContext || (version && typeof version === 'object')) version = await resolveWorkspaceVersion(version);
    if (!language || language === 'English') {
      const workspace = await kvGet(workspaceKey(version));
      if (Number(workspace?.stagedVersion) >= 1 && workspace.statusMetadataVersion !== 1) {
        return updateWorkspace(pruneWorkspace, version);
      }
      return workspace;
    }
    const db = await openDb();
    const tx = db.transaction([STORE_KV, revisionStoreName(version)], 'readwrite');
    const done = txDone(tx);
    const store = tx.objectStore(STORE_KV);
    const key = workspaceKey(version);
    let result, failure;
    const req = store.get(key);
    req.onsuccess = () => {
      try {
        result = req.result?.value;
        if (result && (Number(result.stagedVersion) < 1 || result.statusMetadataVersion !== 1 || result.placeholderRepairVersion !== 1)) {
          const beforeMigration = JSON.stringify(result);
          let source, collaboration, receipts, waiting = 4;
          const revisions = [], originSources = {};
          const history = tx.objectStore(revisionStoreName(version));
          const finish = () => {
            if (--waiting) return;
            try {
              if (!(Number(result.stagedVersion) >= 1)) WorkspaceState.initializeWorkspace(result, { source: source || [], sourceHash: result.sourceHash,
                game: normalizeGameVersion(version), language, collaboration, revisions, originSources });
              else pruneWorkspace(result);
              const repaired = WorkspaceState.repairLegacyPlaceholders(result, { source, collaboration, receipts, revisions,
                game: normalizeGameVersion(version), evidenceComplete: !!history.openCursor });
              if (repaired && collaboration) store.put({ key: 'collaboration_v1', value: collaboration });
              if (JSON.stringify(result) !== beforeMigration) store.put({ key, value: pruneWorkspace(result) });
            } catch (error) { failure = error; tx.abort(); }
          };
          const sourceRead = store.get(result.importArchive ? importedBaselineKey(result.importArchive.baselineId, version) : sourceKey(version));
          sourceRead.onsuccess = () => { source = result.importArchive ? sourceRead.result?.value?.source : sourceRead.result?.value; finish(); };
          const collaborationRead = store.get('collaboration_v1');
          collaborationRead.onsuccess = () => { collaboration = collaborationRead.result?.value; finish(); };
          const migratedScope = scopedVersion(version);
          const receiptsRead = store.get(migratedScope ? receiptScopeKey(migratedScope) : 'translation_save_receipts_' + normalizeGameVersion(version));
          receiptsRead.onsuccess = () => { receipts = receiptsRead.result?.value || []; finish(); };
          if (history.openCursor) {
            const cursorRead = history.openCursor();
            cursorRead.onsuccess = () => {
              const cursor = cursorRead.result;
              if (!cursor) { finish(); return; }
              if (revisionInScope(cursor.value, migratedScope)) revisions.push(cursor.value);
              cursor.continue();
            };
          } else finish();
          const origins = new Set(Object.values(result.status || {}).flatMap(status => Object.values(status?.reviewCandidates || {})
            .map(candidate => candidate?.sourceHash)).filter(hash => /^[a-f0-9]{64}$/.test(hash || '')));
          for (const hash of origins) {
            waiting++;
            const oldBaselineRead = store.get(importedBaselineKey(hash, version));
            oldBaselineRead.onsuccess = () => { originSources[hash] = oldBaselineRead.result?.value?.source; finish(); };
          }
        }
      } catch (error) { failure = error; tx.abort(); }
    };
    try { await done; } catch (error) { throw failure || error; }
    return result;
  }

  async function updateWorkspace(update, version, options = {}) {
    const captured = options.scope ? normalizeWorkspaceScope(options.scope) : scopedVersion(version);
    if (captured) version = captured;
    const revisions = options.revisions || [];
    if (!Array.isArray(revisions)) throw new TypeError('Revisions must be an array');
    const revisionStore = revisionStoreName(version);
    const db = await openDb(), tx = db.transaction(revisions.length ? [STORE_KV, revisionStore] : [STORE_KV], 'readwrite'), done = txDone(tx);
    const store = tx.objectStore(STORE_KV), key = workspaceKey(version);
    let result, failure;
    const req = store.get(key);
    req.onsuccess = () => {
      try {
        result = update(req.result?.value);
        if (result?.then) throw new Error('Workspace update must be synchronous.');
        if (result !== undefined) store.put({ key, value: pruneWorkspace(result) });
        for (const revision of revisions) tx.objectStore(revisionStore).add(scopedRevision(revision, captured));
      } catch (error) { failure = error; tx.abort(); }
    };
    try { await done; } catch (error) { throw failure || error; }
    return result;
  }

  async function kvDel(key) {
    return withStore(STORE_KV, 'readwrite', async (store) => {
      store.delete(key);
    });
  }

  function translationDraftScope(value) {
    if (!value || typeof value.profile !== 'string' || !value.profile
      || !['poe1', 'poe2'].includes(value.game) || typeof value.sourceHash !== 'string' || !value.sourceHash
      || typeof value.language !== 'string' || !value.language || typeof value.filepath !== 'string' || !value.filepath) {
      throw new TypeError('A translation draft requires its profile, game, source, language and filepath.');
    }
    const branchId = value.branchId || DEFAULT_BRANCH;
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(branchId)) throw new TypeError('Invalid draft branch.');
    return { profile: value.profile, game: value.game, sourceHash: value.sourceHash, language: value.language, filepath: value.filepath,
      ...(branchId === DEFAULT_BRANCH ? {} : { branchId }) };
  }

  function translationDraftKey(value) {
    const scope = translationDraftScope(value);
    // Preserve default-branch keys, IDs and consumed receipts exactly through v8.
    return KV_TRANSLATION_DRAFT_PREFIX + JSON.stringify([scope.profile, scope.game, scope.sourceHash, scope.language, scope.filepath,
      ...(scope.branchId ? [scope.branchId] : [])]);
  }

  function translationDraftScopeFromKey(key) {
    if (typeof key !== 'string' || !key.startsWith(KV_TRANSLATION_DRAFT_PREFIX)) throw new TypeError('Invalid translation draft key.');
    let parts;
    try { parts = JSON.parse(key.slice(KV_TRANSLATION_DRAFT_PREFIX.length)); } catch (_) { throw new TypeError('Invalid translation draft key.'); }
    if (!Array.isArray(parts) || ![5, 6].includes(parts.length)) throw new TypeError('Invalid translation draft key.');
    const [profile, game, sourceHash, language, filepath, branchId] = parts;
    const scope = translationDraftScope({ profile, game, sourceHash, language, filepath, branchId });
    if (translationDraftKey(scope) !== key) throw new TypeError('Invalid translation draft key.');
    return scope;
  }

  function plainDraft(value) {
    const scope = translationDraftScope(value);
    const key = translationDraftKey(scope);
    if ((value.key != null && value.key !== key) || typeof value.id !== 'string' || !value.id
      || typeof value.revision !== 'string' || !value.revision || !Array.isArray(value.translations)
      || value.translations.some(line => typeof line !== 'string') || !Array.isArray(value.base?.translations)
      || value.base.translations.some(line => typeof line !== 'string')) throw new TypeError('Invalid translation draft.');
    // Detach nested source/base data too; a Vue proxy must never reach IndexedDB.
    return JSON.parse(JSON.stringify({ ...scope, key, id: value.id, revision: value.revision,
      translations: value.translations, base: value.base, source: value.source ?? null,
      ...(typeof value.declined === 'string' && value.declined ? { declined: value.declined } : {}),
      updatedAt: Number(value.updatedAt) || Date.now(), state: 'active' }));
  }

  function draftContentSignature(value) {
    return JSON.stringify({ ...plainDraft(value), updatedAt: 0 });
  }

  function sameDraftContent(left, right) {
    return draftContentSignature(left) === draftContentSignature(right);
  }

  function sameDraftVariant(left, right) {
    return JSON.stringify({ ...plainDraft(left), revision: '', updatedAt: 0 })
      === JSON.stringify({ ...plainDraft(right), revision: '', updatedAt: 0 });
  }

  async function getTranslationDraft(key) {
    translationDraftScopeFromKey(key);
    return (await kvGet(key)) || null;
  }

  async function listTranslationDrafts(scope) {
    if (!scope || typeof scope.profile !== 'string' || !scope.profile || !['poe1', 'poe2'].includes(scope.game)
      || typeof scope.language !== 'string' || !scope.language) throw new TypeError('A draft listing requires its profile, game and language.');
    return withStore(STORE_KV, 'readonly', async store => {
      const range = typeof IDBKeyRange === 'undefined' ? undefined
        : IDBKeyRange.bound(KV_TRANSLATION_DRAFT_PREFIX, KV_TRANSLATION_DRAFT_PREFIX + '\uffff');
      const rows = await requestToPromise(store.getAll(range));
      return rows.filter(row => row.key.startsWith(KV_TRANSLATION_DRAFT_PREFIX)).map(row => row.value)
        .filter(record => record.profile === scope.profile && record.game === scope.game && record.language === scope.language
          && (record.branchId || DEFAULT_BRANCH) === (scope.branchId || DEFAULT_BRANCH)
          && (scope.sourceHash == null || record.sourceHash === scope.sourceHash)
          && (record.state === 'active' || record.conflicts?.length));
    });
  }

  async function updateTranslationDraft(key, change) {
    translationDraftScopeFromKey(key);
    const db = await openDb(), tx = db.transaction([STORE_KV], 'readwrite'), done = txDone(tx);
    const store = tx.objectStore(STORE_KV);
    let result, failure;
    const read = store.get(key);
    read.onsuccess = () => {
      try {
        result = change(read.result?.value || null);
        if (result.write !== false) store.put({ key, value: result.record });
      } catch (error) { failure = error; tx.abort(); }
    };
    try { await done; } catch (error) { throw failure || error; }
    delete result.write;
    return result;
  }

  async function putTranslationDraft(value, { expectedRevision = null, resolveConflicts = false } = {}) {
    const incoming = plainDraft(value);
    if (expectedRevision !== null && (typeof expectedRevision !== 'string' || !expectedRevision)) throw new TypeError('Invalid expected draft revision.');
    return updateTranslationDraft(incoming.key, current => {
      if (current?.revision === incoming.revision) {
        if (!sameDraftContent(current, incoming)) throw new Error('A draft revision cannot be reused for different content.');
        return { status: 'saved', record: current, duplicate: true, write: false };
      }
      // An uncertain retry of a consumed snapshot must not resurrect it.
      if (current?.consumedRevision === incoming.revision && current.id === incoming.id) {
        if (current.consumedSignature && current.consumedSignature !== draftContentSignature(incoming)) throw new Error('A draft revision cannot be reused for different content.');
        return { status: current.state, record: current, duplicate: true, write: false };
      }
      if ((current?.revision || null) !== expectedRevision || (current?.conflicts?.length && !resolveConflicts)) {
        const conflicts = current?.conflicts || [];
        const sameRevision = conflicts.find(record => record.id === incoming.id && record.revision === incoming.revision);
        if (sameRevision && !sameDraftContent(sameRevision, incoming)) throw new Error('A draft revision cannot be reused for different content.');
        const duplicate = sameRevision || conflicts.find(record => sameDraftVariant(record, incoming))
          || (current?.state === 'active' && sameDraftVariant(current, incoming) ? plainDraft(current) : null);
        const record = current || { ...translationDraftScope(incoming), key: incoming.key, id: incoming.id,
          revision: 'unavailable:' + expectedRevision, state: 'unavailable', conflicts: [] };
        // A conflict is part of the reviewed state. Advance its revision as well
        // so a review opened before another variant arrived cannot resolve it.
        return { status: 'conflict', record: duplicate ? record
          : { ...record, revision: incoming.revision + ':conflict', conflicts: [...conflicts, incoming] },
          preserved: duplicate || incoming, duplicate: !!duplicate, ...(duplicate ? { write: false } : {}) };
      }
      const recovery = [...(current?.recovery || []), ...(resolveConflicts ? current?.conflicts || [] : []),
        ...(resolveConflicts && current?.state === 'active' ? [plainDraft(current)] : [])];
      return { status: 'saved', record: { ...incoming, conflicts: resolveConflicts ? [] : current?.conflicts || [],
        ...(recovery.length ? { recovery } : {}) } };
    });
  }

  async function discardTranslationDraft(key, expectedRevision) {
    if (typeof expectedRevision !== 'string' || !expectedRevision) throw new TypeError('A draft discard requires its revision.');
    return updateTranslationDraft(key, current => {
      if (current?.state === 'discarded' && current.consumedRevision === expectedRevision) return { status: 'discarded', record: current, duplicate: true, write: false };
      if (!current || current.revision !== expectedRevision) return { status: 'conflict', record: current, write: false };
      return { status: 'discarded', record: { ...current, state: 'discarded', consumedRevision: expectedRevision,
        consumedSignature: current.state === 'active' ? draftContentSignature(current) : current.consumedSignature,
        revision: expectedRevision + ':discarded', translations: [], base: null, source: null,
        ...(current.conflicts?.length ? { conflicts: [], recovery: [...(current.recovery || []), ...current.conflicts] } : {}) } };
    });
  }

  function normalizeGameVersion(version) {
    const v = String((version && typeof version === 'object' ? version.game : version) || currentGameVersion || '').toLowerCase();
    if (v === 'poe2') return 'poe2';
    return 'poe1';
  }

  function revisionStoreName(version) {
    return normalizeGameVersion(version) === 'poe2' ? STORE_REVISIONS_POE2 : STORE_REVISIONS_POE1;
  }

  function workspaceKey(version) {
    const scope = scopedVersion(version);
    if (scope) return versionKey(scope);
    return KV_WORKSPACE_PREFIX + normalizeGameVersion(version);
  }

  function sourceKey(version) {
    const scope = scopedVersion(version);
    if (scope) return 'source_version_v1:' + JSON.stringify([scope.accountId, scope.game, scope.branchId, scope.sourceHash]);
    return KV_SOURCE_PREFIX + normalizeGameVersion(version);
  }

  function setGameVersion(version) {
    currentGameVersion = normalizeGameVersion(version);
    return currentGameVersion;
  }

  function versionMetadataKey(scope) { return 'version_metadata_v1:' + JSON.stringify([scope.accountId, scope.game, scope.branchId, scope.sourceHash]); }

  // Legacy game slots have one owner. Copy them once without deleting the old
  // evidence or attaching another signed-in account's translations.
  async function resolveWorkspaceVersion(value) {
    const captured = scopedVersion(value) || normalizeWorkspaceScope(typeof value === 'object' ? value : { game: value });
    if (captured.sourceHash) return captured;
    const known = await kvGet(activeKey(captured));
    if (known?.sourceHash) {
      const resolved = normalizeWorkspaceScope(known);
      activeScopes.set(activeKey(resolved), resolved);
      return resolved;
    }
    let inferredHash = '', inferredSource;
    const legacyWorkspace = await kvGet(KV_WORKSPACE_PREFIX + captured.game);
    if (legacyWorkspace && !legacyWorkspace.sourceHash
      && String(legacyWorkspace.accountId || legacyWorkspace.collaborationAccountId || 'guest') === captured.accountId
      && captured.branchId === DEFAULT_BRANCH) {
      inferredHash = legacyWorkspace.importArchive?.baselineId || '';
      if (!inferredHash) {
        inferredSource = await kvGet(KV_SOURCE_PREFIX + captured.game);
        if (Array.isArray(inferredSource) && inferredSource.length && root.CollaborationProtocol?.sourceHash) {
          inferredHash = await root.CollaborationProtocol.sourceHash(inferredSource);
        }
      }
    }
    const db = await openDb(), tx = db.transaction([STORE_KV], 'readwrite'), done = txDone(tx);
    const kv = tx.objectStore(STORE_KV);
    let resolved = captured, failure;
    const reads = {}, keys = [KV_WORKSPACE_PREFIX + captured.game, KV_SOURCE_PREFIX + captured.game,
      'translation_save_receipts_' + captured.game];
    let waiting = keys.length;
    const finish = () => {
      try {
        const workspace = reads[keys[0]], source = reads[keys[1]];
        const owner = String(workspace?.accountId || workspace?.collaborationAccountId || 'guest');
        const sourceHash = workspace?.sourceHash || inferredHash;
        if (!sourceHash || owner !== captured.accountId || captured.branchId !== DEFAULT_BRANCH) return;
        if (inferredSource && JSON.stringify(source) !== JSON.stringify(inferredSource)) throw new Error('The legacy source changed while its identity was being recovered. Reload to preserve the matching workspace.');
        resolved = { ...captured, sourceHash };
        const record = { ...workspace, sourceHash, accountId: owner, game: captured.game, branchId: DEFAULT_BRANCH };
        kv.put({ key: workspaceKey(resolved), value: record });
        if (source !== undefined) kv.put({ key: sourceKey(resolved), value: source });
        kv.put({ key: activeKey(resolved), value: resolved });
        kv.put({ key: versionMetadataKey(resolved), value: { ...resolved, name: '', migrated: true,
          createdAt: Number(workspace.lastModified) || Date.now() } });
        if (reads[keys[2]]) kv.put({ key: receiptScopeKey(resolved), value: reads[keys[2]] });
      } catch (error) { failure = error; tx.abort(); }
    };
    for (const key of keys) {
      const read = kv.get(key);
      read.onsuccess = () => { reads[key] = read.result?.value; if (!--waiting) finish(); };
    }
    try { await done; } catch (error) { throw failure || error; }
    if (resolved.sourceHash) activeScopes.set(activeKey(resolved), resolved);
    return resolved;
  }

  async function getVersionSource(scope) { return kvGet(sourceKey(normalizeWorkspaceScope(scope))); }
  async function getVersionWorkspace(scope, language) {
    const value = await getWorkspace(normalizeWorkspaceScope(scope), language);
    return value ?? null;
  }
  async function getSource(version) {
    const captured = (workspaceContext || typeof version === 'object') ? await resolveWorkspaceVersion(version) : version;
    return kvGet(sourceKey(captured));
  }
  async function setWorkspace(workspace, version) {
    const captured = captureWorkspaceScope({ ...(typeof version === 'object' ? version : { game: version }), sourceHash: workspace?.sourceHash });
    return kvSet(workspaceKey(captured || version), workspace);
  }
  async function activateVersion(value) {
    const scope = normalizeWorkspaceScope(value);
    if (!scope.sourceHash) throw new TypeError('A version activation requires its source identity.');
    const db = await openDb(), tx = db.transaction([STORE_KV], 'readwrite'), done = txDone(tx);
    const kv = tx.objectStore(STORE_KV), values = {};
    const keys = [workspaceKey(scope), sourceKey(scope), versionMetadataKey(scope)];
    let waiting = keys.length, failure;
    for (const key of keys) {
      const read = kv.get(key);
      read.onsuccess = () => {
        values[key] = read.result?.value;
        if (--waiting) return;
        if (!values[keys[0]] || !values[keys[1]]) { failure = new Error('This version is not available in this browser.'); tx.abort(); return; }
        kv.put({ key: activeKey(scope), value: scope });
      };
    }
    try { await done; } catch (error) { throw failure || error; }
    activeScopes.set(activeKey(scope), scope);
    if (workspaceContext?.accountId === scope.accountId && workspaceContext?.game === scope.game
      && workspaceContext.branchId === scope.branchId) workspaceContext = { ...scope };
    const workspace = values[keys[0]], baseline = workspace.importArchive
      ? await kvGet(importedBaselineKey(workspace.importArchive.baselineId, scope.game)) : null;
    return { scope, source: values[keys[1]], workspace, metadata: values[keys[2]] || { ...scope }, baseline };
  }
  async function setVersionMetadata(value, patch) {
    const scope = normalizeWorkspaceScope(value);
    if (!scope.sourceHash || !patch || typeof patch !== 'object') throw new TypeError('Version metadata requires its scope and fields.');
    const plainPatch = JSON.parse(JSON.stringify(patch));
    const db = await openDb(), tx = db.transaction([STORE_KV], 'readwrite'), done = txDone(tx);
    const kv = tx.objectStore(STORE_KV); let result;
    const read = kv.get(versionMetadataKey(scope));
    read.onsuccess = () => {
      result = { ...read.result?.value, ...plainPatch, ...scope, updatedAt: Date.now() };
      kv.put({ key: versionMetadataKey(scope), value: result });
    };
    await done; return result;
  }
  async function listLocalVersions(value = {}) {
    const scope = normalizeWorkspaceScope(value);
    await resolveWorkspaceVersion({ ...scope, sourceHash: '' });
    const prefix = 'version_metadata_v1:';
    const rows = await withStore(STORE_KV, 'readonly', store => requestToPromise(store.getAll(
      typeof IDBKeyRange === 'undefined' ? undefined : IDBKeyRange.bound(prefix, prefix + '\uffff'))));
    const selected = rows.filter(row => row.key.startsWith(prefix)).map(row => row.value)
      .filter(row => row.accountId === scope.accountId && row.game === scope.game && row.branchId === scope.branchId);
    const { active, availability } = await withStore(STORE_KV, 'readonly', async store => {
      const activeRead = requestToPromise(store.get(activeKey(scope)));
      const availability = await Promise.all(selected.map(async row => {
        const key = sourceKey(row);
        return store.count ? !!(await requestToPromise(store.count(key))) : !!(await requestToPromise(store.get(key)));
      }));
      return { active: (await activeRead)?.value, availability };
    });
    const selectedHash = workspaceContext?.accountId === scope.accountId && workspaceContext?.game === scope.game
      && workspaceContext?.branchId === scope.branchId && workspaceContext.sourceHash || active?.sourceHash;
    return selected.map((row, index) => ({ ...row, online: !!row.catalogVersionId, offline: !row.catalogVersionId,
        hasSource: availability[index], current: row.sourceHash === selectedHash }))
      .sort((a, b) => Number(b.current) - Number(a.current) || (b.createdAt || 0) - (a.createdAt || 0));
  }
  function catalogKey(value) {
    const scope = normalizeWorkspaceScope(typeof value === 'object' ? value : { game: value });
    return CATALOG_PREFIX + JSON.stringify([scope.accountId, scope.game, scope.branchId]);
  }
  function getVersionCatalog(value) { return kvGet(catalogKey(value)); }
  function setVersionCatalog(value, catalog) { return kvSet(catalogKey(value), JSON.parse(JSON.stringify(catalog))); }
  function getVersionUpload(scope) { return kvGet('version_upload_v1:' + catalogKey(scope)); }
  function setVersionUpload(scope, metadata) {
    const key = 'version_upload_v1:' + catalogKey(scope);
    if (metadata == null) return kvDel(key);
    if (!metadata || typeof metadata !== 'object') throw new TypeError('Upload recovery requires metadata.');
    const text = JSON.stringify(metadata);
    if (text.length > 65536) throw new TypeError('Upload recovery metadata is too large.');
    return kvSet(key, JSON.parse(text));
  }
  function collectionRequestKey(scope, versionId, language, endWindow = true) {
    if (typeof versionId !== 'string' || !versionId || typeof language !== 'string' || !language) throw new TypeError('A collection requires its version and team.');
    return 'version_collection_v1:' + catalogKey(scope) + ':' + JSON.stringify(endWindow ? [versionId, language] : [versionId, language, 'download_only']);
  }
  function getVersionCollectionRequest(scope, versionId, language, endWindow = true) { return kvGet(collectionRequestKey(scope, versionId, language, endWindow)); }
  function setVersionCollectionRequest(scope, versionId, language, requestId, endWindow = true) {
    const key = collectionRequestKey(scope, versionId, language, endWindow);
    if (requestId == null) return kvDel(key);
    if (typeof requestId !== 'string' || !requestId || requestId.length > 256) throw new TypeError('Invalid collection recovery identifier.');
    return kvSet(key, requestId);
  }
  function receiptScopeKey(scope) { return 'translation_save_receipts_v2:' + JSON.stringify([scope.accountId, scope.game, scope.branchId, scope.sourceHash]); }

  async function adoptGuestVersion(value) {
    const target = normalizeWorkspaceScope(value);
    if (target.accountId === 'guest') return null;
    const guestActive = await resolveWorkspaceVersion({ ...target, accountId: 'guest', sourceHash: '' });
    const guest = target.sourceHash ? { ...target, accountId: 'guest' } : guestActive;
    if (!guest.sourceHash) return null;
    const scope = { ...target, sourceHash: guest.sourceHash };
    const db = await openDb(), tx = db.transaction([STORE_KV], 'readwrite'), done = txDone(tx);
    const kv = tx.objectStore(STORE_KV), reads = {};
    const keys = [workspaceKey(guest), sourceKey(guest), versionMetadataKey(guest), workspaceKey(scope)];
    let waiting = keys.length, adopted = false;
    for (const key of keys) {
      const read = kv.get(key);
      read.onsuccess = () => {
        reads[key] = read.result?.value;
        if (--waiting || reads[keys[3]] || !reads[keys[0]] || !reads[keys[1]]) return;
        const workspace = { ...reads[keys[0]], accountId: target.accountId, branchId: target.branchId };
        delete workspace.collaborationAccountId;
        kv.put({ key: workspaceKey(scope), value: workspace });
        kv.put({ key: sourceKey(scope), value: reads[keys[1]] });
        kv.put({ key: versionMetadataKey(scope), value: { ...reads[keys[2]], ...scope, adoptedFrom: 'guest', updatedAt: Date.now() } });
        kv.put({ key: activeKey(scope), value: scope }); adopted = true;
      };
    }
    await done;
    if (adopted) activeScopes.set(activeKey(scope), scope);
    return adopted ? scope : null;
  }

  // Persist a bulk translation change and its recovery history together. Queue
  // every write synchronously so IndexedDB cannot commit a partial batch.
  async function saveWorkspaceWithRevisions(workspace, revisions, version) {
    if (!Array.isArray(revisions)) throw new TypeError('Revisions must be an array');
    const gameVersion = normalizeGameVersion(version);
    const captured = captureWorkspaceScope({ ...(typeof version === 'object' ? version : { game: gameVersion }),
      sourceHash: workspace.sourceHash, branchId: workspace.branchId || (typeof version === 'object' ? version.branchId : undefined) });
    const revisionsStore = revisionStoreName(gameVersion);
    const db = await openDb();
    const tx = db.transaction([STORE_KV, revisionsStore], 'readwrite');
    const done = txDone(tx);
    try {
      tx.objectStore(STORE_KV).put({ key: workspaceKey(captured || gameVersion), value: pruneWorkspace(workspace) });
      const store = tx.objectStore(revisionsStore);
      for (const revision of revisions) store.add(scopedRevision(revision, captured));
    } catch (error) {
      try { tx.abort(); } catch (_) {}
      await done.catch(() => {});
      throw error;
    }
    await done;
  }

  // The source identity must advance in the same durable commit as the imported
  // workspace. Collaboration queues retain their own old source/account scope.
  function importedBaselineKey(id, version) {
    if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) throw new TypeError('Invalid imported baseline identity');
    return 'import_baseline_' + normalizeGameVersion(version) + '_' + id;
  }

  async function saveSourceWorkspaceWithRevisions(source, workspace, revisions, version, baseline) {
    if (!Array.isArray(revisions)) throw new TypeError('Revisions must be an array');
    const gameVersion = normalizeGameVersion(version);
    const captured = captureWorkspaceScope({ ...(typeof version === 'object' ? version : { game: gameVersion }),
      sourceHash: workspace.sourceHash, branchId: workspace.branchId || (typeof version === 'object' ? version.branchId : undefined) });
    const contextAtStart = workspaceContext;
    const revisionsStore = revisionStoreName(gameVersion);
    const db = await openDb();
    const tx = db.transaction([STORE_KV, revisionsStore], 'readwrite');
    const done = txDone(tx);
    try {
      const kv = tx.objectStore(STORE_KV);
      kv.put({ key: sourceKey(captured || gameVersion), value: source });
      kv.put({ key: workspaceKey(captured || gameVersion), value: pruneWorkspace(captured ? { ...workspace,
        accountId: captured.accountId, game: captured.game, branchId: captured.branchId } : workspace) });
      if (captured?.sourceHash) {
        kv.put({ key: activeKey(captured), value: captured });
        const metadataRead = kv.get(versionMetadataKey(captured));
        metadataRead.onsuccess = () => kv.put({ key: versionMetadataKey(captured), value: {
          ...captured, createdAt: Date.now(), ...metadataRead.result?.value, updatedAt: Date.now() } });
      }
      if (baseline) {
        if (baseline.archive?.baselineId !== workspace.sourceHash) throw new Error('Imported baseline and workspace identity differ');
        kv.put({ key: importedBaselineKey(baseline.archive.baselineId, gameVersion), value: baseline });
      }
      for (const revision of revisions) tx.objectStore(revisionsStore).add(scopedRevision(revision, captured));
    } catch (error) {
      try { tx.abort(); } catch (_) {}
      await done.catch(() => {});
      throw error;
    }
    await done;
    if (captured?.sourceHash) {
      activeScopes.set(activeKey(captured), captured);
      if (workspaceContext === contextAtStart && workspaceContext?.accountId === captured.accountId
        && workspaceContext?.game === captured.game && workspaceContext.branchId === captured.branchId) workspaceContext = { ...captured };
    }
  }

  // Ordinary editor saves send only their touched files to the worker. Read the
  // latest archive here so other files, languages and background updates survive.
  async function saveTranslationBatch(batch) {
    if (!batch || typeof batch.jobId !== 'string' || !batch.jobId
      || !['poe1', 'poe2'].includes(batch.game) || typeof batch.language !== 'string' || !batch.language
      || !Array.isArray(batch.files) || !batch.files.length || !Array.isArray(batch.revisions || [])) {
      throw new TypeError('Invalid local translation save.');
    }
    const paths = new Set();
    const files = batch.files.map(file => {
      if (!file || typeof file.filepath !== 'string' || !file.filepath || paths.has(file.filepath)
        || !Array.isArray(file.translations) || file.translations.some(line => typeof line !== 'string')) {
        throw new TypeError('Invalid or duplicate local translation file.');
      }
      paths.add(file.filepath);
      return { filepath: file.filepath, translations: [...file.translations], needsReview: !!file.needsReview,
        trackedForExport: !!file.trackedForExport, revision: Number(file.revision) || 0,
        ...(!file.trackedForExport && file.stagingReset ? { stagingReset: true } : {}) };
    });
    const resetStaging = batch.resetStaging === true;
    if (resetStaging && (files.length !== 1 || batch.origin !== 'delete_staged' || batch.draft
      || batch.promoteDropped || Object.keys(batch.promoteDroppedByPath || {}).length
      || batch.collaboration?.promoteDropped || Object.keys(batch.collaboration?.promoteDroppedByPath || {}).length
      || files[0].needsReview || files[0].trackedForExport || !files[0].stagingReset)) {
      throw new TypeError('Invalid staged translation deletion.');
    }
    const resetBase = resetStaging ? batch.bases?.[files[0].filepath] : null;
    if (resetStaging && (!resetBase || !resetBase.trackedForExport || !Array.isArray(resetBase.translations)
      || resetBase.translations.some(line => typeof line !== 'string'))) {
      throw new TypeError('A staged translation deletion requires its captured saved translation.');
    }
    const draft = batch.draft;
    const captured = captureWorkspaceScope(batch);
    if (captured && (captured.game !== batch.game || captured.sourceHash !== (batch.sourceHash || '')
      || captured.accountId !== String(batch.accountId || 'guest') || captured.branchId !== (batch.branchId || captured.branchId))) {
      throw new TypeError('The captured workspace does not match this translation save.');
    }
    if (draft) {
      const scope = translationDraftScopeFromKey(draft.key);
      if (files.length !== 1 || scope.profile !== String(batch.accountId || 'guest') || scope.game !== batch.game
        || scope.sourceHash !== batch.sourceHash || scope.language !== batch.language || scope.filepath !== files[0].filepath
        || (scope.branchId || DEFAULT_BRANCH) !== (captured?.branchId || batch.branchId || DEFAULT_BRANCH)
        || typeof draft.id !== 'string' || !draft.id || typeof draft.revision !== 'string' || !draft.revision
        || !Array.isArray(draft.base?.translations) || draft.base.translations.some(line => typeof line !== 'string')) {
        throw new TypeError('The saved draft does not match its translation save scope.');
      }
    }
    const scope = [batch.game, batch.language, batch.sourceHash || '', String(batch.accountId || '')];
    const signature = JSON.stringify({ scope, files, descriptions: batch.descriptions || [], statuses: batch.statuses || {}, revisions: batch.revisions || [],
      collaboration: batch.collaboration || null, promoteDropped: batch.promoteDropped || null, promoteDroppedByPath: batch.promoteDroppedByPath || null,
      ...(resetStaging ? { resetStaging: true, origin: batch.origin, bases: batch.bases } : {}),
      ...(draft ? { draft } : {}) });
    const receiptKey = captured ? receiptScopeKey(captured) : 'translation_save_receipts_' + batch.game;
    const batchWorkspaceKey = workspaceKey(captured || batch.game), batchSourceKey = sourceKey(captured || batch.game);
    const db = await openDb();
    const revisionsStore = revisionStoreName(batch.game);
    const tx = db.transaction([STORE_KV, revisionsStore], 'readwrite');
    const done = txDone(tx);
    const kv = tx.objectStore(STORE_KV);
    let failure, result;
    const values = {};
    const keys = [batchWorkspaceKey, receiptKey, ...(batch.collaboration ? ['collaboration_v1'] : []), ...(draft ? [draft.key] : [])];
    let remaining = keys.length;
    const stale = message => Object.assign(new Error(message), { stale: true, code: 'SAVE_SCOPE_CHANGED' });
    const fail = error => { failure = error; try { tx.abort(); } catch (_) {} };
    const apply = () => {
      try {
        const receipts = values[receiptKey] || [];
        const receipt = receipts.find(item => item.jobId === batch.jobId);
        const savedWorkspace = values[batchWorkspaceKey];
        const stagedDraftBase = draft && savedWorkspace?.staged?.[batch.language]?.[files[0].filepath];
        const hasStagedDraftBase = stagedDraftBase && (!stagedDraftBase.sourceHash
          || stagedDraftBase.sourceHash === savedWorkspace?.sourceHash);
        // Modern ordinary saves use staged text and captured descriptions. Read
        // the full immutable ZIP only for an original draft base, migration or
        // deletion, keeping that read inside the same atomic save transaction.
        const needsSource = receipt ? resetStaging && !batch.collaboration
          : resetStaging || Number(savedWorkspace?.stagedVersion || 0) < 1 || (draft && !hasStagedDraftBase);
        if (needsSource && !Object.hasOwn(values, batchSourceKey)) {
          const read = kv.get(batchSourceKey);
          read.onsuccess = () => { values[batchSourceKey] = read.result?.value; apply(); };
          return;
        }
        if (receipt) {
          if (receipt.signature !== signature) throw new Error('A local save identifier was reused with different content.');
          result = { ...receipt.result, duplicate: true };
          if (batch.collaboration) {
            const workspace = values[batchWorkspaceKey];
            const room = values.collaboration_v1?.rooms?.[batch.collaboration.key];
            const current = workspace && room && (!workspace.sourceHash || workspace.sourceHash === batch.sourceHash)
              && (!workspace?.collaborationAccountId || String(workspace.collaborationAccountId) === String(batch.accountId))
              && matchesCollaborationIdentity(batch.collaboration.key, room.identity)
              && (room.identity?.branchId || DEFAULT_BRANCH) === (captured?.branchId || batch.branchId || DEFAULT_BRANCH);
            // Network synchronization might already have accepted this operation
            // before the worker reply was lost. Never resurrect an old outbox.
            result.operations = current ? room.outbox?.filter(operation => (receipt.result.mutationIds || [batch.jobId]).includes(operation.id)) || [] : [];
            result.operation = result.operations[0] || null;
            result.pending = current ? room.outbox?.length || 0 : 0;
            if (current) {
              result.files = files.map(file => room.local?.[file.filepath] || file);
              result.status = result.operation ? result.operation.status === 'conflict' ? 'conflict' : 'pending' : 'synced';
            }
          } else if (resetStaging) {
            const workspace = values[batchWorkspaceKey], source = values[batchSourceKey];
            if (workspace && (!workspace.sourceHash || workspace.sourceHash === batch.sourceHash)
              && (!batch.accountId || !workspace.collaborationAccountId || String(workspace.collaborationAccountId) === String(batch.accountId))) {
              result.files = files.map(file => {
                const original = source?.find(desc => desc.filepath === file.filepath);
                if (!original) return file;
                const current = WorkspaceState.workspaceFile(workspace, original, batch.language);
                // Another tab may have staged a new translation after this
                // deletion committed but before its lost response was retried.
                return { filepath: file.filepath, translations: current.translations, needsReview: false,
                  trackedForExport: current.hasChanges, revision: file.revision,
                  ...(!current.hasChanges ? { stagingReset: true } : {}) };
              });
            }
          }
          return;
        }
        const workspace = values[batchWorkspaceKey];
        if (!workspace || !Array.isArray(workspace.descs)) {
          throw new Error('The local workspace is unavailable. Keep this tab open and import the source archive before retrying the save.');
        }
        if (workspace.sourceHash && workspace.sourceHash !== (batch.sourceHash || '')) {
          throw stale('The source archive changed before this translation could be saved.');
        }
        if (captured && ((workspace.accountId && workspace.accountId !== captured.accountId)
          || (workspace.branchId || DEFAULT_BRANCH) !== captured.branchId)) throw stale('The saved translation belongs to another workspace profile or branch.');
        if (batch.accountId && workspace.collaborationAccountId
          && String(workspace.collaborationAccountId) !== String(batch.accountId)) {
          throw stale('The signed-in account changed before this translation could be saved.');
        }
        workspace.descs ||= []; workspace.status ||= {};
        const legacyWorkspace = Number(workspace.stagedVersion || 0) < 1;
        WorkspaceState.initializeWorkspace(workspace, { source: values[batchSourceKey] || batch.descriptions || [],
          sourceHash: batch.sourceHash, game: batch.game, language: batch.language, collaboration: values.collaboration_v1 });
        if (resetStaging) {
          const file = files[0], original = values[batchSourceKey]?.find(desc => desc.filepath === file.filepath);
          if (!original) throw new Error('The original ZIP translation is unavailable. Reimport the source archive before deleting its staged translation.');
          const current = WorkspaceState.workspaceFile(workspace, original, batch.language);
          if (!current.hasChanges) {
            throw Object.assign(new Error('This file no longer has a staged translation to delete.'), { code: 'DELETE_STAGED_NOT_FOUND', stale: true });
          }
          if (JSON.stringify(current.translations) !== JSON.stringify(resetBase.translations)) {
            throw Object.assign(new Error('The staged translation changed before it could be deleted. Review it again before deleting.'),
              { code: 'DELETE_STAGED_BASE_CHANGED', stale: true, filepath: file.filepath, currentTranslations: [...current.translations] });
          }
          const restored = [...(original.translations?.[batch.language] || [])];
          while (restored.length < (original.translations?.English?.length || 0)) restored.push('');
          if (JSON.stringify(file.translations) !== JSON.stringify(restored)) {
            throw new Error('A staged translation deletion must restore the original ZIP translation.');
          }
        }
        if (draft) {
          const current = values[draft.key];
          if (!current || current.state !== 'active' || current.id !== draft.id) {
            throw Object.assign(new Error('This draft was discarded, promoted or replaced before it could be saved. Reopen the file to review its current draft.'), { code: 'DRAFT_CHANGED' });
          }
          if (current.conflicts?.length) {
            throw Object.assign(new Error('Another local draft exists for this file. Review both drafts before saving.'), { code: 'DRAFT_CONFLICT' });
          }
        }
        if (draft) {
          const filepath = files[0].filepath;
          const original = (values[batchSourceKey] || batch.descriptions || []).find(file => file.filepath === filepath)
            || workspace.descs.find(file => file.filepath === filepath);
          const current = original ? WorkspaceState.workspaceFile(workspace, original, batch.language).translations : [];
          if (JSON.stringify(current) !== JSON.stringify(draft.base.translations)) {
            throw Object.assign(new Error('The committed translation changed after this draft was opened. Review both versions in the editor before saving.'),
              { code: 'DRAFT_BASE_CHANGED', filepath, currentTranslations: [...current] });
          }
        }
        for (const file of files) if (!resetStaging && (!legacyWorkspace || !file.needsReview)) {
          // An editor save stages translations. Legacy wire booleans cannot
          // turn a modern save into a dropped record or suppress its presence.
          file.needsReview = false; file.trackedForExport = true;
          delete file.stagingReset;
        }
        const descriptions = new Map(workspace.descs.map(desc => [desc.filepath, desc]));
        const templates = new Map((batch.descriptions || []).map(desc => [desc.filepath, desc]));
        let room, state, operation, operations;
        const collaboration = batch.collaboration;
        const promotions = { ...(batch.promoteDroppedByPath || {}), ...(collaboration?.promoteDroppedByPath || {}) };
        const singlePromotion = batch.promoteDropped || collaboration?.promoteDropped;
        if (singlePromotion) {
          if (files.length !== 1) throw new Error('A dropped translation promotion must name one file.');
          promotions[files[0].filepath] = singlePromotion;
        }
        if (collaboration) {
          const identity = collaboration.identity;
          if (!identity || identity.game !== batch.game || identity.language !== batch.language
            || identity.sourceHash !== batch.sourceHash || String(identity.accountId) !== String(batch.accountId)
            || (identity.branchId || DEFAULT_BRANCH) !== (captured?.branchId || batch.branchId || DEFAULT_BRANCH)
            || !matchesCollaborationIdentity(collaboration.key, identity)) {
            throw stale('This translation save no longer matches its shared workspace.');
          }
          state = values.collaboration_v1;
          room = state?.rooms?.[collaboration.key];
          if (!room || !matchesCollaborationIdentity(collaboration.key, room.identity)) {
            throw stale('The shared workspace changed before this translation could be saved.');
          }
          if (draft && ((room.conflicts || []).some(conflict => paths.has(conflict.filepath))
            || (room.outbox || []).some(operation => (operation.blockedByConflict
              || ['conflict', 'candidate_conflict', 'needs_candidate_review'].includes(operation.status))
              && operation.files?.some(entry => paths.has(entry.yours?.filepath))))) {
            throw Object.assign(new Error('This file has an unresolved shared translation conflict. Review it in the editor before saving the draft.'),
              { code: 'DRAFT_CONFLICT', filepath: files[0].filepath });
          }
          if (resetStaging) {
            const filepath = files[0].filepath;
            if ((room.conflicts || []).some(conflict => conflict.filepath === filepath)
              || (room.outbox || []).some(operation => (operation.blockedByConflict
                || ['conflict', 'candidate_conflict', 'needs_candidate_review'].includes(operation.status))
                && operation.files?.some(entry => entry.yours?.filepath === filepath))) {
              throw Object.assign(new Error('Resolve this file\'s shared translation conflict before deleting its staged translation.'),
                { code: 'DELETE_STAGED_CONFLICT', stale: true, filepath });
            }
            const captured = collaboration.bases?.[filepath], current = room.local?.[filepath];
            if (!captured || !current || Number(captured.revision || 0) !== Number(current.revision || 0)
              || !current.trackedForExport || JSON.stringify(current.translations) !== JSON.stringify(resetBase.translations)
              || JSON.stringify(captured.translations) !== JSON.stringify(resetBase.translations)) {
              throw Object.assign(new Error('The shared staged translation changed before it could be deleted. Review it again before deleting.'),
                { code: 'DELETE_STAGED_BASE_CHANGED', stale: true, filepath });
            }
          }
          const originals = new Map((room.manifest?.files || []).map(file => [file.filepath, file]));
          for (const file of files) {
            const original = originals.get(file.filepath);
            const entryCount = original?.entryCount ?? original?.english?.length;
            if (!original || !Number.isSafeInteger(entryCount) || (!resetStaging && file.translations.length > entryCount)) {
              throw new Error('Saved file does not match the source: ' + file.filepath);
            }
            while (file.translations.length < entryCount) file.translations.push('');
          }
          if (collaboration.restore && (files.length !== 1 || !collaboration.restore.eventId
            || !['before', 'after'].includes(collaboration.restore.version))) throw new Error('Invalid shared history restore.');
          room.outbox ||= []; room.local ||= {};
          room.placeholderRepairs = (room.placeholderRepairs || []).filter(repair => !paths.has(repair.filepath));
          const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
          const replaced = new Set(room.outbox.filter(op => ['candidate_conflict', 'needs_candidate_review'].includes(op.status)
            && op.files.every(entry => paths.has(entry.yours.filepath))).flatMap(op => op.files.map(entry => entry.yours.filepath)));
          room.recovery ||= [];
          for (const op of room.outbox.filter(op => ['candidate_conflict', 'needs_candidate_review'].includes(op.status)
            && op.files.every(entry => replaced.has(entry.yours.filepath)))) room.recovery.push({ at: Date.now(), reason: 'Saved result before a fresh dropped-copy review', files: op.files.map(entry => clone(entry.yours)) });
          room.outbox = room.outbox.filter(op => !['candidate_conflict', 'needs_candidate_review'].includes(op.status)
            || !op.files.every(entry => replaced.has(entry.yours.filepath)));
          const promoted = files.filter(file => promotions[file.filepath]), ordinary = files.filter(file => !promotions[file.filepath]);
          const groups = [...promoted.map(file => [file]), ...(ordinary.length ? [ordinary] : [])];
          operations = groups.map((group, index) => ({ id: index ? batch.jobId + ':' + index : batch.jobId, origin: collaboration.origin || 'save', status: 'pending',
            ...(resetStaging ? { resetStaging: true } : {}),
            ...(promotions[group[0].filepath] ? { promoteDropped: clone(promotions[group[0].filepath]) } : {}),
            ...(collaboration.restore ? { restore: { ...collaboration.restore, translations: [...files[0].translations] } } : {}),
            files: group.map(yours => ({ base: clone(replaced.has(yours.filepath) ? room.shared?.[yours.filepath] || null : Object.hasOwn(collaboration.bases || {}, yours.filepath)
              ? collaboration.bases[yours.filepath] : room.local[yours.filepath] || null), yours: clone(yours) })) }));
          operation = operations[0]; room.outbox.push(...operations);
          for (const file of files) {
            room.local[file.filepath] = clone(file);
            if (!resetStaging && room.mode === 'sparse' && !file.needsReview) {
              if (room.carries) delete room.carries[file.filepath];
              if (room.carryRevisions) delete room.carryRevisions[file.filepath];
            }
          }
        }
        for (const file of files) {
          const template = templates.get(file.filepath);
          let desc = descriptions.get(file.filepath);
          if (!desc) {
            if (!template) throw new Error('The saved file is missing its source description: ' + file.filepath);
            desc = { ...template, translations: { English: [...(template.translations?.English || [])] } };
            workspace.descs.push(desc); descriptions.set(file.filepath, desc);
          } else if (template) {
            for (const key of ['filedir', 'filename', 'name', 'remarks', 'stats', 'variables']) {
              if (Object.hasOwn(template, key)) desc[key] = template[key];
            }
          }
          desc.translations ||= {};
          const count = desc.translations.English?.length ?? template?.translations?.English?.length;
          if (!resetStaging && count != null && file.translations.length > count) throw new Error('Translation count exceeds source entry count: ' + file.filepath);
          if (resetStaging) {
            delete workspace.staged[batch.language][file.filepath];
          } else if (legacyWorkspace && file.needsReview) {
            WorkspaceState.dropTranslation(workspace, desc, batch.language, { game: batch.game, translations: file.translations,
              originSourceHash: batch.sourceHash, reason: 'Recovered translation' });
            if (workspace.staged[batch.language]) delete workspace.staged[batch.language][file.filepath];
          } else {
            WorkspaceState.stageTranslation(workspace, file, batch.language, { source: desc, sourceHash: batch.sourceHash,
              promoteDropped: promotions[file.filepath], saveOrigin: collaboration?.origin || batch.origin || 'save' });
          }
          desc.translations[batch.language] = [...file.translations];
          const status = workspace.status[file.filepath] ||= {};
          const submitted = batch.statuses?.[file.filepath] || {};
          WorkspaceState.setFileMetadata(status, batch.language, submitted, desc);
        }
        if (batch.sourceHash) workspace.sourceHash = batch.sourceHash;
        if (collaboration) workspace.collaborationAccountId = String(batch.accountId);
        kv.put({ key: batchWorkspaceKey, value: pruneWorkspace(workspace) });
        if (state) kv.put({ key: 'collaboration_v1', value: state });
        for (const revision of batch.revisions || []) tx.objectStore(revisionsStore).add(scopedRevision({ ...revision,
          ...(batch.sourceHash ? { sourceHash: batch.sourceHash } : {}),
          ...(collaboration ? { collaborationAccountId: String(batch.accountId) } : {}) }, captured));
        let draftConsumed = false;
        if (draft) {
          const current = values[draft.key];
          if (current?.state === 'active' && current.id === draft.id && current.revision === draft.revision) {
            if (JSON.stringify(current.translations) !== JSON.stringify(files[0].translations)) {
              throw Object.assign(new Error('The saved translation does not match the captured draft.'), { code: 'DRAFT_CHANGED' });
            }
            kv.put({ key: draft.key, value: { ...current, state: 'promoted', consumedRevision: current.revision,
              consumedSignature: draftContentSignature(current),
              revision: current.revision + ':promoted:' + batch.jobId, translations: [], base: null, source: null, saveJobId: batch.jobId } });
            draftConsumed = true;
          }
        }
        result = { jobId: batch.jobId, status: collaboration ? 'pending' : 'local', files,
          ...(draft ? { draftConsumed } : {}),
          ...(collaboration ? { mutationId: batch.jobId, mutationIds: operations.map(op => op.id), pending: room.outbox.length, operation, operations } : {}) };
        // A lost worker response can be retried with the original identifier.
        // Keep recent receipts without growing the workspace on every save.
        kv.put({ key: receiptKey, value: [...receipts, { jobId: batch.jobId, signature, result }].slice(-256) });
      } catch (error) { fail(error); }
    };
    try {
      for (const key of keys) {
        const read = kv.get(key);
        read.onsuccess = () => { values[key] = read.result?.value; if (--remaining === 0) apply(); };
      }
    } catch (error) { fail(error); }
    try { await done; } catch (error) { throw failure || error; }
    return result;
  }

  // Read/modify/write collaboration cache, retry queue, replay cursor and local
  // working/history data in one transaction. Both callbacks must be synchronous.
  async function updateCollaborationState(update, options = {}) {
    const gameVersion = normalizeGameVersion(options.version);
    const captured = options.scope ? normalizeWorkspaceScope(options.scope) : captureWorkspaceScope({ game: gameVersion,
      sourceHash: options.workspace?.sourceHash });
    const revisions = options.revisions || [];
    if (!Array.isArray(revisions)) throw new TypeError('Revisions must be an array');
    const revisionsStore = revisionStoreName(gameVersion);
    const db = await openDb();
    const tx = db.transaction(revisions.length ? [STORE_KV, revisionsStore] : [STORE_KV], 'readwrite');
    const done = txDone(tx);
    const kv = tx.objectStore(STORE_KV);
    let result;
    let failure;
    const read = kv.get('collaboration_v1');
    read.onsuccess = () => {
      try {
        result = update(read.result?.value);
        if (result && typeof result.then === 'function') throw new Error('Collaboration storage update must be synchronous');
        if (!options.projectWorkspace) kv.put({ key: 'collaboration_v1', value: result });
        for (const revision of revisions) tx.objectStore(revisionsStore).add(scopedRevision(revision, captured));
        if (Object.hasOwn(options, 'workspace')) kv.put({ key: workspaceKey(captured || gameVersion), value: pruneWorkspace(options.workspace) });
        if (options.projectWorkspace) {
          const workspaceRead = kv.get(workspaceKey(captured || gameVersion));
          workspaceRead.onsuccess = () => {
            try {
              const projected = options.projectWorkspace(workspaceRead.result?.value, result);
              if (projected && typeof projected.then === 'function') throw new Error('Workspace projection must be synchronous');
              if (projected !== undefined) kv.put({ key: workspaceKey(captured || gameVersion), value: pruneWorkspace(projected) });
              // The projection may bind an operation to the latest candidate
              // receipt from this same transaction. Persist the final state.
              kv.put({ key: 'collaboration_v1', value: result });
            } catch (error) { failure = error; tx.abort(); }
          };
        }
      } catch (error) { failure = error; tx.abort(); }
    };
    try { await done; } catch (error) { throw failure || error; }
    return result;
  }

  async function revisionAdd(rev, version) {
    const captured = scopedVersion(version);
    return withStore(revisionStoreName(version), 'readwrite', async (store) => {
      return requestToPromise(store.add(scopedRevision(rev, captured)));
    });
  }

  async function revisionGet(id, version) {
    const captured = typeof version === 'object' && version.legacyHistory
      ? { ...normalizeWorkspaceScope(version), legacyHistory: true } : scopedVersion(version);
    return withStore(revisionStoreName(version), 'readonly', async (store) => {
      const row = await requestToPromise(store.get(Number(id)));
      return row && revisionInScope(row, captured) ? row : undefined;
    });
  }

  async function revisionList(filepath, lang, limit = 50, version) {
    const captured = typeof version === 'object' && version.legacyHistory
      ? { ...normalizeWorkspaceScope(version), legacyHistory: true } : scopedVersion(version);
    return withStore(revisionStoreName(version), 'readonly', async (store) => {
      const idx = store.index('by_file_lang_time');
      const range = IDBKeyRange.bound([filepath, lang, 0], [filepath, lang, Number.MAX_SAFE_INTEGER]);
      const items = [];

      await new Promise((resolve, reject) => {
        const req = idx.openCursor(range, 'prev');
        req.onerror = () => reject(req.error || new Error('IndexedDB cursor failed'));
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) {
            resolve();
            return;
          }
          if (revisionInScope(cursor.value, captured)) items.push(cursor.value);
          if (items.length >= limit) {
            resolve();
            return;
          }
          cursor.continue();
        };
      });

      return items;
    });
  }

  async function revisionLatest(filepath, lang, version) {
    const items = await revisionList(filepath, lang, 1, version);
    return items[0] || undefined;
  }

  function revisionInScope(row, scope) {
    return !scope || ((scope.legacyHistory || row.sourceHash === scope.sourceHash) && (row.branchId || DEFAULT_BRANCH) === scope.branchId
      && String(row.accountId || row.collaborationAccountId || 'guest') === scope.accountId);
  }

  async function revisionClearAll(version) {
    const captured = scopedVersion(version);
    return withStore(revisionStoreName(version), 'readwrite', async (store) => {
      if (!captured) { store.clear(); return; }
      await new Promise((resolve, reject) => {
        const read = store.openCursor();
        read.onerror = () => reject(read.error);
        read.onsuccess = () => {
          const cursor = read.result;
          if (!cursor) { resolve(); return; }
          if (revisionInScope(cursor.value, captured)) cursor.delete();
          cursor.continue();
        };
      });
    });
  }

  async function storeCount(storeName) {
    return withStore(storeName, 'readonly', async (store) => {
      return requestToPromise(store.count());
    });
  }

  async function revisionCopyAll(fromStoreName, toStoreName) {
    const db = await openDb();
    const tx = db.transaction([fromStoreName, toStoreName], 'readwrite');
    const fromStore = tx.objectStore(fromStoreName);
    const toStore = tx.objectStore(toStoreName);

    await new Promise((resolve, reject) => {
      const req = fromStore.openCursor();
      req.onerror = () => reject(req.error || new Error('IndexedDB cursor failed'));
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve();
          return;
        }
        const value = { ...cursor.value };
        delete value.id;
        toStore.add(value);
        cursor.continue();
      };
    });

    await txDone(tx);
  }

  async function migrateFromLocalStorageIfNeeded() {
    const migrated = await kvGet(KV_MIGRATED);
    if (migrated) return;
    console.log("Migrate from localStorage storage...");

    let settings;
    try {
      const raw = localStorage.getItem('settings');
      if (raw) settings = JSON.parse(raw);
    } catch (_) {
    }
    console.log('localStorage settings', settings);

    let workspace;
    try {
      const raw = localStorage.getItem('localDescs');
      if (raw) workspace = JSON.parse(raw);
    } catch (_) {
    }
    console.log('localStorage localDescs', workspace);

    if (settings) await kvSet(KV_SETTINGS, settings);
    if (workspace) await kvSet(KV_WORKSPACE_LEGACY, workspace);

    // try {
    //   if (settings) {
    //     localStorage.setItem('__backup_settings', JSON.stringify(settings));
    //     localStorage.removeItem('settings');
    //     console.log('localStorage settings renamed');
    //   }
    //   if (workspace) {
    //     localStorage.setItem('__backup_localDescs', JSON.stringify(workspace));
    //     localStorage.removeItem('localDescs');
    //     console.log('localStorage localDescs renamed');
    //   }
    // } catch (_) {
    // }

    await kvSet(KV_MIGRATED, true);
  }

  const root = typeof window === 'object' ? window : self;
  root.OfflineStore = {
    isAvailable,
    normalizeGameVersion,
    setGameVersion,
    setWorkspaceContext,
    captureWorkspaceScope,
    normalizeWorkspaceScope,
    getVersionWorkspace,
    getVersionSource,
    activateVersion,
    setVersionMetadata,
    listLocalVersions,
    getVersionCatalog,
    setVersionCatalog,
    getVersionUpload,
    setVersionUpload,
    getVersionCollectionRequest,
    setVersionCollectionRequest,
    adoptGuestVersion,
    migrateFromLocalStorageIfNeeded,
    getSettings: () => kvGet(KV_SETTINGS),
    setSettings: (settings) => kvSet(KV_SETTINGS, settings),
    getHybridState: () => kvGet('hybrid_v1'),
    updateHybridState,
    getWorkspace,
    updateWorkspace,
    setWorkspace,
    saveWorkspaceWithRevisions,
    saveSourceWorkspaceWithRevisions,
    getImportedBaseline: (id, version) => kvGet(importedBaselineKey(id, version)),
    translationDraftKey,
    getTranslationDraft,
    listTranslationDrafts,
    putTranslationDraft,
    discardTranslationDraft,
    saveTranslationBatch,
    getCollaborationState: () => kvGet('collaboration_v1'),
    updateCollaborationState,
    getSource,
    setSource: (source, version) => kvSet(sourceKey(version), source),
    clearWorkspace: (version) => kvDel(workspaceKey(version)),
    clearSource: (version) => kvDel(sourceKey(version)),
    clearRevisions: (version) => revisionClearAll(version),
    addRevision: revisionAdd,
    listRevisions: revisionList,
    listLegacyRevisions: (filepath, language, limit, game) => revisionList(filepath, language, limit, { game, legacyHistory: true }),
    getRevision: revisionGet,
    getLatestRevision: revisionLatest,
    getLegacyWorkspace: () => kvGet(KV_WORKSPACE_LEGACY),
    getLegacySource: () => kvGet(KV_SOURCE_LEGACY),
    getLegacyRevisionCount: () => storeCount(STORE_REVISIONS_LEGACY),
    hasMigratedFromSingleVersion: () => kvGet(KV_MIGRATED_SINGLE_VERSION),
    setMigratedFromSingleVersion: (value) => kvSet(KV_MIGRATED_SINGLE_VERSION, !!value),
    copyLegacyToVersion: async (version) => {
      const v = normalizeGameVersion(version);
      const legacyWorkspace = await kvGet(KV_WORKSPACE_LEGACY);
      const legacySource = await kvGet(KV_SOURCE_LEGACY);
      if (typeof legacyWorkspace !== 'undefined') await kvSet(KV_WORKSPACE_PREFIX + v, legacyWorkspace);
      if (typeof legacySource !== 'undefined') await kvSet(KV_SOURCE_PREFIX + v, legacySource);
      await revisionCopyAll(STORE_REVISIONS_LEGACY, revisionStoreName(v));
      await kvSet(KV_MIGRATED_SINGLE_VERSION, true);
      return { workspace: legacyWorkspace, source: legacySource };
    },
  };
})();
