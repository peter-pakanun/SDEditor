const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { deflateRawSync, inflateRawSync } = require('node:zlib');
const P = require('../public/collaborationProtocol.js');

function fixture() {
  const alerts = [];
  class FileReader {
    readAsText(blob, encoding) {
      blob.arrayBuffer().then(bytes => { this.result = new TextDecoder(encoding).decode(bytes); this.onload?.(); }, error => this.onerror?.(error));
    }
  }
  const context = vm.createContext({ Blob, FileReader,
    window: { AppDialogs: { alert: async value => { alerts.push(value); } } },
    alert: () => assert.fail('Native parser alerts must not be used'), console });
  for (const filename of ['helper.js', 'statDescParser.js', 'dummyFiles.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../public', filename), 'utf8'), context, { filename });
  }
  return { alerts, parse: (text, strict = true, filename = 'source/test.txt') => context.parseDesc(filename, text, 'Thai', { strict }),
    parseFile: (filename, entry, strict = true) => context.parseFile(filename, entry, 'Thai', { strict }),
    dummy: vm.runInContext('[dummyFile1, dummyFile2, dummyFile3]', context), encode: context.descEncode };
}
const source = `description example\n1 damage\n2\n# "First {0}"\n# "Second" negate 1\nlang "Thai"\n2\n# "หนึ่ง {0}"\n# "สอง"`;

test('cooperative hashing preserves canonical source identity and yields between bounded preparation slices', async () => {
  const source = Array.from({ length: 130 }, (_, index) => ({ filepath: `source/${130 - index}.txt`, name: 'ภาษาไทย 😀',
    stats: ['damage'], variables: ['#'], remarks: [''], translations: { English: ['Damage {0} \\n quoted "text"'], Thai: ['ความเสียหาย {0}'] } }));
  const before = structuredClone(source); let yields = 0;
  assert.equal(await P.sourceHashAsync(source, { budgetMs: 0, yieldTask: async () => { yields++; } }), await P.sourceHash(source));
  assert.ok(yields >= 6, 'Validation, serialization and byte assembly all give the browser a chance to respond.');
  assert.deepEqual(source, before);
  assert.deepEqual(await P.manifestAsync(source), P.manifest(source));
  assert.equal(await P.sourceHashAsync(P.manifest(source)), await P.sourceHash(source));
});

test('cooperative source preparation cancels before hashing or publishing a stale workspace', async () => {
  const source = Array.from({ length: 130 }, (_, index) => ({ filepath: `${index}.txt`, stats: ['damage'], variables: ['#'], remarks: [''], translations: { English: ['Original'] } }));
  let cancelled = false, digests = 0;
  await assert.rejects(P.sourceHashAsync(source, { budgetMs: 0, isCancelled: () => cancelled,
    yieldTask: async () => { cancelled = true; }, cryptoProvider: { subtle: { digest() { digests++; } } } }), error => error.stale === true);
  assert.equal(digests, 0);
  await assert.rejects(P.manifestAsync([...source, source[0]], { budgetMs: 0, yieldTask: async () => {} }), /duplicate source/);
});

test('public workspace projection remains pure and preserves other languages and metadata', () => {
  const workspace = { descs: [{ filepath: 'a.txt', translations: { English: ['Original'], Thai: ['old'], German: ['German'] } }],
    status: { 'a.txt': { preserved: true } }, unrelated: { nested: true } };
  const originals = [{ filepath: 'b.txt', translations: { English: ['Second'], German: ['Another'] }, stats: ['b'] }];
  const files = [{ filepath: 'a.txt', translations: ['saved'], needsReview: false, trackedForExport: true },
    { filepath: 'b.txt', translations: ['new saved'], needsReview: true, trackedForExport: true }];
  const before = structuredClone({ workspace, originals, files });
  const result = P.projectWorkspace(workspace, files, 'Thai', originals);
  assert.deepEqual({ workspace, originals, files }, before);
  assert.deepEqual(result.descs[0].translations.German, ['German']);
  assert.deepEqual(result.descs[1].translations.English, ['Second']);
  assert.deepEqual(result.descs[1].translations.German, ['Another']);
  assert.equal(result.status['a.txt'].preserved, true);
  assert.equal(result.status['b.txt'].needsReview, true);
  result.descs[0].translations.German[0] = 'result-only edit';
  result.descs[1].stats[0] = 'result-only metadata';
  result.descs[1].translations.Thai[0] = 'result-only translation';
  result.unrelated.nested = false;
  assert.deepEqual({ workspace, originals, files }, before);
});

