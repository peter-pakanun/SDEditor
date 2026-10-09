(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.DictionaryWorkerUI = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  const now = () => root.performance?.now?.() ?? Date.now();
  const yieldTask = () => new Promise(resolve => root.setTimeout(resolve, 0));
  const raw = value => {
    const vue = root.Vue || (typeof Vue !== 'undefined' ? Vue : null);
    return vue?.toRaw ? vue.toRaw(value) : value;
  };
  const abort = message => root.DictionaryWorkerClient.aborted(message);
  const selectedScope = app => !!app.lang && (app.gameVersion === 'poe1' || app.gameVersion === 'poe2');

  function stateFor(app) {
    return app._dictionaryWorkerState ||= { scopeKey: null, rawIdentity: null,
      scopeEpoch: 0, serial: 0, generation: 0, submittedSerial: 0,
      replaceSerial: 0, membershipSerial: 0, unknownSerial: 0,
      explicitSerial: 0, observedSerial: 0,
      dirtyIds: new Map(), timer: null, maxTimer: null, capturePromise: null,
      captureError: null, disposed: false };
  }

  function clearScheduled(state) {
    root.clearTimeout(state.timer);
    root.clearTimeout(state.maxTimer);
    state.timer = state.maxTimer = null;
  }

  function currentDictionary(app) {
    const dictionary = raw(app.dictionary);
    return Array.isArray(dictionary) ? dictionary : [];
  }

  function reportPreparationError(app, error) {
    app.dictionaryWorkerError = error.message;
    const message = 'Could not prepare Dictionary matches: ' + error.message;
    // An existing same-scope assistance pack remains usable after background
    // replacement failure. Keep editing available and show the actionable
    // warning without turning it into an editor-loading failure.
    if (!app.getEditorDictionaryMatchPack?.()) {
      app._dictionaryWorkerLoadError = message;
      app.editorLoadError = message;
    } else if (app._dictionaryWorkerLoadError && app.editorLoadError === app._dictionaryWorkerLoadError) {
      app.editorLoadError = '';
      app._dictionaryWorkerLoadError = null;
    }
    if (!app.cloudStorageError || app.cloudStorageError === app._dictionaryWorkerStorageError) {
      app._dictionaryWorkerStorageError = message;
      app.cloudStorageError = app._dictionaryWorkerStorageError;
    }
  }

  function clearPreparationError(app) {
    app.dictionaryWorkerError = '';
    if (app.editorLoadError === app._dictionaryWorkerLoadError) app.editorLoadError = '';
    if (app.cloudStorageError === app._dictionaryWorkerStorageError) app.cloudStorageError = '';
    app._dictionaryWorkerLoadError = null;
    app._dictionaryWorkerStorageError = null;
  }

  function startCapture(app) {
    const state = stateFor(app);
    clearScheduled(state);
    if (state.disposed || state.capturePromise) return state.capturePromise;
    if (!selectedScope(app)) return Promise.resolve();
    if (state.submittedSerial && state.serial <= state.submittedSerial) return Promise.resolve();
    const epoch = state.scopeEpoch;
    state.capturePromise = app.captureDictionarySnapshot().then(snapshot => {
      if (!snapshot || state.disposed || epoch !== state.scopeEpoch) return;
      state.submittedSerial = snapshot.serial;
      // Explicit markers covered by a sealed snapshot cannot justify skipping
      // a later watcher callback for a new, unjournaled mutation.
      state.observedSerial = Math.max(state.observedSerial, snapshot.serial);
      state.captureError = null;
      app.ensureDictionaryWorker().submitSnapshot(snapshot);
    }).catch(error => {
      if (error?.name !== 'AbortError' && epoch === state.scopeEpoch) {
        state.captureError = error;
        reportPreparationError(app, error);
      }
    }).finally(() => {
      state.capturePromise = null;
      if (!state.disposed && !state.captureError && state.serial > state.submittedSerial) app.scheduleDictionarySnapshot({ immediate: !app._dictionaryWorkerClient?.readyGeneration });
    });
    return state.capturePromise;
  }

  const mixin = {
    data() { return { dictionaryWorkerError: '', dictionarySnapshotGeneration: 0,
      dictionaryPreparationRetrying: false }; },
    computed: {
      dictionaryWorkerScopeIdentity() { return this.dictionaryWorkerScopeKey(); },
      dictionaryPreparationOwnsStorageError() {
        return !!this.dictionaryWorkerError && this.cloudStorageError === this._dictionaryWorkerStorageError;
      },
    },
    watch: {
      dictionaryWorkerScopeIdentity() {
        if (this._dictionaryWorkerClient) this.ensureDictionaryWorker();
      },
    },
    beforeUnmount() {
      const state = stateFor(this);
      state.disposed = true;
      clearScheduled(state);
      this._dictionaryWorkerClient?.dispose();
      this._dictionaryWorkerClient = null;
    },
    methods: {
      dictionaryWorkerScopeKey() {
        const user = this.cloudUser || {};
        return JSON.stringify([this.cloudProfileId || user.id || 'guest',
          this.lang || '', this.gameVersion || '', !!this.cloudSignedIn,
          user.id || '', user.role || '', !!user.isAdmin,
          user.language || '', user.assignmentVersion ?? '']);
      },
      ensureDictionaryWorker() {
        const state = stateFor(this);
        if (state.disposed) throw abort();
        if (!this._dictionaryWorkerClient) {
          this._dictionaryWorkerClient = root.DictionaryWorkerClient.create({
            onReady: message => {
              if (message.scopeEpoch === state.scopeEpoch) this.dictionarySnapshotPublished(message.generation);
            },
            onError: error => {
              reportPreparationError(this, error);
            },
          });
        }
        const scopeKey = this.dictionaryWorkerScopeKey();
        const dictionary = currentDictionary(this);
        if (state.scopeKey !== scopeKey) {
          clearScheduled(state);
          state.scopeKey = scopeKey;
          state.scopeEpoch = this._dictionaryWorkerClient.setScope(scopeKey);
          state.rawIdentity = dictionary;
          state.serial++;
          state.replaceSerial++;
          state.membershipSerial = state.unknownSerial = state.serial;
          state.explicitSerial = state.serial;
          state.observedSerial = state.serial;
          state.dirtyIds.clear();
          state.submittedSerial = 0;
          state.captureError = null;
          this.dictionarySnapshotGeneration = 0;
          clearPreparationError(this);
          this.resetDictionaryAssistanceScope?.();
          this.scheduleDictionarySnapshot({ immediate: true });
        } else if (state.rawIdentity !== dictionary) {
          state.rawIdentity = dictionary;
          state.serial++;
          state.replaceSerial++;
          state.membershipSerial = state.unknownSerial = state.serial;
          state.explicitSerial = state.serial;
          state.dirtyIds.clear();
          this.scheduleDictionarySnapshot();
        }
        return this._dictionaryWorkerClient;
      },
      markDictionarySnapshotDirty(id, options = {}) {
        const state = stateFor(this);
        if (state.disposed) return;
        this.ensureDictionaryWorker();
        state.captureError = null;
        // Repository field and mutation actions journal their IDs before the
        // shallow replacement observer flushes. Consume explicit batches only;
        // default unknown invalidation always requests a conservative recopy.
        if (id == null && options.observed && !options.replace && !options.membership
          && state.explicitSerial > state.observedSerial) {
          state.observedSerial = state.explicitSerial;
          this.scheduleDictionarySnapshot();
          return;
        }
        state.serial++;
        if (id != null && String(id)) {
          state.dirtyIds.set(String(id), state.serial);
          state.explicitSerial = state.serial;
        }
        else state.unknownSerial = state.serial;
        if (options.membership) {
          state.membershipSerial = state.serial;
          state.explicitSerial = state.serial;
        }
        if (options.replace) {
          state.replaceSerial++;
          state.membershipSerial = state.unknownSerial = state.serial;
          state.explicitSerial = state.serial;
          state.dirtyIds.clear();
        }
        if (options.observed) state.observedSerial = state.explicitSerial;
        this.dictionaryMutationObserved?.(id, options);
        this.scheduleDictionarySnapshot();
      },
      scheduleDictionarySnapshot({ immediate = false } = {}) {
        const state = stateFor(this);
        if (state.disposed) return;
        if (!selectedScope(this)) { clearScheduled(state); return; }
        if (immediate) {
          clearScheduled(state);
          state.timer = root.setTimeout(() => startCapture(this), 0);
          return;
        }
        root.clearTimeout(state.timer);
        state.timer = root.setTimeout(() => startCapture(this), 150);
        if (!state.maxTimer) state.maxTimer = root.setTimeout(() => startCapture(this), 500);
      },
      async captureDictionarySnapshot() {
        const state = stateFor(this);
        const client = this.ensureDictionaryWorker();
        const epoch = client.scopeEpoch;
        const scopeKey = state.scopeKey;
        if (!selectedScope(this)) throw abort('Choose a game and language before preparing Dictionary matches.');
        const check = () => {
          if (state.disposed || epoch !== state.scopeEpoch || scopeKey !== this.dictionaryWorkerScopeKey()) throw abort();
        };
        // Language selection fences assistance immediately, while its local
        // profile write may still be loading the newly selected dictionary.
        // This promise covers local selection only, before remote sync starts.
        let languageSwitch;
        do {
          languageSwitch = this._cloudLanguageSwitch;
          if (languageSwitch) await languageSwitch;
          check();
        } while (languageSwitch !== this._cloudLanguageSwitch);
        const started = now();
        let batchStarted = now();
        const yieldIfNeeded = async () => {
          check();
          if (now() - batchStarted < 4) return;
          await yieldTask();
          check();
          batchStarted = now();
        };
        const copyEntry = async value => {
          const entry = raw(value);
          if (!entry || typeof entry !== 'object') return null;
          const copied = { _id: entry._id, find: String(entry.find ?? ''),
            replace: String(entry.replace ?? ''), tlnote: String(entry.tlnote ?? ''), alts: [] };
          if (Object.hasOwn(entry, 'gameScope')) copied.gameScope = entry.gameScope;
          const alts = raw(entry.alts);
          if (Array.isArray(alts)) for (let i = 0; i < alts.length; i++) {
            const alt = raw(alts[i]);
            if (alt && typeof alt === 'object') copied.alts.push(Object.freeze({ _id: alt._id,
              find: String(alt.find ?? ''), replace: alt.replace == null ? copied.replace : String(alt.replace) }));
            await yieldIfNeeded();
          }
          Object.freeze(copied.alts);
          return Object.freeze(copied);
        };

        // A whole replacement restarts capture. Ordinary row edits replay from
        // the ID journal, so continuous typing cannot restart a 20k-row copy.
        for (;;) {
          check();
          const source = currentDictionary(this);
          const replacement = state.replaceSerial;
          let membership = state.membershipSerial;
          let unknown = state.unknownSerial;
          let slots = [];
          const copies = new Map(), copiedSerials = new Map(), liveRows = new Map();
          const scanMembership = async recopyAll => {
            const nextSlots = [];
            liveRows.clear();
            for (let i = 0; i < source.length; i++) {
              const row = raw(source[i]);
              if (!row || typeof row !== 'object') continue;
              const key = row._id ? String(row._id) : '@' + i;
              nextSlots.push(key);
              liveRows.set(key, row);
              if (recopyAll || !copies.has(key)) {
                const journal = state.dirtyIds.get(key) || 0;
                copies.set(key, await copyEntry(row));
                copiedSerials.set(key, journal);
              }
              await yieldIfNeeded();
            }
            slots = nextSlots;
          };
          await scanMembership(true);
          for (;;) {
            check();
            if (source !== currentDictionary(this) || replacement !== state.replaceSerial) break;
            if (membership !== state.membershipSerial || unknown !== state.unknownSerial) {
              const recopyAll = unknown !== state.unknownSerial;
              membership = state.membershipSerial;
              unknown = state.unknownSerial;
              await scanMembership(recopyAll);
              continue;
            }
            let replayed = false;
            for (const [id, serial] of state.dirtyIds) {
              if (serial <= (copiedSerials.get(id) || 0)) continue;
              const row = liveRows.get(id);
              if (row) copies.set(id, await copyEntry(row));
              copiedSerials.set(id, serial);
              replayed = true;
              await yieldIfNeeded();
            }
            if (replayed) continue;
            // No await between this revision seal and producing the DTO.
            const serial = state.serial;
            const entries = [];
            for (const id of slots) {
              const row = copies.get(id);
              if (row) entries.push(row);
            }
            const generation = ++state.generation;
            this._dictionarySnapshotCaptureMs = now() - started;
            return Object.freeze({ scopeEpoch: epoch, generation, game: this.gameVersion,
              entries: Object.freeze(entries), serial });
          }
        }
      },
      async ensureDictionarySnapshot() {
        const client = this.ensureDictionaryWorker();
        if (!selectedScope(this)) throw abort('Choose a game and language before preparing Dictionary matches.');
        const epoch = client.scopeEpoch;
        const state = stateFor(this);
        if (!client.readyGeneration && !state.submittedSerial) {
          await startCapture(this);
          if (client.scopeEpoch !== epoch) throw abort();
          if (state.captureError) throw state.captureError;
        }
        return client.waitReady();
      },
      async retryDictionaryPreparation() {
        if (this.dictionaryPreparationRetrying) return false;
        this.dictionaryPreparationRetrying = true;
        try {
          const client = this.ensureDictionaryWorker();
          if (!selectedScope(this)) throw abort();
          const state = stateFor(this), epoch = client.scopeEpoch;
          state.captureError = null;
          const requestedSerial = ++state.serial;
          state.unknownSerial = requestedSerial;
          // Retry submits a fresh cooperative snapshot in this same epoch.
          // Existing warnings and rendered assistance stay until publication.
          do {
            await startCapture(this);
            if (state.disposed || client.scopeEpoch !== epoch) throw abort();
            if (state.captureError) throw state.captureError;
          } while (state.submittedSerial < requestedSerial);
          await client.waitReady({ generation: state.generation });
          return true;
        } catch (error) {
          if (error?.name !== 'AbortError') reportPreparationError(this, error);
          return false;
        } finally { this.dictionaryPreparationRetrying = false; }
      },
      dictionarySnapshotPublished(generation) {
        if (generation <= this.dictionarySnapshotGeneration) return;
        this.dictionarySnapshotGeneration = generation;
        clearPreparationError(this);
        this.scheduleEditorHLterRefresh?.({ dictionaryGeneration: generation });
      },
    },
  };

  return { mixin };
});
