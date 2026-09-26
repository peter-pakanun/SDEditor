(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DictionarySync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const copy = value => value == null ? null : JSON.parse(JSON.stringify(value));
  const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const key = value => String(value ?? '').trim().toLowerCase();
  const string = value => String(value ?? '');
  const ids = rows => rows.map(row => row._id);
  const index = rows => new Map(rows.map(row => [row._id, row]));

  function hash(value) {
    let result = 2166136261;
    for (const character of value) {
      result ^= character.codePointAt(0);
      result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(36);
  }

  function uniqueId(raw, fallback, used) {
    const requested = raw == null || string(raw) === '' ? fallback : string(raw);
    let value = requested;
    let suffix = 2;
    while (used.has(value)) value = requested + '~' + suffix++;
    used.add(value);
    return value;
  }

  // Keep the editor's schema and raw text. Normalized Find is for initial
  // identity matching only, never a replacement for the user's stored wording.
  function normalizeEntries(values) {
    const usedEntries = new Set();
    return (Array.isArray(values) ? values : []).filter(value => value && typeof value === 'object').map((value, position) => {
      const entry = {
        _id: uniqueId(value._id, 'd_sync_' + hash(JSON.stringify(value)) + '_' + position, usedEntries),
        find: string(value.find),
        replace: string(value.replace),
        alts: [],
        tlnote: string(value.tlnote)
      };
      const usedRows = new Set();
      entry.alts = (Array.isArray(value.alts) ? value.alts : []).filter(row => row && typeof row === 'object').map((row, rowPosition) => ({
        _id: uniqueId(row._id, 'a_sync_' + hash(JSON.stringify(row)) + '_' + rowPosition, usedRows),
        find: string(row.find),
        replace: row.replace == null ? entry.replace : string(row.replace)
      }));
      return entry;
    });
  }

  function findCounts(rows) {
    const counts = new Map();
    for (const row of rows) {
      const name = key(row.find);
      if (name) counts.set(name, (counts.get(name) || 0) + 1);
    }
    return counts;
  }

  function alignInitialRows(local, remote) {
    const remoteById = index(remote);
    const localCounts = findCounts(local);
    const remoteCounts = findCounts(remote);
    const remoteByFind = new Map(remote.map(row => [key(row.find), row]));
    const claimed = new Set(local.filter(row => remoteById.has(row._id)).map(row => row._id));
    return local.map(row => {
      if (remoteById.has(row._id)) return row;
      const name = key(row.find);
      const match = remoteByFind.get(name);
      if (!name || localCounts.get(name) !== 1 || remoteCounts.get(name) !== 1 || !match || claimed.has(match._id)) return row;
      claimed.add(match._id);
      return { ...row, _id: match._id };
    });
  }

  function alignInitialEntries(local, remote) {
    const aligned = alignInitialRows(local, remote);
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

  function definitions(entry) {
    if (!entry) return null;
    return { _id: entry._id, find: entry.find, replace: entry.replace, alts: copy(entry.alts) };
  }

  function deleteConflict(id, base, local, remote, reason) {
    const note = (local || remote)?.tlnote || '';
    return {
      id, base: copy(base), local: copy(local), remote: copy(remote),
      definitionsConflict: true, noteConflict: false,
      localDefinitions: definitions(local), remoteDefinitions: definitions(remote),
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
      definitionsConflict: find.conflict || replace.conflict || rowConflict || order.conflict,
      noteConflict: note.conflict,
      localDefinitions: { _id: local._id, find: find.local, replace: replace.local, alts: arranged(localMergedRows, 'local') },
      remoteDefinitions: { _id: local._id, find: find.remote, replace: replace.remote, alts: arranged(remoteMergedRows, 'remote') },
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

  return { merge, resolve, normalizeEntries };
});
