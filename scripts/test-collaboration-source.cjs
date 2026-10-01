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
  const context = vm.createContext({ Blob, FileReader, alert: value => alerts.push(value), console });
  for (const filename of ['helper.js', 'statDescParser.js', 'dummyFiles.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../public', filename), 'utf8'), context, { filename });
  }
  return { alerts, parse: (text, strict = true, filename = 'source/test.txt') => context.parseDesc(filename, text, 'Thai', { strict }),
    parseFile: (filename, entry, strict = true) => context.parseFile(filename, entry, 'Thai', { strict }),
    dummy: vm.runInContext('[dummyFile1, dummyFile2, dummyFile3]', context), encode: context.descEncode };
}
const source = `description example\n1 damage\n2\n# "First {0}"\n# "Second" negate 1\nlang "Thai"\n2\n# "หนึ่ง {0}"\n# "สอง"`;

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
