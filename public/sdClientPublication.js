/* Browser-owned SD source parsing and sparse managed-publication preparation. */
(function (root, factory) {
    const api = factory(typeof module === 'object' && module.exports ? require('./statDescCodec.js') : root.StatDescCodec,
        typeof module === 'object' && module.exports ? require('./collaborationProtocol.js') : root.CollaborationProtocol);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.SDClientPublication = api;
})(typeof window === 'object' ? window : globalThis, function (codec, protocol) {
    'use strict';
    const STORAGE_PROTOCOL = 'sd-client-publication-v1';
    const languages = ['French', 'German', 'Japanese', 'Korean', 'Polish', 'Portuguese', 'Russian', 'Simplified Chinese', 'Spanish', 'Thai', 'Traditional Chinese', 'Turkish'];
    const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
        ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
    const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
    const pause = () => new Promise(resolve => setTimeout(resolve, 0));
    const check = options => {
        if (options.signal?.aborted || options.current && !options.current()) throw Object.assign(new Error('SD publication preparation was superseded.'), { name: 'AbortError', stale: true });
    };
    const metadata = file => ({ name: file.name || '', stats: file.stats || [], variables: file.variables || [], remarks: file.remarks || [] });
    const hash = value => protocol.zipHash(new TextEncoder().encode(JSON.stringify(canonical(value))));
    const validPath = name => typeof name === 'string' && name && !name.includes('\\') && !/[\u0000-\u001f]/.test(name)
        && !name.split('/').some(part => !part || part === '.' || part === '..');
    const crcTable = Array.from({ length: 256 }, (_, index) => { let value = index; for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1; return value >>> 0; });
    const crc32 = bytes => { let value = 0xffffffff; for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ value >>> 8; return (value ^ 0xffffffff) >>> 0; };

    async function parse(file, options = {}) {
        check(options);
        const bytes = await file.arrayBuffer(); check(options);
        const zip = await options.JSZip.loadAsync(bytes), entries = Object.values(zip.files).filter(entry => !entry.dir);
        if (!entries.length || entries.length > 100000) throw new Error('The ZIP must contain 1 through 100,000 files.');
        let expanded = 0;
        for (const entry of entries) {
            if (!validPath(entry.name) || entry.unsafeOriginalName && entry.unsafeOriginalName !== entry.name) throw new Error('The ZIP contains an unsafe file path.');
            const size = entry._data?.uncompressedSize || 0; expanded += size;
            if (size > 2 * 1024 * 1024 || expanded > 256 * 1024 * 1024) throw new Error('The ZIP exceeds the extracted-size limit.');
        }
        const textEntries = entries.filter(entry => /\.txt$/i.test(entry.name));
        if (!textEntries.length || codec.detectGameVersionFromFilepaths(textEntries.map(entry => entry.name)) !== options.game) throw new Error('The ZIP does not match the selected game.');
        const rawSource = [];
        for (let index = 0; index < textEntries.length; index++) {
            check(options);
            const entry = textEntries[index], content = await entry.async('uint8array');
            expanded += content.byteLength - (entry._data?.uncompressedSize || 0);
            if (content.byteLength > 2 * 1024 * 1024 || expanded > 256 * 1024 * 1024) throw new Error('The ZIP exceeds the extracted-size limit.');
            if (Number.isInteger(entry._data?.crc32) && crc32(content) !== (entry._data.crc32 >>> 0)) throw new Error('A ZIP entry checksum is invalid: ' + entry.name);
            const desc = codec.parseText(entry.name, codec.decodeUTF16(content), options.language || 'Thai', { strict: true });
            if (desc) rawSource.push(desc);
            options.onProgress?.({ phase: 'Checking StatDescription', completed: index + 1, total: textEntries.length, sheet: entry.name });
            if (index % 32 === 0) await pause();
        }
        if (!rawSource.length) throw new Error('No valid descriptions were found in this ZIP.');
        const zipHash = await protocol.zipHash(bytes); check(options);
        return { rawSource, original: new Blob([bytes], { type: 'application/zip' }), duplicateGroups: codec.collectDuplicateLangGroups(rawSource), identity: { zipHash, zipSize: bytes.byteLength, fileCount: entries.length } };
    }

    function summary(files) {
        const summaries = Object.fromEntries(languages.map(language => [language, { loaded: files.length, eligible: 0, missing: 0, error: 0, invalidOriginal: 0,
            dropped: 0, removedDropped: 0, saved: 0, revised: 0, workload: 0, resolved: 0, translationErrors: [] }]));
        for (const file of files) {
            if (codec.computeIsDNT(file.translations.English)) continue;
            for (const language of languages) {
                const counts = summaries[language], issues = codec.baselineTranslationIssues(file, language);
                counts.eligible++;
                if (!issues.valid) counts.missing++;
                if (issues.languageBlockPresent && !issues.valid) {
                    counts.error++; counts.invalidOriginal++;
                    if (counts.translationErrors.length < 100) counts.translationErrors.push({ filepath: file.filepath, code: 'SD_TRANSLATION_INVALID', ...issues });
                }
            }
        }
        for (const counts of Object.values(summaries)) counts.workload = counts.missing;
        return { format: 'sd-baseline-summary-v1', eligibilityPolicy: 'dnt-word-v1', fileCount: files.length, summaries };
    }

    async function prepare(parsed, decisions = [], options = {}) {
        check(options);
        const canonicalArchive = options.canonicalArchive;
        const choices = canonicalArchive?.decisions || decisions;
        const files = (await codec.applyDuplicateSelections(parsed.rawSource, choices, { inPlace: true })).sort((left, right) => left.filepath < right.filepath ? -1 : left.filepath > right.filepath ? 1 : 0);
        const paths = new Map();
        for (let index = 0; index < files.length; index++) {
            const file = files[index]; protocol.witness(file);
            if (paths.has(file.filepath)) throw new Error('The ZIP contains duplicate description filepaths.');
            paths.set(file.filepath, file);
            if (index % 128 === 0) { check(options); await pause(); }
        }
        const archive = await protocol.finalizeArchive(canonicalArchive || { version: 2, ...parsed.identity, descriptionCount: files.length, parserVersion: 1, decisions: choices });
        if (archive.zipHash !== parsed.identity.zipHash || archive.zipSize !== parsed.identity.zipSize || archive.fileCount !== parsed.identity.fileCount
            || archive.descriptionCount !== files.length) throw new Error('The selected ZIP does not reproduce its accepted immutable baseline.');
        check(options);
        return { archive, summary: summary(files), files: paths, facts: new Map() };
    }

    async function sourceFacts(file) {
        const witness = protocol.witness(file), english = witness.translations.English, originalLanguages = languages.filter(language => Object.hasOwn(witness.translations, language));
        const originalIssues = Object.fromEntries(originalLanguages.map(language => [language, codec.baselineTranslationIssues(witness, language)]).filter(([, issues]) => !issues.valid));
        const targetHashes = {};
        for (const language of originalLanguages) targetHashes[language] = await hash(witness.translations[language]);
        return { filepath: witness.filepath, entryCount: english.length, englishHash: await hash(english), metadataHash: await hash(metadata(witness)),
            leafHash: await protocol.zipHash(new TextEncoder().encode('sdeditor:baseline:leaf:v1\n' + JSON.stringify(witness))), eligible: !codec.computeIsDNT(english), originalLanguages,
            targetHashes, languageCounts: Object.fromEntries(originalLanguages.map(language => [language, witness.translations[language].length])),
            originalHashes: Object.fromEntries(originalLanguages.filter(language => codec.translationIssues(witness.translations[language], english.length).valid).map(language => [language, targetHashes[language]])),
            ...(Object.keys(originalIssues).length ? { originalIssues } : {}) };
    }

    async function disposition(record, language, prepared, options = {}) {
        check(options);
        if (!record?.id || !['saved', 'dropped', 'recovery'].includes(record.kind) || !validPath(record.filepath)) throw new Error('The frozen SD publication record is invalid.');
        const file = prepared.files.get(record.filepath);
        if (!file) return { recordId: record.id, action: 'remove' };
        let facts = prepared.facts.get(record.filepath);
        if (!facts) { facts = await sourceFacts(file); prepared.facts.set(record.filepath, facts); }
        let action = 'drop';
        if (record.kind === 'saved') {
            const incoming = file.translations[language] || [], target = record.translations;
            const previous = record.sourceFacts || record.sourceRef || {};
            const valid = codec.translationIssues(target, facts.entryCount).valid;
            if (codec.validEnglishIntent(record.englishIntent)) {
                const intent = record.englishIntent;
                if (valid && intent.englishHash === facts.englishHash && intent.metadataHash === facts.metadataHash && await hash(target) === facts.englishHash
                    && (!incoming.some(text => !codec.isBlankTranslation(text)) || same(incoming, target))) action = 'carry';
            } else if (valid && previous.englishHash === facts.englishHash && codec.translationIssues(incoming, facts.entryCount).valid) {
                action = previous.metadataHash && previous.metadataHash === facts.metadataHash && same(incoming, target) ? 'baseline' : 'carry';
            }
        }
        check(options);
        return { recordId: record.id, action, nextFacts: facts, ...(['carry', 'baseline'].includes(action) ? { originalTranslations: [...(file.translations[language] || [])] } : {}) };
    }

    async function buildDispositions(snapshot, readPage, prepared, options = {}) {
        if (!snapshot?.id || !Array.isArray(snapshot.teams) || !Number.isSafeInteger(snapshot.recordCount) || snapshot.recordCount < 0) throw new Error('The frozen SD publication snapshot is invalid.');
        const chunks = [], seen = new Set(); let records = [], bytes = 128, completed = 0;
        const flush = () => { if (records.length) { chunks.push({ storageProtocol: STORAGE_PROTOCOL, snapshotId: snapshot.id, index: chunks.length, records }); records = []; bytes = 128; } };
        for (const team of snapshot.teams) {
            if (!languages.includes(team.language) || !Number.isSafeInteger(team.recordCount) || team.recordCount < 0) throw new Error('The frozen SD publication team is invalid.');
            let cursor = 0, teamCount = 0;
            while (teamCount < team.recordCount) {
                check(options);
                const page = await readPage(team.language, cursor); check(options);
                if (page.snapshotId !== snapshot.id || page.language !== team.language || !Array.isArray(page.records) || page.records.length > 100 || !page.records.length
                    || page.total !== team.recordCount) throw new Error('The frozen SD publication page changed or is incomplete.');
                for (const record of page.records) {
                    const key = team.language + '\n' + record.id;
                    if (seen.has(key)) throw new Error('The frozen SD publication record is repeated.'); seen.add(key);
                    const item = await disposition(record, team.language, prepared, options), size = new TextEncoder().encode(JSON.stringify(item)).length + 1;
                    if (size > 1800000) throw new Error('One SD publication disposition exceeds the upload size limit.');
                    if (records.length >= 100 || bytes + size > 1800000) flush();
                    records.push(item); bytes += size; teamCount++; completed++;
                    options.onProgress?.({ phase: 'Comparing accepted StatDescription work', completed, total: snapshot.recordCount, workbook: team.language, sheet: record.filepath });
                }
                if (teamCount > team.recordCount || teamCount < team.recordCount && (page.nextCursor == null || String(page.nextCursor) === String(cursor))) throw new Error('The frozen SD publication page is incomplete.');
                cursor = page.nextCursor;
                await pause();
            }
        }
        if (completed !== snapshot.recordCount) throw new Error('The frozen SD publication record count differs.');
        flush(); check(options); return chunks;
    }
    return { STORAGE_PROTOCOL, languages, parse, prepare, summary, sourceFacts, disposition, buildDispositions };
});
