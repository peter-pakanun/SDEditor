'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const Cards = require('../public/clientTextSkillCards.js'), State = require('../public/clientTextState.js');
const clone = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };
function harness() {
    const units = [];
    function ref(sheet, recordId, name, source) {
        let unit = units.find(unit => unit.sheet === sheet && unit.recordId === recordId);
        if (!unit) { unit = { id: JSON.stringify(['normal', sheet, recordId]), role: 'normal', sheet, recordId, fields: [] }; units.push(unit); }
        if (!unit.fields.some(field => field.name === name)) unit.fields.push({ id: JSON.stringify([name, null]), name, kind: 'text', source, target: 'Target ' + source });
        return { sheet, recordId, field: name, source, sourceHash: State.sourceHash(source) };
    }
    const tag = ref('GemTags', 'shared-type', 'Display Name', '[SyntheticType]');
    function card(id) {
        return { id, activeSkillId: id + '-skill', baseItemId: id + '-gem',
            title: ref('ActiveSkills', id + '-skill', 'DisplayName', id + ' ability'),
            itemTitle: ref('BaseItemTypes', id + '-gem', 'Display Name', id + ' item'),
            description: ref('ActiveSkills', id + '-skill', 'Description', id + ' description'),
            shortDescription: ref('ActiveSkills', id + '-skill', 'Short Description', id + ' brief description'),
            tags: [{ position: 'type', ref: tag }], tabs: [], examples: {
                level: ref('ClientStrings', 'level-label', 'Text', 'Example level'),
                quality: ref('ClientStrings', 'quality-label', 'Text', 'Example quality'),
                cost: ref('ClientStrings', 'cost-label', 'Text', 'Example cost'),
                criticalChance: ref('ClientStrings', 'critical-label', 'Text', 'Example critical chance'),
                costFormat: ref('ClientStrings', 'cost-format', 'Text', '{0} Example resource') } };
    }
    const alpha = card('alpha'), beta = card('beta');
    const catalog = { schemaVersion: 1, game: 'poe2', revision: 'synthetic-navigation', clientBuild: '12345', cards: [beta, alpha] };
    const window = { ClientTextSkillCards: Cards, ClientTextState: State, ClientTextStore: { scopeKey: Cards.scopeKey } };
    vm.runInNewContext(fs.readFileSync(require.resolve('../public/clientTextSkillCardUi.js'), 'utf8'), { window, AbortController });
    vm.runInNewContext(fs.readFileSync(require.resolve('../public/clientTextUi.js'), 'utf8'), { window, setTimeout, clearTimeout });
    const mixin = window.ClientTextSkillCardUI.mixin, navigation = window.ClientTextUI.mixin.methods;
    const scope = { accountId: 'alice', game: 'poe2', branchId: 'default', groupId: 'source1', language: 'Thai' };
    const primary = units.find(unit => unit.recordId === alpha.activeSkillId), item = units.find(unit => unit.recordId === alpha.baseItemId);
    const calls = { browse: 0, select: [], focus: [], writes: [], reads: [], comments: 0, order: [] }, drafts = new Map();
    const app = { ...mixin.data(), ctSkillCatalog: catalog, ctUnits: units, ctWorkspace: { scope }, privateMediaKey: 'alice:Thai:source1:access1',
        privateMediaAllowed: true, ctActive: true, gameVersion: 'poe2', ctSelection: primary.id, ctEditor: true, ctBusy: false, ctBrowseBusy: false,
        ctSaved: {}, ctValues: { [primary.fields[0].id]: 'Unsaved title', [primary.fields[1].id]: 'Unsaved description' },
        ctReviewed: {}, ctDraftDirty: true, ctDraftStageFailure: null, _ctEpoch: 1, _ctUnitIndex: new Map(units.map(unit => [unit.id, unit])),
        ctRows: units, ctEffectivePageSize: 2, ctPreviewField: primary.fields[1], ctPreviewGggVars: {}, ctRevision: 0,
        ctBrowseMode: 'npcs', ctSheet: 'old-sheet', ctSearch: 'old search', ctAppliedSearch: 'old search', ctFilter: 'old filter',
        ctSelectedFilters: ['missing'], ctPage: 7, ctTool: 'dictionary', ctError: '',
        $nextTick: async () => {}, ctKeyboardOverlayOpen: () => false,
        ctContext() { return { scope: clone(this.ctWorkspace.scope), epoch: this._ctEpoch }; },
        ctCurrent(context) { return context.epoch === this._ctEpoch && Cards.scopeKey(context.scope) === Cards.scopeKey(this.ctWorkspace.scope); },
        ctStorage() { return { putDraft: async (scope, id, draft) => { calls.order.push('checkpoint'); calls.writes.push({ scope: clone(scope), id, draft: clone(draft) }); drafts.set(id, clone(draft)); return { revision: 'draft-1' }; },
            getDraft: async (scope, id) => { calls.order.push('read-target'); calls.reads.push({ scope: clone(scope), id }); return drafts.get(id) || null; } }; },
        ctFlushCommentDraft: async () => { calls.comments++; return true; },
        ctFocusTarget: (last, fieldId) => { calls.order.push('focus'); calls.focus.push({ last, fieldId }); return true; },
        ctDisplayedFields: unit => unit.fields, ctTabFields: unit => unit.fields,
        ctRefreshLayout() {}, ctRestoreBrowseScroll() {}, ctCloseCompletion() {}, ctInitializeVariants() {}, ctResetHistory() {},
        ctLoadHistory() {}, ctPresence() {}, scheduleClientTextDictionaryMatches() {}, ctRefreshDraftSummaries() {}, ctLoadCommentDraft() {} };
    Object.defineProperty(app, 'ctCurrentUnit', { get: () => app._ctUnitIndex.get(app.ctSelection) });
    for (const [name, method] of Object.entries(mixin.methods)) app[name] = method.bind(app);
    for (const [name, getter] of Object.entries(mixin.computed)) if (name !== 'ctSkillResolver') Object.defineProperty(app, name, { get: () => getter.call(app) });
    // Vue caches this resolver until catalog/units/scope change. Keep that identity here.
    app.ctSkillResolver = Cards.createResolver(catalog, units, app.ctSkillScope);
    for (const name of ['ctFlushDraft', 'ctRememberDraftStageFailure', 'ctClearDraftStageFailure']) app[name] = navigation[name].bind(app);
    app.ctChangeBrowse = async change => { calls.browse++; return navigation.ctChangeBrowse.call(app, change); };
    app.ctSelect = async (...args) => { calls.select.push(args); return navigation.ctSelect.apply(app, args); };
    const entry = { origin: 'workbook', reference: { sheet: alpha.itemTitle.sheet, recordId: alpha.itemTitle.recordId, field: alpha.itemTitle.field } };
    return { app, calls, drafts, units, catalog, alpha, beta, tag, primary, item, entry, mixin, window, ref };
}
function textControl(h, entry, clickToEdit = false) {
    const component = h.window.ClientTextSkillCardUI.Text, control = { host: h.app, entry, clickToEdit };
    for (const name of ['editable', 'editLabel']) Object.defineProperty(control, name, { get: () => component.computed[name].call(control) });
    control.edit = component.methods.edit.bind(control);
    return control;
}
function clickEvent(changes = {}, keyword = false) {
    return { button: 0, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, defaultPrevented: false, stopped: false,
        target: { closest: selector => keyword && selector === '.gamePreviewKw' ? {} : null },
        preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...changes };
}

