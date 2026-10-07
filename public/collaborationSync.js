/* Durable translation synchronization. Presence is ephemeral; committed text is not. */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./collaborationProtocol.js') : root.CollaborationProtocol,
    typeof module === 'object' && module.exports ? require('./workspaceState.js') : root.WorkspaceState);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CollaborationSync = api;
})(typeof window === 'object' ? window : this, function (P, W) {
  'use strict';
  const { copy, fileState, contentEqual, mergeFile, scopeKey } = P;
  const ROOT = '/v1/collaboration';
  const transient = error => !error.status || error.status >= 500 || error.status === 429 || error.code === 'UPLOAD_EXPIRED';
  const staleError = () => Object.assign(new Error('Collaboration workspace changed.'), { stale: true });
  const byPath = files => Object.fromEntries(files.map(file => [file.filepath, copy(file)]));
  class Client {
    constructor(options) {
      this.store = options.store; this.request = options.request;
      this.apiBase = (options.apiBase || '').replace(/\/$/, '');
      this.getContext = options.context || (() => undefined);
      this.onChange = options.onChange || (() => {});
      this.onRemote = options.onRemote || (() => {});
      this.onRemoteDropped = options.onRemoteDropped || (() => {});
      this.onStatus = options.onStatus || (() => {});
      this.onWork = options.onWork || (() => {});
      this.onEditingConflict = options.onEditingConflict || (() => {});
      this.onCanonicalArchive = options.onCanonicalArchive || (() => {});
      this.allowLegacySeed = options.allowLegacySeed !== false;
      this.projectWorkspace = options.projectWorkspace || P.projectWorkspace;
      this.WebSocket = options.WebSocket === undefined ? globalThis.WebSocket : options.WebSocket;
      this.uuid = options.uuid || (() => globalThis.crypto.randomUUID());
      this.locks = options.locks || globalThis.navigator?.locks;
      this.state = null; this.key = null; this.epoch = 0; this.connected = false; this.disconnected = false; this.hashing = false;
      this.peers = []; this.sessionId = null; this.selected = null; this.editing = null;
      this.away = false;
      this.claims = new Map(); this.running = null; this.socket = null;
      this.socketOpening = null; this.presenceError = null;
      this.timer = null; this.heartbeat = null; this.backoff = 1000;
      this.destroyed = false;
      this.localWrites = Promise.resolve(); this.stagedSaves = new Map();
      this.lastStatus = null; this.lastNotification = null;
      this.lastDroppedSync = 0;
      this.droppedConflicts = {};
    }
    current(epoch) { return !this.destroyed && epoch === this.epoch && !!this.key; }
    room() { return this.state?.rooms?.[this.key] || null; }
    snapshot({ includeFiles = true } = {}) {
      const room = this.room();
      return { identity: copy(room?.identity || null), roomId: room?.roomId || null,
        connected: this.connected, disconnected: this.disconnected, hashing: this.hashing, pending: room?.outbox?.length || 0,
        conflicts: copy(room?.conflicts || []), droppedConflicts: copy(this.droppedConflicts), ...(includeFiles ? { files: Object.values(copy(room?.local || {})) } : {}),
        peers: copy(this.peers), sessionId: this.sessionId, away: this.away, sequence: room?.sequence || 0 };
    }
    notify() {
      const state = this.snapshot({ includeFiles: false }), serialized = JSON.stringify(state);
      if (serialized === this.lastNotification) return;
      this.lastNotification = serialized; this.onChange(state);
    }
    status(message, error = false) {
      if (this.lastStatus?.message === message && this.lastStatus.error === error) return;
      this.lastStatus = { message, error }; this.onStatus(this.lastStatus);
    }
    async prepareWork(action, epoch = this.epoch) {
      if (epoch !== this.epoch || this.destroyed) throw staleError();
      this.onWork({ key: 'source', label: 'Preparing collaboration data', active: true });
      try { return await action(); }
      finally { if (epoch === this.epoch) this.onWork({ key: 'source', active: false }); }
    }
    async prepareItems(items, prepare, epoch) {
      const result = []; let start = Date.now();
      for (let index = 0; index < items.length; index++) {
        if (epoch !== this.epoch || this.destroyed) throw staleError();
        result.push(prepare(items[index], index));
        if (index % 64 === 63 && Date.now() - start >= 8) {
          await new Promise(resolve => setTimeout(resolve, 0)); start = Date.now();
        }
      }
      if (epoch !== this.epoch || this.destroyed) throw staleError();
      return result;
    }
    fileBase(filepath) {
      let file = this.room()?.local[filepath] || (this.room()?.mode === 'sparse' && this.baselineStates?.[filepath]) || null;
      for (const batch of this.stagedSaves.values()) if (batch.collaboration?.key === this.key) {
        file = batch.files.find(item => item.filepath === filepath) || file;
      }
      return copy(file);
    }
    sharedBase(filepath) { return copy(this.room()?.shared[filepath] || this.baselineStates?.[filepath] || null); }
    carryProtected(room, file) {
      return !!room.carries?.[file.filepath] && (file.needsReview
        || (Object.hasOwn(room.carryRevisions || {}, file.filepath) && file.revision <= room.carryRevisions[file.filepath]));
    }
    async registerLocalCandidate(file, { revisions = [], status } = {}) {
      if (this.room()?.mode !== 'sparse') return;
      const identity = copy(this.room().identity);
      if (this.store.updateWorkspace) {
        const desc = this.source.find(desc => desc.filepath === file.filepath);
        if (!desc) throw new Error('The dropped translation is missing its source description.');
        return this.registerDroppedCandidate({ game: identity.game, language: identity.language, filepath: file.filepath,
          originSourceHash: status?.reviewCandidates?.[identity.language]?.sourceHash || identity.sourceHash,
          targetSourceHash: identity.sourceHash, snapshot: { english: copy(desc.translations.English), variables: copy(desc.variables || []),
            remarks: copy(desc.remarks || []), stats: copy(desc.stats || []), name: desc.name || '', translations: copy(file.translations) },
          reason: 'Recovered translation' }, { revisions });
      }
      const original = this.sourceFiles.get(file.filepath);
      if (!original || !file.needsReview || file.trackedForExport) throw new Error('Only a legacy dropped translation can be restored.');
      const candidate = fileState(file, original.english.length);
      await this.update((state, room) => {
        room.carries ||= {}; room.carryRevisions ||= {};
        room.carries[file.filepath] = candidate;
        room.carryRevisions[file.filepath] = (room.shared[file.filepath] || this.baselineStates[file.filepath]).revision;
      }, { revisions, projectWorkspace: workspace => {
        if (workspace?.sourceHash && workspace.sourceHash !== identity.sourceHash) throw new Error('The local workspace changed before restoring the candidate.');
        const result = this.projectWorkspace(workspace, [candidate], identity.language, this.source, { mutate: true });
        result.sourceHash = identity.sourceHash; result.collaborationAccountId = identity.accountId;
        if (status) result.status[file.filepath] = W.setFileStatus(result.status[file.filepath] || {}, identity.language, copy(status));
        return result;
      } });
      return { status: 'local' };
    }
    async registerDroppedCandidate(candidate, { revisions = [] } = {}) {
      const epoch = this.epoch, identity = copy(this.room()?.identity);
      if (!identity || !this.store.updateWorkspace) throw new Error('Dropped translation storage is unavailable.');
      if (candidate.game !== identity.game || candidate.language !== identity.language
        || candidate.targetSourceHash !== identity.sourceHash) throw staleError();
      const id = candidate.id || this.uuid();
      candidate = { ...copy(candidate), id, recoveryId: candidate.recoveryId || id };
      let registered;
      const workspace = await this.store.updateWorkspace(current => {
        if (!this.current(epoch) || !current || current.sourceHash !== identity.sourceHash
          || (current.collaborationAccountId && String(current.collaborationAccountId) !== identity.accountId)) throw staleError();
        const desc = { filepath: candidate.filepath, ...candidate.snapshot, translations: { English: candidate.snapshot.english } };
        registered = W.dropTranslation(current, desc, identity.language, { ...candidate, snapshot: candidate.snapshot });
        return current;
      }, identity.game, { revisions });
      if (!this.current(epoch)) throw staleError();
      await this.deliverDropped(workspace, [registered], epoch);
      this.lastDroppedSync = 0; await this.retry();
      return { status: this.lastError ? 'pending' : 'synced', candidate: copy(registered) };
    }
    async discardDropped(filepath, expected) {
      const epoch = this.epoch, identity = copy(this.room()?.identity);
      if (!identity || !this.store.updateWorkspace || expected?.targetSourceHash !== identity.sourceHash) throw staleError();
      let discarded;
      const workspace = await this.store.updateWorkspace(current => {
        if (!this.current(epoch) || !current || current.sourceHash !== identity.sourceHash
          || (current.collaborationAccountId && String(current.collaborationAccountId) !== identity.accountId)) throw staleError();
        discarded = W.discardDropped(current, filepath, identity.language, expected);
        return current;
      }, identity.game);
      if (!this.current(epoch)) throw staleError();
      await this.deliverDropped(workspace, [{ ...copy(discarded), status: 'discarded' }], epoch);
      this.lastDroppedSync = 0; await this.retry();
      return { status: this.lastError ? 'pending' : 'synced' };
    }
    preserveCarried(room, files) {
      if (room.mode !== 'sparse') return;
      for (const file of files) {
        const carried = room.carries?.[file.filepath];
        if (!carried || this.carryProtected(room, file)) continue;
        if (!P.equal(carried.translations, file.translations)) room.recovery.push({ id: this.uuid(), at: Date.now(),
          reason: 'Local carried translation before a reviewed shared version', files: [copy(carried)] });
        delete room.carries[file.filepath];
        if (room.carryRevisions) delete room.carryRevisions[file.filepath];
      }
    }
    remoteFiles(files) {
      const room = this.room();
      return files.filter(file => room.mode !== 'sparse' || !this.carryProtected(room, file))
        .map(file => copy(room.local[file.filepath])).filter(Boolean);
    }
    stageLocalSave(batch) { this.stagedSaves.set(batch.jobId, batch); }
    withLocalWrite(action) {
      const write = this.localWrites.then(action);
      this.localWrites = write.catch(() => {});
      return write;
    }
    acceptLocalSave(batch, ack) {
      this.stagedSaves.delete(batch.jobId);
      if (this.key !== batch.collaboration?.key || !this.room()) return;
      const room = this.room();
      const operations = ack.operations || (ack.operation ? [ack.operation] : []);
      if (ack.duplicate) room.outbox = room.outbox.filter(operation => !(ack.mutationIds || [batch.jobId]).includes(operation.id));
      for (const operation of operations) if (!room.outbox.some(item => item.id === operation.id)) room.outbox.push(copy(operation));
      for (const file of ack.files || batch.files) room.local[file.filepath] = copy(file);
      // The worker acknowledgement is durable even if a UI observer fails.
      try { this.notify(); } catch (_) {}
    }
    async update(fn, options = {}, epoch = this.epoch) {
      return this.withLocalWrite(() => this.updateStored(fn, options, epoch));
    }
    async updateStored(fn, options = {}, epoch = this.epoch) {
      const key = this.key;
      if (!this.current(epoch)) throw staleError();
      const state = await this.store.updateCollaborationState(state => {
        if (!this.current(epoch) || this.key !== key) throw staleError();
        state ||= { version: 1, rooms: {} };
        fn(state, state.rooms[key]);
        return state;
      }, { version: this.room()?.identity.game, ...options });
      if (!this.current(epoch)) throw staleError();
      this.state = state; this.notify();
      return this.room();
    }
    async api(path, options, epoch = this.epoch) {
      if (!this.current(epoch)) throw staleError();
      const result = await this.request(ROOT + path, options || {}, this.context);
      if (!this.current(epoch)) throw staleError();
      return result;
    }
    async connect({ accountId, game, language, source, files, workspace, archive, baselineSource, baselineTree }) {
      if (archive) return this.connectSparse({ accountId, game, language, source, files, workspace, archive, baselineSource, baselineTree });
      this.disconnect(); this.destroyed = false;
      this.baselineStates = null; this.baselineTree = null; this.archive = null;
      if (!accountId || !language || !['poe1', 'poe2'].includes(game)) throw new Error('A signed-in assigned translator is required.');
      const epoch = this.epoch;
      let manifest, sourceHash;
      this.hashing = true;
      try {
        this.notify();
        // Paint the hashing indicator before preparing a large source manifest.
        if (typeof globalThis.requestAnimationFrame === 'function' && !globalThis.document?.hidden) {
          await new Promise(resolve => globalThis.requestAnimationFrame(() => setTimeout(resolve, 0)));
        }
        if (epoch !== this.epoch) throw staleError();
        sourceHash = await this.prepareWork(() => P.sourceHashAsync(source, {
          isCancelled: () => epoch !== this.epoch || this.destroyed,
          onManifest: value => { manifest = value; },
        }), epoch);
        if (epoch !== this.epoch) throw staleError();
      } finally {
        if (epoch === this.epoch) { this.hashing = false; this.notify(); }
      }
      const identity = { accountId: String(accountId), game, sourceHash, language };
      let incoming;
      await this.prepareWork(async () => {
        this.source = await this.prepareItems(source, desc => copy(desc), epoch);
        this.sourceFiles = new Map(); incoming = {};
        await this.prepareItems(manifest.files, file => this.sourceFiles.set(file.filepath, file), epoch);
        await this.prepareItems(files, file => {
          const original = this.sourceFiles.get(file.filepath);
          if (!original) throw new Error('Saved file is absent from the source: ' + file.filepath);
          incoming[file.filepath] = fileState(file, original.english.length);
        }, epoch);
        await this.prepareItems(manifest.files, original => {
          if (!incoming[original.filepath]) incoming[original.filepath] = fileState({ filepath: original.filepath, translations: [] }, original.english.length);
        }, epoch);
      }, epoch);
      this.key = scopeKey(identity); this.context = this.getContext();
      await this.update((state, room) => {
        if (!room) state.rooms[this.key] = { identity, manifest, roomId: null, sequence: 0,
          shared: {}, local: incoming, outbox: [], conflicts: [], recovery: [], initialized: false };
        else {
          const differences = Object.values(incoming).filter(file => room.local[file.filepath] && !contentEqual(file, room.local[file.filepath]));
          if (differences.length) {
            room.recovery.push({ at: Date.now(), reason: 'Local workspace changed while disconnected', files: copy(Object.values(incoming)) });
            for (const yours of differences) {
              const id = this.uuid(); const shared = room.shared[yours.filepath];
              room.outbox.push({ id, origin: 'merge', kind: 'join', files: [{ base: null, yours: copy(yours) }], status: 'conflict' });
              const merged = shared ? mergeFile(null, yours, shared) : { indexes: [], metadata: [] };
              room.conflicts.push({ id: id + ':' + yours.filepath, mutationId: id, filepath: yours.filepath,
                kind: 'join', base: null, yours: copy(yours), shared: copy(shared || yours), indexes: merged.indexes, metadata: merged.metadata });
            }
            if (room.initialized) this.rebuild(room);
          }
        }
      }, { version: game, projectWorkspace: stored => {
        const current = stored || copy(workspace);
        if (!current || (current.sourceHash && current.sourceHash !== identity.sourceHash)) return current;
        current.sourceHash = identity.sourceHash;
        current.collaborationAccountId = identity.accountId;
        return current;
      } }, epoch);
      try {
        await this.initializeRoom(epoch);
        await this.retry();
      } catch (error) {
        if (error.stale || !this.current(epoch)) throw staleError();
        this.handleError(error);
        if (!transient(error)) throw error;
      }
      return this.snapshot({ includeFiles: false });
    }
    async connectSparse({ accountId, game, language, source, files, workspace, archive, baselineSource, baselineTree }) {
      this.disconnect(); this.destroyed = false;
      if (!accountId || !language || !['poe1', 'poe2'].includes(game)) throw new Error('A signed-in assigned translator is required.');
      const epoch = this.epoch;
      archive = await P.finalizeArchive(archive);
      if (epoch !== this.epoch) throw staleError();
      if (!Array.isArray(baselineSource) || baselineSource.length !== archive.descriptionCount
        || baselineTree?.version !== 1 || baselineTree.root !== archive.treeRoot || baselineTree.paths?.length !== archive.descriptionCount) throw new Error('The imported baseline cache is unavailable. Import the original ZIP again.');
      let manifest;
      await this.prepareWork(async () => {
        manifest = await P.manifestAsync(baselineSource, { isCancelled: () => epoch !== this.epoch || this.destroyed });
        this.archive = archive; this.baselineTree = baselineTree; this.source = baselineSource;
        this.baselineFiles = new Map(); this.sourceFiles = new Map(); this.baselineStates = {};
        await this.prepareItems(baselineSource, file => {
          this.baselineFiles.set(file.filepath, file);
          this.baselineStates[file.filepath] = fileState({ filepath: file.filepath,
            translations: (file.translations?.[language] || []).slice(0, file.translations.English.length) }, file.translations.English.length);
        }, epoch);
        await this.prepareItems(manifest.files, file => this.sourceFiles.set(file.filepath, file), epoch);
      }, epoch);
      const identity = { accountId: String(accountId), game, sourceHash: archive.baselineId, language };
      this.key = scopeKey(identity); this.context = this.getContext();
      // Resolve the tiny descriptor before creating or altering durable room state.
      const canonical = await this.api('/archives/resolve', { method: 'POST', body: { game, archive } }, epoch);
      const known = await P.finalizeArchive(canonical.archive || canonical);
      if (!P.equal(known, archive)) {
        this.onCanonicalArchive(copy(known));
        throw Object.assign(new Error('This original ZIP already has an agreed import configuration.'), { code: 'ARCHIVE_CONFIG_MISMATCH', archive: known });
      }
      const incoming = files.map(file => {
        const original = this.sourceFiles.get(file.filepath);
        if (!original) throw new Error('Saved file is absent from the source: ' + file.filepath);
        return fileState(file, original.english.length);
      });
      let legacyCarries = {};
      const modernWorkspace = workspace?.stagedVersion >= 1;
      await this.update((state, room) => {
        if (!room) room = state.rooms[this.key] = { mode: 'sparse', identity, archive: copy(archive),
          manifest: { version: 2, files: manifest.files.map(file => ({ filepath: file.filepath, entryCount: file.english.length })) }, roomId: null, sequence: 0,
          shared: {}, local: {}, outbox: [], conflicts: [], recovery: [], carries: {}, initialized: false };
        if (room.mode !== 'sparse' || room.archive.baselineId !== archive.baselineId) throw new Error('The stored collaboration baseline differs.');
        legacyCarries = copy(room.carries || {});
        room.carries = {}; room.carryRevisions = {};
        for (const yours of incoming) {
          const staged = modernWorkspace ? workspace.staged?.[language]?.[yours.filepath] : null;
          if (modernWorkspace ? !staged : !yours.trackedForExport) {
            if (yours.needsReview && !modernWorkspace) {
              legacyCarries[yours.filepath] = copy(yours);
            }
            continue;
          }
          if (!modernWorkspace && yours.needsReview) {
            if (!modernWorkspace) legacyCarries[yours.filepath] = copy(yours);
            continue;
          }
          const previous = room.local[yours.filepath] || this.baselineStates[yours.filepath];
          if (contentEqual(yours, previous)) continue;
          room.recovery.push({ id: this.uuid(), at: Date.now(), reason: 'Local edited translation before joining', files: [copy(yours)] });
          room.outbox.push({ id: this.uuid(), origin: 'merge', kind: 'join', status: 'pending', files: [{ base: copy(previous), yours: copy(yours) }] });
        }
        for (const carry of Object.values(legacyCarries)) if (!(room.recovery || []).some(entry => (entry.files || [])
          .some(file => file.filepath === carry.filepath && P.equal(file.translations, carry.translations)))) {
          room.recovery ||= [];
          room.recovery.push({ id: this.uuid(), at: Date.now(), reason: 'Preserved dropped translation', files: [copy(carry)] });
        }
        this.rebuild(room);
      }, { version: game, projectWorkspace: stored => {
        const current = stored || copy(workspace);
        if (!current || (current.sourceHash && current.sourceHash !== identity.sourceHash)) return current;
        current.sourceHash = identity.sourceHash; current.collaborationAccountId = identity.accountId;
        W.initializeWorkspace(current, { source: baselineSource, sourceHash: identity.sourceHash, game, language });
        const descriptions = new Map((current.descs || []).map(desc => [desc.filepath, desc]));
        for (const carry of Object.values(legacyCarries)) {
          if (W.droppedForFile(current, carry.filepath, language)) continue;
          if (!carry.translations.some(text => String(text).trim())) continue;
          const desc = descriptions.get(carry.filepath) || this.baselineFiles.get(carry.filepath);
          if (!desc) continue;
          W.dropTranslation(current, desc, language, { game, translations: carry.translations,
            originSourceHash: '', originSourceAvailable: false, targetSourceHash: identity.sourceHash,
            reason: 'Preserved local dropped translation' });
        }
        return current;
      } }, epoch);
      try { await this.initializeRoom(epoch); await this.retry(); }
      catch (error) {
        if (error.stale || !this.current(epoch)) throw staleError();
        if (error.code === 'ARCHIVE_CONFIG_MISMATCH') throw error;
        this.handleError(error); if (!transient(error)) throw error;
      }
      return this.snapshot({ includeFiles: false });
    }
    async initializeRoom(epoch) {
      const room = this.room();
      const identity = { game: room.identity.game, sourceHash: room.identity.sourceHash, language: room.identity.language };
      let snapshot;
      if (room.mode === 'sparse') {
        snapshot = await this.api('/join', { method: 'POST', body: { ...identity, archive: room.archive } }, epoch);
        if (snapshot.archive && snapshot.archive.baselineId !== room.archive.baselineId) throw Object.assign(new Error('The agreed import configuration changed.'), { code: 'ARCHIVE_CONFIG_MISMATCH', archive: snapshot.archive });
        await this.acceptSnapshot(snapshot, epoch, !room.initialized || snapshot.sequence < room.sequence);
        this.startPresence(epoch); return;
      }
      try { snapshot = await this.api('/join', { method: 'POST', body: identity }, epoch); }
      catch (error) {
        if (error.status !== 404) throw error;
        if (!this.allowLegacySeed) throw Object.assign(new Error('Reimport the original upstream ZIP to enable collaboration. Your local translations and history are preserved.'),
          { status: 409, code: 'UPSTREAM_ZIP_REQUIRED' });
        let upload = room.seedUpload;
        if (!upload || (upload.expiresAt && upload.expiresAt <= Date.now())) {
          const ticket = await this.api('/uploads', { method: 'POST', body: identity }, epoch);
          const files = room.manifest.files.map(source => {
            const { revision, ...state } = room.local[source.filepath];
            return { ...source, ...copy(state) };
          });
          upload = { id: ticket.uploadId || ticket.id, expiresAt: ticket.expiresAt, files };
          await this.update((state, current) => { current.seedUpload = copy(upload); }, {}, epoch);
        }
        try { await this.uploadFiles(upload.id, upload.files, epoch); }
        catch (error) {
          if (error.code === 'UPLOAD_EXPIRED') await this.update((state, current) => { delete current.seedUpload; }, {}, epoch);
          throw error;
        }
        snapshot = await this.api('/uploads/' + encodeURIComponent(upload.id) + '/finalize', { method: 'POST' }, epoch);
      }
      await this.acceptSnapshot(snapshot, epoch, !room.initialized || snapshot.sequence < room.sequence);
      this.startPresence(epoch);
    }
    async uploadFiles(id, files, epoch) {
      // Bound serialized bytes rather than only row count: individual translations
      // vary greatly in size. Server enforces its own independent limits.
      const chunks = []; let chunk = []; let bytes = 0;
      const status = await this.api('/uploads/' + encodeURIComponent(id), {}, epoch);
      if (status.completed) return;
      const received = new Set(status.receivedChunks || []);
      for (const file of files) {
        const size = new TextEncoder().encode(JSON.stringify(file)).length;
        if (size > 2 * 1024 * 1024) throw new Error('A description exceeds the collaboration upload limit: ' + file.filepath);
        if (chunk.length && (bytes + size > 500000 || chunk.length >= 100)) { chunks.push(chunk); chunk = []; bytes = 0; }
        chunk.push(file); bytes += size;
      }
      if (chunk.length) chunks.push(chunk);
      for (let index = 0; index < chunks.length; index++) if (!received.has(index)) await this.api('/uploads/' + encodeURIComponent(id) + '/chunks/' + index,
        { method: 'PUT', body: { files: chunks[index] } }, epoch);
    }
    projection(files, epoch, stagedWorkspace) {
      const identity = copy(this.room().identity); const source = this.source;
      const statuses = Object.fromEntries(files.filter(file => stagedWorkspace?.status?.[file.filepath])
        .map(file => [file.filepath, copy(stagedWorkspace.status[file.filepath])]));
      return (workspace, state) => {
        if (!this.current(epoch)) throw staleError();
        const room = state.rooms[scopeKey(identity)];
        if (workspace?.sourceHash && workspace.sourceHash !== identity.sourceHash) return workspace;
        if (workspace?.collaborationAccountId && workspace.collaborationAccountId !== identity.accountId) return workspace;
        // IndexedDB returns an independent transaction snapshot. Mutate that
        // copy directly; only the caller-owned fallback needs another copy.
        const latest = workspace || copy(stagedWorkspace || { descs: [], status: {} });
        latest.status ||= {};
        W.scopeWorkspace(latest, identity.language);
        for (const file of files) if (statuses[file.filepath]) latest.status[file.filepath] = W.setFileStatus(
          latest.status[file.filepath] || {}, identity.language, statuses[file.filepath]);
        const effective = files.filter(file => room.mode !== 'sparse' || !this.carryProtected(room, file))
          .map(file => room.local[file.filepath]).filter(Boolean);
        const projected = this.projectWorkspace(latest, effective, identity.language, source, { mutate: true });
        projected.sourceHash = identity.sourceHash; projected.collaborationAccountId = identity.accountId;
        return projected;
      };
    }
    rebuild(room) {
      room.local = copy(room.shared);
      for (const operation of room.outbox) for (const entry of operation.files) {
        const shared = room.local[entry.yours.filepath] || (room.mode === 'sparse' && this.baselineStates[entry.yours.filepath]);
        room.local[entry.yours.filepath] = shared ? mergeFile(entry.base, entry.yours, shared).file : copy(entry.yours);
      }
      for (const conflict of room.conflicts) {
        const shared = room.shared[conflict.filepath];
        if (!shared) continue;
        const merged = mergeFile(conflict.base, conflict.yours, shared);
        conflict.shared = copy(shared); conflict.indexes = merged.indexes; conflict.metadata = merged.metadata;
      }
    }
    async acceptSnapshot(snapshot, epoch, initial = false) {
      if (!snapshot?.roomId || !Array.isArray(snapshot.files)) throw new Error('Invalid collaboration snapshot.');
      const files = snapshot.files.map(file => fileState(file));
      await this.update((state, room) => {
        if (room.mode === 'sparse') this.preserveCarried(room, files);
        else if (initial) {
          const local = copy(room.local);
          room.recovery.push({ at: Date.now(), reason: 'Before joining shared workspace', files: Object.values(local) });
          const pendingPaths = new Set(room.outbox.flatMap(op => op.files.map(entry => entry.yours.filepath)));
          for (const shared of files) {
            const yours = local[shared.filepath];
            if (yours && !contentEqual(yours, shared) && !pendingPaths.has(shared.filepath)) {
              const id = this.uuid();
              const operation = { id, origin: 'merge', kind: 'join', files: [{ base: null, yours }], status: 'conflict' };
              room.outbox.push(operation);
              const merged = mergeFile(null, yours, shared);
              room.conflicts.push({ id: id + ':' + shared.filepath, mutationId: id, filepath: shared.filepath,
                kind: 'join', base: null, yours: copy(yours), shared: copy(shared), indexes: merged.indexes, metadata: merged.metadata });
            }
          }
        }
        room.roomId = snapshot.roomId;
        room.shared = byPath(files);
        if (room.mode === 'sparse') {
          room.outbox = room.outbox.filter(operation => operation.kind !== 'join'
            || !operation.files.every(entry => contentEqual(entry.yours, room.shared[entry.yours.filepath])));
          const pending = new Set(room.outbox.map(operation => operation.id));
          room.conflicts = room.conflicts.filter(conflict => pending.has(conflict.mutationId));
        }
        room.sequence = snapshot.sequence || 0;
        room.initialized = true;
        delete room.seedUpload;
        this.rebuild(room);
      }, { projectWorkspace: this.projection(files, epoch) }, epoch);
      await this.onRemote(this.room().mode === 'sparse' ? this.remoteFiles([...files, ...this.room().outbox.flatMap(op => op.files.map(entry => entry.yours))]) : copy(Object.values(this.room().local)));
      if (!this.current(epoch)) throw staleError();
    }
    async save({ workspace, revisions = [], files, origin = 'save', bases = {}, restore, promoteDropped, promoteDroppedByPath = {}, waitForSync = true }) {
      const epoch = this.epoch; const room = this.room();
      if (!room) throw new Error('Collaboration workspace is not connected.');
      if (!Array.isArray(files) || !files.length) throw new Error('A save must contain at least one file.');
      const mutationId = this.uuid();
      const normalized = files.map(file => {
        const original = this.sourceFiles.get(file.filepath);
        if (!original) throw new Error('Saved file is absent from the source: ' + file.filepath);
        return fileState(file, original.english.length);
      });
      if (room.mode === 'sparse' && typeof restore?.eventId === 'string' && restore.eventId.startsWith('local-baseline:')) {
        const filepath = decodeURIComponent(restore.eventId.slice('local-baseline:'.length));
        if (normalized.length !== 1 || normalized[0].filepath !== filepath || restore.version !== 'after'
          || !P.equal(normalized[0].translations, this.baselineStates[filepath]?.translations)) throw new Error('Invalid imported baseline restore.');
        restore = undefined;
      }
      if (new Set(normalized.map(file => file.filepath)).size !== normalized.length) throw new Error('A save contains duplicate files.');
      if (restore && (normalized.length !== 1 || !restore.eventId || !['before', 'after'].includes(restore.version))) throw new Error('Invalid shared history restore.');
      if (promoteDropped && normalized.length !== 1) throw new Error('A dropped translation promotion must name one file.');
      const promotions = { ...copy(promoteDroppedByPath), ...(promoteDropped ? { [normalized[0].filepath]: copy(promoteDropped) } : {}) };
      const promoted = normalized.filter(file => promotions[file.filepath]);
      const ordinary = normalized.filter(file => !promotions[file.filepath]);
      const groups = [...promoted.map(file => [file]), ...(ordinary.length ? [ordinary] : [])];
      const mutationIds = groups.map((group, index) => index === 0 ? mutationId : this.uuid());
      let projectedDropped;
      await this.update((state, current) => {
        const replaced = new Set(current.outbox.filter(op => ['candidate_conflict', 'needs_candidate_review'].includes(op.status)
          && op.files.every(entry => normalized.some(file => file.filepath === entry.yours.filepath))).flatMap(op => op.files.map(entry => entry.yours.filepath)));
        for (const op of current.outbox.filter(op => op.files.some(entry => replaced.has(entry.yours.filepath)))) {
          if (['candidate_conflict', 'needs_candidate_review'].includes(op.status)) current.recovery.push({ at: Date.now(), reason: 'Saved result before a fresh dropped-copy review', files: op.files.map(entry => copy(entry.yours)) });
        }
        current.outbox = current.outbox.filter(op => !['candidate_conflict', 'needs_candidate_review'].includes(op.status)
          || !op.files.every(entry => replaced.has(entry.yours.filepath)));
        for (const file of normalized) if (!file.needsReview && current.carries) {
          delete current.carries[file.filepath];
          if (current.carryRevisions) delete current.carryRevisions[file.filepath];
        }
        groups.forEach((group, index) => current.outbox.push({ id: mutationIds[index], origin,
          ...(promotions[group[0].filepath] ? { promoteDropped: copy(promotions[group[0].filepath]) } : {}),
          ...(restore ? { restore: { ...copy(restore), translations: copy(normalized[0].translations) } } : {}), status: 'pending', files: group.map(yours => ({
          base: copy(replaced.has(yours.filepath) ? current.shared[yours.filepath] || this.baselineStates?.[yours.filepath]
            : Object.hasOwn(bases, yours.filepath) ? bases[yours.filepath] : current.local[yours.filepath]
            || (current.mode === 'sparse' && this.baselineStates[yours.filepath]) || null), yours })) }));
        for (const yours of normalized) current.local[yours.filepath] = copy(yours);
      }, { revisions: revisions.map(revision => ({ ...copy(revision), sourceHash: room.identity.sourceHash,
        collaborationAccountId: room.identity.accountId })), projectWorkspace: (stored, state) => {
          const projected = this.projection(normalized, epoch, workspace)(stored, state);
          for (const file of promoted) if (projected) W.stageTranslation(projected, file, room.identity.language,
            { sourceHash: room.identity.sourceHash, promoteDropped: promotions[file.filepath] });
          projectedDropped = projected;
          return projected;
        } }, epoch);
      if (promoted.length && projectedDropped && this.store.updateWorkspace) await this.deliverDropped(projectedDropped, [], epoch);
      if (!waitForSync) {
        // Workspace, history and outbox are durable. Let editor saves finish even
        // while a slow request or another tab holds the synchronization lock.
        this.retry().catch(error => {
          if (this.current(epoch) && !error.stale) this.handleError(error);
        });
        return { status: 'pending', mutationId, mutationIds };
      }
      await this.retry();
      if (!this.current(epoch)) throw staleError();
      if (this.lastError && !transient(this.lastError)) throw this.lastError;
      const remaining = this.room()?.outbox.filter(op => mutationIds.includes(op.id)) || [];
      if (remaining.some(op => op.status === 'pending')) this.schedule();
      return { status: !remaining.length ? 'synced' : remaining.some(op => ['conflict', 'candidate_conflict', 'needs_candidate_review'].includes(op.status) || op.blockedByConflict) ? 'conflict' : 'pending', mutationId, mutationIds };
    }
    sync({ background = false } = {}) {
      // The room websocket announces committed translations. Idle timers only
      // retry disconnected rooms or saves that still need to be uploaded.
      if (background && this.connected && this.socket?.readyState === 1
        && !this.room()?.outbox.some(operation => operation.status !== 'conflict' && !operation.blockedByConflict)) {
        return Promise.resolve();
      }
      return this.retry();
    }
    retry() {
      const epoch = this.epoch;
      if (!this.current(epoch)) return Promise.resolve(this.snapshot({ includeFiles: false }));
      // Presence belongs to this browser, so it must not wait for another tab's
      // translation lock, catch-up requests or queued uploads.
      this.startPresence(epoch);
      if (this.running) { this.dirty = true; return this.running; }
      const run = async () => {
        try {
          if (!this.current(epoch)) throw staleError();
          await this.syncDropped(epoch);
          if (!this.room().roomId) await this.initializeRoom(epoch);
          do {
            this.dirty = false;
            await this.catchUp(epoch);
            await this.flush(epoch);
          } while (this.dirty && this.current(epoch));
          if (!this.current(epoch)) throw staleError();
          if (!this.presenceError && !this.disconnected) this.backoff = 1000;
          this.lastError = null;
          // A completed pass clears an earlier failure. Enqueueing a save or
          // starting another request must never hide an outstanding problem.
          if (this.presenceError) this.reportPresenceError();
          else if (Object.keys(this.droppedConflicts).length || this.room().outbox.some(op => ['candidate_conflict', 'needs_candidate_review'].includes(op.status)))
            this.status('Conflicting dropped copies need review before this file can be shared.', true);
          else this.status('');
        } catch (error) {
          if (!error.stale && this.current(epoch)) this.handleError(error);
        }
        return this.snapshot({ includeFiles: false });
      };
      const promise = this.locks ? this.locks.request('sdeditor-collaboration:' + this.key, run) : run();
      this.running = promise.finally(() => { if (this.running === tracked) this.running = null; });
      const tracked = this.running;
      return tracked;
    }
    reportPresenceError() {
      this.status(transient(this.presenceError) ? 'Collaboration disconnected · reconnecting automatically' : this.presenceError.message, true);
    }
    async receiveDropped(records, epoch, options = {}) {
      const identity = copy(this.room()?.identity);
      if (!identity || !this.store.updateWorkspace) return;
      const updated = await this.store.updateWorkspace(current => {
        if (!this.current(epoch)) throw staleError();
        if (!current || (current.sourceHash && current.sourceHash !== identity.sourceHash)
          || (current.collaborationAccountId && String(current.collaborationAccountId) !== identity.accountId)) throw staleError();
        return W.acceptDropped(current, records, { ...options, game: identity.game, language: identity.language });
      }, identity.game);
      if (!this.current(epoch)) throw staleError();
      await this.deliverDropped(updated, records, epoch);
      if (!this.current(epoch)) throw staleError();
      return updated;
    }
    async deliverDropped(workspace, records, epoch) {
      if (!this.current(epoch)) throw staleError();
      this.droppedConflicts = copy(workspace.droppedConflicts?.[this.room().identity.language] || {});
      await this.onRemoteDropped(copy(records), copy({ dropped: workspace.dropped, droppedArchive: workspace.droppedArchive,
        droppedOutbox: workspace.droppedOutbox, droppedAliases: workspace.droppedAliases, droppedConflicts: workspace.droppedConflicts }));
      if (!this.current(epoch)) throw staleError();
      this.notify();
    }
    async retainDroppedConflict(error, operation, kind, epoch) {
      const identity = copy(this.room().identity), shared = error.current?.candidate || error.current;
      if (!shared?.id || shared.game !== identity.game || shared.language !== identity.language) throw error;
      let updated;
      const record = workspace => {
        if (!this.current(epoch) || workspace?.sourceHash !== identity.sourceHash
          || (workspace.collaborationAccountId && String(workspace.collaborationAccountId) !== identity.accountId)) throw staleError();
        const promotion = operation.wire?.promoteDropped || operation.promoteDropped;
        const yours = operation.candidate || workspace.droppedArchive?.[promotion?.id]
          || workspace.droppedArchive?.[operation.promoteDropped?.id];
        if (!yours?.snapshot) throw error;
        updated = W.recordDroppedConflict(workspace, { kind, filepath: shared.filepath, language: identity.language,
          targetSourceHash: identity.sourceHash, yours: copy(yours), shared: copy(shared),
          ...(kind === 'promotion' ? { operationId: operation.id } : {}) });
        return updated;
      };
      if (kind === 'promotion') await this.update((state, room) => {
        const pending = room.outbox.find(item => item.id === operation.id);
        if (pending) { pending.status = 'candidate_conflict'; delete pending.wire; delete pending.upload; }
      }, { projectWorkspace: record }, epoch);
      else updated = await this.store.updateWorkspace(record, identity.game);
      await this.deliverDropped(updated, [], epoch);
      return updated;
    }
    async resolveDroppedConflict(filepath, choice = 'shared', expected) {
      const epoch = this.epoch, identity = copy(this.room()?.identity);
      if (!identity || !this.store.updateWorkspace || !['shared', 'local'].includes(choice)) throw staleError();
      const observedWorkspace = await this.store.getWorkspace(identity.game);
      const observed = copy(observedWorkspace?.droppedConflicts?.[identity.language]?.[filepath]);
      if (!observed || observed.targetSourceHash !== identity.sourceHash
        || (expected && (expected.id !== observed.shared.id || Number(expected.revision) !== Number(observed.shared.revision)))) throw staleError();
      const params = new URLSearchParams({ game: identity.game, language: identity.language, includeResolved: '1' });
      const result = await this.api('/dropped?' + params, {}, epoch);
      const candidates = result.candidates || result.items || result.records || [];
      const latest = candidates.filter(item => item.filepath === filepath)
        .sort((left, right) => Number(right.revision) - Number(left.revision))[0];
      if (!latest || latest.id !== observed.shared.id || Number(latest.revision) !== Number(observed.shared.revision)) {
        if (latest) await this.retainDroppedConflict({ current: latest }, { ...copy(this.room().outbox.find(op => op.id === observed.operationId) || {}),
          ...(observed.operationId ? { id: observed.operationId } : {}), candidate: observed.yours }, observed.kind, epoch);
        throw Object.assign(new Error('The shared dropped copy changed. Review both copies again.'), { stale: true });
      }
      let chosen;
      const workspace = await this.store.updateWorkspace(current => {
        if (!this.current(epoch) || current?.sourceHash !== identity.sourceHash
          || (current.collaborationAccountId && String(current.collaborationAccountId) !== identity.accountId)) throw staleError();
        chosen = W.resolveDroppedConflict(current, filepath, identity.language, choice, observed.shared);
        return current;
      }, identity.game);
      // Choosing an old copy does not approve publishing a previously rejected
      // promotion. Keep its saved text durable until a fresh explicit save.
      if (observed.operationId) await this.update((state, room) => {
        const pending = room.outbox.find(item => item.id === observed.operationId);
        if (pending) pending.status = 'needs_candidate_review';
      }, {}, epoch);
      await this.deliverDropped(workspace, [chosen], epoch);
      this.lastDroppedSync = 0; await this.retry();
      return { status: this.droppedConflicts[filepath] ? 'conflict' : this.lastError ? 'pending' : 'resolved' };
    }
    async syncDropped(epoch, { force = false } = {}) {
      if (!this.store.getWorkspace || !this.store.updateWorkspace) return;
      if (!force && Date.now() - this.lastDroppedSync < 20000) return;
      const identity = copy(this.room()?.identity);
      if (!identity) return;
      let workspace = await this.store.getWorkspace(identity.game);
      if (!this.current(epoch)) throw staleError();
      if (!workspace || (workspace.sourceHash && workspace.sourceHash !== identity.sourceHash)) return;
      this.droppedConflicts = copy(workspace.droppedConflicts?.[identity.language] || {});
      const pending = (workspace.droppedOutbox || []).filter(operation => !operation.conflict && operation.candidate?.game === identity.game
        && operation.candidate?.language === identity.language);
      const apply = async (records, options = {}) => {
        workspace = await this.receiveDropped(records, epoch, options);
      };
      for (const operation of pending) {
        const candidate = operation.candidate;
        if ((!/^[a-f0-9]{64}$/.test(candidate.originSourceHash || '') && !(candidate.originSourceHash === '' && candidate.originSourceAvailable === false))
          || !/^[a-f0-9]{64}$/.test(candidate.targetSourceHash || ''))
          throw Object.assign(new Error('A preserved translation has no verified source version. Import the matching original ZIP to upload it; its local recovery copy is safe.'), { code: 'CANDIDATE_SOURCE_UNAVAILABLE' });
        const alias = workspace.droppedAliases?.[operation.id];
        const resolved = alias && alias.fromRevision === Number(operation.revision || 0) ? alias : candidate;
        let response;
        try {
        if (operation.kind === 'discard') response = await this.api('/dropped/' + encodeURIComponent(resolved.id) + '/discard',
          { method: 'POST', body: { revision: Number(resolved.revision) || 0 } }, epoch);
        else response = await this.api('/dropped', { method: 'PUT', body: {
          game: candidate.game, language: candidate.language, filepath: candidate.filepath,
          originSourceHash: candidate.originSourceHash, targetSourceHash: candidate.targetSourceHash,
          targetSourceHashes: [...new Set([...(candidate.targetSourceHashes || []), candidate.targetSourceHash].filter(Boolean))],
          snapshot: copy(candidate.snapshot), baseRevision: Number(candidate.revision) || 0,
          // Only the original user action may start a new generation. Peer
          // retargeting and provenance uploads must use ordinary deduplication.
          ...(candidate.recoveryId && operation.id === candidate.recoveryId ? { recoveryId: candidate.recoveryId } : {}),
          ...(operation.replace ? { replace: true } : {}),
          reason: candidate.reason || 'Source changed', originSourceAvailable: candidate.originSourceAvailable !== false,
          ...(candidate.baseline ? { baseline: copy(candidate.baseline), proof: copy(candidate.proof), originArchive: copy(candidate.originArchive) } : {}),
        } }, epoch);
        } catch (error) {
          if (error.code !== 'CANDIDATE_CONFLICT') throw error;
          workspace = await this.retainDroppedConflict(error, operation, operation.kind === 'discard' ? 'discard' : 'upload', epoch);
          continue;
        }
        if (!response?.candidate) throw new Error('Dropped translation response is incomplete.');
        await apply([response.candidate], { acknowledge: true, acknowledgeKind: operation.kind, acknowledgeId: operation.id });
      }
      if (force || pending.length || Date.now() - this.lastDroppedSync >= 20000) {
        const params = new URLSearchParams({ game: identity.game, language: identity.language, includeResolved: '1' });
        const result = await this.api('/dropped?' + params, {}, epoch);
        await apply(result.candidates || result.items || result.records || []);
        this.lastDroppedSync = Date.now();
      }
    }
    startPresence(epoch) {
      if (!this.current(epoch) || !this.room()?.roomId || !this.WebSocket || this.socket || this.socketOpening?.epoch === epoch) return;
      this.openSocket(epoch).catch(error => {
        if (error.stale || !this.current(epoch)) return;
        this.presenceError = error; this.disconnected = true;
        if (!this.lastError) this.reportPresenceError();
        this.notify();
        if (transient(error)) this.schedule();
        else if ([401, 403].includes(error.status)) this.closeSocket();
      });
    }
    handleError(error) {
      this.lastError = error;
      if (!this.socket || this.socket.readyState !== 1) this.connected = false;
      this.status(transient(error) ? 'Offline · local changes are safe and pending sync' : error.message, true);
      this.notify();
      if (transient(error)) this.schedule();
      else if ([401, 403].includes(error.status)) this.closeSocket();
    }
    schedule() {
      if (this.timer || this.destroyed || !this.key) return;
      this.timer = setTimeout(() => { this.timer = null; this.retry(); }, this.backoff);
      this.timer.unref?.(); this.backoff = Math.min(this.backoff * 2, 30000);
    }
    async catchUp(epoch) {
      const room = this.room();
      let more;
      do {
        let result;
        try { result = await this.api('/rooms/' + encodeURIComponent(room.roomId) + '/changes?after=' + this.room().sequence, {}, epoch); }
        catch (error) {
          if (error.code !== 'CURSOR_INVALID') throw error;
          await this.acceptSnapshot(await this.api('/rooms/' + encodeURIComponent(room.roomId) + '/snapshot', {}, epoch), epoch, true);
          return;
        }
        if (result.resetRequired || result.snapshotRequired) {
          await this.acceptSnapshot(await this.api('/rooms/' + encodeURIComponent(room.roomId) + '/snapshot', {}, epoch), epoch);
          return;
        }
        const events = result.events || [];
        const changed = events.flatMap(event => event.files || []);
        if (events.length) {
          await this.update((state, current) => {
            for (const event of events) {
              if (event.sequence <= current.sequence) continue;
              this.preserveCarried(current, event.files || []);
              for (const file of event.files || []) if (!current.shared[file.filepath] || file.revision >= current.shared[file.filepath].revision) current.shared[file.filepath] = fileState(file);
              current.sequence = event.sequence;
            }
            this.rebuild(current);
          }, { projectWorkspace: this.projection(changed, epoch) }, epoch);
          await this.onRemote(this.remoteFiles(changed));
          if (!this.current(epoch)) throw staleError();
        }
        more = result.hasMore;
        if (more && !events.length) throw new Error('Collaboration change cursor did not advance.');
      } while (more);
    }
    async flush(epoch) {
      const blocked = new Set();
      // The snapshot of IDs bounds this pass; newly queued saves trigger a later pass.
      const ids = this.room().outbox.map(op => op.id);
      for (const id of ids) {
        const op = this.room().outbox.find(item => item.id === id);
        if (!op) continue;
        const paths = op.files.map(entry => entry.yours.filepath);
        if (['conflict', 'candidate_conflict', 'needs_candidate_review'].includes(op.status) || paths.some(path => blocked.has(path))) {
          if (!['conflict', 'candidate_conflict', 'needs_candidate_review'].includes(op.status) && !op.blockedByConflict) await this.update((state, room) => {
            room.outbox.find(item => item.id === id).blockedByConflict = true;
          }, {}, epoch);
          paths.forEach(path => blocked.add(path)); continue;
        }
        for (let attempt = 0; attempt < 4; attempt++) {
          await this.prepare(id, epoch);
          const current = this.room().outbox.find(item => item.id === id);
          if (!current || ['conflict', 'candidate_conflict', 'needs_candidate_review'].includes(current.status)) { paths.forEach(path => blocked.add(path)); break; }
          try {
            this.onWork({ key: 'upload', label: 'Saving translations to shared workspace', active: true });
            const result = await this.sendMutation(current, epoch);
            const accepted = result.files || result.snapshot?.files;
            if (!Array.isArray(accepted)) throw new Error('Mutation response has no committed file states.');
            await this.update((state, room) => {
              this.preserveCarried(room, accepted);
              for (const file of accepted) if (!room.shared[file.filepath] || file.revision >= room.shared[file.filepath].revision) room.shared[file.filepath] = fileState(file);
              room.outbox = room.outbox.filter(item => item.id !== id);
              room.conflicts = room.conflicts.filter(conflict => conflict.mutationId !== id);
              // A mutation reply may skip commits by other users, so do not advance
              // the replay cursor here. Only ordered catch-up events can do that.
              this.rebuild(room);
            }, { projectWorkspace: this.projection(accepted, epoch) }, epoch);
            if (result.candidate) await this.receiveDropped([result.candidate], epoch);
            await this.onRemote(this.remoteFiles(accepted));
            if (!this.current(epoch)) throw staleError();
            break;
          } catch (error) {
            if (error.code === 'CANDIDATE_CONFLICT' && current.promoteDropped && this.store.updateWorkspace) {
              await this.retainDroppedConflict(error, current, 'promotion', epoch);
              paths.forEach(path => blocked.add(path)); break;
            }
            if (error.status !== 409 || (error.code && error.code !== 'REVISION_CONFLICT')) throw error;
            const latest = error.current?.files ? error.current : await this.api('/rooms/' + encodeURIComponent(this.room().roomId) + '/snapshot', {}, epoch);
            await this.update((state, room) => {
              for (const file of latest.files) if (!room.shared[file.filepath] || file.revision >= room.shared[file.filepath].revision) room.shared[file.filepath] = fileState(file);
              const pending = room.outbox.find(item => item.id === id);
              if (pending) { delete pending.wire; delete pending.upload; }
              this.rebuild(room);
            }, { projectWorkspace: this.projection(latest.files, epoch) }, epoch);
            if (attempt === 3) this.schedule();
          } finally {
            if (epoch === this.epoch) this.onWork({ key: 'upload', active: false });
          }
        }
      }
    }
    async prepare(id, epoch) {
      const workspace = this.store.getWorkspace ? await this.store.getWorkspace(this.room()?.identity.game) : null;
      if (!this.current(epoch)) throw staleError();
      const observed = this.room().outbox.find(op => op.id === id);
      const existingConflict = observed?.promoteDropped && workspace?.droppedConflicts?.[this.room().identity.language]?.[observed.files[0].yours.filepath];
      if (existingConflict && !['candidate_conflict', 'needs_candidate_review'].includes(observed.status)) {
        await this.retainDroppedConflict({ current: existingConflict.shared }, observed, 'promotion', epoch); return;
      }
      await this.update((state, room) => {
        const op = room.outbox.find(item => item.id === id);
        if (!op || ['conflict', 'candidate_conflict', 'needs_candidate_review'].includes(op.status)) return;
        const candidateConflict = op.promoteDropped && workspace?.droppedConflicts?.[room.identity.language]?.[op.files[0].yours.filepath];
        if (candidateConflict) { op.status = 'candidate_conflict'; delete op.wire; delete op.upload; return; }
        if (op.wire) return;
        delete op.blockedByConflict;
        const files = []; const conflicts = [];
        let incorporatedRemoteEntries = false;
        for (const entry of op.files) {
          const shared = room.shared[entry.yours.filepath] || (room.mode === 'sparse' && this.baselineStates[entry.yours.filepath]);
          const merged = mergeFile(entry.base, entry.yours, shared);
          if (entry.base && !P.equal(merged.file.translations, entry.yours.translations)) incorporatedRemoteEntries = true;
          // Confirm unchanged approves the exact translation the reviewer saw.
          // A fresh review is required even if an ordinary text merge is possible.
          if ((op.promoteDropped || ['confirm', 'confirm_unchanged', 'restore'].includes(op.origin)) && entry.base
            && (entry.base.revision !== shared.revision || !P.equal(entry.base.translations, shared.translations))) {
            merged.conflict = true;
            merged.indexes = shared.translations.map((text, index) => text !== entry.base.translations[index] ? index : -1).filter(index => index >= 0);
          }
          if (merged.conflict) conflicts.push({ id: id + ':' + shared.filepath, mutationId: id, filepath: shared.filepath,
            kind: op.kind || 'edit', base: copy(entry.base), yours: copy(entry.yours), shared: copy(shared), indexes: merged.indexes, metadata: merged.metadata });
          files.push({ filepath: shared.filepath, baseRevision: shared.revision, translations: merged.file.translations,
            needsReview: merged.file.needsReview, trackedForExport: merged.file.trackedForExport,
            ...(room.mode === 'sparse' && shared.revision === 0 ? { baseline: P.witness(this.baselineFiles.get(shared.filepath)),
              proof: P.baselineProof(this.baselineTree, shared.filepath) } : {}) });
        }
        room.conflicts = room.conflicts.filter(conflict => conflict.mutationId !== id).concat(conflicts);
        if (conflicts.length) op.status = 'conflict';
        else {
          const alias = workspace?.droppedAliases?.[op.promoteDropped?.id];
          const promotion = op.promoteDropped && alias && alias.fromRevision === Number(op.promoteDropped.revision || 0)
            ? { ...op.promoteDropped, id: alias.id, revision: alias.revision } : op.promoteDropped;
          op.wire = { mutationId: id,
            origin: op.historyOrigin || (op.origin === 'save' && incorporatedRemoteEntries ? 'merge' : op.origin), files,
            ...(promotion ? { promoteDropped: { ...copy(promotion), targetSourceHash: room.identity.sourceHash } } : {}) };
        }
      }, this.store.updateWorkspace ? { projectWorkspace: (latest, state) => {
        const room = state.rooms[this.key];
        if (!this.current(epoch) || !latest || latest.sourceHash !== room.identity.sourceHash
          || (latest.collaborationAccountId && String(latest.collaborationAccountId) !== room.identity.accountId)) throw staleError();
        const op = room.outbox.find(item => item.id === id);
        if (op?.wire?.promoteDropped) {
          const alias = latest.droppedAliases?.[op.promoteDropped.id];
          op.wire.promoteDropped = alias && alias.fromRevision === Number(op.promoteDropped.revision || 0)
            ? { ...copy(op.promoteDropped), id: alias.id, revision: alias.revision, targetSourceHash: room.identity.sourceHash }
            : { ...copy(op.promoteDropped), targetSourceHash: room.identity.sourceHash };
        }
        return latest;
      } } : {}, epoch);
    }
    async sendMutation(op, epoch) {
      const path = '/rooms/' + encodeURIComponent(this.room().roomId);
      if (op.restore) return this.api(path + '/history/' + encodeURIComponent(op.restore.eventId) + '/restore', {
        method: 'POST', body: { mutationId: op.id, baseRevision: op.wire.files[0].baseRevision, version: op.restore.version,
          ...(op.wire.promoteDropped ? { promoteDropped: copy(op.wire.promoteDropped) } : {}) },
      }, epoch);
      const bytes = new TextEncoder().encode(JSON.stringify(op.wire)).length;
      if (bytes <= 500000 && op.wire.files.length <= 100) return this.api(path + '/mutations', { method: 'POST', body: op.wire }, epoch);
      let upload = op.upload;
      if (!upload || (upload.expiresAt && upload.expiresAt <= Date.now())) {
        const ticket = await this.api(path + '/uploads', { method: 'POST', body: { mutationId: op.id, origin: op.wire.origin, fileCount: op.wire.files.length,
          ...(op.wire.promoteDropped ? { promoteDropped: copy(op.wire.promoteDropped) } : {}) } }, epoch);
        upload = { id: ticket.uploadId || ticket.id, expiresAt: ticket.expiresAt };
        await this.update((state, room) => { room.outbox.find(item => item.id === op.id).upload = copy(upload); }, {}, epoch);
      }
      if (!upload.complete) {
        try { await this.uploadFiles(upload.id, op.wire.files, epoch); }
        catch (error) {
          if (error.code === 'UPLOAD_EXPIRED') await this.update((state, room) => { delete room.outbox.find(item => item.id === op.id).upload; }, {}, epoch);
          throw error;
        }
        await this.update((state, room) => { room.outbox.find(item => item.id === op.id).upload.complete = true; }, {}, epoch);
      }
      return this.api('/uploads/' + encodeURIComponent(upload.id) + '/finalize', { method: 'POST' }, epoch);
    }
    async resolve(conflictId, resolution, options = {}) {
      const epoch = this.epoch;
      const observed = copy(this.room()?.conflicts.find(item => item.id === conflictId));
      if (!observed) throw new Error('This comparison has already changed.');
      if (options.sharedRevision != null && options.sharedRevision !== observed.shared.revision) return { status: 'conflict', mutationId: observed.mutationId };
      try { await this.catchUp(epoch); } catch (error) { if (!transient(error)) throw error; }
      const chosen = fileState(Array.isArray(resolution) ? { ...observed.yours, translations: resolution } : { ...observed.yours, ...resolution });
      const source = this.sourceFiles.get(chosen.filepath);
      if (chosen.translations.length !== source.english.length) throw new Error('Resolve every translation entry before saving.');
      let renewed = false;
      await this.update((state, room) => {
        const conflict = room.conflicts.find(item => item.id === conflictId);
        if (!conflict) throw new Error('This comparison has already changed.');
        const op = room.outbox.find(item => item.id === conflict.mutationId);
        const entry = op.files.find(item => item.yours.filepath === conflict.filepath);
        const shared = room.shared[conflict.filepath] || (room.mode === 'sparse' && this.baselineStates[conflict.filepath]);
        const merged = mergeFile(observed.shared, chosen, shared);
        if (!merged.conflict && op.kind === 'join' && op.files.length === 1 && contentEqual(merged.file, shared)) {
          room.outbox = room.outbox.filter(item => item.id !== op.id);
          room.conflicts = room.conflicts.filter(item => item.mutationId !== op.id);
          this.rebuild(room);
          return;
        }
        entry.base = copy(shared); entry.yours = merged.file; delete op.wire; delete op.upload;
        // A custom conflict result is a new translation, while choosing the
        // original historical text keeps its restore provenance.
        if (op.restore && !P.equal(merged.file.translations, op.restore.translations)) { delete op.restore; op.origin = 'conflict_resolution'; }
        // Keep the initiating operation for review/restore validation, while
        // recording that a translator explicitly resolved this saved result.
        if (!op.restore) op.historyOrigin = 'conflict_resolution';
        if (merged.conflict) {
          renewed = true;
          Object.assign(conflict, { base: observed.shared, yours: chosen, shared: copy(shared), indexes: merged.indexes, metadata: merged.metadata });
        } else room.conflicts = room.conflicts.filter(item => item.id !== conflictId);
        op.status = room.conflicts.some(item => item.mutationId === op.id) ? 'conflict' : 'pending';
        this.rebuild(room);
      }, { projectWorkspace: this.projection([chosen], epoch), revisions: [{ filepath: chosen.filepath,
        lang: this.room().identity.language, sourceHash: this.room().identity.sourceHash,
        collaborationAccountId: this.room().identity.accountId, savedAt: Date.now(),
        note: 'Resolve shared translation conflict', translations: copy(chosen.translations),
        isMissing: chosen.translations.some(text => !text.trim()) }] }, epoch);
      await this.onRemote([copy(this.room().local[chosen.filepath])]);
      if (!this.current(epoch)) throw staleError();
      if (!renewed) await this.retry();
      const remaining = this.room().outbox.find(item => item.id === observed.mutationId);
      return { status: !remaining ? 'synced' : remaining.status === 'conflict' ? 'conflict' : 'pending', mutationId: observed.mutationId };
    }
    async history(filepath, options = {}) {
      if (!this.room()?.roomId) return { events: [], hasMore: false };
      const params = new URLSearchParams({ filepath, limit: String(options.limit || 50) });
      if (options.cursor || options.before) params.set('cursor', String(options.cursor || options.before));
      const result = await this.api('/rooms/' + encodeURIComponent(this.room().roomId) + '/history?' + params);
      if (this.room().mode !== 'sparse' || result.nextCursor || result.nextBefore || result.hasMore) return result;
      const baseline = this.baselineHistory(filepath);
      return { ...result, items: [...(result.items || []), ...(baseline ? [baseline] : [])] };
    }
    baselineHistory(filepath) {
      const state = this.baselineStates?.[filepath];
      if (!state || this.room()?.mode !== 'sparse') return null;
      return { id: 'local-baseline:' + encodeURIComponent(filepath), local: true, origin: 'imported_baseline', actorName: 'Original ZIP',
        filepath, revision: 0, currentRevision: this.sharedBase(filepath).revision, before: null, after: copy(state), current: this.sharedBase(filepath) };
    }
    recoveryFiles(filepath) {
      return copy((this.room()?.recovery || []).flatMap(entry => (entry.files || []).filter(file => file.filepath === filepath)
        .map(file => ({ ...file, recoveryId: entry.id, savedAt: entry.at, note: entry.reason }))));
    }
    historyEntry(id) {
      if (this.room()?.mode === 'sparse' && typeof id === 'string' && id.startsWith('local-baseline:')) return Promise.resolve(this.baselineHistory(decodeURIComponent(id.slice('local-baseline:'.length))));
      return this.api('/rooms/' + encodeURIComponent(this.room().roomId) + '/history/' + encodeURIComponent(id));
    }
    openSocket(epoch) {
      if (!this.current(epoch) || !this.room()?.roomId || !this.WebSocket || this.socket) return Promise.resolve();
      if (this.socketOpening?.epoch === epoch) return this.socketOpening.promise;
      const opening = { epoch, promise: null }; this.socketOpening = opening;
      opening.promise = this.createSocket(epoch, opening).catch(error => {
        if (!this.current(epoch) || this.socketOpening !== opening) throw staleError();
        throw error;
      }).finally(() => { if (this.socketOpening === opening) this.socketOpening = null; });
      return opening.promise;
    }
    async createSocket(epoch, opening) {
      const ticket = await this.api('/rooms/' + encodeURIComponent(this.room().roomId) + '/ticket', { method: 'POST' }, epoch);
      if (!this.current(epoch) || this.socketOpening !== opening) throw staleError();
      const url = new URL(ticket.url || ROOT + '/ws?ticket=' + encodeURIComponent(ticket.ticket), this.apiBase || globalThis.location?.href);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new this.WebSocket(url.href); this.socket = socket;
      socket.onopen = () => {
        if (!this.current(epoch) || this.socket !== socket) { socket.close(); return; }
        const recovered = !!this.presenceError; this.presenceError = null;
        this.connected = true; this.disconnected = false; this.backoff = 1000;
        if (recovered && !this.lastError) this.status('');
        this.notify(); this.send({ type: 'select', filepath: this.selected });
        this.send({ type: 'activity', away: this.away });
        this.heartbeat = setInterval(() => this.send({ type: 'heartbeat' }), 15000);
        this.heartbeat.unref?.();
        // Fetch after opening: commits between snapshot retrieval and subscribing
        // must not be lost even when nobody edits again.
        this.retry();
        if (this.editing) {
          const filepath = this.editing;
          this.claim(filepath).then(result => {
            if (!result.granted && this.current(epoch)) this.onEditingConflict({ filepath, peers: result.peers });
          }).catch(error => { if (this.current(epoch)) this.status(error.message, true); });
        }
      };
      socket.onmessage = event => {
        if (!this.current(epoch) || this.socket !== socket) return;
        let message; try { message = JSON.parse(event.data); } catch (_) { return; }
        if (message.type === 'presence') {
          const peers = message.peers || [], sessionId = message.selfId || message.sessionId || this.sessionId;
          if (sessionId === this.sessionId && P.equal(peers, this.peers)) return;
          this.peers = peers; this.sessionId = sessionId; this.notify();
        } else if (message.type === 'welcome') { this.sessionId = message.sessionId; this.notify(); }
        else if (message.type === 'claim-result') {
          const pending = this.claims.get(message.requestId);
          if (pending) { clearTimeout(pending.timer); this.claims.delete(message.requestId); if (message.granted) this.editing = pending.filepath; pending.resolve({ granted: !!message.granted, peers: message.peers || [] }); }
        } else if (message.type === 'changed' && (!Number.isSafeInteger(message.sequence) || message.sequence > (this.room()?.sequence || 0))) { this.retry(); }
        else if (message.type === 'dropped_changed' && message.game === this.room()?.identity.game && message.language === this.room()?.identity.language) {
          this.lastDroppedSync = 0; this.retry();
        }
      };
      socket.onerror = () => { /* onclose drives retry and clears obsolete claims. */ };
      socket.onclose = () => {
        if (this.socket !== socket) return;
        this.disconnected = true;
        this.closeSocket();
        if (this.current(epoch)) this.schedule();
      };
    }
    send(message) {
      if (this.socket?.readyState !== 1) return false;
      this.socket.send(JSON.stringify(message)); return true;
    }
    select(filepath) { this.selected = filepath || null; this.send({ type: 'select', filepath: this.selected }); }
    setAway(value) {
      const away = !!value;
      if (away === this.away) return;
      this.away = away;
      this.send({ type: 'activity', away });
      this.notify();
    }
    editingPeers(filepath) { return this.peers.filter(peer => peer.sessionId !== this.sessionId && peer.editing === filepath); }
    isEditing(filepath) { return this.editingPeers(filepath).length > 0; }
    claim(filepath, { force = false } = {}) {
      if (!this.socket || !this.connected) { this.editing = filepath; return Promise.resolve({ granted: true, peers: [], offline: true }); }
      const requestId = this.uuid();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { this.claims.delete(requestId); reject(new Error('Could not confirm editing availability. Try again.')); }, 8000);
        timer.unref?.(); this.claims.set(requestId, { resolve, reject, timer, filepath });
        if (!this.send({ type: 'claim', requestId, filepath, force })) {
          clearTimeout(timer); this.claims.delete(requestId); resolve({ granted: true, peers: [], offline: true });
        }
      });
    }
    leaveEdit() { this.editing = null; this.send({ type: 'release' }); }
    closeSocket() {
      this.socketOpening = null;
      const socket = this.socket; this.socket = null;
      if (socket) { socket.onclose = null; socket.close(); }
      clearInterval(this.heartbeat); this.heartbeat = null;
      for (const claim of this.claims.values()) { clearTimeout(claim.timer); claim.reject(new Error('Collaboration connection closed. Try opening the file again.')); }
      this.claims.clear(); this.connected = false; this.peers = []; this.sessionId = null; this.notify();
    }
    disconnect() {
      this.droppedConflicts = {}; this.lastDroppedSync = 0;
      this.epoch++; clearTimeout(this.timer); this.timer = null;
      this.onWork({ key: 'source', active: false });
      this.onWork({ key: 'upload', active: false });
      this.disconnected = false; this.hashing = false; this.presenceError = null; this.lastError = null;
      this.closeSocket(); this.key = null; this.running = null; this.selected = null; this.editing = null; this.notify();
    }
    destroy() { this.disconnect(); this.destroyed = true; }
  }
  return { Client };
});
