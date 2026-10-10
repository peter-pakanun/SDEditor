/* Manual alignment keeps whole translation entries intact until every entry is accounted for. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EntryAlignment = api;
})(typeof window === 'object' ? window : typeof self === 'object' ? self : this, function () {
  'use strict';

  function strings(value, label) {
    if (!Array.isArray(value)) throw new TypeError(`${label} must be an array of raw strings.`);
    for (const entry of value) if (typeof entry !== 'string') throw new TypeError(`${label} must be an array of raw strings.`);
  }

  function counts(entries) {
    const result = new Map();
    for (const entry of entries) {
      if (typeof entry === 'string') result.set(entry, (result.get(entry) || 0) + 1);
    }
    return result;
  }

  function create(english, translations, oldEnglish = []) {
    strings(english, 'English entries');
    strings(translations, 'Translation entries');
    if (!Array.isArray(oldEnglish) || oldEnglish.some(entry => entry != null && typeof entry !== 'string')) {
      throw new TypeError('Previous English entries must be an array of raw strings or unavailable entries.');
    }
    const state = {
      english: english.slice(),
      items: translations.map((translation, id) => ({ id, translation, english: oldEnglish[id] ?? null, obsolete: false })),
      slots: english.map(() => null)
    };
    const currentCounts = counts(english), previousCounts = counts(oldEnglish);
    const currentPositions = new Map(english.map((entry, index) => [entry, index]));
    for (const item of state.items) {
      if (item.english !== null && previousCounts.get(item.english) === 1 && currentCounts.get(item.english) === 1) {
        state.slots[currentPositions.get(item.english)] = item.id;
      }
    }
    return state;
  }

  function inspect(state) {
    if (!state || typeof state !== 'object') throw new TypeError('An alignment state is required.');
    strings(state.english, 'English entries');
    if (!Array.isArray(state.items) || !Array.isArray(state.slots) || state.slots.length !== state.english.length) {
      throw new TypeError('Alignment items and slots do not match the current English entries.');
    }
    for (let id = 0; id < state.items.length; id++) {
      const item = state.items[id];
      if (!item || item.id !== id || typeof item.translation !== 'string' ||
          (item.english !== null && typeof item.english !== 'string') || typeof item.obsolete !== 'boolean') {
        throw new TypeError('Alignment contains an invalid translation item.');
      }
    }
    const assigned = new Set();
    let unresolved = 0;
    for (const slot of state.slots) {
      if (slot === null) { unresolved++; continue; }
      if (slot === 'blank') continue;
      if (!Number.isInteger(slot) || slot < 0 || slot >= state.items.length) {
        throw new RangeError('Alignment contains an invalid translation item ID.');
      }
      if (assigned.has(slot)) throw new Error('A translation entry cannot be assigned more than once.');
      if (state.items[slot].obsolete) throw new Error('An obsolete translation entry cannot remain assigned.');
      assigned.add(slot);
    }
    const unassigned = state.items.filter(item => !item.obsolete && !assigned.has(item.id)).length;
    return { unresolved, unassigned };
  }

  function slotIndex(state, index) {
    if (!Number.isInteger(index) || index < 0 || index >= state.slots.length) {
      throw new RangeError('The English entry position is no longer available.');
    }
  }

  function itemId(state, id) {
    if (!Number.isInteger(id) || id < 0 || id >= state.items.length) {
      throw new RangeError('The translation entry is no longer available.');
    }
  }

  function assign(state, id, index) {
    inspect(state); itemId(state, id); slotIndex(state, index);
    state.slots.forEach((slot, position) => { if (slot === id) state.slots[position] = null; });
    state.slots[index] = id;
    state.items[id].obsolete = false;
    return state;
  }

  function leaveBlank(state, index) {
    inspect(state); slotIndex(state, index);
    state.slots[index] = 'blank';
    return state;
  }

  function unassign(state, index) {
    inspect(state); slotIndex(state, index);
    state.slots[index] = null;
    return state;
  }

  function setObsolete(state, id, value) {
    inspect(state); itemId(state, id);
    if (typeof value !== 'boolean') throw new TypeError('An obsolete decision must be true or false.');
    if (value) state.slots.forEach((slot, position) => { if (slot === id) state.slots[position] = null; });
    state.items[id].obsolete = value;
    return state;
  }

  function pending(state) { return inspect(state); }

  function ready(state) {
    try {
      const remaining = inspect(state);
      return remaining.unresolved === 0 && remaining.unassigned === 0;
    } catch (_) { return false; }
  }

  function translations(state) {
    const remaining = inspect(state);
    if (remaining.unresolved || remaining.unassigned) {
      throw new Error('Assign or leave blank every English entry, and mark every remaining translation entry obsolete.');
    }
    return state.slots.map(slot => slot === 'blank' ? '' : state.items[slot].translation);
  }

  return { create, assign, leaveBlank, unassign, setObsolete, pending, ready, translations };
});
