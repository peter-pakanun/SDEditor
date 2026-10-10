/* IndexedDB v10: durable facts are records; aggregate objects are read views. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NormalizedStore = api;
})(typeof window === 'object' ? window : typeof self === 'object' ? self : globalThis, function () {
  'use strict';
  const stores = {
    meta: 'translation_workspaces', baseline: 'baseline_files', assets: 'baseline_assets',
    files: 'workspace_files', records: 'workspace_records', drafts: 'translation_drafts',
    rooms: 'collaboration_rooms', shared: 'collaboration_files', operations: 'collaboration_operations',
    roomRecords: 'collaboration_records', submissions: 'save_submissions', receipts: 'save_receipts', migration: 'storage_migrations',
    tmUnits: 'tm_units', tmOutbox: 'tm_outbox', tmMeta: 'tm_meta', tmRecords: 'tm_records',
  };
  const names = Object.values(stores);
  const tmStores = [stores.tmUnits, stores.tmOutbox, stores.tmMeta, stores.tmRecords];
  const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(name => [name, canonical(value[name])])) : value;
  const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
  // Accepted file identity contains every original language and entry field.
  // Parser/UI decorations such as isMissing depend on the selected language.
  const baselineFile = file => ({ filepath: file?.filepath, name: file?.name == null ? '' : file.name,
    stats: file?.stats, variables: file?.variables, remarks: file?.remarks, translations: file?.translations });
  const sameBaselineFile = (a, b) => same(baselineFile(a), baselineFile(b));
  function sameBaselineSource(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    if (new Set(a.map(file => file.filepath)).size !== a.length || new Set(b.map(file => file.filepath)).size !== b.length) return false;
    const files = source => source.map(baselineFile).sort((left, right) => left.filepath < right.filepath ? -1 : left.filepath > right.filepath ? 1 : 0);
    return same(files(a), files(b));
  }
  async function fingerprint(value) {
    const bytes = new TextEncoder().encode(JSON.stringify(canonical(value)));
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  const key = (...parts) => JSON.stringify(parts);
  const contentScope = scope => scope?.groupId ? { versionId: String(scope.versionId || ''), groupId: String(scope.groupId) } : {};
  const contentParts = scope => scope?.groupId ? [contentScope(scope)] : [];
  const sameContentScope = (left, right) => (left?.groupId || '') === (right?.groupId || '') && (left?.versionId || '') === (right?.versionId || '');
  const scopeKey = scope => key(scope.accountId || 'guest', scope.game, scope.branchId || 'default', scope.sourceHash || '', ...contentParts(scope));
  const baselineKey = scope => key(scope.game, scope.sourceHash || '');
  const request = req => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
  const done = tx => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(tx.error || new Error('Storage transaction aborted.')); });
  function upgrade(db, tx) {
    for (const name of names) {
      const store = db.objectStoreNames.contains(name) ? tx.objectStore(name) : db.createObjectStore(name, { keyPath: 'key' });
      if (!store.indexNames.contains('by_scope')) store.createIndex('by_scope', 'scope');
      if ([stores.records, stores.shared, stores.files].includes(name) && !store.indexNames.contains('by_path')) store.createIndex('by_path', 'pathKey');
      if ([stores.records, stores.roomRecords, stores.tmRecords, stores.tmOutbox].includes(name) && !store.indexNames.contains('by_kind')) store.createIndex('by_kind', 'kindScope');
      if ([stores.operations, stores.roomRecords, stores.submissions].includes(name) && !store.indexNames.contains('by_path')) store.createIndex('by_path', 'paths', { multiEntry: true });
      if (name === stores.drafts && !store.indexNames.contains('by_profile_lang')) store.createIndex('by_profile_lang', 'profileLanguage');
      if (name === stores.drafts && !store.indexNames.contains('by_scope_language')) store.createIndex('by_scope_language', 'scopeLanguage');
      if (name === stores.tmUnits && !store.indexNames.contains('by_identity')) store.createIndex('by_identity', 'identityScope', { unique: true });
    }
  }
  function create(dependencies) {
    const { openDb, W, legacyGet, workspaceKey, sourceKey, receiptKey, revisionStoreName, scopedRevision, normalizeScope, legacyBaseline } = dependencies;
    const migrations = new Map();
    let migrationSequence = 0;
    async function trackMigration(kind, identity, scope, action) {
      const now = () => typeof performance === 'object' ? performance.now() : Date.now();
      const started = now(), id = key(kind, identity, ++migrationSequence);
      const emit = (state) => {
        // A presentation callback must never affect durable conversion.
        try { dependencies.onMigration?.({ id, kind, scope: copy(scope), state, durationMs: now() - started }); }
        catch (_) {}
      };
      emit('started');
      try { const result = await action(); emit('completed'); return result; }
      catch (error) { emit('failed'); throw error; }
    }
    const row = (scope, id, value, extra = {}) => ({ key: key(scope, id), scope, value: copy(value), ...extra });
    const tmScope = scope => {
      const profile = String(scope?.profile || scope?.accountId || 'guest'), language = String(scope?.language || '');
      if (!language) throw new TypeError('Translation Memory requires a selected language.');
      return { profile, language, key: key(profile, language) };
    };
    const tmGuard = options => { if (options?.guard && !options.guard()) throw Object.assign(new Error('Translation Memory account or language changed.'), { stale: true }); };
    const tmCore = () => {
      const core = dependencies.tmRuntime?.();
      if (!core) throw new Error('Translation Memory is unavailable. Reload SDEditor.');
      return core;
    };
    const tmIdentity = unit => tmCore().identityFor(unit);
    const tmId = identity => {
      const hashes = [2166136261, 2246822519, 3266489917, 668265263];
      for (let i = 0; i < identity.length; i++) for (let j = 0; j < hashes.length; j++) hashes[j] = Math.imul(hashes[j] ^ (identity.charCodeAt(i) + j), 16777619);
      return 'tm-' + hashes.map(value => (value >>> 0).toString(16).padStart(8, '0')).join('');
    };
    const tmContent = unit => unit && ({ source: unit.source, target: unit.target, gameScope: unit.gameScope, context: unit.context, note: unit.note || '', enabled: unit.enabled !== false });
    const tmRequestBytes = 900 * 1024;
    const tmEncodedBytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
    const tmWireUnit = input => {
      const unit=copy(input);
      for(const field of ['revision','localRevision','language','updatedAt','author']) delete unit[field];
      return unit;
    };
    const sameTm = (a, b) => same(tmContent(a), tmContent(b)) && !!a?.deleted === !!b?.deleted;
    const tmView = record => record && ({ ...copy(record.unit), revision: Number(record.base?.revision || 0), localRevision: record.localRevision || 0,
      ...(record.deleted ? { deleted: true, suppressed: true } : {}) });
    const tmRow = (scope, record) => row(scope.key, record.unit.id, record, { identityScope: key(scope.key, tmIdentity(record.unit)) });
    const tmPendingKey = id => 'pending:' + id;
    const tmRecord = (scope, id, value) => row(scope.key, id, value, { kindScope: key(scope.key, value.kind) });
    const tmRecordsOf = async (tx, scope, kind) => (await request(tx.objectStore(stores.tmRecords).index('by_kind').getAll(key(scope.key, kind))));
    const tmUuid = () => globalThis.crypto?.randomUUID?.() || 'tm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    async function tmFind(tx, scope, unit, options = {}) {
      const identity = tmIdentity(unit), byId = unit.id && await get(tx, stores.tmUnits, key(scope.key, unit.id));
      if (byId && tmIdentity(byId.unit) !== identity) {
        if (options.allowIdentityChange) return byId;
        if (options.collisionFallback) return (await request(tx.objectStore(stores.tmUnits).index('by_identity').get(key(scope.key, identity))))?.value;
        throw new Error('A Translation Memory ID was reused for another source or context.');
      }
      return byId || (await request(tx.objectStore(stores.tmUnits).index('by_identity').get(key(scope.key, identity))))?.value;
    }
    function tmHistory(tx, scope, before, after, origin, eventId) {
      tx.objectStore(stores.tmRecords).put(tmRecord(scope, 'history:' + eventId, { kind: 'history', id: eventId, unitId: (after || before).id,
        before: copy(before), after: copy(after), origin, createdAt: Date.now() }));
    }
    async function tmCapture(tx, rawScope, rawUnits, options = {}) {
      const scope = tmScope(rawScope); tmGuard(options);
      const mutationId = options.mutationId || tmUuid(), marker = 'capture:' + mutationId;
      if (await get(tx, stores.tmRecords, key(scope.key, marker))) return false;
      const meta = await get(tx, stores.tmMeta, scope.key) || { revision: 0, bootstrapped: false, localVersion: 0 };
      let changed = false;
      for (const raw of rawUnits || []) {
        const normalized = tmCore().normalizeUnit({ ...raw, language: scope.language });
        let id = normalized.id || normalized._id || tmId(tmIdentity(normalized));
        const unit = { ...normalized, id }; delete unit._id; delete unit.localRevision; delete unit.baseRevision; delete unit.restore;
        delete unit.deleted; delete unit.suppressed;
        if(tmEncodedBytes({mutationId:'00000000-0000-0000-0000-000000000000',upserts:[{...tmWireUnit(unit),baseRevision:0}],deletions:[]})>tmRequestBytes) {
          if(options.origin==='learn') continue;
          throw new TypeError('This Translation Memory unit is too large to synchronize. Shorten its text or context.');
        }
        const reviewedIdentityChange = ['edit','restore','conflict_resolution'].includes(options.origin) && (options.expectedUnits && Object.hasOwn(options.expectedUnits,id)
          || options.expectedRevision != null && options.expectedLocalRevision != null);
        const collisionFallback = !normalized.id || options.origin === 'learn';
        const current = await tmFind(tx, scope, unit, { allowIdentityChange: reviewedIdentityChange, collisionFallback });
        if (!current && collisionFallback && await get(tx, stores.tmUnits, key(scope.key, id))) unit.id = id = tmUuid();
        const currentId = current?.unit.id || id;
        unit.id = currentId;
        const restore = !!options.restore || !!raw.restore && ['seed','edit','restore'].includes(options.origin);
        const explicitDelete = raw.deleted === true && ['seed','edit','restore','adopt','conflict_resolution'].includes(options.origin);
        if (reviewedIdentityChange && current && tmIdentity(current.unit) !== tmIdentity(unit)) {
          const duplicate = (await request(tx.objectStore(stores.tmUnits).index('by_identity').get(key(scope.key, tmIdentity(unit)))))?.value;
          if (duplicate && duplicate.unit.id !== currentId) throw Object.assign(new Error('Another Translation Memory unit already uses this source and context.'), { code: 'TM_IDENTITY_CONFLICT' });
        }
        const reviewedId = options.expectedUnits && (Object.hasOwn(options.expectedUnits,currentId) ? currentId
          : Object.hasOwn(options.expectedUnits,id) ? id : null);
        const expected = field => typeof options[field] === 'object' ? options[field]?.[currentId] ?? options[field]?.[id] : options[field];
        if (expected('expectedRevision') != null && Number(current?.base?.revision || 0) !== expected('expectedRevision')
          || expected('expectedLocalRevision') != null && Number(current?.localRevision || 0) !== expected('expectedLocalRevision')
          || reviewedId != null
            && (!sameTm(options.expectedUnits[reviewedId], current ? tmView(current) : null)
              || options.expectedUnits[reviewedId]?.localRevision != null && options.expectedUnits[reviewedId].localRevision !== Number(current?.localRevision || 0)))
          throw Object.assign(new Error('Translation Memory changed after this review. Review the current unit again.'), { code: 'TM_LOCAL_CONFLICT' });
        if (current?.deleted && !restore && !explicitDelete) continue;
        const conflict = await get(tx, stores.tmRecords, key(scope.key, 'conflict:' + currentId));
        if (conflict && options.origin === 'learn') {
          if(sameTm(conflict.local,unit)) continue;
          tmHistory(tx,scope,conflict.local,unit,'learn_conflict',mutationId+':'+currentId);
          conflict.local = unit;
          tx.objectStore(stores.tmRecords).put(tmRecord(scope, 'conflict:' + currentId, conflict));
          changed = true; continue;
        }
        if (current && (explicitDelete ? current.deleted : !current.deleted && sameTm(current.unit, unit))) continue;
        tmGuard(options);
        const localRevision = Number(current?.localRevision || 0) + 1;
        const next = { unit, base: current?.base || null, deleted: explicitDelete, dirty: true, localRevision };
        tx.objectStore(stores.tmUnits).put(tmRow(scope, next));
        tx.objectStore(stores.tmOutbox).put(tmRecord(scope, tmPendingKey(currentId), { kind: 'pending', id: currentId, unit: explicitDelete ? { ...unit, deleted:true } : unit, localRevision,
          origin: options.origin || 'edit', restore, createdAt: Date.now() }));
        tx.objectStore(stores.tmRecords).delete(key(scope.key, 'conflict:' + currentId));
        tmHistory(tx, scope, current ? tmView(current) : null, tmView(next), options.origin || 'edit', mutationId + ':' + currentId);
        changed = true;
      }
      tmGuard(options);
      tx.objectStore(stores.tmRecords).put(tmRecord(scope, marker, { kind: 'capture', mutationId }));
      if (changed) tx.objectStore(stores.tmMeta).put({ key: scope.key, scope: scope.key, value: { ...meta, localVersion: Number(meta.localVersion || 0) + 1 } });
      return changed;
    }
    async function getTranslationMemory(rawScope) {
      const scope = tmScope(rawScope);
      return transaction(tmStores, 'readonly', async tx => {
        const [rows, meta, records, pending] = await Promise.all([all(tx, stores.tmUnits, scope.key), get(tx, stores.tmMeta, scope.key),
          tmRecordsOf(tx, scope, 'conflict'), request(tx.objectStore(stores.tmOutbox).index('by_scope').count(scope.key))]);
        return { revision: 0, bootstrapped: false, localVersion: 0, ...meta,
          units: rows.filter(row => !row.value.deleted).map(row => tmView(row.value)),
          tombstones: rows.filter(row => row.value.deleted).map(row => tmView(row.value)),
          conflicts: records.map(row => row.value).filter(value => value.kind === 'conflict'), pending };
      });
    }
    async function getTranslationMemoryState(rawScope) {
      const scope = tmScope(rawScope);
      return transaction([stores.tmMeta, stores.tmOutbox, stores.tmRecords], 'readonly', async tx => {
        const [meta, pending, conflicts] = await Promise.all([get(tx, stores.tmMeta, scope.key),
          request(tx.objectStore(stores.tmOutbox).index('by_scope').count(scope.key)),
          request(tx.objectStore(stores.tmRecords).index('by_kind').count(key(scope.key,'conflict')))]);
        return { revision: 0, bootstrapped: false, localVersion: 0, ...meta, pending, conflicts };
      });
    }
    async function tmTouch(tx, scope) {
      const meta = await get(tx, stores.tmMeta, scope.key) || { revision: 0, bootstrapped: false, localVersion: 0 };
      tx.objectStore(stores.tmMeta).put({ key: scope.key, scope: scope.key, value: { ...meta, localVersion: Number(meta.localVersion || 0) + 1 } });
    }
    async function putTranslationMemoryUnits(scope, units, options = {}) {
      tmGuard(options);
      const changed = await transaction(tmStores, 'readwrite', tx => tmCapture(tx, scope, units, options));
      return { changed };
    }
    async function deleteTranslationMemoryUnit(rawScope, id, options = {}) {
      const scope = tmScope(rawScope); tmGuard(options);
      await transaction(tmStores, 'readwrite', async tx => {
        const current = await get(tx, stores.tmUnits, key(scope.key, id)); tmGuard(options);
        if (!current || current.deleted) return;
        if (options.expectedRevision != null && Number(current.base?.revision || 0) !== options.expectedRevision
          || options.expectedLocalRevision != null && Number(current.localRevision || 0) !== options.expectedLocalRevision)
          throw Object.assign(new Error('Translation Memory changed. Review the current unit before deleting.'), { code: 'TM_LOCAL_CONFLICT' });
        const wires = await request(tx.objectStore(stores.tmOutbox).index('by_kind').getAll(key(scope.key, 'wire'), 1));
        const inFlight = wires.some(row => row.value.request.upserts.some(unit => unit.id === id));
        const cancelUnshared = !current.base && !inFlight;
        const next = { ...current, deleted: true, dirty: !cancelUnshared, localRevision: current.localRevision + 1 };
        tx.objectStore(stores.tmUnits).put(tmRow(scope, next));
        if (cancelUnshared) tx.objectStore(stores.tmOutbox).delete(key(scope.key, tmPendingKey(id)));
        else tx.objectStore(stores.tmOutbox).put(tmRecord(scope, tmPendingKey(id), { kind: 'pending', id, unit: { ...current.unit, deleted: true },
          localRevision: next.localRevision, origin: 'delete', createdAt: Date.now() }));
        tx.objectStore(stores.tmRecords).delete(key(scope.key, 'conflict:' + id));
        tmHistory(tx, scope, tmView(current), tmView(next), 'delete', tmUuid() + ':' + id);
        const meta = await get(tx, stores.tmMeta, scope.key) || { revision: 0, bootstrapped: false, localVersion: 0 };
        tx.objectStore(stores.tmMeta).put({ key: scope.key, scope: scope.key, value: { ...meta, localVersion: Number(meta.localVersion || 0) + 1 } });
      });
      return { changed: true };
    }
    async function getTranslationMemoryPending(rawScope, options = {}) {
      const scope = tmScope(rawScope); tmGuard(options);
      return transaction(tmStores, 'readwrite', async tx => {
        const meta = await get(tx, stores.tmMeta, scope.key); if (!meta?.bootstrapped) return [];
        const frozen = (await request(tx.objectStore(stores.tmOutbox).index('by_kind').getAll(key(scope.key, 'wire'), 1)))[0]?.value;
        if (frozen) return [copy(frozen.request)];
        const pending = (await request(tx.objectStore(stores.tmOutbox).index('by_kind').getAll(key(scope.key, 'pending'), 100))).map(row => row.value);
        const requestBody = { mutationId: tmUuid(), upserts: [], deletions: [] }, localRevisions = {}, bases = {};
        let bytes=tmEncodedBytes(requestBody);
        for (const item of pending) {
          if (await get(tx, stores.tmRecords, key(scope.key, 'conflict:' + item.id))) continue;
          const current = await get(tx, stores.tmUnits, key(scope.key, item.id));
          if (!current) continue;
          const baseRevision = Number(current.base?.revision || 0);
          const unit = tmWireUnit(item.unit);let destination,change;
          if (unit.deleted) {
            const deletion = { id: item.id, baseRevision };
            if (!current.base) for (const field of ['source','target','gameScope','context','note','provenance','enabled']) deletion[field] = copy(unit[field]);
            destination=requestBody.deletions;change=deletion;
          }
          else {destination=requestBody.upserts;change={ ...unit,baseRevision,...(item.restore ? {restore:true} : {}) };}
          const addedBytes=tmEncodedBytes(change)+(destination.length?1:0);
          if(bytes+addedBytes>tmRequestBytes) {
            if(!requestBody.upserts.length&&!requestBody.deletions.length) throw new TypeError('A saved Translation Memory unit is too large to synchronize. Edit its text or context in Manage TM.');
            break;
          }
          destination.push(change);bytes+=addedBytes;
          localRevisions[item.id] = item.localRevision; bases[item.id] = copy(current.base);
        }
        if (!requestBody.upserts.length && !requestBody.deletions.length) return [];
        tmGuard(options);
        tx.objectStore(stores.tmOutbox).put(tmRecord(scope, 'wire:' + requestBody.mutationId, { kind: 'wire', request: requestBody, localRevisions, bases }));
        return [copy(requestBody)];
      });
    }
    async function tmMergeRemote(tx, scope, remote, options = {}) {
      const unit = { ...copy(remote), id: remote.id || remote._id }; delete unit._id;
      if (!unit.id || !Number.isSafeInteger(unit.revision) || unit.revision < 0) throw new TypeError('Invalid shared Translation Memory unit.');
      let current = await tmFind(tx, scope, unit, { allowIdentityChange: true }); tmGuard(options);
      if (current?.base && current.base.revision > unit.revision && !options.rebase) return false;
      if (options.rebase && current?.base && !sameTm(current.base,unit)) current = { ...current,dirty:true };
      const identityOwner = (await request(tx.objectStore(stores.tmUnits).index('by_identity').get(key(scope.key,tmIdentity(unit)))))?.value;
      if (current && current.unit.id === unit.id && identityOwner && identityOwner.unit.id !== unit.id
        && (!current.base || tmIdentity(current.base) !== tmIdentity(unit))) {
        // A server identity edit can meet an independently learned local row.
        // Reconcile that natural identity while retaining the replaced row's
        // authored content in its immutable local history.
        tmHistory(tx,scope,tmView(current),copy(unit),'remote_identity',unit.id+':remote-identity:'+unit.revision);
        tx.objectStore(stores.tmUnits).delete(key(scope.key,current.unit.id));
        tx.objectStore(stores.tmOutbox).delete(key(scope.key,tmPendingKey(current.unit.id)));
        tx.objectStore(stores.tmRecords).delete(key(scope.key,'conflict:'+current.unit.id));
        current = { ...identityOwner, localRevision: Math.max(Number(identityOwner.localRevision || 0),Number(current.localRevision || 0)) + 1 };
      } else if (current?.dirty && identityOwner && identityOwner.unit.id !== unit.id
        && !sameTm(current.base,unit)) {
        // A local source edit can leave a separately relearned copy of its old
        // identity. A competing shared correction owns that identity; retain
        // both local authoring attempts in history and review the source edit.
        tmHistory(tx,scope,tmView(identityOwner),copy(unit),'remote_identity',unit.id+':remote-alias:'+unit.revision);
        tx.objectStore(stores.tmUnits).delete(key(scope.key,identityOwner.unit.id));
        tx.objectStore(stores.tmOutbox).delete(key(scope.key,tmPendingKey(identityOwner.unit.id)));
        tx.objectStore(stores.tmRecords).delete(key(scope.key,'conflict:'+identityOwner.unit.id));
      }
      let local = current && tmView(current), dirty = !!current?.dirty;
      const pending = current && await get(tx, stores.tmOutbox, key(scope.key, tmPendingKey(current.unit.id)));
      const previousConflict = current && await get(tx, stores.tmRecords, key(scope.key, 'conflict:' + current.unit.id));
      if (!current?.dirty && !previousConflict && same(current?.base,unit)) return false;
      if (previousConflict) { local = copy(previousConflict.local); dirty = true; }
      if (current && current.unit.id !== unit.id) {
        tx.objectStore(stores.tmUnits).delete(key(scope.key, current.unit.id));
        tx.objectStore(stores.tmOutbox).delete(key(scope.key, tmPendingKey(current.unit.id)));
        tx.objectStore(stores.tmRecords).delete(key(scope.key, 'conflict:' + current.unit.id));
        local.id = unit.id;
      }
      const base = previousConflict?.base || current?.base;
      const conflict = dirty && !sameTm(local, unit) && (previousConflict || !(base && sameTm(base, unit)));
      if (conflict && !(unit.deleted && pending?.origin === 'learn')) {
        tx.objectStore(stores.tmRecords).put(tmRecord(scope, 'conflict:' + unit.id, { kind: 'conflict', id: unit.id,
          base: copy(base), local: copy(local), shared: copy(unit), revision: unit.revision }));
        dirty = false;
      } else if (sameTm(local, unit) || unit.deleted) {
        dirty = false; tx.objectStore(stores.tmRecords).delete(key(scope.key, 'conflict:' + unit.id));
      }
      const keepLocal = dirty && !conflict;
      const next = { unit: keepLocal ? { ...local, id: unit.id } : unit, base: unit, dirty: keepLocal,
        deleted: keepLocal ? !!current.deleted : !!unit.deleted, localRevision: Number(current?.localRevision || 0) + (sameTm(local, unit) ? 0 : 1) };
      tx.objectStore(stores.tmUnits).put(tmRow(scope, next));
      if (keepLocal) tx.objectStore(stores.tmOutbox).put(tmRecord(scope, tmPendingKey(unit.id), { ...pending, kind: 'pending', id: unit.id, unit: next.unit,
        localRevision: next.localRevision, createdAt: pending?.createdAt || Date.now() }));
      else tx.objectStore(stores.tmOutbox).delete(key(scope.key, tmPendingKey(unit.id)));
      return true;
    }
    async function applyTranslationMemoryRemote(rawScope, payload, options = {}) {
      const scope = tmScope(rawScope); tmGuard(options);
      let changed = false;
      await transaction(tmStores, 'readwrite', async tx => {
        const meta = await get(tx, stores.tmMeta, scope.key) || { revision: 0, localVersion: 0, bootstrapped: false };
        const beforeMeta = copy(meta);
        const units = [...(payload.units || []), ...(payload.tombstones || []).map(unit => ({ ...unit, deleted: true }))];
        if (options.bootstrap) {
          if (meta.bootstrapAnchor == null) meta.bootstrapAnchor = Number(payload.revision || 0);
          for (const unit of units) {
            const previous = await get(tx, stores.tmRecords, key(scope.key, 'bootstrap:' + unit.id));
            if (!previous || Number(previous.unit.revision || 0) <= Number(unit.revision || 0) && !same(previous.unit,unit)) {
              tx.objectStore(stores.tmRecords).put(tmRecord(scope, 'bootstrap:' + unit.id, { kind: 'bootstrap', unit }));
              changed = true;
            }
          }
          if (options.complete) {
            const staged = await tmRecordsOf(tx, scope, 'bootstrap'), seen = new Set(staged.map(row=>row.value.unit.id));
            for (const row of staged) {
              changed = await tmMergeRemote(tx, scope, row.value.unit, { ...options,rebase:!!meta.bootstrapRebase }) || changed; tx.objectStore(stores.tmRecords).delete(row.key);
            }
            if (meta.bootstrapRebase) for (const row of await all(tx,stores.tmUnits,scope.key)) {
              const current = row.value;
              if (!current.base || seen.has(current.unit.id)) continue;
              const previous = await get(tx,stores.tmRecords,key(scope.key,'conflict:'+current.unit.id));
              tx.objectStore(stores.tmRecords).put(tmRecord(scope,'conflict:'+current.unit.id,{kind:'conflict',id:current.unit.id,
                base:copy(current.base),local:copy(previous?.local || tmView(current)),shared:null,revision:0}));
              tx.objectStore(stores.tmUnits).put(tmRow(scope,{...current,base:null,dirty:false,deleted:true,localRevision:current.localRevision+1}));
              tx.objectStore(stores.tmOutbox).delete(key(scope.key,tmPendingKey(current.unit.id))); changed = true;
            }
            meta.revision = Math.max(Number(meta.revision || 0), meta.bootstrapAnchor, Number(options.cursorRevision || 0));
            meta.bootstrapped = true; delete meta.bootstrapAnchor; delete meta.bootstrapRebase;
          }
        } else {
          for (const unit of units) changed = await tmMergeRemote(tx, scope, unit, options) || changed;
          for (const change of payload.changes || []) for (const unit of [...(change.units || []), ...(change.tombstones || []).map(unit => ({ ...unit, deleted: true }))])
            changed = await tmMergeRemote(tx, scope, unit, options) || changed;
          if (!options.noCursor) meta.revision = Math.max(Number(meta.revision || 0), Number(payload.nextAfter ?? payload.revision ?? 0));
        }
        tmGuard(options);
        changed = changed || !same(beforeMeta,meta);
        if (changed) {
          meta.localVersion = Number(meta.localVersion || 0) + 1;
          tx.objectStore(stores.tmMeta).put({ key: scope.key, scope: scope.key, value: meta });
        }
      });
      return { changed };
    }
    async function resetTranslationMemoryBootstrap(rawScope,options={}) {
      const scope=tmScope(rawScope);tmGuard(options);
      await transaction(tmStores,'readwrite',async tx=>{
        const meta=await get(tx,stores.tmMeta,scope.key)||{localVersion:0};
        for(const row of await tmRecordsOf(tx,scope,'bootstrap')) tx.objectStore(stores.tmRecords).delete(row.key);
        for(const row of await request(tx.objectStore(stores.tmOutbox).index('by_kind').getAll(key(scope.key,'wire')))) tx.objectStore(stores.tmOutbox).delete(row.key);
        tmGuard(options);
        delete meta.bootstrapAnchor;
        tx.objectStore(stores.tmMeta).put({key:scope.key,scope:scope.key,value:{...meta,revision:0,bootstrapped:false,bootstrapRebase:true,localVersion:Number(meta.localVersion||0)+1}});
      });
      return {changed:true};
    }
    async function acknowledgeTranslationMemoryWrite(rawScope, mutationId, response, options = {}) {
      const scope = tmScope(rawScope); tmGuard(options);
      await transaction(tmStores, 'readwrite', async tx => {
        const wire = await get(tx, stores.tmOutbox, key(scope.key, 'wire:' + mutationId));
        if (!wire) return;
        if (response.mutationId !== mutationId || !Number.isSafeInteger(response.appliedRevision)) throw new Error('Invalid Translation Memory acknowledgement.');
        const returnedUnits = response.accepted || [...(response.units || []), ...(response.tombstones || []).map(unit => ({ ...unit, deleted: true }))];
        const later = [];
        for (const desired of [...wire.request.upserts, ...wire.request.deletions.map(item => ({ ...item, deleted: true }))]) {
          const current = await get(tx, stores.tmUnits, key(scope.key, desired.id)); if (!current) continue;
          const returned = returnedUnits.find(unit => unit.id === desired.id);
          if (!returned || !Number.isSafeInteger(returned.revision)) throw new Error('Translation Memory acknowledgement is missing the accepted unit.');
          const expectedRevision = desired.baseRevision + (sameTm(desired, wire.bases[desired.id]) ? 0 : 1);
          const replayAdvanced = response.replayed && returned.revision > expectedRevision;
          const accepted = replayAdvanced ? { ...(desired.deleted ? current.unit : desired), id: desired.id,
            revision: expectedRevision, ...(desired.deleted ? { deleted: true } : {}) } : returned;
          if (replayAdvanced) later.push(returned);
          delete accepted.baseRevision; delete accepted.restore;
          const unchanged = current.localRevision === wire.localRevisions[desired.id];
          const next = { ...current, base: accepted, unit: unchanged ? accepted : current.unit, dirty: !unchanged, deleted: unchanged ? !!accepted.deleted : current.deleted };
          tx.objectStore(stores.tmUnits).put(tmRow(scope, next));
          if (unchanged) tx.objectStore(stores.tmOutbox).delete(key(scope.key, tmPendingKey(desired.id)));
        }
        for (const remote of later) await tmMergeRemote(tx, scope, remote, options);
        tmGuard(options);
        tx.objectStore(stores.tmOutbox).delete(key(scope.key, 'wire:' + mutationId));
        await tmTouch(tx,scope);
      });
      return { changed: true };
    }
    async function rejectTranslationMemoryWrite(rawScope, mutationId, conflicts = [], options = {}) {
      const scope = tmScope(rawScope); tmGuard(options);
      await transaction(tmStores, 'readwrite', async tx => {
        for (const conflict of conflicts) {
          if (conflict.current) await tmMergeRemote(tx, scope, conflict.current, options);
          else {
            const current = await get(tx,stores.tmUnits,key(scope.key,conflict.id));
            if (!current) continue;
            tx.objectStore(stores.tmRecords).put(tmRecord(scope,'conflict:'+conflict.id,{kind:'conflict',id:conflict.id,
              base:copy(current.base),local:tmView(current),shared:null,revision:0}));
            tx.objectStore(stores.tmUnits).put(tmRow(scope,{...current,base:null,dirty:false,deleted:true}));
            tx.objectStore(stores.tmOutbox).delete(key(scope.key,tmPendingKey(conflict.id)));
          }
        }
        tmGuard(options); tx.objectStore(stores.tmOutbox).delete(key(scope.key, 'wire:' + mutationId));
        await tmTouch(tx,scope);
      });
      return { changed: true };
    }
    async function resolveTranslationMemoryConflict(rawScope, id, choice, options = {}) {
      const scope = tmScope(rawScope); tmGuard(options);
      await transaction(tmStores, 'readwrite', async tx => {
        const conflict = await get(tx, stores.tmRecords, key(scope.key, 'conflict:' + id));
        if (!conflict || options.expectedRevision != null && conflict.revision !== options.expectedRevision
          || options.expectedConflict && !same(conflict,options.expectedConflict))
          throw new Error('Translation Memory conflict changed. Review it again.');
        tmGuard(options);
        tx.objectStore(stores.tmRecords).delete(key(scope.key, 'conflict:' + id));
        if (choice === 'local') {
          const current=await get(tx,stores.tmUnits,key(scope.key,id));
          await tmCapture(tx,rawScope,[conflict.local],{...options,origin:'conflict_resolution',restore:!conflict.shared||!!conflict.shared.deleted,
            expectedUnits:{[id]:current?tmView(current):null}});
        }
        else if (choice !== 'shared') throw new TypeError('Choose local or shared Translation Memory.');
        else await tmTouch(tx,scope);
      });
      return { changed: true };
    }
    async function listTranslationMemoryHistory(rawScope, id) {
      const scope = tmScope(rawScope);
      return transaction([stores.tmRecords], 'readonly', async tx => (await tmRecordsOf(tx, scope, 'history')).map(row => row.value)
        .filter(value => value.kind === 'history' && (!id || value.unitId === id)).sort((a,b) => b.createdAt - a.createdAt));
    }
    async function adoptTranslationMemoryProfile(fromProfile, toProfile, options = {}) {
      if (!fromProfile || !toProfile || fromProfile === toProfile) return;
      tmGuard(options);
      await transaction(tmStores, 'readwrite', async tx => {
        const marker = key('adopt-tm-profile', toProfile), previous = await get(tx, stores.tmMeta, marker);
        if (previous) return;
        const records = await request(tx.objectStore(stores.tmUnits).getAll());
        const groups = new Map();
        for (const record of records) {
          const [profile, language] = JSON.parse(record.scope);
          if (profile !== fromProfile) continue;
          const units = groups.get(language) || []; units.push({ ...record.value.unit, ...(record.value.deleted ? { deleted:true } : {}) }); groups.set(language, units);
        }
        for (const [language, units] of groups) {
          const scope = tmScope({ profile: toProfile, language });
          const available = [];
          for (const unit of units) {
            // Profile IDs are independent. A destination may already have
            // repurposed this deterministic ID through a reviewed source edit.
            const existing = await tmFind(tx,scope,unit,{collisionFallback:true});
            if (existing) continue;
            available.push(await get(tx,stores.tmUnits,key(scope.key,unit.id)) ? { ...unit,id:tmUuid() } : unit);
          }
          await tmCapture(tx, scope, available, { ...options, origin: 'adopt', mutationId: 'adopt:' + fromProfile + ':' + toProfile + ':' + language });
        }
        tmGuard(options);
        tx.objectStore(stores.tmMeta).put({ key: marker, value: { adoptedFrom: fromProfile } });
      });
    }
    // Accepted baseline rows cannot change within their source identity. Share
    // their detached reads only inside one transaction, including room/workspace
    // adapters that otherwise fetch the same original several times.
    const baselineReads = new WeakMap(), baselineScopes = new WeakMap(), assetReads = new WeakMap();
    function baselineCache(tx) {
      let cache = baselineReads.get(tx);
      if (!cache) baselineReads.set(tx, cache = new Map());
      return cache;
    }
    async function get(tx, name, id) {
      // Assets can be replaced by a same-identity import. Cache only readonly
      // transactions; a readwrite transaction must observe its own later put.
      if (name === stores.assets && tx.mode === 'readonly') {
        let cache = assetReads.get(tx);
        if (!cache) assetReads.set(tx, cache = new Map());
        if (!cache.has(id)) cache.set(id, request(tx.objectStore(name).get(id)).then(value => value?.value,
          error => { cache.delete(id); throw error; }));
        return cache.get(id);
      }
      if (name !== stores.baseline) return (await request(tx.objectStore(name).get(id)))?.value;
      const cache = baselineCache(tx);
      if (!cache.has(id)) {
        const pending = request(tx.objectStore(name).get(id)).then(value => {
          if (!value) cache.delete(id); // Imports may still insert an absent row.
          return value?.value;
        }, error => { cache.delete(id); throw error; });
        cache.set(id, pending);
      }
      return cache.get(id);
    }
    const all = (tx, name, scope) => request(tx.objectStore(name).index('by_scope').getAll(scope));
    function originalRows(tx, scope) {
      let scopes = baselineScopes.get(tx);
      if (!scopes) baselineScopes.set(tx, scopes = new Map());
      const id = baselineKey(scope);
      if (!scopes.has(id)) scopes.set(id, all(tx, stores.baseline, id).then(rows => {
        const cache = baselineCache(tx);
        for (const item of rows) cache.set(item.key, Promise.resolve(item.value));
        return rows;
      }));
      return scopes.get(id);
    }
    const keyRanges = dependencies.IDBKeyRange || globalThis.IDBKeyRange;
    const selectionBatchSize = 128, maximumRangeRowsPerKey = 8;
    async function selectedKeyRows(source, requested, matches, point) {
      const keys = [...new Set(requested)], selected = new Map();
      const keep = rows => { for (const item of rows) if (item && matches(item)) selected.set(item.key, item); };
      if (keys.length < selectionBatchSize || !keyRanges?.bound || !source.getAll || !source.count) {
        keep((await Promise.all(keys.map(point))).flat());
      } else {
        keys.sort();
        // Count bounded ranges before materializing them. Widely scattered
        // paths cannot hydrate unlimited unrelated text or recovery records.
        for (let index = 0; index < keys.length; index += selectionBatchSize) {
          const run = keys.slice(index, index + selectionBatchSize), range = keyRanges.bound(run[0], run[run.length - 1]);
          if (await request(source.count(range)) > run.length * maximumRangeRowsPerKey) keep((await Promise.all(run.map(point))).flat());
          else keep(await request(source.getAll(range)));
        }
      }
      return [...selected.values()];
    }
    async function selectedRows(tx, name, scope, paths) {
      const store = tx.objectStore(name), keys = paths.map(path => key(scope, path)), wanted = new Set(keys);
      const rows = await selectedKeyRows(store.index('by_path'), keys,
        item => item.scope === scope && wanted.has(item.pathKey),
        id => request(name === stores.files ? store.get(id) : store.index('by_path').getAll(id)));
      const byPath = new Map();
      for (const item of rows) {
        if (!byPath.has(item.pathKey)) byPath.set(item.pathKey, []);
        byPath.get(item.pathKey).push(item);
      }
      // Preserve the requested file order and per-path primary-key order used
      // by the established point-read adapter, including duplicate selections.
      return keys.flatMap(id => byPath.get(id) || []);
    }
    async function originalFiles(tx, scope, paths) {
      const baseId = baselineKey(scope), ids = paths.map(path => key(baseId, path)), cache = baselineCache(tx);
      if (paths.length < selectionBatchSize || !keyRanges?.bound) return Promise.all(ids.map(id => get(tx, stores.baseline, id)));
      const missing = [...new Set(ids)].filter(id => !cache.has(id)), wanted = new Set(missing), store = tx.objectStore(stores.baseline);
      const rows = selectedKeyRows(store, missing, item => item.scope === baseId && wanted.has(item.key), id => request(store.get(id)))
        .then(values => new Map(values.map(item => [item.key, item.value])));
      // Reserve in-flight keys immediately. A room and workspace adapter can
      // request the same large selection before the first range finishes.
      for (const id of missing) {
        const pending = rows.then(values => {
          if (!values.has(id) && cache.get(id) === pending) cache.delete(id);
          return values.get(id);
        }, error => { if (cache.get(id) === pending) cache.delete(id); throw error; });
        cache.set(id, pending);
      }
      // Absent rows remain uncached: an atomic import may insert one later.
      return Promise.all(ids.map(id => cache.get(id)));
    }
    async function transaction(selected, mode, action) {
      const db = await openDb(), tx = db.transaction([...new Set(selected)], mode), completion = done(tx);
      try { const result = await action(tx); await completion; return result; }
      catch (error) { try { tx.abort(); } catch (_) {} await completion.catch(() => {}); throw error; }
    }
    async function available() { return !!(await openDb()).objectStoreNames?.contains(stores.meta); }
    async function normalizeHistory(game, selectedStore) {
      const name = selectedStore || revisionStoreName(game), marker = key('history', name);
      let progress = await transaction([stores.migration], 'readonly', tx => get(tx, stores.migration, marker));
      if (progress?.state === 'ready') return;
      return trackMigration('history', marker, { game }, async () => {
        for (;;) {
          progress = await transaction([name, stores.migration], 'readwrite', async tx => {
            const current = await get(tx, stores.migration, marker);
            if (current?.state === 'ready') return current;
            const range = current?.lastId == null ? undefined : IDBKeyRange.lowerBound(current.lastId, true);
            const rows = await request(tx.objectStore(name).getAll(range, 128));
            for (const value of rows) {
              const normalized = { ...value, accountId: String(value.accountId || value.collaborationAccountId || 'guest'), branchId: value.branchId || 'default', sourceHash: value.sourceHash || '' };
              if (!same(value, normalized)) tx.objectStore(name).put(normalized);
            }
            const next = rows.length < 128 ? { state: 'ready' } : { state: 'converting', lastId: rows[rows.length - 1].id };
            tx.objectStore(stores.migration).put({ key: marker, scope: marker, value: next });
            return next;
          });
          if (progress.state === 'ready') return;
        }
      });
    }
    const fieldMaps = ['status', 'staged', 'dropped', 'droppedArchive', 'droppedOutbox', 'droppedAliases', 'droppedConflicts', 'droppedAssignments', 'placeholderRepairArchive'];
    const languageMaps = new Set(['staged', 'dropped', 'droppedConflicts', 'droppedAssignments']);
    function verificationMap(field, value) {
      const map = value || {};
      if (!languageMaps.has(field) || typeof map !== 'object' || Array.isArray(map)) return map;
      // Resolving the final file leaves an empty language bucket in older
      // workspaces. It has no per-file record; retain strict checks for every
      // actual entry and its nested recovery evidence.
      return Object.fromEntries(Object.entries(map).filter(([, entries]) =>
        !entries || typeof entries !== 'object' || Array.isArray(entries) || Object.keys(entries).length));
    }
    function splitWorkspace(scope, workspace, originals = new Map()) {
      const id = scopeKey(scope), meta = {}, files = [], records = [];
      for (const [field, value] of Object.entries(workspace || {})) if (!['_storageSelection', '_storageArchiveKinds', 'descs', 'importRecovery'].includes(field) && !fieldMaps.includes(field)) meta[field] = value;
      delete meta.groupId; delete meta.versionId; Object.assign(meta, contentScope(scope));
      if (meta.importArchive) {
        const { decisions, ...descriptor } = meta.importArchive;
        meta.importArchive = descriptor;
      }
      meta.nextDroppedOrder = Math.max(Number(meta.nextDroppedOrder || 0), workspace?.droppedOutbox?.length || 0);
      if (Array.isArray(workspace?.importRecovery) || workspace?._storageArchiveKinds?.includes('importRecovery')) meta._storageArchiveKinds = ['importRecovery'];
      for (const desc of workspace?.descs || []) {
        const original = originals.get(desc.filepath), overrides = {};
        for (const [field, value] of Object.entries(desc)) if (field !== 'translations' && !['hasChanges', 'isMissing', 'needsReview', 'isDropped', 'isRevised', 'languageStatus', 'statusLanguage'].includes(field)
          && (!original || !same(value, original[field]))) overrides[field] = value;
        const value = { filepath: desc.filepath, overrides, languages: Object.keys(desc.translations || {}) };
        if (!original) value.fallback = desc;
        files.push(row(id, desc.filepath, value, { pathKey: key(id, desc.filepath) }));
      }
      for (const field of fieldMaps) {
        const map = workspace?.[field] || {};
        for (const [outer, value] of Object.entries(map)) {
          if (languageMaps.has(field)) for (const [entry, item] of Object.entries(value || {})) records.push(row(id, [field, outer, entry], { field, language: outer, entry, data: item }, { pathKey: key(id, item?.filepath || entry), kindScope: key(id, field) }));
          else {
            const entry = field === 'droppedOutbox' ? key(value.id, value.kind) : outer;
            const path = value?.filepath || value?.candidate?.filepath || workspace.droppedArchive?.[outer]?.filepath || workspace.droppedArchive?.[value?.id]?.filepath || outer;
            records.push(row(id, [field, entry], { field, entry, data: value, ...(field === 'droppedOutbox' ? { order: Number(outer) } : {}) }, { pathKey: key(id, path), kindScope: key(id, field) }));
          }
        }
      }
      for (const [entry, recovery] of (workspace?.importRecovery || []).entries()) {
        const metadata = copy(recovery);
        if (Array.isArray(metadata?.descs)) metadata.descs = [];
        if (metadata?.status && typeof metadata.status === 'object' && !Array.isArray(metadata.status)) metadata.status = {};
        // Archived work is cold data. These records intentionally have no
        // by_path entry, so ordinary saves never read or rewrite them.
        records.push(row(id, ['importRecovery', entry, 'group'], { field: 'importRecovery', kind: 'group', entry, data: metadata }, { kindScope: key(id, 'importRecovery') }));
        for (const [order, desc] of (Array.isArray(recovery?.descs) ? recovery.descs : []).entries()) records.push(row(id, ['importRecovery', entry, 'desc', order],
          { field: 'importRecovery', kind: 'desc', entry, order, data: desc }, { kindScope: key(id, 'importRecovery') }));
        for (const [statusKey, data] of Object.entries(recovery?.status && typeof recovery.status === 'object' && !Array.isArray(recovery.status) ? recovery.status : {})) records.push(row(id, ['importRecovery', entry, 'status', statusKey],
          { field: 'importRecovery', kind: 'status', entry, statusKey, data }, { kindScope: key(id, 'importRecovery') }));
      }
      return { meta, files, records };
    }
    function assembleWorkspace(meta, fileRows, recordRows, originals, includeArchives = true) {
      if (!meta) return undefined;
      const workspace = { ...copy(meta), descs: [] };
      for (const field of fieldMaps) workspace[field] = field === 'droppedOutbox' ? [] : {};
      const archives = [], outbox = [];
      for (const item of recordRows) {
        const { field, language, entry, data } = item.value;
        if (field === 'importRecovery') archives.push(item.value);
        else if (field === 'droppedOutbox') outbox.push(item.value);
        else if (language != null) (workspace[field][language] ||= {})[entry] = copy(data);
        else workspace[field][entry] = copy(data);
      }
      workspace.droppedOutbox = outbox.sort((a, b) => (a.order || 0) - (b.order || 0)).map(item => copy(item.data));
      for (const item of fileRows) {
        const file = item.value, original = originals.get(file.filepath);
        const desc = { ...copy(original || file.fallback || { filepath: file.filepath, translations: {} }), ...copy(file.overrides) };
        desc.translations ||= {};
        for (const [language, entries] of Object.entries(workspace.staged)) if (Object.hasOwn(entries, file.filepath)) desc.translations[language] = copy(entries[file.filepath].translations);
        workspace.descs.push(desc);
      }
      if (includeArchives) {
        if (meta._storageArchiveKinds?.includes('importRecovery') || archives.length) workspace.importRecovery = [];
        for (const { entry, data } of archives.filter(value => value.kind === 'group')) workspace.importRecovery[entry] = copy(data);
        for (const item of archives) {
          if (item.kind === 'desc') workspace.importRecovery[item.entry].descs[item.order] = copy(item.data);
          else if (item.kind === 'status') workspace.importRecovery[item.entry].status[item.statusKey] = copy(item.data);
        }
        delete workspace._storageArchiveKinds;
      } else delete workspace.importRecovery;
      return workspace;
    }
    async function readWorkspace(tx, scope, filepaths, includeDropped = true, allDropped = false) {
      const id = scopeKey(scope), meta = await get(tx, stores.meta, id);
      if (!meta) return undefined;
      let files, records;
      if (filepaths == null) { [files, records] = await Promise.all([all(tx, stores.files, id), all(tx, stores.records, id)]); }
      else {
        [files, records] = await Promise.all([selectedRows(tx, stores.files, id, filepaths), selectedRows(tx, stores.records, id, filepaths)]);
        // Alias/provenance keys are IDs rather than paths. Include only records
        // referring to the selected candidates, never all translation files.
        if (allDropped) records.push(...(await Promise.all(fieldMaps.filter(field => field.startsWith('dropped')).map(field => request(tx.objectStore(stores.records).index('by_kind').getAll(key(id, field)))))).flat());
        if (includeDropped) {
          const ids = new Set(records.filter(r => r.value.field === 'dropped').map(r => r.value.data?.id));
          const related = await Promise.all([...ids].filter(Boolean).flatMap(candidate => ['droppedArchive', 'droppedAliases', 'droppedOutbox'].map(field => request(tx.objectStore(stores.records).get(key(id, [field, candidate]))))));
          records.push(...related.filter(Boolean));
        }
      }
      const originalValues = filepaths == null ? (await originalRows(tx, scope)).map(item => item.value)
        : await originalFiles(tx, scope, files.map(item => item.value.filepath));
      const originals = new Map(originalValues.filter(Boolean).map(desc => [desc.filepath, desc]));
      const workspace = assembleWorkspace(meta, files, [...new Map(records.map(r => [r.key, r])).values()].sort((a,b) => (a.value.order || 0) - (b.value.order || 0)), originals, filepaths == null);
      if (filepaths == null && workspace.importArchive) {
        const retained = await get(tx, stores.assets, baselineKey(scope));
        if (!retained?.archive) throw new Error('The accepted archive descriptor is unavailable. Reimport its matching original ZIP.');
        workspace.importArchive = copy(retained.archive);
      }
      if (filepaths != null) workspace._storageSelection = { filepaths, allDropped };
      return workspace;
    }
    async function writeDifference(tx, name, previous, next) {
      const before = new Map(previous.map(item => [item.key, item])), after = new Map(next.map(item => [item.key, item]));
      const store = tx.objectStore(name);
      for (const [id, item] of after) if (!same(before.get(id), item)) store.put(item);
      for (const id of before.keys()) if (!after.has(id)) store.delete(id);
    }
    async function writeWorkspace(tx, scope, workspace, filepaths) {
      if (!workspace) return;
      W.pruneWorkspaceStatus(workspace);
      const id = scopeKey(scope), paths = filepaths || workspace.descs.map(file => file.filepath);
      const originals = new Map((await originalFiles(tx, scope, paths)).filter(Boolean).map(desc => [desc.filepath, desc]));
      const parts = splitWorkspace(scope, workspace, originals), beforeMeta = await get(tx, stores.meta, id);
      if (filepaths != null) parts.records = parts.records.filter(item => item.value.field !== 'importRecovery');
      let oldFiles, oldRecords;
      if (filepaths == null) [oldFiles, oldRecords] = await Promise.all([all(tx, stores.files, id), all(tx, stores.records, id)]);
      else {
        [oldFiles, oldRecords] = await Promise.all([selectedRows(tx, stores.files, id, paths), selectedRows(tx, stores.records, id, paths)]);
        for (const candidate of Object.keys(workspace.droppedAliases || {})) {
          const previous = await request(tx.objectStore(stores.records).get(key(id, ['droppedAliases', candidate])));
          if (previous) oldRecords.push(previous);
        }
      }
      if (filepaths != null) {
        const previous = new Map(oldRecords.map(item => [item.key, item]));
        let nextOrder = Number(beforeMeta?.nextDroppedOrder || 0);
        for (const item of parts.records) if (item.value.field === 'droppedOutbox') {
          item.value.order = previous.get(item.key)?.value.order ?? nextOrder++;
        }
        parts.meta.nextDroppedOrder = nextOrder;
      }
      if (!same(beforeMeta, parts.meta)) tx.objectStore(stores.meta).put({ key: id, scope: id, value: copy(parts.meta) });
      await writeDifference(tx, stores.files, oldFiles, parts.files);
      await writeDifference(tx, stores.records, [...new Map(oldRecords.map(r => [r.key, r])).values()], parts.records);
    }
    async function migrate(scope, legacyWorkspace, legacySource, baseline, language) {
      const id = scopeKey(scope);
      if (migrations.has(id)) return migrations.get(id);
      const work = (async () => {
        const ready = await transaction([stores.migration], 'readonly', tx => get(tx, stores.migration, id));
        if (ready?.state === 'ready') return;
        return trackMigration('workspace', id, scope, async () => {
          const workspace = legacyWorkspace ?? await dependencies.prepareWorkspace?.(scope, language) ?? await legacyGet(workspaceKey(scope));
          if (!workspace) return;
          baseline ||= await legacyBaseline?.(workspace, scope);
          const source = legacySource ?? baseline?.source ?? await legacyGet(sourceKey(scope));
          if (!Array.isArray(source)) throw new Error('The original source is unavailable. Reimport its matching ZIP to finish storage conversion. Existing work has been retained.');
          if (baseline && !sameBaselineSource(baseline.source, source)) throw new Error('Retained source records disagree. Existing work has been kept for recovery.');
          const P = typeof window === 'object' ? window.CollaborationProtocol : typeof self === 'object' ? self.CollaborationProtocol : null;
          if (workspace.importArchive) {
            if (!baseline || baseline.archive?.baselineId !== scope.sourceHash || baseline.tree?.root !== baseline.archive.treeRoot)
              throw new Error('The accepted baseline evidence is incomplete. Reimport the matching original ZIP.');
            if (P) {
              const archive = await P.finalizeArchive(baseline.archive), tree = await P.buildBaselineTree(source);
              if (archive.baselineId !== scope.sourceHash || tree.root !== archive.treeRoot) throw new Error('The retained files do not reproduce their accepted baseline.');
            }
          } else if (P && /^[a-f0-9]{64}$/.test(scope.sourceHash) && await P.sourceHash(source) !== scope.sourceHash) {
            throw new Error('The retained source differs from its saved version identity.');
          }
          W.initializeWorkspace(workspace, { source, sourceHash: scope.sourceHash, game: scope.game });
          W.pruneWorkspaceStatus(workspace);
          const originals = new Map(source.map(desc => [desc.filepath, desc])), parts = splitWorkspace(scope, workspace, originals);
          const baseId = baselineKey(scope);
          const acceptedMatches = await transaction([stores.assets, stores.baseline], 'readonly', async tx => {
            const assets = tx.objectStore(stores.assets);
            const accepted = await request(assets.getKey ? assets.getKey(baseId) : assets.get(baseId));
            return !accepted || sameBaselineSource((await all(tx, stores.baseline, baseId)).map(item => item.value), source);
          });
          if (!acceptedMatches) throw new Error('Retained baselines disagree for one accepted source identity. Original data has been retained.');
          const items = [...source.map((desc, order) => [stores.baseline, row(baseId, desc.filepath, desc, { order })]), ...parts.files.map(value => [stores.files, value]), ...parts.records.map(value => [stores.records, value])];
          const evidenceHash = await fingerprint([source, parts, scope]);
          let offset = ready?.fingerprint === evidenceHash ? ready.offset || 0 : 0;
          if (!offset && await transaction([stores.files, stores.records, stores.migration], 'readwrite', async tx => {
            if ((await get(tx, stores.migration, id))?.state === 'ready') return true;
            for (const name of [stores.files, stores.records]) for (const item of await all(tx, name, id)) tx.objectStore(name).delete(item.key);
            tx.objectStore(stores.migration).put({ key: id, scope: id, value: { state: 'converting', offset: 0, fingerprint: evidenceHash } });
            return false;
          })) return;
          for (; offset < items.length; offset += 256) {
            const batch = items.slice(offset, offset + 256);
            if (await transaction([...batch.map(item => item[0]), stores.migration], 'readwrite', async tx => {
              if ((await get(tx, stores.migration, id))?.state === 'ready') return true;
              for (const [name, value] of batch) {
                if (name === stores.baseline) {
                  const prior = await get(tx, name, value.key);
                  if (prior) {
                    if (!sameBaselineFile(prior, value.value)) throw new Error('Retained baselines disagree for one accepted source identity. Original data has been retained.');
                    continue;
                  }
                }
                tx.objectStore(name).put(value);
              }
              tx.objectStore(stores.migration).put({ key: id, scope: id, value: { state: 'converting', offset: offset + batch.length, fingerprint: evidenceHash } });
              return false;
            })) return;
          }
          const receipts = await legacyGet(receiptKey(scope)) || [];
          await normalizeHistory(scope.game);
          await transaction([stores.meta, stores.assets, stores.migration, stores.receipts, stores.baseline, stores.files, stores.records], 'readwrite', async tx => {
            if ((await get(tx, stores.migration, id))?.state === 'ready') return;
            const savedSource = await all(tx, stores.baseline, baseId), savedFiles = await all(tx, stores.files, id), savedRecords = await all(tx, stores.records, id);
            const restored = assembleWorkspace(parts.meta, savedFiles, savedRecords, new Map(savedSource.map(r => [r.value.filepath, r.value])));
            if (!sameBaselineSource(savedSource.map(r => r.value), source))
              throw new Error('Baseline conversion verification failed. Original data has been retained.');
            for (const field of fieldMaps) if (!same(verificationMap(field, restored[field]), verificationMap(field, workspace[field]))) throw new Error('Workspace conversion verification failed: ' + field);
            if (!same(restored.importRecovery, workspace.importRecovery)) throw new Error('Import recovery conversion verification failed.');
            tx.objectStore(stores.meta).put({ key: id, scope: id, value: parts.meta });
            const assets = baseline ? { ...copy(baseline), source: undefined } : { sourceHash: scope.sourceHash };
            tx.objectStore(stores.assets).put({ key: baseId, scope: baseId, value: assets });
            for (const receipt of receipts) tx.objectStore(stores.receipts).put(row(id, receipt.jobId, receipt));
            tx.objectStore(stores.migration).put({ key: id, scope: id, value: { state: 'ready' } });
          });
        });
      })();
      migrations.set(id, work);
      try { return await work; } finally { migrations.delete(id); }
    }
    async function ensure(scope) { if (scope?.sourceHash) await migrate(scope); }
    async function workspace(scope, options = {}) {
      await ensure(scope);
      return transaction([stores.meta, stores.files, stores.records, stores.baseline, stores.assets], 'readonly', tx => readWorkspace(tx, scope, options.filepaths, options.includeDropped, options.allDropped));
    }
    async function source(scope) {
      await ensure(scope);
      return transaction([stores.baseline], 'readonly', async tx => (await originalRows(tx, scope)).slice().sort((a,b) => (a.order || 0) - (b.order || 0)).map(row => row.value));
    }
    // These steps run only after activation's readonly transaction completes.
    // JSON-compatible copies retain the old materialized-view boundary, while
    // checking the budget inside arrays, objects, sorting and file assembly.
    function* activationCopy(value, ancestors = new Set()) {
      if (typeof value === 'bigint') throw new TypeError('Do not know how to serialize a BigInt');
      if (!value || typeof value !== 'object') return typeof value === 'number' && !Number.isFinite(value) ? null : value;
      if (typeof value.toJSON === 'function') return yield* activationCopy(value.toJSON(), ancestors);
      if (ancestors.has(value)) throw new TypeError('Converting circular structure to JSON');
      ancestors.add(value);
      const result = Array.isArray(value) ? [] : {};
      if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index++) {
          const item = yield* activationCopy(value[index], ancestors);
          result.push(item === undefined ? null : item);
          yield;
        }
      } else for (const field in value) if (Object.hasOwn(value, field) && value[field] !== undefined) {
        const item = yield* activationCopy(value[field], ancestors);
        if (field === '__proto__') Object.defineProperty(result, field, { value: item, enumerable: true, writable: true, configurable: true });
        else result[field] = item;
        yield;
      }
      ancestors.delete(value);
      return result;
    }
    function* activationSort(values, compare) {
      let sorted = [], scratch;
      for (const value of values) { sorted.push(value); yield; }
      scratch = new Array(sorted.length);
      for (let width = 1; width < sorted.length; width *= 2) {
        for (let start = 0; start < sorted.length; start += width * 2) {
          const middle = Math.min(start + width, sorted.length), end = Math.min(middle + width, sorted.length);
          let left = start, right = middle;
          for (let index = start; index < end; index++) {
            scratch[index] = right >= end || (left < middle && compare(sorted[left], sorted[right]) <= 0) ? sorted[left++] : sorted[right++];
            yield;
          }
        }
        [sorted, scratch] = [scratch, sorted];
      }
      return sorted;
    }
    function* materializeActivation(raw, scope) {
      const source = [], originals = new Map(), uniqueRecords = new Map();
      for (const item of yield* activationSort(raw.originals, (a, b) => (a.order || 0) - (b.order || 0))) {
        source.push(item.value);
        if (item.value) originals.set(item.value.filepath, item.value);
        yield;
      }
      let workspace;
      if (raw.meta) {
        workspace = { ...yield* activationCopy(raw.meta), descs: [] };
        for (const field of fieldMaps) workspace[field] = field === 'droppedOutbox' ? [] : {};
        for (const item of raw.records) { uniqueRecords.set(item.key, item); yield; }
        const archives = [], outbox = [];
        for (const item of yield* activationSort(uniqueRecords.values(), (a, b) => (a.value.order || 0) - (b.value.order || 0))) {
          const { field, language, entry, data } = item.value;
          if (field === 'importRecovery') archives.push(item.value);
          else if (field === 'droppedOutbox') outbox.push(item.value);
          else if (language != null) (workspace[field][language] ||= {})[entry] = yield* activationCopy(data);
          else workspace[field][entry] = yield* activationCopy(data);
          yield;
        }
        for (const item of yield* activationSort(outbox, (a, b) => (a.order || 0) - (b.order || 0))) {
          workspace.droppedOutbox.push(yield* activationCopy(item.data)); yield;
        }
        for (const item of raw.files) {
          const file = item.value, original = originals.get(file.filepath);
          const desc = { ...yield* activationCopy(original || file.fallback || { filepath: file.filepath, translations: {} }),
            ...yield* activationCopy(file.overrides) };
          desc.translations ||= {};
          for (const language in workspace.staged) if (Object.hasOwn(workspace.staged, language)) {
            const entries = workspace.staged[language];
            if (Object.hasOwn(entries, file.filepath)) desc.translations[language] = yield* activationCopy(entries[file.filepath].translations);
            yield;
          }
          workspace.descs.push(desc); yield;
        }
        if (raw.meta._storageArchiveKinds?.includes('importRecovery') || archives.length) workspace.importRecovery = [];
        for (const item of archives) {
          if (item.kind === 'group') workspace.importRecovery[item.entry] = yield* activationCopy(item.data);
          yield;
        }
        for (const item of archives) {
          if (item.kind === 'desc') workspace.importRecovery[item.entry].descs[item.order] = yield* activationCopy(item.data);
          else if (item.kind === 'status') workspace.importRecovery[item.entry].status[item.statusKey] = yield* activationCopy(item.data);
          yield;
        }
        delete workspace._storageArchiveKinds;
        if (workspace.importArchive) {
          if (!raw.retained?.archive) throw new Error('The accepted archive descriptor is unavailable. Reimport its matching original ZIP.');
          workspace.importArchive = yield* activationCopy(raw.retained.archive);
        }
      }
      // Three callers own independently mutable views of original file data.
      const baseline = raw.retained && { ...raw.retained, source: yield* activationCopy(source) };
      return { workspace, source, baseline,
        ...(workspace?.importArchive && raw.retained?.archive?.baselineId === scope.sourceHash ? { sourceBaselineId: scope.sourceHash } : {}) };
    }
    async function runActivation(steps) {
      const now = dependencies.activationNow || (() => typeof performance === 'object' ? performance.now() : Date.now());
      const yieldTask = dependencies.activationYield || (() => new Promise(resolve => setTimeout(resolve, 0)));
      let started = now(), checks = 0;
      for (;;) {
        const next = steps.next();
        if (next.done) return next.value;
        if (++checks === 32) {
          checks = 0;
          if (now() - started >= 4) { await yieldTask(); started = now(); }
        }
      }
    }
    async function activation(scope) {
      const captured = { ...scope };
      await ensure(captured);
      const id = scopeKey(captured), baseId = baselineKey(captured);
      // Do no corpus cloning, sorting or assembly while this consistent read
      // holds IndexedDB stores. Every response is already detached by IDB.
      const raw = await transaction([stores.meta, stores.files, stores.records, stores.baseline, stores.assets], 'readonly', async tx => {
        const [meta, files, records, originals, retained] = await Promise.all([
          get(tx, stores.meta, id), all(tx, stores.files, id), all(tx, stores.records, id),
          all(tx, stores.baseline, baseId), get(tx, stores.assets, baseId),
        ]);
        return { meta, files, records, originals, retained };
      });
      return runActivation(materializeActivation(raw, captured));
    }
    async function saveWorkspace(scope, value, options = {}) {
      await ensure(scope);
      return transaction([stores.meta, stores.files, stores.records, stores.baseline, stores.assets, ...(options.revisions?.length ? [revisionStoreName(scope.game)] : [])], 'readwrite', async tx => {
        const current = await readWorkspace(tx, scope, options.filepaths, options.includeDropped);
        const next = typeof value === 'function' ? value(current) : value;
        if (next?.then) throw new Error('Workspace changes must be synchronous.');
        await writeWorkspace(tx, scope, next, options.filepaths);
        for (const revision of options.revisions || []) tx.objectStore(revisionStoreName(scope.game)).add(scopedRevision(revision, scope));
        return next;
      });
    }
    async function importScope(scope, source, workspace, revisions, assets, metadataRows = []) {
      if (!Array.isArray(source)) throw new TypeError('A source import requires its immutable files.');
      W.initializeWorkspace(workspace, { source, sourceHash: scope.sourceHash, game: scope.game, branchId: scope.branchId, accountId: scope.accountId });
      W.pruneWorkspaceStatus(workspace);
      const id = scopeKey(scope), baseId = baselineKey(scope), originals = new Map(source.map(file => [file.filepath, file]));
      const parts = splitWorkspace(scope, workspace, originals);
      await transaction([stores.meta, stores.baseline, stores.assets, stores.files, stores.records, stores.migration, 'kv', revisionStoreName(scope.game)], 'readwrite', async tx => {
        // Existing identities are immutable. An import may update staged facts,
        // but cannot change an accepted source under the same identity.
        const previousAssets = await get(tx, stores.assets, baseId);
        const retainedFiles = await all(tx, stores.baseline, baseId);
        if (previousAssets && !sameBaselineSource(retainedFiles.map(item => item.value), source))
          throw new Error('The imported source differs from its accepted baseline identity.');
        for (const [order, file] of source.entries()) {
          const previous = await get(tx, stores.baseline, key(baseId, file.filepath));
          if (previous && !sameBaselineFile(previous, file)) throw new Error('The imported source differs from its accepted baseline identity.');
          if (!previous) tx.objectStore(stores.baseline).put(row(baseId, file.filepath, file, { order }));
        }
        await writeDifference(tx, stores.files, await all(tx, stores.files, id), parts.files);
        await writeDifference(tx, stores.records, await all(tx, stores.records, id), parts.records);
        tx.objectStore(stores.meta).put({ key: id, scope: id, value: parts.meta });
        if (workspace.importArchive && !assets?.archive && !previousAssets?.archive) throw new Error('The accepted archive assets are required for an atomic source import.');
        const retained = assets ? { ...copy(assets) } : previousAssets || { sourceHash: scope.sourceHash };
        delete retained.source;
        if (!same(previousAssets, retained)) tx.objectStore(stores.assets).put({ key: baseId, scope: baseId, value: retained });
        for (const revision of revisions || []) tx.objectStore(revisionStoreName(scope.game)).add(scopedRevision(revision, scope));
        for (const item of metadataRows) tx.objectStore('kv').put(item);
        tx.objectStore(stores.migration).put({ key: id, scope: id, value: { state: 'ready' } });
      });
    }
    async function assets(scope) {
      await ensure(scope);
      return transaction([stores.assets, stores.baseline], 'readonly', async tx => {
        const value = await get(tx, stores.assets, baselineKey(scope));
        return value && { ...value, source: (await originalRows(tx, scope)).slice().sort((a,b) => (a.order || 0) - (b.order || 0)).map(row => row.value) };
      });
    }
    async function hasScope(scope) {
      return transaction([stores.meta], 'readonly', async tx => !!await get(tx, stores.meta, scopeKey(scope)));
    }
    async function scopeAvailable(scope, legacyAvailable) {
      const id = scopeKey(scope);
      return transaction([stores.meta, stores.migration], 'readonly', async tx => {
        const [meta, marker] = await Promise.all([get(tx, stores.meta, id), get(tx, stores.migration, id)]);
        return marker?.state === 'ready' ? !!meta : !!meta || legacyAvailable;
      });
    }
    async function clearScope(scope) {
      await ensure(scope);
      return transaction([stores.meta, stores.files, stores.records, stores.migration], 'readwrite', async tx => {
        const id = scopeKey(scope);
        for (const name of [stores.files, stores.records]) for (const item of await all(tx, name, id)) tx.objectStore(name).delete(item.key);
        tx.objectStore(stores.meta).delete(id);
        tx.objectStore(stores.migration).put({ key: id, scope: id, value: { state: 'ready', removed: true } });
      });
    }
    function mergeWorkspaceRecords(target, patch) {
      if (!patch?._storageSelection) return patch;
      if (!target) return patch;
      const { filepaths, allDropped } = patch._storageSelection, selected = new Set(filepaths || []), merged = { ...target, ...patch };
      delete merged._storageSelection;
      delete merged._storageArchiveKinds;
      if (target.importArchive && target.importArchive.baselineId === patch.importArchive?.baselineId && !Object.hasOwn(patch.importArchive || {}, 'decisions')) merged.importArchive = target.importArchive;
      if (!Object.hasOwn(patch, 'importRecovery') && Object.hasOwn(target, 'importRecovery')) merged.importRecovery = target.importRecovery;
      const replacement = new Map((patch.descs || []).map(file => [file.filepath, file]));
      merged.descs = (target.descs || []).filter(file => !selected.has(file.filepath)).concat([...replacement.values()]);
      for (const field of fieldMaps) {
        if (allDropped && field.startsWith('dropped')) { merged[field] = copy(patch[field]); continue; }
        if (field === 'droppedOutbox') {
          merged[field] = [...(target[field] || []).filter(item => !selected.has(item.candidate?.filepath || item.filepath)), ...(patch[field] || [])]; continue;
        }
        if (languageMaps.has(field)) {
          merged[field] = copy(target[field] || {});
          for (const language of new Set([...Object.keys(target[field] || {}), ...Object.keys(patch[field] || {})])) {
            const map = merged[field][language] ||= {};
            for (const [entry, value] of Object.entries(map)) if (selected.has(value?.filepath || entry)) delete map[entry];
            Object.assign(map, copy(patch[field]?.[language] || {}));
          }
        } else {
          const map = merged[field] = copy(target[field] || {});
          for (const [entry, value] of Object.entries(map)) if (selected.has(value?.filepath || target.droppedArchive?.[entry]?.filepath || entry)) delete map[entry];
          Object.assign(map, copy(patch[field] || {}));
        }
      }
      return merged;
    }
    async function beginBatch(batch, scope, logical, rooms) {
      await ensure(scope);
      const paths = batch.files.map(file => file.filepath), checkpoint = batch.checkpoint || batch.draft;
      if (checkpoint?.key) await draftGet(checkpoint.key);
      if (batch.collaboration) await rooms.ensureRoom(batch.collaboration.key);
      const db = await openDb(), tx = db.transaction([stores.meta, stores.baseline, stores.files, stores.records, stores.drafts,
        stores.rooms, stores.shared, stores.operations, stores.roomRecords, stores.submissions, stores.receipts, revisionStoreName(scope.game),
        ...(batch.tmCapture?.length ? tmStores : [])], 'readwrite');
      let roomSelection;
      const fail = error => { tx._normalizedError = error; try { tx.abort(); } catch (_) {} };
      const synthetic = work => {
        const req = {};
        Promise.resolve().then(work).then(value => { req.result = { value }; req.onsuccess?.(); }, fail);
        return req;
      };
      const id = scopeKey(scope);
      const kv = {
        get(logicalKey) {
          return synthetic(async () => {
            if (logicalKey === logical.workspace) return readWorkspace(tx, scope, paths);
            if (logicalKey === logical.source) return copy((await Promise.all(paths.map(path => get(tx, stores.baseline, key(baselineKey(scope), path))))).filter(Boolean));
            if (logicalKey === logical.receipts) { const receipt = await get(tx, stores.receipts, key(id, batch.jobId)); return receipt ? [receipt] : []; }
            if (logicalKey === 'collaboration_v1') {
              const read = await rooms.readRoom(tx, batch.collaboration.key, paths, { includeOutbox: 'paths', includeConflicts: true, includeDropped: true });
              roomSelection = read.selection;
              return { rooms: { [batch.collaboration.key]: read.room } };
            }
            return hydrateDraft(tx, await get(tx, stores.drafts, logicalKey));
          });
        },
        put(item) {
          (async () => {
            if (item.key === logical.workspace) return writeWorkspace(tx, scope, item.value, paths);
            if (item.key === 'collaboration_v1') return rooms.writeRoom(tx, batch.collaboration.key, item.value.rooms[batch.collaboration.key], roomSelection?.filepaths || paths, roomSelection?.operationIds);
            if (item.key === logical.receipts) {
              for (const receipt of item.value) tx.objectStore(stores.receipts).put(row(id, receipt.jobId, receipt));
              tx.objectStore(stores.submissions).delete(key(id, batch.jobId));
              if (batch.resetStaging) for (const item of await request(tx.objectStore(stores.submissions).index('by_path').getAll(key(id, batch.language, paths[0]))))
                if (item.value.state === 'review' && item.value.batch.resetStaging) tx.objectStore(stores.submissions).delete(item.key);
              return;
            }
            const original = await get(tx, stores.baseline, key(baselineKey(scope), item.value.filepath));
            tx.objectStore(stores.drafts).put(draftRow(item.value, original));
            if (item.value.state === 'promoted') for (const jobId of new Set([item.value.submissionJobId, ...(item.value.submissionJobIds || [])].filter(Boolean)))
              tx.objectStore(stores.submissions).delete(key(id, jobId));
          })().catch(fail);
        },
      };
      const consumeJournal = () => {
        get(tx, stores.submissions, key(id, batch.jobId)).then(value => {
          if (value) tx.objectStore(stores.submissions).delete(key(id, batch.jobId));
        }).catch(fail);
      };
      return { tx, kv, consumeJournal };
    }
    function draftRow(value, original) {
      const scope = normalizeScope({ accountId: value.profile, game: value.game, branchId: value.branchId, sourceHash: value.sourceHash, ...contentScope(value) });
      const data = copy(value);
      const compact = record => {
        if (!record) return;
        if (record.source && original && record.game === scope.game && record.sourceHash === scope.sourceHash && record.filepath === data.filepath) {
          if (same(record.source, original)) {
            record.sourceRef = { game: record.game, sourceHash: record.sourceHash, filepath: record.filepath }; delete record.source;
          } else delete record.sourceRef;
        }
        for (const variant of [...(record.conflicts || []), ...(record.recovery || [])]) compact(variant);
      };
      compact(data);
      return { key: value.key, scope: scopeKey(scope), profileLanguage: key(value.profile, value.game, value.branchId || 'default', value.language, ...contentParts(scope)),
        scopeLanguage: key(scopeKey(scope), value.language), value: data };
    }
    async function hydrateDraft(tx, value, sources = new Map()) {
      if (!value) return value;
      const record = { ...value };
      if (value.sourceRef) {
        const ref = value.sourceRef, id = key(baselineKey(ref), ref.filepath);
        if (!sources.has(id)) sources.set(id, get(tx, stores.baseline, id));
        record.source = copy(await sources.get(id) || value.source || null);
      }
      for (const field of ['conflicts', 'recovery']) if (value[field]?.length) record[field] = await Promise.all(value[field].map(variant => hydrateDraft(tx, variant, sources)));
      return record;
    }
    async function draftGet(id) {
      // Most files have no draft. Do not put that tiny lookup behind unrelated
      // collaboration transactions that include the baseline store.
      const hasSourceRef = value => !!value?.sourceRef || ['conflicts', 'recovery'].some(field => (value?.[field] || []).some(hasSourceRef));
      const normalized = await transaction([stores.drafts], 'readonly', tx => get(tx, stores.drafts, id));
      if (normalized !== undefined) {
        return hasSourceRef(normalized)
          ? transaction([stores.baseline], 'readonly', tx => hydrateDraft(tx, normalized)) : normalized;
      }
      const transferred = await transaction([stores.migration], 'readonly', tx => get(tx, stores.migration, key('draft', id)));
      if (transferred) return undefined;
      const legacy = await legacyGet(id);
      const transfer = () => transaction([stores.drafts, stores.baseline, stores.migration], 'readwrite', async tx => {
        let current = await get(tx, stores.drafts, id);
        if (legacy && !current) {
          const original = await get(tx, stores.baseline, key(baselineKey(legacy), legacy.filepath));
          const retained = draftRow(legacy, original);
          tx.objectStore(stores.drafts).put(retained);
          current = retained.value;
        }
        tx.objectStore(stores.migration).put({ key: key('draft', id), scope: key('draft', id), value: { state: 'ready' } });
        return hydrateDraft(tx, current);
      });
      if (legacy) return trackMigration('draft', id, { accountId: legacy.profile, game: legacy.game, branchId: legacy.branchId,
        sourceHash: legacy.sourceHash, language: legacy.language }, transfer);
      // Absence needs a readiness marker, but no original. Recheck the draft
      // inside this transaction so another tab's new checkpoint stays visible.
      const current = await transaction([stores.drafts, stores.migration], 'readwrite', async tx => {
        const value = await get(tx, stores.drafts, id);
        tx.objectStore(stores.migration).put({ key: key('draft', id), scope: key('draft', id), value: { state: 'ready' } });
        return value;
      });
      return hasSourceRef(current) ? transaction([stores.baseline], 'readonly', tx => hydrateDraft(tx, current)) : current;
    }
    async function draftUpdate(id, change) {
      await draftGet(id);
      return transaction([stores.drafts, stores.baseline, stores.submissions], 'readwrite', async tx => {
        const current = await hydrateDraft(tx, await get(tx, stores.drafts, id)), result = change(current || null);
        if (result.write !== false) {
          const record = result.record, original = await get(tx, stores.baseline, key(baselineKey(record), record.filepath));
          tx.objectStore(stores.drafts).put(draftRow(record, original));
          if (record.state === 'discarded') for (const jobId of new Set([current?.submissionJobId, ...(current?.submissionJobIds || [])].filter(Boolean)))
            tx.objectStore(stores.submissions).delete(key(scopeKey(normalizeScope({ ...record, accountId: record.profile })), jobId));
        }
        return result;
      });
    }
    async function draftList(scope) {
      // One-time transfer preserves consumed receipts and recovery variants.
      const marker = key('drafts', scope.profile, scope.game, scope.branchId || 'default', scope.language, ...contentParts(scope));
      await transaction([stores.migration], 'readonly', tx => get(tx, stores.migration, marker)).then(async ready => {
        if (ready) return;
        return trackMigration('drafts', marker, { accountId: scope.profile, game: scope.game, branchId: scope.branchId, language: scope.language }, async () => {
          const prefix = 'translation_draft_v1:', range = typeof IDBKeyRange === 'undefined' ? undefined : IDBKeyRange.bound(prefix, prefix + '\uffff');
          const rows = (await transaction(['kv'], 'readonly', tx => request(tx.objectStore('kv').getAll(range))))
            .filter(item => item.key.startsWith(prefix) && item.value.profile === scope.profile && item.value.game === scope.game
              && item.value.language === scope.language && (item.value.branchId || 'default') === (scope.branchId || 'default') && sameContentScope(item.value, scope));
          // Bound each transfer transaction. Readiness follows the final batch;
          // interrupted transfers reuse the rows already copied without rewriting.
          for (let offset = 0; offset < Math.max(rows.length, 1); offset += 128) {
            await transaction([stores.drafts, stores.baseline, stores.migration], 'readwrite', async tx => {
              for (const item of rows.slice(offset, offset + 128)) if (!await get(tx, stores.drafts, item.key)) {
                  const original = await get(tx, stores.baseline, key(baselineKey(item.value), item.value.filepath));
                  tx.objectStore(stores.drafts).put(draftRow(item.value, original));
                }
              if (offset + 128 >= rows.length) tx.objectStore(stores.migration).put({ key: marker, scope: marker, value: { state: 'ready' } });
            });
          }
        });
      });
      return transaction([stores.drafts, stores.baseline], 'readonly', async tx => {
        const rows = scope.sourceHash == null
          ? await request(tx.objectStore(stores.drafts).index('by_profile_lang').getAll(key(scope.profile, scope.game, scope.branchId || 'default', scope.language, ...contentParts(scope))))
          : await request(tx.objectStore(stores.drafts).index('by_scope_language').getAll(key(scopeKey(normalizeScope({ ...scope, accountId: scope.profile })), scope.language)));
        return Promise.all(rows.map(row => hydrateDraft(tx, row.value)).filter(Boolean)).then(values => values.filter(value => (scope.sourceHash == null || value.sourceHash === scope.sourceHash) && sameContentScope(value, scope) && (value.state === 'active' || value.conflicts?.length)));
      });
    }
    async function putSubmission(batch) {
      const scope = normalizeScope(batch.workspaceScope || { ...batch, accountId: batch.accountId || 'guest' }), id = scopeKey(scope);
      await ensure(scope);
      return transaction([stores.submissions, stores.receipts, stores.migration], 'readwrite', async tx => {
        const previous = await get(tx, stores.submissions, key(id, batch.jobId));
        if (previous && !same(previous.batch, batch)) throw new Error('A save identifier cannot be reused for different content.');
        if (previous) return previous;
        const receipt = await get(tx, stores.receipts, key(id, batch.jobId));
        // The worker still verifies the original receipt signature before
        // acknowledging a retry. A completed command needs no new journal.
        if (receipt) return { batch: copy(batch), state: 'completed', createdAt: receipt.createdAt || 0 };
        const sequenceKey = key('submission-order', id), last = await get(tx, stores.migration, sequenceKey);
        const sequence = Number(last?.sequence || 0) + 1;
        if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error('The save submission sequence is invalid.');
        const value = { batch: copy(batch), state: 'queued', createdAt: Date.now(), sequence };
        tx.objectStore(stores.submissions).put(row(id, batch.jobId, value, { paths: batch.files.map(file => key(id, batch.language, file.filepath)) }));
        tx.objectStore(stores.migration).put({ key: sequenceKey, scope: sequenceKey, value: { sequence } });
        return value;
      });
    }
    async function listSubmissions(scope) {
      const normalized = normalizeScope(scope), id = scopeKey(normalized);
      return transaction([stores.submissions], 'readonly', async tx => (await all(tx, stores.submissions, id)).map(row => row.value)
        .filter(value => ['queued', 'pending', 'review'].includes(value.state) && (!scope.language || value.batch.language === scope.language))
        .sort((a,b) => {
          const orderedA = Number.isSafeInteger(a.sequence), orderedB = Number.isSafeInteger(b.sequence);
          if (orderedA && orderedB) return a.sequence - b.sequence;
          if (orderedA !== orderedB) return orderedA ? 1 : -1;
          return a.createdAt - b.createdAt || a.batch.jobId.localeCompare(b.batch.jobId);
        }));
    }
    async function updateSubmission(batch, patch) {
      const scope = normalizeScope(batch.workspaceScope || { ...batch, accountId: batch.accountId || 'guest' }), id = scopeKey(scope);
      return transaction([stores.submissions, stores.drafts, stores.baseline], 'readwrite', async tx => {
        const current = await get(tx, stores.submissions, key(id, batch.jobId));
        if (!current) return;
        if (!same(current.batch, batch)) throw new Error('A submitted save cannot be updated with different content.');
        const value = { ...current, ...copy(patch), batch: current.batch, createdAt: current.createdAt };
        if (!same(value, current)) tx.objectStore(stores.submissions).put(row(id, batch.jobId, value, { paths: batch.files.map(file => key(id, batch.language, file.filepath)) }));
        if (patch.state === 'review' && !batch.resetStaging && batch.files.length === 1) {
          const path = batch.files[0].filepath, checkpoint = batch.checkpoint || batch.draft;
          const draftKey = checkpoint?.key || 'translation_draft_v1:' + key(scope.accountId, scope.game, scope.sourceHash, batch.language, path, ...(scope.branchId === 'default' ? [] : [scope.branchId]), ...contentParts(scope));
          const previous = await hydrateDraft(tx, await get(tx, stores.drafts, draftKey));
          const recovered = { profile: scope.accountId, game: scope.game, sourceHash: scope.sourceHash, language: batch.language, filepath: path,
            ...(scope.branchId === 'default' ? {} : { branchId: scope.branchId }), ...contentScope(scope), key: draftKey, id: 'submission:' + batch.jobId, revision: 'submission:' + batch.jobId,
            state: 'active', submissionJobId: batch.jobId, translations: batch.files[0].translations, base: batch.bases?.[path] || batch.draft?.base || { translations: [] },
            sourceRef: { game: scope.game, sourceHash: scope.sourceHash, filepath: path }, updatedAt: Date.now() };
          const submissionJobIds = [...new Set([previous?.submissionJobId, ...(previous?.submissionJobIds || []), batch.jobId].filter(Boolean))];
          if (!previous || previous.state !== 'active') tx.objectStore(stores.drafts).put(draftRow({ ...recovered, submissionJobIds,
            conflicts: previous?.conflicts || [], recovery: previous?.recovery || [] }));
          else {
            const conflicts = previous.conflicts || [], known = conflicts.some(variant => variant.submissionJobId === batch.jobId);
            const different = !same(previous.translations, recovered.translations) || !same(previous.base, recovered.base);
            const record = { ...previous, submissionJobIds,
              ...(different && !known ? { revision: previous.revision + ':submission:' + batch.jobId, conflicts: [...conflicts, recovered] } : {}) };
            if (!same(record, previous)) {
              const original = await get(tx, stores.baseline, key(baselineKey(scope), path));
              tx.objectStore(stores.drafts).put(draftRow(record, original));
            }
          }
        }
        return value;
      });
    }
    return { stores, dependencies, available, ensure, migrate, workspace, source, activation, saveWorkspace, transaction, get, all, originalFiles, selectedRows, row, key, scopeKey, baselineKey, readWorkspace, writeWorkspace,
      importScope, assets, hasScope, scopeAvailable, clearScope, mergeWorkspaceRecords, beginBatch, fingerprint, normalizeHistory, trackMigration,
      draftGet, draftUpdate, draftList, draftRow, hydrateDraft, putSubmission, listSubmissions, updateSubmission, copy, same,
      tmStores, tmCapture, getTranslationMemory, getTranslationMemoryState, putTranslationMemoryUnits, deleteTranslationMemoryUnit, getTranslationMemoryPending,
      applyTranslationMemoryRemote, acknowledgeTranslationMemoryWrite, rejectTranslationMemoryWrite, resolveTranslationMemoryConflict,
      listTranslationMemoryHistory, adoptTranslationMemoryProfile, resetTranslationMemoryBootstrap };
  }
  return { stores, names, upgrade, create, scopeKey, baselineKey, baselineFile, sameBaselineFile, sameBaselineSource };
});
