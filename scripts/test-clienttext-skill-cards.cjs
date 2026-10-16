'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const Cards = require('../public/clientTextSkillCards.js');
const State = require('../public/clientTextState.js');
const clone = value => JSON.parse(JSON.stringify(value));

// Entirely synthetic content; no extracted game text or translations are shipped here.
function fixture() {
    const units = [], scope = { accountId: 'test-owner', game: 'poe2', branchId: 'default', groupId: 'test-source', language: 'TestLanguage', accessKey: 'session-1' };
    function ref(sheet, recordId, name, source, target = 'Translated ' + source) {
        let unit = units.find(unit => unit.sheet === sheet && unit.recordId === recordId);
        if (!unit) {
            unit = { id: JSON.stringify(['normal', sheet, recordId]), role: 'normal', sheet, recordId, fields: [] };
            units.push(unit);
        }
        unit.fields.push({ id: JSON.stringify([name, null]), name, kind: 'text', source, target });
        return { sheet, recordId, field: name, source, sourceHash: State.sourceHash(source) };
    }
    const card = { id: 'example', activeSkillId: 'example_skill', baseItemId: 'ExampleGem',
        title: ref('ActiveSkills', 'example_skill', 'DisplayName', 'Example ability'),
        itemTitle: ref('BaseItemTypes', 'ExampleGem', 'Display Name', 'Example gem'),
        description: ref('ActiveSkills', 'example_skill', 'Description', 'An example [ExampleTag|tagged] description.'),
        shortDescription: ref('ActiveSkills', 'example_skill', 'Short Description', 'Brief example.'),
        tags: [{ position: 'type', ref: ref('GemTags', 'example_type', 'Display Name', '[ExampleTag]') },
            { position: 'tag', ref: ref('GemTags', 'other_type', 'Display Name', '[OtherTag|Other]') }],
        tabs: [{ id: 'first', label: ref('GrantedEffectLabels', 'FirstLabel', 'LabelString', 'First mode'),
            lines: [{ id: 'example-line', filepath: 'example/line.txt', entryIndex: 0, stats: ['example_stat'], sourceHash: State.sourceHash('Example amount {0}.') }] }],
        qualityLabel: ref('ClientStrings', 'ExampleQualityLabel', 'Text', 'Example bonus:'),
        qualityLines: [{ id: 'example-bonus', filepath: 'example/bonus.txt', entryIndex: 0, stats: ['bonus_stat'], sourceHash: State.sourceHash('Example bonus {0}%.') }],
        footer: ref('ClientStrings', 'ExampleFooter', 'Text', 'Example footer.'),
        examples: { level: ref('ClientStrings', 'ExampleLevel', 'Text', 'Level'),
            quality: ref('ClientStrings', 'ExampleQuality', 'Text', '[ExampleQuality]'),
            cost: ref('ClientStrings', 'ExampleCost', 'Text', 'Cost'),
            criticalChance: ref('ClientStrings', 'ExampleCritical', 'Text', '[ExampleCritical|Critical Hit] Chance'),
            costFormat: ref('ClientStrings', 'ExampleCostFormat', 'Text', '{0} Example resource', 'Test resource {0}') },
        assets: { id: 'example', icon: true, background: true } };
    const catalog = { schemaVersion: 1, game: 'poe2', revision: 'synthetic-1', clientBuild: '12345', sdArchiveHash: 'a'.repeat(64), cards: [card] };
    const sd = { accountId: scope.accountId, game: scope.game, language: scope.language, archiveHash: catalog.sdArchiveHash,
        files: [{ filepath: 'example/line.txt', stats: ['example_stat'], translations: { English: ['Example amount {0}.'], TestLanguage: ['Test amount {0}.'] } },
            { filepath: 'example/bonus.txt', stats: ['bonus_stat'], translations: { English: ['Example bonus {0}%.'], TestLanguage: ['Test bonus {0}%.'] } }] };
    return { units, scope, catalog, card, sd, unit: units[0], ref };
}
function compose(f, options = {}) {
    return Cards.createResolver(f.catalog, f.units, f.scope).compose({ scope: f.scope, unit: f.unit, sd: f.sd, ...options });
}

test('browser and CommonJS expose the same API without network or DOM work', () => {
    const browser = { ClientTextState: State };
    vm.runInNewContext(fs.readFileSync(require.resolve('../public/clientTextSkillCards.js'), 'utf8'), browser);
    assert.equal(browser.ClientTextSkillCards.SCHEMA_VERSION, 1);
    const f = fixture();
    assert.equal(browser.ClientTextSkillCards.createResolver(f.catalog, f.units, f.scope).compose({ scope: f.scope, unit: f.unit }).skillId, 'example');
});

