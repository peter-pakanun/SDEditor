/* Spreadsheet clipboard values are literal text. Empty slots keep their row positions. */
(function (root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.ClientTextClipboard = api;
})(typeof globalThis === 'object' ? globalThis : self, function (root) {
    'use strict';

    function escapeHtml(value) {
        return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
    }

    function encode(values) {
        const cells = values.map(value => value == null ? '' : String(value));
        const text = cells.map(value => /[\t\r\n"]/.test(value)
            ? '"' + value.replaceAll('"', '""') + '"' : value).join('\r\n');
        const rows = cells.map(value => {
            const data = escapeHtml(JSON.stringify({ 1: 2, 2: value }));
            return '<tr><td style="white-space:pre-wrap" data-sheets-value="' + data + '">'
                + escapeHtml(value).replace(/\r\n|\r|\n/g, '<br>') + '</td></tr>';
        }).join('');
        return { text, html: '<google-sheets-html-origin><table><tbody>' + rows
            + '</tbody></table></google-sheets-html-origin>' };
    }

    function parseText(text) {
        const rows = [];
        let row = [], value = '', quoted = false, atStart = true;
        for (let index = 0; index < text.length; index++) {
            const char = text[index];
            if (quoted) {
                if (char !== '"') value += char;
                else if (text[index + 1] === '"') { value += '"'; index++; }
                else quoted = false;
                continue;
            }
            if (char === '"' && atStart) { quoted = true; atStart = false; continue; }
            if (char === '\t' || char === '\r' || char === '\n') {
                row.push(value); value = ''; atStart = true;
                if (char !== '\t') {
                    rows.push(row); row = [];
                    if (char === '\r' && text[index + 1] === '\n') index++;
                }
            } else { value += char; atStart = false; }
        }
        // A leading quote without a closing quote is ordinary pasted text.
        if (quoted) return text.split(/\r\n|\r|\n/).map(line => line.split('\t'));
        row.push(value); rows.push(row);
        return rows;
    }

    function cellText(cell) {
        const json = cell.getAttribute('data-sheets-value');
        if (json) {
            try {
                const data = JSON.parse(json);
                if (data['1'] === 2 && typeof data['2'] === 'string') return data['2'];
            } catch { /* Non-Sheets tables still have a readable literal value. */ }
        }
        let value = '';
        function visit(node) {
            if (node.nodeType === 3) { value += node.nodeValue; return; }
            if (node.nodeType !== 1 || /^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT|TABLE|IFRAME|OBJECT|EMBED|SVG|MATH)$/i.test(node.tagName)) return;
            if (node.tagName === 'BR') { value += '\n'; return; }
            const block = /^(DIV|P|LI)$/.test(node.tagName);
            if (block && value && !value.endsWith('\n')) value += '\n';
            for (const child of node.childNodes) visit(child);
            if (block && node.nextSibling && !value.endsWith('\n')) value += '\n';
        }
        for (const child of cell.childNodes) visit(child);
        return value;
    }

    function decode(text, html = '') {
        if (html && root.document) {
            // Template content stays detached and inert. Clipboard markup is never rendered.
            const template = root.document.createElement('template');
            template.innerHTML = html;
            const table = template.content.querySelector('table');
            if (table) {
                const rows = [];
                const occupied = [];
                const tableRows = [...table.querySelectorAll('tr')].filter(row => row.closest('table') === table);
                const remainingRows = [], groupCounts = new Map();
                for (let index = tableRows.length - 1; index >= 0; index--) {
                    const group = tableRows[index].parentElement;
                    const count = (groupCounts.get(group) || 0) + 1;
                    groupCounts.set(group, count); remainingRows[index] = count;
                }
                tableRows.forEach((row, rowIndex) => {
                    const values = rows[rowIndex] ||= [];
                    const reserved = occupied[rowIndex] ||= new Set();
                    let column = 0;
                    for (const cell of row.children) {
                        if (!/^(TD|TH)$/.test(cell.tagName)) continue;
                        while (reserved.has(column)) column++;
                        const width = cell.colSpan;
                        const remaining = remainingRows[rowIndex];
                        const height = cell.rowSpan === 0 ? remaining : Math.min(remaining, cell.rowSpan);
                        values[column] = cellText(cell);
                        for (let down = 0; down < height; down++) {
                            const slots = occupied[rowIndex + down] ||= new Set();
                            const target = rows[rowIndex + down] ||= [];
                            for (let across = 0; across < width; across++) {
                                slots.add(column + across);
                                if (down || across) target[column + across] = '';
                            }
                        }
                        column += width;
                    }
                });
                if (rows.length) return { rows: rows.map(row => Array.from(row, value => value ?? '')), tabular: true };
            }
        }
        const rows = parseText(String(text ?? ''));
        const quotedCell = rows.length === 1 && rows[0].length === 1 && String(text).startsWith('"')
            && String(text).endsWith('"') && /[\t\r\n]|""/.test(String(text));
        return { rows, tabular: quotedCell || rows.length > 1 || rows.some(row => row.length > 1) };
    }

    function assign(slots, rows) {
        const changes = [];
        for (let index = 0; index < Math.min(slots.length, rows.length); index++) {
            const unitId = slots[index], value = rows[index]?.[0];
            if (unitId != null && typeof value === 'string' && value.trim() !== '') changes.push({ unitId, value });
        }
        return changes;
    }

    async function write(values) {
        const data = encode(values);
        if (root.navigator?.clipboard?.write && root.ClipboardItem) {
            try {
                await root.navigator.clipboard.write([new root.ClipboardItem({
                    'text/plain': new root.Blob([data.text], { type: 'text/plain' }),
                    'text/html': new root.Blob([data.html], { type: 'text/html' })
                })]);
                return;
            } catch { /* The synchronous user-gesture copy path may still be available. */ }
        }
        const document = root.document;
        if (!document) throw new Error('Clipboard access is unavailable.');
        let copied = false;
        const copy = event => {
            if (!event.clipboardData) return;
            event.clipboardData.setData('text/plain', data.text);
            event.clipboardData.setData('text/html', data.html);
            event.preventDefault(); copied = true;
        };
        document.addEventListener('copy', copy, true);
        try {
            document.execCommand('copy');
            if (!copied) throw new Error('The browser blocked clipboard access. Allow copying and try again.');
        } finally { document.removeEventListener('copy', copy, true); }
    }

    return { encode, decode, assign, write };
});
