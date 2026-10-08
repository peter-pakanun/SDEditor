const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const codec = require('../public/statDescCodec.js');
const protocol = require('../public/collaborationProtocol.js');

const browserSource = fs.readFileSync(path.join(__dirname, '../public/statDescCodec.js'), 'utf8');
const vendorPath = path.join(__dirname, '../../SDEditor-API/src/vendor/stat-desc-codec.cjs');
const source = 'description test\n1 damage\n1\n# "English 😀" negate 1\nlang "Thai"\n1\n# "ไทย"';
const plain = value => JSON.parse(JSON.stringify(value));
function browser() {
  const context = vm.createContext({ window: {}, crypto: webcrypto, TextEncoder, TextDecoder });
  vm.runInContext(browserSource, context, { filename: 'statDescCodec.js' });
  return context.window.StatDescCodec;
}

test('browser and independently deployed API vendor use byte-identical parser version 1', () => {
  assert.equal(fs.readFileSync(vendorPath, 'utf8'), browserSource);
  const api = require(vendorPath);
  const client = browser();
  assert.equal(api.parserVersion, 1);
  for (const text of [source, source + '\nlang "Thai"\n1\n9 "อีก" different',
    source.replace('"English 😀"', '"English 😀\n"')]) {
    const parsed = codec.parseText('source/test.txt', text, 'Thai', { strict: true });
    assert.deepEqual(plain(client.parseText('source/test.txt', text, 'Thai', { strict: true })), parsed);
    assert.deepEqual(api.parseText('source/test.txt', text, 'Thai', { strict: true }), parsed);
    assert.deepEqual(Buffer.from(client.descEncode(parsed)), Buffer.from(api.descEncode(parsed)));
  }
});

test('browser and API detect the same game from normalized archive paths', () => {
  for (const parser of [codec, browser(), require(vendorPath)]) {
    for (const [paths, game] of [
      [['stat_descriptions/fire.txt', 'specific_skill_stat_descriptions/fireball.txt'], 'poe1'],
      [['specific_skill_stat_descriptions/explosive_grenade.txt'], 'poe2'],
      [['Metadata/StatDescriptions/specific_skill_stat_descriptions/grenade/damage.txt'], 'poe2'],
      [['\\SPECIFIC_SKILL_STAT_DESCRIPTIONS\\EXPLOSIVE_GRENADE\\damage.txt'], 'poe2'],
    ]) assert.equal(parser.detectGameVersionFromFilepaths(paths), game);
  }
});

test('UTF-16LE encoding retains BOM, all baseline languages, remarks and intentional blanks', () => {
  const parsed = codec.parseText('source/test.txt', source, 'Thai', { strict: true });
  parsed.translations.Thai = [''];
  parsed.translations.German = ['Deutsch'];
  const bytes = codec.descEncode(parsed);
  assert.deepEqual([...bytes.slice(0, 2)], [0xff, 0xfe]);
  assert.equal(codec.decodeUTF16(bytes), Buffer.from(bytes).toString('utf16le').replace(/^\uFEFF/, ''));
  const reparsed = codec.parseText(parsed.filepath, codec.decodeUTF16(bytes), 'Thai', { strict: true });
  assert.deepEqual(reparsed.translations, { English: ['English 😀'], Thai: [''], German: ['Deutsch'] });
  assert.deepEqual(reparsed.remarks, ['negate 1']);
  assert.equal(reparsed.isMissing, true);
  assert.equal(codec.decodeUTF16(Uint8Array.from([0xff, 0xfe, 0x61, 0, 0x62])), 'a\ufffd');
  assert.throws(() => codec.decodeUTF16('text'), /bytes are required/);
});

