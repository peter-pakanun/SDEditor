(() => {
  const DB_NAME = 'sdeditor';
  // The withdrawn multi-tab release opened v3. Advance without changing stores:
  // downgrading would reject existing data, and an upgrade closes its workers.
  const DB_VERSION = 4;

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

  let currentGameVersion = 'poe1';

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
        reject(new Error('Close every other SDEditor tab, then reload this tab to finish the rollback. Your saved translations have been kept.'));
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
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
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
      store.put({ key, value });
    });
  }

  async function kvDel(key) {
    return withStore(STORE_KV, 'readwrite', async (store) => {
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
    const db = await openDb();
    const tx = db.transaction([STORE_KV, revisionsStore], 'readwrite');
    const done = txDone(tx);
    try {
      tx.objectStore(STORE_KV).put({ key: workspaceKey(gameVersion), value: workspace });
      const store = tx.objectStore(revisionsStore);
      for (const revision of revisions) store.add(revision);
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
    const revisionsStore = revisionStoreName(gameVersion);
    const db = await openDb();
    const tx = db.transaction([STORE_KV, revisionsStore], 'readwrite');
    const done = txDone(tx);
    try {
      const kv = tx.objectStore(STORE_KV);
      kv.put({ key: sourceKey(gameVersion), value: source });
      kv.put({ key: workspaceKey(gameVersion), value: workspace });
      if (baseline) {
        if (baseline.archive?.baselineId !== workspace.sourceHash) throw new Error('Imported baseline and workspace identity differ');
        kv.put({ key: importedBaselineKey(baseline.archive.baselineId, gameVersion), value: baseline });
      }
      for (const revision of revisions) tx.objectStore(revisionsStore).add(revision);
    } catch (error) {
      try { tx.abort(); } catch (_) {}
      await done.catch(() => {});
      throw error;
    }
    await done;
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
        trackedForExport: !!file.trackedForExport, revision: Number(file.revision) || 0 };
    });
    const scope = [batch.game, batch.language, batch.sourceHash || '', String(batch.accountId || '')];
    const signature = JSON.stringify({ scope, files, descriptions: batch.descriptions || [], statuses: batch.statuses || {}, revisions: batch.revisions || [],
      collaboration: batch.collaboration || null });
    const receiptKey = 'translation_save_receipts_' + batch.game;
    const db = await openDb();
    const revisionsStore = revisionStoreName(batch.game);
    const tx = db.transaction([STORE_KV, revisionsStore], 'readwrite');
    const done = txDone(tx);
    const kv = tx.objectStore(STORE_KV);
    let failure, result;
    const values = {};
    const keys = [workspaceKey(batch.game), receiptKey, ...(batch.collaboration ? ['collaboration_v1'] : [])];
    let remaining = keys.length;
    const stale = message => Object.assign(new Error(message), { stale: true, code: 'SAVE_SCOPE_CHANGED' });
    const fail = error => { failure = error; try { tx.abort(); } catch (_) {} };
    const apply = () => {
      try {
        const receipts = values[receiptKey] || [];
        const receipt = receipts.find(item => item.jobId === batch.jobId);
        if (receipt) {
          if (receipt.signature !== signature) throw new Error('A local save identifier was reused with different content.');
          result = { ...receipt.result, duplicate: true };
          if (batch.collaboration) {
            const workspace = values[workspaceKey(batch.game)];
            const room = values.collaboration_v1?.rooms?.[batch.collaboration.key];
            const current = workspace && room && (!workspace.sourceHash || workspace.sourceHash === batch.sourceHash)
              && (!workspace?.collaborationAccountId || String(workspace.collaborationAccountId) === String(batch.accountId))
              && JSON.stringify([String(room.identity?.accountId), room.identity?.game, room.identity?.sourceHash, room.identity?.language]) === batch.collaboration.key;
            // Network synchronization might already have accepted this operation
            // before the worker reply was lost. Never resurrect an old outbox.
            result.operation = current ? room.outbox?.find(operation => operation.id === batch.jobId) || null : null;
            result.pending = current ? room.outbox?.length || 0 : 0;
            if (current) {
              result.files = files.map(file => room.local?.[file.filepath] || file);
              result.status = result.operation ? result.operation.status === 'conflict' ? 'conflict' : 'pending' : 'synced';
            }
          }
          return;
        }
        const workspace = values[workspaceKey(batch.game)];
        if (!workspace || !Array.isArray(workspace.descs)) {
          throw new Error('The local workspace is unavailable. Keep this tab open and import the source archive before retrying the save.');
        }
        if (workspace.sourceHash && workspace.sourceHash !== (batch.sourceHash || '')) {
          throw stale('The source archive changed before this translation could be saved.');
        }
        if (batch.accountId && workspace.collaborationAccountId
          && String(workspace.collaborationAccountId) !== String(batch.accountId)) {
          throw stale('The signed-in account changed before this translation could be saved.');
        }
        workspace.descs ||= []; workspace.status ||= {};
        const descriptions = new Map(workspace.descs.map(desc => [desc.filepath, desc]));
        const templates = new Map((batch.descriptions || []).map(desc => [desc.filepath, desc]));
        let room, state, operation;
        const collaboration = batch.collaboration;
        if (collaboration) {
          const identity = collaboration.identity;
          if (!identity || identity.game !== batch.game || identity.language !== batch.language
            || identity.sourceHash !== batch.sourceHash || String(identity.accountId) !== String(batch.accountId)
            || collaboration.key !== JSON.stringify([String(identity.accountId), identity.game, identity.sourceHash, identity.language])) {
            throw stale('This translation save no longer matches its shared workspace.');
          }
          state = values.collaboration_v1;
          room = state?.rooms?.[collaboration.key];
          if (!room || JSON.stringify([String(room.identity?.accountId), room.identity?.game, room.identity?.sourceHash, room.identity?.language]) !== collaboration.key) {
            throw stale('The shared workspace changed before this translation could be saved.');
          }
          const originals = new Map((room.manifest?.files || []).map(file => [file.filepath, file]));
          for (const file of files) {
            const original = originals.get(file.filepath);
            const entryCount = original?.entryCount ?? original?.english?.length;
            if (!original || !Number.isSafeInteger(entryCount) || file.translations.length > entryCount) {
              throw new Error('Saved file does not match the source: ' + file.filepath);
            }
            while (file.translations.length < entryCount) file.translations.push('');
          }
          if (collaboration.restore && (files.length !== 1 || !collaboration.restore.eventId
            || !['before', 'after'].includes(collaboration.restore.version))) throw new Error('Invalid shared history restore.');
          room.outbox ||= []; room.local ||= {};
          const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
          operation = { id: batch.jobId, origin: collaboration.origin || 'save', status: 'pending',
            ...(collaboration.restore ? { restore: { ...collaboration.restore, translations: [...files[0].translations] } } : {}),
            files: files.map(yours => ({ base: clone(Object.hasOwn(collaboration.bases || {}, yours.filepath)
              ? collaboration.bases[yours.filepath] : room.local[yours.filepath] || null), yours: clone(yours) })) };
          room.outbox.push(operation);
          for (const file of files) {
            room.local[file.filepath] = clone(file);
            if (room.mode === 'sparse' && !file.needsReview) {
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
          if (count != null && file.translations.length > count) throw new Error('Translation count exceeds source entry count: ' + file.filepath);
          desc.translations[batch.language] = [...file.translations];
          desc.hasChanges = file.trackedForExport; desc.needsReview = file.needsReview;
          desc.isMissing = (count != null && file.translations.length < count) || file.translations.some(line => !line.trim());
          workspace.status[file.filepath] = { ...(workspace.status[file.filepath] || {}), ...(batch.statuses?.[file.filepath] || {}),
            needsReview: file.needsReview };
        }
        if (batch.sourceHash) workspace.sourceHash = batch.sourceHash;
        if (collaboration) workspace.collaborationAccountId = String(batch.accountId);
        kv.put({ key: workspaceKey(batch.game), value: workspace });
        if (state) kv.put({ key: 'collaboration_v1', value: state });
        for (const revision of batch.revisions || []) tx.objectStore(revisionsStore).add({ ...revision,
          ...(batch.sourceHash ? { sourceHash: batch.sourceHash } : {}),
          ...(collaboration ? { collaborationAccountId: String(batch.accountId) } : {}) });
        result = { jobId: batch.jobId, status: collaboration ? 'pending' : 'local', files,
          ...(collaboration ? { mutationId: batch.jobId, pending: room.outbox.length, operation } : {}) };
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
        kv.put({ key: 'collaboration_v1', value: result });
        for (const revision of revisions) tx.objectStore(revisionsStore).add(revision);
        if (Object.hasOwn(options, 'workspace')) kv.put({ key: workspaceKey(gameVersion), value: options.workspace });
        if (options.projectWorkspace) {
          const workspaceRead = kv.get(workspaceKey(gameVersion));
          workspaceRead.onsuccess = () => {
            try {
              const projected = options.projectWorkspace(workspaceRead.result?.value, result);
              if (projected && typeof projected.then === 'function') throw new Error('Workspace projection must be synchronous');
              if (projected !== undefined) kv.put({ key: workspaceKey(gameVersion), value: projected });
            } catch (error) { failure = error; tx.abort(); }
          };
        }
      } catch (error) { failure = error; tx.abort(); }
    };
    try { await done; } catch (error) { throw failure || error; }
    return result;
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
    migrateFromLocalStorageIfNeeded,
    getSettings: () => kvGet(KV_SETTINGS),
    setSettings: (settings) => kvSet(KV_SETTINGS, settings),
    getHybridState: () => kvGet('hybrid_v1'),
    updateHybridState,
    getWorkspace: (version) => kvGet(workspaceKey(version)),
    setWorkspace: (workspace, version) => kvSet(workspaceKey(version), workspace),
    saveWorkspaceWithRevisions,
    saveSourceWorkspaceWithRevisions,
    getImportedBaseline: (id, version) => kvGet(importedBaselineKey(id, version)),
    saveTranslationBatch,
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
    copyLegacyToVersion: async (version) => {
      const v = normalizeGameVersion(version);
      const legacyWorkspace = await kvGet(KV_WORKSPACE_LEGACY);
      const legacySource = await kvGet(KV_SOURCE_LEGACY);
      if (typeof legacyWorkspace !== 'undefined') await kvSet(workspaceKey(v), legacyWorkspace);
      if (typeof legacySource !== 'undefined') await kvSet(sourceKey(v), legacySource);
      await revisionCopyAll(STORE_REVISIONS_LEGACY, revisionStoreName(v));
      await kvSet(KV_MIGRATED_SINGLE_VERSION, true);
      return { workspace: legacyWorkspace, source: legacySource };
    },
  };
})();
