'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const Formatting = require('../public/clientTextFormatting.js');
const inactive = { b: null, i: null, u: null };

test('browser and CommonJS expose the same pure formatting API', () => {
    const browser = { window: {} };
    vm.runInNewContext(fs.readFileSync(require.resolve('../public/clientTextFormatting.js'), 'utf8'), browser);
    assert.equal(typeof browser.window.ClientTextFormatting.ranges, 'function');
    assert.equal(typeof browser.window.ClientTextFormatting.selection, 'function');
    assert.deepEqual(JSON.parse(JSON.stringify(browser.window.ClientTextFormatting.ranges('<b>{text}'))), Formatting.ranges('<b>{text}'));
});

test('ranges report complete wrappers in opening order with exact raw offsets', () => {
    const text = 'before <b>{one <i>{two}} after <u>{three}';
    assert.deepEqual(Formatting.ranges(text), [
        { style: 'b', start: 7, contentStart: 11, contentEnd: 23, end: 24 },
        { style: 'i', start: 15, contentStart: 19, contentEnd: 22, end: 23 },
        { style: 'u', start: 31, contentStart: 35, contentEnd: 40, end: 41 }
    ]);
    for (const range of Formatting.ranges(text)) {
        assert.equal(text.slice(range.start, range.contentStart), '<' + range.style + '>{');
        assert.equal(text.slice(range.contentEnd, range.end), '}');
    }
});

for (const style of ['b', 'i', 'u']) {
    test(style + ' activates only within content or an exactly selected wrapper', () => {
        const text = '<' + style + '>{word}', range = Formatting.ranges(text)[0];
        for (const position of [range.contentStart, range.contentStart + 2, range.contentEnd]) {
            assert.deepEqual(Formatting.selection(text, position, position), { ...inactive, [style]: range });
        }
        assert.deepEqual(Formatting.selection(text, range.contentStart, range.contentEnd), { ...inactive, [style]: range });
        assert.deepEqual(Formatting.selection(text, range.start, range.end), { ...inactive, [style]: range });
        for (const position of [range.start, range.start + 1, range.start + 2, range.start + 3, range.end]) {
            assert.deepEqual(Formatting.selection(text, position, position), inactive);
        }
        for (const [start, end] of [[0, 4], [3, 7], [4, 9], [0, 8]]) {
            assert.deepEqual(Formatting.selection(text, start, end), inactive);
        }
    });

    test(style + ' empty wrapper has one active caret position and supports whole selection', () => {
        const text = '<' + style + '>{}', range = Formatting.ranges(text)[0];
        assert.equal(range.contentStart, range.contentEnd);
        assert.deepEqual(Formatting.selection(text, 4, 4), { ...inactive, [style]: range });
        assert.deepEqual(Formatting.selection(text, 0, 5), { ...inactive, [style]: range });
        assert.deepEqual(Formatting.selection(text, 5, 5), inactive);
    });
}

test('nested different styles activate together for caret and inner content selections', () => {
    const text = '<b>{one <i>{two <u>{three}}}}', [bold, italic, underline] = Formatting.ranges(text);
    assert.deepEqual(Formatting.selection(text, 13, 14), { b: bold, i: italic, u: null });
    assert.deepEqual(Formatting.selection(text, 22, 22), { b: bold, i: italic, u: underline });
    assert.deepEqual(Formatting.selection(text, underline.start, underline.end), { b: bold, i: italic, u: underline });
    assert.deepEqual(Formatting.selection(text, italic.contentStart, italic.contentEnd), { b: bold, i: italic, u: null });
});

test('deep same-style nesting prefers the innermost wrapper that covers the selection', () => {
    const text = '<b>{outer <b>{middle <b>{inner} end} tail}', ranges = Formatting.ranges(text);
    assert.equal(ranges.length, 3);
    const position = text.indexOf('inner') + 2;
    assert.deepEqual(Formatting.selection(text, position, position), { ...inactive, b: ranges[2] });
    assert.deepEqual(Formatting.selection(text, text.indexOf('middle'), text.indexOf(' end') + 4), { ...inactive, b: ranges[1] });
    assert.deepEqual(Formatting.selection(text, ranges[2].start, ranges[2].end), { ...inactive, b: ranges[2] });
    assert.deepEqual(Formatting.selection(text, ranges[1].start, ranges[1].end), { ...inactive, b: ranges[1] });
});

test('crossing a nested style boundary activates only the covering outer style', () => {
    const text = '<b>{one <i>{two} three}', [bold, italic] = Formatting.ranges(text);
    assert.deepEqual(Formatting.selection(text, 5, 14), { ...inactive, b: bold });
    assert.deepEqual(Formatting.selection(text, italic.contentStart, text.indexOf('three') + 2), { ...inactive, b: bold });
    assert.deepEqual(Formatting.selection(text, bold.contentStart, bold.contentEnd), { ...inactive, b: bold });
});

test('separate wrappers never activate a selection crossing both of them', () => {
    const text = '<b>{one} <b>{two} <i>{three}';
    assert.deepEqual(Formatting.selection(text, 4, 15), inactive);
    assert.deepEqual(Formatting.selection(text, 0, text.length), inactive);
    assert.deepEqual(Formatting.selection(text, 9, 9), inactive);
});