test('canonical duplicate decisions fingerprint complete blocks and preserve original parsing', async () => {
  const raw = [codec.parseText('source/test.txt', source + '\nlang "Thai"\n1\n9 "อีก" translated_only\nlang "English"\n1\n8 "[DNT] Alternate" alternate_remark', 'Thai', { strict: true })];
  const before = structuredClone(raw);
  const groups = codec.collectDuplicateLangGroups(raw);
  const decisions = await Promise.all(groups.map(async group => {
    const selected = group.options[1];
    const hash = await codec.blockHash(selected);
    assert.equal(hash, await protocol.blockHash(selected));
    return { filepath: group.filepath, language: group.lang, occurrence: selected.occurrence, blockHash: hash };
  }));
  const selected = await codec.applyDuplicateSelections(raw, decisions, { language: 'Thai' });
  assert.deepEqual(raw, before);
  assert.deepEqual(selected[0].translations, { English: ['[DNT] Alternate'], Thai: ['อีก'] });
  assert.deepEqual(selected[0].variables, ['8']);
  assert.deepEqual(selected[0].remarks, ['alternate_remark']);
  assert.equal(selected[0].isDNT, true);
  assert.equal(selected[0].duplicateLangEntries.some(item => item.lang === 'English'), false);
  assert.doesNotThrow(() => protocol.manifest(selected));
  const api = require(vendorPath);
  assert.deepEqual(await api.applyDuplicateSelections(raw, decisions, { language: 'Thai' }), selected);
  assert.deepEqual(plain(await browser().applyDuplicateSelections(raw, decisions, { language: 'Thai' })), selected);
  await assert.rejects(codec.applyDuplicateSelections(raw, []), /decisions do not match/);
  await assert.rejects(codec.applyDuplicateSelections(raw, decisions.map(item => ({ ...item, blockHash: '0'.repeat(64) }))), /does not match the original ZIP/);
  await assert.rejects(codec.applyDuplicateSelections(raw, [decisions[0], decisions[0]]), /Duplicate archive decision/);
  const altered = structuredClone(raw);
  altered[0].duplicateLangGroups[0].options[1].variables = ['10'];
  await assert.rejects(codec.applyDuplicateSelections(altered, decisions), /does not match the original ZIP/);
});

test('the narrow adjacent quote repair retains its fixed fixture hash and export identity', async () => {
  const filepath = 'stat_descriptions/ignite_faster_burn_%_applies_to_ignite_proliferation_delay_ms.txt';
  const content = '[DNT] Modifiers which make [Ignite] deal damage faster also lower the delay before it spreads';
  const text = `description\n1 ignite_faster_burn_%_applies_to_ignite_proliferation_delay_ms\n1\n# "${content}\n"`;
  const parsed = codec.parseText(filepath, text, 'Thai', { strict: true });
  const sourceHash = await protocol.sourceHash([parsed]);
  assert.equal(sourceHash, 'e97cf562b99a79953a2852d5c36e0666699b2ccc6ba97b57a0379f87aaca811e');
  const exported = codec.parseText(filepath, codec.decodeUTF16(codec.descEncode(parsed)), 'Thai', { strict: true });
  assert.equal(await protocol.sourceHash([exported]), sourceHash);
  assert.deepEqual(protocol.witness(exported), protocol.witness(parsed));
  assert.equal(Object.hasOwn(exported, 'importRepairs'), false);
});

test('strict errors and auxiliary text remain deterministic without DOM or alert dependencies', () => {
  const client = browser();
  for (const parser of [codec, client, require(vendorPath)]) {
    assert.equal(parser.parseText('source/include.txt', 'include "other.txt"', 'Thai', { strict: true }), false);
    assert.throws(() => parser.parseText('source/test.txt', source + '\n description another', 'Thai', { strict: true }), /Multiple descriptions in source\/test.txt/);
    assert.throws(() => parser.parseText('source/test.txt', source.replace('1 damage', '2 damage'), 'Thai', { strict: true }), /declared stat count/);
    assert.throws(() => parser.parseDesc('source/test.txt', 'description', 'Thai', { strict: true }), /description must include/);
    assert.equal(parser.parseDesc('source/test.txt', 'malformed', 'Thai'), false);
  }
});
