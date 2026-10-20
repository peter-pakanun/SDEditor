/* Optional read-only export regression against explicitly supplied workbooks.
 * No sample content or generated workbook is written to disk. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const JSZip = require('../../SDEditor-API/node_modules/jszip');
const Parser = require('../public/vendor/fast-xml-parser-5.11.2.min.js').default;
const Codec = require('../public/clientTextCodec.js');
const State = require('../public/clientTextState.js');
const parser = new Parser({ ignoreAttributes: false, parseTagValue: false, trimValues: false, removeNSPrefix: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const array = value => Array.isArray(value) ? value : [value];
const tab = raw => /<(?:[\w.-]+:)?tabColor\b[^>]*\brgb="(?:FF)?([A-F0-9]{6})"/i.exec(raw)?.[1].toUpperCase();
const withoutTab = raw => raw.replace(/<((?:[\w.-]+:)?tabColor)\b[^>]*?(?:\/>|>[\s\S]*?<\/\1\s*>)/, '')
    .replace(/<((?:[\w.-]+:)?sheetPr)([^>]*?)>\s*<\/\1>/, '<$1$2/>').replace(/<(?:[\w.-]+:)?sheetPr\s*\/>/, '');
const withoutFill = xf => Object.fromEntries(Object.entries(xf).filter(([key]) => !['@_fillId', '@_applyFill'].includes(key)));

async function check(filename) {
    const started = performance.now(), bytes = await fs.readFile(filename), originalHash = hash(bytes);
    const parsed = await Codec.parseWorkbook(bytes, { filename: path.basename(filename) }), before = await JSZip.loadAsync(bytes);
    assert.ok(Buffer.from(await Codec.exportWorkbook(bytes, parsed, {})).equals(bytes), 'Unmodified export preserves the exact original package');
    const bySheet = new Map(parsed.sheets.map(sheet => [sheet.name, []]));
    for (const unit of parsed.units) bySheet.get(unit.sheet).push(unit);
    let selected;
    for (const sheet of parsed.sheets.filter(sheet => sheet.originalStatusCounts.missing).sort((a, b) => a.unitCount - b.unitCount)) {
        if (tab(await before.file(sheet.path).async('string')) === Codec.FILLS.missing) { selected = sheet; break; }
    }
    assert.ok(selected, 'Sample supplies a red tab with Missing workload');
    const records = {}, changedFields = [], paths = new Map();
    function recordFor(unit) { return records[unit.id] ||= { values: {}, reviewed: {} }; }
    function choose(unit, field, value) {
        recordFor(unit).values[field.id] = value;
        changedFields.push({ unit, field, value });
    }
    let hasReview = false;
    for (const unit of bySheet.get(selected.name)) {
        const status = State.statusFor(unit);
        for (const field of unit.fields) {
            if (status.fields[field.id].missing) choose(unit, field, 'Export colour regression');
            if (status.fields[field.id].outdated) { recordFor(unit).reviewed[field.id] = State.sourceHash(field.source); hasReview = true; }
        }
    }
    assert.ok(changedFields.length, 'At least one red Missing cell is filled');
    const completionFields = changedFields.slice();
    const revisionUnit = parsed.units.find(unit => unit.sheet !== selected.name && unit.fields.some(field => !field.originalMissing && !field.outdated
        && field.target.trim() && !State.audioOnly(field.source) && field.kind === 'text' && field.target.trim() !== 'NONEXISTENT'));
    assert.ok(revisionUnit, 'Sample supplies a complete field for an eligible correction');
    const revisionField = revisionUnit.fields.find(field => !field.originalMissing && !field.outdated && field.target.trim()
        && !State.audioOnly(field.source) && field.kind === 'text' && field.target.trim() !== 'NONEXISTENT');
    choose(revisionUnit, revisionField, revisionField.target + ' [export colour regression]');
    const affected = { ...parsed, units: parsed.units.filter(unit => records[unit.id]) };
    const output = await Codec.exportWorkbook(bytes, affected, records), after = await JSZip.loadAsync(output);
    const reopened = await Codec.parseWorkbook(output, { filename: parsed.filename, role: parsed.role, parserVersion: parsed.parserVersion });
    const reopenedUnits = new Map(reopened.units.map(unit => [unit.id, unit]));
    for (const { unit, field, value } of changedFields) {
        const current = reopenedUnits.get(unit.id).fields.find(candidate => candidate.id === field.id);
        assert.ok(current.target === value, 'Exact authored target survives round trip');
        assert.equal(current.originalFill, unit.id === revisionUnit.id && field.id === revisionField.id ? Codec.FILLS.revised : Codec.FILLS.filled);
    }
    for (const sheet of parsed.sheets) {
        const edits = bySheet.get(sheet.name).filter(unit => records[unit.id]);
        if (!edits.length) continue;
        const statuses = bySheet.get(sheet.name).map(unit => State.statusFor(unit, records[unit.id]));
        const expected = statuses.some(status => status.missing) ? Codec.TAB_COLORS.missing : statuses.some(status => status.outdated) ? Codec.TAB_COLORS.outdated
            : sheet.name === revisionUnit.sheet ? Codec.TAB_COLORS.revised : hasReview ? Codec.TAB_COLORS.reviewed : Codec.TAB_COLORS.filled;
        assert.equal(tab(await after.file(sheet.path).async('string')), expected, 'Sheet tab reflects its whole current content');
        paths.set(sheet.path, edits);
    }
    assert.equal(tab(await after.file(selected.path).async('string')), hasReview ? Codec.TAB_COLORS.reviewed : Codec.TAB_COLORS.filled, 'Resolving a previously red sheet removes its red tab');
    const oldStyles = parser.parse(await before.file('xl/styles.xml').async('string')).styleSheet;
    const newStyles = parser.parse(await after.file('xl/styles.xml').async('string')).styleSheet;
    const originalXfs = array(oldStyles.cellXfs.xf), exportedXfs = array(newStyles.cellXfs.xf);
    assert.deepEqual(exportedXfs.slice(0, originalXfs.length), originalXfs, 'Original style records remain exact');
    for (const key of Object.keys(oldStyles)) if (!['fills', 'cellXfs'].includes(key)) assert.deepEqual(newStyles[key], oldStyles[key], 'Unrelated style sections remain exact');
    assert.deepEqual(array(newStyles.fills.fill).slice(0, array(oldStyles.fills.fill).length), array(oldStyles.fills.fill), 'Original fills remain exact');
    assert.deepEqual(Object.keys(after.files).sort(), Object.keys(before.files).sort(), 'Workbook package retains every original entry');
    let untouchedParts = 0;
    for (const name of Object.keys(before.files)) {
        if (before.files[name].dir || name === 'xl/styles.xml') continue;
        if (!paths.has(name)) {
            assert.ok(Buffer.from(await after.file(name).async('uint8array')).equals(Buffer.from(await before.file(name).async('uint8array'))), 'Untouched package part remains byte-exact: ' + name);
            untouchedParts++; continue;
        }
        let original = await before.file(name).async('string'), exported = await after.file(name).async('string');
        for (const unit of paths.get(name)) for (const field of unit.fields) {
            if (!(field.id in records[unit.id].values) && !(field.id in records[unit.id].reviewed)) continue;
            const pattern = new RegExp('<((?:[\\w.-]+:)?c)\\b[^>]*?\\br="' + field.targetCell + '"[^>]*?(?:/>|>[\\s\\S]*?</\\1\\s*>)', 'g');
            const cells = [...exported.matchAll(pattern)];
            assert.equal(cells.length, 1, 'Exactly one saved target remains');
            const styleId = Number(/\bs="(\d+)"/.exec(cells[0][0])?.[1] || 0);
            assert.deepEqual(withoutFill(exportedXfs[styleId]), withoutFill(originalXfs[Number(field.originalStyleId)]), 'Edited cell retains every non-fill style property');
            original = original.replace(pattern, '<target/>'); exported = exported.replace(pattern, '<target/>');
        }
        assert.ok(withoutTab(original) === withoutTab(exported), 'All unrelated worksheet data, formulas and settings remain byte-exact');
    }
    assert.equal(hash(await fs.readFile(filename)), originalHash, 'Original workbook on disk remains unchanged');
    assert.equal(hash(bytes), originalHash, 'Retained original bytes remain unchanged');
    console.log(JSON.stringify({ filename: path.basename(filename), status: 'PASS', originalHash, units: parsed.units.length, sheets: parsed.sheets.length,
        resolvedMissingCells: completionFields.length, reviewedSources: Object.values(records).reduce((sum, record) => sum + Object.keys(record.reviewed).length, 0),
        revisedFields: 1, untouchedParts, macroParts: Object.keys(before.files).filter(name => /vbaProject\.bin$/i.test(name)).length,
        durationMs: Math.round(performance.now() - started) }));
}
(async () => {
    const filenames = process.argv.slice(2);
    assert.ok(filenames.length, 'Supply original .xlsx/.xlsm paths explicitly');
    for (const filename of filenames) { await check(filename); global.gc?.(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