test('composes distinct English and translated cards using actual field identities', () => {
    const f = fixture(), before = clone(f), result = compose(f);
    assert.equal(result.state, 'ready');
    assert.equal(result.source.title.text, 'Example ability');
    assert.equal(result.target.title.text, 'Translated Example ability');
    assert.equal(result.source.description.text, f.card.description.source);
    assert.deepEqual(result.source.tags.map(tag => tag.position), ['type', 'tag']);
    assert.equal(result.target.tabs[0].lines[0].text, 'Test amount {0}.');
    assert.equal(result.source.tabs[0].lines[0].text, 'Example amount {0}.');
    assert.equal(result.target.qualityLines[0].text, 'Test bonus {0}%.');
    assert.deepEqual(result.compatibility, { matched: 3, total: 3 });
    assert.deepEqual(clone(f), before, 'No original, draft, catalog or SD record is changed');
});

test('saved values and same-scope current draft override targets, including an intentional blank', () => {
    const f = fixture(), title = f.unit.fields[0], description = f.unit.fields[1], values = { [title.id]: '', [description.id]: 'Current [ExampleTag|draft]' };
    const result = compose(f, { fieldId: description.id, saved: { [f.unit.id]: { values: { [title.id]: 'Saved title', [description.id]: 'Saved description' } } },
        draft: { scope: f.scope, unitId: f.unit.id, values } });
    assert.equal(result.target.title.text, '');
    assert.equal(result.target.title.available, false);
    assert.equal(result.target.description.text, values[description.id]);
    assert.equal(result.target.description.focused, true);
    assert.equal(result.source.description.text, f.card.description.source);
    assert.equal(compose(f, { saved: { [f.unit.id]: { values: { [title.id]: 'Saved title' } } } }).target.title.text, 'Saved title');
});

test('drafts from another row, account, language, source or access epoch never enter the card', () => {
    const f = fixture(), field = f.unit.fields[0];
    const drafts = [{ scope: f.scope, unitId: 'another-unit', values: { [field.id]: 'Wrong' } },
        ...['accountId', 'language', 'groupId', 'accessKey'].map(key => ({ scope: { ...f.scope, [key]: 'other' }, unitId: f.unit.id, values: { [field.id]: 'Wrong' } }))];
    for (const draft of drafts) assert.equal(compose(f, { draft }).target.title.text, field.target);
});

test('captured scope prevents stale rendering across account, game, language, source and access switches', () => {
    const f = fixture(), resolver = Cards.createResolver(f.catalog, f.units, f.scope);
    for (const key of ['accountId', 'game', 'language', 'groupId', 'branchId', 'accessKey', 'sourceHash']) {
        assert.equal(resolver.compose({ scope: { ...f.scope, [key]: 'different' }, unit: f.unit }).reason, 'scope-changed');
    }
    const captured = clone(f.scope);
    f.scope.language = 'Changed';
    assert.equal(resolver.compose({ scope: captured, unit: f.unit, sd: f.sd }).target.tabs[0].lines[0].text, 'Test amount {0}.');
    assert.equal(resolver.compose({ scope: f.scope, unit: f.unit }).reason, 'scope-changed');
    assert.equal(Cards.createResolver(f.catalog, f.units, {}).compose({ scope: {}, unit: f.unit }).reason, 'scope-changed');
});

test('exact gem identity selects its item title and same-name unrelated records remain unmapped', () => {
    const f = fixture(), gem = f.units.find(unit => unit.sheet === 'BaseItemTypes');
    assert.equal(compose(f, { unit: gem }).source.title.text, 'Example gem');
    const other = { ...gem, id: 'unrelated', recordId: 'UnrelatedSameNameGem' };
    f.units.push(other);
    assert.equal(compose(f, { unit: other }).reason, 'unmapped');
    assert.equal(compose(f, { unit: { ...f.unit, role: 'gender' } }).reason, 'unmapped');
});

test('changed primary English rejects the relationship rather than showing outdated client content', () => {
    for (const refName of ['title', 'itemTitle', 'description']) {
        const f = fixture(), ref = f.card[refName], unit = f.units.find(unit => unit.sheet === ref.sheet && unit.recordId === ref.recordId);
        unit.fields.find(field => field.name === ref.field).source += ' changed';
        assert.equal(compose(f).reason, 'source-mismatch');
    }
});

