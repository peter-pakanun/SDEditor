(() => {
  const DB_NAME = 'sdeditor';
  const DB_VERSION = 1;

  const STORE_KV = 'kv';
  const STORE_REVISIONS = 'revisions';

  const KV_SETTINGS = 'settings';
  const KV_WORKSPACE = 'workspace';
  const KV_SOURCE = 'source';
  const KV_MIGRATED = 'migratedFromLocalStorage';

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

        if (!db.objectStoreNames.contains(STORE_REVISIONS)) {
          const store = db.createObjectStore(STORE_REVISIONS, { keyPath: 'id', autoIncrement: true });
          store.createIndex('by_file_lang_time', ['filepath', 'lang', 'savedAt']);
          store.createIndex('by_file_time', ['filepath', 'savedAt']);
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

  async function kvGet(key) {
    const db = await openDb();
    const tx = db.transaction([STORE_KV], 'readonly');
    const store = tx.objectStore(STORE_KV);
    const row = await requestToPromise(store.get(key));
    await txDone(tx);
    return row ? row.value : undefined;
  }

  async function kvSet(key, value) {
    const db = await openDb();
    const tx = db.transaction([STORE_KV], 'readwrite');
    const store = tx.objectStore(STORE_KV);
    store.put({ key, value });
    await txDone(tx);
  }

  async function kvDel(key) {
    const db = await openDb();
    const tx = db.transaction([STORE_KV], 'readwrite');
    const store = tx.objectStore(STORE_KV);
    store.delete(key);
    await txDone(tx);
  }

  async function revisionAdd(rev) {
    const db = await openDb();
    const tx = db.transaction([STORE_REVISIONS], 'readwrite');
    const store = tx.objectStore(STORE_REVISIONS);
    const id = await requestToPromise(store.add(rev));
    await txDone(tx);
    return id;
  }

  async function revisionGet(id) {
    const db = await openDb();
    const tx = db.transaction([STORE_REVISIONS], 'readonly');
    const store = tx.objectStore(STORE_REVISIONS);
    const row = await requestToPromise(store.get(Number(id)));
    await txDone(tx);
    return row || undefined;
  }

  async function revisionList(filepath, lang, limit = 50) {
    const db = await openDb();
    const tx = db.transaction([STORE_REVISIONS], 'readonly');
    const store = tx.objectStore(STORE_REVISIONS);
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

    await txDone(tx);
    return items;
  }

  async function revisionLatest(filepath, lang) {
    const items = await revisionList(filepath, lang, 1);
    return items[0] || undefined;
  }

  async function revisionClearAll() {
    const db = await openDb();
    const tx = db.transaction([STORE_REVISIONS], 'readwrite');
    const store = tx.objectStore(STORE_REVISIONS);
    store.clear();
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
    if (workspace) await kvSet(KV_WORKSPACE, workspace);

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

  window.OfflineStore = {
    isAvailable,
    migrateFromLocalStorageIfNeeded,
    getSettings: () => kvGet(KV_SETTINGS),
    setSettings: (settings) => kvSet(KV_SETTINGS, settings),
    getWorkspace: () => kvGet(KV_WORKSPACE),
    setWorkspace: (workspace) => kvSet(KV_WORKSPACE, workspace),
    getSource: () => kvGet(KV_SOURCE),
    setSource: (source) => kvSet(KV_SOURCE, source),
    clearWorkspace: () => kvDel(KV_WORKSPACE),
    clearSource: () => kvDel(KV_SOURCE),
    clearRevisions: () => revisionClearAll(),
    addRevision: revisionAdd,
    listRevisions: revisionList,
    getRevision: revisionGet,
    getLatestRevision: revisionLatest,
  };
})();
