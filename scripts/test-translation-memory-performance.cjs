const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const TM = require('../public/translationMemory.js');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const codec = require('../public/statDescCodec.js');

(async () => {
  if (process.argv[2]) { await realCorpus(process.argv[2], process.argv[3] || 'Thai'); return; }
  const count = Number(process.env.TM_PERF_UNITS || 100000);
  const families = ['Fire', 'Cold', 'Lightning', 'Chaos', 'Physical'];
  const units = Array.from({ length: count }, (_, index) => ({ id: 'tm-' + String(index).padStart(6, '0'), gameScope: 'poe1',
    source: `Attacks deal {0}% increased [${families[index % families.length]}] Damage for ${index} seconds`,
    target: `การโจมตี สร้างความเสียหาย [${families[index % families.length]}|ธาตุ] เพิ่มขึ้น {0}% เป็นเวลา ${index} วินาที`,
    context: { filepath: `stats/${index}.txt`, stats: ['damage_' + index], condition: '#', remarks: '', entryIndex: 0 } }));
  let yields = 0;
  const schedule = callback => { yields++; setImmediate(callback); };
  const started = performance.now();
  const index = await TM.buildIndex(units, { game: 'poe1', generation: 1, schedule });
  const built = performance.now(), query = { source: units[Math.floor(count / 2)].source, context: units[Math.floor(count / 2)].context };
  const exact = await TM.search(index, query, { schedule }); const exactFinished = performance.now();
  assert.equal(exact[0].score, 101);
  const fuzzy = await TM.search(index, { source: query.source.replace('increased', 'reduced'), context: query.context }, { schedule });
  const fuzzyFinished = performance.now(); assert.ok(fuzzy.length); assert.ok(fuzzy[0].warnings.some(warning => warning.code === 'meaning'));
  assert.ok(yields > 0, 'Large preparation must yield cooperatively.');
  const heapBeforeGC = process.memoryUsage().heapUsed;
  global.gc?.();
  console.log(JSON.stringify({ units: count, distinctSources: index.groups.length,
    buildMs: Math.round(built - started), exactQueryMs: Math.round(exactFinished - built), fuzzyQueryMs: Math.round(fuzzyFinished - exactFinished),
    cooperativeYields: yields, heapBeforeGCMiB: Math.round(heapBeforeGC / 1048576), heapMiB: Math.round(process.memoryUsage().heapUsed / 1048576),
    fuzzyScores: fuzzy.map(match => match.score) }));
})().catch(error => { console.error(error); process.exitCode = 1; });