test('cross-sheet navigation checkpoints unsaved text, uses guarded ctSelect, then focuses the exact field', async () => {
    const h = harness(), original = clone({ units: h.units, catalog: h.catalog }), outgoing = clone(h.app.ctValues);
    const incoming = { [h.item.fields[0].id]: 'Existing target draft' }; h.drafts.set(h.item.id, { values: incoming, reviewed: {} });
    assert.equal(await h.app.ctSkillEditField(h.entry), true);
    assert.equal(h.calls.browse, 1); assert.equal(h.calls.select.length, 1); assert.equal(h.calls.writes.length, 1);
    assert.deepEqual(h.calls.writes[0].draft.values, outgoing); assert.equal(h.calls.writes[0].id, h.primary.id);
    const [unit, full, options] = h.calls.select[0]; assert.equal(unit, h.item); assert.equal(full, true); assert.equal(options.focus, false); assert.equal(options.guard(), true);
    assert.equal(h.app.ctSelection, h.item.id); assert.equal(h.app.ctBrowseMode, 'sheets'); assert.equal(h.app.ctSheet, JSON.stringify(['normal', 'BaseItemTypes']));
    assert.equal(h.app.ctSearch, ''); assert.equal(h.app.ctFilter, ''); assert.equal(h.app.ctTool, 'preview');
    assert.equal(h.app.ctPage, Math.floor(h.units.indexOf(h.item) / h.app.ctEffectivePageSize) + 1);
    assert.deepEqual(h.calls.focus, [{ last: false, fieldId: h.item.fields[0].id }]); assert.equal(h.app.ctValues[h.item.fields[0].id], incoming[h.item.fields[0].id]);
    assert.ok(h.calls.order.indexOf('checkpoint') < h.calls.order.indexOf('read-target')); assert.equal(h.calls.order.at(-1), 'focus');
    assert.deepEqual(clone({ units: h.units, catalog: h.catalog }), original, 'navigation never modifies workbook originals or catalog');
});

