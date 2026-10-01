/* Browser RPC facades. Only the coordinator is allowed to own IndexedDB writes. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.InstanceClient = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const PROTOCOL = 1;
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const uuid = () => root.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2);
  const errorFrom = value => Object.assign(new Error(value?.message || 'Instance coordinator unavailable.'), value || {});
  const sameAccount = (a, b) => !!a && !!b && a.profile === b.profile && a.language === b.language && a.assignmentVersion === b.assignmentVersion;
  const SAFE_CLOUD_REPLAY = new Set(['initialize', 'saveLocal', 'selectLanguage', 'importLocal', 'refreshSession', 'sync',
    'recoveryExport', 'getDictionaryHistory', 'getDictionaryHistoryEvent', 'listUsers']);
  class CollaborationFacade {
    constructor(bridge, options) {
      this.bridge = bridge; this.options = options || {}; this.id = uuid(); this.active = true;
      this.connected = false;
      this.cached = { files: [], conflicts: [], peers: [], localPeers: [], pending: 0, connected: false };
      bridge.clients.set(this.id, this);
    }
    apply(snapshot, status) {
      if (!this.active) return;
      if (Number.isFinite(snapshot.generation) && Number.isFinite(this.cached.generation)
        && (snapshot.generation < this.cached.generation || (snapshot.generation === this.cached.generation
          && Number.isFinite(snapshot.revision) && Number.isFinite(this.cached.revision) && snapshot.revision < this.cached.revision))) return;
      this.received = (this.received || 0) + 1;
      const previous = JSON.stringify(this.cached.files || []);
      this.cached = clone(snapshot); this.options.onChange?.(this.snapshot());
      if (status) this.options.onStatus?.(status);
      if (previous !== JSON.stringify(snapshot.files || [])) this.options.onRemote?.(clone(snapshot.files || []));
    }
    snapshot() { return clone(this.cached); }
    fileBase(filepath) { return clone(this.cached.files?.find(file => file.filepath === filepath) || null); }
    editingPeers(filepath) { return [...(this.cached.peers || []), ...(this.cached.localPeers || [])].filter(peer => peer.sessionId !== this.cached.sessionId && peer.editing === filepath); }
    isEditing(filepath) { return this.editingPeers(filepath).length > 0; }
    async call(method, args = [], extra) { return this.bridge.call({ op: 'collaboration', clientId: this.id, method, args,
      context: clone(this.scopeContext || this.bridge.cloudContext) }, extra); }
    async connect(args) {
      this.connectArgs = clone(args);
      this.scopeContext = clone(this.bridge.cloudContext);
      const before = this.received || 0;
      const state = await this.call('connect', [args]);
      if (!this.active) { this.call('disconnect').catch(() => {}); return state; }
      this.connected = true; if ((this.received || 0) === before) this.apply(state);
      if (this.selected !== undefined) this.quiet('select', [this.selected]);
      if (this.away !== undefined) this.quiet('setAway', [this.away]);
      return state;
    }
    save(args) { return this.call('save', [args]); }
    resolve(id, value, options = {}) { return this.call('resolve', [id, value, options]); }
    history(filepath, options = {}) { return this.call('history', [filepath, options]); }
    historyEntry(id) { return this.call('historyEntry', [id]); }
    sync() { return this.call('sync'); }
    retry() { return this.sync(); }
    claim(filepath, options = {}) { return this.call('claim', [filepath, options]); }
    quiet(method, args) {
      if (!this.active || !this.connected || this.bridge.paused) return;
      this.call(method, args).catch(error => {
        if (!this.active || error.stale || ['SCOPE_CHANGED', 'COORDINATOR_PAUSED'].includes(error.code)) return;
        this.options.onStatus?.({ message: error.message, error: true });
      });
    }
    select(filepath) { this.selected = filepath; this.quiet('select', [filepath]); }
    setAway(value) { this.away = !!value; this.quiet('setAway', [this.away]); }
    leaveEdit() { this.quiet('leaveEdit', []); }
    disconnect() {
      if (!this.active) return;
      this.active = false; this.bridge.clients.delete(this.id);
      this.call('disconnect').catch(() => {});
    }
    destroy() { this.disconnect(); }
  }
  class Bridge {
    constructor(options) {
      this.options = options; this.apiBase = options.apiBase; this.tabId = uuid(); this.pending = new Map(); this.clients = new Map();
      this.sequence = 0; this.requestSequence = 0; this.paused = true; this.closed = false; this.readyOnce = false;
      this.mode = null; this.cloudSnapshot = null; this.cloudContext = null; this.workspaceListeners = new Set();
      this.cloudCallbacks = {}; this.rawStore = options.store || root.OfflineStore;
      this.cloud = this.createCloudFacade(); this.store = this.createStoreFacade();
      this.unload = event => {
        if (event?.persisted) this.lost(new Error('This editor tab was suspended by the browser.'));
        else this.destroy();
      };
      this.visibility = () => {
        if (this.closed || root.document?.hidden || !this.readyOnce) return;
        if (this.paused) { clearTimeout(this.reconnectTimer); this.reconnect(); }
        else this.call({ op: 'ping' }, { timeout: 15000 }).catch(error => this.lost(error));
      };
      root.addEventListener?.('pagehide', this.unload);
      root.addEventListener?.('pageshow', this.visibility);
      root.document?.addEventListener?.('visibilitychange', this.visibility);
    }
    message(event) {
      const message = event.data;
      if (!message || message.protocol !== PROTOCOL) return;
      if (message.type === 'reply') {
        const entry = this.pending.get(message.id); if (!entry) return;
        this.pending.delete(message.id); clearTimeout(entry.timer);
        if (message.error) {
          const error = errorFrom(message.error); entry.reject(error);
          if (['NOT_CONNECTED', 'COORDINATOR_CLOSED', 'OWNERSHIP_LOST'].includes(error.code)) this.lost(error);
        } else entry.resolve(message.result);
        return;
      }
      if (message.type !== 'event' || message.sequence <= this.sequence) return;
      this.sequence = message.sequence;
      const data = message.event;
      if (data.type === 'cloud') {
        this.cloudSnapshot = clone(data.snapshot); this.cloudContext = clone(data.context);
        this.cloudCallbacks.onChange?.(clone(data.snapshot));
      } else if (data.type === 'cloudStatus') {
        this.cloudStatus = data.status; this.cloudCallbacks.onStatus?.(data.status);
      } else if (data.type === 'collaboration') this.clients.get(data.clientId)?.apply(data.snapshot, data.status);
      else if (data.type === 'editingConflict') this.clients.get(data.clientId)?.options.onEditingConflict?.(data);
      else if (data.type === 'workspace') for (const listener of this.workspaceListeners) listener(data);
      else if (data.type === 'disconnected') { this.lost(errorFrom(data.error)); return; }
      this.options.onState?.(data);
    }
    post(entry) {
      try { this.port.postMessage(entry.message); }
      catch (error) { this.lost(error); }
    }
    call(message, { allowPaused = false, timeout = 120000 } = {}) {
      if (this.closed) return Promise.reject(errorFrom({ code: 'COORDINATOR_CLOSED', message: 'This SDEditor instance is closed.' }));
      if (this.paused && !allowPaused) return Promise.reject(errorFrom({ code: 'COORDINATOR_PAUSED', message: 'Browser coordination is reconnecting. Your draft is still open; saving will resume when the connection returns.' }));
      const id = this.tabId + '-' + (++this.requestSequence);
      return new Promise((resolve, reject) => {
        const entry = { message: { protocol: PROTOCOL, ...clone(message), id }, resolve, reject };
        entry.timer = setTimeout(() => {
          if (!this.pending.delete(id)) return;
          reject(errorFrom({ code: 'COMMAND_TIMEOUT', message: 'The coordinator did not confirm this operation. Keep your draft open and check the saved state before trying again.' }));
        }, timeout);
        this.pending.set(id, entry); this.post(entry);
      });
    }
    async handshake(port, worker) {
      this.port = port; this.worker = worker; this.sequence = 0;
      port.onmessage = event => this.message(event);
      port.onmessageerror = () => this.lost(new Error('The instance coordinator connection failed.'));
      if (worker) worker.onerror = event => { event.preventDefault?.(); this.lost(new Error('The shared browser worker stopped.')); };
      port.start?.();
      const result = await this.call({ op: 'hello', tabId: this.tabId, apiBase: this.apiBase, legacy: this.options.legacy }, { allowPaused: true, timeout: this.options.handshakeTimeout || 8000 });
      this.mode = result.mode; this.ownerId = result.ownerId;
      return result;
    }
    async openShared() {
      const Worker = this.options.SharedWorker === undefined ? root.SharedWorker : this.options.SharedWorker;
      this.workerAvailable = typeof Worker === 'function';
      if (!Worker) throw errorFrom({ code: 'SHARED_WORKER_UNAVAILABLE', message: 'This browser does not support shared web workers.' });
      const url = this.options.workerUrl || new URL('instanceWorker.js', root.document?.baseURI || root.location?.href).href;
      const worker = new Worker(url, { name: 'sdeditor-instances-v1' });
      return this.handshake(worker.port, worker);
    }
    async openSingle() {
      if (!root.InstanceCoordinator || !root.MessageChannel) throw errorFrom({ code: 'COORDINATOR_UNAVAILABLE', message: 'This browser cannot initialize safe SDEditor storage. Update your browser.' });
      this.localCoordinator = new root.InstanceCoordinator.Coordinator({ store: this.rawStore, CloudSync: root.CloudSync,
        CollaborationSync: root.CollaborationSync, DictionarySync: root.DictionarySync, CollaborationProtocol: root.CollaborationProtocol,
        fetch: root.fetch.bind(root), WebSocket: root.WebSocket, apiBase: this.apiBase, mode: 'single' });
      const channel = new root.MessageChannel(); this.localCoordinator.attach(channel.port1);
      try { return await this.handshake(channel.port2); }
      catch (error) { await this.localCoordinator.destroy(); this.localCoordinator = null; throw error; }
    }
    async initialize() {
      try { await this.openShared(); }
      catch (error) {
        this.port?.close(); this.worker = null;
        const availability = { workerAvailable: this.workerAvailable, workerStartupFailure: this.workerAvailable ? error.message : '',
          fallbackReason: error.message };
        if (['INSTANCE_BUSY', 'API_MISMATCH', 'DB_UPGRADE_BLOCKED', 'DB_VERSION_CHANGED'].includes(error.code)) throw Object.assign(error, availability);
        this.fallbackReason = error.message;
        try { await this.openSingle(); }
        catch (fallbackError) { throw Object.assign(fallbackError, availability); }
      }
      this.paused = false; this.readyOnce = true;
      this.heartbeat = setInterval(() => {
        if (!this.paused) this.call({ op: 'ping' }, { timeout: 15000 }).catch(error => this.lost(error));
      }, 10000);
      this.heartbeat?.unref?.();
      this.options.onState?.({ type: 'ready', mode: this.mode, fallbackReason: this.fallbackReason });
      return this;
    }
    replayable(entry) {
      const { op, method, args } = entry.message;
      if (op === 'store') return method !== 'copyLegacyToVersion';
      if (op === 'collaboration') return !['claim', 'select', 'setAway', 'leaveEdit', 'disconnect'].includes(method);
      return op === 'cloud' && (SAFE_CLOUD_REPLAY.has(method) || (method === 'request' && (!args?.[1]?.method || args[1].method === 'GET')));
    }
    lost(error) {
      if (this.closed || this.paused) return;
      this.paused = true;
      this.options.onState?.({ type: 'disconnected', error: { code: error.code, message: error.message } });
      this.options.onError?.(errorFrom({ code: 'COORDINATOR_PAUSED', message: 'Browser coordination stopped. Drafts are preserved while SDEditor reconnects.' }));
      for (const [id, entry] of this.pending) {
        if (this.replayable(entry)) { clearTimeout(entry.timer); continue; }
        this.pending.delete(id); clearTimeout(entry.timer);
        entry.reject(errorFrom({ code: 'COMMAND_OUTCOME_UNKNOWN', message: 'The browser connection stopped before this action was confirmed. Check its result before trying again.' }));
      }
      this.port?.close();
      this.reconnectTimer = setTimeout(() => this.reconnect(), 1000);
    }
    async reconnect() {
      if (this.closed || !this.paused || this.reconnecting) return;
      this.reconnecting = true;
      const retained = new Map(this.pending); this.pending.clear();
      try {
        if (this.mode === 'single') {
          await this.localCoordinator?.destroy(); this.localCoordinator = null;
          await this.openSingle();
        } else await this.openShared();
        for (const client of this.clients.values()) if (client.active && client.connectArgs) {
          if (!sameAccount(client.scopeContext, this.cloudContext)) {
            client.active = false; this.clients.delete(client.id);
            client.options.onStatus?.({ error: true, message: 'The account or language assignment changed. Review this draft before saving.' });
            continue;
          }
          client.scopeContext = clone(this.cloudContext);
          try {
            const before = client.received || 0;
            const state = await client.call('connect', [client.connectArgs], { allowPaused: true });
            if ((client.received || 0) === before) client.apply(state);
            if (client.selected) await client.call('select', [client.selected], { allowPaused: true });
            await client.call('setAway', [!!client.away], { allowPaused: true });
          } catch (error) {
            if (!error.stale && !['WORKSPACE_CHANGED', 'SCOPE_CHANGED'].includes(error.code)) throw error;
            client.active = false; this.clients.delete(client.id); client.options.onStatus?.({ error: true, message: error.message });
            const snapshot = await this.call({ op: 'store', method: 'getWorkspaceSnapshot', args: [client.connectArgs.game] }, { allowPaused: true });
            const event = { type: 'workspace', game: client.connectArgs.game, ...snapshot, sourceChanged: true };
            for (const listener of this.workspaceListeners) listener(event); this.options.onState?.(event);
          }
        }
        this.paused = false;
        for (const [id, entry] of retained) {
          if ((entry.message.context && !sameAccount(entry.message.context, this.cloudContext))
            || (entry.message.op === 'collaboration' && !this.clients.has(entry.message.clientId))) {
            entry.reject(errorFrom({ stale: true, code: 'CONTEXT_CHANGED', message: 'The account changed while reconnecting. Review your draft before saving again.' })); continue;
          }
          if (entry.message.context) entry.message.context = clone(this.cloudContext);
          if (entry.message.op === 'cloud' && entry.message.method === 'request' && entry.message.args[2]) entry.message.args[2] = clone(this.cloudContext);
          entry.timer = setTimeout(() => {
            if (this.pending.delete(id)) entry.reject(errorFrom({ code: 'COMMAND_TIMEOUT', message: 'The coordinator did not confirm the recovered operation. Your draft remains open.' }));
          }, 120000);
          this.pending.set(id, entry); this.post(entry);
        }
        this.options.onState?.({ type: 'ready', mode: this.mode, recovered: true });
      } catch (error) {
        for (const [id, entry] of retained) this.pending.set(id, entry);
        this.port?.close();
        if (error.stale || ['WORKSPACE_CHANGED', 'SCOPE_CHANGED'].includes(error.code)) {
          for (const entry of this.pending.values()) entry.reject(error); this.pending.clear();
          this.options.onError?.(error);
        }
        this.reconnectTimer = setTimeout(() => this.reconnect(), 2000);
      } finally { this.reconnecting = false; }
    }
    createCloudFacade() {
      const bridge = this;
      const call = (method, args = []) => bridge.call({ op: 'cloud', method, args, context: clone(bridge.cloudContext) });
      const facade = {
        apiBase: this.apiBase,
        configureCallbacks(callbacks) { bridge.cloudCallbacks = callbacks || {}; if (bridge.cloudSnapshot) callbacks.onChange?.(clone(bridge.cloudSnapshot)); if (bridge.cloudStatus) callbacks.onStatus?.(bridge.cloudStatus); },
        snapshot() { return clone(bridge.cloudSnapshot); }, context() { return clone(bridge.cloudContext); },
        initialize(legacy) { return call('initialize', [legacy]); },
        request(path, options = {}, context) { return call('request', [path, options, context || bridge.cloudContext]); },
        saveLocal(payload, languageOrOptions) {
          const options = typeof languageOrOptions === 'object' ? languageOrOptions : { language: languageOrOptions || payload.lang };
          return call('saveLocal', [payload, { base: clone(bridge.cloudSnapshot), ...options }]);
        },
        selectLanguage(language, payload, previous, options = {}) { return call('selectLanguage', [language, payload, previous, { base: clone(bridge.cloudSnapshot), ...options }]); },
        finishLogin(code, verifier) { return call('finishLogin', [code, verifier]); },
        destroy() { bridge.cloudCallbacks = {}; },
      };
      for (const method of ['importLocal', 'refreshSession', 'sync', 'logout', 'resolveConflict', 'getDictionaryHistory',
        'getDictionaryHistoryEvent', 'restoreDictionaryHistory', 'listUsers', 'assignLanguage', 'recoveryExport']) facade[method] = (...args) => call(method, args);
      return facade;
    }
    createStoreFacade() {
      const bridge = this; let game = 'poe1';
      const store = { isAvailable: () => true, normalizeGameVersion: value => String(value || game).toLowerCase() === 'poe2' ? 'poe2' : 'poe1',
        setGameVersion(value) { game = store.normalizeGameVersion(value); return game; },
        setStorageStatusHandler(handler) { bridge.storageStatusHandler = handler; } };
      for (const method of ['getSettings', 'getWorkspaceSnapshot', 'getWorkspace', 'getSource', 'listRevisions', 'getRevision',
        'getLatestRevision', 'getLegacyWorkspace', 'getLegacySource', 'getLegacyRevisionCount', 'hasMigratedFromSingleVersion',
        'copyLegacyToVersion', 'migrateFromLocalStorageIfNeeded', 'replaceWorkspace']) store[method] = (...args) => {
        if (['getWorkspaceSnapshot', 'getWorkspace', 'getSource', 'copyLegacyToVersion'].includes(method)) args[0] ||= game;
        if (method === 'listRevisions') { args[2] ??= 50; args[3] ||= game; }
        if (method === 'getRevision') args[1] ||= game;
        if (method === 'getLatestRevision') args[2] ||= game;
        return bridge.call({ op: 'store', method, args, ...(method === 'replaceWorkspace' ? { context: clone(bridge.cloudContext) } : {}) });
      };
      return store;
    }
    createCollaboration(options) { return new CollaborationFacade(this, options); }
    onWorkspaceChange(callback) { this.workspaceListeners.add(callback); return () => this.workspaceListeners.delete(callback); }
    destroy() {
      if (this.closed) return;
      const port = this.port;
      // Closing immediately can discard the queued detach message. The worker
      // acknowledges and closes its endpoint; the page closes its copy later.
      try { port?.postMessage({ protocol: PROTOCOL, op: 'detach', id: uuid() }); } catch (_) {}
      this.closed = true; clearInterval(this.heartbeat); clearTimeout(this.reconnectTimer);
      root.removeEventListener?.('pagehide', this.unload);
      root.removeEventListener?.('pageshow', this.visibility);
      root.document?.removeEventListener?.('visibilitychange', this.visibility);
      for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('This editor tab closed.')); }
      this.pending.clear(); setTimeout(() => port?.close(), 250); this.localCoordinator?.destroy().catch(() => {});
    }
  }
  async function connect(options) {
    const bridge = new Bridge(options);
    try { return await bridge.initialize(); }
    catch (error) { bridge.destroy(); throw error; }
  }
  return { Bridge, CollaborationFacade, connect, PROTOCOL };
});
