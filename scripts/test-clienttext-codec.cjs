'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const JSZip = require('../../SDEditor-API/node_modules/jszip');
const Codec = require('../public/clientTextCodec.js');
const State = require('../public/clientTextState.js');
const WorkerClient = require('../public/clientTextWorkerClient.js');
const Transport = require('../public/clientTextTransport.js');
const { readFileSync } = require('node:fs');
const { runInNewContext, createContext, runInContext } = require('node:vm');
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#13;');
const cell = (r, value, style = 0, extra = '') => `<c r="${r}" s="${style}" t="inlineStr" ${extra}><is><t xml:space="preserve">${escape(value)}</t></is></c>`;
const empty = (r, style) => `<c r="${r}" s="${style}"/>`;
const row = (r, cells) => `<row r="${r}">${cells.join('')}</row>`;
const sheet = rows => `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${NS}"><sheetData>${rows.join('')}</sheetData><extLst><ext uri="native"><keep xmlns="urn:native">preserve</keep></ext></extLst></worksheet>`;
const styles = `<?xml version="1.0"?><styleSheet xmlns="${NS}"><fonts count="1"><font><name val="Calibri"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFA8072"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFF9966"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4">${[0, 1, 2, 3].map(fill => `<xf numFmtId="0" fontId="0" fillId="${fill}" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1"/></xf>`).join('')}</cellXfs></styleSheet>`;
async function workbook({ replace = {}, macro = false, normal } = {}) {
    const zip = new JSZip();
    const normalXml = normal || sheet([
        row(1, [cell('A1', 'ID'), cell('B1', 'Notes'), cell('C1', 'Name'), cell('D1', 'Translation'), cell('E1', 'Gender'), cell('G1', 'Description'), cell('H1', 'Translation')]),
        row(2, [cell('A2', 'record'), cell('B2', 'Developer instruction'), cell('C2', 'Sword'), empty('D2', 2), cell('E2', 'M', 1), cell('G2', '[NOAUDIO] New description'), cell('H2', 'Old description', 3)]),
        row(3, [cell('A3', 'complete'), cell('C3', 'Shield'), cell('D3', 'Original', 1), cell('E3', 'F', 1), cell('G3', '{0:+d} <size:3>{Text} <<keybind:open_panel>>'), cell('H3', 'Formatting', 1)]),
        row(4, [cell('A4', 'noaudio'), cell('C4', '[NOAUDIO] '), empty('D4', 2), empty('E4', 0)]),
    ]);
    const genderXml = sheet([
        row(1, [cell('A1', 'ID'), cell('B1', 'Tags'), cell('C1', 'Text'), ...['MS', 'FS', 'NS', 'MP', 'FP', 'NP'].map((label, i) => cell(String.fromCharCode(68 + i) + '1', label))]),
        row(2, [cell('A2', 'record'), cell('B2', 'weapon'), cell('C2', 'Strong'), cell('D2', 'Fort', 1), cell('F2', ' NONEXISTENT', 1), cell('I2', 'NONEXISTENT', 1)]),
        row(3, [cell('A3', 'new'), cell('C3', 'New'), empty('D3', 2), empty('E3', 2), empty('F3', 1), empty('G3', 1), empty('H3', 1), empty('I3', 1)]),
    ]);
    zip.file('[Content_Types].xml', `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="${macro ? 'application/vnd.ms-excel.sheet.macroEnabled.main+xml' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'}"/></Types>`);
    zip.file('xl/workbook.xml', `<workbook xmlns="${NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Normal" sheetId="1" r:id="rId1"/><sheet name="Words_Gender" sheetId="2" r:id="rId2"/></sheets></workbook>`);
    zip.file('xl/_rels/workbook.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>');
    zip.file('xl/worksheets/sheet1.xml', normalXml); zip.file('xl/worksheets/sheet2.xml', genderXml); zip.file('xl/styles.xml', styles);
    zip.file('xl/metadata', new Uint8Array([0, 255, 8, 99]));
    zip.file('xl/native.bin', new Uint8Array([7, 8, 9]));
    if (macro) zip.file('xl/vbaProject.bin', new Uint8Array([1, 9, 255]));
    for (const [name, value] of Object.entries(replace)) zip.file(name, value);
    return zip.generateAsync({ type: 'uint8array' });
}
const get = (parsed, record, sheetName = 'Normal') => parsed.units.find(unit => unit.recordId === record && unit.sheet === sheetName);
const field = (unit, name, form = null) => unit.fields.find(item => item.id === JSON.stringify([name, form]));
const withoutAddedTab = raw => raw.replace(/<((?:[\w.-]+:)?sheetPr)><(?:[\w.-]+:)?tabColor\b[^>]*\/><\/\1>/, '');
const tabColor = async (bytes, path = 'xl/worksheets/sheet1.xml') => {
    const raw = await (await JSZip.loadAsync(bytes)).file(path).async('string');
    return /<(?:[\w.-]+:)?tabColor\b[^>]*\brgb="FF([A-F0-9]{6})"/i.exec(raw)?.[1] || null;
};
const withTab = (raw, color) => raw.replace('<sheetData>', `<sheetPr codeName="NativeSheet" enableFormatConditionsCalculation="0"><tabColor rgb="FF${color}"/><outlinePr summaryRight="0"/><pageSetUpPr fitToPage="1"/></sheetPr><sheetData>`);

test('workbook game detection uses internal identities and corroborated tables, never filenames or translated names', () => {
    const characters = ids => ({units:ids.map(recordId=>({sheet:'Characters',recordId}))});
    const one='Metadata/Characters/Str/Str', two='Metadata/Characters/Str/StrFour';
    assert.equal(Codec.detectGame(characters([one])), 'poe1');
    assert.equal(Codec.detectGame(characters([two, 'Metadata/Characters/Int/IntFourb'])), 'poe2');
    assert.equal(Codec.detectGame({filename:'PoE1.xlsm',units:[{sheet:'NPCs',recordId:one}]}),null);
    assert.equal(Codec.detectGame({sheets:[{name:'KeywordPopups'},{name:'GrantedEffects'}]}),null);
    assert.equal(Codec.detectGame({sheets:[{name:'GrantedEffects'},{name:'IndexableSkillGems'}]}),'poe1');
    assert.equal(Codec.detectGame({sheets:[{name:'NPCTalkDialogueTextAudio'},{name:'SupportGemFamily'}]}),'poe2');
    assert.throws(()=>Codec.detectGame(characters([one,two])),{code:'CLIENTTEXT_GAME_CONFLICT'});
    assert.throws(()=>Codec.assertGame(characters([one]),'poe2'),{code:'CLIENTTEXT_GAME_MISMATCH'});
    assert.throws(()=>Codec.assertGame(characters([two]),'poe1'),{code:'CLIENTTEXT_GAME_MISMATCH'});
    assert.equal(Codec.assertGame({units:[]},'poe1'),null,'Partial/Gender exports keep their explicit selected scope');
});

test('PoE1 Characters import rejects the wrong game and retains the existing parser and exact no-op XLSM bytes', async () => {
    const normal=sheet([row(1,[cell('A1','ID'),cell('B1','Name'),cell('C1','Translation')]),
        row(2,[cell('A2','Metadata/Characters/Str/Str'),cell('B2','Example'),cell('C2','Target',1)])]);
    const bytes=await workbook({macro:true,normal});
    const zip=await JSZip.loadAsync(bytes);
    zip.file('xl/workbook.xml',(await zip.file('xl/workbook.xml').async('string')).replace('name="Normal"','name="Characters"'));
    const input=await zip.generateAsync({type:'uint8array'});
    const parsed=await Codec.parseWorkbook(input,{filename:'Uninformative.xlsm',game:'poe1'});
    assert.equal(parsed.game,'poe1');assert.equal(parsed.parserVersion,'clienttext-v4');
    assert.deepEqual(await Codec.exportWorkbook(input,parsed,{}),input);
    await assert.rejects(Codec.parseWorkbook(input,{filename:'PoE2.xlsm',game:'poe2'}),{code:'CLIENTTEXT_GAME_MISMATCH'});
});

test('export resolves red cells and tabs from current content while retaining unrelated XLSM data', async () => {
    const normal = withTab(sheet([
        row(1, [cell('A1', 'ID'), cell('B1', 'Name'), cell('C1', 'Translation'), cell('D1', 'Character')]),
        row(2, [cell('A2', 'missing'), cell('B2', 'English'), empty('C2', 2), '<c r="D2"><f>1+1</f><v>2</v></c>']),
        row(3, [cell('A3', 'stale-red'), cell('B3', 'English'), cell('C3', 'Already translated', 2)]),
    ]), Codec.FILLS.missing);
    const bytes = await workbook({ macro: true, normal }), parsed = await Codec.parseWorkbook(bytes, { filename: 'French.xlsm' });
    const missing = get(parsed, 'missing'), stale = get(parsed, 'stale-red');
    const saved = { [missing.id]: { values: { [field(missing, 'Name').id]: 'Filled' } },
        [stale.id]: { values: { [field(stale, 'Name').id]: field(stale, 'Name').target } } };
    const output = await Codec.exportWorkbook(bytes, parsed, saved), reopened = await Codec.parseWorkbook(output, { filename: 'French.xlsm' });
    assert.equal(field(get(reopened, 'missing'), 'Name').originalFill, Codec.FILLS.filled);
    assert.equal(field(get(reopened, 'stale-red'), 'Name').originalFill, Codec.FILLS.filled, 'Saved nonblank content cannot retain an obsolete red Missing fill');
    assert.equal(await tabColor(output), Codec.FILLS.filled, 'A completed red sheet must reflect its resolved content');
    const before = await JSZip.loadAsync(bytes), after = await JSZip.loadAsync(output);
    assert.deepEqual(Object.keys(after.files), Object.keys(before.files));
    for (const name of Object.keys(before.files)) if (!before.files[name].dir && !['xl/styles.xml', 'xl/worksheets/sheet1.xml'].includes(name))
        assert.deepEqual(await after.file(name).async('uint8array'), await before.file(name).async('uint8array'), name);
    const omitEdits = raw => raw.replace(/<tabColor\b[^>]*\/>/, '<tabColor/>').replace(/<c\b[^>]*?\br="C[23]"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g, '<target/>');
    assert.equal(omitEdits(await after.file('xl/worksheets/sheet1.xml').async('string')), omitEdits(normal), 'Only selected targets and the tab colour may change, including formula caches and sheetPr options');
    const corrected = await Codec.exportWorkbook(bytes, parsed, { ...saved, [stale.id]: { values: { [field(stale, 'Name').id]: 'Revised red cell' } } });
    assert.equal(field(get(await Codec.parseWorkbook(corrected, { filename: 'French.xlsm' }), 'stale-red'), 'Name').originalFill, Codec.FILLS.revised);
    assert.equal(await tabColor(corrected), Codec.FILLS.revised, 'A correction of complete original text is Revised even if its original fill was red');
});

test('sheet tabs include untouched Missing and Outdated fields, then reviewed and revised saved content', async () => {
    const normal = withTab(sheet([
        row(1, [cell('A1', 'ID'), cell('B1', 'Name'), cell('C1', 'Translation')]),
        row(2, [cell('A2', 'missing'), cell('B2', 'English'), empty('C2', 2)]),
        row(3, [cell('A3', 'outdated'), cell('B3', 'Changed English'), cell('C3', 'Old', 3)]),
        row(4, [cell('A4', 'complete'), cell('B4', 'English'), cell('C4', 'Original', 1)]),
    ]), Codec.FILLS.missing);
    const bytes = await workbook({ macro: true, normal }), parsed = await Codec.parseWorkbook(bytes, { filename: 'French.xlsm' });
    const missing = get(parsed, 'missing'), outdated = get(parsed, 'outdated'), complete = get(parsed, 'complete'), records = {};
    const save = (unit, value, reviewed = {}) => records[unit.id] = { values: { [field(unit, 'Name').id]: value }, reviewed };
    const exported = () => Codec.exportWorkbook(bytes, { ...parsed, units: parsed.units.filter(unit => records[unit.id]) }, records);
    save(complete, 'Revised');
    assert.equal(await tabColor(await exported()), Codec.FILLS.missing, 'An untouched missing row keeps a mixed sheet red');
    save(missing, 'Filled');
    assert.equal(await tabColor(await exported()), Codec.FILLS.outdated, 'Untouched Outdated work outranks completed or revised work');
    save(outdated, 'Old', { [field(outdated, 'Name').id]: State.sourceHash(field(outdated, 'Name').source) });
    const output = await exported();
    assert.equal(await tabColor(output), Codec.FILLS.revised, 'An eligible correction remains visible after all workload is resolved');
    const reopened = await Codec.parseWorkbook(output, { filename: 'French.xlsm' });
    assert.equal(field(get(reopened, 'outdated'), 'Name').originalFill, Codec.FILLS.reviewed);
    assert.equal(field(get(reopened, 'complete'), 'Name').originalFill, Codec.FILLS.revised);
    save(complete, 'Original');
    assert.equal(await tabColor(await exported()), Codec.FILLS.reviewed, 'Reverting a correction leaves reviewed completion');
    assert.deepEqual(await Codec.exportWorkbook(bytes, parsed, {}), bytes, 'Unmodified workbooks keep their exact bytes');
    assert.deepEqual(await Codec.exportWorkbook(bytes, parsed, { [complete.id]: records[complete.id] }), bytes, 'An unchanged complete save preserves original formatting and tabs');
});

