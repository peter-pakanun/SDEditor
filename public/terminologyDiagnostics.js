(function (global) {
  const WORD_CHARACTER = /[\p{L}\p{M}\p{N}_]/u;
  const UNSEGMENTED_CHARACTER = /[\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

  function normalize(value) {
    return String(value ?? "").replace(/\\n/g, " ").replace(/\s+/gu, " ").trim().toLowerCase();
  }

  // Render game markup as text without treating identifiers as translated words.
  // Source tags without an explicit display use their names, as English does.
  function visibleText(value, source = false, ownedNames = null) {
    const input = String(value ?? "");
    const tags = [];
    const ownedRanges = [];
    let text = "";
    let dynamic = false;
    const append = value => {
      let part = String(value).replace(/\\n/g, " ").replace(/\s+/gu, " ").toLowerCase();
      if (text.endsWith(" ") && part.startsWith(" ")) part = part.slice(1);
      text += part;
    };

    function read(start, end) {
      let position = start;
      while (position < end) {
        const ch = input[position];
        if (ch === "[") {
          const close = input.indexOf("]", position + 1);
          if (close >= 0 && close < end) {
            const inner = input.slice(position + 1, close);
            const separator = inner.indexOf("|");
            const name = (separator < 0 ? inner : inner.slice(0, separator)).trim();
            if (name && !/[\[\r\n]/.test(name)) {
              const display = separator < 0 ? name : inner.slice(separator + 1);
              const rendered = visibleText(display, source);
              const tag = {
                name,
                key: normalize(name),
                display,
                visible: rendered.text.trim(),
                dynamic: rendered.dynamic,
                explicitDisplay: separator >= 0,
                start: position,
                end: close + 1
              };
              tags.push(tag);
              const visibleStart = text.length;
              append(separator >= 0 || source ? rendered.text : " ");
              if (ownedNames?.has(tag.key)) ownedRanges.push({ start: visibleStart, end: text.length });
              dynamic = dynamic || rendered.dynamic;
              position = close + 1;
              continue;
            }
          }
        }
        if (ch === "<") {
          const decoration = /^<[A-Za-z][A-Za-z0-9_:\-]*>\{\{/.exec(input.slice(position, end));
          if (decoration) {
            const bodyStart = position + decoration[0].length;
            const bodyEnd = input.indexOf("}}", bodyStart);
            if (bodyEnd >= 0 && bodyEnd < end) {
              read(bodyStart, bodyEnd);
              position = bodyEnd + 2;
              continue;
            }
          }
          const close = input.indexOf(">", position + 1);
          if (close >= 0 && close < end && !/[\r\n]/.test(input.slice(position, close))) {
            dynamic = true;
            append(" ");
            position = close + 1;
            continue;
          }
        }
        if (ch === "{") {
          const close = input.indexOf("}", position + 1);
          if (close >= 0 && close < end && !/[\r\n]/.test(input.slice(position, close))) {
            append(" ");
            position = close + 1;
            continue;
          }
        }
        let next = position + 1;
        while (next < end && !/[\[<{]/.test(input[next])) next++;
        append(input.slice(position, next));
        position = next;
      }
    }

    read(0, input.length);
    return { text, tags, ownedRanges, dynamic };
  }

  function characterBefore(text, index) {
    if (index <= 0) return "";
    const last = text.charCodeAt(index - 1);
    const start = last >= 0xDC00 && last <= 0xDFFF && index > 1 ? index - 2 : index - 1;
    return text.slice(start, index);
  }

  function characterAt(text, index) {
    if (index >= text.length) return "";
    return String.fromCodePoint(text.codePointAt(index));
  }

  function hasBoundaries(text, start, end, target = false) {
    const first = characterAt(text, start);
    const last = characterBefore(text, end);
    const checkFirst = WORD_CHARACTER.test(first) && !(target && UNSEGMENTED_CHARACTER.test(first));
    const checkLast = WORD_CHARACTER.test(last) && !(target && UNSEGMENTED_CHARACTER.test(last));
    return !(checkFirst && WORD_CHARACTER.test(characterBefore(text, start)))
      && !(checkLast && WORD_CHARACTER.test(characterAt(text, end)));
  }

  function containsTranslation(text, translation) {
    let start = text.indexOf(translation);
    while (start >= 0) {
      if (hasBoundaries(text, start, start + translation.length, true)) return true;
      start = text.indexOf(translation, start + 1);
    }
    return false;
  }

  function compileDictionary(dictionary) {
    const groups = new Map();
    for (const entry of (Array.isArray(dictionary) ? dictionary : [])) {
      const mainFind = String(entry?.find ?? "").trim();
      const key = normalize(mainFind);
      if (!key) continue;
      const replacements = [entry?.replace];
      const finds = [mainFind];
      for (const alt of (Array.isArray(entry?.alts) ? entry.alts : [])) {
        if (!alt || typeof alt !== "object") continue;
        if (String(alt.find ?? "").trim()) finds.push(String(alt.find).trim());
        replacements.push(alt.replace ?? entry?.replace);
      }
      const allowed = new Map();
      for (const replacement of replacements) {
        const raw = String(replacement ?? "").trim();
        if (!raw) continue;
        const visible = visibleText(raw, true).text.trim();
        if (visible) allowed.set(visible, raw);
      }
      if (!allowed.size) continue;
      let group = groups.get(key);
      if (!group) {
        group = { key, source: mainFind, finds: new Set(), allowed: new Map(), dictionaryIds: new Set() };
        groups.set(key, group);
      }
      for (const find of finds) group.finds.add(find);
      for (const [visible, raw] of allowed) group.allowed.set(visible, raw);
      if (entry?._id) group.dictionaryIds.add(String(entry._id));
    }

    const definitions = new Map();
    for (const group of groups.values()) {
      for (const find of group.finds) {
        const key = visibleText(find, true).text.trim();
        if (!key) continue;
        let definition = definitions.get(key);
        if (!definition) {
          definition = { key, source: find, allowed: new Map(), dictionaryIds: new Set() };
          definitions.set(key, definition);
        }
        for (const [visible, raw] of group.allowed) definition.allowed.set(visible, raw);
        for (const id of group.dictionaryIds) definition.dictionaryIds.add(id);
      }
    }

    const trie = { children: new Map() };
    for (const definition of definitions.values()) {
      let node = trie;
      for (const character of definition.key) {
        if (!node.children.has(character)) node.children.set(character, { children: new Map() });
        node = node.children.get(character);
      }
      node.definition = definition;
    }
    return { trie, groups, size: definitions.size };
  }

  function findTerms(source, compiled) {
    const matches = [];
    const text = source.text;
    for (let start = 0; start < text.length;) {
      let node = compiled.trie;
      let end = start;
      while (end < text.length) {
        const character = characterAt(text, end);
        node = node.children.get(character);
        if (!node) break;
        end += character.length;
        if (!node.definition || !hasBoundaries(text, start, end)) continue;
        // An identified keyword owns its own wording. A larger phrase may still
        // span that keyword's displayed text and surrounding ordinary text.
        if (source.ownedRanges.some(range => range.start <= start && end <= range.end)) continue;
        matches.push({ start, end, definition: node.definition });
      }
      start += characterAt(text, start).length;
    }
    matches.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);
    const selected = [];
    for (const match of matches) {
      if (selected.some(other => match.start < other.end && other.start < match.end)) continue;
      selected.push(match);
    }
    return selected.sort((a, b) => a.start - b.start);
  }

  function diagnostic(rule, source, detail = "") {
    const allowed = Array.from(rule.allowed.values());
    const quoted = allowed.map(value => JSON.stringify(value)).join(" or ");
    return {
      level: "warning",
      code: "dictionary-terminology",
      message: `Dictionary terminology: ${JSON.stringify(source)} should use ${quoted}.${detail ? " " + detail : ""} Add another allowed wording as a dictionary alternative.`,
      dictionaryIds: Array.from(rule.dictionaryIds),
      sourceTerm: source,
      allowedTranslations: allowed
    };
  }

  function analyze(english, translation, compiled, options = {}) {
    if (!compiled?.trie || !compiled?.groups || !compiled.size) return [];
    const source = visibleText(english, true, compiled.groups);
    const target = visibleText(translation, false);
    const diagnostics = [];
    const seenTags = new Set();

    for (const tag of source.tags) {
      const rule = compiled.groups.get(tag.key);
      if (!rule || seenTags.has(tag.key)) continue;
      seenTags.add(tag.key);
      const translatedTags = target.tags.filter(candidate => candidate.key === tag.key);
      if (!translatedTags.length) {
        diagnostics.push(diagnostic(rule, `[${tag.name}]`, `No corresponding [${tag.name}] translation was found.`));
        continue;
      }
      const mismatches = translatedTags.filter(candidate => {
        if (candidate.dynamic && !candidate.visible) return false;
        return !rule.allowed.has(candidate.visible);
      });
      if (!mismatches.length) continue;
      const displays = Array.from(new Set(mismatches.map(candidate => candidate.display)));
      const detail = `Found ${displays.map(value => JSON.stringify(value || "(empty display)")).join(", ")} in [${tag.name}].`;
      const result = diagnostic(rule, `[${tag.name}]`, detail);
      // A real tag provides a precise target range; ordinary missing terms do not.
      result.start = mismatches[0].start;
      result.end = mismatches[0].end;
      diagnostics.push(result);
    }

    const seenTerms = new Set();
    for (const match of findTerms(source, compiled)) {
      const rule = match.definition;
      if (seenTerms.has(rule.key)) continue;
      seenTerms.add(rule.key);
      if (Array.from(rule.allowed.keys()).some(allowed => containsTranslation(target.text, allowed))) continue;
      diagnostics.push(diagnostic(rule, rule.source));
    }
    return diagnostics;
  }

  const api = { compileDictionary, analyze };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.TerminologyDiagnostics = api;
})(typeof window !== "undefined" ? window : globalThis);
