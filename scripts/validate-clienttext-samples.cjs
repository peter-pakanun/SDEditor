/* Read-only production sample check; optional directory argument contains upstream workbooks. */
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const Codec = require('../public/clientTextCodec.js');
const State = require('../public/clientTextState.js');
const samples = [
    ['Thai_PoE2.xlsm', 'normal', 'Thai', 149550, 211],
    ['French_PoE2.xlsm', 'normal', 'French', 89659, 206],
    ['French_Gender_PoE2.xlsm', 'gender', 'French', 68250, 10],
];
(async () => {
    const directory = process.argv.slice(2).find(value => !value.startsWith('--')) || 'C:/Users/lpeac/Downloads/2026-10-05_POE2';
    for (const [filename, role, language, expectedUnits, expectedSheets] of samples) {
        const started = performance.now(), bytes = await fs.readFile(path.join(directory, filename));
        const parsed = await Codec.parseWorkbook(bytes, { filename, role, language });
        assert.equal(parsed.units.length, expectedUnits); assert.equal(parsed.sheets.length, expectedSheets);
        assert.equal(new Set(parsed.units.map(unit => unit.id)).size, expectedUnits);
        assert.deepEqual(await Codec.exportWorkbook(bytes, parsed, {}), bytes);
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
        const count = predicate => parsed.units.reduce((sum, unit) => sum + unit.fields.filter(predicate).length, 0);
        console.log(JSON.stringify({ filename, units: parsed.units.length, sheets: parsed.sheets.length,
            fields: count(() => true), missing: count(field => field.originalMissing), outdated: count(field => field.outdated),
            warnings: parsed.warnings.length, durationMs: Math.round(performance.now() - started), ...(manifestFacts || {}) }));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