test('generic braces, placeholders and other nested tags do not close a style early', () => {
    const text = '<b>{<rgb(1,2,3)>{value {0:0.1f} [Keyword<gemlevel={1}>|label]} + <i>{more}}';
    const [bold, italic] = Formatting.ranges(text);
    assert.equal(Formatting.ranges(text).length, 2);
    assert.equal(bold.end, text.length);
    assert.equal(text.slice(bold.contentStart, bold.contentEnd), '<rgb(1,2,3)>{value {0:0.1f} [Keyword<gemlevel={1}>|label]} + <i>{more}');
    const placeholder = text.indexOf('0:0.1f') + 2;
    assert.deepEqual(Formatting.selection(text, placeholder, placeholder), { ...inactive, b: bold });
    assert.deepEqual(Formatting.selection(text, italic.contentStart, italic.contentEnd), { b: bold, i: italic, u: null });
});

test('multiline CRLF and astral characters retain raw UTF-16 offsets', () => {
    const text = '😀\r\n<b>{first\r\n<i>{second😀}\r\nlast}', [bold, italic] = Formatting.ranges(text);
    assert.equal(bold.start, 4);
    assert.equal(bold.contentStart, 8);
    assert.equal(text.slice(bold.contentStart, bold.contentEnd), 'first\r\n<i>{second😀}\r\nlast');
    assert.equal(text.slice(italic.contentStart, italic.contentEnd), 'second😀');
    assert.deepEqual(Formatting.selection(text, italic.contentStart, italic.contentEnd), { b: bold, i: italic, u: null });
    assert.equal(text, '😀\r\n<b>{first\r\n<i>{second😀}\r\nlast}');
});

for (const text of ['<b> {text}', '< b>{text}', '<b/>{text}', '</b>{text}', '<b>{unfinished', '<b>{unfinished {0}', '<b>text}', '<b>{<i>{unfinished}', '<b:1>{text}', '<normal>{text}', '<underline()>{text}']) {
    test('malformed or unsupported opening is not reinterpreted: ' + text, () => {
        const ranges = Formatting.ranges(text);
        if (text === '<b>{<i>{unfinished}') {
            assert.deepEqual(ranges, [{ style: 'i', start: 4, contentStart: 8, contentEnd: 18, end: 19 }]);
            assert.deepEqual(Formatting.selection(text, 10, 10), { ...inactive, i: ranges[0] });
        } else {
            assert.deepEqual(ranges, []);
            assert.deepEqual(Formatting.selection(text, 0, text.length), inactive);
        }
    });
}

test('unmatched outer braces preserve complete independent wrappers without assigning extra text', () => {
    const text = '{unfinished <b>{valid} rest <i>{also valid}';
    const ranges = Formatting.ranges(text);
    assert.equal(ranges.length, 2);
    assert.deepEqual(ranges.map(range => text.slice(range.contentStart, range.contentEnd)), ['valid', 'also valid']);
    assert.deepEqual(Formatting.ranges('}<u>{valid}}').map(range => range.style), ['u']);
});

for (const [tag, style] of [['B', 'b'], ['I', 'i'], ['U', 'u'], ['bold', 'b'], ['italic', 'i'], ['underline', 'u'], ['BoLd', 'b'], ['ITALIC', 'i'], ['UnDeRlInE', 'u']]) {
    test('supported alias ' + tag + ' maps to ' + style + ' while retaining its raw opening length', () => {
        const text = 'x <' + tag + '>{word} y';
        const range = { style, start: 2, contentStart: tag.length + 5, contentEnd: tag.length + 9, end: tag.length + 10 };
        assert.deepEqual(Formatting.ranges(text), [range]);
        assert.deepEqual(Formatting.selection(text, range.contentStart, range.contentEnd), { ...inactive, [style]: range });
        assert.deepEqual(Formatting.selection(text, range.start, range.end), { ...inactive, [style]: range });
        assert.deepEqual(Formatting.selection(text, range.start + 2, range.contentStart), inactive);
    });
}

test('double-brace wrappers retain the inner brace pair as content', () => {
    const text = '<bold>{{item {0}}}', [range] = Formatting.ranges(text);
    assert.equal(range.style, 'b');
    assert.equal(text.slice(range.contentStart, range.contentEnd), '{item {0}}');
    assert.deepEqual(Formatting.selection(text, range.contentStart, range.contentEnd), { ...inactive, b: range });
    assert.deepEqual(Formatting.ranges('<bold>{{unfinished}'), []);
});

test('invalid, reversed, non-integer and out-of-bounds selections stay inactive', () => {
    const text = '<b>{word}';
    for (const [start, end] of [[-1, 5], [4, text.length + 1], [6, 4], [4.5, 5], [4, NaN], [Infinity, Infinity], [null, 4], ['4', 5], [undefined, undefined]]) {
        assert.deepEqual(Formatting.selection(text, start, end), inactive);
    }
    assert.deepEqual(Formatting.ranges(null), []);
    assert.deepEqual(Formatting.selection(null, 0, 0), inactive);
});

test('callers can inspect ranges without changing the source or later results', () => {
    const text = '<b>{literal <i>{nested}}';
    const first = Formatting.ranges(text);
    first[0].contentEnd = 0;
    assert.equal(Formatting.ranges(text)[0].contentEnd, text.length - 1);
    assert.equal(text, '<b>{literal <i>{nested}}');
});
