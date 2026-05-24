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

  function scanDashBoundaries(text, addDiagnostic) {
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== "-") continue;

      const prev = i > 0 ? text[i - 1] : "";
      const next = i + 1 < text.length ? text[i + 1] : "";
      const isLineStart = i === 0 || prev === "\n" || prev === "\r";
      const isLineEnd = i + 1 === text.length || next === "\n" || next === "\r";
      const touchesWhitespace = /[ \t]/.test(prev) || /[ \t]/.test(next);

      if (!isLineStart && !isLineEnd && !touchesWhitespace) continue;

      addDiagnostic(
        LEVEL_WARNING,
        "dash-boundary",
        "Dash should not start or end a line, or touch whitespace",
        i,
        i + 1
      );
    }
  }

  function scanTags(text, addDiagnostic) {
    const stack = [];

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];

      if (Object.prototype.hasOwnProperty.call(OPENERS, ch)) {
        if (stack.length > 0) {
          const current = stack[stack.length - 1];
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

  function analyze(value) {
    const text = String(value ?? "");
    const diagnostics = [];
    const addDiagnostic = makeAddDiagnostic(text, diagnostics);

    scanWhitespace(text, addDiagnostic);
    scanDashBoundaries(text, addDiagnostic);
    scanTags(text, addDiagnostic);

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

  const api = {
    LEVEL_WARNING,
    LEVEL_ERROR,
    analyze
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  global.TranslationDiagnostics = api;
})(typeof window !== "undefined" ? window : globalThis);
