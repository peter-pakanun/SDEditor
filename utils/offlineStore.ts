const DB_NAME = 'sdeditor';
  const DB_VERSION = 2;

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
    const store = tx.objectStore(storeName);
    const out = await fn(store, tx);
    await txDone(tx);
    return out;
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
export const OfflineStore = {
    isAvailable,
    normalizeGameVersion,
    setGameVersion,
    migrateFromLocalStorageIfNeeded,
    getSettings: () => kvGet(KV_SETTINGS),
    setSettings: (settings) => kvSet(KV_SETTINGS, settings),
    getWorkspace: (version) => kvGet(workspaceKey(version)),
    setWorkspace: (workspace, version) => kvSet(workspaceKey(version), workspace),
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

