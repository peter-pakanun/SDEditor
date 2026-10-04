/* Durable translation synchronization. Presence is ephemeral; committed text is not. */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./collaborationProtocol.js') : root.CollaborationProtocol);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CollaborationSync = api;
})(typeof window === 'object' ? window : this, function (P) {
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
      this.onStatus = options.onStatus || (() => {});
      this.onEditingConflict = options.onEditingConflict || (() => {});
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
    }
    current(epoch) { return !this.destroyed && epoch === this.epoch && !!this.key; }
    room() { return this.state?.rooms?.[this.key] || null; }
    snapshot({ includeFiles = true } = {}) {
      const room = this.room();
      return { identity: copy(room?.identity || null), roomId: room?.roomId || null,
        connected: this.connected, disconnected: this.disconnected, hashing: this.hashing, pending: room?.outbox?.length || 0,
        conflicts: copy(room?.conflicts || []), ...(includeFiles ? { files: Object.values(copy(room?.local || {})) } : {}),
        peers: copy(this.peers), sessionId: this.sessionId, away: this.away, sequence: room?.sequence || 0 };
    }
    notify() { this.onChange(this.snapshot({ includeFiles: false })); }
    status(message, error = false) { this.onStatus({ message, error }); }
    fileBase(filepath) {
      let file = this.room()?.local[filepath] || null;
      for (const batch of this.stagedSaves.values()) if (batch.collaboration?.key === this.key) {
        file = batch.files.find(item => item.filepath === filepath) || file;
      }
      return copy(file);
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
      if (ack.duplicate) room.outbox = room.outbox.filter(operation => operation.id !== batch.jobId);
      if (ack.operation && !room.outbox.some(operation => operation.id === ack.operation.id)) room.outbox.push(copy(ack.operation));
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
    async connect({ accountId, game, language, source, files, workspace }) {
      this.disconnect(); this.destroyed = false;
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
        manifest = P.manifest(source);
        sourceHash = await P.sourceHash(manifest);
        if (epoch !== this.epoch) throw staleError();
      } finally {
        if (epoch === this.epoch) { this.hashing = false; this.notify(); }
      }
      const identity = { accountId: String(accountId), game, sourceHash, language };
      this.key = scopeKey(identity); this.context = this.getContext(); this.source = copy(source);
      this.sourceFiles = new Map(manifest.files.map(file => [file.filepath, file]));
      const incoming = byPath(files.map(file => {
        const original = this.sourceFiles.get(file.filepath);
        if (!original) throw new Error('Saved file is absent from the source: ' + file.filepath);
        return fileState(file, original.english.length);
      }));
      for (const original of manifest.files) if (!incoming[original.filepath]) {
        incoming[original.filepath] = fileState({ filepath: original.filepath, translations: [] }, original.english.length);
      }
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
        const current = copy(stored || workspace);
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
      return this.snapshot();
    }
    async initializeRoom(epoch) {
      const room = this.room();
      const identity = { game: room.identity.game, sourceHash: room.identity.sourceHash, language: room.identity.language };
      let snapshot;
      try { snapshot = await this.api('/join', { method: 'POST', body: identity }, epoch); }
      catch (error) {
        if (error.status !== 404) throw error;
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
        for (const file of files) if (statuses[file.filepath]) latest.status[file.filepath] = {
          ...(latest.status[file.filepath] || {}), ...statuses[file.filepath],
        };
        const projected = this.projectWorkspace(latest, files.map(file => room.local[file.filepath]).filter(Boolean), identity.language, source, { mutate: true });
        projected.sourceHash = identity.sourceHash; projected.collaborationAccountId = identity.accountId;
        return projected;
      };
    }
    rebuild(room) {
      room.local = copy(room.shared);
      for (const operation of room.outbox) for (const entry of operation.files) {
        const shared = room.local[entry.yours.filepath];
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
        if (initial) {
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
        room.sequence = snapshot.sequence || 0;
        room.initialized = true;
        delete room.seedUpload;
        this.rebuild(room);
      }, { projectWorkspace: this.projection(files, epoch) }, epoch);
      this.onRemote(copy(Object.values(this.room().local)));
    }
    async save({ workspace, revisions = [], files, origin = 'save', bases = {}, restore, waitForSync = true }) {
      const epoch = this.epoch; const room = this.room();
      if (!room) throw new Error('Collaboration workspace is not connected.');
      if (!Array.isArray(files) || !files.length) throw new Error('A save must contain at least one file.');
      const mutationId = this.uuid();
      const normalized = files.map(file => {
        const original = this.sourceFiles.get(file.filepath);
        if (!original) throw new Error('Saved file is absent from the source: ' + file.filepath);
        return fileState(file, original.english.length);
      });
      if (new Set(normalized.map(file => file.filepath)).size !== normalized.length) throw new Error('A save contains duplicate files.');
      if (restore && (normalized.length !== 1 || !restore.eventId || !['before', 'after'].includes(restore.version))) throw new Error('Invalid shared history restore.');
      await this.update((state, current) => {
        current.outbox.push({ id: mutationId, origin, ...(restore ? { restore: { ...copy(restore), translations: copy(normalized[0].translations) } } : {}), status: 'pending', files: normalized.map(yours => ({
          base: copy(Object.hasOwn(bases, yours.filepath) ? bases[yours.filepath] : current.local[yours.filepath] || null), yours })) });
        for (const yours of normalized) current.local[yours.filepath] = copy(yours);
      }, { revisions: revisions.map(revision => ({ ...copy(revision), sourceHash: room.identity.sourceHash,
        collaborationAccountId: room.identity.accountId })), projectWorkspace: this.projection(normalized, epoch, workspace) }, epoch);
      if (!waitForSync) {
        // Workspace, history and outbox are durable. Let editor saves finish even
        // while a slow request or another tab holds the synchronization lock.
        this.retry().catch(error => {
          if (this.current(epoch) && !error.stale) this.handleError(error);
        });
        return { status: 'pending', mutationId };
      }
      await this.retry();
      if (!this.current(epoch)) throw staleError();
      if (this.lastError && !transient(this.lastError)) throw this.lastError;
      const remaining = this.room()?.outbox.find(op => op.id === mutationId);
      if (remaining?.status === 'pending') this.schedule();
      return { status: !remaining ? 'synced' : remaining.status === 'conflict' || remaining.blockedByConflict ? 'conflict' : 'pending', mutationId };
    }
    sync() { return this.retry(); }
    retry() {
      const epoch = this.epoch;
      if (!this.current(epoch)) return Promise.resolve(this.snapshot());
      // Presence belongs to this browser, so it must not wait for another tab's
      // translation lock, catch-up requests or queued uploads.
      this.startPresence(epoch);
      if (this.running) { this.dirty = true; return this.running; }
      const run = async () => {
        try {
          if (!this.current(epoch)) throw staleError();
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
          else this.status('');
        } catch (error) {
          if (!error.stale && this.current(epoch)) this.handleError(error);
        }
        return this.snapshot();
      };
      const promise = this.locks ? this.locks.request('sdeditor-collaboration:' + this.key, run) : run();
      this.running = promise.finally(() => { if (this.running === tracked) this.running = null; });
      const tracked = this.running;
      return tracked;
    }
    reportPresenceError() {
      this.status(transient(this.presenceError) ? 'Collaboration disconnected · reconnecting automatically' : this.presenceError.message, true);
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
              for (const file of event.files || []) if (!current.shared[file.filepath] || file.revision >= current.shared[file.filepath].revision) current.shared[file.filepath] = fileState(file);
              current.sequence = event.sequence;
            }
            this.rebuild(current);
          }, { projectWorkspace: this.projection(changed, epoch) }, epoch);
          this.onRemote(changed.map(file => copy(this.room().local[file.filepath])));
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
        if (op.status === 'conflict' || paths.some(path => blocked.has(path))) {
          if (op.status !== 'conflict' && !op.blockedByConflict) await this.update((state, room) => {
            room.outbox.find(item => item.id === id).blockedByConflict = true;
          }, {}, epoch);
          paths.forEach(path => blocked.add(path)); continue;
        }
        for (let attempt = 0; attempt < 4; attempt++) {
          await this.prepare(id, epoch);
          const current = this.room().outbox.find(item => item.id === id);
          if (!current || current.status === 'conflict') { paths.forEach(path => blocked.add(path)); break; }
          try {
            const result = await this.sendMutation(current, epoch);
            const accepted = result.files || result.snapshot?.files;
            if (!Array.isArray(accepted)) throw new Error('Mutation response has no committed file states.');
            await this.update((state, room) => {
              for (const file of accepted) if (!room.shared[file.filepath] || file.revision >= room.shared[file.filepath].revision) room.shared[file.filepath] = fileState(file);
              room.outbox = room.outbox.filter(item => item.id !== id);
              room.conflicts = room.conflicts.filter(conflict => conflict.mutationId !== id);
              // A mutation reply may skip commits by other users, so do not advance
              // the replay cursor here. Only ordered catch-up events can do that.
              this.rebuild(room);
            }, { projectWorkspace: this.projection(accepted, epoch) }, epoch);
            this.onRemote(accepted.map(file => copy(this.room().local[file.filepath])));
            break;
          } catch (error) {
            if (error.status !== 409 || (error.code && error.code !== 'REVISION_CONFLICT')) throw error;
            const latest = error.current?.files ? error.current : await this.api('/rooms/' + encodeURIComponent(this.room().roomId) + '/snapshot', {}, epoch);
            await this.update((state, room) => {
              for (const file of latest.files) if (!room.shared[file.filepath] || file.revision >= room.shared[file.filepath].revision) room.shared[file.filepath] = fileState(file);
              const pending = room.outbox.find(item => item.id === id);
              if (pending) { delete pending.wire; delete pending.upload; }
              this.rebuild(room);
            }, { projectWorkspace: this.projection(latest.files, epoch) }, epoch);
            if (attempt === 3) this.schedule();
          }
        }
      }
    }
    async prepare(id, epoch) {
      await this.update((state, room) => {
        const op = room.outbox.find(item => item.id === id);
        if (!op || op.wire || op.status === 'conflict') return;
        delete op.blockedByConflict;
        const files = []; const conflicts = [];
        let incorporatedRemoteEntries = false;
        for (const entry of op.files) {
          const shared = room.shared[entry.yours.filepath];
          const merged = mergeFile(entry.base, entry.yours, shared);
          if (entry.base && !P.equal(merged.file.translations, entry.yours.translations)) incorporatedRemoteEntries = true;
          // Confirm unchanged approves the exact translation the reviewer saw.
          // A fresh review is required even if an ordinary text merge is possible.
          if (['confirm', 'confirm_unchanged', 'restore'].includes(op.origin) && entry.base
            && (entry.base.revision !== shared.revision || !P.equal(entry.base.translations, shared.translations))) {
            merged.conflict = true;
            merged.indexes = shared.translations.map((text, index) => text !== entry.base.translations[index] ? index : -1).filter(index => index >= 0);
          }
          if (merged.conflict) conflicts.push({ id: id + ':' + shared.filepath, mutationId: id, filepath: shared.filepath,
            kind: op.kind || 'edit', base: copy(entry.base), yours: copy(entry.yours), shared: copy(shared), indexes: merged.indexes, metadata: merged.metadata });
          files.push({ filepath: shared.filepath, baseRevision: shared.revision, translations: merged.file.translations,
            needsReview: merged.file.needsReview, trackedForExport: merged.file.trackedForExport });
        }
        room.conflicts = room.conflicts.filter(conflict => conflict.mutationId !== id).concat(conflicts);
        if (conflicts.length) op.status = 'conflict';
        else op.wire = { mutationId: id,
          origin: op.historyOrigin || (op.origin === 'save' && incorporatedRemoteEntries ? 'merge' : op.origin), files };
      }, {}, epoch);
    }
    async sendMutation(op, epoch) {
      const path = '/rooms/' + encodeURIComponent(this.room().roomId);
      if (op.restore) return this.api(path + '/history/' + encodeURIComponent(op.restore.eventId) + '/restore', {
        method: 'POST', body: { mutationId: op.id, baseRevision: op.wire.files[0].baseRevision, version: op.restore.version },
      }, epoch);
      const bytes = new TextEncoder().encode(JSON.stringify(op.wire)).length;
      if (bytes <= 500000 && op.wire.files.length <= 100) return this.api(path + '/mutations', { method: 'POST', body: op.wire }, epoch);
      let upload = op.upload;
      if (!upload || (upload.expiresAt && upload.expiresAt <= Date.now())) {
        const ticket = await this.api(path + '/uploads', { method: 'POST', body: { mutationId: op.id, origin: op.wire.origin, fileCount: op.wire.files.length } }, epoch);
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
      const source = this.room().manifest.files.find(file => file.filepath === chosen.filepath);
      if (chosen.translations.length !== source.english.length) throw new Error('Resolve every translation entry before saving.');
      let renewed = false;
      await this.update((state, room) => {
        const conflict = room.conflicts.find(item => item.id === conflictId);
        if (!conflict) throw new Error('This comparison has already changed.');
        const op = room.outbox.find(item => item.id === conflict.mutationId);
        const entry = op.files.find(item => item.yours.filepath === conflict.filepath);
        const shared = room.shared[conflict.filepath];
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
      this.onRemote([copy(this.room().local[chosen.filepath])]);
      if (!renewed) await this.retry();
      const remaining = this.room().outbox.find(item => item.id === observed.mutationId);
      return { status: !remaining ? 'synced' : remaining.status === 'conflict' ? 'conflict' : 'pending', mutationId: observed.mutationId };
    }
    async history(filepath, options = {}) {
      if (!this.room()?.roomId) return { events: [], hasMore: false };
      const params = new URLSearchParams({ filepath, limit: String(options.limit || 50) });
      if (options.cursor || options.before) params.set('cursor', String(options.cursor || options.before));
      return this.api('/rooms/' + encodeURIComponent(this.room().roomId) + '/history?' + params);
    }
    historyEntry(id) { return this.api('/rooms/' + encodeURIComponent(this.room().roomId) + '/history/' + encodeURIComponent(id)); }
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
          this.peers = message.peers || []; this.sessionId = message.selfId || message.sessionId || this.sessionId; this.notify();
        } else if (message.type === 'welcome') { this.sessionId = message.sessionId; this.notify(); }
        else if (message.type === 'claim-result') {
          const pending = this.claims.get(message.requestId);
          if (pending) { clearTimeout(pending.timer); this.claims.delete(message.requestId); if (message.granted) this.editing = pending.filepath; pending.resolve({ granted: !!message.granted, peers: message.peers || [] }); }
        } else if (message.type === 'changed') { this.retry(); }
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
      this.epoch++; clearTimeout(this.timer); this.timer = null;
      this.disconnected = false; this.hashing = false; this.presenceError = null; this.lastError = null;
      this.closeSocket(); this.key = null; this.running = null; this.selected = null; this.editing = null; this.notify();
    }
    destroy() { this.disconnect(); this.destroyed = true; }
  }
  return { Client };
});
