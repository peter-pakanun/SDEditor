const test = require('node:test');
const assert = require('node:assert/strict');
const clipboard = require('../public/clientTextClipboard.js');

test('spreadsheet copies preserve empty positions and literal Unicode, quotes, tabs and newlines', () => {
    const values = ['เปิด', '', 'a\tb', 'one\r\ntwo', 'say "hello"', '=literal()', '<b>{text} & \\n'];
    const data = clipboard.encode(values);
    assert.deepEqual(clipboard.decode(data.text).rows, values.map(value => [value]));
    assert.equal(clipboard.decode(data.text).tabular, true);
    assert.match(data.html, /google-sheets-html-origin/);
    assert.equal((data.html.match(/<tr>/g) || []).length, values.length);
    assert.match(data.html, /data-sheets-value=/);
    assert.match(data.html, /&lt;b&gt;\{text\} &amp;/);
    assert.equal(data.html.includes('<b>{text}'), false);
});

test('null source slots are exported as blank spreadsheet cells without losing their positions', () => {
    const data = clipboard.encode(['first', null, undefined, 'last', '']);
    assert.equal(data.text, 'first\r\n\r\n\r\nlast\r\n');
    assert.deepEqual(clipboard.decode(data.text).rows, [['first'], [''], [''], ['last'], ['']]);
});

test('pasted row positions skip blank values and absent destinations without compacting later rows', () => {
    const rows = clipboard.decode('A\n\nC\nD\nE').rows;
    assert.deepEqual(clipboard.assign(['one', 'two', 'three', null], rows), [
        { unitId: 'one', value: 'A' },
        { unitId: 'three', value: 'C' }
    ]);
});

test('short pastes and extra columns leave unaddressed targets untouched', () => {
    assert.deepEqual(clipboard.assign(['one', 'two', 'three'], [['A', 'overflow']]), [{ unitId: 'one', value: 'A' }]);
    assert.deepEqual(clipboard.assign(['one'], [['A'], ['overflow']]), [{ unitId: 'one', value: 'A' }]);
    assert.deepEqual(clipboard.assign(['one', 'two'], [[''], []]), []);
    assert.deepEqual(clipboard.assign(['one', 'two'], [[' \n\t'], ['kept']]), [{ unitId: 'two', value: 'kept' }]);
});

test('one clipboard cell fills every selected destination and skips missing fields', () => {
    for (const value of ['เปิด', '  literal text  ', 'line one\r\nline two', 'one\ttwo', 'say "hello"', '=literal()']) {
        const { rows } = clipboard.decode(clipboard.encode([value]).text);
        assert.deepEqual(clipboard.assign(['one', null, 'three'], rows), [
            { unitId: 'one', value }, { unitId: 'three', value }
        ]);
        assert.deepEqual(clipboard.assign(['one'], rows), [{ unitId: 'one', value }]);
    }
    assert.deepEqual(clipboard.assign(['one', 'two'], [['']]), []);
    assert.deepEqual(clipboard.assign(['one', 'two'], [[' \r\n\t']]), []);
});

test('single quoted multiline or tabbed cells remain one spreadsheet value', () => {
    for (const value of ['line one\nline two', 'one\ttwo', 'say "hello"']) {
        const data = clipboard.decode(clipboard.encode([value]).text);
        assert.deepEqual(data.rows, [[value]]);
        assert.equal(data.tabular, true);
    }
    assert.equal(clipboard.decode('ordinary text').tabular, false);
    assert.equal(clipboard.decode('"quoted ordinary text"').tabular, false);
});

test('mixed line endings, quoted fields and missing closing quotes have deterministic positions', () => {
    assert.deepEqual(clipboard.decode('first\r\n"two\nlines"\rthird\tignored').rows,
        [['first'], ['two\nlines'], ['third', 'ignored']]);
    assert.deepEqual(clipboard.decode('"unfinished\nnext').rows, [['"unfinished'], ['next']]);
    assert.deepEqual(clipboard.decode('').rows, [['']]);
});

test('Copy all writes both clipboard formats as one literal-text item', async () => {
    const previousClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const previousItem = global.ClipboardItem;
    let items;
    global.ClipboardItem = class { constructor(data) { this.data = data; } };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        write: async value => { items = value; }
    } });
    try {
        await clipboard.write(['=literal', '', 'two\nlines']);
        assert.equal(items.length, 1);
        assert.equal(await items[0].data['text/plain'].text(), '=literal\r\n\r\n"two\nlines"');
        assert.match(await items[0].data['text/html'].text(), /data-sheets-value=/);
    } finally {
        if (previousClipboard) Object.defineProperty(navigator, 'clipboard', previousClipboard);
        else delete navigator.clipboard;
        if (previousItem) global.ClipboardItem = previousItem;
        else delete global.ClipboardItem;
    }
});
