const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const S = require('../public/clientTextState.js');
const api = import(pathToFileURL(path.resolve(__dirname, '../../SDEditor-API/src/client-text-trusted.js')).href);

const fieldId = (name, form = null) => JSON.stringify([name, form]);
const field = (name, target = 'Original', extra = {}) => ({ id: fieldId(name, extra.kind === 'form' ? extra.form || name : null), kind: 'text', source: 'Source ' + name,
    target, required: true, originalMissing: !target.trim(), outdated: false, ...extra });
const unit = (fields, role = 'normal', recordId = 'Exact/@ ID') => S.normalizeUnit({ role,
    sheet: 'Exact sheet name', recordId, fields, developerNotes: 'Read-only notes', metadata: { Native: 'retained' } });

test('generic dialogue review inheritance agrees with sparse API counts and preserves all Gender defaults, original summaries and conflicts',async()=>{
    const A=await api;
    for(const forms of [[null],['MS','FS','NS','MP','FP','NP']]){
        const gender=forms[0]!==null,source='Exact shared English',original=S.normalizeUnit({role:gender?'gender':'normal',
            sheet:'NPCTalkDialogueTextAudio'+(gender?'_Gender':''),recordId:'generic-review',fields:[
                ...forms.map(form=>field('Text','Generic '+(form || 'text'),{kind:form?'form':'text',form,source,outdated:true})),
                field('Text','',{kind:'form',form:'StrFour',source,required:false,originalMissing:false,outdated:true,originalFill:S.FILLS.outdated}),
                field('Text','Class override',{kind:'form',form:'DexFour',source,outdated:true})]});
        const facts=S.clientFacts(original),values=S.valuesFor(original),blank=original.fields.at(-2),snapshot=JSON.stringify(facts),base=A.unitCounts(facts);
        const rows=[{saved:null},{saved:{values,reviewed:{}}},
            {saved:{values,reviewed:{},saved:false},provenance:{sourceOnly:true}},
            {saved:{values:{...values,[original.fields[0].id]:''},reviewed:{}}},
            {saved:{values,reviewed:{},conflicts:[{fieldId:original.fields[0].id}]},provenance:{conflicts:[{fieldId:original.fields[0].id}]}},
            {saved:{values,reviewed:{},conflicts:[{fieldId:blank.id}]},provenance:{conflicts:[{fieldId:blank.id}]}},
            {saved:{values,reviewed:Object.fromEntries(forms.map((_,index)=>[original.fields[index].id,S.sourceHash(source)]))}}];
        for(const {saved,provenance} of rows){
            assert.deepEqual(A.unitCounts(facts,saved?.values || null,saved?.reviewed || {},provenance || {},{game:'poe2'}),browserCounts(original,saved));
        }
        const saved={values,reviewed:{}},status=S.statusFor(original,saved,{game:'poe2'});
        assert.equal(status.fields[blank.id].generic,true);assert.equal(status.fields[blank.id].outdated,false);
        assert.equal(S.fillFor(blank,'',saved,status.fields[blank.id]),'FFFFFF','export removes inherited orange instead of inventing a Reviewed fill');
        assert.equal(S.colorCountsFor(original,saved).outdated,forms.length+1);
        assert.equal(S.statusFor(original,saved,{game:'poe1'}).fields[blank.id].outdated,true);
        const required={...original,fields:original.fields.map(value=>value===blank?{...value,required:true}:value)};
        assert.equal(S.statusFor(required,saved).fields[blank.id].missing,true);assert.equal(S.statusFor(required,saved).fields[blank.id].outdated,true);
        const unrelated={...original,fields:original.fields.map(value=>value===blank?{...value,source:'Different source'}:value)};
        assert.equal(S.statusFor(unrelated,saved).fields[blank.id].outdated,true);
        assert.equal(JSON.stringify(facts),snapshot);assert.deepEqual(A.unitCounts(facts),base,'accepted initial workload stays immutable');
        assert.deepEqual(S.addOriginalSummary(S.emptySummary(),original),base);
    }
});

function browserCounts(original, saved) {
    const result = S.emptySummary(); result.loaded = 1;
    const fields = original.fields.filter(value => !S.audioOnly(value.source));
    if (!fields.length) return result;
    const status = S.statusFor(original, saved), authored = !!saved && saved.saved !== false;
    result.eligible = 1; result.fields = fields.length; result.saved = Number(authored);
    result.savedFields = authored ? fields.length : 0;
    for (const value of fields) {
        const workload = value.originalMissing || value.outdated || saved?.outdated?.includes(value.id);
        const current = status.fields[value.id];
        result.missingFields += Number(current.missing); result.outdatedFields += Number(current.outdated);
        result.revisedFields += Number(current.revised); result.workloadFields += Number(!!workload);
        result.resolvedFields += Number(!!workload && !current.missing && !current.outdated);
    }
    for (const key of ['missing', 'outdated', 'revised']) result[key] = Number(fields.some(value => status.fields[value.id][key]));
    result.workload = Number(result.workloadFields > 0);
    result.resolved = Number(!!result.workload && !result.missing && !result.outdated);
    return result;
}