async function realCorpus(zipPath, language) {
  const { parseArchive } = await import(pathToFileURL(path.resolve(__dirname, '../../SDEditor-API/src/version-codec.js')));
  let parsed = await parseArchive(fs.readFileSync(zipPath), { language });
  assert.deepEqual(parsed.validation.errors, [], 'The benchmark archive must parse without source errors.');
  let decisions = [];
  if (!parsed.files && parsed.duplicateGroups.length) {
    // Benchmark-only deterministic selection. This is never imported or written
    // to user storage; actual import still requires its agreed duplicate choices.
    decisions = parsed.duplicateGroups.map(group => ({ filepath: group.filepath, language: group.lang,
      occurrence: group.options[0].occurrence, blockHash: group.options[0].blockHash }));
    parsed = await parseArchive(fs.readFileSync(zipPath), { language, decisions });
  }
  assert.ok(parsed.files?.length, 'The benchmark requires a complete parsed archive.');
  const game = codec.detectGameVersionFromFilepaths(parsed.files.map(file => file.filepath));
  const archive = { fileCount: parsed.archive.fileCount, descriptionCount: parsed.files.length,
    duplicateBenchmarkChoices: decisions.length, repairs: parsed.validation.repairs.length, baselineId: parsed.archive.baselineId };
  const units = [];
  let entries = 0, nonblankTargets = 0;
  for (const desc of parsed.files) {
    entries += desc.translations.English.length;
    const targets = desc.translations[language] || [];
    nonblankTargets += targets.filter(value => String(value).trim()).length;
    units.push(...TM.unitsFromDescription(desc, targets, language, { game, filepath: desc.filepath,
      sourceHash: parsed.archive.baselineId, origin: 'benchmark' }));
  }
  parsed = null;
  units.forEach((unit, ordinal) => { unit.id = 'real-' + String(ordinal).padStart(6, '0'); });
  let yields = 0; const schedule = callback => { yields++; setImmediate(callback); };
  const started = performance.now(), index = await TM.buildIndex(units, { game, schedule });
  const built = performance.now(), queries = [];
  const add = (name, unit, source = unit?.source) => { if (unit) queries.push({ name, source, context: unit.context, game }); };
  add('exact', units[Math.floor(units.length / 2)]);
  const polarity = units.find(unit => /\bincreased\b/i.test(unit.source));
  add('polarity', polarity, polarity?.source.replace(/\bincreased\b/i, 'reduced'));
  const variable = units.find(unit => TM.skeletonFor(unit.source));
  if (variable) {
    const tag = TM.variableTags(variable.source)[0];
    add('variable', variable, variable.source.slice(0, tag.start) + tag.full.replace(/\{\d+\}/, '{99}') + variable.source.slice(tag.end));
  }
  const typo = units.find(unit => /damage/i.test(unit.source));
  add('typo', typo, typo?.source.replace(/damage/i, 'damge'));
  add('short', units.find(unit => Array.from(TM.fuzzyKey(unit.source)).length <= 10));
  add('table', units.find(unit => unit.source.includes('@')));
  add('multiline', units.find(unit => unit.source.includes('\\n')));
  const samples = [];
  for (const query of queries) {
    const before = performance.now(), actual = await TM.search(index, query, { schedule });
    const searched = performance.now(), expected = await exhaustive(index, query);
    const finished = performance.now();
    assert.deepEqual(actual.map(match => [match.id, match.score, match.kind]), expected.map(match => [match.id, match.score, match.kind]), query.name);
    samples.push({ query: query.name, source: query.source, indexedMs: Math.round(searched - before),
      exhaustiveMs: Math.round(finished - searched), scores: actual.map(match => match.score) });
  }
  const heapBeforeGC = process.memoryUsage().heapUsed; global.gc?.();
  console.log(JSON.stringify({ corpus: path.resolve(zipPath), language, game, ...archive, englishEntries: entries,
    nonblankTargets, eligibleUnits: units.length, distinctSources: index.groups.length,
    buildMs: Math.round(built - started), cooperativeYields: yields,
    heapBeforeGCMiB: Math.round(heapBeforeGC / 1048576), heapMiB: Math.round(process.memoryUsage().heapUsed / 1048576), samples }));
}

async function exhaustive(index, query) {
  const results = [], queryContext = TM.canonicalContext(query.context), skeleton = TM.skeletonFor(query.source);
  for (const group of index.groups) {
    const exact = group.source === query.source, score = exact ? 100 : TM.scoreFor(group.source, query.source);
    const mayAdapt = !exact && skeleton && group.skeleton?.key === skeleton.key;
    for (const row of group.units) {
      const sameContext = row.contextKey === queryContext;
      const adapted = mayAdapt ? TM.adaptVariables(group.source, row.unit.target, query.source) : null;
      const value = exact && sameContext ? 101 : adapted ? 99 : score;
      if (value >= 60) results.push({ id: row.identity, unit: row.unit, score: value,
        kind: exact ? sameContext ? 'context' : 'exact' : adapted ? 'adapted' : 'fuzzy', sameContext });
    }
    if (!(group.id % 128)) await new Promise(resolve => setImmediate(resolve));
  }
  return results.sort(TM.compareMatches).slice(0, 5);
}
