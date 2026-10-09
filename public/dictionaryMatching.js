(function (root, factory) {
  const scope = typeof module === 'object' && module.exports ? require('./dictionaryScope.js') : root.DictionaryScope;
  const api = factory(scope);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.DictionaryMatching = api;
})(typeof window !== 'undefined' ? window : globalThis, function (DictionaryScope) {
  'use strict';

  const escapes = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  const unescapes = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#039;': "'" };
  const word = character => !!character && /[A-Za-z0-9_]/.test(character);
  const boundary = (text, at) => word(text[at - 1]) !== word(text[at]);
  const lookupName = name => String(name ?? '').trim().replace(/<gemlevel=(?:\d+|\{\d+\})>$/i, '').trim();

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => escapes[character]);
  }

  // This decodes precisely one escaping pass. In particular literal "&lt;"
  // remains "&lt;" after escapeHtml followed by this helper.
  function unescapeHtml(value) {
    return String(value ?? '').replace(/&(amp|lt|gt|quot|#039);/g, entity => unescapes[entity]);
  }

  function getDefinitionPairs(entry) {
    const mainFind = String(entry?.find ?? '').trim();
    const mainReplace = String(entry?.replace ?? '');
    const pairs = mainFind ? [{ find: mainFind, replace: mainReplace, isMain: true }] : [];
    const seen = new Set(mainFind ? [mainFind.toLowerCase()] : []);
    for (const alt of Array.isArray(entry?.alts) ? entry.alts : []) {
      if (!alt || typeof alt !== 'object') continue;
      const find = String(alt.find ?? '').trim();
      const key = find.toLowerCase();
      if (!find || seen.has(key)) continue;
      seen.add(key);
      pairs.push({ _id: alt._id, find, replace: String(alt.replace ?? mainReplace), isMain: false });
    }
    return pairs;
  }

  function* normalizeEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const entry = {
      _id: raw._id, find: String(raw.find ?? ''), replace: String(raw.replace ?? ''),
      tlnote: String(raw.tlnote ?? ''), gameScope: DictionaryScope.normalize(raw), alts: [],
    };
    const mainFind = entry.find.trim();
    const pairs = mainFind ? [Object.freeze({ find: mainFind, replace: entry.replace, isMain: true })] : [];
    const keywordPairs = mainFind ? [Object.freeze({ find: mainFind, replace: entry.replace, isMain: true })] : [];
    const seen = new Set(mainFind ? [mainFind.toLowerCase()] : []);
    for (const rawAlt of Array.isArray(raw.alts) ? raw.alts : []) {
      yield;
      if (!rawAlt || typeof rawAlt !== 'object') continue;
      const alt = { _id: rawAlt._id, find: String(rawAlt.find ?? ''), replace: String(rawAlt.replace ?? entry.replace) };
      entry.alts.push(Object.freeze(alt));
      const find = alt.find.trim(), key = find.toLowerCase();
      if (!find || seen.has(key)) continue;
      seen.add(key);
      pairs.push(Object.freeze({ _id: alt._id, find, replace: alt.replace, isMain: false }));
      // Preserve the legacy keyword helper's non-string alternate fallback.
      keywordPairs.push(Object.freeze({ find, replace: typeof rawAlt.replace === 'string' ? rawAlt.replace : entry.replace, isMain: false }));
    }
    entry.alts = Object.freeze(entry.alts);
    entry._pairs = Object.freeze(pairs);
    return { entry: Object.freeze(entry), pairs, keywordPairs: Object.freeze(keywordPairs) };
  }

  function* buildSnapshot(entries, game, generation) {
    const normalized = [], overrides = new Set();
    for (const raw of Array.isArray(entries) ? entries : []) {
      yield;
      const row = yield* normalizeEntry(raw);
      if (!row) continue;
      normalized.push(row);
      if (row.entry.gameScope === game && game !== 'all') {
        const key = row.entry.find.trim().toLowerCase();
        if (key) overrides.add(key);
      }
    }
    const root = new Map(), keywords = new Map(), entriesById = new Map(), active = [];
    let ordinal = 0;
    for (const row of normalized) {
      yield;
      const entry = row.entry, key = entry.find.trim().toLowerCase();
      if (!DictionaryScope.available(entry, game) || (entry.gameScope === 'all' && overrides.has(key))) continue;
      active.push(row);
      let candidates = keywords.get(key);
      if (!candidates) keywords.set(key, candidates = []);
      candidates.push(row);
      if (!entry._id) continue;
      const id = String(entry._id);
      if (!entriesById.has(id)) entriesById.set(id, entry);
      for (const pair of row.pairs) {
        yield;
        let children = root, node;
        for (let i = 0; i < pair.find.length; i++) {
          if (!(i % 32)) yield;
          node = children.get(pair.find[i]);
          if (!node) children.set(pair.find[i], node = { children: new Map(), definitions: null });
          children = node.children;
        }
        if (!node) continue;
        if (!node.definitions) node.definitions = [];
        node.definitions.push({ pair, entry, ordinal: ordinal++ });
      }
    }
    return { generation, root, keywords, entriesById, active, refs: 0 };
  }

  function* escapeSource(value) {
    const source = String(value ?? ''), chunks = [];
    // Plain Dictionary definitions match the original text. Keep their render
    // coordinates without letting HTML entities become searchable words.
    const offsets = new Uint32Array(source.length + 1);
    let chunk = '', length = 0;
    for (let i = 0; i < source.length; i++) {
      if (!(i % 32)) yield;
      offsets[i] = length;
      const escaped = escapes[source[i]] || source[i];
      chunk += escaped;
      length += escaped.length;
      if (chunk.length >= 2048) { chunks.push(chunk); chunk = ''; }
    }
    offsets[source.length] = length;
    chunks.push(chunk);
    return { text: chunks.join(''), offsets };
  }

  function* literalAt(text, find, at) {
    if (!boundary(text, at) || !boundary(text, at + find.length)) return false;
    if (at + find.length > text.length) return false;
    for (let i = 0; i < find.length; i++) {
      if (!(i % 32)) yield;
      if (text[at + i] !== find[i]) return false;
    }
    return true;
  }

  function* containsLiteral(text, find) {
    if (!find) return false;
    for (let at = 0; at <= text.length - find.length; at++) {
      if (!(at % 32)) yield;
      if (text[at] === find[0] && (yield* literalAt(text, find, at))) return true;
    }
    return false;
  }

  function* overlaps(highlights, start, end) {
    for (let i = 0; i < highlights.length; i++) {
      if (!(i % 32)) yield;
      const hl = highlights[i];
      if (start < hl.index + hl.find.length && hl.index < end) return true;
    }
    return false;
  }

  function* findDefinitions(snapshot, text) {
    const found = new Set();
    for (let start = 0; start < text.length; start++) {
      if (!(start % 32)) yield;
      let children = snapshot.root;
      for (let position = start; position < text.length; position++) {
        if (!((position - start) % 32)) yield;
        const node = children.get(text[position]);
        if (!node) break;
        if (node.definitions) for (const definition of node.definitions) { found.add(definition); yield; }
        children = node.children;
      }
    }
    return Array.from(found).sort((a, b) => b.pair.find.length - a.pair.find.length || a.ordinal - b.ordinal);
  }

  function* staticDynamicContent(text) {
    const pieces = [];
    let hasDynamicContent = false, pendingSpace = false;
    for (let i = 0; i < text.length; i++) {
      if (!(i % 32)) yield;
      if (text[i] === '<') {
        let end = i + 1;
        while (end < text.length && text[end] !== '>') { if (!(end % 32)) yield; end++; }
        if (end < text.length) { hasDynamicContent = true; pendingSpace = !!pieces.length; i = end; continue; }
      }
      if (/\s/.test(text[i])) { pendingSpace = !!pieces.length; continue; }
      if (pendingSpace) { pieces.push(' '); pendingSpace = false; }
      pieces.push(text[i]);
    }
    return { hasDynamicContent, text: pieces.join('') };
  }

  function* keywordInfo(snapshot, rawTagName, rawDynamicContent, staticContent) {
    const name = lookupName(rawTagName), key = name.toLowerCase();
    const rows = key ? snapshot.keywords.get(key) || [] : snapshot.active;
    const dictIds = new Set();
    let replacement = null, selected = null, matchedFind = null;
    for (const text of [name, staticContent]) {
      if (!text) continue;
      for (const row of rows) {
        yield;
        if (!row.entry._id) continue;
        for (const pair of row.pairs) {
          if (yield* containsLiteral(text, pair.find)) {
            dictIds.add(row.entry._id); break;
          }
        }
      }
    }
    for (const text of rawDynamicContent ? [rawDynamicContent, name] : [name]) {
      for (const row of rows) {
        yield;
        for (const pair of row.keywordPairs) {
          if (!(yield* containsLiteral(text, pair.find))) continue;
          replacement = pair.replace; selected = row.entry; matchedFind = pair.find; break;
        }
        if (replacement !== null) break;
      }
      if (replacement !== null) break;
    }
    if (replacement === null) replacement = rawDynamicContent || '';
    return { text: `[${rawTagName}|${replacement}]`, entry: selected, matchedFind, dictIds: Array.from(dictIds) };
  }

  function* matchUnit(snapshot, english, options = {}) {
    const source = String(english ?? '');
    const escaped = yield* escapeSource(source);
    let modified = escaped.text;
    const highlights = [];
    let nextHlId = 1;
    const add = hl => { hl._hlId = nextHlId++; highlights.push(hl); };
    const mask = (start, length) => {
      modified = modified.substring(0, start) + '*'.repeat(length) + modified.substring(start + length);
    };

    // Parse the same three tag patterns using resumable character scans rather
    // than a regexp exec that could monopolize the worker on a very large unit.
    for (let at = 0; at < modified.length; at++) {
      if (!(at % 32)) yield;
      if (!modified.startsWith('&lt;', at)) continue;
      let end = at + 4;
      if (!/[A-Za-z]/.test(modified[end] || '')) continue;
      end++;
      while (end < modified.length && /[A-Za-z0-9_:\-]/.test(modified[end])) { if (!(end % 32)) yield; end++; }
      if (!modified.startsWith('&gt;{{', end)) continue;
      const tagName = modified.substring(at + 4, end);
      let close = end + 6;
      while (close < modified.length && !modified.startsWith('}}', close)) { if (!(close % 32)) yield; close++; }
      if (close >= modified.length) break;
      const opener = `&lt;${tagName}&gt;`;
      add({ index: at, find: opener, tagName, isTextDecoration: true,
        replace: `<${tagName}>{{}}`, label: `<${tagName}>{{_}}`, caretOffset: `<${tagName}>{{`.length });
      mask(at, opener.length);
      at = close + 1;
    }

    for (let at = 0; at < modified.length; at++) {
      if (!(at % 32)) yield;
      if (modified[at] !== '[' || modified[at + 1] === ']' || modified[at + 1] === '|') continue;
      let end = at + 1, divider = -1;
      while (end < modified.length && modified[end] !== ']') {
        if (!(end % 32)) yield;
        if (modified[end] === '|' && divider < 0) divider = end;
        end++;
      }
      if (end >= modified.length) break;
      const tagName = modified.substring(at + 1, divider < 0 ? end : divider);
      if (!tagName) continue;
      const dynamicContent = divider < 0 ? '' : modified.substring(divider + 1, end);
      const rawTagName = unescapeHtml(tagName), rawDynamicContent = unescapeHtml(dynamicContent);
      const dynamic = yield* staticDynamicContent(rawDynamicContent);
      const info = yield* keywordInfo(snapshot, rawTagName, dynamic.hasDynamicContent ? '' : rawDynamicContent, dynamic.text);
      add({ index: at, find: modified.substring(at, end + 1), tagName,
        dynamicContent: dynamic.hasDynamicContent ? '' : dynamicContent, isKeywordPopup: true,
        replace: info.text, dictId: info.entry?._id, dictDefFind: info.matchedFind || '', dictIds: info.dictIds });
      at = end;
    }

    for (let at = 0; at < modified.length; at++) {
      if (!(at % 32)) yield;
      let brace = at;
      if (/[@+\-]/.test(modified[brace] || '')) brace++;
      if (modified[brace] !== '{') continue;
      let end = brace + 1;
      while (end < modified.length && /[\dd:+]/i.test(modified[end])) { if (!(end % 32)) yield; end++; }
      if (modified[end] !== '}') continue;
      end++;
      if (modified[end] === '%') end++;
      if (!(yield* overlaps(highlights, at, end))) add({ index: at, find: modified.substring(at, end) });
      at = end - 1;
    }

    if (options.highlightDict !== false) {
      const definitions = yield* findDefinitions(snapshot, source);
      for (const definition of definitions) {
        yield;
        const find = definition.pair.find;
        for (let at = 0; at <= source.length - find.length; at++) {
          if (!(at % 32)) yield;
          if (source[at] !== find[0] || !(yield* literalAt(source, find, at))) continue;
          const start = escaped.offsets[at], end = escaped.offsets[at + find.length];
          if (!(yield* overlaps(highlights, start, end))) {
            add({ index: start, find: escaped.text.substring(start, end), replace: definition.pair.replace,
              dictId: definition.entry._id, dictDefFind: find });
          }
          // RegExp global matches advance past a match even when it overlaps.
          at += find.length - 1;
        }
      }
    }
    highlights.sort((a, b) => a.index - b.index);
    return highlights;
  }

  function* matchSnapshot(snapshot, units, options = {}) {
    const result = [], entriesById = Object.create(null);
    for (const unit of Array.isArray(units) ? units : []) {
      yield;
      const english = String(unit?.english ?? '');
      const HLs = yield* matchUnit(snapshot, english, options);
      result.push({ key: unit?.key, english, HLs });
      for (const hl of HLs) {
        for (const id of [hl.dictId, ...(hl.dictIds || [])]) {
          yield;
          if (!id) continue;
          const entry = snapshot.entriesById.get(String(id));
          if (entry) entriesById[String(id)] = entry;
        }
      }
    }
    return { units: result, entriesById };
  }

  function createRuntime(options = {}) {
    const postMessage = options.postMessage || (() => {});
    const schedule = options.schedule || (callback => setTimeout(callback, 0));
    const now = options.now || (() => typeof performance !== 'undefined' ? performance.now() : Date.now());
    const sliceMs = options.sliceMs ?? 4;
    let scopeEpoch = null, scopeKey = '', ready = null, retired = null, building = null, pending = null, assembly = null;
    let queue = [], waiting = [], scheduled = false, disposed = false, querySlices = 0;
    const queries = new Map();

    function report(error, requestId, generation) {
      postMessage({ type: 'error', scopeEpoch, requestId, generation, error: { message: String(error?.message || error) } });
    }

    function release(job) {
      if (job.snapshot) { job.snapshot.refs--; job.snapshot = null; }
      queries.delete(job.requestId);
      if (retired && !retired.refs) retired = null;
    }

    function startBuild() {
      if (building || !pending || retired) return;
      const input = pending;
      pending = null;
      building = { generation: input.generation, iterator: buildSnapshot(input.entries, input.game, input.generation) };
    }

    function enqueue(job) {
      job.snapshot = ready;
      ready.refs++;
      job.iterator = matchSnapshot(ready, job.units, job.options);
      queue.push(job);
    }

    function ensurePump() {
      startBuild();
      if (disposed || scheduled || (!building && !queue.length)) return;
      scheduled = true;
      schedule(pump);
    }

    function runSlice(iterator) {
      const started = now();
      let result;
      do { result = iterator.next(); } while (!result.done && now() - started < sliceMs);
      return result;
    }

    function pump() {
      scheduled = false;
      if (disposed) return;
      startBuild();
      if (queue.length && (!building || querySlices < 4)) {
        const job = queue.shift();
        querySlices++;
        try {
          const result = runSlice(job.iterator);
          if (result.done) {
            postMessage({ type: 'matches', requestId: job.requestId, scopeEpoch,
              generation: job.snapshot.generation, ...result.value });
            release(job);
          } else queue.push(job);
        } catch (error) { report(error, job.requestId); release(job); }
      } else if (building) {
        querySlices = 0;
        const job = building;
        try {
          const result = runSlice(job.iterator);
          if (result.done) {
            if (ready?.refs) retired = ready;
            ready = result.value;
            building = null;
            postMessage({ type: 'ready', scopeEpoch, generation: ready.generation });
            for (const waitingJob of waiting) enqueue(waitingJob);
            waiting = [];
          }
        } catch (error) {
          building = null;
          report(error, undefined, job.generation);
          if (!ready) {
            for (const waitingJob of waiting) { report(error, waitingJob.requestId, job.generation); release(waitingJob); }
            waiting = [];
          }
        }
      }
      ensurePump();
    }

    function newestGeneration() {
      return Math.max(ready?.generation || 0, building?.generation || 0, pending?.generation || 0, assembly?.generation || 0);
    }

    function copyTransportAlt(value) {
      if (!value || typeof value !== 'object') throw new Error('Dictionary transport requires an alternate row.');
      return { _id: value._id, find: String(value.find ?? ''), replace: value.replace };
    }

    function copyTransportEntry(value) {
      if (!value || typeof value !== 'object') throw new Error('Dictionary transport requires an entry row.');
      return { _id: value._id, find: String(value.find ?? ''), replace: String(value.replace ?? ''),
        tlnote: String(value.tlnote ?? ''), gameScope: value.gameScope,
        alts: Array.isArray(value.alts) ? value.alts.map(copyTransportAlt) : [] };
    }

    function receiveTransport(message) {
      if (message.type === 'beginSnapshot') {
        if (!Number.isFinite(message.generation) || message.generation <= 0) {
          report(new Error('Dictionary snapshot requires a positive generation.'), undefined, message.generation);
          return;
        }
        if (message.generation <= newestGeneration()) return;
        assembly = { generation: message.generation, game: message.game, entries: [] };
        return;
      }
      // A newer transfer or scope may supersede queued chunks. Those chunks
      // cannot mutate the committed snapshot or an unrelated assembly.
      if (!assembly || message.generation !== assembly.generation) return;
      const generation = assembly.generation;
      try {
        if (message.type === 'appendEntries') {
          if (message.startIndex !== assembly.entries.length || !Array.isArray(message.entries)) {
            throw new Error('Dictionary entry chunks must be consecutive.');
          }
          for (const entry of message.entries) assembly.entries.push(copyTransportEntry(entry));
        } else if (message.type === 'appendAlternates') {
          const entry = assembly.entries[message.entryIndex];
          if (!Number.isInteger(message.entryIndex) || !entry || message.startIndex !== entry.alts.length || !Array.isArray(message.alts)) {
            throw new Error('Dictionary alternate chunks must be consecutive.');
          }
          for (const alt of message.alts) entry.alts.push(copyTransportAlt(alt));
        } else if (message.type === 'appendText') {
          const entry = assembly.entries[message.entryIndex];
          const target = message.altIndex == null ? entry : entry?.alts[message.altIndex];
          if (!Number.isInteger(message.entryIndex) || !entry || !target
            || (message.altIndex != null && !Number.isInteger(message.altIndex))
            || !['find', 'replace', 'tlnote'].includes(message.field)
            || (message.altIndex != null && message.field === 'tlnote') || typeof message.text !== 'string') {
            throw new Error('Dictionary text fragments require a valid row and field.');
          }
          // Each incoming fragment is bounded by the sender. Concatenating
          // ropes keeps exceptionally large fields out of one structured clone.
          target[message.field] = String(target[message.field] ?? '') + message.text;
        } else if (message.type === 'commitSnapshot') {
          // The receiver owns these detached rows. No index observes a partial
          // transfer; future chunks are fenced immediately at this boundary.
          pending = assembly;
          assembly = null;
          ensurePump();
        }
      } catch (error) {
        assembly = null;
        report(error, undefined, generation);
      }
    }

    function handleMessage(message) {
      if (disposed || !message || typeof message !== 'object') return;
      if (message.type === 'setScope') {
        if (message.scopeEpoch === scopeEpoch && String(message.scopeKey ?? '') === scopeKey) return;
        scopeEpoch = message.scopeEpoch;
        scopeKey = String(message.scopeKey ?? '');
        ready = retired = building = pending = assembly = null;
        queue = []; waiting = []; queries.clear(); querySlices = 0;
        return;
      }
      if (message.scopeEpoch !== scopeEpoch) return;
      if (['beginSnapshot', 'appendEntries', 'appendAlternates', 'appendText', 'commitSnapshot'].includes(message.type)) {
        receiveTransport(message);
        return;
      }
      if (message.type === 'setSnapshot') {
        if (message.generation <= newestGeneration()) return;
        assembly = null;
        pending = { generation: message.generation, game: message.game, entries: message.entries };
      } else if (message.type === 'match') {
        if (queries.has(message.requestId)) return;
        const job = { requestId: message.requestId, units: message.units, options: message.options || {}, snapshot: null };
        queries.set(job.requestId, job);
        if (ready) enqueue(job);
        else waiting.push(job);
      } else if (message.type === 'cancel') {
        const job = queries.get(message.requestId);
        if (!job) return;
        queue = queue.filter(candidate => candidate !== job);
        waiting = waiting.filter(candidate => candidate !== job);
        release(job);
      }
      ensurePump();
    }

    function dispose() {
      disposed = true;
      ready = retired = building = pending = assembly = null;
      queue = []; waiting = []; queries.clear();
    }

    return { handleMessage, dispose };
  }

  return { createRuntime, buildSnapshot, matchSnapshot, escapeHtml, unescapeHtml, getDefinitionPairs };
});