test('trusted descriptors/summaries and affected facts round-trip without baseline text', async () => {
    const A = await api;
    const normal = unit([field('Text', ''), field('Gender', ' - ', { kind: 'gender', required: false })]);
    const gender = unit([field('MS', 'NONEXISTENT', { kind: 'form' }), field('FS', '', { kind: 'form', required: false, originalMissing: false })], 'gender');
    const assets = ['normal', 'gender'].map(role => ({ role, hash: (role === 'normal' ? 'a' : 'b').repeat(64), parserVersion: S.PARSER_VERSION }));
    const bundle = await S.buildDescriptors([normal, gender], assets, { yield: async () => {} });
    assert.equal(bundle.storageProtocol, A.CLIENTTEXT_PROTOCOL);
    assert.equal(bundle.units, undefined); assert.equal(bundle.trees, undefined);
    for (const descriptor of bundle.descriptors) {
        assert.deepEqual(A.trustedDescriptor(descriptor, descriptor.role, descriptor.assetHash), descriptor);
        assert.deepEqual(A.initialCounts(bundle.summaries[descriptor.role], descriptor.unitCount), bundle.summaries[descriptor.role]);
        assert.equal(descriptor.root, undefined);
    }
    for (const original of [normal, gender]) {
        const facts = S.clientFacts(original), originals = S.originalValues(original);
        assert.deepEqual(A.clientFacts(facts, ['normal', 'gender']), facts);
        assert.deepEqual(A.fieldValues(originals, facts, 'originalValues', true), originals);
        const serialized = JSON.stringify(facts);
        for (const excluded of ['Read-only notes', 'Source Text', 'NONEXISTENT', 'Native', 'sourceCell', 'targetCell']) assert.equal(serialized.includes(excluded), false);
        assert.deepEqual(A.unitCounts(facts), bundle.summaries[original.role]);
    }
    assert.ok(Buffer.byteLength(JSON.stringify(bundle)) < 4096);
});

test('API sparse count deltas match browser field status, including mixed workload/corrections', async () => {
    const A = await api;
    const original = unit([field('Missing', ''), field('Stale', 'Old text', { outdated: true }), field('Complete'),
        field('Optional', '', { kind: 'form', required: false, originalMissing: false }),
        field('Gender', ' - ', { kind: 'gender', required: false }),
        field('Marker', '', { source: '[NOAUDIO]', originalMissing: true, outdated: true })]);
    const facts = A.clientFacts(S.clientFacts(original), ['normal']), base = S.valuesFor(original);
    const cases = [null,
        { values: base, reviewed: {}, saved: false },
        { values: { ...base, [fieldId('Missing')]: 'Filled', [fieldId('Complete')]: 'Corrected' }, reviewed: {} },
        { values: { ...base, [fieldId('Missing')]: 'Filled', [fieldId('Complete')]: 'Corrected' }, reviewed: { [fieldId('Stale')]: S.sourceHash('Source Stale') } },
        { values: base, reviewed: {} },
        { values: { ...base, [fieldId('Optional', 'Optional')]: 'NONEXISTENT', [fieldId('Gender')]: 'Unrestricted value' }, reviewed: {} },
        { values: base, reviewed: {}, saved: false, outdated: [fieldId('Complete')] },
        { values: base, reviewed: { [fieldId('Complete')]: S.sourceHash('Source Complete') }, saved: false, outdated: [fieldId('Complete')] }];
    for (const saved of cases) {
        const provenance = { sourceOnly: saved?.saved === false, requiredReview: Object.fromEntries((saved?.outdated || []).map(id => [id, S.sourceHash(original.fields.find(value => value.id === id).source)])) };
        assert.deepEqual(A.unitCounts(facts, saved?.values || null, saved?.reviewed || {}, provenance), browserCounts(original, saved));
    }
});

test('wire validation bounds values and binds reviews to affected fields while accepting literal cells', async () => {
    const A = await api, original = unit([field('Dialogue', '  leading\nactual newline\\n@literal =value  ')]), facts = S.clientFacts(original);
    assert.deepEqual(A.fieldValues(S.originalValues(original), facts, 'originalValues', true), S.originalValues(original));
    const edited = { [fieldId('Dialogue')]: '=SUM(A1)\n[] {2} <<icon>>\n  keep whitespace  ' };
    assert.deepEqual(A.fieldValues(edited, facts), edited);
    assert.throws(() => A.clientFacts({ ...facts, developerNotes: 'not sparse' }, ['normal']), /baseline text/);
    assert.throws(() => A.clientFacts({ ...facts, fields: facts.fields.map(value => ({ ...value, id: 'Dialogue' })) }, ['normal']), /identity is invalid/);
    assert.throws(() => A.fieldValues({ [fieldId('Dialogue')]: 'Different original' }, facts, 'originalValues', true), /fingerprints/);
    assert.throws(() => A.fieldValues({ [fieldId('Dialogue')]: 'x'.repeat(131073) }, facts), /bounded strings/);
    assert.throws(() => A.reviewValues({ [fieldId('Dialogue')]: 'a'.repeat(64) }, facts), /current source/);
    assert.throws(() => A.requireClientTextProtocol('clienttext-v1'), /Update the editor/);
    A.requireClientTextProtocol(S.STORAGE_PROTOCOL);
});