test('owned workspace projection updates edited rows without serializing untouched content', () => {
  const untouched = { filepath: 'b.txt', translations: { Thai: ['keep'] } };
  Object.defineProperty(untouched, 'unreadPayload', { enumerable: true, get() { throw new Error('Unedited content was serialized'); } });
  const owned = { descs: [{ filepath: 'a.txt', translations: { Thai: ['old'], German: ['German'] } }, untouched], status: {} };
  const file = { filepath: 'a.txt', translations: ['saved'], needsReview: false, trackedForExport: true };
  const result = P.projectWorkspace(owned, [file], 'Thai', [], { mutate: true });
  assert.equal(result, owned);
  assert.equal(result.descs[1], untouched);
  assert.deepEqual(result.descs[0].translations.Thai, ['saved']);
  assert.deepEqual(result.descs[0].translations.German, ['German']);
  result.descs[0].translations.Thai[0] = 'projected-only edit';
  assert.deepEqual(file.translations, ['saved'], 'Persisted room state remains independent from projected translations.');
});

test('strict parser rejects malformed stat counts, numeric suffixes, and nonintegral count lines cleanly', () => {
  const f = fixture();
  for (const line of ['2 damage', '1 damage extra', '1oops damage', '1.5 damage', '-1 damage', '0 damage', '9007199254740992 damage']) {
    assert.throws(() => f.parse(source.replace('1 damage', line)), /Malformed source: source\/test.txt:2:.*stat count/);
  }
  for (const line of ['2oops', '2.5', '-2', '2 extra', '9007199254740992']) {
    assert.throws(() => f.parse(source.replace('\n2\n', '\n' + line + '\n')), /Malformed source:.*translation count/);
  }
  assert.equal(f.alerts.length, 0, 'Strict imports report one exception to the import UI instead of opening per-file alerts');
});

test('missing English or incomplete translation blocks never leak a dereference error', () => {
  const f = fixture();
  for (const text of ['', 'description', 'description\n1 damage', 'description\n1 damage\n0', 'description\n1 damage\n1',
    source.replace('\n2\n# "First', '\n3\n# "First'), source.replace('\n# "สอง"', '')]) {
    assert.throws(() => f.parse(text), error => error.name === 'Error' && /Malformed source/.test(error.message));
  }
  assert.throws(() => f.parse(source + '\n# "too many"'), /more translation entries/);
  assert.equal(f.alerts.length, 0);
});

test('language declarations must occupy the whole line and cannot be embedded in source remarks', () => {
  const f = fixture();
  const embedded = 'description\n1 damage\n1\n# "Source text" reminder lang "not a declaration"';
  const parsed = f.parse(embedded);
  assert.deepEqual(Array.from(parsed.translations.English), ['Source text']);
  assert.equal(parsed.remarks[0], 'reminder lang "not a declaration"');
  for (const declaration of ['lang "Thai" trailing', 'lang Thai', 'lang ""', 'lang "__proto__"', 'lang "constructor"', 'lang "toString"', 'lang "hasOwnProperty"']) {
    assert.throws(() => f.parse(source.replace('lang "Thai"', declaration)), /Malformed source:.*language/);
  }
});

test('zero-entry target languages and intentional blank translations remain valid', () => {
  const f = fixture();
  const emptyTarget = f.parse(source.replace('2\n# "หนึ่ง {0}"\n# "สอง"', '0'));
  assert.deepEqual(Array.from(emptyTarget.translations.Thai), []); assert.equal(emptyTarget.isMissing, true);
  const blanks = f.parse(source.replace('"หนึ่ง {0}"', '""').replace('"สอง"', '""'));
  assert.deepEqual(Array.from(blanks.translations.Thai), ['', '']);
});