test('failed durable checkpoint leaves selection, browse filters, and outgoing draft intact', async () => {
    const h = harness(), before = clone({ selection: h.app.ctSelection, sheet: h.app.ctSheet, mode: h.app.ctBrowseMode, values: h.app.ctValues });
    h.app.ctStorage = () => ({ putDraft: async () => { throw new Error('Synthetic storage unavailable'); } });
    assert.equal(await h.app.ctSkillEditField(h.entry), false); assert.equal(h.calls.select.length, 0); assert.equal(h.calls.focus.length, 0);
    assert.deepEqual(clone({ selection: h.app.ctSelection, sheet: h.app.ctSheet, mode: h.app.ctBrowseMode, values: h.app.ctValues }), before);
    assert.match(h.app.ctError, /Draft was not stored.*Synthetic storage unavailable/); assert.equal(h.app.ctDraftStageFailure.operation, 'checkpoint');
});

test('scope/account/access changes during draft checkpoint prevent selection and focus', async () => {
    for (const change of [app => app.ctWorkspace.scope.accountId = 'bob', app => app.ctWorkspace.scope.groupId = 'source2',
        app => app.ctWorkspace.scope.language = 'French', app => app.privateMediaKey = 'revoked', app => app._ctEpoch++]) {
        const h = harness(), pending = deferred(), started = deferred(), selected = h.app.ctSelection;
        h.app.ctStorage = () => ({ putDraft: async () => { started.resolve(); await pending.promise; return { revision: 'late-checkpoint' }; } });
        const operation = h.app.ctSkillEditField(h.entry); await started.promise; change(h.app); pending.resolve();
        assert.equal(await operation, false); assert.equal(h.app.ctSelection, selected); assert.equal(h.calls.focus.length, 0);
    }
});

test('account switch while target draft loads prevents publishing the former scope selection', async () => {
    const h = harness(), originalStorage = h.app.ctStorage(), pending = deferred(), started = deferred(), selected = h.app.ctSelection;
    h.app.ctStorage = () => ({ ...originalStorage, getDraft: async () => { started.resolve(); return pending.promise; } });
    const operation = h.app.ctSkillEditField(h.entry); await started.promise; h.app.ctWorkspace.scope.accountId = 'bob'; pending.resolve({ values: { injected: 'old account' } });
    assert.equal(await operation, false); assert.equal(h.app.ctSelection, selected); assert.equal(h.calls.focus.length, 0);
    assert.equal(h.app.ctValues.injected, undefined);
});

