/* Read-only production sample check; optional directory argument contains upstream workbooks. */
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const Codec = require('../public/clientTextCodec.js');
const samples = [
    ['Thai_PoE2.xlsm', 'normal', 'Thai', 149550, 211],
    ['French_PoE2.xlsm', 'normal', 'French', 89659, 206],
    ['French_Gender_PoE2.xlsm', 'gender', 'French', 68250, 10],
];
(async () => {
    const directory = process.argv[2] || 'C:/Users/lpeac/Downloads/2026-10-05_POE2';
    for (const [filename, role, language, expectedUnits, expectedSheets] of samples) {
        const started = performance.now(), bytes = await fs.readFile(path.join(directory, filename));
        const parsed = await Codec.parseWorkbook(bytes, { filename, role, language });
        assert.equal(parsed.units.length, expectedUnits); assert.equal(parsed.sheets.length, expectedSheets);
        assert.equal(new Set(parsed.units.map(unit => unit.id)).size, expectedUnits);
        assert.deepEqual(await Codec.exportWorkbook(bytes, parsed, {}), bytes);
        const count = predicate => parsed.units.reduce((sum, unit) => sum + unit.fields.filter(predicate).length, 0);
        console.log(JSON.stringify({ filename, units: parsed.units.length, sheets: parsed.sheets.length,
            fields: count(() => true), missing: count(field => field.originalMissing), outdated: count(field => field.outdated),
            warnings: parsed.warnings.length, durationMs: Math.round(performance.now() - started) }));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