test('partial workbooks retain verified context, label English provenance, and never invent translations', () => {
    const f = fixture(); f.units = [f.unit];
    const result = compose(f);
    assert.equal(result.state, 'partial');
    assert.ok(result.warnings.includes('partial-workbook'));
    assert.equal(result.source.tags[0].text, '[ExampleTag]');
    assert.equal(result.source.tags[0].origin, 'client-catalog');
    assert.equal(result.target.tags[0].text, '');
    assert.equal(result.target.tags[0].available, false);
    assert.equal(result.target.title.origin, 'workbook');
});

test('changed related label is omitted in both languages without hiding the matched card', () => {
    const f = fixture(), tag = f.units.find(unit => unit.sheet === 'GemTags'); tag.fields[0].source = 'New tag version';
    const result = compose(f);
    assert.equal(result.state, 'partial');
    assert.equal(result.source.tags[0].text, '');
    assert.equal(result.target.tags[0].text, '');
    assert.ok(result.warnings.includes('reference-source-mismatch'));
});

test('ambiguous workbook records and conflicting primary fields cannot silently pick a source', () => {
    const f = fixture(); f.units.push(clone(f.unit));
    assert.equal(compose(f).reason, 'ambiguous-source');
    const next = fixture(); next.unit.fields.push(clone(next.unit.fields[0]));
    assert.equal(compose(next).reason, 'ambiguous-source');
});

test('shared tags require an explicit related skill choice when several cards reference them', () => {
    const f = fixture(), second = clone(f.card); second.id = 'example-two'; f.catalog.cards.push(second);
    const tag = f.units.find(unit => unit.sheet === 'GemTags');
    assert.deepEqual(compose(f, { unit: tag }).candidates, ['example', 'example-two']);
    assert.equal(compose(f, { unit: tag, cardId: second.id }).skillId, second.id);
    assert.equal(compose(f, { unit: tag, cardId: 'unknown' }).reason, 'unmapped');
});

test('SD lines require the exact immutable ZIP and matching account, game and language', () => {
    const f = fixture();
    for (const sd of [null, { ...f.sd, archiveHash: 'b'.repeat(64) }, ...['accountId', 'game', 'language'].map(key => ({ ...f.sd, [key]: 'different' }))]) {
        const result = compose(f, { sd });
        assert.deepEqual(result.source.tabs[0].lines, []);
        assert.deepEqual(result.target.tabs[0].lines, []);
        assert.equal(result.target.qualityLabel, null);
        assert.ok(result.warnings.includes('stat-source-unavailable'));
    }
});

test('SD fingerprint, stat identities and duplicate file paths guard against wrong line selection', () => {
    for (const alter of [file => file.translations.English[0] = 'Changed wording', file => file.stats = ['wrong_stat']]) {
        const f = fixture(); alter(f.sd.files[0]);
        const result = compose(f);
        assert.deepEqual(result.source.tabs[0].lines, []);
        assert.ok(result.warnings.includes('stat-source-mismatch'));
    }
    const f = fixture(); f.sd.files.push(clone(f.sd.files[0]));
    assert.deepEqual(compose(f).source.tabs[0].lines, []);
});

test('missing SD translation remains blank while English and raw variables remain intact', () => {
    const f = fixture(); delete f.sd.files[0].translations.TestLanguage;
    const result = compose(f);
    assert.equal(result.source.tabs[0].lines[0].text, 'Example amount {0}.');
    assert.equal(result.target.tabs[0].lines[0].text, '');
    assert.equal(result.target.tabs[0].lines[0].available, false);
    assert.ok(!JSON.stringify(result).includes('damageValue'), 'No runtime numeric defaults are introduced');
});

test('catalog validation rejects unsupported schemas, mismatched fingerprints, unsafe paths and invalid identity joins', () => {
    for (const alter of [f => f.catalog.schemaVersion = 2, f => f.catalog.game = 'poe1', f => f.card.title.sourceHash = 'b'.repeat(64),
        f => f.card.description.recordId = 'other', f => f.card.tabs[0].lines[0].filepath = '../private.txt',
        f => f.card.tabs[0].lines[0].entryIndex = -1, f => f.card.assets.id = 'https://external.example/image',
        f => f.catalog.cards.push(clone(f.card))]) {
        const f = fixture(); alter(f);
        assert.throws(() => Cards.validateCatalog(f.catalog), error => error.code === 'SKILL_CARD_CATALOG_INVALID');
    }
});

