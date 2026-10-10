/* ClientText OOXML adapter. Originals stay immutable; exports patch only target cells. */
(function (root, factory) {
    const node = typeof module === 'object' && module.exports;
    const api = factory(root, node ? require('./vendor/fast-xml-parser-5.11.2.min.js').default : root.XMLParser?.default || root.XMLParser,
        node ? require('./clientTextState.js') : root.ClientTextState,
        node ? require('../../SDEditor-API/node_modules/jszip') : root.JSZip);
    if (node) module.exports = api;
    else root.ClientTextCodec = api;
})(typeof globalThis === 'object' ? globalThis : self, function (root, XMLParser, State, JSZip) {
    'use strict';
    const VERSION = 1, RED = 'FA8072', ORANGE = 'FF9966';
    const FILLS = { missing: 'FA8072', outdated: 'FF9966', filled: 'D9D9D9', reviewed: 'C6EFCE', revised: 'D9D2E9' };
    const FORMS = ['MS', 'FS', 'NS', 'MP', 'FP', 'NP'];
    const NOTES = new Set(['Notes', 'Translation Note']);
    const METADATA = new Set(['Tags', 'ModType', 'StatMagnitude1 Stat', 'ModDomain', 'Generation Type', 'Character', 'Character Class']);
    const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
    const array = value => value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
    const error = (message, code = 'CLIENTTEXT_INVALID_WORKBOOK') => Object.assign(new Error(message), { code });
    function local(node, name) {
        if (!node || typeof node !== 'object') return undefined;
        const keys = Object.keys(node).filter(key => key === name || !key.startsWith('@_') && key.split(':').pop() === name);
        if (keys.length > 1) throw error('Ambiguous XML element: ' + name + '.');
        return keys.length ? node[keys[0]] : undefined;
    }
    function attr(node, name) {
        if (!node || typeof node !== 'object') return undefined;
        if (own(node, '@_' + name)) return node['@_' + name];
        const keys = Object.keys(node).filter(key => key.startsWith('@_') && key.slice(2).split(':').pop() === name);
        if (keys.length > 1) throw error('Ambiguous XML attribute: ' + name + '.');
        return keys.length ? node[keys[0]] : undefined;
    }
    function xml(text, part) {
        if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw error('XML entities or document types are unsupported: ' + part + '.');
        try { return new XMLParser({ ignoreAttributes: false, parseTagValue: false, parseAttributeValue: false,
            trimValues: false, processEntities: true, htmlEntities: true, alwaysCreateTextNode: true }).parse(text, true); }
        catch (cause) { throw error('Cannot parse workbook XML in ' + part + ': ' + cause.message); }
    }
    const scalar = value => typeof value === 'string' || typeof value === 'number' ? String(value) : String(value?.['#text'] ?? '');
    function textRuns(node) {
        if (node === undefined || node === null) return '';
        const direct = local(node, 't');
        if (direct !== undefined) return scalar(direct);
        return array(local(node, 'r')).map(run => scalar(local(run, 't'))).join('');
    }
    function decodeExcel(value) { return String(value).replace(/_x([0-9a-f]{4})_/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))); }
    function encodeText(value) {
        return String(value).replace(/_x[0-9a-f]{4}_/gi, token => '_x005F_' + token.slice(1))
            .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, ch => '_x' + ch.charCodeAt(0).toString(16).padStart(4, '0').toUpperCase() + '_')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#13;');
    }
    function column(address) {
        const match = /^([A-Z]+)([1-9]\d*)$/.exec(address || '');
        if (!match) throw error('Invalid worksheet cell coordinate: ' + address + '.');
        let result = 0;
        for (const ch of match[1]) result = result * 26 + ch.charCodeAt(0) - 64;
        if (result > 16384 || Number(match[2]) > 1048576) throw error('Worksheet cell is outside Excel limits: ' + address + '.');
        return result;
    }
    function letters(value) {
        let result = '';
        for (let number = value; number > 0; number = Math.floor((number - 1) / 26)) result = String.fromCharCode(65 + (number - 1) % 26) + result;
        return result;
    }
    function path(value, relative = '') {
        if (typeof value !== 'string' || !value || /[\\\u0000-\u001f]/.test(value)) throw error('Unsafe workbook part path.');
        const parts = (value.startsWith('/') ? value.slice(1) : relative + value).split('/'), output = [];
        for (const item of parts) {
            if (!item || item === '.') continue;
            if (item === '..') { if (!output.length) throw error('Workbook relationship leaves its package.'); output.pop(); }
            else output.push(item);
        }
        return output.join('/');
    }
    async function bytesOf(value) {
        if (value?.arrayBuffer && !(value instanceof Uint8Array)) value = await value.arrayBuffer();
        if (value instanceof Uint8Array) return value;
        if (value instanceof ArrayBuffer) return new Uint8Array(value);
        if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        throw new TypeError('ClientText requires workbook bytes.');
    }
    async function rawHash(bytes) {
        if (root.crypto?.subtle) return Array.from(new Uint8Array(await root.crypto.subtle.digest('SHA-256', bytes)), x => x.toString(16).padStart(2, '0')).join('');
        return State.sha256(bytes);
    }
    async function open(bytes) {
        if (!JSZip || typeof XMLParser !== 'function') throw error('ClientText workbook dependencies are unavailable.');
        let zip;
        // Inspect declared expanded sizes before asking JSZip to inflate/check every package part.
        try { zip = await JSZip.loadAsync(bytes); }
        catch (cause) { throw error('Cannot open workbook ZIP: ' + cause.message); }
        let expanded = 0;
        for (const entry of Object.values(zip.files)) {
            if (entry.dir) continue;
            if (path(entry.name) !== entry.name || entry.unsafeOriginalName && entry.unsafeOriginalName !== entry.name) throw error('The workbook contains an unsafe ZIP path.');
            const size = entry._data?.uncompressedSize || 0;
            expanded += size;
            if (size > 128 * 1024 * 1024 || expanded > 768 * 1024 * 1024) throw error('The workbook exceeds the supported expanded size.');
        }
        try { return await JSZip.loadAsync(bytes, { checkCRC32: true }); }
        catch (cause) { throw error('The workbook ZIP failed its integrity check: ' + cause.message); }
    }
    async function part(zip, name, optional = false) {
        const entry = zip.file(name);
        if (!entry) { if (optional) return null; throw error('Missing workbook part: ' + name + '.'); }
        return entry.async('string');
    }
    function styleData(document) {
        const sheet = local(document, 'styleSheet') || {}, fills = array(local(local(sheet, 'fills'), 'fill')),
            styles = array(local(local(sheet, 'cellXfs'), 'xf'));
        return { styles, fills, color(styleId) {
            const style = styles[Number(styleId || 0)], fill = fills[Number(attr(style, 'fillId') || 0)];
            const pattern = local(fill, 'patternFill');
            if (attr(pattern, 'patternType') !== 'solid') return null;
            const rgb = attr(local(pattern, 'fgColor'), 'rgb');
            return typeof rgb === 'string' && /^(?:[a-f0-9]{8}|[a-f0-9]{6})$/i.test(rgb) ? rgb.slice(-6).toUpperCase() : null;
        } };
    }
    function cellValue(cell, shared, location, forbidFormula = false) {
        if (!cell) return '';
        if (forbidFormula && local(cell, 'f') !== undefined) throw error('Formula in an editable or identifying cell: ' + location + '.', 'CLIENTTEXT_EDITABLE_FORMULA');
        const type = attr(cell, 't'), raw = scalar(local(cell, 'v'));
        if (type === 's') {
            if (!/^\d+$/.test(raw) || Number(raw) >= shared.length) throw error('Invalid shared-string reference: ' + location + '.');
            return shared[Number(raw)];
        }
        if (type === 'inlineStr') return decodeExcel(textRuns(local(cell, 'is')));
        if (type === 'e' && forbidFormula) throw error('Excel error in an editable or identifying cell: ' + location + '.');
        if (type && !['n', 'str', 'b', 'e', 'd'].includes(type)) throw error('Unsupported worksheet cell type: ' + location + '.');
        return decodeExcel(raw);
    }
    function layout(headers, sheet, warnings) {
        const id = headers.filter(item => item.name === 'ID');
        if (id.length !== 1) throw error('Sheet ' + sheet + ' must contain exactly one ID column.');
        const used = new Set([id[0].column]), definitions = [], fieldIds = new Set(), gender = headers.filter(item => item.name === 'Gender');
        if (gender.length > 1) throw error('Duplicate Gender columns in sheet ' + sheet + '.');
        const at = new Map(headers.map(item => [item.column, item.name]));
        function add(sourceColumn, targetColumn, kind, form = null) {
            const heading = kind === 'gender' ? 'Gender' : at.get(sourceColumn);
            if (!heading || heading === 'ID' || heading === 'Translation' || heading === 'Gender' || FORMS.includes(heading) || NOTES.has(heading) || METADATA.has(heading)) {
                throw error('Cannot identify the English source for ' + sheet + '!' + letters(targetColumn) + '1.');
            }
            const fieldId = JSON.stringify([heading, form]);
            if (fieldIds.has(fieldId)) throw error('Duplicate source field ' + heading + ' in sheet ' + sheet + '.');
            fieldIds.add(fieldId); used.add(sourceColumn); used.add(targetColumn);
            definitions.push({ id: fieldId, name: heading, kind, sourceColumn, targetColumn, ...(form ? { form, group: heading } : {}) });
        }
        for (let index = 0; index < headers.length; index++) {
            const header = headers[index];
            if (header.name === 'Translation') add(header.column - 1, header.column, 'text');
            else if (FORMS.includes(header.name) && !used.has(header.column)) {
                const cluster = [];
                for (let offset = 0; FORMS.includes(at.get(header.column + offset)); offset++) cluster.push(at.get(header.column + offset));
                if (JSON.stringify(cluster) !== JSON.stringify(FORMS) && JSON.stringify(cluster) !== JSON.stringify(['MS', 'FS'])) {
                    throw error('Unsupported gender-form columns in sheet ' + sheet + ': ' + cluster.join(', ') + '. Expected MS/FS or MS/FS/NS/MP/FP/NP.', 'CLIENTTEXT_LAYOUT_CHANGED');
                }
                for (let offset = 0; offset < cluster.length; offset++) add(header.column - 1, header.column + offset, 'form', cluster[offset]);
            }
        }
        if (!definitions.length) throw error('Sheet ' + sheet + ' has no recognized translation fields.', 'CLIENTTEXT_LAYOUT_CHANGED');
        if (gender.length) {
            definitions.push({ id: JSON.stringify(['Gender', null]), name: 'Gender', kind: 'gender', sourceColumn: 0, targetColumn: gender[0].column });
            used.add(gender[0].column);
        }
        const metadata = headers.filter(item => !used.has(item.column));
        if (new Set(metadata.map(item => item.name)).size !== metadata.length) throw error('Duplicate metadata column headings in sheet ' + sheet + '.', 'CLIENTTEXT_LAYOUT_CHANGED');
        for (const item of metadata) if (!NOTES.has(item.name) && !METADATA.has(item.name)) warnings.push({ code: 'CLIENTTEXT_METADATA_COLUMN', sheet, cell: letters(item.column) + '1', message: 'Unrecognized metadata column retained: ' + item.name + '.' });
        return { idColumn: id[0].column, definitions, metadata };
    }
    async function parseWorkbook(input, options = {}) {
        const bytes = await bytesOf(input), filename = String(options.filename || 'ClientText.xlsx'), role = options.role || (/gender/i.test(filename) ? 'gender' : 'normal'), language = String(options.language || '');
        if (!/\.(xlsx|xlsm)$/i.test(filename) || !['normal', 'gender'].includes(role)) throw error('ClientText requires an .xlsx/.xlsm filename and normal/gender role.');
        const progress = options.onProgress || (() => {}), warnings = [], sheets = [], units = [];
        progress({ phase: 'opening', processed: 0, total: 1, percent: 0, sheet: '' });
        const zip = await open(bytes);
        const types = xml(await part(zip, '[Content_Types].xml'), '[Content_Types].xml');
        const overrides = array(local(local(types, 'Types'), 'Override'));
        const workbookType = overrides.find(item => attr(item, 'PartName') === '/xl/workbook.xml');
        const macroEnabled = /macroEnabled/.test(attr(workbookType, 'ContentType') || '');
        if (!!/\.xlsm$/i.test(filename) !== macroEnabled) throw error('The workbook filename does not match its XLSX/XLSM content type.');
        const document = xml(await part(zip, 'xl/workbook.xml'), 'xl/workbook.xml'), relations = xml(await part(zip, 'xl/_rels/workbook.xml.rels'), 'workbook relationships');
        const relationMap = new Map();
        for (const relation of array(local(local(relations, 'Relationships'), 'Relationship'))) {
            const id = attr(relation, 'Id');
            if (relationMap.has(id)) throw error('Duplicate workbook relationship.');
            relationMap.set(id, relation);
        }
        const stringPart = await part(zip, 'xl/sharedStrings.xml', true);
        const shared = stringPart === null ? [] : array(local(local(xml(stringPart, 'shared strings'), 'sst'), 'si')).map(item => decodeExcel(textRuns(item)));
        const stylesPart = await part(zip, 'xl/styles.xml', true), styles = styleData(stylesPart ? xml(stylesPart, 'styles') : {});
        const sheetItems = array(local(local(local(document, 'workbook'), 'sheets'), 'sheet')), names = new Set(), partPaths = new Set();
        if (!sheetItems.length || sheetItems.length > 1024) throw error('The workbook has an unsupported sheet count.');
        for (let index = 0; index < sheetItems.length; index++) {
            const item = sheetItems[index], name = attr(item, 'name'), relation = relationMap.get(attr(item, 'id'));
            if (!name || names.has(name.toLowerCase()) || !relation || attr(relation, 'TargetMode') === 'External' || !/\/worksheet$/.test(attr(relation, 'Type') || '')) throw error('Invalid, duplicated, or unsupported workbook sheet.');
            names.add(name.toLowerCase());
            const sheetPath = path(attr(relation, 'Target'), 'xl/');
            if (partPaths.has(sheetPath)) throw error('Multiple sheets point to the same worksheet.');
            partPaths.add(sheetPath);
            progress({ phase: 'parsing', processed: index, total: sheetItems.length, percent: index / sheetItems.length * 100, sheet: name });
            const sheet = local(xml(await part(zip, sheetPath), sheetPath), 'worksheet');
            if (!sheet) throw error('Missing worksheet root in ' + name + '.');
            const rows = array(local(local(sheet, 'sheetData'), 'row'));
            const rowIds = new Set(), records = new Set(), rowsByNumber = new Map();
            for (const row of rows) {
                const number = Number(attr(row, 'r'));
                if (!Number.isSafeInteger(number) || number < 1 || number > 1048576 || rowIds.has(number)) throw error('Invalid or duplicate row in sheet ' + name + '.');
                rowIds.add(number); rowsByNumber.set(number, row);
            }
            const first = rowsByNumber.get(1);
            if (!first) throw error('Sheet ' + name + ' has no header row.');
            function cellsFor(row) {
                const cells = new Map();
                for (const cell of array(local(row, 'c'))) {
                    const address = attr(cell, 'r'), number = column(address);
                    if (Number(/\d+$/.exec(address)[0]) !== Number(attr(row, 'r')) || cells.has(number)) throw error('Invalid or duplicate cell in sheet ' + name + '.');
                    cells.set(number, cell);
                }
                return cells;
            }
            const headerCells = cellsFor(first), headers = [];
            for (const [number, cell] of headerCells) {
                const value = cellValue(cell, shared, name + '!' + attr(cell, 'r'), true);
                if (value) headers.push({ column: number, name: value });
            }
            headers.sort((a, b) => a.column - b.column);
            const schema = layout(headers, name, warnings), start = units.length;
            if (local(sheet, 'conditionalFormatting') !== undefined) warnings.push({ code: 'CLIENTTEXT_CONDITIONAL_FORMATTING', sheet: name, message: 'Conditional formatting is preserved. Workload status uses direct cell fills; check any conditional Missing or Outdated colors before publishing.' });
            for (const merged of array(local(local(sheet, 'mergeCells'), 'mergeCell'))) {
                const ref = attr(merged, 'ref'), match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(ref || '');
                if (!match) throw error('Unsupported merged cell reference in ' + name + '.');
                const low = column(match[1] + match[2]), high = column(match[3] + match[4]);
                if (schema.definitions.some(field => field.targetColumn >= low && field.targetColumn <= high || field.sourceColumn >= low && field.sourceColumn <= high) || schema.idColumn >= low && schema.idColumn <= high) throw error('Merged editable or identifying cells in ' + name + ': ' + ref + '.');
            }
            for (const row of rows) {
                const number = Number(attr(row, 'r'));
                if (number === 1) continue;
                const cells = cellsFor(row), read = (col, strict = false) => cellValue(cells.get(col), shared, name + '!' + letters(col) + number, strict), recordId = read(schema.idColumn, true);
                if (!recordId.trim()) {
                    if (Array.from(cells.values()).some(cell => cellValue(cell, shared, name + '!' + attr(cell, 'r')).trim())) throw error('Nonempty row has no ID: ' + name + '!' + number + '.');
                    continue;
                }
                if (records.has(recordId)) throw error('Duplicate ID in ' + name + ': ' + recordId + '.', 'CLIENTTEXT_DUPLICATE_ID');
                records.add(recordId);
                const fields = schema.definitions.map(definition => {
                    const targetCell = cells.get(definition.targetColumn), source = definition.sourceColumn ? read(definition.sourceColumn, true) : '', target = read(definition.targetColumn, true), originalStyleId = attr(targetCell, 's') || '0', originalFill = styles.color(originalStyleId);
                    if (styles.styles.length && (!/^\d+$/.test(originalStyleId) || Number(originalStyleId) >= styles.styles.length)) throw error('Invalid cell style in ' + name + '.');
                    const markedMissing = originalFill === RED, sourceActive = !!source.trim() && !State.audioOnly(source);
                    const required = definition.kind === 'text' ? sourceActive : definition.kind === 'form' ? sourceActive && (markedMissing || !!target.trim()) : markedMissing || !!target.trim();
                    const field = { id: definition.id, name: definition.name, kind: definition.kind, source, target, required,
                        originalMissing: required && !target.trim(), outdated: originalFill === ORANGE && !State.audioOnly(source),
                        sourceCell: definition.sourceColumn ? letters(definition.sourceColumn) + number : '', targetCell: letters(definition.targetColumn) + number,
                        originalFill, originalStyleId, ...(definition.form ? { form: definition.form, group: definition.group } : {}) };
                    if (field.kind === 'text' && target.trim() === 'NONEXISTENT') warnings.push({ code: 'CLIENTTEXT_NONEXISTENT_FIELD', sheet: name, cell: field.targetCell, message: 'NONEXISTENT is only supported in a gender-form field.' });
                    return field;
                });
                const metadata = Object.fromEntries(schema.metadata.filter(item => !NOTES.has(item.name)).map(item => [item.name, read(item.column)])), developerNotes = schema.metadata.filter(item => NOTES.has(item.name)).map(item => read(item.column)).filter(Boolean).join('\n');
                units.push({ id: JSON.stringify([role, name, recordId]), role, sheet: name, recordId, fields, developerNotes, metadata });
                if (units.length > 1000000) throw error('ClientText exceeds the supported record count.');
                if (records.size % 1024 === 0) progress({ phase: 'parsing', processed: index, total: sheetItems.length, percent: index / sheetItems.length * 100, sheet: name, rows: records.size });
            }
            sheets.push({ name, path: sheetPath, index, state: attr(item, 'state') || 'visible', headers, unitCount: units.length - start });
        }
        const artifactHash = await rawHash(bytes);
        progress({ phase: 'complete', processed: sheets.length, total: sheets.length, percent: 100, sheet: sheets[sheets.length - 1]?.name || '' });
        return { version: VERSION, filename, role, language, artifactHash, assetHash: artifactHash, format: macroEnabled ? 'xlsm' : 'xlsx', sheets, units, warnings };
    }
    function savedRecords(saved) {
        if (saved instanceof Map) return saved;
        if (Array.isArray(saved)) return new Map(saved.map(value => [value.id || value.unitId, value]));
        return new Map(Object.entries(saved || {}));
    }
    function chosenFill(field, value, saved) {
        const assignedOutdated = (field.outdated || (saved?.outdated || []).includes(field.id)) && !State.audioOnly(field.source);
        const reviewed = saved?.reviewed?.[field.id] === State.sourceHash(field.source);
        if (saved?.saved === false && value === field.target && !assignedOutdated && !reviewed) return null;
        if (field.required && !State.audioOnly(field.source) && !value.trim()) return FILLS.missing;
        if (assignedOutdated && !reviewed) return FILLS.outdated;
        if (field.originalMissing && value.trim()) return FILLS.filled;
        if (assignedOutdated || reviewed && field.originalFill === ORANGE) return FILLS.reviewed;
        if (value !== field.target && !State.audioOnly(field.source)) return FILLS.revised;
        return null;
    }
    function startTagAttrs(tag) {
        const output = {};
        for (const match of tag.matchAll(/\s+([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) output[match[1]] = match[2] ?? match[3];
        return output;
    }
    function setAttr(tag, name, value) {
        const pattern = new RegExp('\\s+' + name + '\\s*=\\s*(?:"[^\"]*"|\'[^\']*\')');
        const updated = tag.replace(pattern, '');
        return value === null ? updated : updated.replace(/\s*\/?\s*>$/, ' ' + name + '="' + value + '"' + (/\/\s*>$/.test(updated) ? '/>' : '>'));
    }
    function stylePatcher(original) {
        if (!original) throw error('Workbook styles are required when exporting status colors.');
        let output = original;
        const cache = new Map();
        function section(name) {
            const pattern = new RegExp('<((?:[\\w.-]+:)?' + name + ')\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>');
            const match = pattern.exec(output);
            if (!match) throw error('Workbook has no editable ' + name + ' style section.');
            return match;
        }
        function append(name, child, childrenPattern) {
            const match = section(name), raw = match[0], opening = /^<[^>]+>/.exec(raw)[0], count = Array.from(raw.matchAll(childrenPattern)).length;
            const updated = setAttr(opening, 'count', count + 1) + raw.slice(opening.length).replace(new RegExp('<\\/' + match[1] + '\\s*>$'), child + '</' + match[1] + '>');
            output = output.slice(0, match.index) + updated + output.slice(match.index + raw.length);
            return count;
        }
        return { get text() { return output; }, clone(styleId, fill) {
            const key = styleId + '/' + fill;
            if (cache.has(key)) return cache.get(key);
            const sectionMatch = section('cellXfs'), xfPattern = /<((?:[\w.-]+:)?xf)\b[^>]*(?:\/>|>[\s\S]*?<\/\1\s*>)/g, entries = Array.from(sectionMatch[0].matchAll(xfPattern));
            const entry = entries[Number(styleId || 0)];
            if (!entry) throw error('Cannot clone the original translation style.');
            const fillsName = section('fills')[1], prefix = fillsName.includes(':') ? fillsName.split(':')[0] + ':' : '';
            const fillId = append('fills', '<' + prefix + 'fill><' + prefix + 'patternFill patternType="solid"><' + prefix + 'fgColor rgb="FF' + fill + '"/><' + prefix + 'bgColor rgb="FF' + fill + '"/></' + prefix + 'patternFill></' + prefix + 'fill>', /<(?:[\w.-]+:)?fill\b/g);
            const old = entry[0], opening = /^<[^>]+>/.exec(old)[0], changed = setAttr(setAttr(opening, 'fillId', fillId), 'applyFill', '1') + old.slice(opening.length);
            const id = append('cellXfs', changed, /<(?:[\w.-]+:)?xf\b/g);
            cache.set(key, String(id)); return String(id);
        } };
    }
    function patchSheet(original, edits) {
        const found = new Set(), rowEdits = new Map();
        for (const [coordinate, edit] of edits) {
            column(coordinate); const number = Number(/\d+$/.exec(coordinate)[0]);
            if (!rowEdits.has(number)) rowEdits.set(number, new Map());
            rowEdits.get(number).set(coordinate, edit);
        }
        const sheetDataPattern = /<((?:[\w.-]+:)?sheetData)\b[^>]*>[\s\S]*?<\/\1\s*>/g;
        const regions = Array.from(original.matchAll(sheetDataPattern));
        if (regions.length !== 1) throw error('Worksheet has no unambiguous sheetData region.');
        const region = regions[0];
        const patched = region[0].replace(/<((?:[\w.-]+:)?row)\b[^>]*(?:\/>|>[\s\S]*?<\/\1\s*>)/g, rowXml => {
            const opening = /^<[^>]+>/.exec(rowXml)[0], rowAttrs = startTagAttrs(opening), editsForRow = rowEdits.get(Number(rowAttrs.r));
            if (!editsForRow) return rowXml;
            const prefix = /^<([\w.-]+:)?row/.exec(opening)[1] || '', replacements = [];
            const cellPattern = /<((?:[\w.-]+:)?c)\b[^>]*(?:\/>|>[\s\S]*?<\/\1\s*>)/g;
            for (const match of rowXml.matchAll(cellPattern)) {
                const raw = match[0], start = /^<[^>]+>/.exec(raw)[0], cellAttrs = startTagAttrs(start), edit = editsForRow.get(cellAttrs.r);
                if (edit) {
                    if (found.has(cellAttrs.r)) throw error('Duplicate XML target coordinate during export.');
                    let changed = setAttr(start, 's', edit.styleId);
                    if (edit.value !== undefined) {
                        changed = setAttr(changed, 't', 'inlineStr').replace(/\/>$/, '>');
                        replacements.push({ at: match.index, size: raw.length, value: changed + '<' + prefix + 'is><' + prefix + 't xml:space="preserve">' + encodeText(edit.value) + '</' + prefix + 't></' + prefix + 'is></' + prefix + 'c>' });
                    } else replacements.push({ at: match.index, size: raw.length, value: changed + raw.slice(start.length) });
                    found.add(cellAttrs.r);
                }
            }
            let changed = rowXml;
            for (const replacement of replacements.reverse()) changed = changed.slice(0, replacement.at) + replacement.value + changed.slice(replacement.at + replacement.size);
            for (const [coordinate, edit] of editsForRow) if (!found.has(coordinate)) {
                const value = '<' + prefix + 'c r="' + coordinate + '" s="' + edit.styleId + '" t="inlineStr"><' + prefix + 'is><' + prefix + 't xml:space="preserve">' + encodeText(edit.value ?? '') + '</' + prefix + 't></' + prefix + 'is></' + prefix + 'c>';
                const next = Array.from(changed.matchAll(cellPattern)).find(match => column(startTagAttrs(/^<[^>]+>/.exec(match[0])[0]).r) > column(coordinate));
                if (next) changed = changed.slice(0, next.index) + value + changed.slice(next.index);
                else if (/\/>$/.test(changed)) changed = changed.replace(/\/>$/, '>') + value + '</' + prefix + 'row>';
                else {
                    const extension = new RegExp('<' + prefix + 'extLst\\b').exec(changed);
                    if (extension) changed = changed.slice(0, extension.index) + value + changed.slice(extension.index);
                    else changed = changed.replace(new RegExp('<\\/' + prefix + 'row\\s*>$'), value + '</' + prefix + 'row>');
                }
                found.add(coordinate);
            }
            return changed;
        });
        if (found.size !== edits.size) throw error('A saved translation points to a missing workbook row.');
        return original.slice(0, region.index) + patched + original.slice(region.index + region[0].length);
    }
    async function exportWorkbook(input, parsed, savedInput, options = {}) {
        const bytes = await bytesOf(input);
        const progress = options.onProgress || (() => {});
        progress({ phase: 'verifying original', processed: 0, total: 1, percent: 0, sheet: '' });
        if (parsed?.version !== VERSION || await rawHash(bytes) !== parsed.artifactHash) throw error('The workbook original does not match its parsed baseline.');
        const zip = await open(bytes), saved = savedRecords(savedInput), units = new Map(parsed.units.map(unit => [unit.id, unit])), editsBySheet = new Map();
        let styles = null;
        for (const [unitId, record] of saved) {
            const unit = units.get(unitId);
            if (!unit || !record?.values || typeof record.values !== 'object') throw error('Saved ClientText unit is absent from its original: ' + unitId + '.');
            const valid = new Set(unit.fields.map(field => field.id));
            if (Object.keys(record.values).some(id => !valid.has(id)) || Object.keys(record.reviewed || {}).some(id => !valid.has(id))) throw error('Saved ClientText contains an unknown field.');
            if (record.outdated !== undefined && (!Array.isArray(record.outdated) || record.outdated.some(id => !valid.has(id)))) throw error('Saved ClientText contains an unknown outdated field.');
            try { State.normalizeReviewed(unit, record.reviewed || {}); } catch (cause) { throw error(cause.message); }
            for (const field of unit.fields) {
                if (!own(record.values, field.id) && !own(record.reviewed, field.id) && !(record.outdated || []).includes(field.id)) continue;
                const value = own(record.values, field.id) ? record.values[field.id] : field.target;
                if (typeof value !== 'string') throw error('Saved ClientText field is not text.');
                if (field.kind === 'text' && value.trim() === 'NONEXISTENT') throw error('NONEXISTENT is only valid in a gender-form field.');
                const chosen = chosenFill(field, value, record), fill = chosen === field.originalFill ? null : chosen;
                if (value === field.target && !fill) continue;
                if (fill && !styles) styles = stylePatcher(await part(zip, 'xl/styles.xml', true));
                const styleId = fill ? styles.clone(field.originalStyleId, fill) : String(field.originalStyleId || '0');
                if (!editsBySheet.has(unit.sheet)) editsBySheet.set(unit.sheet, new Map());
                const edits = editsBySheet.get(unit.sheet);
                if (edits.has(field.targetCell)) throw error('Multiple saved fields point to one target cell.');
                edits.set(field.targetCell, { styleId, ...(value !== field.target ? { value } : {}) });
            }
        }
        if (editsBySheet.size && Object.keys(zip.files).some(name => name.startsWith('_xmlsignatures/'))) throw error('A signed workbook cannot be edited without invalidating its document signature.');
        for (let index = 0; index < parsed.sheets.length; index++) {
            const sheet = parsed.sheets[index];
            progress({ phase: 'exporting', processed: index, total: parsed.sheets.length, percent: index / parsed.sheets.length * 80, sheet: sheet.name });
            const edits = editsBySheet.get(sheet.name);
            if (edits?.size) zip.file(sheet.path, patchSheet(await part(zip, sheet.path), edits), { date: zip.file(sheet.path).date, createFolders: false });
        }
        if (styles) zip.file('xl/styles.xml', styles.text, { date: zip.file('xl/styles.xml').date, createFolders: false });
        if (!editsBySheet.size) { progress({ phase: 'complete', processed: parsed.sheets.length, total: parsed.sheets.length, percent: 100, sheet: '' }); return bytes.slice(); }
        const result = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 5 } }, value => progress({ phase: 'packing', processed: parsed.sheets.length, total: parsed.sheets.length, percent: 80 + value.percent * 0.2, sheet: value.currentFile || '' }));
        progress({ phase: 'complete', processed: parsed.sheets.length, total: parsed.sheets.length, percent: 100, sheet: '' });
        return result;
    }
    return { VERSION, FORMS, FILLS, parseWorkbook, exportWorkbook };
});
