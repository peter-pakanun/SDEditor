(function (root, factory) {
  const diagnostics = typeof module === 'object' && module.exports
    ? require('./translationDiagnostics.js') : root.TranslationDiagnostics;
  const api = factory(root, diagnostics);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TranslationMemory = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root, diagnostics) {
  'use strict';

  const SCOPES = new Set(['poe1', 'poe2', 'all']);
  const text = value => String(value ?? '');
  const boundedText = (value, label, maximum) => {
    const result = text(value);
    if (result.length > maximum) throw new TypeError(`${label} must contain at most ${maximum} characters.`);
    return result;
  };
  const clock = () => root.performance?.now?.() ?? Date.now();
  const abortError = () => Object.assign(new Error('Translation Memory request was cancelled.'), { name: 'AbortError' });
  const newlineText = value => text(value).replace(/\r\n?/g, '\n').replace(/\\n/g, '\n');
  const fuzzyKey = value => newlineText(value).normalize('NFC').toLowerCase().replace(/[ \t]+/g, ' ').trim();
  const countBag = values => {
    const counts = new Map();
    for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
    return JSON.stringify([...counts].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  };

  function normalizeContext(value) {
    if (typeof value === 'string') {
      try { value = JSON.parse(value); } catch (_) { throw new TypeError('Invalid Translation Memory context.'); }
    }
    value = value && typeof value === 'object' ? value : {};
    if (Array.isArray(value.stats) && value.stats.length > 128) throw new TypeError('TM context.stats must contain at most 128 entries.');
    return {
      filepath: boundedText(value.filepath, 'TM context.filepath', 2048).replace(/\\/g, '/'),
      stats: Array.isArray(value.stats) ? value.stats.map(stat => boundedText(stat, 'TM context.stats entry', 1024)) : [],
      condition: boundedText(value.condition, 'TM context.condition', 4096),
      remarks: boundedText(value.remarks, 'TM context.remarks', 4096),
      entryIndex: Number.isSafeInteger(value.entryIndex) && value.entryIndex >= 0 ? value.entryIndex : null,
    };
  }

  function canonicalContext(context) { return JSON.stringify(normalizeContext(context)); }

  function contextFor(desc, entryIndex, filepath = desc?.filepath) {
    return normalizeContext({ filepath, stats: desc?.stats,
      condition: desc?.variables?.[entryIndex], remarks: desc?.remarks?.[entryIndex], entryIndex });
  }

  function normalizeUnit(raw) {
    if (!raw || typeof raw !== 'object') throw new TypeError('A Translation Memory unit is required.');
    if (typeof raw.source !== 'string' || typeof raw.target !== 'string' || !raw.source.trim() || !raw.target.trim()) {
      throw new TypeError('Translation Memory requires nonblank source and target text.');
    }
    boundedText(raw.source, 'TM source', 32768); boundedText(raw.target, 'TM target', 32768);
    const id = text(raw.id ?? raw._id);
    if (raw.id !== undefined && raw._id !== undefined && raw.id !== raw._id) throw new TypeError('TM id and _id must agree.');
    if (id && (id.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9_.:~\-]*$/.test(id))) throw new TypeError('Invalid Translation Memory unit ID.');
    const gameScope = raw.gameScope ?? 'all';
    if (!SCOPES.has(gameScope)) throw new TypeError('Invalid Translation Memory game scope.');
    const context = normalizeContext(raw.context);
    const origin = raw.provenance && typeof raw.provenance === 'object' ? raw.provenance : {};
    const unit = {
      id, source: raw.source, target: raw.target, gameScope, context,
      note: boundedText(raw.note, 'TM note', 4096),
      provenance: { sourceHash: boundedText(origin.sourceHash, 'TM provenance.sourceHash', 256), branchId: boundedText(origin.branchId || 'default', 'TM provenance.branchId', 256),
        jobId: boundedText(origin.jobId, 'TM provenance.jobId', 128), filepath: boundedText(origin.filepath ?? context.filepath, 'TM provenance.filepath', 2048),
        entryIndex: Number.isSafeInteger(origin.entryIndex) && origin.entryIndex >= 0 ? origin.entryIndex : context.entryIndex,
        origin: boundedText(origin.origin || 'manual', 'TM provenance.origin', 64) },
      revision: Number.isSafeInteger(raw.revision) && raw.revision >= 0 ? raw.revision : 0,
      updatedAt: Number.isFinite(raw.updatedAt) && raw.updatedAt >= 0 ? raw.updatedAt : 0,
    };
    if (typeof raw.language === 'string') unit.language = raw.language;
    if (Number.isSafeInteger(raw.localRevision) && raw.localRevision >= 0) unit.localRevision = raw.localRevision;
    if (raw.author != null) unit.author = typeof raw.author === 'object' ? JSON.parse(JSON.stringify(raw.author)) : text(raw.author);
    if (raw.deleted === true) unit.deleted = true;
    if (raw.suppressed === true) unit.suppressed = true;
    if (raw.enabled === false) unit.enabled = false;
    return unit;
  }

  function identityFor(unit) {
    const normalized = normalizeUnit({ ...unit, target: typeof unit?.target === 'string' && unit.target.trim() ? unit.target : '_' });
    return JSON.stringify([normalized.gameScope, normalized.source, canonicalContext(normalized.context)]);
  }

  function keywordTags(source) {
    const result = [], regex = /\[([^\]|]+)(?:\|([^\]]*))?\]/g;
    let match;
    while ((match = regex.exec(source))) result.push({ id: match[1], start: match.index + 1, end: match.index + 1 + match[1].length });
    return result;
  }

  // Browser/worker callers share the established tag extractor. The Node
  // adapter mirrors it because regexEngine.js is a classic script, not a module.
  function variableTags(value) {
    const source = text(value);
    if (typeof root.extractGGGVarTags === 'function') return root.extractGGGVarTags(source);
    const ids = keywordTags(source), regex = /[@+\-]?\{[\dd:+]*\}%?/g, result = [];
    let match;
    while ((match = regex.exec(source))) {
      const start = match.index, end = start + match[0].length;
      if (ids.some(id => id.start <= start && end <= id.end)) continue;
      result.push({ full: match[0], start, end });
    }
    return result;
  }

  function structure(source) {
    const decoded = newlineText(source);
    return {
      variables: countBag(variableTags(decoded).map(tag => tag.full)),
      keywords: countBag(keywordTags(decoded).map(tag => tag.id)),
      decorations: countBag([...decoded.matchAll(/<([A-Za-z][A-Za-z0-9_:\-]*)>\{\{/g)].map(match => match[1])),
      columns: decoded.split('@').length,
      lines: JSON.stringify(decoded.split('@').map(column => column.split('\n').length)),
    };
  }

  function validatePair(source, target, language) {
    source = text(source); target = text(target);
    const errors = [], add = (code, message) => errors.push({ code, message });
    if (!source.trim() || !target.trim()) add('blank', 'Source and translation must contain text.');
    if (source.length > 32768 || target.length > 32768) {
      add('length', 'TM source and translation must contain at most 32768 characters.');
      return { valid: false, errors };
    }
    if (/^(?:\[DNT|DNT )/.test(source)) add('dnt', 'Do not translate entries are excluded from Translation Memory.');
    if (diagnostics?.analyze) for (const [kind, value] of [['source', source], ['target', target]]) {
      for (const finding of diagnostics.analyze(newlineText(value), { lang: language,
        checks: { tagSyntax: true, whitespace: false, dash: false } }).diagnostics) {
        if (finding.level === 'error' || finding.code === 'malformed-text-decoration-tag') {
          add('syntax', `${kind === 'source' ? 'Source' : 'Translation'}: ${finding.message}`);
        }
      }
    }
    const old = structure(source), current = structure(target);
    if (old.variables !== current.variables) add('variables', 'Variable identities, modifiers, or occurrence counts differ.');
    if (old.keywords !== current.keywords) add('keywords', 'Keyword identities or occurrence counts differ.');
    if (old.decorations !== current.decorations) add('decorations', 'Decoration tags or occurrence counts differ.');
    if (old.columns !== current.columns) add('table', 'Table column counts differ.');
    if (old.lines !== current.lines) add('multiline', 'Line counts differ.');
    return { valid: errors.length === 0, errors };
  }

  function unitsFromDescription(desc, lines, language, options = {}) {
    const english = desc?.translations?.English;
    if (!Array.isArray(english) || !Array.isArray(lines) || english.length !== lines.length
      || english.some(source => /^(?:\[DNT|DNT )/.test(text(source)))) return [];
    const units = [];
    for (let entryIndex = 0; entryIndex < english.length; entryIndex++) {
      const source = text(english[entryIndex]), target = text(lines[entryIndex]);
      if (!validatePair(source, target, language).valid) continue;
      try {
        const context = contextFor(desc, entryIndex, options.filepath ?? desc.filepath);
        units.push(normalizeUnit({ source, target, language, gameScope: options.game || 'all', context,
          provenance: { sourceHash: options.sourceHash, branchId: options.branchId, jobId: options.jobId,
            filepath: context.filepath, entryIndex, origin: options.origin || 'save' } }));
      } catch (error) {
        if (!(error instanceof TypeError)) throw error;
        // Auxiliary learning must never reject a valid durable translation save.
      }
    }
    return units;
  }

  function skeletonFor(source) {
    const tags = variableTags(source), roles = new Map();
    if (!tags.length) return null;
    let cursor = 0, skeleton = '';
    for (const tag of tags) {
      const match = /^([@+\-]?)\{(\d+)\}(%?)$/.exec(tag.full);
      if (!match) return null;
      if (!roles.has(match[2])) roles.set(match[2], roles.size);
      skeleton += source.slice(cursor, tag.start) + match[1] + '{#' + roles.get(match[2]) + '}' + match[3];
      cursor = tag.end;
    }
    return { key: skeleton + source.slice(cursor), ids: [...roles.keys()] };
  }

  function adaptVariables(source, target, currentSource) {
    const before = skeletonFor(source), after = skeletonFor(currentSource);
    if (!before || !after || before.key !== after.key || before.ids.length !== after.ids.length
      || source === currentSource || !validatePair(source, target).valid) return null;
    const mapping = Object.fromEntries(before.ids.map((id, index) => [id, after.ids[index]]));
    let translated = '', cursor = 0;
    for (const tag of variableTags(target)) {
      const match = /^([@+\-]?)\{(\d+)\}(%?)$/.exec(tag.full);
      if (!match || !Object.hasOwn(mapping, match[2])) return null;
      translated += target.slice(cursor, tag.start) + match[1] + '{' + mapping[match[2]] + '}' + match[3];
      cursor = tag.end;
    }
    translated += target.slice(cursor);
    if (!validatePair(currentSource, translated).valid) return null;
    return { target: translated, mapping };
  }

  function sourceDiff(before, after) {
    const old = Array.from(text(before)), current = Array.from(text(after));
    let start = 0, end = 0;
    while (start < Math.min(old.length, current.length) && old[start] === current[start]) start++;
    while (end < old.length - start && end < current.length - start
      && old[old.length - 1 - end] === current[current.length - 1 - end]) end++;
    const segments = points => [
      { text: points.slice(0, start).join(''), changed: false },
      { text: points.slice(start, points.length - end).join(''), changed: true },
      { text: end ? points.slice(points.length - end).join('') : '', changed: false },
    ].filter(segment => segment.text);
    return { oldSource: segments(old), currentSource: segments(current) };
  }

  function matchWarnings(source, current, target) {
    const warnings = [], oldWords = new Set(fuzzyKey(source).match(/[a-z]+/g) || []);
    const words = new Set(fuzzyKey(current).match(/[a-z]+/g) || []);
    const pairs = [['increased', 'reduced'], ['more', 'less'], ['can', 'cannot'], ['with', 'without'],
      ['gain', 'lose'], ['gains', 'loses'], ['grant', 'remove'], ['grants', 'removes']];
    if (pairs.some(([a, b]) => oldWords.has(a) !== words.has(a) && oldWords.has(b) !== words.has(b))
      || ['not', 'no', 'never', 'cannot', 'without'].some(word => oldWords.has(word) !== words.has(word))) {
      warnings.push({ code: 'meaning', message: 'Polarity or negation changed. Review the translated meaning.' });
    }
    const literals = value => {
      let source = text(value), cursor = 0, plain = '';
      for (const tag of variableTags(source)) { plain += source.slice(cursor, tag.start); cursor = tag.end; }
      plain += source.slice(cursor);
      return countBag(plain.match(/[+\-]?\d+(?:\.\d+)?%?/g) || []);
    };
    if (literals(source) !== literals(current)) warnings.push({ code: 'numbers', message: 'Literal numbers or signs changed. They are not adapted automatically.' });
    const old = structure(source), next = structure(current);
    for (const [key, message] of [['variables', 'Source variable tags changed.'], ['keywords', 'Source keyword identities changed.'],
      ['decorations', 'Source decoration tags changed.'], ['columns', 'Source table columns changed.'], ['lines', 'Source line breaks changed.']]) {
      if (old[key] !== next[key]) warnings.push({ code: key, message });
    }
    for (const error of validatePair(current, target).errors) {
      if (!warnings.some(warning => warning.code === error.code && warning.message === error.message)) warnings.push(error);
    }
    return warnings;
  }

  function bigrams(points) {
    const counts = new Map();
    for (let index = 1; index < points.length; index++) {
      const gram = points[index - 1] + points[index];
      counts.set(gram, (counts.get(gram) || 0) + 1);
    }
    return counts;
  }

  function* indexSteps(units, options = {}) {
    const game = options.game || 'poe1', generation = Number(options.generation) || 1;
    if (game !== 'poe1' && game !== 'poe2') throw new TypeError('Translation Memory requires the current game.');
    const rows = [], overrides = new Set();
    for (const raw of Array.isArray(units) ? units : []) {
      yield;
      const unit = normalizeUnit(raw);
      if (unit.deleted || unit.suppressed || unit.enabled === false) continue;
      if (unit.gameScope === game) overrides.add(unit.source);
      rows.push(unit);
    }
    const groups = [], grouped = new Map(), exact = new Map(), skeletons = new Map(), lengths = new Map(), postings = new Map();
    for (const unit of rows) {
      yield;
      if (unit.gameScope !== game && unit.gameScope !== 'all' || unit.gameScope === 'all' && overrides.has(unit.source)) continue;
      const key = JSON.stringify([unit.gameScope, unit.source]);
      let group = grouped.get(key);
      if (!group) {
        const fold = fuzzyKey(unit.source), points = Array.from(fold), skeleton = skeletonFor(unit.source);
        group = { id: groups.length, key, source: unit.source, fold, length: points.length,
          grams: Math.max(points.length - 1, 0), skeleton, units: [] };
        groups.push(group); grouped.set(key, group);
        exact.set(unit.source, group);
        if (!lengths.has(group.length)) lengths.set(group.length, []);
        lengths.get(group.length).push(group.id);
        if (skeleton) {
          if (!skeletons.has(skeleton.key)) skeletons.set(skeleton.key, []);
          skeletons.get(skeleton.key).push(group.id);
        }
        for (const [gram, count] of bigrams(points)) {
          yield;
          if (!postings.has(gram)) postings.set(gram, []);
          postings.get(gram).push(group.id, count);
        }
      }
      group.units.push({ unit, contextKey: canonicalContext(unit.context), identity: unit.id || identityFor(unit) });
    }
    for (const [gram, values] of postings) { yield; postings.set(gram, Uint32Array.from(values)); }
    return { game, generation, groups, exact, skeletons, lengths, postings };
  }

  function consume(iterator) { let result; do { result = iterator.next(); } while (!result.done); return result.value; }
  function createIndex(units, options) { return consume(indexSteps(units, options)); }

  async function consumeAsync(iterator, options = {}) {
    const now = options.now || clock, sliceMs = options.sliceMs ?? 4;
    const schedule = options.schedule || (callback => root.setTimeout(callback, 0));
    let started = now(), count = 0;
    while (true) {
      if (options.signal?.aborted || options.cancelled?.()) throw abortError();
      const result = iterator.next();
      if (result.done) return result.value;
      if (++count >= 64) {
        count = 0;
        if (now() - started < sliceMs) continue;
        await new Promise(resolve => schedule(resolve)); started = now();
      }
    }
  }
  function buildIndex(units, options = {}) { return consumeAsync(indexSteps(units, options), options); }

  function* distanceSteps(left, right, bound = Math.max(left.length, right.length)) {
    if (Math.abs(left.length - right.length) > bound) return bound + 1;
    let previous = new Uint32Array(right.length + 1), current = new Uint32Array(right.length + 1);
    const infinity = bound + 1;
    for (let column = 0; column <= right.length; column++) previous[column] = column <= bound ? column : infinity;
    for (let row = 1; row <= left.length; row++) {
      yield;
      const first = Math.max(1, row - bound), last = Math.min(right.length, row + bound);
      current[0] = row <= bound ? row : infinity;
      if (first > 1) current[first - 1] = infinity;
      let minimum = current[0];
      for (let column = first; column <= last; column++) {
        if (!(column % 512)) yield;
        current[column] = Math.min(current[column - 1] + 1, previous[column] + 1,
          previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1));
        minimum = Math.min(minimum, current[column]);
      }
      if (last < right.length) current[last + 1] = infinity;
      if (minimum > bound) return infinity;
      [previous, current] = [current, previous];
    }
    return previous[right.length];
  }

  function levenshtein(left, right, bound) {
    return consume(distanceSteps(Array.isArray(left) ? left : Array.from(text(left)),
      Array.isArray(right) ? right : Array.from(text(right)), bound));
  }
  function scoreFor(source, current) {
    const left = Array.from(fuzzyKey(source)), right = Array.from(fuzzyKey(current));
    const length = Math.max(left.length, right.length);
    return length ? Math.min(99, Math.floor(100 * (length - levenshtein(left, right)) / length)) : 99;
  }

  const kindRank = { context: 4, exact: 3, adapted: 2, fuzzy: 1 };
  function compareMatches(left, right) {
    return right.score - left.score || kindRank[right.kind] - kindRank[left.kind]
      || Number(right.sameContext) - Number(left.sameContext)
      || Number(right.unit.gameScope !== 'all') - Number(left.unit.gameScope !== 'all')
      || right.unit.updatedAt - left.unit.updatedAt
      || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  }

  function heapPush(heap, value) {
    let index = heap.length; heap.push(value);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (candidateCompare(heap[parent], value) <= 0) break;
      heap[index] = heap[parent]; index = parent;
    }
    heap[index] = value;
  }
  function candidateCompare(left, right) {
    return right.upper - left.upper || right.overlap - left.overlap
      || (left.group.key < right.group.key ? -1 : left.group.key > right.group.key ? 1 : 0);
  }
  function heapPop(heap) {
    const first = heap[0], last = heap.pop();
    if (heap.length) {
      let index = 0;
      while (index * 2 + 1 < heap.length) {
        let child = index * 2 + 1;
        if (child + 1 < heap.length && candidateCompare(heap[child + 1], heap[child]) < 0) child++;
        if (candidateCompare(last, heap[child]) <= 0) break;
        heap[index] = heap[child]; index = child;
      }
      heap[index] = last;
    }
    return first;
  }

  function* searchSteps(index, query, options = {}) {
    const source = text(query?.source ?? query?.english), contextKey = canonicalContext(query?.context);
    const context = normalizeContext(query?.context), knownContext = !!context.filepath && context.entryIndex !== null;
    if (!index || !source.trim()) return [];
    if (query?.game && query.game !== index.game) throw abortError();
    const threshold = Math.min(100, Math.max(0, Number.isFinite(options.threshold) ? options.threshold : 60));
    const limit = Math.min(100, Math.max(1, Number.isSafeInteger(options.limit) ? options.limit : 5));
    const best = [], seen = new Set();
    const remember = (row, score, kind, target = row.unit.target, mapping) => {
      const key = row.identity;
      const candidate = { id: row.unit.id || key, unit: row.unit, source: row.unit.source, target, score, kind,
        sameContext: knownContext && row.contextKey === contextKey, ...(mapping ? { mapping } : {}) };
      const found = best.findIndex(item => item.id === key);
      if (found >= 0) {
        if (compareMatches(best[found], candidate) <= 0) return;
        best.splice(found, 1);
      }
      best.push(candidate); best.sort(compareMatches); best.length = Math.min(limit, best.length);
    };
    const exact = index.exact.get(source);
    if (exact) {
      seen.add(exact.id);
      for (const row of exact.units) {
        yield;
        const contextMatch = knownContext && row.contextKey === contextKey;
        remember(row, contextMatch ? 101 : 100, contextMatch ? 'context' : 'exact');
      }
    }
    const skeleton = skeletonFor(source);
    if (skeleton && threshold <= 99) for (const id of index.skeletons.get(skeleton.key) || []) {
      if (seen.has(id)) continue;
      const group = index.groups[id];
      for (const row of group.units) {
        yield;
        const adapted = adaptVariables(group.source, row.unit.target, source);
        if (adapted) remember(row, 99, 'adapted', adapted.target, adapted.mapping);
      }
    }
    const points = Array.from(fuzzyKey(source)), queryGrams = bigrams(points), overlap = new Uint32Array(index.groups.length);
    const candidates = new Set();
    const admissibleLength = length => Math.abs(points.length - length) <= Math.floor((100 - threshold) * Math.max(points.length, length) / 100);
    for (const [gram, count] of queryGrams) {
      const posting = index.postings.get(gram);
      if (!posting) continue;
      for (let offset = 0; offset < posting.length; offset += 2) {
        yield;
        const id = posting[offset], group = index.groups[id];
        if (!admissibleLength(group.length) || seen.has(id)) continue;
        overlap[id] += Math.min(count, posting[offset + 1]); candidates.add(id);
      }
    }
    // Short sources can be within the edit radius while sharing no bigram.
    for (const [length, ids] of index.lengths) {
      yield;
      const maximum = Math.max(points.length, length), radius = Math.floor((100 - threshold) * maximum / 100);
      if (!admissibleLength(length) || Math.max(Math.max(points.length - 1, 0), Math.max(length - 1, 0)) - 2 * radius > 0) continue;
      for (const id of ids) { yield; if (!seen.has(id)) candidates.add(id); }
    }
    const heap = [];
    for (const id of candidates) {
      yield;
      const group = index.groups[id], maximum = Math.max(points.length, group.length);
      const lower = Math.max(Math.abs(points.length - group.length), Math.ceil((Math.max(Math.max(points.length - 1, 0), group.grams) - overlap[id]) / 2));
      const upper = maximum ? Math.min(99, Math.floor(100 * (maximum - lower) / maximum)) : 99;
      if (upper >= threshold) heapPush(heap, { group, upper, overlap: maximum ? overlap[id] / Math.max(1, group.grams + points.length - 1) : 1 });
    }
    while (heap.length) {
      yield;
      const candidate = heapPop(heap), cutoff = best.length >= limit ? Math.max(threshold, best[best.length - 1].score) : threshold;
      if (candidate.upper < cutoff) break;
      const group = candidate.group, maximum = Math.max(points.length, group.length);
      const radius = Math.floor((100 - Math.min(99, cutoff)) * maximum / 100);
      const distance = yield* distanceSteps(Array.from(group.fold), points, radius);
      if (distance > radius) continue;
      const score = maximum ? Math.min(99, Math.floor(100 * (maximum - distance) / maximum)) : 99;
      if (score < cutoff) continue;
      for (const row of group.units) { yield; remember(row, score, 'fuzzy'); }
    }
    return best.map(match => {
      const group = index.exact.get(match.source);
      const peers = match.kind === 'context' ? group.units.filter(row => row.contextKey === contextKey) : group.units;
      const variantCount = new Set(peers.map(row => row.unit.target)).size;
      return { ...match, warnings: matchWarnings(match.source, source, match.target), diff: sourceDiff(match.source, source),
        variantCount, ambiguous: variantCount > 1 };
    });
  }

  function searchSync(index, query, options) { return consume(searchSteps(index, query, options)); }
  function search(index, query, options = {}) { return consumeAsync(searchSteps(index, query, options), options); }

  function createRuntime(options = {}) {
    let epoch = 0, disposed = false, ready = null, pending = null, building = false, transfer = null;
    const requests = new Map(), pins = new Map(), schedule = options.schedule || (callback => root.setTimeout(callback, 0));
    let retired = null;
    const post = value => { if (!disposed) options.postMessage?.(value); };
    const execution = token => ({ schedule, now: options.now, sliceMs: options.sliceMs ?? 4,
      cancelled: () => disposed || token.epoch !== epoch || token.cancelled });
    function buildNext() {
      if (building || !pending || disposed || retired && pins.get(retired)) return;
      const snapshot = pending, token = { epoch }; pending = null; building = true;
      buildIndex(snapshot.units, { ...execution(token), game: snapshot.game, generation: snapshot.generation }).then(index => {
        if (token.epoch !== epoch || disposed) return;
        if (ready && pins.get(ready)) retired = ready;
        ready = index; post({ type: 'ready', scopeEpoch: epoch, generation: ready.generation });
      }).catch(error => { if (error.name !== 'AbortError') post({ type: 'error', scopeEpoch: token.epoch, generation: snapshot.generation,
        error: { message: error.message, name: error.name } }); }).finally(() => { building = false; buildNext(); });
    }
    return {
      handleMessage(message) {
        if (disposed || !message) return;
        if (message.type === 'setScope') { epoch = message.scopeEpoch; ready = retired = null; pending = transfer = null; for (const token of requests.values()) token.cancelled = true; requests.clear(); return; }
        if (message.scopeEpoch !== epoch) return;
        if (message.type === 'beginSnapshot') { transfer = { ...message, units: [] }; return; }
        if (message.type === 'appendUnits') {
          if (transfer?.generation === message.generation) for (const unit of message.units || []) transfer.units.push(unit);
          return;
        }
        if (message.type === 'appendText') {
          if (transfer?.generation === message.generation && transfer.units[message.unitIndex]
            && ['source', 'target', 'note'].includes(message.field)) transfer.units[message.unitIndex][message.field] += text(message.text);
          return;
        }
        if (message.type === 'commitSnapshot') {
          if (transfer?.generation === message.generation) { pending = transfer; transfer = null; buildNext(); }
          return;
        }
        if (message.type === 'setSnapshot') { pending = message; buildNext(); return; }
        if (message.type === 'cancel') { const token = requests.get(message.requestId); if (token) token.cancelled = true; requests.delete(message.requestId); return; }
        if (message.type === 'query') {
          if (!ready) { post({ type: 'error', scopeEpoch: epoch, requestId: message.requestId, error: { message: 'Translation Memory is not ready.' } }); return; }
          const pinned = ready, token = { epoch, cancelled: false }; requests.set(message.requestId, token);
          pins.set(pinned, (pins.get(pinned) || 0) + 1);
          search(pinned, message.query, { ...message.options, ...execution(token) }).then(matches => {
            if (!token.cancelled && token.epoch === epoch) post({ type: 'matches', requestId: message.requestId, scopeEpoch: epoch,
              generation: pinned.generation, matches });
          }).catch(error => { if (error.name !== 'AbortError') post({ type: 'error', scopeEpoch: token.epoch,
            requestId: message.requestId, error: { message: error.message, name: error.name } }); })
            .finally(() => {
              if (requests.get(message.requestId) === token) requests.delete(message.requestId);
              const count = (pins.get(pinned) || 1) - 1;
              if (count) pins.set(pinned, count); else pins.delete(pinned);
              if (retired === pinned && !count) retired = null;
              buildNext();
            });
        }
      },
      dispose() { disposed = true; for (const token of requests.values()) token.cancelled = true; requests.clear(); ready = retired = pending = transfer = null; },
    };
  }

  return { normalizeUnit, normalizeContext, canonicalContext, contextFor, identityFor, unitsFromDescription, validatePair,
    variableTags, fuzzyKey, skeletonFor, adaptVariables, sourceDiff, matchWarnings, scoreFor, levenshtein,
    createIndex, buildIndex, search, searchAsync: search, searchSync, compareMatches, createRuntime, abortError };
});
