/* Read-only, independent audit of a StatDescriptions export.
 *
 * node scripts/validate-statdesc-export-preservation.cjs original.zip exported.zip Thai
 * Add --expected-targets prior-export.zip when regenerating an existing export:
 * the authored target text and exported file set must also remain identical.
 *
 * This verifier does not use StatDescCodec: parsed descriptor equality would
 * otherwise miss loss of another language's conditions and trailing directives.
 * It requires unique language blocks; ambiguous duplicate-language originals
 * need their accepted import decisions resolved before this comparison.
 */
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
let JSZip;
try { JSZip = require('jszip'); }
catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    JSZip = require('../../SDEditor-API/node_modules/jszip');
}

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const blank = value => !String(value).replaceAll('\\n', '\n').replaceAll('@', '').replace(/\p{Cf}/gu, '').trim();

function parseDescription(bytes, filepath) {
    const fail = (message, line) => {
        throw new Error(`${filepath}${line ? ':' + line : ''}: ${message}`);
    };
    if (bytes.length % 2 || bytes[0] !== 0xff || bytes[1] !== 0xfe) fail('Expected UTF-16LE with BOM and an even byte length.');
    const text = new TextDecoder('utf-16le', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
    if (text.includes('\0')) fail('Unexpected NUL character.');
    if (!/^[ \t]*description\b/m.test(text)) return null;
    const physical = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
    let cursor = 0;
    const next = () => {
        while (cursor < physical.length && !physical[cursor].trim()) cursor++;
        if (cursor >= physical.length) fail('Unexpected end of description.');
        const line = cursor++;
        return { line: line + 1, text: physical[line].trim() };
    };
    const first = next();
    const declaration = /^description(?:\s+(\S+))?$/.exec(first.text);
    if (!declaration) fail('Invalid description declaration.', first.line);
    const statLine = next();
    const tokens = statLine.text.split(/\s+/);
    if (!/^\d+$/.test(tokens[0]) || !Number.isSafeInteger(Number(tokens[0]))
        || Number(tokens[0]) < 1 || Number(tokens[0]) !== tokens.length - 1) {
        fail('Declared stat count does not match stat identifiers.', statLine.line);
    }
    const blocks = [];
    const seen = new Set();
    let language = 'English';
    while (true) {
        if (seen.has(language)) fail('Duplicate language blocks require accepted import decisions: ' + language);
        seen.add(language);
        const countLine = next();
        if (!/^\d+$/.test(countLine.text) || !Number.isSafeInteger(Number(countLine.text))) {
            fail('Expected an integer entry count.', countLine.line);
        }
        const count = Number(countLine.text);
        if (language === 'English' && count < 1) fail('English must have at least one entry.', countLine.line);
        const entries = [];
        for (let index = 0; index < count; index++) {
            const entry = next();
            const match = /^([^\"]*)\"([^\"]*)\"[ \t]*(.*)$/.exec(entry.text);
            if (match) {
                entries.push({ conditions: match[1].trim(), text: match[2], directives: match[3] });
                continue;
            }
            // Accepted input repair: only a closing quote stranded on the
            // immediately following physical line. Keep its quoted spacing.
            const opening = /^([^\"]*)\"([^\"]*)$/.exec(entry.text);
            const closing = opening && /^( *)\"(?: ([^\"]*))?$/.exec((physical[cursor] || '').trimEnd());
            if (!closing) fail('Invalid quoted entry or a declared entry count mismatch.', entry.line);
            cursor++;
            entries.push({ conditions: opening[1].trim(), text: opening[2] + '\\n' + closing[1], directives: closing[2] || '' });
        }
        blocks.push({ language, entries });
        while (cursor < physical.length && !physical[cursor].trim()) cursor++;
        if (cursor >= physical.length) break;
        const langLine = next();
        const lang = /^lang\s+\"([^\"]+)\"$/.exec(langLine.text);
        if (!lang) fail('Expected a language declaration after the declared entries.', langLine.line);
        language = lang[1];
    }
    return { name: declaration[1] || '', stats: tokens.slice(1), blocks };
}

async function loadArchive(filename) {
    const bytes = await fs.readFile(filename);
    const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
    const files = new Map();
    for (const entry of Object.values(zip.files)) {
        if (entry.dir) continue;
        const originalName = entry.unsafeOriginalName || entry.name;
        if (originalName !== entry.name || originalName.includes('\\') || originalName.startsWith('/')
            || originalName.split('/').includes('..')) throw new Error('Unsafe archive path: ' + originalName);
        files.set(entry.name, await entry.async('uint8array'));
    }
    return { filename: path.basename(filename), sha256: sha256(bytes), bytes: bytes.length, files };
}

async function validateExport(originalFilename, exportFilename, language, { expectedTargetsFilename } = {}) {
    if (!language || language === 'English') throw new Error('Select the authored translation language.');
    const [original, exported, expected] = await Promise.all([
        loadArchive(originalFilename), loadArchive(exportFilename),
        expectedTargetsFilename ? loadArchive(expectedTargetsFilename) : Promise.resolve(null)
    ]);
    const issues = [];
    const changedFiles = new Set();
    const changedUntouchedBlocks = new Set();
    const add = (filepath, kind, details = {}) => {
        issues.push({ filepath, kind, ...details });
        changedFiles.add(filepath);
        if (kind === 'untouched-language-changed') changedUntouchedBlocks.add(filepath + '\0' + details.language);
    };
    let descriptions = 0, authoredEntries = 0, preservedLanguageBlocks = 0, otherFiles = 0;
    if (expected && !isDeepStrictEqual([...exported.files.keys()].sort(), [...expected.files.keys()].sort())) {
        add('(archive)', 'expected-export-path-set-changed');
    }
    for (const [filepath, bytes] of exported.files) {
        const sourceBytes = original.files.get(filepath);
        if (!sourceBytes) { add(filepath, 'path-absent-from-original'); continue; }
        let source, output, prior;
        try {
            source = parseDescription(sourceBytes, filepath);
            output = parseDescription(bytes, filepath);
            if (expected?.files.has(filepath)) prior = parseDescription(expected.files.get(filepath), filepath);
        } catch (error) { add(filepath, 'raw-structure-error', { message: error.message }); continue; }
        if (!source || !output) {
            otherFiles++;
            if (source !== output || !Buffer.from(sourceBytes).equals(Buffer.from(bytes))) add(filepath, 'non-description-file-changed');
            continue;
        }
        descriptions++;
        if (source.name !== output.name || !isDeepStrictEqual(source.stats, output.stats)) add(filepath, 'description-or-stat-identity-changed');
        if (!isDeepStrictEqual(source.blocks[0], output.blocks[0])) add(filepath, 'English-block-changed');
        const sourceBlocks = new Map(source.blocks.map(block => [block.language, block]));
        const outputBlocks = new Map(output.blocks.map(block => [block.language, block]));
        const authored = outputBlocks.get(language);
        const english = source.blocks[0].entries;
        if (!authored) add(filepath, 'authored-language-absent', { language });
        else {
            authoredEntries += authored.entries.length;
            if (authored.entries.length !== english.length || authored.entries.some(entry => blank(entry.text))) {
                add(filepath, 'authored-language-incomplete', { language, actualCount: authored.entries.length, expectedCount: english.length });
            }
            authored.entries.forEach((entry, index) => {
                if (!english[index] || entry.conditions !== english[index].conditions || entry.directives !== english[index].directives) {
                    add(filepath, 'authored-language-metadata-differs-from-English', { language, entry: index + 1 });
                }
            });
            if (expected) {
                const priorBlock = prior?.blocks.find(block => block.language === language);
                if (!priorBlock || !isDeepStrictEqual(authored.entries.map(entry => entry.text), priorBlock.entries.map(entry => entry.text))) {
                    add(filepath, 'expected-authored-target-text-changed', { language });
                }
            }
        }
        for (const [name, before] of sourceBlocks) {
            if (name === language || name === 'English') continue;
            const after = outputBlocks.get(name);
            if (!isDeepStrictEqual(before, after)) add(filepath, 'untouched-language-changed', { language: name });
            else preservedLanguageBlocks++;
        }
        for (const name of outputBlocks.keys()) {
            if (name !== language && !sourceBlocks.has(name)) add(filepath, 'unexpected-language-added', { language: name });
        }
    }
    const countByKind = {};
    for (const issue of issues) countByKind[issue.kind] = (countByKind[issue.kind] || 0) + 1;
    const identity = archive => ({ filename: archive.filename, bytes: archive.bytes, sha256: archive.sha256 });
    return { valid: issues.length === 0, original: identity(original), exported: identity(exported),
        ...(expected ? { expectedTargets: identity(expected) } : {}), language, descriptions, authoredEntries,
        preservedLanguageBlocks, otherFiles, changedFiles: changedFiles.size, changedUntouchedLanguageBlocks: changedUntouchedBlocks.size,
        issueCounts: countByKind, issues };
}

async function main(args) {
    const [original, exported, language, ...options] = args;
    if (!original || !exported || !language || options.length && (options.length !== 2 || options[0] !== '--expected-targets')) {
        throw new Error('Usage: node scripts/validate-statdesc-export-preservation.cjs original.zip exported.zip language [--expected-targets prior-export.zip]');
    }
    const result = await validateExport(original, exported, language, { expectedTargetsFilename: options[1] });
    const { issues, ...summary } = result;
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
    if (issues.length) {
        process.stderr.write(JSON.stringify({ firstIssues: issues.slice(0, 12), totalIssues: issues.length }, null, 2) + '\n');
        process.exitCode = 1;
    }
}

module.exports = { parseDescription, validateExport };
if (require.main === module) main(process.argv.slice(2)).catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
