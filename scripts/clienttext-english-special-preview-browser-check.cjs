'use strict';
// Focused presentation assertions in the existing synthetic skill/keyword SPA.
const assert=require('node:assert/strict');
const {writeFileSync}=require('node:fs');
const {join}=require('node:path');
module.exports=async function({page,folder,errors}){
    const settle=()=>page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))),cases=[];
    await page.evaluate(async()=>{
        const host=fixtureApp,unit=host.ctCurrentUnit,field=unit.fields.find(field=>field.id==='Short Description'),keyword=host.ctUnits.find(unit=>unit.sheet==='KeywordPopups'&&unit.recordId==='Quality');
        // No local-writer lease is modeled by this synthetic presentation host.
        // Real checkpoint/persistence coverage runs in the separate native fixture.
        host.ctQueueDraft=()=>{};
        window.fixtureEnglishUnits=JSON.stringify(host.ctUnits);host.ctFocusedField=field.id;host.ctValues={...host.ctValues,[field.id]:''};
        const approve=(unit,fields)=>({values:{...ClientTextState.valuesFor(unit),...Object.fromEntries(fields.map(field=>[field.id,'']))},englishIntent:Object.fromEntries(fields.map(field=>[field.id,{state:'active',sourceHash:ClientTextState.sourceHash(field.source),decisionId:'synthetic-'+field.id}]))});
        host.ctSaved=Vue.markRaw({...host.ctSaved,[unit.id]:approve(unit,[field]),[keyword.id]:approve(keyword,keyword.fields)});host.ctRevision++;await host.$nextTick();
    });await settle();
    const shortSource=page.locator('.gamePreviewSourcePane .ctSkillShortDescription'),shortTarget=page.locator('.gamePreviewTargetPane .ctSkillShortDescription'),input=page.locator('textarea[data-ct-target="Short Description"]:visible');
    assert.equal(await input.inputValue(),'');assert.equal(await input.getAttribute('placeholder'),'-- Use English --');
    assert.equal(await shortTarget.innerText(),await shortSource.innerText());assert.equal(await shortTarget.locator('.gamePreviewKw').count(),2);
    await shortSource.scrollIntoViewIfNeeded();await shortTarget.scrollIntoViewIfNeeded();await page.screenshot({path:join(folder,'english-short-card.png')});cases.push('active skill short description renders English with real keyword spans');
    await shortTarget.locator('.gamePreviewKw').first().click();await settle();
    const floating=page.locator('[data-keyword-window]');assert.equal(await floating.locator('.keywordPreviewTitle').innerText(),'Quality concept');
    assert.match(await floating.locator('.keywordPreviewContent').innerText(),/Example explanation/);assert.doesNotMatch(await floating.innerText(),/Missing Thai/);
    await page.screenshot({path:join(folder,'english-floating-keyword.png')});cases.push('translated floating keyword renders English decisions without a false Missing notice');
    await floating.locator('.keywordPreviewClose').click();
    await input.fill('A real draft');await settle();assert.equal(await shortTarget.innerText(),'A real draft');await input.fill('');cases.push('live nonempty draft overrides approved fallback');
    await page.evaluate(async()=>{const host=fixtureApp,saved=host.ctSaved[host.ctSelection];host.ctSaved=Vue.markRaw({...host.ctSaved,[host.ctSelection]:{...saved,englishIntent:{}}});host.ctRevision++;await host.$nextTick();});await settle();
    assert.equal(await shortTarget.innerText(),'(empty)');assert.equal(await input.getAttribute('placeholder'),'Translation');cases.push('revoked short description returns to empty preview');
    // This presentation fixture uses synthetic memory metadata rather than the
    // native import/save lifecycle. Match its existing sheet-switch setup.
    await page.evaluate(async()=>{const host=fixtureApp,unit=host.ctUnits.find(unit=>unit.sheet==='KeywordPopups'&&unit.recordId==='Quality');
        clearTimeout(host._ctDraftTimer);host.ctReviewed={};host.ctDraftDirty=false;host._ctDraftRevision=null;host.ctDraftStageFailure=null;
        host.ctSelection=unit.id;host.ctSheet=JSON.stringify(['normal','KeywordPopups']);host.ctFocusedField='Info Title';host.ctValues=ClientTextState.valuesFor(unit,host.ctSaved[unit.id]);host.ctEditor=true;host.ctRevision++;await host.$nextTick();});await settle();
    const source=page.locator('.gamePreviewSourcePane .keywordSheetPreview'),target=page.locator('.gamePreviewTargetPane .keywordSheetPreview');
    assert.equal(await target.locator('.keywordPreviewTitle').innerText(),await source.locator('.keywordPreviewTitle').innerText());
    assert.equal(await target.locator('.keywordPreviewContent').innerText(),await source.locator('.keywordPreviewContent').innerText());assert.doesNotMatch(await target.innerText(),/Missing Thai/);
    assert.equal(await page.locator('textarea[data-ct-target="Info Title"]:visible').inputValue(),'');await page.screenshot({path:join(folder,'english-keyword-sheet.png')});cases.push('assembled KeywordPopups title/content preview renders approved English');
    await page.evaluate(async()=>{const host=fixtureApp,saved=host.ctSaved[host.ctSelection];host.ctSaved=Vue.markRaw({...host.ctSaved,[host.ctSelection]:{...saved,conflicts:[{fieldId:'Info Content'}]}});host.ctRevision++;await host.$nextTick();});await settle();
    assert.match(await target.innerText(),/Missing Thai/);assert.doesNotMatch(await target.locator('.keywordPreviewContent').innerText(),/Example explanation/);cases.push('conflicted keyword field no longer gets fallback');
    const safety=await page.evaluate(()=>({sourceUnchanged:JSON.stringify(fixtureApp.ctUnits)===window.fixtureEnglishUnits,placeholderStored:JSON.stringify(fixtureApp.ctSaved).includes('-- Use English --'),values:fixtureApp.ctSaved[fixtureApp.ctSelection].values}));
    assert.equal(safety.sourceUnchanged,true);assert.equal(safety.placeholderStored,false);assert.equal(safety.values['Info Title'],'');assert.equal(safety.values['Info Content'],'');assert.deepEqual(errors,[]);
    const report={ok:true,cases,safety,errors,limit:'Synthetic desktop SPA with local memory store and stubbed private media/catalog routes; durable HTTP/export safety is covered by the separate native presentation fixture.'};
    writeFileSync(join(folder,'english-presentation-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
};
