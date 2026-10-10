'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const JSZip = require('../../SDEditor-API/node_modules/jszip');
const Codec = require('../public/clientTextCodec.js');
const State = require('../public/clientTextState.js');
const WorkerClient = require('../public/clientTextWorkerClient.js');
const Transport = require('../public/clientTextTransport.js');
const { readFileSync } = require('node:fs');
const { runInNewContext, createContext, runInContext } = require('node:vm');
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#13;');
const cell = (r, value, style = 0, extra = '') => `<c r="${r}" s="${style}" t="inlineStr" ${extra}><is><t xml:space="preserve">${escape(value)}</t></is></c>`;
const empty = (r, style) => `<c r="${r}" s="${style}"/>`;
const row = (r, cells) => `<row r="${r}">${cells.join('')}</row>`;
const sheet = rows => `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${NS}"><sheetData>${rows.join('')}</sheetData><extLst><ext uri="native"><keep xmlns="urn:native">preserve</keep></ext></extLst></worksheet>`;
const styles = `<?xml version="1.0"?><styleSheet xmlns="${NS}"><fonts count="1"><font><name val="Calibri"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFA8072"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFF9966"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4">${[0, 1, 2, 3].map(fill => `<xf numFmtId="0" fontId="0" fillId="${fill}" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1"/></xf>`).join('')}</cellXfs></styleSheet>`;
async function workbook({ replace = {}, macro = false, normal } = {}) {
    const zip = new JSZip();
    const normalXml = normal || sheet([
        row(1, [cell('A1', 'ID'), cell('B1', 'Notes'), cell('C1', 'Name'), cell('D1', 'Translation'), cell('E1', 'Gender'), cell('G1', 'Description'), cell('H1', 'Translation')]),
        row(2, [cell('A2', 'record'), cell('B2', 'Developer instruction'), cell('C2', 'Sword'), empty('D2', 2), cell('E2', 'M', 1), cell('G2', '[NOAUDIO] New description'), cell('H2', 'Old description', 3)]),
        row(3, [cell('A3', 'complete'), cell('C3', 'Shield'), cell('D3', 'Original', 1), cell('E3', 'F', 1), cell('G3', '{0:+d} <size:3>{Text} <<keybind:open_panel>>'), cell('H3', 'Formatting', 1)]),
        row(4, [cell('A4', 'noaudio'), cell('C4', '[NOAUDIO] '), empty('D4', 2), empty('E4', 0)]),
    ]);
    const genderXml = sheet([
        row(1, [cell('A1', 'ID'), cell('B1', 'Tags'), cell('C1', 'Text'), ...['MS', 'FS', 'NS', 'MP', 'FP', 'NP'].map((label, i) => cell(String.fromCharCode(68 + i) + '1', label))]),
        row(2, [cell('A2', 'record'), cell('B2', 'weapon'), cell('C2', 'Strong'), cell('D2', 'Fort', 1), cell('F2', ' NONEXISTENT', 1), cell('I2', 'NONEXISTENT', 1)]),
        row(3, [cell('A3', 'new'), cell('C3', 'New'), empty('D3', 2), empty('E3', 2), empty('F3', 1), empty('G3', 1), empty('H3', 1), empty('I3', 1)]),
    ]);
    zip.file('[Content_Types].xml', `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="${macro ? 'application/vnd.ms-excel.sheet.macroEnabled.main+xml' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'}"/></Types>`);
    zip.file('xl/workbook.xml', `<workbook xmlns="${NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Normal" sheetId="1" r:id="rId1"/><sheet name="Words_Gender" sheetId="2" r:id="rId2"/></sheets></workbook>`);
    zip.file('xl/_rels/workbook.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>');
    zip.file('xl/worksheets/sheet1.xml', normalXml); zip.file('xl/worksheets/sheet2.xml', genderXml); zip.file('xl/styles.xml', styles);
    zip.file('xl/metadata', new Uint8Array([0, 255, 8, 99]));
    zip.file('xl/native.bin', new Uint8Array([7, 8, 9]));
    if (macro) zip.file('xl/vbaProject.bin', new Uint8Array([1, 9, 255]));
    for (const [name, value] of Object.entries(replace)) zip.file(name, value);
    return zip.generateAsync({ type: 'uint8array' });
}
const get = (parsed, record, sheetName = 'Normal') => parsed.units.find(unit => unit.recordId === record && unit.sheet === sheetName);
const field = (unit, name, form = null) => unit.fields.find(item => item.id === JSON.stringify([name, form]));
test('headers map notes, optional Gender and sparse forms without changing raw text', async () => {
    const bytes = await workbook(), progress = [];
    const parsed = await Codec.parseWorkbook(bytes, { filename: 'French.xlsx', role: 'gender', language: 'French', onProgress: value => progress.push(value) });
    assert.equal(parsed.units.length, 5); assert.equal(parsed.sheets.length, 2);
    assert.match(parsed.artifactHash, /^[a-f0-9]{64}$/); assert.equal(parsed.assetHash, parsed.artifactHash);
    const record = get(parsed, 'record'); assert.equal(record.developerNotes, 'Developer instruction');
    assert.equal(record.id, JSON.stringify(['gender', 'Normal', 'record']));
    assert.equal(field(record, 'Name').sourceCell, 'C2'); assert.equal(field(record, 'Name').targetCell, 'D2');
    assert.equal(field(record, 'Name').originalMissing, true); assert.equal(field(record, 'Description').outdated, true);
    assert.equal(field(record, 'Gender').kind, 'gender'); assert.equal(field(record, 'Gender').source, '');
    const forms = get(parsed, 'record', 'Words_Gender'); assert.equal(field(forms, 'Text', 'NS').target, ' NONEXISTENT');
    assert.equal(field(forms, 'Text', 'FS').required, false);
    assert.equal(field(get(parsed, 'new', 'Words_Gender'), 'Text', 'FS').originalMissing, true);
    assert.equal(field(get(parsed, 'noaudio'), 'Name').required, false); assert.equal(field(get(parsed, 'noaudio'), 'Name').originalMissing, false);
    assert.ok(progress.some(value => value.sheet === 'Words_Gender')); assert.equal(progress.at(-1).percent, 100);
    assert.doesNotThrow(() => parsed.units.forEach(State.normalizeUnit));
});
test('the vendored browser UMD dependency loads through its default export', async () => {
    const context = { JSZip, ClientTextState: State, Uint8Array, ArrayBuffer, TextDecoder, crypto: globalThis.crypto };
    runInNewContext(readFileSync(require.resolve('../public/vendor/fast-xml-parser-5.11.2.min.js'), 'utf8'), context);
    runInNewContext(readFileSync(require.resolve('../public/clientTextCodec.js'), 'utf8'), context);
    const parsed = await context.ClientTextCodec.parseWorkbook(await workbook(), { filename: 'French.xlsx' });
    assert.equal(parsed.units.length, 5);
});
test('complete XLSM exports patch only targets and cloned status styles', async () => {
    const bytes = await workbook({ macro: true }), parsed = await Codec.parseWorkbook(bytes, { filename: 'French.xlsm', role: 'normal' });
    const record = get(parsed, 'record'), complete = get(parsed, 'complete'), forms = get(parsed, 'record', 'Words_Gender');
    const saved = {
        [record.id]: { values: { [field(record, 'Name').id]: 'Filled', [field(record, 'Description').id]: 'Old description' }, reviewed: { [field(record, 'Description').id]: State.sourceHash(field(record, 'Description').source) } },
        [complete.id]: { values: { [field(complete, 'Name').id]: '=Literal _x0020_ & <angle>\r\nnext' } },
        [forms.id]: { values: { [field(forms, 'Text', 'FS').id]: 'Forte' } },
    };
    const progress = [], output = await Codec.exportWorkbook(bytes, parsed, saved, { onProgress: value => progress.push(value) });
    const result = await Codec.parseWorkbook(output, { filename: 'French.xlsm', role: 'normal' });
    assert.equal(field(get(result, 'record'), 'Name').originalFill, 'D9D9D9');
    assert.equal(field(get(result, 'record'), 'Description').originalFill, 'C6EFCE');
    assert.equal(field(get(result, 'complete'), 'Name').originalFill, 'D9D2E9');
    assert.equal(field(get(result, 'complete'), 'Name').target, '=Literal _x0020_ & <angle>\r\nnext');
    assert.equal(field(get(result, 'record', 'Words_Gender'), 'Text', 'FS').target, 'Forte');
    assert.equal(field(get(result, 'record'), 'Name').source, 'Sword');
    const before = await JSZip.loadAsync(bytes), after = await JSZip.loadAsync(output);
    for (const name of ['xl/vbaProject.bin', 'xl/native.bin', 'xl/metadata', 'xl/workbook.xml', '[Content_Types].xml', 'xl/_rels/workbook.xml.rels']) assert.deepEqual(await after.file(name).async('uint8array'), await before.file(name).async('uint8array'), name);
    assert.ok((await after.file('xl/styles.xml').async('string')).includes('<alignment wrapText="1"/>'));
    assert.ok((await after.file('xl/worksheets/sheet1.xml').async('string')).includes('<keep xmlns="urn:native">preserve</keep>'));
    assert.equal(progress.at(-1).percent, 100);
});
test('unreviewed outdated fields keep orange and stale review hashes are rejected', async () => {
    const bytes = await workbook(), parsed = await Codec.parseWorkbook(bytes, { filename: 'French.xlsx' }), unit = get(parsed, 'record'), f = field(unit, 'Description');
    await assert.rejects(Codec.exportWorkbook(bytes, parsed, { [unit.id]: { values: { [f.id]: 'Changed but unreviewed' }, reviewed: { [f.id]: State.sourceHash('Another source') } } }), /review does not match/);
    const output = await Codec.exportWorkbook(bytes, parsed, { [unit.id]: { values: { [f.id]: 'Changed but unreviewed' } } });
    const result = await Codec.parseWorkbook(output, { filename: 'French.xlsx' });
    assert.equal(field(get(result, 'record'), 'Description').originalFill, 'FF9966');
});
test('source advancement paints unresolved review orange, then green, without Revised', async () => {
    const bytes = await workbook(), parsed = await Codec.parseWorkbook(bytes, { filename: 'French.xlsx' }), unit = get(parsed, 'complete'), f = field(unit, 'Name');
    const saved = { values: { [f.id]: f.target }, outdated: [f.id], saved: false };
    const unresolved = await Codec.parseWorkbook(await Codec.exportWorkbook(bytes, parsed, { [unit.id]: saved }), { filename: 'French.xlsx' });
    assert.equal(field(get(unresolved, 'complete'), 'Name').originalFill, 'FF9966');
    const reviewed = { ...saved, reviewed: { [f.id]: State.sourceHash(f.source) } };
    const resolved = await Codec.parseWorkbook(await Codec.exportWorkbook(bytes, parsed, { [unit.id]: reviewed }), { filename: 'French.xlsx' });
    assert.equal(field(get(resolved, 'complete'), 'Name').originalFill, 'C6EFCE');
    assert.deepEqual(await Codec.exportWorkbook(bytes, parsed, { [unit.id]: { values: { [f.id]: f.target }, saved: false } }), bytes);
    const missing = get(parsed, 'record'), required = field(missing, 'Name');
    const stillMissing = await Codec.parseWorkbook(await Codec.exportWorkbook(bytes, parsed, { [missing.id]: { values: { [required.id]: '' }, outdated: [required.id], reviewed: { [required.id]: State.sourceHash(required.source) } } }), { filename: 'French.xlsx' });
    assert.equal(field(get(stillMissing, 'record'), 'Name').originalFill, 'FA8072');
    const filled = await Codec.parseWorkbook(await Codec.exportWorkbook(bytes, parsed, { [missing.id]: { values: { [required.id]: 'Filled' }, outdated: [required.id], reviewed: { [required.id]: State.sourceHash(required.source) } } }), { filename: 'French.xlsx' });
    assert.equal(field(get(filled, 'record'), 'Name').originalFill, 'D9D9D9');
});
test('no-change and reverted complete saves preserve the original package exactly', async () => {
    const bytes = await workbook(), parsed = await Codec.parseWorkbook(bytes, { filename: 'French.xlsx' }), unit = get(parsed, 'complete'), f = field(unit, 'Name');
    assert.deepEqual(await Codec.exportWorkbook(bytes, parsed, {}), bytes);
    assert.deepEqual(await Codec.exportWorkbook(bytes, parsed, { [unit.id]: { values: { [f.id]: f.target } } }), bytes);
    await assert.rejects(Codec.exportWorkbook(new Uint8Array([...bytes, 0]), parsed, {}), /does not match/);
});