test('scope switch after selection but before focus cannot focus the next account editor', async () => {
    const h = harness(), originalSelect = h.app.ctSelect;
    h.app.ctSelect = async (...args) => { const result = await originalSelect(...args); h.app.ctWorkspace.scope.accountId = 'bob'; return result; };
    assert.equal(await h.app.ctSkillEditField(h.entry), false); assert.equal(h.calls.focus.length, 0);
});

test('read-only catalog text, missing/mismatched references and busy navigation refuse without writes', async () => {
    for (const change of [h => h.entry.origin = 'client-catalog', h => h.entry.origin = 'unavailable', h => h.entry.reference.field = 'Missing',
        h => h.item.fields[0].source = 'Unverified replacement', h => h.app.ctBusy = true, h => h.app.ctBrowseBusy = true,
        h => { h.app._ctUnitIndex.delete(h.item.id); h.app.ctSkillResolver = Cards.createResolver(h.catalog, h.units.filter(unit => unit !== h.item), h.app.ctSkillScope); }]) {
        const h = harness(); change(h); assert.equal(await h.app.ctSkillEditField(h.entry), false);
        assert.equal(h.calls.focus.length, 0); assert.equal(h.calls.select.length, 0); assert.equal(h.calls.writes.length, 0);
    }
});

test('plain and Alt+Click on full/short preview names and descriptions focus the exact translation field', async () => {
    for (const side of ['source', 'target']) for (const name of ['title', 'skillTitle', 'description', 'shortDescription']) for (const altKey of [false, true]) {
        const h = harness(), entry = h.app.ctSkillPreviewModel[side][name], text = textControl(h, entry, true), event = clickEvent({ altKey });
        const before = clone(h.app.ctValues);
        assert.equal(await text.edit(event), true); assert.equal(event.defaultPrevented, true); assert.equal(event.stopped, true);
        assert.equal(h.calls.select.length, 1); assert.equal(h.calls.focus.length, 1); assert.equal(h.calls.browse, 0);
        const field = name === 'shortDescription' ? 2 : name === 'description' ? 1 : 0;
        assert.equal(h.calls.focus[0].fieldId, h.primary.fields[field].id);
        assert.equal(h.app.ctWorkspace.scope.language, 'Thai'); assert.deepEqual(h.app.ctValues, before);
        assert.match(text.editLabel, /Click or Alt\+Click.*ActiveSkills \(Thai\)/);
    }
});

test('other mapped text requires Alt+Click and checkpoints the outgoing draft across sheets once', async () => {
    for (const side of ['source', 'target']) {
        const h = harness(), text = textControl(h, h.app.ctSkillPreviewModel[side].tags[0]), plain = clickEvent(), before = clone(h.app.ctValues);
        assert.equal(await text.edit(plain), false); assert.equal(plain.defaultPrevented, false); assert.equal(plain.stopped, false);
        assert.equal(h.calls.select.length, 0); assert.equal(h.calls.writes.length, 0); assert.match(text.editLabel, /^Alt\+Click/);
        const alt = clickEvent({ altKey: true }); assert.equal(await text.edit(alt), true);
        assert.equal(alt.stopped, true); assert.equal(h.calls.select.length, 1); assert.equal(h.calls.focus.length, 1); assert.equal(h.calls.writes.length, 1);
        assert.equal(h.app.ctCurrentUnit.sheet, 'GemTags'); assert.equal(h.calls.focus[0].fieldId, h.app.ctCurrentUnit.fields[0].id);
        assert.deepEqual(h.calls.writes[0].draft.values, before); assert.equal(h.app.ctWorkspace.scope.language, 'Thai');
    }
});