test('duplicate languages preserve selection candidates and English-only source metadata', () => {
  const f = fixture();
  const parsed = f.parse(source + '\nlang "Thai"\n2\n9 "อื่น" translated_only\n8 "อีก"');
  assert.equal(parsed.duplicateLangGroups.length, 1);
  assert.equal(parsed.duplicateLangGroups[0].lang, 'Thai');
  assert.equal(parsed.duplicateLangGroups[0].options.length, 2);
  assert.deepEqual(Array.from(parsed.variables), ['#', '#']);
  assert.deepEqual(Array.from(parsed.remarks), ['', 'negate 1']);
  assert.deepEqual(Array.from(parsed.duplicateLangGroups[0].options[1].variables), ['9', '8']);
  assert.throws(() => f.parse(source + '\nlang "English"\n0'), /English must contain at least one entry/);
});

test('existing multilingual, table, multiline and DNT fixtures retain supported parser behavior', async () => {
  const f = fixture();
  for (let index = 0; index < f.dummy.length; index++) {
    const normal = f.parse(f.dummy[index], false, `source/${index}.txt`);
    const strict = f.parse(f.dummy[index], true, `source/${index}.txt`);
    assert.deepEqual(JSON.parse(JSON.stringify(strict)), JSON.parse(JSON.stringify(normal)));
    assert.match(await P.sourceHash([strict]), /^[a-f0-9]{64}$/);
  }
  assert.equal(f.parse('description\n1 test\n1\n# "[DNT] Hidden"').isDNT, true);
  assert.equal(f.parse(source.replace('1 damage', '1oops damage'), false).stats[0], 'damage', 'Legacy non-strict count parsing is unchanged');
  assert.equal(f.alerts.length, 0);
});

test('parseFile detects indented descriptions and rejects multiple declarations in strict imports', async () => {
  const f = fixture();
  const entry = text => ({ async: async () => Buffer.from('\ufeff' + text, 'utf16le') });
  assert.equal((await f.parseFile('source/indented.txt', entry('  ' + source))).name, 'example');
  await assert.rejects(f.parseFile('source/multiple.txt', entry(source + '\n  description second')), /Multiple descriptions/);
  assert.equal(await f.parseFile('source/include.txt', entry('include "other.txt"')), false, 'Auxiliary files remain outside the source manifest');
});

const repairPath = 'stat_descriptions/ignite_faster_burn_%_applies_to_ignite_proliferation_delay_ms.txt';
const repairText = '[DNT] Modifiers which make [Ignite] deal damage faster also lower the delay before it spreads';
const brokenSource = `description\n1 ignite_faster_burn_%_applies_to_ignite_proliferation_delay_ms\n1\n# "${repairText}\n"`;
const escapedSource = brokenSource.replace(`${repairText}\n"`, `${repairText}\\n"`);

test('stranded closing quotes repair consistently in strict and legacy parsing for LF and CRLF', () => {
  const f = fixture();
  for (const strict of [true, false]) {
    for (const newline of ['\n', '\r\n']) {
      const parsed = f.parse(brokenSource.replace(/\n/g, newline), strict, repairPath);
      assert.deepEqual(Array.from(parsed.translations.English), [repairText + '\\n']);
      assert.deepEqual(Array.from(parsed.variables), ['#']);
      assert.deepEqual(Array.from(parsed.remarks), ['']);
      assert.equal(parsed.isDNT, true);
      assert.deepEqual(JSON.parse(JSON.stringify(parsed.importRepairs)), [
        { filepath: repairPath, lang: 'English', line: 4, endLine: 5, kind: 'quoted-line-break' }
      ]);
    }
  }
  assert.equal(f.alerts.length, 0, 'Recoverable input does not open parser error alerts');
  assert.equal(Object.hasOwn(f.parse(escapedSource), 'importRepairs'), false, 'Valid entries need no repair metadata');
});

