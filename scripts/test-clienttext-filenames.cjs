'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const UI = require('../public/clientTextUi.js');

test('translated filenames preserve text and extension case and are idempotent', () => {
    const cases = [
        ['French.xlsx', 'French_Translated.xlsx'], ['French_Gender.xlsm', 'French_Gender_Translated.xlsm'],
        ['French.XLSM', 'French_Translated.XLSM'], ['French_Translated.xlsx', 'French_Translated.xlsx'],
        ['french_tRaNsLaTeD.XLSX', 'french_tRaNsLaTeD.XLSX'],
        ['French_Translated (1).xlsx', 'French (1)_Translated.xlsx'],
        ['French_Gender_translated(2).XLSM', 'French_Gender (2)_translated.XLSM'],
        ['French_Translated (1) (2).xlsx', 'French (1) (2)_Translated.xlsx'],
        ['French (1).xlsx', 'French (1)_Translated.xlsx'],
        ['French_TranslatedNotes.xlsx', 'French_TranslatedNotes_Translated.xlsx'],
        ['Translated_French.xlsx', 'Translated_French_Translated.xlsx'],
        ['French translated.xlsx', 'French translated_Translated.xlsx'],
        ['French_Translated (draft).xlsx', 'French_Translated (draft)_Translated.xlsx'],
        ['French_Translated_Translated.xlsx', 'French_Translated_Translated.xlsx'],
        ['Release_Translated_French_ClientText.zip', 'Release_Translated_French_ClientText_Translated.zip'],
        ['Thai.version.1.xlsm', 'Thai.version.1_Translated.xlsm'],
        ['Thai_ไทย.xlsx', 'Thai_ไทย_Translated.xlsx']
    ];
    for (const [original, expected] of cases) {
        assert.equal(UI.translatedFilename(original), expected, original);
        assert.equal(UI.translatedFilename(expected), expected, 'repeat: ' + original);
    }
});

test('translated filenames retain language and normal/Gender role recognition across repeats and browser counters', () => {
    for (const original of ['French.xlsx','French_Translated.xlsx','French (1).XLSM','fReNcH_tRaNsLaTeD(1).xlsx']) {
        let filename = original;
        for (let cycle = 0; cycle < 4; cycle++) { filename = UI.translatedFilename(filename); assert.deepEqual(UI.detect(filename), { language:'French',role:'normal' }); }
    }
    for (const original of ['French_Gender.xlsx','French_Gender_Translated.xlsx','French_Gender_Translated (1).XLSM','fReNcH_gEnDeR_tRaNsLaTeD(1).xlsx']) {
        let filename = original;
        for (let cycle = 0; cycle < 4; cycle++) { filename = UI.translatedFilename(filename); assert.deepEqual(UI.detect(filename), { language:'French',role:'gender' }); }
    }
});

test('archive names are unique ignoring case, deterministic by role and do not mutate inputs', () => {
    for (const pair of [
        ['French.xlsx','French.xlsx'], ['French.xlsx','French_Translated.xlsx'], ['French_Translated.XLSX','french_translated.xlsx']
    ]) {
        const inputs = Object.freeze([Object.freeze({role:'gender',name:pair[1]}),Object.freeze({role:'normal',name:pair[0]})]);
        const names = UI.workbookExportNames(inputs);
        assert.equal(new Set(names.map(name=>name.toLowerCase())).size,2);
        assert.equal(UI.detect(names[0]).role,'gender'); assert.equal(UI.detect(names[1]).role,'normal');
        assert.deepEqual(UI.workbookExportNames(inputs.slice().reverse()),names.slice().reverse());
        assert.deepEqual(UI.workbookExportNames(inputs.map((output,index)=>({...output,name:names[index]}))),names);
        assert.deepEqual(inputs.map(input=>input.name),[pair[1],pair[0]]);
    }
    assert.deepEqual(UI.workbookExportNames([{role:'normal',name:'French.xlsx'},{role:'gender',name:'French.xlsx'}]),['French_Translated.xlsx','French_Gender_Translated.xlsx']);
    const triple=UI.workbookExportNames([{role:'normal',name:'French.xlsx'},{role:'gender',name:'French.xlsx'},{role:'gender',name:'French.xlsx'}]);
    assert.deepEqual(triple,['French_Translated.xlsx','French_Gender_Translated.xlsx','French_Gender_2_Translated.xlsx']);
});