test('ordinary keyword clicks reach the popup handler; Alt+Click captures navigation once in both text categories', async () => {
    for (const clickToEdit of [false, true]) {
        const h = harness(), entry = clickToEdit ? h.app.ctSkillPreviewModel.target.description : h.app.ctSkillPreviewModel.target.tags[0];
        const text = textControl(h, entry, clickToEdit), ordinary = clickEvent({}, true);
        assert.equal(await text.edit(ordinary), false); assert.equal(ordinary.stopped, false); assert.equal(ordinary.defaultPrevented, false);
        assert.equal(h.calls.select.length, 0); assert.equal(h.calls.focus.length, 0);
        const alt = clickEvent({ altKey: true }, true); assert.equal(await text.edit(alt), true);
        assert.equal(alt.stopped, true); assert.equal(alt.defaultPrevented, true);
        assert.equal(h.calls.select.length, 1); assert.equal(h.calls.focus.length, 1);
    }
});

test('unmapped and unavailable text have no edit hint or destination, and unavailable Alt+Click cannot pin a keyword', async () => {
    for (const entry of [undefined, { origin: 'client-catalog', reference: {} }, { origin: 'unavailable', reference: {} },
        { origin: 'workbook', reference: { sheet: 'ActiveSkills', recordId: 'missing', field: 'Description' } }]) {
        const h = harness(), text = textControl(h, entry, true), event = clickEvent({ altKey: true }, true);
        assert.equal(!!text.editable, false); assert.equal(text.editLabel, undefined); assert.equal(await text.edit(event), false);
        assert.equal(event.stopped, !!entry); assert.equal(h.calls.select.length, 0); assert.equal(h.calls.writes.length, 0);
    }
});

test('non-primary buttons, handled clicks and other modifier chords do not trigger workbook navigation', async () => {
    for (const changes of [{ button: 1 }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { defaultPrevented: true },
        { altKey: true, ctrlKey: true }, { altKey: true, metaKey: true }, { altKey: true, shiftKey: true }]) {
        const h = harness(), text = textControl(h, h.app.ctSkillPreviewModel.target.description, true), event = clickEvent(changes);
        assert.equal(await text.edit(event), false); assert.equal(event.stopped, false); assert.equal(h.calls.select.length, 0);
    }
});

