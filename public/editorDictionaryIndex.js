(function (global) {
  function escapePattern(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function createBuilder(dictionary, getPairs) {
    const entries = Array.isArray(dictionary) ? dictionary : [];
    const root = new Map();
    const keywords = new Map();
    const entriesById = new Map();
    let ordinal = 0;

    function addEntry(dictEntry) {
      if (!dictEntry) return;
      const mainKey = String(dictEntry.find ?? '').trim().toLowerCase();
      let keywordEntries = keywords.get(mainKey);
      if (!keywordEntries) keywords.set(mainKey, keywordEntries = []);
      keywordEntries.push(dictEntry);

      // Plain highlights have always required an ID; keyword lookup also accepts
      // entries imported before IDs are assigned.
      if (!dictEntry._id) return;
      const id = String(dictEntry._id);
      if (!entriesById.has(id)) entriesById.set(id, dictEntry);
      for (const pair of getPairs(dictEntry)) {
        if (!pair?.find) continue;
        const find = String(pair.find);
        let children = root;
        let node;
        for (let i = 0; i < find.length; i++) {
          const character = find[i];
          node = children.get(character);
          if (!node) children.set(character, node = { children: new Map(), definitions: null });
          children = node.children;
        }
        if (!node.definitions) node.definitions = [];
        node.definitions.push({ pair, dictEntry, regex: null, ordinal: ordinal++ });
      }
    }

    function finish() {
      return {
        entriesById,
        keywordEntries(tagName) {
          const key = String(tagName ?? '').trim().toLowerCase();
          // The existing keyword helper skips its restriction for an empty tag.
          return key ? keywords.get(key) || [] : entries;
        },
        definitionsFor(text) {
          const source = String(text ?? '');
          const found = new Set();
          for (let start = 0; start < source.length; start++) {
            let children = root;
            for (let position = start; position < source.length; position++) {
              const node = children.get(source[position]);
              if (!node) break;
              if (node.definitions) {
                for (const definition of node.definitions) found.add(definition);
              }
              children = node.children;
            }
          }
          const result = Array.from(found).sort((a, b) =>
            b.pair.find.length - a.pair.find.length || a.ordinal - b.ordinal);
          for (const definition of result) {
            // Compile only literal candidates present in this source. The caller
            // retains the existing boundary and overlap checks on its masked text.
            if (!definition.regex) definition.regex = new RegExp(`\\b${escapePattern(String(definition.pair.find))}\\b`, 'g');
            definition.regex.lastIndex = 0;
          }
          return result;
        },
      };
    }

    return { entries, addEntry, finish };
  }

  function create(dictionary, getPairs) {
    const builder = createBuilder(dictionary, getPairs);
    for (const entry of builder.entries) builder.addEntry(entry);
    return builder.finish();
  }

  async function createAsync(dictionary, getPairs, options = {}) {
    const builder = createBuilder(dictionary, getPairs);
    const yieldTask = options.yieldTask || (() => new Promise(resolve => setTimeout(resolve, 0)));
    const isCancelled = options.isCancelled || (() => false);
    const now = () => typeof performance !== 'undefined' ? performance.now() : Date.now();
    let batchStarted = now();
    for (let i = 0; i < builder.entries.length; i++) {
      if (isCancelled()) return null;
      builder.addEntry(builder.entries[i]);
      if (now() - batchStarted >= 6 && i + 1 < builder.entries.length) {
        await yieldTask();
        if (isCancelled()) return null;
        batchStarted = now();
      }
    }
    return isCancelled() ? null : builder.finish();
  }

  const api = { create, createAsync };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.EditorDictionaryIndex = api;
})(typeof window !== 'undefined' ? window : globalThis);
