/* Scoped collaboration persistence. Complete rooms are materialized read views. */
(function (root, factory) {
  const api = factory(() => typeof module === 'object' && module.exports ? require('./collaborationProtocol.js') : root.CollaborationProtocol);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NormalizedRooms = api;
})(typeof window === 'object' ? window : typeof self === 'object' ? self : globalThis, function (protocol) {
  'use strict';
  function create(n) {
    const { stores: S, transaction, get, all, row, key, copy, same, readWorkspace, writeWorkspace } = n;
    const dependencies = n.dependencies || {}, ready = new Set(), migrating = new Map();
    const request = req => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    const roomStores = [S.rooms, S.shared, S.operations, S.roomRecords];
    const workspaceStores = [S.meta, S.files, S.records, S.baseline];
    const maps = ['shared', 'local', 'carries', 'carryRevisions'];
    const arrays = ['outbox', 'conflicts', 'recovery', 'placeholderRepairs'];
    const identityKey = identity => key(...((identity.branchId || 'default') === 'default'
      ? [String(identity.accountId), identity.game, identity.sourceHash, identity.language]
      : [String(identity.accountId), identity.game, identity.branchId, identity.sourceHash, identity.language]));
    function identityFromKey(roomKey) {
      const values = JSON.parse(roomKey);
      return values.length === 4 ? { accountId: values[0], game: values[1], branchId: 'default', sourceHash: values[2], language: values[3] }
        : { accountId: values[0], game: values[1], branchId: values[2], sourceHash: values[3], language: values[4] };
    }
    const scopeOf = identity => dependencies.normalizeScope ? dependencies.normalizeScope(identity) : identity;
    function commandIdentity(command) {
      const identity = identityFromKey(command.key), supplied = command.scope;
      if (supplied && (String(supplied.accountId || 'guest') !== String(identity.accountId)
        || supplied.game !== identity.game || (supplied.branchId || 'default') !== identity.branchId
        || supplied.sourceHash !== identity.sourceHash || (supplied.language && supplied.language !== identity.language))) {
        throw Object.assign(new Error('Collaboration storage scope changed.'), { stale: true });
      }
      return identity;
    }
    const markerKey = roomKey => key('room', roomKey);
    const stripInternal = entry => { const value = copy(entry); delete value.localRecordId; delete value._storageRecovery; return value; };
    function metadata(room) {
      const result = {};
      for (const [field, value] of Object.entries(room || {})) if (!maps.includes(field) && !arrays.includes(field) && field !== 'manifest') result[field] = value;
      if (room?.manifest) { const { files, ...meta } = room.manifest; result.manifest = copy(meta); }
      if (result.archive) { const { decisions, ...descriptor } = result.archive; result.archive = copy(descriptor); }
      if (result.seedUpload) {
        const { files, ...ticket } = result.seedUpload; result.seedUpload = copy(ticket);
        if (Array.isArray(files)) result._seedUploadFiles = true;
      } else delete result._seedUploadFiles;
      return result;
    }
    function restorePlaceholderRepairs(room, workspace, originals) {
      const identity = room.identity, account = workspace?.accountId || workspace?.collaborationAccountId;
      if (room.mode !== 'sparse' || !workspace || workspace.sourceHash !== identity.sourceHash
        || String(account || '') !== String(identity.accountId) || (workspace.game && workspace.game !== identity.game)
        || (workspace.branchId || 'default') !== (identity.branchId || 'default')) return;
      const empty = lines => Array.isArray(lines) && lines.every(text => text === '');
      const canceled = new Set();
      for (const [id, repair] of Object.entries(workspace.placeholderRepairArchive || {})) {
        const original = originals.get(repair.filepath), count = original?.translations?.English?.length, staged = repair.staged;
        if (repair.status !== 'pending' || repair.sourceHash !== identity.sourceHash || repair.language !== identity.language
          || !count || (original.translations?.[identity.language] || []).length || !staged
          || staged.sourceHash !== identity.sourceHash || !empty(staged.translations) || staged.translations.length !== count
          || !Array.isArray(staged.before) || staged.before.length || (staged.saveOrigin && staged.saveOrigin !== 'legacy_inferred')) continue;
        const shared = room.shared?.[repair.filepath];
        if (shared && (shared.revision !== 1 || !shared.trackedForExport || shared.needsReview || !empty(shared.translations))) continue;
        room.placeholderRepairs ||= [];
        if (!room.placeholderRepairs.some(item => item.id === id)) room.placeholderRepairs.push({ id, filepath: repair.filepath, baseRevision: 1 });
        for (const operation of room.outbox || []) if (operation.kind === 'join' && operation.origin === 'merge'
          && !operation.promoteDropped && !operation.restore && operation.files?.length === 1
          && operation.files.every(entry => entry.yours?.filepath === repair.filepath && entry.yours.trackedForExport && !entry.yours.needsReview
            && empty(entry.yours.translations) && entry.yours.translations.length === count && entry.base?.revision === 0
            && !entry.base.trackedForExport && !entry.base.needsReview && empty(entry.base.translations))) canceled.add(operation.id);
        if (!shared && room.local) delete room.local[repair.filepath];
      }
      room.outbox = (room.outbox || []).filter(operation => !canceled.has(operation.id));
      room.conflicts = (room.conflicts || []).filter(conflict => !canceled.has(conflict.mutationId));
    }
    async function restoreDurablePlaceholderRepairs(room, scope) {
      const evidence = await transaction([S.meta, S.records, S.baseline], 'readonly', async tx => {
        const id = n.scopeKey(scope), meta = await get(tx, S.meta, id);
        const rows = await request(tx.objectStore(S.records).index('by_kind').getAll(key(id, 'placeholderRepairArchive')));
        const originals = (await Promise.all(rows.map(item => get(tx, S.baseline, key(n.baselineKey(scope), item.value.data.filepath))))).filter(Boolean);
        return { workspace: meta && { ...meta, placeholderRepairArchive: Object.fromEntries(rows.map(item => [item.value.entry, item.value.data])) },
          originals: new Map(originals.map(file => [file.filepath, file])) };
      });
      restorePlaceholderRepairs(room, evidence.workspace, evidence.originals);
    }
    function split(roomKey, room) {
      const files = new Map(), operations = [], records = [];
      const file = path => { if (!files.has(path)) files.set(path, { filepath: path }); return files.get(path); };
      for (const item of room.manifest?.files || []) file(item.filepath).manifest = copy(item);
      for (const [path, value] of Object.entries(room.shared || {})) file(path).shared = copy(value);
      const record = (field, id, value, paths, extra = {}) => records.push(row(roomKey, [field, id], { field, entry: id, data: copy(value), ...extra },
        { paths: [...new Set(paths)].map(path => key(roomKey, path)), kindScope: key(roomKey, field) }));
      for (const field of ['carries', 'carryRevisions']) for (const [path, value] of Object.entries(room[field] || {})) record(field, path, value, [path]);
      for (const item of room.conflicts || []) record('conflicts', item.id, item, [item.filepath]);
      for (const item of room.placeholderRepairs || []) record('placeholderRepairs', item.id, item, [item.filepath]);
      for (const [order, item] of (room.seedUpload?.files || []).entries()) record('seedUploadFiles', item.filepath, item, [], { order });
      for (let index = 0; index < (room.recovery || []).length; index++) {
        const item = room.recovery[index], id = item.localRecordId || item.id || ('recovery:' + globalThis.crypto.randomUUID());
        item.localRecordId = id;
        const files = item.files || [], hint = item._storageRecovery || {};
        const { files: ignored, ...group } = stripInternal(item);
        record('recovery', id, group, [], { order: hint.order ?? index + 1, fileCount: hint.fileCount ?? files.length,
          nextFileOrder: hint.nextFileOrder ?? files.length });
        for (const [index, file] of files.entries()) {
          const order = hint.fileOrders?.[index] ?? index;
          record('recoveryFiles', [id, order], file, [file.filepath], { groupId: id, order });
        }
      }
      for (const operation of room.outbox || []) operations.push(row(roomKey, operation.id, operation,
        { paths: [...new Set((operation.files || []).map(entry => key(roomKey, entry.yours.filepath)))] }));
      return { meta: metadata(room), files: [...files].map(([path, value]) => row(roomKey, path, value,
        { pathKey: key(roomKey, path) })), operations, records };
    }
    async function differences(tx, name, previous, next) {
      const before = new Map(previous.map(item => [item.key, item])), after = new Map(next.map(item => [item.key, item])), store = tx.objectStore(name);
      for (const [id, item] of after) if (!same(before.get(id), item)) store.put(item);
      for (const id of before.keys()) if (!after.has(id)) store.delete(id);
    }
    async function selectRows(tx, roomKey, requestedPaths, options = {}) {
      if (requestedPaths == null) {
        const [files, operations, records] = await Promise.all([all(tx, S.shared, roomKey), all(tx, S.operations, roomKey), all(tx, S.roomRecords, roomKey)]);
        return { files, operations, records, paths: [...new Set([...files.map(item => item.value.filepath),
          ...operations.flatMap(item => item.value.files.map(entry => entry.yours.filepath)),
          ...records.filter(item => item.value.field === 'recoveryFiles').map(item => item.value.data.filepath)])],
        ids: [...new Set([...(options.operationIds || []), ...operations.map(item => item.value.id)])] };
      }
      const paths = new Set(requestedPaths), ids = new Set(options.operationIds || []), operations = new Map(), records = new Map();
      const loadedPaths = new Set(), loadedIds = new Set();
      for (;;) {
        const nextIds = [...ids].filter(id => !loadedIds.has(id)), nextPaths = [...paths].filter(path => !loadedPaths.has(path));
        if (!nextIds.length && !nextPaths.length) break;
        nextIds.forEach(id => loadedIds.add(id)); nextPaths.forEach(path => loadedPaths.add(path));
        const operationRows = (await Promise.all([
          ...nextIds.map(id => request(tx.objectStore(S.operations).get(key(roomKey, id)))),
          ...(options.includeOutbox === false ? [] : nextPaths.map(path => request(tx.objectStore(S.operations).index('by_path').getAll(key(roomKey, path))))),
        ])).flat().filter(Boolean);
        const recordRows = (await Promise.all(nextPaths.map(path => request(tx.objectStore(S.roomRecords).index('by_path').getAll(key(roomKey, path)))))).flat();
        for (const item of operationRows) {
          operations.set(item.key, item); ids.add(item.value.id);
          for (const entry of item.value.files || []) paths.add(entry.yours.filepath);
        }
        for (const item of recordRows) {
          if (item.value.field === 'conflicts' && options.includeConflicts === false) continue;
          records.set(item.key, item);
        }
      }
      // A disconnected-room recovery can contain the entire source. Read its
      // small header without expanding its unrelated per-file members.
      const groups = [...new Set([...records.values()].filter(item => item.value.field === 'recoveryFiles').map(item => item.value.groupId))];
      for (const item of (await Promise.all(groups.map(id => request(tx.objectStore(S.roomRecords).get(key(roomKey, ['recovery', id])))))).filter(Boolean)) records.set(item.key, item);
      const files = (await Promise.all([...paths].map(path => request(tx.objectStore(S.shared).get(key(roomKey, path)))))).filter(Boolean);
      return { files, operations: [...operations.values()], records: [...records.values()], paths: [...paths], ids: [...ids] };
    }
    async function readRoom(tx, roomKey, paths, options = {}) {
      const meta = await get(tx, S.rooms, roomKey);
      if (!meta) return { room: null, selection: { filepaths: paths || [], operationIds: options.operationIds || [] } };
      const selected = await selectRows(tx, roomKey, paths, options);
      const room = { ...copy(meta), shared: {}, local: {}, carries: {}, carryRevisions: {}, outbox: [], conflicts: [], recovery: [], placeholderRepairs: [] };
      if (paths == null && room.archive) {
        const assets = await get(tx, S.assets, n.baselineKey(scopeOf(room.identity)));
        if (!assets?.archive || assets.archive.baselineId !== room.archive.baselineId) throw Object.assign(
          new Error('The accepted collaboration archive descriptor is unavailable. Import its matching original ZIP to finish conversion.'),
          { code: 'ROOM_SOURCE_UNAVAILABLE' });
        room.archive = copy(assets.archive);
      }
      if (meta.manifest) room.manifest = { ...copy(meta.manifest), files: [] };
      for (const item of selected.files) {
        if (item.value.shared) room.shared[item.value.filepath] = copy(item.value.shared);
        if (item.value.manifest && room.manifest) room.manifest.files.push(copy(item.value.manifest));
      }
      room.outbox = selected.operations.map(item => copy(item.value)).sort((left, right) => (left.localOrder || 0) - (right.localOrder || 0));
      const seedFiles = [], recoveryGroups = new Map(), recoveryFiles = new Map();
      for (const item of selected.records) {
        const { field, entry, data } = item.value;
        if (field === 'seedUploadFiles') seedFiles.push(item.value);
        else if (field === 'recovery') recoveryGroups.set(entry, { ...copy(data), files: [], localRecordId: entry,
          _storageRecovery: { order: item.value.order, fileCount: item.value.fileCount, nextFileOrder: item.value.nextFileOrder, fileOrders: [] } });
        else if (field === 'recoveryFiles') {
          const group = recoveryFiles.get(item.value.groupId) || []; group.push(item.value); recoveryFiles.set(item.value.groupId, group);
        }
        else if (Array.isArray(room[field])) room[field].push(copy(data));
        else if (room[field]) room[field][entry] = copy(data);
      }
      for (const [id, group] of recoveryGroups) for (const item of (recoveryFiles.get(id) || []).sort((left, right) => left.order - right.order)) {
        group.files.push(copy(item.data)); group._storageRecovery.fileOrders.push(item.order);
      }
      room.recovery = [...recoveryGroups.values()].sort((left, right) => left._storageRecovery.order - right._storageRecovery.order);
      if (paths == null && room.seedUpload && room._seedUploadFiles) room.seedUpload.files = seedFiles
        .sort((left, right) => left.order - right.order).map(item => copy(item.data));
      const scope = scopeOf(room.identity);
      const [workspace, originals] = await Promise.all([
        readWorkspace(tx, scope, selected.paths, options.includeDropped === true),
        Promise.all(selected.paths.map(path => get(tx, S.baseline, key(n.baselineKey(scope), path)))),
      ]);
      const baselineByPath = new Map(originals.filter(Boolean).map(desc => [desc.filepath, desc]));
      const descriptions = new Map((workspace?.descs || []).map(desc => [desc.filepath, desc])), P = protocol();
      const pending = new Set(room.outbox.flatMap(operation => operation.files.map(entry => entry.yours.filepath)));
      for (const path of selected.paths) {
        const shared = room.shared[path], desc = descriptions.get(path), staged = workspace?.staged?.[room.identity.language]?.[path];
        if (shared) room.local[path] = copy(shared);
        if (staged && !pending.has(path)) room.local[path] = { ...(shared || { filepath: path, revision: 0 }),
          translations: copy(staged.translations), needsReview: false, trackedForExport: true };
        else if (!shared && staged) room.local[path] = { filepath: path, translations: copy(staged.translations), revision: 0, needsReview: false, trackedForExport: true };
        if (!room.local[path] && desc && room.mode !== 'sparse') room.local[path] = P.fileState({ filepath: path,
          translations: desc.translations?.[room.identity.language] || [], revision: 0 }, desc.translations?.English?.length);
      }
      for (const operation of room.outbox) for (const entry of operation.files) {
        const path = entry.yours.filepath, desc = baselineByPath.get(path);
        const baseline = desc && P.fileState({ filepath: path, translations: desc.translations?.[room.identity.language] || [], revision: 0 }, desc.translations?.English?.length);
        const shared = room.local[path] || baseline;
        room.local[path] = shared ? P.mergeFile(entry.base, entry.yours, shared).file : copy(entry.yours);
        if (shared?.stagingReset && operation.kind !== 'join' && !operation.resetStaging) {
          room.local[path].trackedForExport = true; delete room.local[path].stagingReset;
        }
      }
      return { room, selection: { filepaths: selected.paths, operationIds: selected.ids }, workspace };
    }
    async function writeRoom(tx, roomKey, room, paths, operationIds) {
      if (!room) return;
      const previousMeta = await get(tx, S.rooms, roomKey), selected = await selectRows(tx, roomKey, paths,
        { operationIds, includeOutbox: 'paths', includeConflicts: true });
      const previousOperations = new Map(selected.operations.map(item => [item.value.id, item.value]));
      let nextOrder = Number(previousMeta?.nextOperationOrder || 0);
      for (const operation of room.outbox || []) {
        const previous = previousOperations.get(operation.id);
        operation.localOrder = previous?.localOrder || operation.localOrder || ++nextOrder;
        nextOrder = Math.max(nextOrder, operation.localOrder);
      }
      room.nextOperationOrder = nextOrder;
      room.pendingCount = Math.max(0, Number(previousMeta?.pendingCount || 0) - selected.operations.length + (room.outbox || []).length);
      // Partial commands can each append the first recovery entry during the
      // same millisecond. Its durable identity must not depend on array order.
      for (const entry of room.recovery || []) entry.localRecordId ||= entry.id || ('recovery:' + globalThis.crypto.randomUUID());
      const previousGroups = new Map(selected.records.filter(item => item.value.field === 'recovery').map(item => [item.value.entry, item]));
      const previousMembers = new Map();
      for (const item of selected.records.filter(item => item.value.field === 'recoveryFiles')) {
        const list = previousMembers.get(item.value.groupId) || []; list.push(item); previousMembers.set(item.value.groupId, list);
      }
      let nextRecoveryOrder = Number(previousMeta?.nextRecoveryOrder || 0);
      for (const entry of room.recovery || []) {
        const id = entry.localRecordId;
        let previous = previousGroups.get(id);
        if (!previous) previous = await request(tx.objectStore(S.roomRecords).get(key(roomKey, ['recovery', id])));
        if (previous) previousGroups.set(id, previous);
        const members = (previousMembers.get(id) || []).slice().sort((left, right) => left.value.order - right.value.order);
        const remaining = members.slice(), hint = entry._storageRecovery || {}, fileOrders = [];
        let nextFileOrder = Number(previous?.value.nextFileOrder ?? hint.nextFileOrder ?? 0);
        for (const [index, file] of (entry.files || []).entries()) {
          // Keep a member's order when callbacks replace its text or filter the
          // selected list. The hint alone is insufficient after a filter.
          let match = remaining.findIndex(item => item.value.order === hint.fileOrders?.[index] && same(item.value.data, file));
          if (match < 0) match = remaining.findIndex(item => same(item.value.data, file));
          if (match < 0) match = remaining.findIndex(item => item.value.data.filepath === file.filepath);
          const order = match < 0 ? nextFileOrder++ : remaining.splice(match, 1)[0].value.order;
          fileOrders.push(order); nextFileOrder = Math.max(nextFileOrder, order + 1);
        }
        entry._storageRecovery = { order: previous?.value.order ?? hint.order ?? ++nextRecoveryOrder,
          fileCount: Math.max(0, Number(previous?.value.fileCount || 0) - members.length + (entry.files || []).length), nextFileOrder, fileOrders };
        nextRecoveryOrder = Math.max(nextRecoveryOrder, entry._storageRecovery.order);
      }
      room.nextRecoveryOrder = nextRecoveryOrder;
      const parts = split(roomKey, room), meta = parts.meta;
      // Removing the selected members must not delete the other members of a
      // group. Its count lets us update/delete the header without reading them.
      const returnedGroups = new Set((room.recovery || []).map(entry => entry.localRecordId));
      for (const [id, previous] of previousGroups) if (!returnedGroups.has(id)) {
        const fileCount = previous.value.fileCount - (previousMembers.get(id) || []).length;
        if (fileCount > 0) parts.records.push({ ...copy(previous), value: { ...copy(previous.value), fileCount } });
      }
      if (!same(previousMeta, meta)) tx.objectStore(S.rooms).put({ key: roomKey, scope: roomKey, value: meta });
      await differences(tx, S.shared, selected.files, parts.files);
      await differences(tx, S.operations, selected.operations, parts.operations);
      await differences(tx, S.roomRecords, selected.records, parts.records);
      return room;
    }
    async function ensureRoom(roomKey, identity, suppliedLegacy) {
      if (ready.has(roomKey)) return;
      if (migrating.has(roomKey)) return migrating.get(roomKey);
      const work = (async () => {
        const marker = await transaction([S.migration], 'readonly', tx => get(tx, S.migration, markerKey(roomKey)));
        if (marker?.state === 'ready') { ready.add(roomKey); return; }
        let legacy = suppliedLegacy === undefined ? (await dependencies.legacyGet('collaboration_v1'))?.rooms?.[roomKey] : suppliedLegacy;
        if (!legacy) {
          await transaction([S.migration], 'readwrite', async tx => tx.objectStore(S.migration).put({ key: markerKey(roomKey), scope: roomKey, value: { state: 'ready' } }));
          ready.add(roomKey); return;
        }
        identity = legacy.identity || identity;
        try { await n.ensure(scopeOf(identity)); }
        catch (error) {
          if (error.code === 'SOURCE_UNAVAILABLE' || /^(The original source is unavailable\.|The accepted baseline evidence is incomplete\.)/.test(error.message || ''))
            error.code = 'ROOM_SOURCE_UNAVAILABLE';
          throw error;
        }
        if (n.hasScope && !await n.hasScope(scopeOf(identity))) throw Object.assign(
          new Error('The matching original source is unavailable for this collaboration cache. Import its original ZIP to finish conversion. Existing recovery data has been retained.'),
          { code: 'ROOM_SOURCE_UNAVAILABLE' });
        const prepared = dependencies.preparedRoom?.(scopeOf(identity), roomKey);
        legacy = prepared || legacy;
        const room = copy(legacy);
        // Workspace readiness may have survived a crash before room conversion.
        // Rebuild the canceled joins and stable repair queue from durable facts.
        if (!prepared) await restoreDurablePlaceholderRepairs(room, scopeOf(identity));
        for (let index = 0; index < (room.recovery || []).length; index++) {
          const recovery = room.recovery[index]; recovery.localRecordId ||= recovery.id || ('legacy:' + index);
          recovery._storageRecovery = { order: index + 1, fileCount: recovery.files?.length || 0,
            nextFileOrder: recovery.files?.length || 0, fileOrders: (recovery.files || []).map((file, index) => index) };
        }
        room.nextRecoveryOrder = room.recovery?.length || 0;
        const parts = split(roomKey, room);
        // In-memory repair preparation and crash recovery can enumerate the
        // same durable repair IDs in different orders. Batch identities remain
        // stable across that boundary so unfinished conversion can resume.
        parts.records.sort((left, right) => left.key.localeCompare(right.key));
        let ordinal = 0;
        for (const operation of parts.operations) { operation.value.localOrder ||= ++ordinal; ordinal = Math.max(ordinal, operation.value.localOrder); }
        parts.meta.nextOperationOrder = ordinal; parts.meta.pendingCount = parts.operations.length;
        const fingerprint = await n.fingerprint(parts);
        const entries = [...parts.files.map(value => [S.shared, value]),
          ...parts.operations.map(value => [S.operations, value]), ...parts.records.map(value => [S.roomRecords, value])];
        let start = marker?.fingerprint === fingerprint ? marker.offset || 0 : 0;
        let completedElsewhere = false;
        if (start === 0) completedElsewhere = await transaction([...roomStores, S.migration], 'readwrite', async tx => {
          if ((await get(tx, S.migration, markerKey(roomKey)))?.state === 'ready') return true;
          for (const name of [S.shared, S.operations, S.roomRecords]) for (const item of await all(tx, name, roomKey)) tx.objectStore(name).delete(item.key);
          tx.objectStore(S.migration).put({ key: markerKey(roomKey), scope: roomKey, value: { state: 'converting', offset: 0, fingerprint } });
        });
        if (completedElsewhere) { ready.add(roomKey); return; }
        for (; start < entries.length; start += 64) {
          const batch = entries.slice(start, start + 64);
          completedElsewhere = await transaction([...new Set(batch.map(item => item[0])), S.migration], 'readwrite', async tx => {
            if ((await get(tx, S.migration, markerKey(roomKey)))?.state === 'ready') return true;
            for (const [name, value] of batch) tx.objectStore(name).put(value);
            tx.objectStore(S.migration).put({ key: markerKey(roomKey), scope: roomKey, value: { state: 'converting', offset: start + batch.length, fingerprint } });
          });
          if (completedElsewhere) { ready.add(roomKey); return; }
        }
        await transaction([...roomStores, ...workspaceStores, S.assets, S.migration], 'readwrite', async tx => {
          if ((await get(tx, S.migration, markerKey(roomKey)))?.state === 'ready') return;
          const [files, operations, records] = await Promise.all([all(tx, S.shared, roomKey), all(tx, S.operations, roomKey), all(tx, S.roomRecords, roomKey)]);
          const byKey = values => values.slice().sort((a, b) => a.key.localeCompare(b.key));
          if (!same(byKey(files), byKey(parts.files)) || !same(byKey(operations), byKey(parts.operations)) || !same(byKey(records), byKey(parts.records)))
            throw new Error('Collaboration conversion verification failed. Original recovery data has been retained.');
          tx.objectStore(S.rooms).put({ key: roomKey, scope: roomKey, value: parts.meta });
          const restored = await readRoom(tx, roomKey);
          const recoveries = Object.values(legacy.local || {}).filter(file => !same(file.translations, restored.room.local[file.filepath]?.translations));
          // Divergent cached local text has no independent authority, but must
          // remain recoverable when converting an older cache.
          if (recoveries.length) {
            const recovery = { id: 'normalized-cache:' + roomKey, at: 0, reason: 'Preserved local collaboration cache before storage conversion', files: copy(recoveries) };
            recovery._storageRecovery = { order: ++parts.meta.nextRecoveryOrder, fileCount: recoveries.length,
              nextFileOrder: recoveries.length, fileOrders: recoveries.map((file, index) => index) };
            for (const item of split(roomKey, { recovery: [recovery] }).records) tx.objectStore(S.roomRecords).put(item);
            tx.objectStore(S.rooms).put({ key: roomKey, scope: roomKey, value: parts.meta });
          }
          tx.objectStore(S.migration).put({ key: markerKey(roomKey), scope: roomKey, value: { state: 'ready' } });
        });
        ready.add(roomKey);
      })();
      migrating.set(roomKey, work);
      try { await work; } finally { migrating.delete(roomKey); }
    }
    function commandStores(options = {}, cold = false) {
      const names = [...roomStores, ...workspaceStores];
      if (cold) names.push(S.assets);
      if (options.revisions?.length) names.push(dependencies.revisionStoreName(options.version || options.scope?.game));
      return names;
    }
    async function getRecords(command) {
      const identity = commandIdentity(command);
      await ensureRoom(command.key, identity);
      return transaction(commandStores(command, command.filepaths == null), 'readonly', tx => readRoom(tx, command.key, command.filepaths, command));
    }
    async function updateRecords(command, update, options = {}) {
      const identity = commandIdentity(command);
      await ensureRoom(command.key, identity);
      const scope = scopeOf(identity);
      await n.ensure(scope);
      return transaction(commandStores(options, command.filepaths == null), 'readwrite', async tx => {
        const result = await readRoom(tx, command.key, command.filepaths, command), state = { version: 1, rooms: {} };
        if (result.room) state.rooms[command.key] = result.room;
        const updated = update(state, result.room);
        if (updated?.then) throw new Error('Collaboration commands must be synchronous.');
        const finalState = updated || state, room = finalState.rooms[command.key];
        let workspace = result.workspace;
        if (Object.hasOwn(options, 'workspace')) workspace = copy(options.workspace);
        if (options.projectWorkspace) workspace = options.projectWorkspace(workspace, finalState);
        if (workspace?.then) throw new Error('Workspace projection must be synchronous.');
        const paths = result.selection.filepaths;
        for (const entry of room?.outbox || []) for (const file of entry.files || []) if (!paths.includes(file.yours.filepath)) paths.push(file.yours.filepath);
        for (const operation of room?.outbox || []) if (!result.selection.operationIds.includes(operation.id)) result.selection.operationIds.push(operation.id);
        if (workspace !== undefined && (options.projectWorkspace || Object.hasOwn(options, 'workspace'))) await writeWorkspace(tx, scope, workspace, command.filepaths == null ? undefined : paths);
        await writeRoom(tx, command.key, room, command.filepaths == null ? undefined : paths, result.selection.operationIds);
        for (const revision of options.revisions || []) tx.objectStore(dependencies.revisionStoreName(scope.game)).add(dependencies.scopedRevision(revision, scope));
        return { room, selection: result.selection, workspace };
      });
    }
    async function getState(options = {}) {
      const roomKey = options.key || (options.scope?.language ? identityKey(options.scope) : null);
      if (roomKey) { const result = await getRecords({ key: roomKey, scope: options.scope }); return { version: 1, rooms: result.room ? { [roomKey]: result.room } : {} }; }
      const legacy = await dependencies.legacyGet('collaboration_v1');
      for (const [id, room] of Object.entries(legacy?.rooms || {})) try { await ensureRoom(id, room.identity, room); }
        catch (error) { if (error.code !== 'ROOM_SOURCE_UNAVAILABLE') throw error; }
      const metadataRows = await transaction([S.rooms], 'readonly', tx => request(tx.objectStore(S.rooms).getAll()));
      const result = { version: 1, rooms: {} };
      for (const item of metadataRows) result.rooms[item.key] = (await getRecords({ key: item.key, scope: item.value.identity })).room;
      return result;
    }
    async function updateState(update, options = {}) {
      if (options.roomKey || options.scope?.language) {
        const id = options.roomKey || identityKey(options.scope), scope = { ...identityFromKey(id), ...options.scope };
        const result = await updateRecords({ key: id, scope, command: 'materialized-room' }, update, options);
        return { version: 1, rooms: result.room ? { [id]: result.room } : {} };
      }
      throw new Error('Collaboration writes require an explicit account, game, branch, source and language scope.');
    }
    return { stores: commandStores({}, true), roomStores, workspaceStores, identityKey, identityFromKey, ensureRoom, readRoom, writeRoom, restorePlaceholderRepairs,
      getState, updateState, getRecords, updateRecords };
  }
  return { create };
});