test('shared text captures navigation without appended controls and only name/description opt into plain click', () => {
    const h = harness(), { Text, Card } = h.window.ClientTextSkillCardUI;
    assert.match(Text.template, /@click.capture="edit"/); assert.doesNotMatch(Text.template, /<button|skillCardEdit["\s]/);
    const ordinary = [...Card.template.matchAll(/<skill-card-text\b[^>]*click-to-edit[^>]*\/>/g)].map(match => match[0]);
    assert.equal(ordinary.length, 4);
    for (const [index, entry] of ['title', 'description', 'skillTitle', 'shortDescription'].entries()) assert.ok(ordinary[index].includes(':entry="side.' + entry + '"'));
    assert.match(Card.template, /:entry="item.label"/); assert.doesNotMatch(Card.template, /host\.ctSkillEditField/);
});

test('same-unit field focus keeps draft and browse context while using guarded selection', async () => {
    const h = harness(), before = clone(h.app.ctValues), field = h.primary.fields[1];
    h.entry.reference = { sheet: h.primary.sheet, recordId: h.primary.recordId, field: field.name };
    assert.equal(await h.app.ctSkillEditField(h.entry), true);
    assert.equal(h.calls.browse, 0); assert.equal(h.calls.writes.length, 0); assert.equal(h.calls.select.length, 1);
    assert.equal(h.app.ctBrowseMode, 'npcs'); assert.equal(h.app.ctSheet, 'old-sheet'); assert.deepEqual(h.app.ctValues, before);
    assert.deepEqual(h.calls.focus, [{ last: false, fieldId: field.id }]); assert.equal(h.app.ctSkillContextId, 'alpha');
});

test('selecting Short Description keeps both cards available, including without example labels', () => {
    const h = harness(); h.app.ctPreviewField = h.primary.fields[2];
    h.app.ctValues[h.primary.fields[2].id] = 'Live short draft';
    assert.equal(h.app.ctSkillPreviewModel.target.shortDescription.text, 'Live short draft');
    assert.equal(h.app.ctSkillPreviewModel.target.shortDescription.focused, true);
    assert.deepEqual([...h.app.ctSkillVariableKeys], Cards.EXAMPLE_KEYS.filter(key => key !== 'skill-card:time'));
    delete h.alpha.examples;
    h.app.ctSkillResolver = Cards.createResolver(h.catalog, h.units, h.app.ctSkillScope);
    assert.equal(h.app.ctSkillVariableKeys.length, 0);
    assert.equal(h.app.ctSkillPreviewModel.target.shortDescription.text, 'Live short draft');
    assert.deepEqual([...h.app.ctSkillPreviewModel.target.properties], []);
});

test('compact header shares the live Cost example and omits unavailable labels and values', () => {
    const h = harness(), getter = h.window.ClientTextSkillCardUI.Card.computed.shortProperties;
    h.app.ctPreviewGggVars = { 'skill-card:cost': '17' };
    const model = h.app.ctSkillPreviewModel;
    assert.equal(getter.call({ side: model.source })[0].text, '17 Example resource');
    assert.equal(getter.call({ side: model.target })[0].text, 'Target 17 Example resource');
    for (const property of [{ key: 'skill-card:cost', available: false, label: { available: true } },
        { key: 'skill-card:cost', available: true, label: { available: false } }]) {
        assert.equal(getter.call({ side: { shortProperties: [property] } }).length, 0);
    }
});

test('compact-only timing supplies the shared duration control and its translated variable label', () => {
    const h = harness();
    h.ref('ClientStrings', 'SkillPopupUseTime', 'Text', 'Use Time');
    h.ref('ClientStrings', 'SkillPopupCastTimeValue', 'Text', '{0} s');
    h.app.ctSkillResolver = Cards.createResolver(h.catalog, h.units, h.app.ctSkillScope);
    assert.ok(h.app.ctSkillVariableKeys.includes('skill-card:time'));
    assert.equal(h.app.ctSkillPreviewModel.target.properties.some(property => property.key === 'skill-card:time'), false);
    assert.equal(h.app.ctSkillPreviewModel.target.shortProperties.at(-1).text, 'Target 1.00 s');
    assert.deepEqual(clone(h.app.ctSkillExampleLabel('skill-card:time')), { text: 'Target Use Time', translated: true });
});

test('final paint await and replacement unit identities fence delayed focus', async () => {
    for (const change of [h => h.app.ctWorkspace.scope.accountId = 'bob',
        h => h.app._ctUnitIndex.set(h.item.id, clone(h.item)),
        h => h.app.ctSkillResolver = Cards.createResolver(h.catalog, h.units, h.app.ctSkillScope)]) {
        const h = harness(), pending = deferred(), started = deferred(), originalSelect = h.app.ctSelect;
        h.app.ctSelect = async (...args) => {
            const result = await originalSelect(...args);
            h.app.$nextTick = async () => { started.resolve(); await pending.promise; };
            return result;
        };
        const operation = h.app.ctSkillEditField(h.entry); await started.promise; change(h); pending.resolve();
        assert.equal(await operation, false); assert.equal(h.calls.focus.length, 0);
    }
});

test('shared tags require explicit or retained related context and never pick the first catalog entry', () => {
    const h = harness(), shared = h.units.find(unit => unit.sheet === 'GemTags'); h.app.ctSelection = shared.id;
    assert.equal(h.app.ctSkillSelectedId, ''); assert.equal(h.app.ctSkillBaseModel.reason, 'choose-related-skill');
    assert.deepEqual(h.app.ctSkillChoices.map(card => card.id), ['alpha', 'beta']);
    h.app.ctSkillRelatedId = 'beta'; assert.equal(h.app.ctSkillBaseModel.skillId, 'beta');
    h.mixin.watch.ctSkillBaseModel.call(h.app, h.app.ctSkillBaseModel); h.mixin.watch.ctSelection.call(h.app);
    assert.equal(h.app.ctSkillRelatedId, ''); assert.equal(h.app.ctSkillContextId, 'beta'); assert.equal(h.app.ctSkillSelectedId, 'beta');
    h.app.ctSkillContextId = 'unrelated'; assert.equal(h.app.ctSkillSelectedId, ''); assert.equal(h.app.ctSkillBaseModel.reason, 'choose-related-skill');
});

test('related-row loader keeps checkpointed unsaved description visible after navigation to a tag', async () => {
    const h = harness(), source = h.primary.fields[1].source, values = clone(h.app.ctValues);
    h.entry.reference = { sheet: h.tag.sheet, recordId: h.tag.recordId, field: h.tag.field };
    assert.equal(await h.app.ctSkillEditField(h.entry), true); await h.app.ctLoadSkillDrafts();
    const stored = h.app.ctSkillDrafts[h.primary.id];
    assert.equal(stored.unitId, h.primary.id); assert.deepEqual(clone(stored.scope), clone(h.app.ctSkillScope));
    assert.deepEqual(stored.values, values);
    assert.equal(h.app.ctSkillPreviewModel.target.description.text, 'Unsaved description');
    assert.equal(h.app.ctSkillPreviewModel.source.description.text, source);
    assert.equal(h.app.ctCurrentUnit.sheet, 'GemTags');
});

test('related draft reads are scoped and limited to unique matched reference units for the selected card', async () => {
    const h = harness(); await h.app.ctLoadSkillDrafts();
    const refs = [h.alpha.title, h.alpha.itemTitle, h.alpha.description, h.alpha.shortDescription, ...h.alpha.tags.map(tag => tag.ref), ...Object.values(h.alpha.examples)];
    const expected = [...new Set(refs.map(ref => JSON.stringify(['normal', ref.sheet, ref.recordId])))].sort();
    assert.deepEqual(h.calls.reads.map(read => read.id).sort(), expected);
    assert.ok(h.calls.reads.every(read => JSON.stringify(read.scope) === JSON.stringify(h.app.ctWorkspace.scope)));
    assert.equal(h.calls.reads.some(read => read.id.includes('beta-skill') || read.id.includes('beta-gem')), false);
    assert.equal(h.calls.writes.length, 0, 'reading related drafts does not checkpoint or change translations');
    const duplicated = h.app.ctSkillResolver.referencedUnits('alpha');
    assert.equal(new Set(duplicated.map(unit => unit.id)).size, duplicated.length, 'multiple fields in one row produce one storage read');
    assert.deepEqual(h.app.ctSkillResolver.referencedUnits('unknown-card'), []);
});

test('an obsolete related load cannot replace a newer completed draft snapshot', async () => {
    const h = harness(), pending = deferred(), started = deferred(), description = h.primary.fields[1].id;
    h.app.ctStorage = () => ({ getDraft: async (_scope, id) => { started.resolve(); await pending.promise; return id === h.primary.id ? { values: { [description]: 'Obsolete description' } } : null; } });
    const old = h.app.ctLoadSkillDrafts(); await started.promise;
    h.app.ctRevision++;
    h.app.ctStorage = () => ({ getDraft: async (_scope, id) => id === h.primary.id ? { values: { [description]: 'Newer description' } } : null });
    await h.app.ctLoadSkillDrafts(); const latest = clone(h.app.ctSkillDrafts);
    pending.resolve(); await old;
    assert.deepEqual(clone(h.app.ctSkillDrafts), latest); assert.equal(h.app.ctSkillDrafts[h.primary.id].values[description], 'Newer description');
});

test('related load completion after account, source, language, access or resolver replacement cannot publish', async () => {
    for (const change of [app => app.ctWorkspace.scope.accountId = 'bob', app => app.ctWorkspace.scope.groupId = 'source2',
        app => app.ctWorkspace.scope.language = 'French', app => app.privateMediaKey = 'new-access',
        (app, h) => app.ctSkillResolver = Cards.createResolver(h.catalog, h.units, app.ctSkillScope)]) {
        const h = harness(), pending = deferred(), started = deferred(), before = clone(h.app.ctSkillDrafts);
        h.app.ctStorage = () => ({ getDraft: async () => { started.resolve(); return pending.promise; } });
        const load = h.app.ctLoadSkillDrafts(); await started.promise; change(h.app, h); pending.resolve({ values: { stale: 'Former scope target' } }); await load;
        assert.deepEqual(clone(h.app.ctSkillDrafts), before);
    }
});

test('missing related rows remove stale cached drafts while current unsaved text remains live', async () => {
    const h = harness(), description = h.primary.fields[1].id, itemField = h.item.fields[0].id;
    h.app.ctSkillDrafts = {
        [h.primary.id]: { scope: h.app.ctSkillScope, unitId: h.primary.id, values: { [description]: 'Stale stored active description' } },
        [h.item.id]: { scope: h.app.ctSkillScope, unitId: h.item.id, values: { [itemField]: 'Stale related title' } }
    };
    const before = clone(h.app.ctValues); await h.app.ctLoadSkillDrafts();
    assert.equal(h.app.ctSkillDrafts[h.primary.id], undefined); assert.equal(h.app.ctSkillDrafts[h.item.id], undefined);
    assert.equal(h.app.ctSkillPreviewModel.target.description.text, before[description]); assert.deepEqual(h.app.ctValues, before);
});

test('failed related read leaves active draft fallback and prior scoped snapshot intact', async () => {
    const h = harness(), description = h.primary.fields[1].id, itemField = h.item.fields[0].id;
    h.app.ctSkillDrafts = { [h.item.id]: { scope: h.app.ctSkillScope, unitId: h.item.id, values: { [itemField]: 'Last known related target' } } };
    const before = clone({ cached: h.app.ctSkillDrafts, values: h.app.ctValues, units: h.units });
    h.app.ctStorage = () => ({ getDraft: async () => { throw new Error('Synthetic draft read failed'); } });
    await h.app.ctLoadSkillDrafts();
    assert.deepEqual(clone({ cached: h.app.ctSkillDrafts, values: h.app.ctValues, units: h.units }), before);
    assert.equal(h.app.ctSkillPreviewModel.target.description.text, before.values[description]);
});

test('composer rejects related drafts from other scopes/units and preserves active blank override', () => {
    const h = harness(), description = h.primary.fields[1].id;
    for (const changed of ['accountId', 'groupId', 'language', 'accessKey']) {
        h.app.ctSkillDrafts = { [h.primary.id]: { scope: { ...h.app.ctSkillScope, [changed]: 'different' }, unitId: h.primary.id, values: { [description]: 'Wrong scope' } } };
        h.app.ctValues = {};
        assert.equal(h.app.ctSkillPreviewModel.target.description.text, h.primary.fields[1].target);
    }
    h.app.ctSkillDrafts = { [h.primary.id]: { scope: h.app.ctSkillScope, unitId: 'wrong-unit', values: { [description]: 'Wrong row' } } };
    assert.equal(h.app.ctSkillPreviewModel.target.description.text, h.primary.fields[1].target);
    h.app.ctSkillDrafts[h.primary.id].unitId = h.primary.id; h.app.ctValues = { [description]: '' };
    assert.equal(h.app.ctSkillPreviewModel.target.description.text, '');
    assert.equal(h.app.ctSkillPreviewModel.target.description.available, false, 'intentional active blank wins over stored related draft');
});