test('requested preview examples start at level 1, quality +10%, cost 5 and critical chance 7.00%', () => {
    const result = compose(fixture());
    assert.deepEqual(result.source.properties.map(property => property.text), ['1', '+10%', '5 Example resource', '7.00%']);
    assert.equal(result.target.properties[2].text, 'Test resource 5');
    assert.equal(result.source.properties[1].label.text, '[ExampleQuality]');
    assert.equal(result.source.properties[3].label.text, '[ExampleCritical|Critical Hit] Chance');
    assert.deepEqual(result.variableKeys, Cards.EXAMPLE_KEYS);
    assert.equal(Cards.defaultExampleValue('skill-card:critical-chance'), '7.00');
    assert.equal(Cards.defaultExampleValue('ordinary-template-variable'), undefined);
});

test('editing and resetting example variables changes only rendered sample data', () => {
    const f = fixture(), before = clone(f), values = { ...Cards.exampleDefaults(), '0': 'Other template value',
        'skill-card:level': '6', 'skill-card:quality': '15', 'skill-card:cost': '8', 'skill-card:critical-chance': '12.5' };
    const result = compose(f, { variables: values });
    assert.deepEqual(result.source.properties.map(property => property.text), ['6', '+15%', '8 Example resource', '12.50%']);
    assert.deepEqual(clone(f), before);
    assert.equal(values['skill-card:critical-chance'], '12.5', 'Formatting does not rewrite an input model');
    const reset = Cards.resetExamples(values);
    assert.equal(reset['0'], 'Other template value');
    assert.equal(reset['skill-card:level'], '1');
    assert.equal(values['skill-card:level'], '6');
    assert.deepEqual(compose(f, { variables: reset }).source.properties.map(property => property.text), ['1', '+10%', '5 Example resource', '7.00%']);
    const fresh = Cards.exampleDefaults(); fresh['skill-card:level'] = '50';
    assert.equal(Cards.exampleDefaults()['skill-card:level'], '1');
});

test('example input validation rejects markup, non-finite, out-of-range and fractional level values', () => {
    const values = { 'skill-card:level': '1.5', 'skill-card:quality': '<img onerror=alert(1)>',
        'skill-card:cost': 'Infinity', 'skill-card:critical-chance': '101' };
    const result = compose(fixture(), { variables: values });
    assert.deepEqual(result.exampleValues, Cards.exampleDefaults());
    assert.deepEqual(result.invalidExampleKeys, Cards.EXAMPLE_KEYS);
    assert.ok(!JSON.stringify(result.source.properties).includes('<img'));
    assert.equal(Cards.normalizeExamples({ 'skill-card:critical-chance': '0.25' }).values['skill-card:critical-chance'], '0.25');
    assert.equal(Cards.normalizeExamples({ 'skill-card:quality': '-5' }).values['skill-card:quality'], '-5');
});

test('related-row drafts stay scoped, preserve intentional blanks and yield to the live field draft', () => {
    const f=fixture(),item=f.units.find(unit=>unit.sheet==='BaseItemTypes'),field=item.fields[0];
    const drafts={[f.unit.id]:{scope:f.scope,unitId:f.unit.id,values:{[f.unit.fields[1].id]:'Checkpointed description'}},
        [item.id]:{scope:f.scope,unitId:item.id,values:{[field.id]:''}}};
    const result=compose(f,{unit:item,drafts});assert.equal(result.target.title.text,'');assert.equal(result.target.description.text,'Checkpointed description');
    assert.equal(compose(f,{unit:item,drafts,draft:{scope:f.scope,unitId:item.id,values:{[field.id]:'Live title'}}}).target.title.text,'Live title');
    drafts[f.unit.id].scope={...f.scope,accountId:'another'};assert.notEqual(compose(f,{unit:item,drafts}).target.description.text,'Checkpointed description');
});

test('edit references resolve only exact current workbook fields and matched scoped identities', () => {
    const f=fixture(),resolver=Cards.createResolver(f.catalog,f.units,f.scope),ref=f.card.description;
    assert.equal(resolver.resolveReference(ref,f.scope).unit,f.unit);assert.equal(resolver.resolveReference(ref,f.scope).field.name,'Description');
    assert.equal(resolver.resolveReference(ref,{...f.scope,sourceHash:'other'}),null);assert.equal(resolver.resolveReference({...ref,field:'Other'},f.scope),null);
    f.unit.fields.find(field=>field.name==='Description').source='Changed source';assert.equal(resolver.resolveReference(ref,f.scope),null);
    assert.ok(resolver.referencedUnits(f.card.id).includes(f.unit),'the unchanged verified title still references this unit');
});