test('legacy affected-only headers rederive whole-sheet workload with their accepted parser', async () => {
    for (const parserVersion of Codec.PARSER_VERSIONS) {
        const normal = classDialogue().replace('</sheetData>', row(3, [cell('A3', 'untouched'), cell('C3', 'English'), cell('D3', 'Complete', 1), cell('E3', 'Complete', 1)]) + '</sheetData>');
        const bytes = await workbook({ macro: true, normal: withTab(normal, Codec.FILLS.missing) });
        const parsed = await Codec.parseWorkbook(bytes, { filename: 'German.xlsm', parserVersion });
        const unit = get(parsed, 'dialogue'), current = field(unit, 'Text', 'MS'), saved = { [unit.id]: { values: { [current.id]: 'Revised' } } };
        const legacy = { ...parsed, sheets: parsed.sheets.map(({ originalStatusCounts, ...sheet }) => sheet), units: [unit] };
        assert.deepEqual(await Codec.exportWorkbook(bytes, legacy, saved), await Codec.exportWorkbook(bytes, parsed, saved), parserVersion);
        assert.equal(await tabColor(await Codec.exportWorkbook(bytes, legacy, saved)), parserVersion === 'clienttext-v1' ? Codec.FILLS.revised : Codec.FILLS.missing);
        const oldCounts = { ...legacy, sheets: parsed.sheets.map(sheet => ({ ...sheet, originalStatusCounts: {
            missing: sheet.originalStatusCounts.missing, outdated: sheet.originalStatusCounts.outdated } })) };
        assert.deepEqual(await Codec.exportWorkbook(bytes, oldCounts, saved), await Codec.exportWorkbook(bytes, parsed, saved), 'Two-colour cached counts are upgraded from the same accepted original');
    }
});

test('exported grey completion is distinct from no colour, with retained higher completion colours across untouched fields', async () => {
    const plain = sheet([row(1, [cell('A1', 'ID'), cell('B1', 'Name'), cell('C1', 'Translation')]),
        row(2, [cell('A2', 'plain'), cell('B2', 'English'), cell('C2', 'Original', 1)])]);
    const bytes = await workbook({ macro: true, normal: plain }), parsed = await Codec.parseWorkbook(bytes, { filename: 'French.xlsm' });
    const unit = get(parsed, 'plain'), current = field(unit, 'Name');
    const saved = { [unit.id]: { values: { [current.id]: 'Correction' } } };
    assert.equal(await tabColor(await Codec.exportWorkbook(bytes, parsed, saved)), Codec.FILLS.revised);
    saved[unit.id].values[current.id] = current.target;
    const reverted = await Codec.exportWorkbook(bytes, parsed, saved);
    assert.equal(await tabColor(reverted), null, 'An unchanged complete original has no colour, not grey');
    assert.deepEqual(reverted, bytes, 'Reverting the correction retains the exact original uncoloured workbook');

    const completionStyles = styles.replace('<fills count="4">', '<fills count="7">').replace('</fills>',
        ['filled','reviewed','revised'].map(color => '<fill><patternFill patternType="solid"><fgColor rgb="FF' + Codec.FILLS[color] + '"/></patternFill></fill>').join('') + '</fills>')
        .replace('<cellXfs count="4">', '<cellXfs count="7">').replace('</cellXfs>',
            [4,5,6].map(fillId => '<xf numFmtId="0" fontId="0" fillId="' + fillId + '" borderId="0" xfId="0"/>').join('') + '</cellXfs>');
    for (const [styleId, expected] of [[1,'filled'],[4,'filled'],[5,'reviewed'],[6,'revised']]) {
        const normal = withTab(sheet([row(1, [cell('A1', 'ID'), cell('B1', 'Name'), cell('C1', 'Translation')]),
            row(2, [cell('A2', 'missing'), cell('B2', 'English'), empty('C2', 2)]),
            row(3, [cell('A3', 'untouched'), cell('B3', 'English'), cell('C3', 'Complete', styleId)])]), Codec.FILLS.missing);
        const original = await workbook({ macro: true, normal, replace: { 'xl/styles.xml': completionStyles } });
        const baseline = await Codec.parseWorkbook(original, { filename: 'French.xlsm' }), missing = get(baseline, 'missing');
        const work = { [missing.id]: { values: { [field(missing, 'Name').id]: 'Completed' } } };
        const exported = await Codec.exportWorkbook(original, { ...baseline, units: [missing] }, work);
        assert.equal(await tabColor(exported), Codec.FILLS[expected], 'Untouched completion fills participate in whole-sheet priority');
        const reopened = await Codec.parseWorkbook(exported, { filename: 'French.xlsm' });
        assert.equal(field(get(reopened, 'missing'), 'Name').originalFill, Codec.FILLS.filled);
        assert.equal(State.unitColorFor(get(reopened, 'missing')), 'filled', 'Reimported completion-grey remains distinct');
        assert.deepEqual(get(reopened, 'untouched'), get(baseline, 'untouched'), 'Unmodified fields keep their exact source styling');
    }
});

test('an affected uncoloured sheet removes obsolete status tabs, including grey, while retaining unrelated tab formatting', async () => {
    for (const color of [...Object.values(Codec.FILLS), '123456']) {
        const normal = withTab(sheet([row(1, [cell('A1', 'ID'), cell('B1', 'Name'), cell('C1', 'Translation')]),
            row(2, [cell('A2', 'audio'), cell('B2', '[NOAUDIO]'), cell('C2', 'Original metadata', 1)])]), color);
        const bytes = await workbook({ macro: true, normal }), parsed = await Codec.parseWorkbook(bytes, { filename: 'French.xlsm' });
        const unit = get(parsed, 'audio'), current = field(unit, 'Name'), saved = { [unit.id]: { values: { [current.id]: 'Changed metadata' } } };
        assert.equal(State.unitColorFor(unit, saved[unit.id]), '', 'Audio-only source retains its existing workload exemption');
        const output = await Codec.exportWorkbook(bytes, parsed, saved);
        assert.equal(await tabColor(output), color === '123456' ? color : null, 'No colour is an explicit result and clears known status colours');
        const reopened = await Codec.parseWorkbook(output, { filename: 'French.xlsm' });
        assert.equal(field(get(reopened, 'audio'), 'Name').originalFill, 'FFFFFF', 'Cell-colour exemptions remain unchanged');
        const raw = await (await JSZip.loadAsync(output)).file('xl/worksheets/sheet1.xml').async('string');
        assert.ok(raw.includes('<outlinePr summaryRight="0"/><pageSetUpPr fitToPage="1"/>'));
    }
});

test('review-only and source-only exports update tabs without manufacturing Revised or Saved fills', async () => {
    const normal = withTab(sheet([
        row(1, [cell('A1', 'ID'), cell('B1', 'Name'), cell('C1', 'Translation')]),
        row(2, [cell('A2', 'complete'), cell('B2', 'English'), cell('C2', 'Original', 1)]),
    ]), Codec.FILLS.missing);
    const bytes = await workbook({ macro: true, normal }), parsed = await Codec.parseWorkbook(bytes, { filename: 'French.xlsm' });
    const unit = get(parsed, 'complete'), current = field(unit, 'Name');
    const sourceOnly = { values: {}, outdated: [current.id], saved: false };
    const orange = await Codec.exportWorkbook(bytes, parsed, { [unit.id]: sourceOnly });
    assert.equal(await tabColor(orange), Codec.FILLS.outdated);
    const reviewed = { ...sourceOnly, reviewed: { [current.id]: State.sourceHash(current.source) } };
    const green = await Codec.exportWorkbook(bytes, parsed, { [unit.id]: reviewed });
    assert.equal(await tabColor(green), Codec.FILLS.reviewed);
    assert.equal(field(get(await Codec.parseWorkbook(green, { filename: 'French.xlsm' }), 'complete'), 'Name').originalFill, Codec.FILLS.reviewed);
    assert.equal(State.statusFor(unit, reviewed).saved, false);

    const orangeBytes = await workbook({ macro: true, normal: normal.replace(cell('C2', 'Original', 1), cell('C2', 'Original', 3)) });
    const originalOrange = await Codec.parseWorkbook(orangeBytes, { filename: 'French.xlsm' });
    const tabOnly = await Codec.exportWorkbook(orangeBytes, originalOrange, { [unit.id]: { values: { [current.id]: 'Original' } } });
    assert.equal(await tabColor(tabOnly), Codec.FILLS.outdated, 'A tab can change even when target XML and its existing orange fill need no change');
    const before = await JSZip.loadAsync(orangeBytes), after = await JSZip.loadAsync(tabOnly);
    assert.equal((await after.file('xl/worksheets/sheet1.xml').async('string')).replace(/<tabColor\b[^>]*\/>/, ''), normal.replace(cell('C2', 'Original', 1), cell('C2', 'Original', 3)).replace(/<tabColor\b[^>]*\/>/, ''));
    assert.deepEqual(await after.file('xl/styles.xml').async('uint8array'), await before.file('xl/styles.xml').async('uint8array'));
    const signedZip = await JSZip.loadAsync(orangeBytes); signedZip.file('_xmlsignatures/sig1.xml', '<Signature/>');
    const signed = await signedZip.generateAsync({ type: 'uint8array' }), signedParsed = await Codec.parseWorkbook(signed, { filename: 'French.xlsm' });
    await assert.rejects(Codec.exportWorkbook(signed, signedParsed, { [unit.id]: { values: { [current.id]: 'Original' } } }), /signature/, 'Tab-only changes also invalidate signatures');
});

test('tab patches support absent, empty and prefixed sheet properties and retain other sheet settings', async () => {
    const base = sheet([row(1, [cell('A1', 'ID'), cell('B1', 'Name'), cell('C1', 'Translation')]),
        row(2, [cell('A2', 'complete'), cell('B2', 'English'), cell('C2', 'Original', 1)])]);
    for (const [name, properties] of [
        ['absent', ''],
        ['empty', '<sheetPr/>'],
        ['commented', '<!--retained--><sheetPr codeName="Native"/>'],
        ['options', '<sheetPr codeName="Native"><outlinePr summaryBelow="0"/><pageSetUpPr fitToPage="1"/></sheetPr>'],
        ['theme', '<sheetPr codeName="Native"><tabColor theme="4" tint="0.5"/><outlinePr summaryBelow="0"/></sheetPr>'],
    ]) for (const prefix of ['', 'x:']) {
        let normal = base.replace('<sheetData>', properties + '<sheetData>');
        if (prefix) normal = normal.replace(/<(\/?)(worksheet|sheetPr|tabColor|outlinePr|pageSetUpPr|sheetData|row|c|is|t|extLst|ext)(?=[\s/>])/g, '<$1x:$2').replace(`xmlns="${NS}"`, `xmlns:x="${NS}"`);
        const bytes = await workbook({ macro: true, normal }), parsed = await Codec.parseWorkbook(bytes, { filename: 'French.xlsm' });
        const unit = get(parsed, 'complete'), current = field(unit, 'Name');
        const output = await Codec.exportWorkbook(bytes, parsed, { [unit.id]: { values: { [current.id]: 'Revised' } } });
        assert.equal(await tabColor(output), Codec.FILLS.revised, name + prefix);
        const raw = await (await JSZip.loadAsync(output)).file('xl/worksheets/sheet1.xml').async('string');
        assert.equal((raw.match(/<(?:x:)?tabColor\b/g) || []).length, 1, name + prefix);
        assert.equal(raw.includes('theme="4"'), false); assert.equal(raw.includes('tint="0.5"'), false);
        if (name !== 'absent' && name !== 'empty') assert.ok(raw.includes('codeName="Native"'));
        if (name === 'commented') assert.ok(raw.includes('<!--retained-->'));
        for (const child of properties.match(/<(?:outlinePr|pageSetUpPr)\b[^>]*\/>/g) || [])
            assert.ok(raw.includes(prefix ? child.replace('<', '<x:') : child));
        assert.equal(field(get(await Codec.parseWorkbook(output, { filename: 'French.xlsm' }), 'complete'), 'Name').target, 'Revised');
    }
});