test('arbitrary original Gender strings survive complete saves, history and edited workbook exports verbatim', async () => {
    const values = ['-', ' ', '  custom\tvalue  ', 'NONEXISTENT', '  first\r\nsecond\nthird  '];
    const normal = sheet([
        row(1, [cell('A1', 'ID'), cell('B1', 'Name'), cell('C1', 'Translation'), cell('D1', 'Gender'), cell('E1', 'Notes'), cell('F1', 'Character')]),
        ...values.map((value, index) => row(index + 2, [cell('A' + (index + 2), 'raw-' + index), cell('B' + (index + 2), 'English ' + index),
            cell('C' + (index + 2), 'Original ' + index, 1), cell('D' + (index + 2), value, 1), cell('E' + (index + 2), 'Developer note ' + index), cell('F' + (index + 2), 'Immutable metadata ' + index)])),
    ]);
    const bytes = await workbook({ normal, macro: true }), parsed = await Codec.parseWorkbook(bytes, { filename: 'German.xlsm', language: 'German' });
    assert.equal(parsed.warnings.some(warning => warning.code === 'CLIENTTEXT_GENDER_VALUE' || warning.code === 'CLIENTTEXT_NONEXISTENT_FIELD'), false);
    assert.deepEqual(await Codec.exportWorkbook(bytes, parsed, {}), bytes, 'Arbitrary baseline metadata alone never rewrites an original');
    const { fixture, scope: baseScope } = require('./clienttext-storage-fixture.cjs'), f = fixture(), scope = { ...baseScope, language: 'German' };
    await f.store.import(scope, { units: parsed.units, assets: [{ role: 'normal', name: 'German.xlsm', hash: parsed.artifactHash, blob: new Blob([bytes]) }] });
    const records = {};
    for (let index = 0; index < values.length; index++) {
        const unit = get(parsed, 'raw-' + index), gender = field(unit, 'Gender'), name = field(unit, 'Name'), savedValues = State.valuesFor(unit);
        assert.equal(gender.target, values[index]); savedValues[name.id] += ' [authored]';
        records[unit.id] = (await f.store.save(scope, unit.id, { jobId: 'raw-gender-' + index, values: savedValues, reviewed: {} })).saved;
        assert.equal(records[unit.id].values[gender.id], values[index]);
        assert.equal((await f.store.listHistory(scope, unit.id)).at(-1).after.values[gender.id], values[index]);
        assert.equal(field(await f.store.getUnit(scope, unit.id), 'Gender').target, values[index], 'Immutable originals retain the exact metadata');
    }
    const exported = await Codec.exportWorkbook(bytes, parsed, records), reopened = await Codec.parseWorkbook(exported, { filename: 'German.xlsm' });
    const before = await JSZip.loadAsync(bytes), after = await JSZip.loadAsync(exported), exportedSheet = await after.file('xl/worksheets/sheet1.xml').async('string');
    for (let index = 0; index < values.length; index++) {
        const original = get(parsed, 'raw-' + index), current = get(reopened, 'raw-' + index);
        assert.equal(field(current, 'Gender').target, values[index]);
        assert.equal(field(current, 'Name').target, field(original, 'Name').target + ' [authored]');
        assert.equal(field(current, 'Name').source, field(original, 'Name').source);
        assert.equal(current.developerNotes, original.developerNotes); assert.deepEqual(current.metadata, original.metadata);
        assert.ok(exportedSheet.includes(cell('D' + (index + 2), values[index], 1)), 'Unedited raw Gender cell XML remains unchanged');
    }
    for (const name of ['xl/vbaProject.bin', 'xl/native.bin', 'xl/metadata', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/worksheets/sheet2.xml'])
        assert.deepEqual(await after.file(name).async('uint8array'), await before.file(name).async('uint8array'), name);
});

test('authored Gender metadata accepts arbitrary strings while non-text saves and exports remain rejected', async () => {
    const bytes = await workbook(), parsed = await Codec.parseWorkbook(bytes, { filename: 'German.xlsx' }), unit = get(parsed, 'complete'), gender = field(unit, 'Gender');
    for (const value of ['-', ' ', ' custom\t@literal\\n ', 'NONEXISTENT', ' first\r\nsecond\n ']) {
        const values = State.valuesFor(unit); values[gender.id] = value;
        assert.equal(State.normalizeValues(unit, values)[gender.id], value);
        const result = await Codec.parseWorkbook(await Codec.exportWorkbook(bytes, parsed, { [unit.id]: { values } }), { filename: 'German.xlsx' });
        assert.equal(field(get(result, 'complete'), 'Gender').target, value);
        assert.equal(result.warnings.some(warning => warning.code === 'CLIENTTEXT_GENDER_VALUE' || warning.code === 'CLIENTTEXT_NONEXISTENT_FIELD'), false);
    }
    const { fixture, scope, asset } = require('./clienttext-storage-fixture.cjs'), f = fixture();
    await f.store.import(scope, { units: [unit], assets: [asset] });
    for (const value of [null, 0, false, [], {}]) {
        const values = State.valuesFor(unit); values[gender.id] = value;
        assert.throws(() => State.normalizeValues(unit, values), /non-text/);
        await assert.rejects(f.store.save(scope, unit.id, { jobId: 'invalid-gender-' + JSON.stringify(value), values, reviewed: {} }), /non-text/);
        await assert.rejects(Codec.exportWorkbook(bytes, parsed, { [unit.id]: { values } }), /field is not text/);
    }
    assert.deepEqual(await f.store.getSaved(scope), {}); assert.deepEqual(await f.store.listHistory(scope, unit.id), []);
});
test('unsafe layouts, duplicate IDs, editable formulas and XML entities are blocked', async () => {
    const bytes = await workbook(), z = await JSZip.loadAsync(bytes), original = await z.file('xl/worksheets/sheet1.xml').async('string');
    const cases = [
        [original.replace('complete', 'record'), /Duplicate ID/],
        [original.replace('<is><t xml:space="preserve">Sword</t></is>', '<f>SUM(1,2)</f><v>3</v>'), /Formula/],
        [original.replace('Name</t>', 'ID</t>'), /exactly one ID/],
        [original.replace('</row>', cell('I1', 'Tags') + cell('J1', 'Tags') + '</row>'), /Duplicate metadata/],
        [original.replace('<?xml version="1.0" encoding="UTF-8"?>', '<!DOCTYPE worksheet [<!ENTITY x "unsafe">]>'), /entities/],
    ];
    for (const [normal, pattern] of cases) await assert.rejects(Codec.parseWorkbook(await workbook({ normal }), { filename: 'French.xlsx' }), pattern);
    const malformed = sheet([row(1, [cell('A1', 'ID'), cell('C1', 'Text'), cell('D1', 'MS'), cell('E1', 'NS')]), row(2, [cell('A2', 'a'), cell('C2', 'a')])]);
    await assert.rejects(Codec.parseWorkbook(await workbook({ normal: malformed }), { filename: 'French.xlsx' }), /Unsupported gender-form/);
});
test('regular fields reject NONEXISTENT while forms accept it and blank required saves stay red', async () => {
    const bytes = await workbook(), parsed = await Codec.parseWorkbook(bytes, { filename: 'French.xlsx' }), unit = get(parsed, 'record'), name = field(unit, 'Name');
    await assert.rejects(Codec.exportWorkbook(bytes, parsed, { [unit.id]: { values: { [name.id]: 'NONEXISTENT' } } }), /only valid/);
    const output = await Codec.exportWorkbook(bytes, parsed, { [unit.id]: { values: { [name.id]: '' } } });
    assert.equal(field(get(await Codec.parseWorkbook(output, { filename: 'French.xlsx' }), 'record'), 'Name').originalFill, 'FA8072');
});
test('shared rich strings, namespace prefixes and noneditable formulas survive target patches', async () => {
    const normal = sheet([
        row(1, [cell('A1', 'ID'), cell('B1', 'Name'), cell('C1', 'Translation'), cell('E1', 'Character')]),
        row(2, [cell('A2', 'rich'), '<c r="B2" t="s"><v>0</v></c>', '<c r="C2" s="1" t="s"><v>1</v></c>', '<c r="E2" s="0"><f>1+1</f><v>2</v></c>']),
    ]).replace(/<(\/?)(worksheet|sheetData|row|c|is|t|v|f|extLst|ext)(?=[\s>])/g, '<$1s:$2').replace(`xmlns="${NS}"`, `xmlns:s="${NS}"`);
    const bytes = await workbook({ normal, replace: { 'xl/sharedStrings.xml': `<sst xmlns="${NS}"><si><r><t xml:space="preserve">Rich </t></r><r><rPr><b/></rPr><t>source</t></r></si><si><t xml:space="preserve">Original &#13;&amp;#13;</t></si></sst>` } });
    const parsed = await Codec.parseWorkbook(bytes, { filename: 'French.xlsx' }), unit = get(parsed, 'rich'), f = field(unit, 'Name');
    assert.equal(f.source, 'Rich source'); assert.equal(f.target, 'Original \r&#13;'); assert.equal(unit.metadata.Character, '2');
    const output = await Codec.exportWorkbook(bytes, parsed, { [unit.id]: { values: { [f.id]: 'New' } } });
    const z = await JSZip.loadAsync(output), raw = await z.file('xl/worksheets/sheet1.xml').async('string');
    assert.ok(raw.includes('<s:f>1+1</s:f><s:v>2</s:v>'));
    assert.equal(field(get(await Codec.parseWorkbook(output, { filename: 'French.xlsx' }), 'rich'), 'Name').target, 'New');
    assert.deepEqual(await z.file('xl/sharedStrings.xml').async('uint8array'), await (await JSZip.loadAsync(bytes)).file('xl/sharedStrings.xml').async('uint8array'));
});
test('signed package edits and traversal entries are blocked', async () => {
    const bytes = await workbook({ replace: { '_xmlsignatures/sig1.xml': '<Signature/>' } }), parsed = await Codec.parseWorkbook(bytes, { filename: 'French.xlsx' }), unit = get(parsed, 'complete'), f = field(unit, 'Name');
    await assert.rejects(Codec.exportWorkbook(bytes, parsed, { [unit.id]: { values: { [f.id]: 'Changed' } } }), /signature/);
    await assert.rejects(Codec.parseWorkbook(await workbook({ replace: { '../escape.xml': '<bad/>' } }), { filename: 'French.xlsx' }), /unsafe ZIP path/);
});
test('worker client forwards scoped progress and rejects/ignores cancelled responses', async () => {
    class FakeWorker {
        constructor() { this.messages = []; FakeWorker.instance = this; queueMicrotask(() => this.onmessage({ data: { type: 'ready', version: 1 } })); }
        postMessage(value) { this.messages.push(value); }
        terminate() { this.terminated = true; }
    }
    const client = WorkerClient.create({ Worker: FakeWorker }), progress = [], signal = new AbortController();
    const pending = client.parseWorkbook(new Uint8Array([1]), { filename: 'French.xlsx', signal: signal.signal, onProgress: value => progress.push(value) });
    await new Promise(resolve => setImmediate(resolve)); const worker = FakeWorker.instance, message = worker.messages[0];
    worker.onmessage({ data: { type: 'progress', id: message.id, value: { sheet: 'A' } } }); assert.equal(progress.length, 1);
    signal.abort(); await assert.rejects(pending, { name: 'AbortError' });
    worker.onmessage({ data: { type: 'progress', id: message.id, value: { sheet: 'B' } } }); assert.equal(progress.length, 1);
    worker.onmessage({ data: { type: 'result', id: message.id, result: 'late' } });
    const manifest = client.buildManifest([{ id: 'unit' }], [{ role: 'normal', hash: 'a'.repeat(64), blob: new Uint8Array([1]), parsed: { large: true } }]);
    await new Promise(resolve => setImmediate(resolve)); const request = worker.messages.at(-1);
    assert.equal(request.type, 'buildManifest'); assert.deepEqual(request.assets, [{ role: 'normal', hash: 'a'.repeat(64) }]);
    worker.onmessage({ data: { type: 'result', id: request.id, result: { format: 'clienttext-v1' } } }); assert.deepEqual(await manifest, { format: 'clienttext-v1' });
    client.dispose(); assert.equal(worker.terminated, true);
});
test('manifest worker computes the same proofs and cancels cooperatively', async () => {
    const parsed = await Codec.parseWorkbook(await workbook(), { filename: 'French.xlsx' });
    const messages = [], self = { ClientTextCodec: Codec, ClientTextState: State, ClientTextTransport: Transport, postMessage: value => messages.push(value) };
    const context = createContext({ self, importScripts() {}, Uint8Array, Promise, Set });
    runInContext(readFileSync(require.resolve('../public/clientTextWorker.js'), 'utf8'), context);
    const assets = [{ role: 'normal', hash: parsed.artifactHash }];
    self.onmessage({ data: { type: 'buildManifest', id: 'one', units: parsed.units, assets } }); await runInContext('queue', context);
    assert.deepEqual(messages.find(message => message.id === 'one').result, await State.buildManifest(parsed.units, assets));
    const units = Array.from({ length: 600 }, (_, index) => ({ ...parsed.units[0], id: JSON.stringify(['normal', 'Normal', String(index)]), recordId: String(index) }));
    self.postMessage = value => { messages.push(value); if (value.id === 'cancelled' && value.type === 'progress') self.onmessage({ data: { type: 'cancel', id: 'cancelled' } }); };
    self.onmessage({ data: { type: 'buildManifest', id: 'cancelled', units, assets } }); await runInContext('queue', context);
    assert.ok(messages.some(message => message.id === 'cancelled' && message.type === 'progress'));
    assert.equal(messages.some(message => message.id === 'cancelled' && ['error', 'result'].includes(message.type)), false);
});
test('worker messages unwrap nested reactive containers without copying plain originals', async () => {
    const originals = new WeakMap(), reactive = value => { const proxy = new Proxy(value, {}); originals.set(proxy, value); return proxy; };
    class SnapshotWorker {
        constructor() { SnapshotWorker.instance = this; queueMicrotask(() => this.onmessage({ data: { type: 'ready', version: 1 } })); }
        postMessage(value) {
            const message = structuredClone(value);
            if (message.type === 'request-start') this.collector = Transport.collector(message);
            else if (message.type.startsWith('stream-')) this.collector.apply(message);
            else if (message.type === 'request-end') {
                this.message = this.collector.finish(); this.message.type = this.message.operation;
                if (this.message.savedEntries) this.message.saved = Object.fromEntries(this.message.savedEntries);
                this.onStreamEnd?.();
            } else this.message = message;
        }
        terminate() {}
    }
    const context = { Vue: { toRaw: value => originals.get(value) || value }, Worker: SnapshotWorker, setTimeout, clearTimeout, queueMicrotask };
    runInNewContext(readFileSync(require.resolve('../public/clientTextTransport.js'), 'utf8'), context);
    runInNewContext(readFileSync(require.resolve('../public/clientTextWorkerClient.js'), 'utf8'), context);
    const client = context.ClientTextWorkerClient.create(), rawField = { id: 'Name', source: 'Sword', target: 'Original' }, fields = reactive([reactive(rawField)]);
    const unit = reactive({ id: 'unit', fields, metadata: reactive({ nested: reactive({ value: 'note' }) }) });
    const saved = reactive({ unit: reactive({ values: reactive({ Name: 'Changed' }) }) });
    const pending = client.exportWorkbook(new Uint8Array([1]), { units: [unit] }, saved);
    await new Promise(resolve => setImmediate(resolve)); const worker = SnapshotWorker.instance;
    assert.deepEqual(worker.message.parsed, { units: [{ id: 'unit', fields: [rawField], metadata: { nested: { value: 'note' } } }] });
    assert.deepEqual(worker.message.saved, { unit: { values: { Name: 'Changed' } } });
    assert.equal(unit.fields, fields, 'Original reactive containers remain intact');
    worker.onmessage({ data: { type: 'result', id: worker.message.id, result: new Uint8Array([2]) } }); assert.deepEqual(await pending, new Uint8Array([2]));
    const streamed = client.exportWorkbook(new Uint8Array([1]), { units: reactive(Array.from({ length: 600 }, () => unit)) }, saved);
    await new Promise(resolve => { worker.onStreamEnd = resolve; });
    assert.equal(worker.message.parsed.units.length, 600);
    assert.deepEqual(worker.message.parsed.units[599], { id: 'unit', fields: [rawField], metadata: { nested: { value: 'note' } } });
    assert.deepEqual(worker.message.saved, { unit: { values: { Name: 'Changed' } } });
    worker.onmessage({ data: { type: 'result', id: worker.message.id, result: new Uint8Array([3]) } }); assert.deepEqual(await streamed, new Uint8Array([3])); client.dispose();
});
test('bounded worker collections preserve manifests, trees, parses and export input shapes', async () => {
    const original = await Codec.parseWorkbook(await workbook(), { filename: 'French.xlsx' });
    const units = Array.from({ length: 1100 }, (_, index) => ({ ...original.units[0], recordId: String(index), id: JSON.stringify(['normal', 'Normal', String(index)]) }));
    const parsed = { ...original, units }, assets = [{ role: 'normal', hash: original.artifactHash }], sizes = [], directions = [];
    class LoopbackWorker {
        constructor() {
            LoopbackWorker.instance = this;
            this.self = { ClientTextState: State, ClientTextTransport: Transport,
                ClientTextCodec: { parseWorkbook: async bytes => { assert.deepEqual(bytes, new Uint8Array([1])); return parsed; }, exportWorkbook: async (bytes, supplied, saved) => {
                    assert.deepEqual(bytes, new Uint8Array([1])); assert.deepEqual(supplied, parsed); assert.equal(saved[units[1099].id].values['Name'], 'Raw @ value\\n\nไทย'); return new Uint8Array([8, 9]);
                } }, postMessage: (message, transfer) => this.deliver('output', message, transfer, value => this.onmessage?.({ data: value })) };
            this.context = createContext({ self: this.self, importScripts() {}, Uint8Array, Promise, Set, Map });
            runInContext(readFileSync(require.resolve('../public/clientTextWorker.js'), 'utf8'), this.context);
        }
        deliver(direction, message, transfer, receiver) {
            sizes.push(message.bytes instanceof Uint8Array ? message.bytes.byteLength : Buffer.byteLength(JSON.stringify(message)));
            directions.push([direction, message.type]);
            const cloned = structuredClone(message, { transfer: transfer || [] }); queueMicrotask(() => receiver(cloned));
        }
        postMessage(message, transfer) { this.deliver('input', message, transfer, value => this.self.onmessage({ data: value })); if (message.type === 'stream-chunk') this.abortOnChunk?.(); }
        terminate() {}
    }
    const client = WorkerClient.create({ Worker: LoopbackWorker });
    const originalBytes = new Uint8Array([7, 1, 5]);
    assert.deepEqual(await client.parseWorkbook(originalBytes.subarray(1, 2), { filename: 'French.xlsx' }), parsed);
    assert.deepEqual(originalBytes, new Uint8Array([7, 1, 5]), 'Private transfer copies preserve retained originals and subview boundaries');
    const manifest = await client.buildManifest(units, assets);
    assert.deepEqual(manifest, await State.buildManifest(units, assets));
    assert.equal(State.verifyWitness(units[700], manifest.units[700], State.proofFor(manifest, units[700].id), manifest.descriptors[0]), true);
    assert.deepEqual(await client.exportWorkbook(new Uint8Array([1]), parsed, { [units[1099].id]: { values: { Name: 'Raw @ value\\n\nไทย' } } }), new Uint8Array([8, 9]));
    assert.ok(directions.some(([direction, type]) => direction === 'input' && type === 'request-start'));
    assert.ok(directions.some(([direction, type]) => direction === 'output' && type === 'result-start'));
    assert.ok(Math.max(...sizes) < Transport.MAX_BYTES, 'No full originals/manifest/tree graph crosses the worker boundary');
    const aborted = new AbortController(), worker = LoopbackWorker.instance;
    worker.abortOnChunk = () => aborted.abort();
    await assert.rejects(client.buildManifest(units, assets, { signal: aborted.signal }), { name: 'AbortError' });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(runInContext('incoming.size', worker.context), 0, 'Cancellation releases partial worker input collections');
    assert.equal(runInContext('cancelled.size', worker.context), 0, 'Cancelled stream IDs are cleaned up without retaining tombstones');
    client.dispose();
});
test('oversized individual rows fragment without changing Unicode/raw text or array order', async () => {
    const rows = [{ id: 'first', text: 'ไทย🦁@\\n\n'.repeat(200000) }, { id: 'last', text: '' }], receiver = Transport.collector({ units: [] }), sizes = [];
    await Transport.sendCollection((message, transfer) => {
        sizes.push(message.bytes?.byteLength || Buffer.byteLength(JSON.stringify(message)));
        receiver.apply(structuredClone(message, { transfer: transfer || [] }));
    }, 'one', ['units'], rows, { pause: async () => {} });
    assert.deepEqual(receiver.finish().units, rows); assert.ok(sizes.every(size => size <= Transport.MAX_BYTES));
    assert.throws(() => Transport.collector({ units: [] }).apply({ type: 'stream-chunk', path: ['units'], start: 1, values: [] }), /out of order/);
    assert.throws(() => Transport.collector({ units: [] }).apply({ type: 'stream-chunk', path: ['__proto__'], start: 0, values: [] }), /Invalid/);
    const aborted = new AbortController(), messages = [];
    await assert.rejects(Transport.sendCollection(message => { messages.push(message); aborted.abort(); }, 'one', ['units'], rows,
        { guard: () => !aborted.signal.aborted, pause: async () => {} }), { name: 'AbortError' });
    assert.equal(messages.length, 1, 'Cancellation stops the fragmented row before another large payload is posted');
});
test('one million unit transport remains bounded without an aggregate clone or cardinality limit', async () => {
    const records = function* () { for (let index = 0; index < 1000000; index++) yield { id: String(index) }; };
    let count = 0, chunks = 0;
    await Transport.sendCollection(message => {
        assert.equal(message.type, 'stream-chunk'); assert.equal(message.start, count);
        assert.ok(message.values.length <= Transport.MAX_RECORDS);
        assert.equal(message.values[0].id, String(count)); count += message.values.length;
        assert.equal(message.values.at(-1).id, String(count - 1)); chunks++;
    }, 'million', ['units'], records(), { pause: async () => {} });
    assert.equal(count, 1000000); assert.ok(chunks > 1000);
});
test('SHA scratch and bounded scalar memoization retain canonical hashes across boundary sizes and edits', () => {
    const crypto = require('node:crypto');
    for (const length of [55, 56, 63, 64, 16375, 16376, 16384, 50000, 0, 1]) {
        const text = 'é'.repeat(length);
        assert.equal(State.sha256(new TextEncoder().encode(text)), crypto.createHash('sha256').update(text).digest('hex'));
    }
    for (let index = 0; index < 10000; index++) {
        const text = 'Cached ไทย ' + index;
        assert.equal(State.hash(text), crypto.createHash('sha256').update(State.stableStringify(text)).digest('hex'));
    }
    const mutable = { source: 'Before' }, first = State.hash(mutable); mutable.source = 'After';
    assert.notEqual(State.hash(mutable), first, 'Only immutable string values are memoized');
});
