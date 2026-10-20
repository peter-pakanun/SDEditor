/* Read-only production sample check; optional directory argument contains upstream workbooks. */
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const JSZip = require('../../SDEditor-API/node_modules/jszip');
const XMLParser = require('../public/vendor/fast-xml-parser-5.11.2.min.js').default;
const Codec = require('../public/clientTextCodec.js');
const State = require('../public/clientTextState.js');
const allLanguages = process.argv.includes('--all-languages');
const hints = process.argv.includes('--hints');
const samples = hints ? [['Thai_with_hint.xlsx', 'normal', 'Thai', 43777, 4]] : process.argv.includes('--german') ? [
    ['German.xlsm', 'normal', 'German', 89902, 206],
    ['German_Gender.xlsm', 'gender', 'German', 68484, 10],
] : [
    ['Thai_PoE2.xlsm', 'normal', 'Thai', 149550, 211],
    ['French_PoE2.xlsm', 'normal', 'French', 89659, 206],
    ['French_Gender_PoE2.xlsm', 'gender', 'French', 68250, 10],
];
const allLanguageSamples = [
    ...['French', 'German', 'Polish', 'Portuguese', 'Russian', 'Spanish'].flatMap(language => [
        [language + '.xlsx', 'normal', language, 90500, 207],
        [language + '_Gender.xlsx', 'gender', language, 68682, 10],
    ]),
    ...['Thai', 'Japanese', 'Korean', 'Traditional Chinese', 'Turkish'].map(language => [language + '.xlsx', 'normal', language, 150808, 212]),
];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function selectedEdits(parsed) {
    const selected = [], coordinates = new Set();
    function choose(predicate) {
        for (const unit of parsed.units) for (const field of unit.fields) if (predicate(field, unit) && !coordinates.has(unit.sheet + '/' + field.targetCell)) {
            coordinates.add(unit.sheet + '/' + field.targetCell); selected.push({ unit, field }); return;
        }
    }
    choose(field => field.kind === 'text' && field.source.trim() && !State.audioOnly(field.source));
    choose(field => field.kind === 'gender');
    choose(field => field.kind === 'form' && !State.isNamedForm(field) && field.source.trim() && !State.audioOnly(field.source));
    choose(field => State.CLASS_FORMS.includes(field.form) && field.target.trim());
    for (const form of ['Normal Translation', 'Possessive Translation']) choose(field => State.isNamedForm(field) && field.form === form);
    assert.ok(selected.length, 'The workbook must provide an editable target for preservation validation');
    return selected;
}
async function validateTargetedPatches(bytes, parsed) {
    const selected = selectedEdits(parsed), records = {}, editsByPath = new Map();
    for (const { unit, field } of selected) {
        const authored = '=Literal @\\n raw\r\nactual\nไทย Türkçe _x0020_ <continue> [Tag|display] · ' + field.id;
        (records[unit.id] ||= { values: {} }).values[field.id] = authored;
        const worksheet = parsed.sheets.find(item => item.name === unit.sheet);
        if (!editsByPath.has(worksheet.path)) editsByPath.set(worksheet.path, new Map());
        editsByPath.get(worksheet.path).set(field.targetCell, authored);
    }
    const output = await Codec.exportWorkbook(bytes, parsed, records), before = await JSZip.loadAsync(bytes), after = await JSZip.loadAsync(output);
    assert.deepEqual(Object.keys(after.files).filter(name => !after.files[name].dir).sort(), Object.keys(before.files).filter(name => !before.files[name].dir).sort());
    const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false, trimValues: false, processEntities: true, htmlEntities: true, alwaysCreateTextNode: true });
    for (const name of Object.keys(before.files)) {
        if (before.files[name].dir || name === 'xl/styles.xml') continue;
        if (!editsByPath.has(name)) {
            assert.deepEqual(await after.file(name).async('uint8array'), await before.file(name).async('uint8array'), 'Untouched workbook part: ' + name);
            continue;
        }
        const original = await before.file(name).async('string'), changed = await after.file(name).async('string');
        let originalRemainder = original, changedRemainder = changed;
        for (const [coordinate, authored] of editsByPath.get(name)) {
            const pattern = new RegExp('<((?:[\\w.-]+:)?c)\\b[^>]*?\\br="' + coordinate + '"[^>]*?(?:/>|>[\\s\\S]*?</\\1\\s*>)', 'g');
            const oldCells = Array.from(original.matchAll(pattern)), newCells = Array.from(changed.matchAll(pattern));
            assert.equal(newCells.length, 1, 'Exactly one edited target exists: ' + name + '!' + coordinate);
            assert.ok(oldCells.length <= 1, 'An original target coordinate must never be duplicated');
            const target = parser.parse(newCells[0][0]);
            const cell = target[Object.keys(target).find(key => key === 'c' || key.endsWith(':c'))];
            const inline = cell.is || cell[Object.keys(cell).find(key => key.endsWith(':is'))];
            const text = inline.t || inline[Object.keys(inline).find(key => key.endsWith(':t'))];
            const value = String(text['#text'] ?? '').replace(/_x([0-9a-f]{4})_/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
            assert.equal(value, authored, 'Authored target preserves raw text: ' + name + '!' + coordinate);
            assert.equal(cell['@_t'], 'inlineStr'); assert.equal(Object.keys(cell).some(key => key === 'f' || key.endsWith(':f')), false);
            // All production sample targets have original cells. This also
            // verifies that a self-closing blank patch cannot consume a neighbor.
            assert.equal(oldCells.length, 1, 'Production target has an original cell: ' + name + '!' + coordinate);
            originalRemainder = originalRemainder.replace(pattern, '<validated-target coordinate="' + coordinate + '"/>');
            changedRemainder = changedRemainder.replace(pattern, '<validated-target coordinate="' + coordinate + '"/>');
        }
        const sheetName = parsed.sheets.find(sheet => sheet.path === name)?.name;
        const statuses = parsed.units.filter(unit => unit.sheet === sheetName).map(unit => State.statusFor(unit, records[unit.id]));
        const expectedColor = statuses.some(status => status.missing) ? Codec.TAB_COLORS.missing : statuses.some(status => status.outdated) ? Codec.TAB_COLORS.outdated
            : statuses.some(status => status.revised) ? Codec.TAB_COLORS.revised : Codec.TAB_COLORS.filled;
        const tabColor = /<(?:[\w.-]+:)?tabColor\b[^>]*\brgb="FF([A-F0-9]{6})"/i.exec(changed)?.[1];
        assert.equal(tabColor, expectedColor, 'Tab color uses the whole committed sheet: ' + name);
        const withoutTab = raw => raw.replace(/<((?:[\w.-]+:)?tabColor)\b[^>]*?(?:\/>|>[\s\S]*?<\/\1\s*>)/, '')
            .replace(/<((?:[\w.-]+:)?sheetPr)([^>]*?)>\s*<\/\1>/, '<$1$2/>').replace(/<(?:[\w.-]+:)?sheetPr\s*\/>/, '');
        assert.equal(withoutTab(changedRemainder), withoutTab(originalRemainder), 'English, metadata, notes, other sheet properties and unrelated cells remain byte-exact: ' + name);
    }
    return selected.length;
}
(async () => {
    const argumentDirectory = process.argv.slice(2).find(value => !value.startsWith('--'));
    if (allLanguages && !argumentDirectory) throw new Error('--all-languages requires the supplied export directory as a positional argument.');
    if (hints && (allLanguages || process.argv.includes('--german'))) throw new Error('--hints must be checked separately from the other sample sets.');
    const directory = argumentDirectory || (hints ? 'C:/Users/lpeac/Downloads/2026-10-15_POE2' : 'C:/Users/lpeac/Downloads/2026-10-05_POE2');
    if (allLanguages) {
        const filenames = (await fs.readdir(directory)).filter(name => /\.xlsx$/i.test(name)).sort();
        assert.deepEqual(filenames, allLanguageSamples.map(sample => sample[0]).sort(), 'The supplied all-language export contains exactly the expected 17 workbooks; ZIP files are ignored');
    }
    for (const [filename, role, language, expectedUnits, expectedSheets] of allLanguages ? allLanguageSamples : samples) {
        const started = performance.now(), originalPath = path.join(directory, filename), bytes = await fs.readFile(originalPath), originalHash = sha256(bytes);
        const parsed = await Codec.parseWorkbook(bytes, { filename, role, language });
        assert.equal(parsed.units.length, expectedUnits); assert.equal(parsed.sheets.length, expectedSheets);
        assert.equal(new Set(parsed.units.map(unit => unit.id)).size, expectedUnits);
        assert.deepEqual(await Codec.exportWorkbook(bytes, parsed, {}), bytes);
        if (hints) {
            assert.equal(parsed.parserVersion, 'clienttext-v4');
            assert.equal(parsed.warnings.some(warning => warning.code === 'CLIENTTEXT_METADATA_COLUMN'), false, 'Italic hints are recognized reference columns');
            const npcs = parsed.units.filter(unit => unit.sheet === 'NPCs'), dialogue = parsed.units.filter(unit => unit.sheet === 'NPCTalkDialogueTextAudio');
            assert.equal(npcs.some(unit => unit.fields.some(field => field.kind === 'gender')), false, 'Italic NPC Gender is never an editable target');
            assert.equal(npcs.filter(unit => unit.metadata.Gender.trim()).length, 665, 'Intrinsic NPC genders remain exact readonly hints');
            assert.equal(dialogue.length, 11727);
            let requiredClassForms = 0, optionalClassForms = 0;
            for (const unit of dialogue) {
                assert.equal(Object.hasOwn(unit.metadata, 'NPC'), true); assert.equal(Object.hasOwn(unit.metadata, 'Character'), true);
                const classForms = unit.fields.filter(field => State.CLASS_FORMS.includes(field.form));
                assert.equal(classForms.length, 12, 'Nonitalic class columns remain editable form targets');
                assert.equal(classForms.every(field => field.target === ''), true, 'Class targets preserve the sample blanks');
                requiredClassForms += classForms.filter(field => field.required).length;
                optionalClassForms += classForms.filter(field => !field.required).length;
            }
            assert.equal(requiredClassForms, 4668, 'Direct red fills retain the marked class workload');
            assert.equal(optionalClassForms, 136056, 'Other blank class forms and NOAUDIO rows remain optional');
        }
        let manifestFacts;
        if (process.argv.includes('--manifest')) {
            const manifestStarted = performance.now();
            const manifest = await State.buildManifest(parsed.units, [{ role, hash: parsed.artifactHash }]);
            const manifestMs = Math.round(performance.now() - manifestStarted), compact = new Map(manifest.units.map(unit => [unit.id, unit]));
            for (const index of [0, 1, Math.floor(parsed.units.length / 2), parsed.units.length - 1]) {
                const unit = parsed.units[index];
                assert.equal(State.verifyWitness(unit, compact.get(unit.id), State.proofFor(manifest, unit.id), manifest.descriptors[0]), true);
            }
            const measuredBytes = values => values.reduce((sum, value) => sum + Buffer.byteLength(JSON.stringify(value)), 0);
            manifestFacts = { manifestMs, baselineId: manifest.descriptors[0].baselineId, root: manifest.descriptors[0].root,
                originalJsonBytes: measuredBytes(parsed.units), compactJsonBytes: measuredBytes(manifest.units),
                treeJsonBytes: Buffer.byteLength(JSON.stringify(manifest.trees)), heapMb: Math.round(process.memoryUsage().heapUsed / 1048576) };
        }
        if (allLanguages || process.argv.includes('--trusted')) {
            const descriptorStarted = performance.now();
            const preparation = await State.buildDescriptors(parsed.units, [{ role, hash: parsed.artifactHash, parserVersion: parsed.parserVersion }]);
            const descriptorMs = Math.round(performance.now() - descriptorStarted), descriptor = preparation.descriptors[0];
            assert.equal(preparation.storageProtocol, 'clienttext-trusted-v1');
            assert.equal(descriptor.assetHash, parsed.artifactHash); assert.equal(descriptor.parserVersion, parsed.parserVersion);
            assert.equal(descriptor.unitCount, expectedUnits); assert.equal(preparation.summaries[role].loaded, expectedUnits);
            assert.equal(Object.hasOwn(preparation, 'units'), false); assert.equal(Object.hasOwn(preparation, 'trees'), false);
            assert.equal(Object.hasOwn(descriptor, 'root'), false);
            const publicationMetadataBytes = Buffer.byteLength(JSON.stringify(preparation));
            assert.ok(publicationMetadataBytes < 4096, 'Trusted publication metadata stays bounded for the complete workbook');
            manifestFacts = { ...manifestFacts, descriptorMs, publicationMetadataBytes, storageProtocol: preparation.storageProtocol,
                baselineId: descriptor.baselineId, summary: preparation.summaries[role] };
        }
        let targetedEdits;
        if (allLanguages || hints) {
            assert.equal(parsed.parserVersion, 'clienttext-v4');
            targetedEdits = await validateTargetedPatches(bytes, parsed);
            assert.equal(sha256(bytes), originalHash, 'Parsing/export preserves the retained input bytes');
            assert.equal(sha256(await fs.readFile(originalPath)), originalHash, 'The supplied workbook remains unchanged on disk');
        }
        const count = predicate => parsed.units.reduce((sum, unit) => sum + unit.fields.filter(predicate).length, 0);
        console.log(JSON.stringify({ filename, units: parsed.units.length, sheets: parsed.sheets.length,
            fields: count(() => true), missing: count(field => field.originalMissing), outdated: count(field => field.outdated),
            warnings: parsed.warnings.length, durationMs: Math.round(performance.now() - started), ...(targetedEdits ? { targetedEdits, originalHash } : {}), ...(manifestFacts || {}) }));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
