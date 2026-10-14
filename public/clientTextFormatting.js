/* Complete ClientText style wrappers, using raw UTF-16 editor offsets. */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.ClientTextFormatting = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';
    const OPENING_AT_START = /^<(b|bold|i|italic|u|underline)>\{/i;

    function ranges(value) {
        const text = String(value ?? ''), stack = [], found = [];
        for (let index = 0; index < text.length; index++) {
            const opening = text[index] === '<' && OPENING_AT_START.exec(text.slice(index, index + 12));
            if (opening) {
                const range = { style: opening[1][0].toLowerCase(), start: index, contentStart: index + opening[0].length, contentEnd: null, end: null };
                found.push(range); stack.push(range); index += opening[0].length - 1;
            } else if (text[index] === '{') {
                stack.push(null);
            } else if (text[index] === '}' && stack.length) {
                const range = stack.pop();
                if (range) { range.contentEnd = index; range.end = index + 1; }
            }
        }
        // Keep opening order; a complete inner wrapper remains usable even if
        // an unrelated outer brace has not been closed yet.
        return found.filter(range => range.end !== null);
    }

    function selection(value, start, end) {
        const text = String(value ?? ''), result = { b: null, i: null, u: null };
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > text.length) return result;
        for (const range of ranges(text)) {
            const inside = start >= range.contentStart && end <= range.contentEnd;
            const whole = start === range.start && end === range.end;
            if (!inside && !whole) continue;
            const current = result[range.style];
            if (!current || range.start > current.start) result[range.style] = range;
        }
        return result;
    }

    return { ranges, selection };
});
