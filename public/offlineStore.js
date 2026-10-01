(() => {
  const DB_NAME = 'sdeditor';
  const DB_VERSION = 3;

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
  const KV_OWNER = 'coordinator_owner_v1';
  const OWNER_DURATION = 30000;

  let currentGameVersion = 'poe1';
  let ownership = null;
  let statusHandler = null;

  function storageError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function reportStatus(status) {
    try { statusHandler?.(status); } catch (_) {}
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
        const db = req.result;
        if (blocked) { db.close(); _dbPromise = null; return; }
        db.onversionchange = () => {
          db.close();
          _dbPromise = null;
          reportStatus({ code: 'DB_VERSION_CHANGED', message: 'SDEditor storage was updated. Reconnect this tab before saving.' });
        };
        resolve(db);
      };
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
      let blocked = false;
      req.onblocked = () => {
        blocked = true;
        const error = storageError('DB_UPGRADE_BLOCKED', 'Close older SDEditor tabs to finish updating local storage, then check again.');
        reportStatus({ code: error.code, message: error.message });
        reject(error);
      };
    });
    _dbPromise.catch(() => { _dbPromise = null; });
    return _dbPromise;
  }

  // All writers take the kv lock, including history-only writes. Checking the
  // lease within that same transaction fences a suspended former coordinator.
  async function transaction(storeNames, mode, fn, unfenced = false) {
    const db = await openDb();
    const names = [...new Set(mode === 'readwrite' ? [STORE_KV, ...storeNames] : storeNames)];
    const tx = db.transaction(names, mode);
    const done = txDone(tx);
    const expectedOwner = ownership;
    let result;
    try {
      if (mode === 'readwrite' && !unfenced) {
        const row = await requestToPromise(tx.objectStore(STORE_KV).get(KV_OWNER));
        const lease = row?.value;
        if (!expectedOwner && lease) {
          throw storageError('OWNERSHIP_REQUIRED', 'Local storage is managed by the SDEditor coordinator. Reconnect before saving.');
        }
        if (expectedOwner && (!lease || lease.ownerId !== expectedOwner.ownerId || lease.generation !== expectedOwner.generation || lease.expiresAt <= Date.now())) {
          throw storageError('OWNERSHIP_LOST', 'This SDEditor coordinator no longer owns local storage. Reconnect before saving.');
        }
      }
      result = await fn(tx);
    } catch (error) {
      try { tx.abort(); } catch (_) {}
      await done.catch(() => {});
      throw error;
    }
    await done;
    return result;
  }

  async function readValues(tx, keys) {
    const kv = tx.objectStore(STORE_KV);
    const rows = await Promise.all(keys.map(key => requestToPromise(kv.get(key))));
    return rows.map(row => row?.value);
  }

  function configureOwnership(lease) {
    if (!lease || !lease.ownerId || !Number.isSafeInteger(lease.generation)) throw new TypeError('A valid ownership lease is required');
    ownership = { ...lease };
    return { ...ownership };
  }

  async function acquireOwnership(ownerId, now) {
    if (!ownerId) throw new TypeError('An owner ID is required');
    return transaction([STORE_KV], 'readwrite', async tx => {
      const kv = tx.objectStore(STORE_KV);
      const [previous] = await readValues(tx, [KV_OWNER]);
      const observedNow = now === undefined ? Date.now() : now;
      if (previous?.ownerId && previous.expiresAt > observedNow && previous.ownerId !== ownerId) return null;
      const sameLiveOwner = previous?.ownerId === ownerId && previous.expiresAt > observedNow;
      const lease = { ownerId, generation: sameLiveOwner ? previous.generation : (previous?.generation || 0) + 1, expiresAt: observedNow + OWNER_DURATION };
      kv.put({ key: KV_OWNER, value: lease });
      return lease;
    }, true);
  }

  async function renewOwnership(lease = ownership, now) {
    if (!lease) throw storageError('OWNERSHIP_LOST', 'No storage ownership lease is configured.');
    const renewed = await transaction([STORE_KV], 'readwrite', async tx => {
      const [current] = await readValues(tx, [KV_OWNER]);
      const observedNow = now === undefined ? Date.now() : now;
      if (!current || current.ownerId !== lease.ownerId || current.generation !== lease.generation || current.expiresAt <= observedNow) {
        throw storageError('OWNERSHIP_LOST', 'Storage ownership expired. Reconnect before saving.');
      }
      const next = { ...current, expiresAt: observedNow + OWNER_DURATION };
      tx.objectStore(STORE_KV).put({ key: KV_OWNER, value: next });
      return next;
    }, true);
    if (ownership?.ownerId === renewed.ownerId && ownership.generation === renewed.generation) ownership = renewed;
    return renewed;
  }

  async function releaseOwnership(lease = ownership) {
    if (!lease) return false;
    return transaction([STORE_KV], 'readwrite', async tx => {
      const [current] = await readValues(tx, [KV_OWNER]);
      if (current?.ownerId !== lease.ownerId || current.generation !== lease.generation) return false;
      // Retain the generation so a subsequent owner never reuses a fence.
      tx.objectStore(STORE_KV).put({ key: KV_OWNER, value: { ...current, ownerId: null, expiresAt: 0 } });
      return true;
    }, true);
  }

  async function withStore(storeName, mode, fn) {
    return transaction([storeName], mode, tx => fn(tx.objectStore(storeName), tx));
  }

  // Read/modify/write one durable hybrid snapshot in a single transaction. The
  // callback must be synchronous so the transaction never becomes inactive.
  async function updateHybridState(update, options = {}) {
    return transaction([STORE_KV], 'readwrite', async tx => {
      const receiptKey = options.requestId ? 'hybrid_receipt_' + options.requestId : null;
      const [previous, receipt] = await readValues(tx, ['hybrid_v1', ...(receiptKey ? [receiptKey] : [])]);
      if (receipt) return previous;
      const result = update(previous);
      if (result && typeof result.then === 'function') throw new Error('Hybrid storage update must be synchronous');
      tx.objectStore(STORE_KV).put({ key: 'hybrid_v1', value: result });
      if (receiptKey) tx.objectStore(STORE_KV).put({ key: receiptKey, value: { committed: true, at: Date.now() } });
      return result;
    });
  }

  async function kvGet(key) {
    return withStore(STORE_KV, 'readonly', async (store) => {
      const row = await requestToPromise(store.get(key));
      return row ? row.value : undefined;
    });
  }

  async function kvSet(key, value) {
    return withStore(STORE_KV, 'readwrite', async (store, tx) => {
      await advanceWorkspaceRevisionForKey(tx, key);
      store.put({ key, value });
    });
  }

  async function kvDel(key) {
    return withStore(STORE_KV, 'readwrite', async (store, tx) => {
      await advanceWorkspaceRevisionForKey(tx, key);
      store.delete(key);
    });
  }

  function normalizeGameVersion(version) {
    const v = String(version || currentGameVersion || '').toLowerCase();
    if (v === 'poe2') return 'poe2';
    return 'poe1';
  }

  function revisionStoreName(version) {
    return normalizeGameVersion(version) === 'poe2' ? STORE_REVISIONS_POE2 : STORE_REVISIONS_POE1;
  }

  function workspaceKey(version) {
    return KV_WORKSPACE_PREFIX + normalizeGameVersion(version);
  }

  function sourceKey(version) {
    return KV_SOURCE_PREFIX + normalizeGameVersion(version);
  }

  function workspaceMetaKey(version) {
    return 'workspace_meta_' + normalizeGameVersion(version);
  }

  function snapshotFrom(workspace, source, meta) {
    return { workspace, source, generation: meta?.generation || 0, revision: meta?.revision || 0 };
  }

  function sameStoredValue(left, right) {
    if (Object.is(left, right)) return true;
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
    if (Array.isArray(left) !== Array.isArray(right)) return false;
    if (Array.isArray(left) && left.length !== right.length) return false;
    const tag = Object.prototype.toString.call(left);
    if (tag !== Object.prototype.toString.call(right)) return false;
    if (tag === '[object Date]') return Date.prototype.getTime.call(left) === Date.prototype.getTime.call(right);
    if (tag !== '[object Object]' && tag !== '[object Array]') return false;
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && sameStoredValue(left[key], right[key]));
  }

  function checkGeneration(snapshot, expected) {
    if (expected !== undefined && snapshot.generation !== expected) {
      throw storageError('SOURCE_GENERATION_CHANGED', 'The source workspace changed in another tab. Keep this draft for recovery and reopen the file before saving.');
    }
  }

  async function advanceWorkspaceRevisionForKey(tx, key) {
    const match = /^(?:workspace|source)_(poe1|poe2)$/.exec(key);
    if (!match) return;
    const [meta] = await readValues(tx, [workspaceMetaKey(match[1])]);
    tx.objectStore(STORE_KV).put({ key: workspaceMetaKey(match[1]), value: { generation: meta?.generation || 0, revision: (meta?.revision || 0) + 1 } });
  }

  async function getWorkspaceSnapshot(version) {
    return transaction([STORE_KV], 'readonly', async tx => {
      const values = await readValues(tx, [workspaceKey(version), sourceKey(version), workspaceMetaKey(version)]);
      return snapshotFrom(...values);
    });
  }

  function setGameVersion(version) {
    currentGameVersion = normalizeGameVersion(version);
    return currentGameVersion;
  }

  // Persist a bulk translation change and its recovery history together. Queue
  // every write synchronously so IndexedDB cannot commit a partial batch.
  async function saveWorkspaceWithRevisions(workspace, revisions, version) {
    if (!Array.isArray(revisions)) throw new TypeError('Revisions must be an array');
    const gameVersion = normalizeGameVersion(version);
    const revisionsStore = revisionStoreName(gameVersion);
    return transaction([STORE_KV, revisionsStore], 'readwrite', async tx => {
      await advanceWorkspaceRevisionForKey(tx, workspaceKey(gameVersion));
      tx.objectStore(STORE_KV).put({ key: workspaceKey(gameVersion), value: workspace });
      const store = tx.objectStore(revisionsStore);
      for (const revision of revisions) store.add(revision);
    });
  }

  // The source identity must advance in the same durable commit as the imported
  // workspace. Collaboration queues retain their own old source/account scope.
  async function saveSourceWorkspaceWithRevisions(source, workspace, revisions, version) {
    if (!Array.isArray(revisions)) throw new TypeError('Revisions must be an array');
    const gameVersion = normalizeGameVersion(version);
    const revisionsStore = revisionStoreName(gameVersion);
    return transaction([STORE_KV, revisionsStore], 'readwrite', async tx => {
      await advanceWorkspaceRevisionForKey(tx, workspaceKey(gameVersion));
      const kv = tx.objectStore(STORE_KV);
      kv.put({ key: sourceKey(gameVersion), value: source });
      kv.put({ key: workspaceKey(gameVersion), value: workspace });
      for (const revision of revisions) tx.objectStore(revisionsStore).add(revision);
    });
  }

  // Source replacement/reset is an explicit generation change. Queued edits
  // stay available for recovery but cannot upload into a replacement workspace.
  async function replaceWorkspace({ game, version, source, workspace, revisions = [], generation, revision, expectedRevision = revision, expectedAuth, requestId, reset = false }) {
    if (!Array.isArray(revisions)) throw new TypeError('Revisions must be an array');
    const gameVersion = normalizeGameVersion(game || version);
    const revisionsStore = revisionStoreName(gameVersion);
    const receiptKey = requestId ? 'workspace_receipt_' + gameVersion + '_' + requestId : null;
    return transaction([STORE_KV, revisionsStore], 'readwrite', async tx => {
      const kv = tx.objectStore(STORE_KV);
      const [previousWorkspace, previousSource, meta, collaboration, hybrid, receipt] = await readValues(tx, [
        workspaceKey(gameVersion), sourceKey(gameVersion), workspaceMetaKey(gameVersion), 'collaboration_v1', 'hybrid_v1', ...(receiptKey ? [receiptKey] : []),
      ]);
      const current = snapshotFrom(previousWorkspace, previousSource, meta);
      // Authentication may change while this command waits for the kv lock.
      // Fence against the durable state in the same transaction as replacement.
      // The optional token is supplied only inside the coordinator, never saved
      // in a receipt or included in a tab-facing workspace snapshot.
      if (expectedAuth && (!hybrid || hybrid.activeProfile !== expectedAuth.profile
        || (hybrid.auth?.user?.language || '') !== (expectedAuth.language || '')
        || (hybrid.auth?.user?.assignmentVersion ?? null) !== (expectedAuth.assignmentVersion ?? null)
        || (Object.hasOwn(expectedAuth, 'token') && (hybrid.auth?.token ?? null) !== (expectedAuth.token ?? null)))) {
        throw Object.assign(storageError('CONTEXT_CHANGED', 'The account or language assignment changed before the source could be saved. Review this workspace before importing again.'), { stale: true });
      }
      if (receipt) return { ...current, duplicate: true };
      checkGeneration(current, generation);
      if (expectedRevision !== undefined && current.revision !== expectedRevision) {
        throw storageError('WORKSPACE_REVISION_CHANGED', 'Saved translations changed in another tab. Reload the workspace and retry the source import.');
      }
      const next = { workspace: reset ? undefined : workspace, source: reset ? undefined : source,
        generation: current.generation + 1, revision: current.revision + 1 };
      if (reset) {
        kv.delete(workspaceKey(gameVersion));
        kv.delete(sourceKey(gameVersion));
        tx.objectStore(revisionsStore).clear();
      } else {
        kv.put({ key: workspaceKey(gameVersion), value: workspace });
        kv.put({ key: sourceKey(gameVersion), value: source });
      }
      kv.put({ key: workspaceMetaKey(gameVersion), value: { generation: next.generation, revision: next.revision } });
      for (const revision of revisions) tx.objectStore(revisionsStore).add(revision);
      if (collaboration?.rooms) {
        for (const room of Object.values(collaboration.rooms)) {
          if (room.identity?.gameVersion !== gameVersion && room.identity?.game !== gameVersion) continue;
          room.recovery ||= [];
          room.recovery.push({ at: Date.now(), reason: reset ? 'Workspace reset' : 'Source workspace replaced',
            sourceGeneration: current.generation, files: Object.values(room.local || {}), outbox: room.outbox || [], conflicts: room.conflicts || [] });
          room.outbox = [];
          room.conflicts = [];
          room.recoveryOnly = true;
        }
        kv.put({ key: 'collaboration_v1', value: collaboration });
      }
      if (receiptKey) kv.put({ key: receiptKey, value: { generation: next.generation, revision: next.revision } });
      return next;
    });
  }

  // Read/modify/write collaboration cache, retry queue, replay cursor and local
  // working/history data in one transaction. Both callbacks must be synchronous.
  async function updateCollaborationState(update, options = {}) {
    const gameVersion = normalizeGameVersion(options.game || options.version);
    const revisions = options.revisions || [];
    if (!Array.isArray(revisions)) throw new TypeError('Revisions must be an array');
    const revisionsStore = revisionStoreName(gameVersion);
    const receiptKey = options.requestId ? 'collaboration_receipt_' + gameVersion + '_' + options.requestId : null;
    return transaction(revisions.length ? [STORE_KV, revisionsStore] : [STORE_KV], 'readwrite', async tx => {
      const kv = tx.objectStore(STORE_KV);
      const [previous, workspace, source, meta, receipt] = await readValues(tx, [
        'collaboration_v1', workspaceKey(gameVersion), sourceKey(gameVersion), workspaceMetaKey(gameVersion), ...(receiptKey ? [receiptKey] : []),
      ]);
      const snapshot = snapshotFrom(workspace, source, meta);
      if (receipt) return options.returnSnapshot ? { state: previous, ...snapshot, duplicate: true } : previous;
      checkGeneration(snapshot, options.generation);
      const result = update(previous, snapshot);
      if (result && typeof result.then === 'function') throw new Error('Collaboration storage update must be synchronous');
      kv.put({ key: 'collaboration_v1', value: result });
      for (const revision of revisions) tx.objectStore(revisionsStore).add(revision);
      let projected = Object.hasOwn(options, 'workspace') ? options.workspace : workspace;
      if (options.projectWorkspace) {
        const value = options.projectWorkspace(projected, result, snapshot);
        if (value && typeof value.then === 'function') throw new Error('Workspace projection must be synchronous');
        if (value !== undefined) projected = value;
      }
      const workspaceChanged = (Object.hasOwn(options, 'workspace') || options.projectWorkspace) && !sameStoredValue(workspace, projected);
      if (workspaceChanged) {
        kv.put({ key: workspaceKey(gameVersion), value: projected });
      }
      const next = { ...snapshot, workspace: projected, revision: snapshot.revision + (workspaceChanged ? 1 : 0) };
      if (workspaceChanged) kv.put({ key: workspaceMetaKey(gameVersion), value: { generation: next.generation, revision: next.revision } });
      if (receiptKey) kv.put({ key: receiptKey, value: { generation: next.generation, revision: next.revision } });
      return options.returnSnapshot ? { state: result, ...next } : result;
    });
  }

  async function revisionAdd(rev, version) {
    return withStore(revisionStoreName(version), 'readwrite', async (store) => {
      return requestToPromise(store.add(rev));
    });
  }

  async function revisionGet(id, version) {
    return withStore(revisionStoreName(version), 'readonly', async (store) => {
      const row = await requestToPromise(store.get(Number(id)));
      return row || undefined;
    });
  }

  async function revisionList(filepath, lang, limit = 50, version) {
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
          items.push(cursor.value);
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

  async function revisionClearAll(version) {
    return withStore(revisionStoreName(version), 'readwrite', async (store) => {
      store.clear();
    });
  }

  async function storeCount(storeName) {
    return withStore(storeName, 'readonly', async (store) => {
      return requestToPromise(store.count());
    });
  }

  async function revisionCopyAll(tx, fromStoreName, toStoreName) {
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
  }

  async function migrateFromLocalStorageIfNeeded(supplied) {
    let legacy = supplied;
    if (legacy === undefined) {
      legacy = {};
      if (typeof localStorage !== 'undefined') {
        try { legacy.settings = JSON.parse(localStorage.getItem('settings')); } catch (_) {}
        try { legacy.workspace = JSON.parse(localStorage.getItem('localDescs')); } catch (_) {}
      }
    }
    return transaction([STORE_KV], 'readwrite', async tx => {
      const [migrated, settings, workspace] = await readValues(tx, [KV_MIGRATED, KV_SETTINGS, KV_WORKSPACE_LEGACY]);
      if (migrated) return;
      const kv = tx.objectStore(STORE_KV);
      if (settings === undefined && legacy?.settings) kv.put({ key: KV_SETTINGS, value: legacy.settings });
      if (workspace === undefined && legacy?.workspace) kv.put({ key: KV_WORKSPACE_LEGACY, value: legacy.workspace });
      kv.put({ key: KV_MIGRATED, value: true });
    });
  }

  async function copyLegacyToVersion(version) {
    const v = normalizeGameVersion(version);
    const revisionStore = revisionStoreName(v);
    return transaction([STORE_KV, STORE_REVISIONS_LEGACY, revisionStore], 'readwrite', async tx => {
      const [migrated, legacyWorkspace, legacySource, workspace, source, meta] = await readValues(tx, [
        KV_MIGRATED_SINGLE_VERSION, KV_WORKSPACE_LEGACY, KV_SOURCE_LEGACY, workspaceKey(v), sourceKey(v), workspaceMetaKey(v),
      ]);
      // A second startup, or a user who already imported into this version,
      // must never overwrite a destination that now has data.
      if (migrated || workspace !== undefined || source !== undefined) return snapshotFrom(workspace, source, meta);
      const kv = tx.objectStore(STORE_KV);
      if (legacyWorkspace !== undefined) kv.put({ key: workspaceKey(v), value: legacyWorkspace });
      if (legacySource !== undefined) kv.put({ key: sourceKey(v), value: legacySource });
      await revisionCopyAll(tx, STORE_REVISIONS_LEGACY, revisionStore);
      const nextMeta = { generation: (meta?.generation || 0) + 1, revision: (meta?.revision || 0) + 1 };
      kv.put({ key: workspaceMetaKey(v), value: nextMeta });
      kv.put({ key: KV_MIGRATED_SINGLE_VERSION, value: true });
      return snapshotFrom(legacyWorkspace, legacySource, nextMeta);
    });
  }

  const api = {
    isAvailable,
    open: openDb,
    setStorageStatusHandler: handler => { statusHandler = handler; },
    configureOwnership,
    acquireOwnership,
    renewOwnership,
    releaseOwnership,
    normalizeGameVersion,
    setGameVersion,
    migrateFromLocalStorageIfNeeded,
    getSettings: () => kvGet(KV_SETTINGS),
    setSettings: (settings) => kvSet(KV_SETTINGS, settings),
    getHybridState: () => kvGet('hybrid_v1'),
    updateHybridState,
    getWorkspace: (version) => kvGet(workspaceKey(version)),
    getWorkspaceSnapshot,
    replaceWorkspace,
    setWorkspace: (workspace, version) => kvSet(workspaceKey(version), workspace),
    saveWorkspaceWithRevisions,
    saveSourceWorkspaceWithRevisions,
    getCollaborationState: () => kvGet('collaboration_v1'),
    updateCollaborationState,
    getSource: (version) => kvGet(sourceKey(version)),
    setSource: (source, version) => kvSet(sourceKey(version), source),
    clearWorkspace: (version) => kvDel(workspaceKey(version)),
    clearSource: (version) => kvDel(sourceKey(version)),
    clearRevisions: (version) => revisionClearAll(version),
    addRevision: revisionAdd,
    listRevisions: revisionList,
    getRevision: revisionGet,
    getLatestRevision: revisionLatest,
    getLegacyWorkspace: () => kvGet(KV_WORKSPACE_LEGACY),
    getLegacySource: () => kvGet(KV_SOURCE_LEGACY),
    getLegacyRevisionCount: () => storeCount(STORE_REVISIONS_LEGACY),
    hasMigratedFromSingleVersion: () => kvGet(KV_MIGRATED_SINGLE_VERSION),
    setMigratedFromSingleVersion: (value) => kvSet(KV_MIGRATED_SINGLE_VERSION, !!value),
    copyLegacyToVersion,
  };
  globalThis.OfflineStore = api;
  // Retain compatibility with isolated browser fixtures where window is a
  // separate object; real windows and workers use the globalThis export.
  if (typeof window === 'object') window.OfflineStore = api;
})();
