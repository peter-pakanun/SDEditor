(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DictionaryScope = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function normalize(value) {
    const scope = value && typeof value === 'object' ? value.gameScope : value;
    return scope === 'poe1' || scope === 'poe2' ? scope : 'all';
  }

  function findKey(entry) {
    return String(entry?.find ?? '').trim().toLowerCase();
  }

  function available(entry, game) {
    const scope = normalize(entry);
    return scope === 'all' || scope === game;
  }

  function specificFinds(dictionary, game) {
    const finds = new Set();
    if (game !== 'poe1' && game !== 'poe2') return finds;
    for (const entry of dictionary || []) {
      const key = findKey(entry);
      if (entry && normalize(entry) === game && key) finds.add(key);
    }
    return finds;
  }

  function shadowed(entry, dictionary, game) {
    return normalize(entry) === 'all' && !!findKey(entry)
      && specificFinds(dictionary, game).has(findKey(entry));
  }

  // Retain every stored row. This view alone controls automatic translation use;
  // a current-game main Find overrides the entire All entry and its alternates.
  function activeEntries(dictionary, game) {
    const entries = Array.isArray(dictionary) ? dictionary : [];
    const overrides = specificFinds(entries, game);
    return entries.filter(entry => entry && available(entry, game)
      && !(normalize(entry) === 'all' && overrides.has(findKey(entry))));
  }

  return { normalize, findKey, available, shadowed, activeEntries };
});