test('status fills clone the exact original style across mixed self-closing and expanded cellXfs', async () => {
    const originalStyles = styles.replace('<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1"/></xf>',
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>')
        .replace('fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1"/>',
            'fillId="2" borderId="0" xfId="0" applyAlignment="1" applyProtection="1"><alignment wrapText="1" readingOrder="2"/><protection locked="0"/>');
    const bytes = await workbook({ macro: true, replace: { 'xl/styles.xml': originalStyles } });
    const parsed = await Codec.parseWorkbook(bytes, { filename: 'French.xlsm' }), unit = get(parsed, 'record'), current = field(unit, 'Name');
    const output = await Codec.exportWorkbook(bytes, parsed, { [unit.id]: { values: { [current.id]: 'Filled' } } });
    const parser = new (require('../public/vendor/fast-xml-parser-5.11.2.min.js').default)({ ignoreAttributes: false });
    const raw = await (await JSZip.loadAsync(output)).file('xl/styles.xml').async('string'), xfs = parser.parse(raw).styleSheet.cellXfs.xf;
    const reopened = await Codec.parseWorkbook(output, { filename: 'French.xlsm' }), styleId = Number(field(get(reopened, 'record'), 'Name').originalStyleId);
    const withoutFill = xf => Object.fromEntries(Object.entries(xf).filter(([key]) => !['@_fillId', '@_applyFill'].includes(key)));
    assert.deepEqual(withoutFill(xfs[styleId]), withoutFill(parser.parse(originalStyles).styleSheet.cellXfs.xf[Number(current.originalStyleId)]));
});

const classDialogue = () => sheet([
    row(1, [cell('A1', 'ID'), cell('B1', 'Character Class'), cell('C1', 'Text'), cell('D1', 'MS'), cell('E1', 'FS'),
        ...Codec.CLASS_FORMS.map((name, index) => cell(String.fromCharCode(70 + index) + '1', name)), cell('R1', 'Notes')]),
    row(2, [cell('A2', 'dialogue'), cell('B2', 'Class metadata'), cell('C2', ' Raw [Tag|display] {0} @\\n\nsecond '),
        cell('D2', 'Default masculine', 1), cell('E2', 'Default feminine', 1), empty('F2', 1), empty('G2', 2), empty('H2', 3),
        cell('I2', ' @literal\\n raw\r\nactual\n\t ', 1), empty('J2', 1), cell('K2', 'NONEXISTENT', 1), cell('L2', 'Original class translation', 1),
        ...['M', 'N', 'O', 'P', 'Q'].map(col => empty(col + '2', 1)), cell('R2', 'Actual developer note')]),
]);
// Header styles deliberately use unrelated cellXf/font indexes. A style index
// alone has no meaning, and inherited fonts must follow xfId rather than fill.
const hintStyles = () => styles
    .replace(/<fonts count="1">[\s\S]*?<\/fonts>/, '<fonts count="5"><font><name val="Calibri"/></font><font><i/></font><font><i val="0"/></font><font><i val="false"/></font><font><i val="true"/></font></fonts>')
    .replace(/<cellStyleXfs count="1">[\s\S]*?<\/cellStyleXfs>/, '<cellStyleXfs count="2"><xf fontId="0" fillId="0"/><xf fontId="1" fillId="0"/></cellStyleXfs>')
    .replace('<cellXfs count="4">', '<cellXfs count="9">')
    .replace('</cellXfs>', '<xf fontId="4" fillId="0" xfId="0"/><xf fontId="2" fillId="0" xfId="1" applyFont="1"/><xf fillId="0" xfId="1"/><xf fontId="3" fillId="0" xfId="1" applyFont="1"/><xf fontId="1" fillId="0" xfId="0"/></cellXfs>');
const withHintStyles = (normal, extra = {}) => workbook({ normal, ...extra, replace: { 'xl/styles.xml': hintStyles(), ...(extra.replace || {}) } });

test('v4 italic header metadata overrides editable-name heuristics without consuming source or form columns', async () => {
    const normal = sheet([
        row(1, [cell('A1', 'ID'), cell('B1', 'Gender', 4), cell('C1', 'NPC', 6), cell('D1', 'Name'), cell('E1', 'Translation'),
            cell('F1', 'MS', 8), cell('G1', 'FS', 6), cell('H1', 'StrFour', 4), cell('I1', 'Text', 6), cell('J1', 'Translation', 4),
            cell('K1', 'Normal Translation', 8), cell('L1', 'Possessive Translation', 6), cell('M1', 'Description', 4), cell('N1', 'StrFourb')]),
        row(2, [cell('A2', 'hints'), cell('B2', 'Intrinsic NPC gender'), cell('C2', 'Metadata/NPC/Example'), cell('D2', 'Immutable English'), cell('E2', 'Original target', 1),
            cell('F2', 'MS reference'), cell('G2', 'FS reference'), cell('H2', 'Class reference'), cell('I2', 'Source-named reference'), cell('J2', 'Translation-named reference'),
            cell('K2', 'Normal reference'), cell('L2', 'Possessive reference'), cell('M2', 'Description reference'), empty('N2', 1)]),
    ]);
    const bytes = await withHintStyles(normal, { macro: true }), parsed = await Codec.parseWorkbook(bytes, { filename: 'Thai.xlsm' }), unit = get(parsed, 'hints');
    assert.equal(parsed.parserVersion, 'clienttext-v4');
    assert.deepEqual(unit.fields.map(current => [current.name, current.form || null, current.targetCell]), [['Name', null, 'E2'], ['Name', 'StrFourb', 'N2']]);
    assert.deepEqual(unit.metadata, { Gender: 'Intrinsic NPC gender', NPC: 'Metadata/NPC/Example', MS: 'MS reference', FS: 'FS reference', StrFour: 'Class reference',
        Text: 'Source-named reference', Translation: 'Translation-named reference', 'Normal Translation': 'Normal reference', 'Possessive Translation': 'Possessive reference', Description: 'Description reference' });
    assert.equal(field(unit, 'Name', 'StrFourb').required, false, 'A blank nonitalic class target remains an optional editable form');
    assert.equal(parsed.warnings.some(warning => warning.code === 'CLIENTTEXT_METADATA_COLUMN'), false, 'Italic headers explicitly identify reference metadata');
    assert.deepEqual(await Codec.exportWorkbook(bytes, parsed, {}), bytes);
    await assert.rejects(Codec.exportWorkbook(bytes, parsed, { [unit.id]: { values: { '["Gender",null]': 'Not editable' } } }), /unknown field/);
    const output = await Codec.exportWorkbook(bytes, parsed, { [unit.id]: { values: { [field(unit, 'Name').id]: 'Authored target' } } });
    const reopened = get(await Codec.parseWorkbook(output, { filename: 'Thai.xlsm' }), 'hints');
    assert.deepEqual(reopened.metadata, unit.metadata); assert.equal(field(reopened, 'Name').target, 'Authored target');
    assert.deepEqual(field(reopened, 'Name', 'StrFourb'), field(unit, 'Name', 'StrFourb'));
    const before = await JSZip.loadAsync(bytes), after = await JSZip.loadAsync(output);
    for (const name of Object.keys(before.files)) if (!before.files[name].dir && !['xl/worksheets/sheet1.xml', 'xl/styles.xml'].includes(name))
        assert.deepEqual(await after.file(name).async('uint8array'), await before.file(name).async('uint8array'), name);
    const omitTarget = text => withoutAddedTab(text).replace(/<c\b[^>]*\br="E2"[^>]*(?:\/>|>[\s\S]*?<\/c>)/, '<chosen-target/>');
    assert.equal(omitTarget(await after.file('xl/worksheets/sheet1.xml').async('string')), omitTarget(await before.file('xl/worksheets/sheet1.xml').async('string')), 'All metadata cells and headers remain byte-exact');
});
test('v4 resolves header font italic booleans and keeps nonitalic Gender editable', async () => {
    for (const styleId of [0, 5, 7]) {
        const normal = sheet([
            row(1, [cell('A1', 'ID'), cell('B1', 'Name', styleId), cell('C1', 'Translation', styleId), cell('D1', 'Gender', styleId)]),
            row(2, [cell('A2', 'plain'), cell('B2', 'English'), cell('C2', 'Target', 1), cell('D2', 'F', 1)]),
        ]);
        const unit = get(await Codec.parseWorkbook(await withHintStyles(normal), { filename: 'French.xlsx' }), 'plain');
        assert.equal(field(unit, 'Name').target, 'Target'); assert.equal(field(unit, 'Gender').target, 'F'); assert.deepEqual(unit.metadata, {});
    }
    for (const styleId of [4, 6, 8]) {
        const normal = sheet([
            row(1, [cell('A1', 'ID'), cell('B1', 'Name'), cell('C1', 'Translation'), cell('D1', 'Gender', styleId)]),
            row(2, [cell('A2', 'italic'), cell('B2', 'English'), cell('C2', 'Target', 1), cell('D2', 'Reference only')]),
        ]);
        const unit = get(await Codec.parseWorkbook(await withHintStyles(normal), { filename: 'Thai.xlsx' }), 'italic');
        assert.equal(field(unit, 'Gender'), undefined); assert.deepEqual(unit.metadata, { Gender: 'Reference only' });
    }
});
test('v4 honors row, column and rich header fonts and rejects mixed hint formatting', async () => {
    const noStyle = cell('D1', 'Gender').replace(' s="0"', ''), normal = sheet([
        row(1, [cell('A1', 'ID'), cell('B1', 'Name'), cell('C1', 'Translation'), noStyle]),
        row(2, [cell('A2', 'styled'), cell('B2', 'English'), cell('C2', 'Target', 1), cell('D2', 'Reference gender')]),
    ]);
    const rich = italic => '<c r="D1" s="0" t="inlineStr"><is><r><rPr><i' + italic + '/></rPr><t>Gender</t></r></is></c>';
    const cases = [
        [normal.replace('<sheetData>', '<cols><col min="4" max="4" style="4"/></cols><sheetData>'), {}, true],
        [normal.replace('<row r="1">', '<row r="1" s="4" customFormat="1">'), {}, true],
        [normal.replace('<sheetData>', '<cols><col min="4" max="4" style="4"/></cols><sheetData>').replace('<row r="1">', '<row r="1" s="5" customFormat="1">'), {}, false],
        [normal.replace(noStyle, rich('')), {}, true],
        [normal.replace(noStyle, rich(' val="0"').replace('s="0"', 's="4"')), {}, false],
        [normal.replace(noStyle, '<c r="D1" t="s"><v>0</v></c>'), { 'xl/sharedStrings.xml': '<sst xmlns="' + NS + '"><si><r><rPr><i/></rPr><t>Gender</t></r></si></sst>' }, true],
    ];
    for (const [sheetXml, replace, italic] of cases) {
        const unit = get(await Codec.parseWorkbook(await withHintStyles(sheetXml, { replace }), { filename: 'Thai.xlsx' }), 'styled');
        assert.equal(field(unit, 'Gender') === undefined, italic); assert.deepEqual(unit.metadata, italic ? { Gender: 'Reference gender' } : {});
    }
    const mixed = '<c r="D1" t="inlineStr"><is><r><rPr><i/></rPr><t>Gen</t></r><r><t>der</t></r></is></c>';
    await assert.rejects(Codec.parseWorkbook(await withHintStyles(normal.replace(noStyle, mixed)), { filename: 'Thai.xlsx' }), /Mixed italic formatting/);
});
test('v4 never borrows an italic source heading for an editable translation', async () => {
    for (const normal of [
        sheet([row(1, [cell('A1', 'ID'), cell('B1', 'Text', 4), cell('C1', 'Translation')]), row(2, [cell('A2', 'blocked'), cell('B2', 'Reference only'), cell('C2', 'Unsafe target')])]),
        sheet([row(1, [cell('A1', 'ID'), cell('B1', 'Character', 4), cell('C1', 'Translation')]), row(2, [cell('A2', 'blocked'), cell('B2', 'Reference only'), cell('C2', 'Unsafe target')])]),
        sheet([row(1, [cell('A1', 'ID'), cell('B1', 'Name'), cell('C1', 'Translation'), cell('D1', 'Text', 6), cell('E1', 'Translation')]), row(2, [cell('A2', 'blocked'), cell('B2', 'English'), cell('C2', 'Target'), cell('D2', 'Reference only'), cell('E2', 'Unsafe target')])]),
    ]) await assert.rejects(Codec.parseWorkbook(await withHintStyles(normal), { filename: 'Thai.xlsx' }), /English source|recognized translation|source/i);
});
test('v4 nonitalic sources are not vetoed by legacy metadata heading names', async () => {
    const normal = sheet([
        row(1, [cell('A1', 'ID'), cell('B1', 'Character'), cell('C1', 'Translation')]),
        row(2, [cell('A2', 'character-source'), cell('B2', 'English character name'), cell('C2', 'Translated character name', 1)]),
    ]);
    const bytes = await withHintStyles(normal), unit = get(await Codec.parseWorkbook(bytes, { filename: 'Thai.xlsx' }), 'character-source');
    assert.equal(field(unit, 'Character').source, 'English character name'); assert.equal(field(unit, 'Character').target, 'Translated character name'); assert.deepEqual(unit.metadata, {});
    await assert.rejects(Codec.parseWorkbook(bytes, { filename: 'Thai.xlsx', parserVersion: 'clienttext-v3' }), /identify the English source/);
});
test('explicit v1-v3 replay preserves accepted Gender fields while v4 changes only italic interpretation', async () => {
    const normal = sheet([
        row(1, [cell('A1', 'ID'), cell('B1', 'Gender', 4), cell('C1', 'Name'), cell('D1', 'Translation')]),
        row(2, [cell('A2', 'replay'), cell('B2', 'Reference gender'), cell('C2', 'English'), cell('D2', 'Target', 1)]),
    ]);
    const bytes = await withHintStyles(normal); let legacyUnit;
    for (const parserVersion of ['clienttext-v1', 'clienttext-v2', 'clienttext-v3']) {
        const parsed = await Codec.parseWorkbook(bytes, { filename: 'Thai.xlsx', parserVersion }), unit = get(parsed, 'replay');
        assert.equal(field(unit, 'Gender').target, 'Reference gender'); assert.deepEqual(unit.metadata, {});
        if (legacyUnit) assert.deepEqual(unit, legacyUnit); else legacyUnit = unit;
        assert.deepEqual(await Codec.exportWorkbook(bytes, parsed, {}, { parserVersion }), bytes);
        await assert.rejects(Codec.exportWorkbook(bytes, parsed, {}, { parserVersion: 'clienttext-v4' }), /parser version does not match/);
    }
    const current = get(await Codec.parseWorkbook(bytes, { filename: 'Thai.xlsx' }), 'replay');
    assert.equal(field(current, 'Gender'), undefined); assert.deepEqual(current.metadata, { Gender: 'Reference gender' });
    assert.deepEqual(field(current, 'Name'), field(legacyUnit, 'Name')); assert.equal(current.id, legacyUnit.id);
});

test('v2 class dialogue variants are exact form identities with shared raw English and field-specific workload', async () => {
    const bytes = await workbook({ normal: classDialogue() });
    const parsed = await Codec.parseWorkbook(bytes, { filename: 'German.xlsx', role: 'gender', language: 'German', parserVersion: 'clienttext-v2' });
    const unit = get(parsed, 'dialogue');
    assert.equal(parsed.parserVersion, 'clienttext-v2'); assert.equal(parsed.version, 1);
    assert.deepEqual(Codec.CLASS_FORMS, State.CLASS_FORMS);
    assert.equal(unit.fields.length, 14); assert.equal(unit.developerNotes, 'Actual developer note');
    assert.deepEqual(unit.metadata, { 'Character Class': 'Class metadata' });
    assert.equal(parsed.warnings.some(warning => warning.code === 'CLIENTTEXT_METADATA_COLUMN'), false);
    for (const [index, form] of Codec.CLASS_FORMS.entries()) {
        const current = field(unit, 'Text', form);
        assert.equal(current.kind, 'form'); assert.equal(current.form, form); assert.equal(current.group, 'Text'); assert.equal(current.name, 'Text');
        assert.equal(current.source, ' Raw [Tag|display] {0} @\\n\nsecond '); assert.equal(current.sourceCell, 'C2');
        assert.equal(current.targetCell, String.fromCharCode(70 + index) + '2');
    }
    assert.equal(field(unit, 'Text', 'StrFour').required, false);
    assert.equal(field(unit, 'Text', 'IntFour').required, true); assert.equal(field(unit, 'Text', 'IntFour').originalMissing, true);
    assert.equal(field(unit, 'Text', 'DexFour').required, false); assert.equal(field(unit, 'Text', 'DexFour').outdated, true);
    assert.equal(field(unit, 'Text', 'DexFour').originalMissing, false);
    assert.equal(field(unit, 'Text', 'StrDexFour').target, ' @literal\\n raw\r\nactual\n\t ');
    assert.equal(field(unit, 'Text', 'StrIntFour').target, 'NONEXISTENT');
    assert.equal(field(unit, 'Text', 'StrFourb').required, true);
    assert.doesNotThrow(() => State.normalizeUnit(unit));
    const current = await Codec.parseWorkbook(bytes, { filename: 'German.xlsx', role: 'gender', language: 'German' });
    assert.equal(current.parserVersion, 'clienttext-v4'); assert.deepEqual(current.units, parsed.units, 'v4 retains the complete v2 class interpretation for unstyled layouts');
    const asset = version => ({ role: 'gender', hash: parsed.artifactHash, parserVersion: version });
    const accepted = await State.buildDescriptors(parsed.units, [asset('clienttext-v2')]), replayed = await State.buildDescriptors(parsed.units, [asset('clienttext-v2')]);
    assert.deepEqual(replayed, accepted, 'Explicit v2 descriptors replay the same accepted baseline identity');
    const upgraded = await State.buildDescriptors(current.units, [asset('clienttext-v4')]);
    assert.notEqual(upgraded.descriptors[0].baselineId, accepted.descriptors[0].baselineId, 'A new parser version establishes a separate baseline identity');
    await assert.rejects(Codec.exportWorkbook(bytes, parsed, {}, { parserVersion: 'clienttext-v3' }), /parser version does not match/);
});
test('class identities survive safe moved columns, notes and multiple identified source groups', async () => {
    const normal = sheet([
        row(1, [cell('A1', 'ID'), cell('B1', 'Name'), cell('C1', 'Translation'), cell('E1', 'Text'), cell('F1', 'MS'), cell('G1', 'FS'), cell('I1', 'Notes'), cell('L1', 'StrFourb')]),
        row(2, [cell('A2', 'moved'), cell('B2', 'A separate name'), cell('C2', 'Nom', 1), cell('E2', 'Class dialogue source'), cell('F2', 'Default', 1), empty('G2', 1), cell('I2', 'Source note'), cell('L2', 'Class-specific target', 1)]),
    ]);
    const parsed = await Codec.parseWorkbook(await workbook({ normal }), { filename: 'German.xlsx' }), unit = get(parsed, 'moved'), current = field(unit, 'Text', 'StrFourb');
    assert.equal(current.id, JSON.stringify(['Text', 'StrFourb'])); assert.equal(current.sourceCell, 'E2'); assert.equal(current.targetCell, 'L2');
    assert.equal(current.source, 'Class dialogue source'); assert.equal(current.group, 'Text'); assert.equal(unit.developerNotes, 'Source note');
    assert.equal(field(unit, 'Name').source, 'A separate name');
    const moved = normal.replace('r="L1"', 'r="Q1"').replace('r="L2"', 'r="Q2"');
    const shifted = field(get(await Codec.parseWorkbook(await workbook({ normal: moved }), { filename: 'German.xlsx' }), 'moved'), 'Text', 'StrFourb');
    assert.equal(shifted.id, current.id); assert.equal(shifted.source, current.source); assert.equal(shifted.targetCell, 'Q2');
});
test('ambiguous class sources, duplicate identities, reserved sources and editable formulas are blocked', async () => {
    const headers = [cell('A1', 'ID'), cell('C1', 'Text'), cell('D1', 'MS'), cell('E1', 'FS')];
    const cases = [
        [sheet([row(1, [...headers, cell('F1', 'New unpaired source'), cell('G1', 'StrFourb')]), row(2, [cell('A2', 'a'), cell('C2', 'English')])]), /unambiguously identify/],
        [sheet([row(1, [...headers, cell('F1', 'StrFourb'), cell('G1', 'StrFourb')]), row(2, [cell('A2', 'a'), cell('C2', 'English')])]), /Duplicate source field/],
        [sheet([row(1, [cell('A1', 'ID'), cell('B1', 'StrFourb'), cell('C1', 'Translation')]), row(2, [cell('A2', 'a'), cell('B2', 'Unsafe source')])]), /identify the English source/],
        [sheet([row(1, [cell('A1', 'ID'), cell('B1', 'Text'), cell('C1', 'StrFourb')]), row(2, [cell('A2', 'a'), cell('B2', 'Unidentified source')])]), /unambiguously identify/],
    ];
    for (const [normal, pattern] of cases) await assert.rejects(Codec.parseWorkbook(await workbook({ normal }), { filename: 'German.xlsx' }), pattern);
    const original = classDialogue();
    for (const normal of [original.replace(cell('C2', ' Raw [Tag|display] {0} @\\n\nsecond '), '<c r="C2"><f>1+1</f><v>2</v></c>'),
        original.replace(cell('L2', 'Original class translation', 1), '<c r="L2" s="1"><f>1+1</f><v>2</v></c>')])
        await assert.rejects(Codec.parseWorkbook(await workbook({ normal }), { filename: 'German.xlsx' }), /Formula/);
    await assert.rejects(Codec.parseWorkbook(await workbook({ normal: original.replace('</worksheet>', '<mergeCells><mergeCell ref="L2:M2"/></mergeCells></worksheet>') }), { filename: 'German.xlsx' }), /Merged editable/);
});
test('class exports patch only the chosen target while retaining exact text, native parts and other cells', async () => {
    const bytes = await workbook({ normal: classDialogue(), macro: true }), parsed = await Codec.parseWorkbook(bytes, { filename: 'German.xlsm', role: 'gender', parserVersion: 'clienttext-v2' });
    const unit = get(parsed, 'dialogue'), current = field(unit, 'Text', 'StrFourb'), authored = '=raw @\\n literal\r\nactual\n_x0020_ <continue> [Tag|display]';
    const output = await Codec.exportWorkbook(bytes, parsed, { [unit.id]: { values: { [current.id]: authored } } }, { parserVersion: 'clienttext-v2' });
    const reopened = await Codec.parseWorkbook(output, { filename: 'German.xlsm', role: 'gender' }), result = get(reopened, 'dialogue');
    assert.equal(field(result, 'Text', 'StrFourb').target, authored); assert.equal(field(result, 'Text', 'StrFourb').originalFill, 'D9D2E9');
    for (const original of unit.fields) if (original.id !== current.id) assert.deepEqual(result.fields.find(item => item.id === original.id), original);
    assert.equal(result.developerNotes, unit.developerNotes); assert.deepEqual(result.metadata, unit.metadata);
    const before = await JSZip.loadAsync(bytes), after = await JSZip.loadAsync(output);
    for (const name of Object.keys(before.files)) if (!before.files[name].dir && !['xl/worksheets/sheet1.xml', 'xl/styles.xml'].includes(name))
        assert.deepEqual(await after.file(name).async('uint8array'), await before.file(name).async('uint8array'), name);
    const omitTarget = text => withoutAddedTab(text).replace(/<c\b[^>]*\br="L2"[^>]*(?:\/>|>[\s\S]*?<\/c>)/, '<chosen-target/>');
    assert.equal(omitTarget(await after.file('xl/worksheets/sheet1.xml').async('string')), omitTarget(await before.file('xl/worksheets/sheet1.xml').async('string')));
    assert.deepEqual(await Codec.exportWorkbook(bytes, parsed, {}), bytes);
});
test('class workload fills distinguish optional blank, missing and reviewed outdated variants', async () => {
    const bytes = await workbook({ normal: classDialogue() }), parsed = await Codec.parseWorkbook(bytes, { filename: 'German.xlsx' }), unit = get(parsed, 'dialogue');
    const missing = field(unit, 'Text', 'IntFour'), outdated = field(unit, 'Text', 'DexFour'), optional = field(unit, 'Text', 'StrFour');
    const records = { [unit.id]: { values: { [missing.id]: 'Filled class field', [outdated.id]: '', [optional.id]: 'NONEXISTENT' }, reviewed: { [outdated.id]: State.sourceHash(outdated.source) } } };
    const exported = await Codec.exportWorkbook(bytes, parsed, records);
    const result = get(await Codec.parseWorkbook(exported, { filename: 'German.xlsx' }), 'dialogue');
    assert.equal(field(result, 'Text', 'IntFour').originalFill, 'D9D9D9'); assert.equal(field(result, 'Text', 'DexFour').originalFill, 'C6EFCE');
    assert.equal(field(result, 'Text', 'StrFour').target, 'NONEXISTENT'); assert.equal(field(result, 'Text', 'StrFour').originalFill, 'D9D2E9');
    assert.deepEqual(field(result, 'Text', 'StrDexFour'), field(unit, 'Text', 'StrDexFour'), 'Filling adjacent self-closing cells never consumes the next populated target');
    const unresolved = get(await Codec.parseWorkbook(await Codec.exportWorkbook(bytes, parsed, { [unit.id]: { values: { [outdated.id]: 'Authored but unreviewed' } } }), { filename: 'German.xlsx' }), 'dialogue');
    assert.equal(field(unresolved, 'Text', 'DexFour').originalFill, 'FF9966');
});
test('v1 snapshots replay their metadata authority and cannot silently export as v2', async () => {
    const bytes = await workbook({ normal: classDialogue(), macro: true });
    const options = { filename: 'German.xlsm', role: 'gender', parserVersion: 'clienttext-v1' }, legacy = await Codec.parseWorkbook(bytes, options), unit = get(legacy, 'dialogue');
    assert.equal(legacy.parserVersion, 'clienttext-v1'); assert.equal(unit.fields.length, 2);
    assert.equal(unit.metadata.StrFourb, 'Original class translation'); assert.equal(unit.metadata.IntFour, '');
    assert.equal(legacy.warnings.filter(warning => warning.code === 'CLIENTTEXT_METADATA_COLUMN').length, 12);
    const replay = await Codec.parseWorkbook(bytes, options); assert.deepEqual(replay.units, legacy.units);
    const asset = { role: 'gender', hash: legacy.artifactHash, parserVersion: 'clienttext-v1' };
    const first = await State.buildManifest(legacy.units, [asset]), repeated = await State.buildManifest(replay.units, [asset]);
    assert.deepEqual(first.descriptors, repeated.descriptors); assert.equal(first.descriptors[0].parserVersion, 'clienttext-v1');
    const oldSnapshot = { ...legacy }; delete oldSnapshot.parserVersion;
    assert.deepEqual(await Codec.exportWorkbook(bytes, oldSnapshot, {}), bytes);
    await assert.rejects(Codec.exportWorkbook(bytes, oldSnapshot, {}, { parserVersion: 'clienttext-v2' }), /parser version does not match/);
    await assert.rejects(Codec.exportWorkbook(bytes, legacy, { [unit.id]: { values: { [JSON.stringify(['Text', 'StrFourb'])]: 'Not authorized by v1' } } }), /unknown field/);
    const original = field(unit, 'Text', 'MS'), output = await Codec.exportWorkbook(bytes, legacy, { [unit.id]: { values: { [original.id]: 'Edited default translation' } } }, { parserVersion: 'clienttext-v1' });
    const before = await JSZip.loadAsync(bytes), after = await JSZip.loadAsync(output);
    assert.ok((await after.file('xl/worksheets/sheet1.xml').async('string')).includes(cell('L2', 'Original class translation', 1)));
    assert.equal(get(await Codec.parseWorkbook(output, options), 'dialogue').metadata.StrFourb, unit.metadata.StrFourb);
    assert.deepEqual(await after.file('xl/vbaProject.bin').async('uint8array'), await before.file('xl/vbaProject.bin').async('uint8array'));
    const current = await Codec.parseWorkbook(bytes, { filename: 'German.xlsm', role: 'gender' });
    await assert.rejects(Codec.exportWorkbook(bytes, current, {}, { parserVersion: 'clienttext-v1' }), /parser version does not match/);
    await assert.rejects(Codec.parseWorkbook(bytes, { ...options, parserVersion: 'clienttext-v5' }), /Unsupported ClientText parser version/);
    await assert.rejects(Codec.exportWorkbook(bytes, { ...legacy, parserVersion: 'clienttext-v5' }, {}), /Unsupported ClientText parser version/);
});
test('v3 accepts absent shared-string value elements without weakening present indexes or formula guards', async () => {
    const normal = sheet([
        row(1, [cell('A1', 'ID'), cell('B1', 'Name'), cell('C1', 'Translation'), cell('D1', 'Gender'), cell('E1', 'Context'), '<c r="F1" t="s"/>']),
        row(2, [cell('A2', 'blank'), cell('B2', 'English'), '<c r="C2" s="2" t="s"/>', '<c r="D2" s="3" t="s"/>', '<c r="E2" t="s"/>']),
        row(3, ['<c r="A3" t="s"/>', '<c r="B3" t="s"/>', '<c r="C3" t="s"/>']),
    ]);
    const bytes = await workbook({ normal }), parsed = await Codec.parseWorkbook(bytes, { filename: 'French.xlsx' }), unit = get(parsed, 'blank');
    assert.equal(parsed.parserVersion, 'clienttext-v4'); assert.equal(parsed.units.filter(item => item.sheet === 'Normal').length, 1);
    const replay = await Codec.parseWorkbook(bytes, { filename: 'French.xlsx', parserVersion: 'clienttext-v3' });
    assert.deepEqual(parsed.units, replay.units, 'v4 retains v3 shared-string blank handling and exact field interpretation');
    assert.equal(field(unit, 'Name').target, ''); assert.equal(field(unit, 'Name').originalFill, 'FA8072'); assert.equal(field(unit, 'Name').originalMissing, true);
    assert.equal(field(unit, 'Gender').target, ''); assert.equal(field(unit, 'Gender').outdated, true); assert.deepEqual(unit.metadata, { Context: '' });
    assert.deepEqual(await Codec.exportWorkbook(bytes, parsed, {}), bytes);
    for (const parserVersion of ['clienttext-v1', 'clienttext-v2'])
        await assert.rejects(Codec.parseWorkbook(bytes, { filename: 'French.xlsx', parserVersion }), /Invalid shared-string reference/);
    for (const badValue of ['<v/>', '<v></v>', '<v>bad</v>', '<v>-1</v>', '<v>1.0</v>', '<v>1</v>']) {
        const malformed = normal.replace('<c r="C2" s="2" t="s"/>', '<c r="C2" s="2" t="s">' + badValue + '</c>');
        await assert.rejects(Codec.parseWorkbook(await workbook({ normal: malformed, replace: { 'xl/sharedStrings.xml': `<sst xmlns="${NS}"><si><t>Only one value</t></si></sst>` } }), { filename: 'French.xlsx' }), /Invalid shared-string reference/);
    }
    for (const coordinate of ['A2', 'B2', 'C2', 'D2']) {
        const guarded = normal.replace(new RegExp('<c\\b[^>]*?\\br="' + coordinate + '"[^>]*?(?:/>|>[\\s\\S]*?</c>)'), '<c r="' + coordinate + '" t="s"><f>1+1</f></c>');
        await assert.rejects(Codec.parseWorkbook(await workbook({ normal: guarded }), { filename: 'French.xlsx' }), /Formula/);
    }
    const orphan = normal.replace('<c r="B3" t="s"/>', cell('B3', 'Unidentified source'));
    await assert.rejects(Codec.parseWorkbook(await workbook({ normal: orphan }), { filename: 'French.xlsx' }), /Nonempty row has no ID/);
});
const namedForms = () => sheet([
    row(1, [cell('A1', 'ID'), cell('B1', 'Display Name'), cell('C1', 'Normal Translation'), cell('D1', 'Possessive Translation'), cell('E1', 'Notes')]),
    row(2, [cell('A2', 'optional'), cell('B2', ' Raw English @\\n\r\nactual '), cell('C2', 'Normal target', 1), empty('D2', 1), cell('E2', 'Source note')]),
    row(3, [cell('A3', 'required'), cell('B3', 'New English'), empty('C3', 1), empty('D3', 2)]),
    row(4, [cell('A4', 'outdated'), cell('B4', 'Changed English'), cell('C4', 'Old normal', 3), empty('D4', 3)]),
    row(5, [cell('A5', 'filled'), cell('B5', 'Original English'), cell('C5', 'Original normal', 1), cell('D5', 'Original possessive', 1)]),
    row(6, [cell('A6', 'audio'), cell('B6', '[NOAUDIO]'), empty('C6', 2), empty('D6', 2)]),
]);
const namedWorkbook = normal => workbook({ normal, replace: { 'xl/workbook.xml': `<workbook xmlns="${NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="BaseItemTypes" sheetId="1" r:id="rId1"/><sheet name="Words_Gender" sheetId="2" r:id="rId2"/></sheets></workbook>` } });
test('v3 BaseItemTypes named forms share exact English but keep identities and requiredness distinct', async () => {
    const bytes = await namedWorkbook(namedForms()), parsed = await Codec.parseWorkbook(bytes, { filename: 'Turkish.xlsx', language: 'Turkish' });
    const replay = await Codec.parseWorkbook(bytes, { filename: 'Turkish.xlsx', language: 'Turkish', parserVersion: 'clienttext-v3' });
    assert.deepEqual(parsed.units, replay.units, 'v4 retains all v3 named-form identities for nonitalic layouts');
    const unit = get(parsed, 'optional', 'BaseItemTypes'), normal = field(unit, 'Display Name', 'Normal Translation'), possessive = field(unit, 'Display Name', 'Possessive Translation');
    assert.equal(normal.id, '["Display Name","Normal Translation"]'); assert.equal(possessive.id, '["Display Name","Possessive Translation"]');
    for (const current of [normal, possessive]) {
        assert.equal(current.kind, 'form'); assert.equal(current.group, 'Display Name'); assert.equal(current.sourceCell, 'B2'); assert.equal(current.source, ' Raw English @\\n\r\nactual ');
        assert.equal(State.isNamedForm(current), true); assert.equal(State.allowsNonexistent(current), false);
    }
    assert.equal(normal.targetCell, 'C2'); assert.equal(possessive.targetCell, 'D2'); assert.equal(normal.required, true); assert.equal(possessive.required, false);
    const missing = get(parsed, 'required', 'BaseItemTypes');
    assert.equal(field(missing, 'Display Name', 'Normal Translation').originalMissing, true, 'Normal remains required when an active English field has an unmarked blank');
    assert.equal(field(missing, 'Display Name', 'Possessive Translation').originalMissing, true);
    const outdated = field(get(parsed, 'outdated', 'BaseItemTypes'), 'Display Name', 'Possessive Translation');
    assert.equal(outdated.required, false); assert.equal(outdated.originalMissing, false); assert.equal(outdated.outdated, true);
    assert.equal(field(get(parsed, 'filled', 'BaseItemTypes'), 'Display Name', 'Possessive Translation').required, true);
    assert.equal(get(parsed, 'audio', 'BaseItemTypes').fields.some(current => current.required || current.originalMissing || current.outdated), false);
    assert.equal(unit.developerNotes, 'Source note'); assert.deepEqual(unit.metadata, {}); assert.deepEqual(await Codec.exportWorkbook(bytes, parsed, {}), bytes);
    assert.equal(parsed.warnings.length, 0); assert.doesNotThrow(() => parsed.units.forEach(State.normalizeUnit));
    for (const parserVersion of ['clienttext-v1', 'clienttext-v2'])
        await assert.rejects(Codec.parseWorkbook(bytes, { filename: 'Turkish.xlsx', parserVersion }), /no recognized translation fields/);
    const descriptor = await State.buildDescriptors(parsed.units, [{ role: 'normal', hash: parsed.artifactHash, parserVersion: parsed.parserVersion }]);
    assert.equal(descriptor.descriptors[0].parserVersion, 'clienttext-v4');
    await assert.rejects(Codec.exportWorkbook(bytes, parsed, {}, { parserVersion: 'clienttext-v2' }), /parser version does not match/);
});
test('named forms require the exact supported source cluster and preserve literal NONEXISTENT without sentinel semantics', async () => {
    for (const normal of [namedForms().replace('Display Name</t>', 'Other source</t>'), namedForms().replace('r="D1"', 'r="F1"'),
        namedForms().replace(cell('D1', 'Possessive Translation'), ''), namedForms().replace(cell('D1', 'Possessive Translation'), cell('D1', 'Normal Translation'))])
        await assert.rejects(Codec.parseWorkbook(await namedWorkbook(normal), { filename: 'Turkish.xlsx' }), /Unsupported named-form columns/);
    await assert.rejects(Codec.parseWorkbook(await workbook({ normal: namedForms() }), { filename: 'Turkish.xlsx' }), /Unsupported named-form columns/);
    const bytes = await namedWorkbook(namedForms()), parsed = await Codec.parseWorkbook(bytes, { filename: 'Turkish.xlsx' }), unit = get(parsed, 'optional', 'BaseItemTypes');
    for (const current of unit.fields) {
        const output = await Codec.exportWorkbook(bytes, parsed, { [unit.id]: { values: { [current.id]: ' NONEXISTENT ' } } });
        const reopened = await Codec.parseWorkbook(output, { filename: 'Turkish.xlsx' }), exported = get(reopened, 'optional', 'BaseItemTypes').fields.find(item => item.id === current.id);
        assert.equal(exported.target, ' NONEXISTENT '); assert.equal(State.allowsNonexistent(exported), false, 'A named-form literal is not a grammatical absent-form sentinel');
    }
    const sentinel = await Codec.parseWorkbook(await namedWorkbook(namedForms().replace('Normal target</t>', 'NONEXISTENT</t>')), { filename: 'Turkish.xlsx' });
    assert.equal(sentinel.warnings.some(warning => warning.code === 'CLIENTTEXT_NONEXISTENT_FIELD'), false);
    for (const coordinate of ['B2', 'C2', 'D2']) {
        const guarded = namedForms().replace(new RegExp('<c\\b[^>]*?\\br="' + coordinate + '"[^>]*?(?:/>|>[\\s\\S]*?</c>)'), '<c r="' + coordinate + '"><f>1+1</f><v>2</v></c>');
        await assert.rejects(Codec.parseWorkbook(await namedWorkbook(guarded), { filename: 'Turkish.xlsx' }), /Formula/);
    }
});
test('named-form exports patch each independent target without rewriting English, notes or neighboring cells', async () => {
    const bytes = await namedWorkbook(namedForms()), parsed = await Codec.parseWorkbook(bytes, { filename: 'Turkish.xlsx' }), unit = get(parsed, 'optional', 'BaseItemTypes');
    const before = await JSZip.loadAsync(bytes);
    for (const form of ['Normal Translation', 'Possessive Translation']) {
        const current = field(unit, 'Display Name', form), authored = '=Raw ı İ @\\n literal\r\nactual\n_x0020_ <continue> [Tag|display]';
        const output = await Codec.exportWorkbook(bytes, parsed, { [unit.id]: { values: { [current.id]: authored } } });
        const reopened = await Codec.parseWorkbook(output, { filename: 'Turkish.xlsx' }), result = get(reopened, 'optional', 'BaseItemTypes');
        assert.equal(field(result, 'Display Name', form).target, authored);
        for (const original of unit.fields) if (original.id !== current.id) assert.deepEqual(result.fields.find(item => item.id === original.id), original);
        assert.equal(result.developerNotes, unit.developerNotes); assert.deepEqual(result.metadata, unit.metadata);
        const after = await JSZip.loadAsync(output), omitTarget = text => withoutAddedTab(text).replace(new RegExp('<c\\b[^>]*?\\br="' + current.targetCell + '"[^>]*?(?:/>|>[\\s\\S]*?</c>)'), '<chosen-target/>');
        for (const name of Object.keys(before.files)) if (!before.files[name].dir && !['xl/worksheets/sheet1.xml', 'xl/styles.xml'].includes(name))
            assert.deepEqual(await after.file(name).async('uint8array'), await before.file(name).async('uint8array'), name);
        assert.equal(omitTarget(await after.file('xl/worksheets/sheet1.xml').async('string')), omitTarget(await before.file('xl/worksheets/sheet1.xml').async('string')));
    }
});
test('headers map notes, optional Gender and sparse forms without changing raw text', async () => {
    const bytes = await workbook(), progress = [];
    const parsed = await Codec.parseWorkbook(bytes, { filename: 'French.xlsx', role: 'gender', language: 'French', onProgress: value => progress.push(value) });
    assert.equal(parsed.units.length, 5); assert.equal(parsed.sheets.length, 2);
    assert.match(parsed.artifactHash, /^[a-f0-9]{64}$/); assert.equal(parsed.assetHash, parsed.artifactHash);
    const record = get(parsed, 'record'); assert.equal(record.developerNotes, 'Developer instruction');
    assert.equal(record.id, JSON.stringify(['gender', 'Normal', 'record']));
    assert.equal(field(record, 'Name').sourceCell, 'C2'); assert.equal(field(record, 'Name').targetCell, 'D2');
    assert.equal(field(record, 'Name').originalMissing, true); assert.equal(field(record, 'Description').outdated, true);
    assert.equal(field(record, 'Gender').kind, 'gender'); assert.equal(field(record, 'Gender').source, '');
    const forms = get(parsed, 'record', 'Words_Gender'); assert.equal(field(forms, 'Text', 'NS').target, ' NONEXISTENT');
    assert.equal(field(forms, 'Text', 'FS').required, false);
    assert.equal(field(get(parsed, 'new', 'Words_Gender'), 'Text', 'FS').originalMissing, true);
    assert.equal(field(get(parsed, 'noaudio'), 'Name').required, false); assert.equal(field(get(parsed, 'noaudio'), 'Name').originalMissing, false);
    assert.ok(progress.some(value => value.sheet === 'Words_Gender')); assert.equal(progress.at(-1).percent, 100);
    assert.doesNotThrow(() => parsed.units.forEach(State.normalizeUnit));
});
test('the vendored browser UMD dependency loads through its default export', async () => {
    const context = { JSZip, ClientTextState: State, Uint8Array, ArrayBuffer, TextDecoder, crypto: globalThis.crypto };
    runInNewContext(readFileSync(require.resolve('../public/vendor/fast-xml-parser-5.11.2.min.js'), 'utf8'), context);
    runInNewContext(readFileSync(require.resolve('../public/clientTextCodec.js'), 'utf8'), context);
    const parsed = await context.ClientTextCodec.parseWorkbook(await workbook(), { filename: 'French.xlsx' });
    assert.equal(parsed.units.length, 5);
});
test('NPCText and NPCTalk Context references retain raw cells through v1/v2 parsing and targeted XLSM exports', async () => {
    const contexts = [' Metadata/Characters/Str/StrFourb\r\nMetadata/Characters/Dex/DexFour @literal\\n <ref> ', 'Metadata/Characters/Int/IntFour\n\tMetadata/Characters/StrDex/StrDexFour'];
    const normal = sheet([
        row(1, [cell('A1', 'ID'), cell('B1', 'Context'), cell('C1', 'Text'), cell('D1', 'Translation'), cell('E1', 'Notes')]),
        row(2, [cell('A2', 'dialogue'), cell('B2', contexts[0]), cell('C2', 'English dialogue'), cell('D2', 'Original dialogue', 1), cell('E2', 'Separate developer note')]),
    ]);
    const talk = sheet([
        row(1, [cell('A1', 'ID'), cell('B1', 'Context'), cell('C1', 'DisplayName'), cell('D1', 'Translation'), cell('E1', 'DisplayNameConsole'), cell('F1', 'Translation'), cell('G1', 'Translation Note')]),
        row(2, [cell('A2', 'talk'), cell('B2', contexts[1]), cell('C2', 'Speaker'), cell('D2', 'Original speaker', 1), cell('E2', 'Console speaker'), cell('F2', 'Original console speaker', 1), cell('G2', 'Separate translation note')]),
    ]);
    const bytes = await workbook({ macro: true, normal, replace: {
        'xl/workbook.xml': `<workbook xmlns="${NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="NPCText" sheetId="1" r:id="rId1"/><sheet name="NPCTalk" sheetId="2" r:id="rId2"/></sheets></workbook>`,
        'xl/worksheets/sheet2.xml': talk,
    } });
    let legacyUnits;
    for (const parserVersion of ['clienttext-v1', 'clienttext-v2']) {
        const options = { filename: 'Thai.xlsm', language: 'Thai', parserVersion }, parsed = await Codec.parseWorkbook(bytes, options);
        const npc = get(parsed, 'dialogue', 'NPCText'), npcTalk = get(parsed, 'talk', 'NPCTalk');
        assert.equal(parsed.parserVersion, parserVersion);
        assert.deepEqual(npc.metadata, { Context: contexts[0] }); assert.deepEqual(npcTalk.metadata, { Context: contexts[1] });
        assert.equal(npc.developerNotes, 'Separate developer note'); assert.equal(npcTalk.developerNotes, 'Separate translation note');
        assert.equal(npc.fields.some(field => field.name === 'Context'), false);
        assert.equal(parsed.warnings.some(warning => warning.code === 'CLIENTTEXT_METADATA_COLUMN' && warning.message.includes('Context')), false);
        assert.deepEqual(await Codec.exportWorkbook(bytes, parsed, {}), bytes, 'Reference metadata never rewrites an untouched original');
        if (legacyUnits) {
            assert.deepEqual(parsed.units, legacyUnits, 'Explicit v1 metadata and editable field identities remain unchanged in v2');
            assert.deepEqual(parsed.units.map(State.compactUnit), legacyUnits.map(State.compactUnit), 'Context retains its original baseline hash authority');
        } else legacyUnits = parsed.units;
        const authored = 'Translated dialogue\nSecond line', consoleName = 'Translated console name';
        const output = await Codec.exportWorkbook(bytes, parsed, {
            [npc.id]: { values: { [field(npc, 'Text').id]: authored } },
            [npcTalk.id]: { values: { [field(npcTalk, 'DisplayNameConsole').id]: consoleName } },
        }, { parserVersion });
        const reopened = await Codec.parseWorkbook(output, options), exportedNpc = get(reopened, 'dialogue', 'NPCText'), exportedTalk = get(reopened, 'talk', 'NPCTalk');
        assert.equal(field(exportedNpc, 'Text').target, authored); assert.equal(field(exportedTalk, 'DisplayNameConsole').target, consoleName);
        assert.deepEqual(exportedNpc.metadata, npc.metadata); assert.deepEqual(exportedTalk.metadata, npcTalk.metadata);
        assert.equal(exportedNpc.developerNotes, npc.developerNotes); assert.equal(exportedTalk.developerNotes, npcTalk.developerNotes);
        assert.deepEqual(field(exportedTalk, 'DisplayName'), field(npcTalk, 'DisplayName'));
        const before = await JSZip.loadAsync(bytes), after = await JSZip.loadAsync(output), changed = new Map([['xl/worksheets/sheet1.xml', 'D2'], ['xl/worksheets/sheet2.xml', 'F2']]);
        for (const name of Object.keys(before.files)) {
            if (before.files[name].dir || name === 'xl/styles.xml') continue;
            if (!changed.has(name)) assert.deepEqual(await after.file(name).async('uint8array'), await before.file(name).async('uint8array'), name);
            else {
                const omitTarget = text => withoutAddedTab(text).replace(new RegExp('<c\\b[^>]*\\br="' + changed.get(name) + '"[^>]*(?:/>|>[\\s\\S]*?</c>)'), '<chosen-target/>');
                assert.equal(omitTarget(await after.file(name).async('string')), omitTarget(await before.file(name).async('string')), 'Context and all unrelated cells stay byte-identical in ' + name);
            }
        }
    }
});
test('recognizing Context references does not reinterpret existing source headings or ambiguous class layouts', async () => {
    const normal = sheet([
        row(1, [cell('A1', 'ID'), cell('B1', 'Context'), cell('C1', 'Translation')]),
        row(2, [cell('A2', 'context-source'), cell('B2', 'Existing source heading'), cell('C2', 'Existing translation', 1)]),
    ]);
    for (const parserVersion of ['clienttext-v1', 'clienttext-v2']) {
        const unit = get(await Codec.parseWorkbook(await workbook({ normal }), { filename: 'Thai.xlsx', parserVersion }), 'context-source');
        assert.equal(field(unit, 'Context').source, 'Existing source heading'); assert.deepEqual(unit.metadata, {});
    }
    const ambiguous = sheet([
        row(1, [cell('A1', 'ID'), cell('B1', 'Text'), cell('C1', 'MS'), cell('D1', 'FS'), cell('E1', 'Context'), cell('F1', 'StrFourb')]),
        row(2, [cell('A2', 'ambiguous'), cell('B2', 'English'), cell('C2', 'Default'), cell('E2', 'Metadata/Characters/Str/StrFourb'), cell('F2', 'Class translation')]),
    ]);
    await assert.rejects(Codec.parseWorkbook(await workbook({ normal: ambiguous }), { filename: 'Thai.xlsx', parserVersion: 'clienttext-v2' }), /unambiguously identify/);
});
test('complete XLSM exports patch only targets and cloned status styles', async () => {
    const bytes = await workbook({ macro: true }), parsed = await Codec.parseWorkbook(bytes, { filename: 'French.xlsm', role: 'normal' });
    const record = get(parsed, 'record'), complete = get(parsed, 'complete'), forms = get(parsed, 'record', 'Words_Gender');
    const saved = {
        [record.id]: { values: { [field(record, 'Name').id]: 'Filled', [field(record, 'Description').id]: 'Old description' }, reviewed: { [field(record, 'Description').id]: State.sourceHash(field(record, 'Description').source) } },
        [complete.id]: { values: { [field(complete, 'Name').id]: '=Literal _x0020_ & <angle>\r\nnext' } },
        [forms.id]: { values: { [field(forms, 'Text', 'FS').id]: 'Forte' } },
    };
    const progress = [], output = await Codec.exportWorkbook(bytes, parsed, saved, { onProgress: value => progress.push(value) });
    const result = await Codec.parseWorkbook(output, { filename: 'French.xlsm', role: 'normal' });
    assert.equal(field(get(result, 'record'), 'Name').originalFill, 'D9D9D9');
    assert.equal(field(get(result, 'record'), 'Description').originalFill, 'C6EFCE');
    assert.equal(field(get(result, 'complete'), 'Name').originalFill, 'D9D2E9');
    assert.equal(field(get(result, 'complete'), 'Name').target, '=Literal _x0020_ & <angle>\r\nnext');
    assert.equal(field(get(result, 'record', 'Words_Gender'), 'Text', 'FS').target, 'Forte');
    assert.equal(field(get(result, 'record'), 'Name').source, 'Sword');
    assert.equal(await tabColor(output), Codec.FILLS.revised, 'Resolved normal sheet reflects its eligible saved correction');
    assert.equal(await tabColor(output, 'xl/worksheets/sheet2.xml'), Codec.FILLS.missing, 'Unresolved forms keep their own sheet red independently');
    const before = await JSZip.loadAsync(bytes), after = await JSZip.loadAsync(output);
    for (const name of ['xl/vbaProject.bin', 'xl/native.bin', 'xl/metadata', 'xl/workbook.xml', '[Content_Types].xml', 'xl/_rels/workbook.xml.rels']) assert.deepEqual(await after.file(name).async('uint8array'), await before.file(name).async('uint8array'), name);
    assert.ok((await after.file('xl/styles.xml').async('string')).includes('<alignment wrapText="1"/>'));
    assert.ok((await after.file('xl/worksheets/sheet1.xml').async('string')).includes('<keep xmlns="urn:native">preserve</keep>'));
    assert.equal(progress.at(-1).percent, 100);
});
test('unreviewed outdated fields keep orange and stale review hashes are rejected', async () => {
    const bytes = await workbook(), parsed = await Codec.parseWorkbook(bytes, { filename: 'French.xlsx' }), unit = get(parsed, 'record'), f = field(unit, 'Description');
    await assert.rejects(Codec.exportWorkbook(bytes, parsed, { [unit.id]: { values: { [f.id]: 'Changed but unreviewed' }, reviewed: { [f.id]: State.sourceHash('Another source') } } }), /review does not match/);
    const output = await Codec.exportWorkbook(bytes, parsed, { [unit.id]: { values: { [f.id]: 'Changed but unreviewed' } } });
    const result = await Codec.parseWorkbook(output, { filename: 'French.xlsx' });
    assert.equal(field(get(result, 'record'), 'Description').originalFill, 'FF9966');
});

test('ClientText raw formatting survives draft, durable save, history and real XLSM export', async () => {
    const bytes = await workbook({ macro: true }), parsed = await Codec.parseWorkbook(bytes, { filename: 'Thai.xlsm', role: 'normal', language: 'Thai' });
    const unit = get(parsed, 'complete'), current = field(unit, 'Name');
    const raw = '<i>{<bold>{<underline>{ไทย {0}%}}} <rgb(12,34,56)>{สี} <<icon>> <continue>\r\n<unknown>{raw} @ literal\\n';
    const { fixture, scope } = require('./clienttext-storage-fixture.cjs'), f = fixture();
    await f.store.import(scope, { units: parsed.units, assets: [{ role: 'normal', name: 'Thai.xlsm', hash: parsed.artifactHash, blob: new Blob([bytes]) }] });
    const values = State.valuesFor(unit); values[current.id] = raw;
    const draft = await f.store.putDraft(scope, unit.id, { values, reviewed: {} });
    assert.equal((await f.store.getDraft(scope, unit.id)).values[current.id], raw);
    const accepted = await f.store.save(scope, unit.id, { jobId: 'preserve-decoration-tags', values: draft.values, reviewed: {}, expectedRevision: 0, expectedDraftRevision: draft.revision });
    assert.equal(accepted.saved.values[current.id], raw);
    assert.equal((await f.store.listHistory(scope, unit.id)).at(-1).after.values[current.id], raw);
    assert.equal(field(await f.store.getUnit(scope, unit.id), 'Name').target, current.target, 'the immutable original retains its raw target');
    const output = await Codec.exportWorkbook(bytes, parsed, await f.store.getSaved(scope));
    const exported = await Codec.parseWorkbook(output, { filename: 'Thai.xlsm', language: 'Thai' });
    assert.equal(field(get(exported, 'complete'), 'Name').target, raw);
    assert.equal(field(get(exported, 'complete'), 'Name').source, current.source);
    const before = await JSZip.loadAsync(bytes), after = await JSZip.loadAsync(output);
    assert.deepEqual(await after.file('xl/vbaProject.bin').async('uint8array'), await before.file('xl/vbaProject.bin').async('uint8array'));
});
test('affected-only export matches full-baseline bytes for Saved work and source-only reviews', async () => {
    const bytes = await workbook({ macro: true }), parsed = await Codec.parseWorkbook(bytes, { filename: 'Thai.xlsm', role: 'normal', language: 'Thai' });
    const changed = get(parsed, 'record'), sourceOnly = get(parsed, 'complete'), changedField = field(changed, 'Name'), reviewedField = field(sourceOnly, 'Name');
    const saved = {
        [changed.id]: { values: { [changedField.id]: 'Saved\r\nraw text' }, reviewed: {} },
        [sourceOnly.id]: { values: {}, reviewed: {}, outdated: [reviewedField.id], saved: false }
    };
    const affected = { ...parsed, units: parsed.units.filter(unit => saved[unit.id]) };
    assert.ok(affected.units.length < parsed.units.length);
    assert.deepEqual(await Codec.exportWorkbook(bytes, affected, saved), await Codec.exportWorkbook(bytes, parsed, saved));
    assert.deepEqual(await Codec.exportWorkbook(bytes, { ...parsed, units: [] }, {}), bytes, 'an untouched workbook role retains exact original bytes');
});

test('source advancement paints unresolved review orange, then green, without Revised', async () => {
    const bytes = await workbook(), parsed = await Codec.parseWorkbook(bytes, { filename: 'French.xlsx' }), unit = get(parsed, 'complete'), f = field(unit, 'Name');
    const saved = { values: { [f.id]: f.target }, outdated: [f.id], saved: false };
    const unresolved = await Codec.parseWorkbook(await Codec.exportWorkbook(bytes, parsed, { [unit.id]: saved }), { filename: 'French.xlsx' });
    assert.equal(field(get(unresolved, 'complete'), 'Name').originalFill, 'FF9966');
    const reviewed = { ...saved, reviewed: { [f.id]: State.sourceHash(f.source) } };
    const resolved = await Codec.parseWorkbook(await Codec.exportWorkbook(bytes, parsed, { [unit.id]: reviewed }), { filename: 'French.xlsx' });
    assert.equal(field(get(resolved, 'complete'), 'Name').originalFill, 'C6EFCE');
    assert.deepEqual(await Codec.exportWorkbook(bytes, parsed, { [unit.id]: { values: { [f.id]: f.target }, saved: false } }), bytes);
    const missing = get(parsed, 'record'), required = field(missing, 'Name');
    const stillMissing = await Codec.parseWorkbook(await Codec.exportWorkbook(bytes, parsed, { [missing.id]: { values: { [required.id]: '' }, outdated: [required.id], reviewed: { [required.id]: State.sourceHash(required.source) } } }), { filename: 'French.xlsx' });
    assert.equal(field(get(stillMissing, 'record'), 'Name').originalFill, 'FA8072');
    const filled = await Codec.parseWorkbook(await Codec.exportWorkbook(bytes, parsed, { [missing.id]: { values: { [required.id]: 'Filled' }, outdated: [required.id], reviewed: { [required.id]: State.sourceHash(required.source) } } }), { filename: 'French.xlsx' });
    assert.equal(field(get(filled, 'record'), 'Name').originalFill, 'D9D9D9');
});
test('no-change and reverted complete saves preserve the original package exactly', async () => {
    const bytes = await workbook(), parsed = await Codec.parseWorkbook(bytes, { filename: 'French.xlsx' }), unit = get(parsed, 'complete'), f = field(unit, 'Name');
    assert.deepEqual(await Codec.exportWorkbook(bytes, parsed, {}), bytes);
    assert.deepEqual(await Codec.exportWorkbook(bytes, parsed, { [unit.id]: { values: { [f.id]: f.target } } }), bytes);
    await assert.rejects(Codec.exportWorkbook(new Uint8Array([...bytes, 0]), parsed, {}), /does not match/);
});

test('arbitrary original Gender strings survive complete saves, history and edited workbook exports verbatim', async () => {
    const values = ['-', ' ', '  custom\tvalue  ', 'NONEXISTENT', '  first\r\nsecond\nthird  '];
    const normal = sheet([
        row(1, [cell('A1', 'ID'), cell('B1', 'Name'), cell('C1', 'Translation'), cell('D1', 'Gender'), cell('E1', 'Notes'), cell('F1', 'Character')]),
        ...values.map((value, index) => row(index + 2, [cell('A' + (index + 2), 'raw-' + index), cell('B' + (index + 2), 'English ' + index),
            cell('C' + (index + 2), 'Original ' + index, 1), cell('D' + (index + 2), value, 1), cell('E' + (index + 2), 'Developer note ' + index), cell('F' + (index + 2), 'Immutable metadata ' + index)])),
    ]);
    const bytes = await workbook({ normal, macro: true }), parsed = await Codec.parseWorkbook(bytes, { filename: 'German.xlsm', language: 'German' });
    assert.equal(parsed.warnings.some(warning => warning.code === 'CLIENTTEXT_GENDER_VALUE' || warning.code === 'CLIENTTEXT_NONEXISTENT_FIELD'), false);
    assert.deepEqual(await Codec.exportWorkbook(bytes, parsed, {}), bytes, 'Arbitrary baseline metadata alone never rewrites an original');
    const { fixture, scope: baseScope } = require('./clienttext-storage-fixture.cjs'), f = fixture(), scope = { ...baseScope, language: 'German' };
    await f.store.import(scope, { units: parsed.units, assets: [{ role: 'normal', name: 'German.xlsm', hash: parsed.artifactHash, blob: new Blob([bytes]) }] });
    const records = {};
    for (let index = 0; index < values.length; index++) {
        const unit = get(parsed, 'raw-' + index), gender = field(unit, 'Gender'), name = field(unit, 'Name'), savedValues = State.valuesFor(unit);
        assert.equal(gender.target, values[index]); savedValues[name.id] += ' [authored]';
        records[unit.id] = (await f.store.save(scope, unit.id, { jobId: 'raw-gender-' + index, values: savedValues, reviewed: {} })).saved;
        assert.equal(records[unit.id].values[gender.id], values[index]);
        assert.equal((await f.store.listHistory(scope, unit.id)).at(-1).after.values[gender.id], values[index]);
        assert.equal(field(await f.store.getUnit(scope, unit.id), 'Gender').target, values[index], 'Immutable originals retain the exact metadata');
    }
    const exported = await Codec.exportWorkbook(bytes, parsed, records), reopened = await Codec.parseWorkbook(exported, { filename: 'German.xlsm' });
    const before = await JSZip.loadAsync(bytes), after = await JSZip.loadAsync(exported), exportedSheet = await after.file('xl/worksheets/sheet1.xml').async('string');
    for (let index = 0; index < values.length; index++) {
        const original = get(parsed, 'raw-' + index), current = get(reopened, 'raw-' + index);
        assert.equal(field(current, 'Gender').target, values[index]);
        assert.equal(field(current, 'Name').target, field(original, 'Name').target + ' [authored]');
        assert.equal(field(current, 'Name').source, field(original, 'Name').source);
        assert.equal(current.developerNotes, original.developerNotes); assert.deepEqual(current.metadata, original.metadata);
        assert.ok(exportedSheet.includes(cell('D' + (index + 2), values[index], 1)), 'Unedited raw Gender cell XML remains unchanged');
    }
    for (const name of ['xl/vbaProject.bin', 'xl/native.bin', 'xl/metadata', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/worksheets/sheet2.xml'])
        assert.deepEqual(await after.file(name).async('uint8array'), await before.file(name).async('uint8array'), name);
});

test('authored Gender metadata accepts arbitrary strings while non-text saves and exports remain rejected', async () => {
    const bytes = await workbook(), parsed = await Codec.parseWorkbook(bytes, { filename: 'German.xlsx' }), unit = get(parsed, 'complete'), gender = field(unit, 'Gender');
    for (const value of ['-', ' ', ' custom\t@literal\\n ', 'NONEXISTENT', ' first\r\nsecond\n ']) {
        const values = State.valuesFor(unit); values[gender.id] = value;
        assert.equal(State.normalizeValues(unit, values)[gender.id], value);
        const result = await Codec.parseWorkbook(await Codec.exportWorkbook(bytes, parsed, { [unit.id]: { values } }), { filename: 'German.xlsx' });
        assert.equal(field(get(result, 'complete'), 'Gender').target, value);
        assert.equal(result.warnings.some(warning => warning.code === 'CLIENTTEXT_GENDER_VALUE' || warning.code === 'CLIENTTEXT_NONEXISTENT_FIELD'), false);
    }
    const { fixture, scope, asset } = require('./clienttext-storage-fixture.cjs'), f = fixture();
    await f.store.import(scope, { units: [unit], assets: [asset] });
    for (const value of [null, 0, false, [], {}]) {
        const values = State.valuesFor(unit); values[gender.id] = value;
        assert.throws(() => State.normalizeValues(unit, values), /non-text/);
        await assert.rejects(f.store.save(scope, unit.id, { jobId: 'invalid-gender-' + JSON.stringify(value), values, reviewed: {} }), /non-text/);
        await assert.rejects(Codec.exportWorkbook(bytes, parsed, { [unit.id]: { values } }), /field is not text/);
    }
    assert.deepEqual(await f.store.getSaved(scope), {}); assert.deepEqual(await f.store.listHistory(scope, unit.id), []);
});
test('unsafe layouts, duplicate IDs, editable formulas and XML entities are blocked', async () => {
    const bytes = await workbook(), z = await JSZip.loadAsync(bytes), original = await z.file('xl/worksheets/sheet1.xml').async('string');
    const cases = [
        [original.replace('complete', 'record'), /Duplicate ID/],
        [original.replace('<is><t xml:space="preserve">Sword</t></is>', '<f>SUM(1,2)</f><v>3</v>'), /Formula/],
        [original.replace('Name</t>', 'ID</t>'), /exactly one ID/],
        [original.replace('</row>', cell('I1', 'Tags') + cell('J1', 'Tags') + '</row>'), /Duplicate metadata/],
        [original.replace('<?xml version="1.0" encoding="UTF-8"?>', '<!DOCTYPE worksheet [<!ENTITY x "unsafe">]>'), /entities/],
    ];
    for (const [normal, pattern] of cases) await assert.rejects(Codec.parseWorkbook(await workbook({ normal }), { filename: 'French.xlsx' }), pattern);
    const malformed = sheet([row(1, [cell('A1', 'ID'), cell('C1', 'Text'), cell('D1', 'MS'), cell('E1', 'NS')]), row(2, [cell('A2', 'a'), cell('C2', 'a')])]);
    await assert.rejects(Codec.parseWorkbook(await workbook({ normal: malformed }), { filename: 'French.xlsx' }), /Unsupported gender-form/);
});
test('regular fields reject NONEXISTENT while forms accept it and blank required saves stay red', async () => {
    const bytes = await workbook(), parsed = await Codec.parseWorkbook(bytes, { filename: 'French.xlsx' }), unit = get(parsed, 'record'), name = field(unit, 'Name');
    await assert.rejects(Codec.exportWorkbook(bytes, parsed, { [unit.id]: { values: { [name.id]: 'NONEXISTENT' } } }), /only valid/);
    const output = await Codec.exportWorkbook(bytes, parsed, { [unit.id]: { values: { [name.id]: '' } } });
    assert.equal(field(get(await Codec.parseWorkbook(output, { filename: 'French.xlsx' }), 'record'), 'Name').originalFill, 'FA8072');
});
test('shared rich strings, namespace prefixes and noneditable formulas survive target patches', async () => {
    const normal = sheet([
        row(1, [cell('A1', 'ID'), cell('B1', 'Name'), cell('C1', 'Translation'), cell('E1', 'Character')]),
        row(2, [cell('A2', 'rich'), '<c r="B2" t="s"><v>0</v></c>', '<c r="C2" s="1" t="s"><v>1</v></c>', '<c r="E2" s="0"><f>1+1</f><v>2</v></c>']),
    ]).replace(/<(\/?)(worksheet|sheetData|row|c|is|t|v|f|extLst|ext)(?=[\s>])/g, '<$1s:$2').replace(`xmlns="${NS}"`, `xmlns:s="${NS}"`);
    const bytes = await workbook({ normal, replace: { 'xl/sharedStrings.xml': `<sst xmlns="${NS}"><si><r><t xml:space="preserve">Rich </t></r><r><rPr><b/></rPr><t>source</t></r></si><si><t xml:space="preserve">Original &#13;&amp;#13;</t></si></sst>` } });
    const parsed = await Codec.parseWorkbook(bytes, { filename: 'French.xlsx' }), unit = get(parsed, 'rich'), f = field(unit, 'Name');
    assert.equal(f.source, 'Rich source'); assert.equal(f.target, 'Original \r&#13;'); assert.equal(unit.metadata.Character, '2');
    const output = await Codec.exportWorkbook(bytes, parsed, { [unit.id]: { values: { [f.id]: 'New' } } });
    const z = await JSZip.loadAsync(output), raw = await z.file('xl/worksheets/sheet1.xml').async('string');
    assert.ok(raw.includes('<s:f>1+1</s:f><s:v>2</s:v>'));
    assert.equal(field(get(await Codec.parseWorkbook(output, { filename: 'French.xlsx' }), 'rich'), 'Name').target, 'New');
    assert.deepEqual(await z.file('xl/sharedStrings.xml').async('uint8array'), await (await JSZip.loadAsync(bytes)).file('xl/sharedStrings.xml').async('uint8array'));
});
test('signed package edits and traversal entries are blocked', async () => {
    const bytes = await workbook({ replace: { '_xmlsignatures/sig1.xml': '<Signature/>' } }), parsed = await Codec.parseWorkbook(bytes, { filename: 'French.xlsx' }), unit = get(parsed, 'complete'), f = field(unit, 'Name');
    await assert.rejects(Codec.exportWorkbook(bytes, parsed, { [unit.id]: { values: { [f.id]: 'Changed' } } }), /signature/);
    await assert.rejects(Codec.parseWorkbook(await workbook({ replace: { '../escape.xml': '<bad/>' } }), { filename: 'French.xlsx' }), /unsafe ZIP path/);
});
test('worker client forwards scoped progress and rejects/ignores cancelled responses', async () => {
    class FakeWorker {
        constructor() { this.messages = []; FakeWorker.instance = this; queueMicrotask(() => this.onmessage({ data: { type: 'ready', version: 1 } })); }
        postMessage(value) { this.messages.push(value); }
        terminate() { this.terminated = true; }
    }
    const client = WorkerClient.create({ Worker: FakeWorker }), progress = [], signal = new AbortController();
    const pending = client.parseWorkbook(new Uint8Array([1]), { filename: 'French.xlsx', parserVersion: 'clienttext-v1', game:'poe1', signal: signal.signal, onProgress: value => progress.push(value) });
    await new Promise(resolve => setImmediate(resolve)); const worker = FakeWorker.instance, message = worker.messages[0];
    assert.equal(message.options.parserVersion, 'clienttext-v1');
    assert.equal(message.options.game,'poe1');
    worker.onmessage({ data: { type: 'progress', id: message.id, value: { sheet: 'A' } } }); assert.equal(progress.length, 1);
    signal.abort(); await assert.rejects(pending, { name: 'AbortError' });
    worker.onmessage({ data: { type: 'progress', id: message.id, value: { sheet: 'B' } } }); assert.equal(progress.length, 1);
    worker.onmessage({ data: { type: 'result', id: message.id, result: 'late' } });
    const manifest = client.buildManifest([{ id: 'unit' }], [{ role: 'normal', hash: 'a'.repeat(64), blob: new Uint8Array([1]), parsed: { large: true, parserVersion: 'clienttext-v1' } }]);
    await new Promise(resolve => setImmediate(resolve)); const request = worker.messages.at(-1);
    assert.equal(request.type, 'buildManifest'); assert.deepEqual(request.assets, [{ role: 'normal', hash: 'a'.repeat(64), parserVersion: 'clienttext-v1' }]);
    worker.onmessage({ data: { type: 'result', id: request.id, result: { format: 'clienttext-v1' } } }); assert.deepEqual(await manifest, { format: 'clienttext-v1' });
    const trusted=client.buildDescriptors([{id:'unit'}],[{role:'normal',hash:'a'.repeat(64),parsed:{parserVersion:'clienttext-v1'}}]);
    await new Promise(resolve=>setImmediate(resolve));const trustedRequest=worker.messages.at(-1);
    assert.equal(trustedRequest.type,'buildDescriptors');assert.equal(trustedRequest.assets[0].parserVersion,'clienttext-v1');
    worker.onmessage({data:{type:'result',id:trustedRequest.id,result:{storageProtocol:State.STORAGE_PROTOCOL,descriptors:[],summaries:{}}}});
    assert.equal((await trusted).storageProtocol,State.STORAGE_PROTOCOL);
    client.dispose(); assert.equal(worker.terminated, true);
});
test('manifest worker computes the same proofs and cancels cooperatively', async () => {
    const parsed = await Codec.parseWorkbook(await workbook(), { filename: 'French.xlsx' });
    const messages = [], self = { ClientTextCodec: Codec, ClientTextState: State, ClientTextTransport: Transport, postMessage: value => messages.push(value) };
    const context = createContext({ self, importScripts() {}, Uint8Array, Promise, Set });
    runInContext(readFileSync(require.resolve('../public/clientTextWorker.js'), 'utf8'), context);
    const assets = [{ role: 'normal', hash: parsed.artifactHash }];
    self.onmessage({ data: { type: 'buildManifest', id: 'one', units: parsed.units, assets } }); await runInContext('queue', context);
    assert.deepEqual(messages.find(message => message.id === 'one').result, await State.buildManifest(parsed.units, assets));
    self.onmessage({data:{type:'buildDescriptors',id:'trusted',units:parsed.units,assets}});await runInContext('queue',context);
    assert.deepEqual(messages.find(message=>message.id==='trusted').result,await State.buildDescriptors(parsed.units,assets));
    const units = Array.from({ length: 600 }, (_, index) => ({ ...parsed.units[0], id: JSON.stringify(['normal', 'Normal', String(index)]), recordId: String(index) }));
    self.postMessage = value => { messages.push(value); if (value.id === 'cancelled' && value.type === 'progress') self.onmessage({ data: { type: 'cancel', id: 'cancelled' } }); };
    self.onmessage({ data: { type: 'buildManifest', id: 'cancelled', units, assets } }); await runInContext('queue', context);
    assert.ok(messages.some(message => message.id === 'cancelled' && message.type === 'progress'));
    assert.equal(messages.some(message => message.id === 'cancelled' && ['error', 'result'].includes(message.type)), false);
});
test('worker messages unwrap nested reactive containers without copying plain originals', async () => {
    const originals = new WeakMap(), reactive = value => { const proxy = new Proxy(value, {}); originals.set(proxy, value); return proxy; };
    class SnapshotWorker {
        constructor() { SnapshotWorker.instance = this; queueMicrotask(() => this.onmessage({ data: { type: 'ready', version: 1 } })); }
        postMessage(value) {
            const message = structuredClone(value);
            if (message.type === 'request-start') this.collector = Transport.collector(message);
            else if (message.type.startsWith('stream-')) this.collector.apply(message);
            else if (message.type === 'request-end') {
                this.message = this.collector.finish(); this.message.type = this.message.operation;
                if (this.message.savedEntries) this.message.saved = Object.fromEntries(this.message.savedEntries);
                this.onStreamEnd?.();
            } else this.message = message;
        }
        terminate() {}
    }
    const context = { Vue: { toRaw: value => originals.get(value) || value }, Worker: SnapshotWorker, setTimeout, clearTimeout, queueMicrotask };
    runInNewContext(readFileSync(require.resolve('../public/clientTextTransport.js'), 'utf8'), context);
    runInNewContext(readFileSync(require.resolve('../public/clientTextWorkerClient.js'), 'utf8'), context);
    const client = context.ClientTextWorkerClient.create(), rawField = { id: 'Name', source: 'Sword', target: 'Original' }, fields = reactive([reactive(rawField)]);
    const unit = reactive({ id: 'unit', fields, metadata: reactive({ nested: reactive({ value: 'note' }) }) });
    const saved = reactive({ unit: reactive({ values: reactive({ Name: 'Changed' }) }) });
    const pending = client.exportWorkbook(new Uint8Array([1]), { units: [unit] }, saved);
    await new Promise(resolve => setImmediate(resolve)); const worker = SnapshotWorker.instance;
    assert.deepEqual(worker.message.parsed, { units: [{ id: 'unit', fields: [rawField], metadata: { nested: { value: 'note' } } }] });
    assert.deepEqual(worker.message.saved, { unit: { values: { Name: 'Changed' } } });
    assert.equal(unit.fields, fields, 'Original reactive containers remain intact');
    worker.onmessage({ data: { type: 'result', id: worker.message.id, result: new Uint8Array([2]) } }); assert.deepEqual(await pending, new Uint8Array([2]));
    const streamed = client.exportWorkbook(new Uint8Array([1]), { units: reactive(Array.from({ length: 600 }, () => unit)) }, saved);
    await new Promise(resolve => { worker.onStreamEnd = resolve; });
    assert.equal(worker.message.parsed.units.length, 600);
    assert.deepEqual(worker.message.parsed.units[599], { id: 'unit', fields: [rawField], metadata: { nested: { value: 'note' } } });
    assert.deepEqual(worker.message.saved, { unit: { values: { Name: 'Changed' } } });
    worker.onmessage({ data: { type: 'result', id: worker.message.id, result: new Uint8Array([3]) } }); assert.deepEqual(await streamed, new Uint8Array([3])); client.dispose();
});
test('bounded worker collections preserve manifests, trees, parses and export input shapes', async () => {
    const original = await Codec.parseWorkbook(await workbook(), { filename: 'French.xlsx' });
    const units = Array.from({ length: 1100 }, (_, index) => ({ ...original.units[0], recordId: String(index), id: JSON.stringify(['normal', 'Normal', String(index)]) }));
    const parsed = { ...original, units }, assets = [{ role: 'normal', hash: original.artifactHash }], sizes = [], directions = [];
    class LoopbackWorker {
        constructor() {
            LoopbackWorker.instance = this;
            this.self = { ClientTextState: State, ClientTextTransport: Transport,
                ClientTextCodec: { parseWorkbook: async bytes => { assert.deepEqual(bytes, new Uint8Array([1])); return parsed; }, exportWorkbook: async (bytes, supplied, saved) => {
                    assert.deepEqual(bytes, new Uint8Array([1])); assert.deepEqual(supplied, parsed); assert.equal(saved[units[1099].id].values['Name'], 'Raw @ value\\n\nไทย'); return new Uint8Array([8, 9]);
                } }, postMessage: (message, transfer) => this.deliver('output', message, transfer, value => this.onmessage?.({ data: value })) };
            this.context = createContext({ self: this.self, importScripts() {}, Uint8Array, Promise, Set, Map });
            runInContext(readFileSync(require.resolve('../public/clientTextWorker.js'), 'utf8'), this.context);
        }
        deliver(direction, message, transfer, receiver) {
            sizes.push(message.bytes instanceof Uint8Array ? message.bytes.byteLength : Buffer.byteLength(JSON.stringify(message)));
            directions.push([direction, message.type]);
            const cloned = structuredClone(message, { transfer: transfer || [] }); queueMicrotask(() => receiver(cloned));
        }
        postMessage(message, transfer) { this.deliver('input', message, transfer, value => this.self.onmessage({ data: value })); if (message.type === 'stream-chunk') this.abortOnChunk?.(); }
        terminate() {}
    }
    const client = WorkerClient.create({ Worker: LoopbackWorker });
    const originalBytes = new Uint8Array([7, 1, 5]);
    assert.deepEqual(await client.parseWorkbook(originalBytes.subarray(1, 2), { filename: 'French.xlsx' }), parsed);
    assert.deepEqual(originalBytes, new Uint8Array([7, 1, 5]), 'Private transfer copies preserve retained originals and subview boundaries');
    const manifest = await client.buildManifest(units, assets);
    assert.deepEqual(manifest, await State.buildManifest(units, assets));
    const trusted=await client.buildDescriptors(units,assets);assert.deepEqual(trusted,await State.buildDescriptors(units,assets));
    assert.equal(trusted.units,undefined);assert.equal(trusted.trees,undefined);
    assert.equal(State.verifyWitness(units[700], manifest.units[700], State.proofFor(manifest, units[700].id), manifest.descriptors[0]), true);
    assert.deepEqual(await client.exportWorkbook(new Uint8Array([1]), parsed, { [units[1099].id]: { values: { Name: 'Raw @ value\\n\nไทย' } } }), new Uint8Array([8, 9]));
    assert.ok(directions.some(([direction, type]) => direction === 'input' && type === 'request-start'));
    assert.ok(directions.some(([direction, type]) => direction === 'output' && type === 'result-start'));
    assert.ok(Math.max(...sizes) < Transport.MAX_BYTES, 'No full originals/manifest/tree graph crosses the worker boundary');
    const aborted = new AbortController(), worker = LoopbackWorker.instance;
    worker.abortOnChunk = () => aborted.abort();
    await assert.rejects(client.buildManifest(units, assets, { signal: aborted.signal }), { name: 'AbortError' });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(runInContext('incoming.size', worker.context), 0, 'Cancellation releases partial worker input collections');
    assert.equal(runInContext('cancelled.size', worker.context), 0, 'Cancelled stream IDs are cleaned up without retaining tombstones');
    client.dispose();
});
test('oversized individual rows fragment without changing Unicode/raw text or array order', async () => {
    const rows = [{ id: 'first', text: 'ไทย🦁@\\n\n'.repeat(200000) }, { id: 'last', text: '' }], receiver = Transport.collector({ units: [] }), sizes = [];
    await Transport.sendCollection((message, transfer) => {
        sizes.push(message.bytes?.byteLength || Buffer.byteLength(JSON.stringify(message)));
        receiver.apply(structuredClone(message, { transfer: transfer || [] }));
    }, 'one', ['units'], rows, { pause: async () => {} });
    assert.deepEqual(receiver.finish().units, rows); assert.ok(sizes.every(size => size <= Transport.MAX_BYTES));
    assert.throws(() => Transport.collector({ units: [] }).apply({ type: 'stream-chunk', path: ['units'], start: 1, values: [] }), /out of order/);
    assert.throws(() => Transport.collector({ units: [] }).apply({ type: 'stream-chunk', path: ['__proto__'], start: 0, values: [] }), /Invalid/);
    const aborted = new AbortController(), messages = [];
    await assert.rejects(Transport.sendCollection(message => { messages.push(message); aborted.abort(); }, 'one', ['units'], rows,
        { guard: () => !aborted.signal.aborted, pause: async () => {} }), { name: 'AbortError' });
    assert.equal(messages.length, 1, 'Cancellation stops the fragmented row before another large payload is posted');
});
test('one million unit transport remains bounded without an aggregate clone or cardinality limit', async () => {
    const records = function* () { for (let index = 0; index < 1000000; index++) yield { id: String(index) }; };
    let count = 0, chunks = 0;
    await Transport.sendCollection(message => {
        assert.equal(message.type, 'stream-chunk'); assert.equal(message.start, count);
        assert.ok(message.values.length <= Transport.MAX_RECORDS);
        assert.equal(message.values[0].id, String(count)); count += message.values.length;
        assert.equal(message.values.at(-1).id, String(count - 1)); chunks++;
    }, 'million', ['units'], records(), { pause: async () => {} });
    assert.equal(count, 1000000); assert.ok(chunks > 1000);
});
test('SHA scratch and bounded scalar memoization retain canonical hashes across boundary sizes and edits', () => {
    const crypto = require('node:crypto');
    for (const length of [55, 56, 63, 64, 16375, 16376, 16384, 50000, 0, 1]) {
        const text = 'é'.repeat(length);
        assert.equal(State.sha256(new TextEncoder().encode(text)), crypto.createHash('sha256').update(text).digest('hex'));
    }
    for (let index = 0; index < 10000; index++) {
        const text = 'Cached ไทย ' + index;
        assert.equal(State.hash(text), crypto.createHash('sha256').update(State.stableStringify(text)).digest('hex'));
    }
    const mutable = { source: 'Before' }, first = State.hash(mutable); mutable.source = 'After';
    assert.notEqual(State.hash(mutable), first, 'Only immutable string values are memoized');
});

test('paired workbook packaging worker preserves both workbook bytes and cleans up after completion',async()=>{
    const bytes=await workbook(),parsed=await Codec.parseWorkbook(bytes,{filename:'French.xlsx'}),unit=parsed.units[0],field=unit.fields[0];
    const output=await Codec.exportWorkbook(bytes,{...parsed,units:[unit]},{[unit.id]:{values:{[field.id]:'Exact @ target\\n'},reviewed:{}}});
    const messages=[],self={JSZip,postMessage:value=>messages.push(value)};
    const context=createContext({self,importScripts(){},Uint8Array,Promise,Set,Map});
    runInContext(readFileSync(require.resolve('../public/clientTextWorker.js'),'utf8'),context);
    self.onmessage({data:{type:'packageWorkbooks',id:'paired',files:[{name:'French.xlsx',bytes:output},{name:'French_Gender.xlsx',bytes}]}});
    await runInContext('queue',context);
    const result=messages.find(message=>message.id==='paired' && message.type==='result');assert(result);
    const zip=await JSZip.loadAsync(result.result);
    assert.deepEqual(await zip.file('French.xlsx').async('uint8array'),output);assert.deepEqual(await zip.file('French_Gender.xlsx').async('uint8array'),bytes);
    assert.equal(runInContext('cancelled.size',context),0);assert.equal(runInContext('incoming.size',context),0);
});
