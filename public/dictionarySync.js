(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DictionarySync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const copy = value => value == null ? null : JSON.parse(JSON.stringify(value));
  const comparable = (name, value) => name === 'gameScope' && value === 'all' ? undefined : value;
  const equal = (left, right) => JSON.stringify(left, comparable) === JSON.stringify(right, comparable);
  const key = value => String(value ?? '').trim().toLowerCase();
  const string = value => String(value ?? '');
  const ids = rows => rows.map(row => row._id);
  const index = rows => new Map(rows.map(row => [row._id, row]));

  function gameScope(entry) {
    if (!Object.hasOwn(entry, 'gameScope')) return 'all';
    if (!['all', 'poe1', 'poe2'].includes(entry.gameScope)) throw new Error('Invalid Dictionary game scope. Choose PoE1, PoE2, or All.');
    return entry.gameScope;
  }

  // Legacy absence remains absent. An explicit All is a deliberate reset of
  // a saved game restriction, and must survive into the outgoing request.
  const scopeField = (scope, explicit = false) => scope === 'all' && !explicit ? {} : { gameScope: scope };
  const entryKey = entry => key(entry.find) + '\u0000' + gameScope(entry);

  function hash(value) {
    let result = 2166136261;
    for (const character of value) {
      result ^= character.codePointAt(0);
      result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(36);
  }

  const reservedIds = values => new Set(values.filter(value => value && typeof value === 'object' && value._id != null && string(value._id) !== '').map(value => string(value._id)));

  function uniqueId(raw, fallback, used, reserved) {
    const existing = raw != null && string(raw) !== '';
    const requested = existing ? string(raw) : fallback;
    let value = requested;
    let suffix = 2;
    while (used.has(value) || ((!existing || value !== requested) && reserved.has(value))) value = requested + '~' + suffix++;
    used.add(value);
    return value;
  }

  function normalizedId(raw, value, prefix, position, used, reserved) {
    const fallback = raw == null || string(raw) === '' ? prefix + hash(JSON.stringify(value)) + '_' + position : '';
    return uniqueId(raw, fallback, used, reserved);
  }

  // Keep the editor's schema and raw text. Normalized Find is for initial
  // identity matching only, never a replacement for the user's stored wording.
  function normalizeEntries(values) {
    const sourceEntries = Array.isArray(values) ? values : [];
    const usedEntries = new Set();
    const reservedEntries = reservedIds(sourceEntries);
    return sourceEntries.filter(value => value && typeof value === 'object').map((value, position) => {
      const entry = {
        _id: normalizedId(value._id, value, 'd_sync_', position, usedEntries, reservedEntries),
        find: string(value.find),
        replace: string(value.replace),
        alts: [],
        ...scopeField(gameScope(value), Object.hasOwn(value, 'gameScope')),
        tlnote: string(value.tlnote)
      };
      const sourceRows = Array.isArray(value.alts) ? value.alts : [];
      const usedRows = new Set();
      const reservedRows = reservedIds(sourceRows);
      entry.alts = sourceRows.filter(row => row && typeof row === 'object').map((row, rowPosition) => ({
        _id: normalizedId(row._id, row, 'a_sync_', rowPosition, usedRows, reservedRows),
        find: string(row.find),
        replace: row.replace == null ? entry.replace : string(row.replace)
      }));
      return entry;
    });
  }

  function findCounts(rows, identityKey = row => key(row.find)) {
    const counts = new Map();
    for (const row of rows) {
      const name = identityKey(row);
      if (name) counts.set(name, (counts.get(name) || 0) + 1);
    }
    return counts;
  }

  function alignInitialRows(local, remote, identityKey = row => key(row.find)) {
    const remoteById = index(remote);
    const localCounts = findCounts(local, identityKey);
    const remoteCounts = findCounts(remote, identityKey);
    const remoteByFind = new Map(remote.map(row => [identityKey(row), row]));
    const claimed = new Set(local.filter(row => remoteById.has(row._id)).map(row => row._id));
    return local.map(row => {
      if (remoteById.has(row._id)) return row;
      const name = identityKey(row);
      const match = remoteByFind.get(name);
      if (!key(row.find) || localCounts.get(name) !== 1 || remoteCounts.get(name) !== 1 || !match || claimed.has(match._id)) return row;
      claimed.add(match._id);
      return { ...row, _id: match._id };
    });
  }

  function alignInitialEntries(local, remote) {
    const aligned = alignInitialRows(local, remote, entryKey);
    const remoteById = index(remote);
    return aligned.map(entry => {
      const match = remoteById.get(entry._id);
      return match ? { ...entry, alts: alignInitialRows(entry.alts, match.alts) } : entry;
    });
  }

  function scalar(base, local, remote, hasBase, isFind = false) {
    if (local === remote) return { local, remote, conflict: false };
    if (hasBase) {
      if (local === base) return { local: remote, remote, conflict: false };
      if (remote === base) return { local, remote: local, conflict: false };
    } else {
      // On first attachment, blank values are not evidence of a deliberate
      // deletion. Existing cloud spelling wins case-only identity differences.
      if (isFind && key(local) && key(local) === key(remote)) return { local: remote, remote, conflict: false };
      if (!local.trim()) return { local: remote, remote, conflict: false };
      if (!remote.trim()) return { local, remote: local, conflict: false };
    }
    return { local, remote, conflict: true };
  }

  // Keep the preferred order. Insert secondary-only rows beside their nearest
  // shared neighbour so adding a row at the top does not silently move it last.
  function combineOrder(preferred, secondary, included) {
    const order = preferred.filter(id => included.has(id));
    const present = new Set(order);
    const other = secondary.filter(id => included.has(id));
    let previous = null;
    for (let position = 0; position < other.length; position++) {
      const id = other[position];
      if (present.has(id)) {
        previous = id;
        continue;
      }
      let next = null;
      for (let ahead = position + 1; ahead < other.length; ahead++) {
        if (present.has(other[ahead])) {
          next = other[ahead];
          break;
        }
      }
      const at = next !== null ? order.indexOf(next) : previous !== null ? order.indexOf(previous) + 1 : order.length;
      order.splice(at, 0, id);
      present.add(id);
      previous = id;
    }
    for (const id of included) if (!present.has(id)) order.push(id);
    return order;
  }

  function orderChoice(base, local, remote) {
    const localSet = new Set(local);
    const remoteSet = new Set(remote);
    const shared = new Set((base || local).filter(id => localSet.has(id) && remoteSet.has(id)));
    const localOrder = local.filter(id => shared.has(id));
    const remoteOrder = remote.filter(id => shared.has(id));
    if (equal(localOrder, remoteOrder)) return { preferred: 'remote', conflict: false };
    if (base) {
      const baseOrder = base.filter(id => shared.has(id));
      if (equal(localOrder, baseOrder)) return { preferred: 'remote', conflict: false };
      if (equal(remoteOrder, baseOrder)) return { preferred: 'local', conflict: false };
    }
    return { preferred: 'local', conflict: true };
  }

  function mergeRow(base, local, remote) {
    if (!local || !remote) {
      const survivor = local || remote;
      if (!base) return { local: survivor, remote: survivor, conflict: false };
      if (!survivor || equal(survivor, base)) return { local: null, remote: null, conflict: false };
      return { local: local || null, remote: remote || null, conflict: true };
    }
    const find = scalar(base?.find, local.find, remote.find, !!base, true);
    const replace = scalar(base?.replace, local.replace, remote.replace, !!base);
    return {
      local: { _id: local._id, find: find.local, replace: replace.local },
      remote: { _id: local._id, find: find.remote, replace: replace.remote },
      conflict: find.conflict || replace.conflict
    };
  }

  function definitions(entry, explicitScope = false) {
    if (!entry) return null;
    return { _id: entry._id, find: entry.find, replace: entry.replace, alts: copy(entry.alts), ...scopeField(gameScope(entry), explicitScope || Object.hasOwn(entry, 'gameScope')) };
  }

  function deleteConflict(id, base, local, remote, reason) {
    const note = (local || remote)?.tlnote || '';
    const explicitScope = [base, local, remote].some(entry => entry && Object.hasOwn(entry, 'gameScope'));
    return {
      id, base: copy(base), local: copy(local), remote: copy(remote),
      definitionsConflict: true, noteConflict: false,
      localDefinitions: definitions(local, explicitScope), remoteDefinitions: definitions(remote, explicitScope),
      localNote: note, remoteNote: note, reason
    };
  }

  function mergeEntry(base, local, remote) {
    if (!local || !remote) {
      const survivor = local || remote;
      if (!base) return { entry: copy(survivor), conflict: null };
      if (!survivor || equal(survivor, base)) return { entry: null, conflict: null };
      const conflict = deleteConflict(base._id, base, local, remote, 'delete-edit');
      return { entry: resolve(conflict, { definitions: 'local', note: 'local' }), conflict };
    }

    const find = scalar(base?.find, local.find, remote.find, !!base, true);
    const replace = scalar(base?.replace, local.replace, remote.replace, !!base);
    const note = scalar(base?.tlnote, local.tlnote, remote.tlnote, !!base);
    const scope = scalar(base ? gameScope(base) : undefined, gameScope(local), gameScope(remote), !!base);
    const explicitScope = [base, local, remote].some(entry => entry && Object.hasOwn(entry, 'gameScope'));
    const baseRows = index(base?.alts || []);
    const localRows = index(local.alts);
    const remoteRows = index(remote.alts);
    const localMergedRows = new Map();
    const remoteMergedRows = new Map();
    let rowConflict = false;
    for (const id of new Set([...remoteRows.keys(), ...localRows.keys(), ...baseRows.keys()])) {
      const row = mergeRow(baseRows.get(id), localRows.get(id), remoteRows.get(id));
      if (row.local) localMergedRows.set(id, row.local);
      if (row.remote) remoteMergedRows.set(id, row.remote);
      rowConflict ||= row.conflict;
    }
    const localOrder = ids(local.alts);
    const remoteOrder = ids(remote.alts);
    const order = orderChoice(base ? ids(base.alts) : null, localOrder, remoteOrder);
    function arranged(rows, side) {
      const preferred = order.conflict ? side : order.preferred;
      const primary = preferred === 'local' ? localOrder : remoteOrder;
      const secondary = preferred === 'local' ? remoteOrder : localOrder;
      return combineOrder(primary, secondary, new Set(rows.keys())).map(id => rows.get(id));
    }
    const conflict = {
      id: local._id, base: copy(base), local: copy(local), remote: copy(remote),
      definitionsConflict: find.conflict || replace.conflict || scope.conflict || rowConflict || order.conflict,
      noteConflict: note.conflict,
      localDefinitions: { _id: local._id, find: find.local, replace: replace.local, alts: arranged(localMergedRows, 'local'), ...scopeField(scope.local, explicitScope) },
      remoteDefinitions: { _id: local._id, find: find.remote, replace: replace.remote, alts: arranged(remoteMergedRows, 'remote'), ...scopeField(scope.remote, explicitScope) },
      localNote: note.local, remoteNote: note.remote,
      reason: order.conflict ? 'row-order' : 'content'
    };
    return {
      entry: resolve(conflict, { definitions: 'local', note: 'local' }),
      conflict: conflict.definitionsConflict || conflict.noteConflict ? conflict : null
    };
  }

  /**
   * Resolve at most two groups. Candidates already contain independent automatic
   * merges; selecting a side never drops an unrelated addition from the other.
   * Entry deletion ignores note selection because no note can outlive its entry.
   */
  function resolve(conflict, choices = {}) {
    const side = choices.definitions === 'remote' ? 'remote' : 'local';
    const noteSide = choices.note === 'remote' ? 'remote' : 'local';
    const result = copy(side === 'remote' ? conflict.remoteDefinitions : conflict.localDefinitions);
    if (!result) return null;
    result.tlnote = string(noteSide === 'remote' ? conflict.remoteNote : conflict.localNote);
    return result;
  }

  /**
   * Pure three-way dictionary merge. Snapshots are complete language snapshots:
   * { revision, entries, tombstones: [id] }. Entry/alternate identity is `_id`.
   * `entries` retains local choices for unresolved groups. Conflicted entries
   * and blank-Find drafts are never uploaded. Deletes require a known baseline.
   * Unmatched duplicate Finds retain separate identities. Existing remote entry
   * order is authoritative; new local entries retain their neighbouring anchors.
   */
  function merge(baseSnapshot, localEntries, remoteSnapshot) {
    const base = normalizeEntries(baseSnapshot?.entries);
    const remote = normalizeEntries(remoteSnapshot?.entries);
    let local = normalizeEntries(localEntries);
    if (baseSnapshot == null) local = alignInitialEntries(local, remote);
    const baseById = index(base);
    const localById = index(local);
    const remoteById = index(remote);
    const baseDeleted = new Set((baseSnapshot?.tombstones || []).map(string));
    const remoteDeleted = new Set((remoteSnapshot?.tombstones || []).map(string));
    const merged = new Map();
    const conflicts = [];

    for (const id of new Set([...remoteById.keys(), ...localById.keys(), ...baseById.keys()])) {
      const prior = baseById.get(id);
      const own = localById.get(id);
      const other = remoteById.get(id);
      if (!prior && own && !other && remoteDeleted.has(id) && !baseDeleted.has(id)) {
        const conflict = deleteConflict(id, null, own, null, 'remote-deletion');
        conflicts.push(conflict);
        merged.set(id, copy(own));
        continue;
      }
      const result = mergeEntry(prior, own, other);
      if (result.entry) merged.set(id, result.entry);
      if (result.conflict) conflicts.push(result.conflict);
    }

    const entries = combineOrder(ids(remote), ids(local), new Set(merged.keys())).map(id => merged.get(id));
    const blocked = new Set(conflicts.map(conflict => conflict.id));
    const upserts = entries.filter(entry => !blocked.has(entry._id) && key(entry.find) && !equal(entry, remoteById.get(entry._id))).map(copy);
    const deletedIds = remote.filter(entry => !merged.has(entry._id) && !blocked.has(entry._id)).map(entry => entry._id);
    return { entries, conflicts, upserts, deletedIds };
  }

  // When a revision check proves the remote copy still equals the baseline,
  // only local changes need comparison; there are no remote edits to reconcile.
  function changesSince(baseSnapshot, localEntries) {
    const base = normalizeEntries(baseSnapshot?.entries);
    const baseById = index(base);
    const local = normalizeEntries(localEntries).map(entry => !Object.hasOwn(entry, 'gameScope') && Object.hasOwn(baseById.get(entry._id) || {}, 'gameScope')
      ? { ...entry, gameScope: 'all' } : entry);
    const localById = index(local);
    const entries = combineOrder(ids(base), ids(local), new Set(localById.keys())).map(id => localById.get(id));
    const upserts = entries.filter(entry => key(entry.find) && !equal(entry, baseById.get(entry._id))).map(copy);
    const deletedIds = base.filter(entry => !localById.has(entry._id)).map(entry => entry._id);
    return { entries, conflicts: [], upserts, deletedIds };
  }

  return { merge, resolve, normalizeEntries, changesSince };
});
