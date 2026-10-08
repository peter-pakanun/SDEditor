(function (global) {
  const LEVEL_WARNING = "warning";
  const LEVEL_ERROR = "error";

  const OPENERS = {
    "[": "]",
    "{": "}"
  };

  const CLOSERS = {
    "]": "[",
    "}": "{"
  };

  function clampIndex(value, length) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(length, value));
  }

  function makeAddDiagnostic(text, diagnostics) {
    const length = text.length;
    return function addDiagnostic(level, code, message, start, end, extra) {
      let s = clampIndex(start, length);
      let e = clampIndex(end, length);
      if (e <= s && s < length) e = s + 1;
      if (e <= s && s > 0) s -= 1;
      if (e <= s) return;
      diagnostics.push({
        level,
        code,
        message,
        start: s,
        end: e,
        ...(extra || {})
      });
    };
  }

  function lineEndForRange(text, start) {
    let end = text.length;
    for (let i = start; i < text.length; i++) {
      if (text[i] === "\n" || text[i] === "\r") {
        end = i;
        break;
      }
    }
    return Math.max(start + 1, end);
  }

  function makeOffsetAddDiagnostic(addDiagnostic, offset) {
    return function addOffsetDiagnostic(level, code, message, start, end, extra) {
      addDiagnostic(level, code, message, offset + start, offset + end, extra);
    };
  }

  function findSimpleTagEnd(text, start, closeChar) {
    for (let i = start + 1; i < text.length; i++) {
      if (text[i] === "\n" || text[i] === "\r") return start + 1;
      if (text[i] === closeChar) return i + 1;
    }
    return start + 1;
  }

  function scanWhitespace(text, addDiagnostic) {
    let lineStart = 0;

    for (let i = 0; i <= text.length; i++) {
      if (i < text.length && text[i] !== "\n") continue;

      let lineEnd = i;
      if (lineEnd > lineStart && text[lineEnd - 1] === "\r") lineEnd -= 1;
      const line = text.slice(lineStart, lineEnd);
      const protectedRanges = [];

      const leading = /^[ \t]+/.exec(line);
      const trailing = /[ \t]+$/.exec(line);

      if (leading) {
        const start = lineStart;
        const end = lineStart + leading[0].length;
        protectedRanges.push({ start, end });
        addDiagnostic(
          LEVEL_WARNING,
          "leading-whitespace",
          "Leading whitespace",
          start,
          end
        );
      }

      if (trailing) {
        const start = lineEnd - trailing[0].length;
        const end = lineEnd;
        const alreadyCovered = protectedRanges.some(r => r.start === start && r.end === end);
        if (!alreadyCovered) {
          protectedRanges.push({ start, end });
          addDiagnostic(
            LEVEL_WARNING,
            "trailing-whitespace",
            "Trailing whitespace",
            start,
            end
          );
        }
      }

      const consecutiveRegex = /[ \t]{2,}/g;
      let match;
      while ((match = consecutiveRegex.exec(line))) {
        const start = lineStart + match.index;
        const end = start + match[0].length;
        const isEdgeWhitespace = protectedRanges.some(r => r.start <= start && end <= r.end);
        if (isEdgeWhitespace) continue;
        addDiagnostic(
          LEVEL_WARNING,
          "consecutive-whitespace",
          "Consecutive whitespace",
          start,
          end
        );
      }

      lineStart = i + 1;
    }
  }

  function isLineBreak(ch) {
    return ch === "\n" || ch === "\r";
  }

  function isVariableTagStartAt(text, index) {
    if (text[index] !== "{") return false;
    for (let i = index + 1; i < text.length; i++) {
      if (isLineBreak(text[i])) return false;
      if (text[i] === "}") return true;
    }
    return false;
  }

  function isVariableTagEndBefore(text, index) {
    let end = index - 1;
    if (text[end] === "%") end -= 1;
    if (text[end] !== "}") return false;

    for (let i = end - 1; i >= 0; i--) {
      if (isLineBreak(text[i])) return false;
      if (text[i] === "{") return true;
    }
    return false;
  }

  function isDashNextToVariableTag(text, index) {
    return isVariableTagStartAt(text, index + 1) || isVariableTagEndBefore(text, index);
  }

  function isMarkdownListMarker(text, index) {
    const prev = index > 0 ? text[index - 1] : "";
    const next = index + 1 < text.length ? text[index + 1] : "";
    return (index === 0 || isLineBreak(prev)) && /[ \t]/.test(next);
  }

  function isGermanDashSpacingException(text, index, lang) {
    if (String(lang || "").toLocaleLowerCase() !== "german") return false;
    const beforeDash = text.slice(0, index);
    const afterDash = text.slice(index);
    return /^-[ \t]+(?:und|oder)(?=$|[ \t\r\n,.;:!?])/.test(afterDash)
      || /(?:^|[ \t\r\n])(?:und|oder)[ \t]+$/.test(beforeDash)
      || /,[ \t]+$/.test(beforeDash);
  }

  function scanDashBoundaries(text, addDiagnostic, lang) {
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== "-") continue;

      const prev = i > 0 ? text[i - 1] : "";
      const next = i + 1 < text.length ? text[i + 1] : "";
      const isLineStart = i === 0 || isLineBreak(prev);
      const isLineEnd = i + 1 === text.length || isLineBreak(next);
      const touchesWhitespace = /[ \t]/.test(prev) || /[ \t]/.test(next);
      const isSurroundedByWhitespace = /[ \t]/.test(prev) && /[ \t]/.test(next);
      const isNegativeNumber = /\d/.test(next);

      if (!isLineStart && !isLineEnd && !touchesWhitespace) continue;
      if (isSurroundedByWhitespace) continue;
      if (isNegativeNumber) continue;
      if (isMarkdownListMarker(text, i)) continue;
      if (isDashNextToVariableTag(text, i)) continue;
      if (isGermanDashSpacingException(text, i, lang)) continue;

      addDiagnostic(
        LEVEL_WARNING,
        "dash-boundary",
        "Dash should not start or end a line, or touch whitespace",
        i,
        i + 1
      );
    }
  }

  function findTextDecorationAt(text, index) {
    if (text[index] !== "<") return null;
    const nameMatch = /^<([A-Za-z][A-Za-z0-9_:\-]*)>/.exec(text.slice(index));
    if (!nameMatch) return null;
    const opener = nameMatch[0];
    const bodyStart = index + opener.length;
    if (text.slice(bodyStart, bodyStart + 2) !== "{{") {
      if (text[bodyStart] === "{") {
        return {
          malformed: true,
          start: index,
          end: lineEndForRange(text, index),
          message: "Malformed text decoration tag. Expected {{ after tag name."
        };
      }
      return null;
    }

    const contentStart = bodyStart + 2;
    const closeIndex = text.indexOf("}}", contentStart);
    if (closeIndex < 0) {
      return {
        malformed: true,
        start: index,
        end: lineEndForRange(text, index),
        message: "Malformed text decoration tag. Missing closing }}."
      };
    }

    return {
      malformed: false,
      start: index,
      openerEnd: bodyStart,
      contentStart,
      contentEnd: closeIndex,
      end: closeIndex + 2,
      tagName: nameMatch[1]
    };
  }

  function isKeywordReferenceVariableAt(text, index, keyword) {
    if (keyword.hasDynamicSeparator) return false;
    // Parameterized references such as [TentacleSmash::{0}|Tentacle Whip]
    // allow one numeric variable after the double colon, before the display text.
    const prefix = text.slice(keyword.index + 1, index);
    if (/^[A-Za-z][A-Za-z0-9_]*::$/.test(prefix)
      && /^\{\d+\}(?=[|\]])/.test(text.slice(index))) return true;
    // Skill references can carry a gem level in their identity. Only its
    // numeric placeholder is allowed here; other nested braces remain errors.
    return /^[A-Za-z][A-Za-z0-9_]*<gemlevel=$/.test(prefix)
      && /^\{\d+\}>(?=[|\]])/.test(text.slice(index));
  }

  function scanTags(text, addDiagnostic) {
    const stack = [];

    for (let i = 0; i < text.length; i++) {
      const textDecoration = findTextDecorationAt(text, i);
      if (textDecoration) {
        if (textDecoration.malformed) {
          addDiagnostic(
            LEVEL_WARNING,
            "malformed-text-decoration-tag",
            textDecoration.message,
            textDecoration.start,
            textDecoration.end
          );
          i = Math.max(i, textDecoration.end - 1);
          continue;
        }

        const inner = text.slice(textDecoration.contentStart, textDecoration.contentEnd);
        scanTags(inner, makeOffsetAddDiagnostic(addDiagnostic, textDecoration.contentStart));
        i = textDecoration.end - 1;
        continue;
      }

      const ch = text[i];
      const current = stack[stack.length - 1];

      if (ch === "|" && current?.open === "[") {
        current.hasDynamicSeparator = true;
        continue;
      }

      if (Object.prototype.hasOwnProperty.call(OPENERS, ch)) {
        const isAllowedVariableInKeyword = ch === "{"
          && current?.open === "["
          && (current.hasDynamicSeparator || isKeywordReferenceVariableAt(text, i, current));

        if (stack.length > 0 && !isAllowedVariableInKeyword) {
          addDiagnostic(
            LEVEL_ERROR,
            "nested-tags",
            `Nested tag. Close ${current.close} before starting another tag.`,
            i,
            findSimpleTagEnd(text, i, OPENERS[ch]),
            { expected: current.close }
          );
        }
        stack.push({ open: ch, close: OPENERS[ch], index: i });
        continue;
      }

      if (Object.prototype.hasOwnProperty.call(CLOSERS, ch)) {
        const expectedOpen = CLOSERS[ch];
        const current = stack[stack.length - 1];

        if (!current) {
          addDiagnostic(
            LEVEL_ERROR,
            "extra-closing-tag",
            `Extra closing ${ch}`,
            i,
            i + 1
          );
          continue;
        }

        if (current.open === expectedOpen) {
          stack.pop();
          continue;
        }

        addDiagnostic(
          LEVEL_ERROR,
          "extra-closing-tag",
          `Extra closing ${ch}. Expected ${current.close} first.`,
          i,
          i + 1,
          { expected: current.close }
        );
      }
    }

    for (let i = stack.length - 1; i >= 0; i--) {
      const tag = stack[i];
      addDiagnostic(
        LEVEL_ERROR,
        "missing-closing-tag",
        `Missing closing ${tag.close}`,
        tag.index,
        lineEndForRange(text, tag.index),
        { expected: tag.close }
      );
    }
  }

  function countLevel(diagnostics, level) {
    return diagnostics.filter(d => d.level === level).length;
  }

  function analyze(value, options = {}) {
    const text = String(value ?? "");
    const diagnostics = [];
    const addDiagnostic = makeAddDiagnostic(text, diagnostics);

    if (!options.checks || options.checks.whitespace) scanWhitespace(text, addDiagnostic);
    if (!options.checks || options.checks.dash) scanDashBoundaries(text, addDiagnostic, options.lang);
    if (!options.checks || options.checks.tagSyntax) scanTags(text, addDiagnostic);

    diagnostics.sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start;
      if (a.end !== b.end) return a.end - b.end;
      if (a.level === b.level) return 0;
      return a.level === LEVEL_ERROR ? -1 : 1;
    });

    return {
      diagnostics,
      warningCount: countLevel(diagnostics, LEVEL_WARNING),
      errorCount: countLevel(diagnostics, LEVEL_ERROR)
    };
  }

  function normalizeConsistencyText(value) {
    return String(value ?? "").replace(/\r\n?/g, "\n").replace(/\\n/g, "\n");
  }

  function addConsistencyEntry(index, english, translation, location) {
    const source = normalizeConsistencyText(english);
    if (!source) return;
    const target = normalizeConsistencyText(translation);
    let group = index.get(source);
    if (!group) {
      group = { variants: new Map(), entryCount: 0 };
      index.set(source, group);
    }
    if (!group.variants.has(target)) group.variants.set(target, []);
    group.variants.get(target).push(location);
    group.entryCount++;
  }

  function createConsistencyIndex(descs, lang) {
    const index = new Map();
    for (const desc of (Array.isArray(descs) ? descs : [])) {
      const english = Array.isArray(desc?.translations?.English) ? desc.translations.English : [];
      const translations = Array.isArray(desc?.translations?.[lang]) ? desc.translations[lang] : [];
      for (let blockIndex = 0; blockIndex < english.length; blockIndex++) {
        addConsistencyEntry(index, english[blockIndex], translations[blockIndex], {
          filepath: String(desc?.filepath ?? ""),
          blockIndex
        });
      }
    }
    return index;
  }

  function updateConsistencyIndex(index, descs, lang, previousResults) {
    const changed = Array.isArray(descs) ? descs : [];
    const changedPaths = new Set(changed.map(desc => desc.filepath));
    const affectedPaths = new Set(changedPaths);
    const sources = new Set();
    for (const desc of changed) {
      const previous = previousResults[desc.filepath];
      const english = desc.translations?.English || [];
      const translations = desc.translations?.[lang] || [];
      for (let i = 0; i < Math.max(english.length, previous?.englishLines?.length || 0); i++) {
        const source = normalizeConsistencyText(english[i]);
        const oldSource = normalizeConsistencyText(previous?.englishLines?.[i]);
        if (source === oldSource && normalizeConsistencyText(translations[i])
          === normalizeConsistencyText(previous?.translationLines?.[i])) continue;
        if (source) sources.add(source);
        if (oldSource) sources.add(oldSource);
      }
    }
    // Replace this batch's entries only in the groups whose source/text changed.
    // Other groups and unrelated cached file results remain untouched.
    for (const source of sources) {
      const group = index.get(source);
      if (!group) continue;
      for (const [translation, locations] of group.variants) {
        const peers = locations.filter(location => {
          affectedPaths.add(location.filepath);
          return !changedPaths.has(location.filepath);
        });
        group.entryCount -= locations.length - peers.length;
        if (peers.length) group.variants.set(translation, peers);
        else group.variants.delete(translation);
      }
      if (!group.entryCount) index.delete(source);
    }
    for (const desc of changed) {
      const english = desc.translations?.English || [];
      const translations = desc.translations?.[lang] || [];
      for (let blockIndex = 0; blockIndex < english.length; blockIndex++) {
        if (!sources.has(normalizeConsistencyText(english[blockIndex]))) continue;
        addConsistencyEntry(index, english[blockIndex], translations[blockIndex], { filepath: desc.filepath, blockIndex });
      }
    }
    for (const source of sources) for (const locations of index.get(source)?.variants.values() || []) {
      for (const location of locations) affectedPaths.add(location.filepath);
    }
    return affectedPaths;
  }

  function createEditedConsistencyIndex(index, filepath, entries) {
    const edited = new Map();
    const draftEntries = Array.isArray(entries) ? entries : [];
    const editedFilepath = String(filepath ?? "");

    // Only copy groups used by this draft, replacing every saved entry from its file.
    for (const entry of draftEntries) {
      const source = normalizeConsistencyText(entry?.english);
      if (!source || edited.has(source)) continue;
      const group = { variants: new Map(), entryCount: 0 };
      edited.set(source, group);
      const savedGroup = index?.get(source);
      for (const [translation, locations] of (savedGroup?.variants || [])) {
        const peers = locations.filter(location => location.filepath !== editedFilepath)
          .map(location => ({ ...location }));
        if (peers.length === 0) continue;
        group.variants.set(translation, peers);
        group.entryCount += peers.length;
      }
    }

    for (const entry of draftEntries) {
      addConsistencyEntry(edited, entry?.english, entry?.translation, {
        filepath: editedFilepath,
        blockIndex: entry?.blockIndex
      });
    }
    return edited;
  }

  function consistencyTranslationPreview(translation) {
    if (translation === "") return "(empty translation)";
    const quoted = JSON.stringify(translation);
    if (quoted.length <= 160) return quoted;
    let shortened = translation.slice(0, 155);
    while (JSON.stringify(shortened + "...").length > 160) shortened = shortened.slice(0, -1);
    return JSON.stringify(shortened + "...");
  }

  function getConsistencyDiagnostic(index, english, translation) {
    const source = normalizeConsistencyText(english);
    if (!source) return null;
    const group = index?.get(source);
    if (!group || group.variants.size < 2) return null;
    const currentTranslation = normalizeConsistencyText(translation);
    const examples = [];
    const otherVariantCount = group.variants.size - (group.variants.has(currentTranslation) ? 1 : 0);
    for (const [variant, locations] of group.variants) {
      if (variant === currentTranslation) continue;
      const location = locations[0];
      examples.push(`${location.filepath} #${Number(location.blockIndex || 0) + 1}: ${consistencyTranslationPreview(variant)}`);
      if (examples.length >= 3) break;
    }
    const omitted = otherVariantCount - examples.length;
    let message = `Inconsistent translation: identical English has ${group.variants.size} different translations across ${group.entryCount} entries.`;
    if (examples.length > 0) message += ` Other translations: ${examples.join("; ")}.`;
    if (omitted > 0) message += ` ${omitted} more translation variant(s) omitted.`;
    return {
      level: LEVEL_WARNING,
      code: "inconsistent-translation",
      message,
      variantCount: group.variants.size,
      entryCount: group.entryCount
    };
  }

  const api = {
    LEVEL_WARNING,
    LEVEL_ERROR,
    analyze,
    normalizeConsistencyText,
    createConsistencyIndex,
    updateConsistencyIndex,
    createEditedConsistencyIndex,
    getConsistencyDiagnostic
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  global.TranslationDiagnostics = api;
})(typeof window !== "undefined" ? window : globalThis);
