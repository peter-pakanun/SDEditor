/* One origin-wide owner for browser storage and synchronization. No DOM required. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.InstanceCoordinator = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const PROTOCOL = 1;
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const fail = (code, message) => Object.assign(new Error(message), { code });
  const uuid = () => globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2);
  const errorData = error => ({ message: error?.message || String(error), code: error?.code, status: error?.status,
    stale: !!error?.stale, current: error?.current });
  const STORE_READS = new Set(['getSettings', 'getWorkspaceSnapshot', 'getWorkspace', 'getSource', 'listRevisions',
    'getRevision', 'getLatestRevision', 'getLegacyWorkspace', 'getLegacySource', 'getLegacyRevisionCount', 'hasMigratedFromSingleVersion']);
  const CLOUD_METHODS = new Set(['saveLocal', 'selectLanguage', 'importLocal', 'refreshSession', 'sync', 'logout',
    'resolveConflict', 'getDictionaryHistory', 'getDictionaryHistoryEvent', 'restoreDictionaryHistory', 'listUsers',
    'assignLanguage', 'recoveryExport']);
  const COLLAB_METHODS = new Set(['save', 'resolve', 'retry', 'sync', 'history', 'historyEntry']);
  const fields = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key, clone(value[key])]));
  const recoveryFile = value => value ? fields(value, ['filepath', 'translations', 'needsReview', 'trackedForExport', 'revision']) : null;
  const recoveryConflict = value => ({ ...fields(value, ['id', 'mutationId', 'filepath', 'kind', 'indexes', 'metadata']),
    base: recoveryFile(value.base), yours: recoveryFile(value.yours), shared: recoveryFile(value.shared) });
  const recoveryOperation = value => ({ ...fields(value, ['id', 'origin', 'kind', 'status', 'blockedByConflict']),
    files: (value.files || []).map(file => ({ base: recoveryFile(file.base), yours: recoveryFile(file.yours) })),
    ...(value.restore ? { restore: fields(value.restore, ['eventId', 'version', 'translations']) } : {}) });
  function translationRecovery(room) {
    // Export the recoverable translation content, never transport tickets,
    // authentication state, arbitrary identity properties, or cached requests.
    return { identity: fields(room.identity, ['accountId', 'game', 'sourceHash', 'language']),
      generation: room.generation ?? null, recoveryOnly: !!room.recoveryOnly,
      files: Object.values(room.local || {}).map(recoveryFile),
      outbox: (room.outbox || []).map(recoveryOperation), conflicts: (room.conflicts || []).map(recoveryConflict),
      recovery: (room.recovery || []).map(item => ({ ...fields(item, ['at', 'reason', 'sourceGeneration']),
        files: (item.files || []).map(recoveryFile), outbox: (item.outbox || []).map(recoveryOperation),
        conflicts: (item.conflicts || []).map(recoveryConflict) })) };
  }
  class Coordinator {
    constructor({ store, CloudSync, CollaborationSync, DictionarySync, CollaborationProtocol, fetch: fetcher,
      WebSocket, apiBase, mode = 'shared', ownerId, now, setInterval: interval, clearInterval: clear }) {
      this.store = store; this.CloudSync = CloudSync; this.CollaborationSync = CollaborationSync;
      this.DictionarySync = DictionarySync; this.protocol = CollaborationProtocol; this.fetcher = fetcher;
      this.WebSocket = WebSocket; this.apiBase = apiBase; this.mode = mode;
      this.ownerId = ownerId || 'sdeditor-' + mode + '-' + uuid(); this.now = now || Date.now; this.testClock = now;
      this.setInterval = interval || ((callback, delay) => globalThis.setInterval(callback, delay));
      this.clearInterval = clear || (timer => globalThis.clearInterval(timer));
      this.peers = new Map(); this.scopes = new Map(); this.requests = new Map(); this.sequence = 0;
      this.workspaceVersions = new Map();
      this.translationRecoveries = new Map(); this.recoveryRead = 0;
      this.started = null; this.lease = null; this.cloud = null; this.failed = null; this.destroyed = false;
    }
    post(peer, message) { try { peer.port.postMessage({ protocol: PROTOCOL, ...message }); } catch (_) { this.detach(peer); } }
    emit(peer, event) { this.post(peer, { type: 'event', sequence: ++this.sequence, event }); }
    broadcast(event) { for (const peer of this.peers.values()) this.emit(peer, event); }
    async start(legacy) {
      if (this.started) return this.started;
      this.started = (async () => {
        const lease = await this.store.acquireOwnership(this.ownerId, this.testClock?.());
        if (!lease) throw fail('INSTANCE_BUSY', 'Another SDEditor instance owns browser storage. Close it, then retry.');
        this.lease = lease; this.store.configureOwnership(lease);
        this.store.setStorageStatusHandler?.(status => this.pause(fail(status.code, status.message)));
        this.renewTimer = this.setInterval(() => this.renew().catch(error => this.pause(error)), 5000);
        this.renewTimer?.unref?.();
        this.sweepTimer = this.setInterval(() => {
          for (const peer of this.peers.values()) if (this.now() - peer.lastSeen > 25000) this.detach(peer);
        }, 5000);
        this.sweepTimer?.unref?.();
        this.syncTimer = this.setInterval(() => {
          if (!this.failed && !this.destroyed && this.cloud) this.cloud.refreshSession(true).then(() => this.cloud.sync()).catch(error => {
            this.cloud.status?.(error.message, true);
          });
        }, 30000);
        this.syncTimer?.unref?.();
        await this.store.migrateFromLocalStorageIfNeeded?.(legacy || {});
        this.cloud = new this.CloudSync.Client({ store: this.store, merge: this.DictionarySync,
          fetch: this.fetcher, apiBase: this.apiBase, uuid,
          onChange: () => this.cloudChanged(), onStatus: status => { this.cloudStatus = status; this.broadcast({ type: 'cloudStatus', status }); } });
        await this.cloud.initialize(legacy?.settings || await this.store.getSettings());
        await this.refreshTranslationRecoveries();
        await this.restorePending();
      })().catch(error => { this.pause(error); throw error; });
      return this.started;
    }
    async renew() {
      if (this.destroyed || this.failed || this.renewing) return;
      this.renewing = true;
      try { this.lease = await this.store.renewOwnership(this.lease, this.testClock?.()); this.store.configureOwnership(this.lease); }
      finally { this.renewing = false; }
    }
    pause(error) {
      if (this.failed) return;
      this.failed = error; this.cloud?.destroy();
      this.clearInterval(this.renewTimer); this.clearInterval(this.syncTimer);
      for (const scope of this.scopes.values()) scope.client?.destroy();
      for (const peer of this.peers.values()) for (const binding of peer.bindings.values()) binding.presence?.destroy();
      this.broadcast({ type: 'disconnected', error: errorData(error) });
    }
    context(peer) {
      const raw = this.cloud.context();
      const user = this.cloud.snapshot()?.user;
      const assignment = JSON.stringify([user?.language || '', user?.assignmentVersion ?? null]);
      if (!peer.context || peer.rawContext?.epoch !== raw.epoch || peer.rawContext?.profile !== raw.profile || peer.rawContext?.token !== raw.token || peer.assignment !== assignment) {
        peer.rawContext = raw;
        peer.assignment = assignment;
        peer.context = { id: uuid(), epoch: raw.epoch, generation: (peer.context?.generation || 0) + 1, profile: raw.profile,
          language: user?.language, assignmentVersion: user?.assignmentVersion };
      }
      return clone(peer.context);
    }
    assertContext(peer, context) {
      if (!context || context.id !== this.context(peer).id) throw Object.assign(fail('CONTEXT_CHANGED', 'The account changed. Your draft remains open; review it before saving again.'), { stale: true });
      return peer.rawContext;
    }
    cloudChanged() {
      if (!this.cloud) return;
      const context = this.cloud.context();
      const user = this.cloud.snapshot()?.user;
      const assignment = JSON.stringify([user?.language || '', user?.assignmentVersion ?? null]);
      const previous = this.authContext;
      this.authContext = context;
      if (previous && (previous.profile !== context.profile || previous.token !== context.token || this.authAssignment !== assignment)) {
        for (const scope of this.scopes.values()) scope.client?.destroy();
        this.scopes.clear();
        for (const peer of this.peers.values()) for (const binding of peer.bindings.values()) binding.presence?.destroy();
        Promise.resolve().then(() => this.restorePending()).catch(error => this.cloud.status?.(error.message, true));
      }
      this.authAssignment = assignment;
      for (const peer of this.peers.values()) this.sendCloud(peer);
    }
    sendCloud(peer) {
      if (!this.cloud?.state) return;
      const snapshot = this.cloud.snapshot(peer.language);
      const recoveries = this.translationRecoveries.get(String(snapshot.user?.id ?? 'guest')) || [];
      this.emit(peer, { type: 'cloud', snapshot: { ...snapshot, recoveryCount: (snapshot.recoveryCount || 0) + recoveries.length }, context: this.context(peer) });
    }
    updateTranslationRecoveries(state) {
      if (!state) return;
      const next = new Map();
      for (const room of Object.values(state.rooms || {})) {
        if (!room.identity?.accountId || (!room.recoveryOnly && !room.recovery?.length)) continue;
        const account = String(room.identity.accountId);
        if (!next.has(account)) next.set(account, []);
        next.get(account).push(translationRecovery(room));
      }
      const account = String(this.cloud?.snapshot()?.user?.id ?? 'guest');
      const changed = (this.translationRecoveries.get(account)?.length || 0) !== (next.get(account)?.length || 0);
      this.translationRecoveries = next;
      if (changed) for (const peer of this.peers.values()) this.sendCloud(peer);
    }
    async refreshTranslationRecoveries() {
      const sequence = ++this.recoveryRead;
      const state = await this.store.getCollaborationState?.();
      if (sequence === this.recoveryRead) this.updateTranslationRecoveries(state);
    }
    attach(port) {
      const peer = { port, id: null, bindings: new Map(), language: undefined, lastSeen: this.now() };
      port.onmessage = event => this.receive(peer, event.data).catch(error => {
        this.post(peer, { type: 'reply', id: event.data?.id, error: errorData(error) });
      });
      port.onmessageerror = () => this.detach(peer);
      port.start?.();
      return peer;
    }
    detach(peer, keepOwner = false) {
      for (const binding of peer.bindings.values()) binding.presence?.destroy();
      peer.bindings.clear();
      if (this.peers.get(peer.id) === peer) this.peers.delete(peer.id);
      try { peer.port.close?.(); } catch (_) {}
      if (!keepOwner && !this.destroyed && this.started && !this.peers.size) this.destroy().catch(() => {});
    }
    async receive(peer, message) {
      if (!message || message.protocol !== PROTOCOL || typeof message.id !== 'string') throw fail('PROTOCOL_MISMATCH', 'Reload SDEditor to use the current instance coordinator.');
      peer.lastSeen = this.now();
      if (message.op === 'hello') {
        if (typeof message.tabId !== 'string' || !message.tabId) throw fail('BAD_REQUEST', 'A browser tab identity is required.');
        if (message.apiBase !== this.apiBase) throw fail('API_MISMATCH', 'This editor origin already uses a different cloud API. Close its other tabs before changing the API.');
        await this.start(message.legacy);
        if (this.failed) throw this.failed;
        const previous = this.peers.get(message.tabId);
        if (previous && previous !== peer) this.detach(previous, true);
        if (this.mode === 'single' && this.peers.size) throw fail('INSTANCE_BUSY', 'This browser can safely run only one SDEditor tab.');
        peer.id = message.tabId; this.peers.set(peer.id, peer);
        this.sendCloud(peer);
        if (this.cloudStatus) this.emit(peer, { type: 'cloudStatus', status: this.cloudStatus });
        this.post(peer, { type: 'reply', id: message.id, result: { mode: this.mode, ownerId: this.ownerId } });
        this.emit(peer, { type: 'ready', mode: this.mode });
        return;
      }
      if (!peer.id || this.peers.get(peer.id) !== peer) throw fail('NOT_CONNECTED', 'Reconnect this SDEditor tab before saving.');
      if (this.failed || this.destroyed) throw this.failed || fail('COORDINATOR_CLOSED', 'The instance coordinator is closed.');
      if (message.op === 'ping') { this.post(peer, { type: 'reply', id: message.id, result: { now: this.now() } }); return; }
      if (message.op === 'detach') {
        this.post(peer, { type: 'reply', id: message.id, result: { detached: true } });
        this.detach(peer); return;
      }
      const requestId = peer.id + ':' + message.id;
      // Read replies must be fresh after reconnect; only mutation acknowledgments
      // are reusable. Durable mutations also carry this ID into IndexedDB.
      const cachedCommand = (message.op === 'collaboration' && ['save', 'resolve'].includes(message.method))
        || (message.op === 'store' && !STORE_READS.has(message.method))
        || (message.op === 'cloud' && (['saveLocal', 'selectLanguage', 'importLocal', 'resolveConflict', 'logout',
          'finishLogin', 'assignLanguage', 'restoreDictionaryHistory'].includes(message.method)
          || (message.method === 'request' && message.args?.[1]?.method && message.args[1].method !== 'GET')));
      let task = cachedCommand ? this.requests.get(requestId) : null;
      if (!task) {
        task = this.dispatch(peer, message, requestId);
        if (cachedCommand) this.requests.set(requestId, task);
        task.catch(() => {});
        if (this.requests.size > 2000) this.requests.delete(this.requests.keys().next().value);
      }
      try { this.post(peer, { type: 'reply', id: message.id, result: await task }); }
      catch (error) { this.post(peer, { type: 'reply', id: message.id, error: errorData(error) }); }
    }
    async dispatch(peer, message, requestId) {
      const args = message.args || [];
      if (message.op === 'store') {
        if (STORE_READS.has(message.method)) return this.store[message.method](...args);
        if (message.method === 'migrateFromLocalStorageIfNeeded') return this.store.migrateFromLocalStorageIfNeeded(...args);
        if (message.method === 'copyLegacyToVersion') {
          const result = await this.store.copyLegacyToVersion(...args); await this.workspaceChanged(args[0], true); return result;
        }
        if (message.method === 'replaceWorkspace') {
          const captured = this.assertContext(peer, message.context);
          const result = await this.store.replaceWorkspace({ ...args[0], requestId, expectedAuth: {
            profile: message.context.profile, language: message.context.language || '', assignmentVersion: message.context.assignmentVersion ?? null,
            token: captured.token ?? null,
          } });
          for (const scope of this.scopes.values()) if (scope.game === args[0].game) {
            scope.client.destroy(); this.scopes.delete(scope.key);
            for (const attached of this.peers.values()) for (const binding of attached.bindings.values()) if (binding.scope === scope) binding.presence?.destroy();
          }
          await this.workspaceChanged(args[0].game, true, result); return result;
        }
        throw fail('UNSAFE_STORAGE_CALL', 'This storage operation must use a coordinated workspace command.');
      }
      if (message.op === 'cloud') {
        this.assertContext(peer, message.context);
        let result;
        if (message.method === 'initialize') { this.sendCloud(peer); return this.cloud.snapshot(peer.language); }
        if (message.method === 'request') {
          if (/^\/auth\/exchange(?:[?#]|$)/.test(args[0])) throw fail('AUTH_EXCHANGE_PRIVATE', 'Finish sign-in through the instance coordinator.');
          result = await this.cloud.request(args[0], args[1], this.assertContext(peer, args[2] || message.context));
        } else if (message.method === 'finishLogin') {
          const login = await this.cloud.request('/auth/exchange', { method: 'POST', body: { code: args[0], verifier: args[1] } }, peer.rawContext);
          await this.cloud.acceptLogin(login); result = this.cloud.snapshot(peer.language);
        } else {
          if (!CLOUD_METHODS.has(message.method)) throw fail('BAD_REQUEST', 'Unknown cloud command.');
          if (message.method === 'saveLocal') {
            const options = typeof args[1] === 'object' ? args[1] : { language: args[1] || args[0]?.lang };
            result = await this.cloud.saveLocal(args[0], { ...options, requestId });
          } else if (message.method === 'selectLanguage') {
            result = await this.cloud.selectLanguage(args[0], args[1], args[2], { ...args[3], requestId }); peer.language = args[0];
          } else if (message.method === 'importLocal') { result = await this.cloud.importLocal(args[0], { requestId }); peer.language = args[0]?.lang; }
          else if (message.method === 'resolveConflict') result = await this.cloud.resolveConflict(...args.slice(0, 3), { language: peer.language });
          else if (message.method === 'recoveryExport') {
            await this.refreshTranslationRecoveries(); this.assertContext(peer, message.context);
            const account = String(this.cloud.snapshot()?.user?.id ?? 'guest');
            result = { ...await this.cloud.recoveryExport(), translationRecoveries: clone(this.translationRecoveries.get(account) || []) };
          }
          else result = await this.cloud[message.method](...args);
        }
        this.sendCloud(peer); return result;
      }
      if (message.op === 'collaboration') {
        if (!['disconnect', 'destroy'].includes(message.method)) this.assertContext(peer, message.context);
        if (message.method === 'connect') return this.connectScope(peer, message.clientId, args[0], message.context);
        const binding = peer.bindings.get(message.clientId);
        if (['disconnect', 'destroy'].includes(message.method)) { binding?.presence?.destroy(); peer.bindings.delete(message.clientId); return; }
        if (!binding || binding.scope.client.destroyed) throw Object.assign(fail('SCOPE_CHANGED', 'This workspace changed. Reopen it before saving.'), { stale: true });
        const { scope, presence } = binding;
        if (['select', 'setAway', 'claim', 'leaveEdit'].includes(message.method)) {
          if (message.method === 'select') binding.selected = args[0] || null;
          if (message.method === 'setAway') binding.away = !!args[0];
          if (message.method === 'leaveEdit') binding.editing = null;
          if (message.method === 'claim') {
            const peers = this.localPeers(scope, peer.id).filter(item => item.editing === args[0]);
            if (peers.length && !args[1]?.force) return { granted: false, peers };
            const result = presence ? await presence.claim(...args) : { granted: true, offline: true, peers: [] };
            if (result.granted) binding.editing = args[0]; this.notifyScope(scope); return result;
          }
          const result = presence?.[message.method](...args); this.notifyScope(scope); return result;
        }
        if (!COLLAB_METHODS.has(message.method)) throw fail('BAD_REQUEST', 'Unknown translation command.');
        if (message.method === 'save') args[0] = { ...args[0], generation: scope.generation, requestId };
        if (message.method === 'resolve') args[2] = { ...args[2], requestId };
        const result = await scope.client[message.method](...args);
        if (['save', 'resolve'].includes(message.method)) await this.workspaceChanged(scope.game, false);
        return result;
      }
      throw fail('BAD_REQUEST', 'Unknown instance command.');
    }
    async connectScope(peer, clientId, requested, expectedContext = this.context(peer)) {
      if (typeof clientId !== 'string' || !requested) throw fail('BAD_REQUEST', 'A workspace client is required.');
      this.assertContext(peer, expectedContext);
      const snapshot = await this.store.getWorkspaceSnapshot(requested.game);
      if (requested.generation != null && requested.generation !== snapshot.generation) throw Object.assign(fail('WORKSPACE_CHANGED', 'The source changed in another tab. Reload this workspace; your draft is still open.'), { stale: true });
      const source = snapshot.source || requested.source;
      if (!source?.length) throw fail('SOURCE_REQUIRED', 'Import a source ZIP before opening a translation workspace.');
      const sourceHash = await this.protocol.sourceHash(source);
      if (requested.source && await this.protocol.sourceHash(requested.source) !== sourceHash) throw Object.assign(fail('WORKSPACE_CHANGED', 'The source changed in another tab. Reload this workspace.'), { stale: true });
      const capturedAuth = this.assertContext(peer, expectedContext);
      const auth = this.cloud.snapshot();
      const localOnly = !auth.signedIn || auth.user?.language !== requested.language;
      const accountId = auth.user?.id || 'guest';
      const key = JSON.stringify([accountId, requested.game, sourceHash, requested.language, snapshot.generation, localOnly]);
      let scope = this.scopes.get(key);
      if (!scope) {
        scope = { key, game: requested.game, generation: snapshot.generation, localOnly, sourceHash };
        this.scopes.set(key, scope);
        scope.client = new this.CollaborationSync.Client({ store: this.store, apiBase: this.apiBase,
          context: () => capturedAuth, request: (...args) => this.cloud.request(...args), WebSocket: null,
          deferredSync: true, uuid,
          onChange: () => this.notifyScope(scope),
          onCommitted: snapshot => {
            this.recoveryRead++; this.updateTranslationRecoveries(scope.client.state);
            this.workspaceChanged(scope.game, false, snapshot).catch(error => this.pause(error));
          },
          onStatus: status => { scope.status = status; this.notifyScope(scope); },
          onRemote: () => this.notifyScope(scope) });
        const locals = new Map((snapshot.workspace?.descs || []).map(desc => [desc.filepath, desc]));
        const files = source.map(desc => {
          const local = locals.get(desc.filepath);
          return { filepath: desc.filepath, translations: clone(local?.translations?.[requested.language] || desc.translations?.[requested.language] || []),
            needsReview: !!(snapshot.workspace?.status?.[desc.filepath]?.needsReview ?? local?.needsReview ?? desc.needsReview),
            trackedForExport: !!local?.hasChanges };
        });
        scope.ready = scope.client.connect({ accountId, game: requested.game, language: requested.language, source, files,
          workspace: snapshot.workspace, generation: snapshot.generation, localOnly });
        scope.ready.catch(() => { if (this.scopes.get(key) === scope) this.scopes.delete(key); });
      }
      await scope.ready;
      await this.refreshTranslationRecoveries();
      this.assertContext(peer, expectedContext);
      const previous = peer.bindings.get(clientId); previous?.presence?.destroy();
      const binding = { scope, presence: null, selected: null, editing: null, away: false };
      peer.bindings.set(clientId, binding); peer.language = requested.language;
      if (!localOnly && this.CollaborationSync.PresenceClient && peer.id !== 'recovery') {
        const presence = new this.CollaborationSync.PresenceClient({ apiBase: this.apiBase, WebSocket: this.WebSocket,
          request: (...args) => this.cloud.request(...args), context: () => this.cloud.context(), uuid,
          onChange: () => this.notifyScope(scope), onStatus: status => { binding.status = status; this.notifyScope(scope); },
          onChanged: () => scope.client.retry(),
          onEditingConflict: event => this.emit(peer, { type: 'editingConflict', clientId, ...event }) });
        binding.presence = presence;
        const state = scope.client.snapshot();
        if (state.roomId) this.startPresence(binding, state);
      }
      this.sendCloud(peer); this.notifyScope(scope);
      await this.workspaceChanged(scope.game);
      return this.bindingSnapshot(peer, binding);
    }
    localPeers(scope, exclude) {
      const peers = [];
      for (const peer of this.peers.values()) for (const binding of peer.bindings.values()) if (binding.scope === scope && peer.id !== exclude) {
        peers.push({ sessionId: 'tab:' + peer.id, userId: this.cloud.snapshot()?.user?.id || '', name: 'Another tab',
          selected: binding.selected, editing: binding.editing, away: binding.away, localTab: true });
      }
      return peers;
    }
    bindingSnapshot(peer, binding) {
      const state = binding.scope.client.snapshot(), presence = binding.presence?.snapshot() || {};
      return { ...state, ...(binding.presence ? { connected: presence.connected, disconnected: presence.disconnected,
        peers: presence.peers || [], sessionId: presence.sessionId, away: presence.away } : {}),
        localPeers: this.localPeers(binding.scope, peer.id), generation: binding.scope.generation,
        error: binding.status?.error ? binding.status.message : binding.scope.status?.error ? binding.scope.status.message : '' };
    }
    startPresence(binding, state) {
      if (!binding.presence || !state.roomId || binding.presenceRoom === state.roomId) return;
      binding.presenceRoom = state.roomId;
      // Deferred room joins finish after the tab's local workspace is ready.
      // Mark the room before connect: it emits synchronous state notifications.
      binding.presence.connect({ roomId: state.roomId, identity: state.identity, context: this.cloud.context() })
        .then(() => { binding.presence.select(binding.selected); binding.presence.setAway(binding.away); })
        .catch(error => { binding.status = { message: error.message, error: true }; this.notifyScope(binding.scope); });
    }
    notifyScope(scope) {
      if (!scope.client) return;
      for (const peer of this.peers.values()) for (const [clientId, binding] of peer.bindings) if (binding.scope === scope) {
        this.startPresence(binding, scope.client.snapshot());
        this.emit(peer, { type: 'collaboration', clientId, snapshot: this.bindingSnapshot(peer, binding), status: binding.status || scope.status });
      }
    }
    async workspaceChanged(game, sourceChanged = false, current) {
      const snapshot = current || await this.store.getWorkspaceSnapshot(game);
      const previous = this.workspaceVersions.get(game);
      if (!sourceChanged && previous && (snapshot.generation < previous.generation
        || (snapshot.generation === previous.generation && snapshot.revision <= previous.revision))) return;
      this.workspaceVersions.set(game, { generation: snapshot.generation, revision: snapshot.revision });
      this.broadcast({ type: 'workspace', game, generation: snapshot.generation, revision: snapshot.revision,
        workspace: snapshot.workspace, sourceChanged });
      if (sourceChanged) await this.refreshTranslationRecoveries();
    }
    async restorePending() {
      const fingerprint = () => {
        const context = this.cloud.context(), user = this.cloud.snapshot()?.user;
        return JSON.stringify([context.epoch, context.profile, context.token, user?.language, user?.assignmentVersion]);
      };
      const captured = fingerprint();
      const state = await this.store.getCollaborationState?.();
      const auth = this.cloud.snapshot();
      if (fingerprint() !== captured) return;
      for (const room of Object.values(state?.rooms || {})) {
        if (!room.outbox?.length || !auth.signedIn || String(room.identity?.accountId) !== String(auth.user?.id)
          || room.identity?.language !== auth.user?.language) continue;
        const current = await this.store.getWorkspaceSnapshot(room.identity.game);
        if (!current.source?.length || (room.generation != null && room.generation !== current.generation)
          || await this.protocol.sourceHash(current.source) !== room.identity.sourceHash) continue;
        if (fingerprint() !== captured) return;
        // A temporary binding restores durable retry ownership without inventing presence.
        const peer = { id: 'recovery', bindings: new Map(), port: { postMessage() {} } };
        try { await this.connectScope(peer, 'recovery', { game: room.identity.game, language: room.identity.language,
          source: current.source, generation: current.generation }); }
        catch (_) { /* Existing outbox remains durable; an attached tab retries with visible diagnostics. */ }
        for (const binding of peer.bindings.values()) binding.presence?.destroy();
      }
    }
    async destroy() {
      if (this.destroyed) return;
      this.destroyed = true; this.clearInterval(this.renewTimer); this.clearInterval(this.sweepTimer); this.clearInterval(this.syncTimer);
      this.cloud?.destroy(); for (const scope of this.scopes.values()) scope.client?.destroy();
      for (const peer of [...this.peers.values()]) this.detach(peer);
      if (this.lease) await this.store.releaseOwnership(this.lease);
    }
  }
  return { Coordinator, PROTOCOL, errorData };
});