test('quote repair preserves content whitespace, variables, and closing-line remarks', () => {
  const f = fixture();
  const text = 'description\n2 first_stat second_stat\n1\n\t# 1 "First \t\n \t" negate 2';
  for (const strict of [true, false]) {
    const parsed = f.parse(text, strict);
    assert.deepEqual(Array.from(parsed.variables), ['# 1']);
    assert.deepEqual(Array.from(parsed.translations.English), ['First  \\n  ']);
    assert.deepEqual(Array.from(parsed.remarks), ['negate 2']);
  }
});

test('repairs retain language identity, duplicate candidates, and physical source lines', () => {
  const f = fixture();
  const text = 'description\n1 damage\n1\n# "English\n"\nlang "Thai"\n1\n# "หนึ่ง\n"\nlang "Thai"\n1\n9 "อื่น\n" translated_only';
  for (const strict of [true, false]) {
    const parsed = f.parse(text, strict);
    assert.deepEqual(Array.from(parsed.translations.Thai), ['หนึ่ง\\n']);
    assert.deepEqual(JSON.parse(JSON.stringify(parsed.importRepairs)), [
      { filepath: 'source/test.txt', lang: 'English', line: 4, endLine: 5, kind: 'quoted-line-break' },
      { filepath: 'source/test.txt', lang: 'Thai', line: 8, endLine: 9, kind: 'quoted-line-break' },
      { filepath: 'source/test.txt', lang: 'Thai', line: 12, endLine: 13, kind: 'quoted-line-break' }
    ]);
    const [group] = parsed.duplicateLangGroups;
    assert.equal(group.lang, 'Thai');
    assert.equal(group.options.length, 2);
    assert.deepEqual(Array.from(group.options, option => option.line), [6, 10]);
    assert.deepEqual(Array.from(group.options[0].content), ['หนึ่ง\\n']);
    assert.deepEqual(Array.from(group.options[1].content), ['อื่น\\n']);
    assert.deepEqual(Array.from(group.options[1].variables), ['9']);
    assert.deepEqual(Array.from(group.options[1].remarks), ['translated_only']);
    assert.notEqual(group.options[0].id, group.options[1].id, 'Duplicate options remain independently selectable');
    assert.deepEqual(Array.from(parsed.variables), ['#'], 'A translated repair cannot replace English source metadata');
    assert.deepEqual(Array.from(parsed.remarks), ['']);
  }
});

test('ambiguous missing quotes remain rejected without consuming later entries or declarations', () => {
  for (const suffix of ['', '\n# "Next"', '\n""', '\n"Next"', '\n" Next"', '\n" "', '\nlang "Thai"\n1\n# "ถัดไป"', '\n1\n# "Next"',
    '\ndescription next', '\ncontinued text"', '\n\n"']) {
    const f = fixture();
    const text = 'description\n1 damage\n1\n# "Unfinished' + suffix;
    assert.throws(() => f.parse(text), /Malformed source: source\/test.txt:4: Invalid quoted translation entry/);
    assert.equal(f.parse(text, false), false, 'Legacy parsing also refuses an ambiguous repair');
    assert.equal(f.alerts.length, 1);
  }
  const f = fixture();
  assert.throws(() => f.parse('description\n1 damage\n2\n# "Recovered\n"\n# "Unfinished'),
    /Malformed source: source\/test.txt:6: Invalid quoted translation entry/, 'Errors after a repair keep physical line numbers');
});

test('parseFile repairs UTF-16LE source entries in both import modes', async () => {
  const f = fixture();
  for (const strict of [true, false]) {
    const entry = { async: async () => Buffer.from('\ufeff' + brokenSource.replace(/\n/g, '\r\n'), 'utf16le') };
    const parsed = await f.parseFile(repairPath, entry, strict);
    assert.deepEqual(Array.from(parsed.translations.English), [repairText + '\\n']);
    assert.equal(parsed.importRepairs[0].filepath, repairPath);
    assert.equal(parsed.importRepairs[0].line, 4);
    assert.equal(parsed.importRepairs[0].endLine, 5);
  }
  assert.equal(f.alerts.length, 0);
});

test('original, escaped repair, and exported source share a hash while actual source changes do not', async () => {
  const f = fixture();
  const original = f.parse(brokenSource, true, repairPath);
  const repaired = f.parse(escapedSource, true, repairPath);
  const reparsed = await f.parseFile(repairPath, { async: async () => f.encode(original) });
  const originalHash = await P.sourceHash([original]);
  assert.equal(await P.sourceHash([repaired]), originalHash);
  assert.equal(await P.sourceHash([reparsed]), originalHash);
  assert.deepEqual(Array.from(reparsed.translations.English), [repairText + '\\n']);
  assert.equal(Object.hasOwn(reparsed, 'importRepairs'), false, 'Export emits a valid single-line entry');
  assert.equal(JSON.stringify(P.manifest([original])).includes('importRepairs'), false, 'Repair reporting is not source identity');
  for (const changed of [escapedSource.replace('faster', 'slower'), escapedSource.replace('\\n"', '"')]) {
    assert.notEqual(await P.sourceHash([f.parse(changed, true, repairPath)]), originalHash,
      'Changing English text or deleting its line break must change source identity');
  }
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
// Small standards-conforming ZIP fixtures, using only Node built-ins. The test
// extractor supplies the same decoded-entry async interface as browser JSZip.
function zip(entries, compressed, timestamp) {
  const locals = [], central = []; let offset = 0;
  for (const [filename, text] of entries) {
    const name = Buffer.from(filename), raw = Buffer.from('\ufeff' + text, 'utf16le');
    const data = compressed ? deflateRawSync(raw) : raw; const crc = crc32(raw);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
    header.writeUInt16LE(compressed ? 8 : 0, 8); header.writeUInt16LE(timestamp, 10); header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18); header.writeUInt32LE(raw.length, 22); header.writeUInt16LE(name.length, 26);
    locals.push(header, name, data);
    const record = Buffer.alloc(46); record.writeUInt32LE(0x02014b50); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6);
    record.writeUInt16LE(compressed ? 8 : 0, 10); record.writeUInt16LE(timestamp, 12); record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(data.length, 20); record.writeUInt32LE(raw.length, 24); record.writeUInt16LE(name.length, 28); record.writeUInt32LE(offset, 42);
    central.push(record, name); offset += header.length + name.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
function entriesFromZip(bytes) {
  const entries = []; let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const method = bytes.readUInt16LE(offset + 8), length = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26), extra = bytes.readUInt16LE(offset + 28);
    const filename = bytes.subarray(offset + 30, offset + 30 + nameLength).toString();
    const start = offset + 30 + nameLength + extra, data = bytes.subarray(start, start + length);
    entries.push([filename, { async: async type => { assert.equal(type, 'uint8array'); return method === 8 ? inflateRawSync(data) : data; } }]);
    offset = start + length;
  }
  return entries;
}

test('repacked UTF-16LE archives hash identically despite ordering, compression, timestamps and translated text', async () => {
  const f = fixture();
  const entries = [['source/a.txt', source], ['source/b.txt', f.dummy[2]]];
  const original = zip(entries, false, 10);
  const repacked = zip([[entries[1][0], entries[1][1]], [entries[0][0], source.replace('หนึ่ง {0}', 'new translated content {0}')]], true, 32000);
  assert.notEqual(original.toString('hex'), repacked.toString('hex'));
  const parseArchive = bytes => Promise.all(entriesFromZip(bytes).map(([filename, entry]) => f.parseFile(filename, entry)));
  assert.equal(await P.sourceHash(await parseArchive(original)), await P.sourceHash(await parseArchive(repacked)));
  const modifiedSource = zip([[entries[0][0], source.replace('First {0}', 'Changed source {0}')], entries[1]], true, 32000);
  assert.notEqual(await P.sourceHash(await parseArchive(original)), await P.sourceHash(await parseArchive(modifiedSource)));
});
