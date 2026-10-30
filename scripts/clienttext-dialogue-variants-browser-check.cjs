const assert=require('node:assert/strict');
const {join}=require('node:path');

// Render the actual editor components with a synthetic current workbook and a
// recording save adapter. Transactional draft/save coverage lives in the UI tests.
module.exports=async function({page,settle,fixtureArtifacts,results,screenshots}){
    await page.addScriptTag({url:new URL('/clientTextStore.js',page.url()).href});
    for(const theme of ['light','grey','dark','modern-dark'])for(const full of [false,true]){
        await page.setViewportSize({width:1100,height:900});
        await page.evaluate(({theme,full})=>{
            document.documentElement.dataset.theme=theme;
            const host=window.__ctLayoutFixture;host.ctStartClassVariantFixture(true);
            const original=host.ctCurrentUnit,unit=Vue.markRaw({...original,sheet:'NPCTalkDialogueTextAudio',id:JSON.stringify(['normal','NPCTalkDialogueTextAudio','DialogueReview']),
                fields:original.fields.map((field,index)=>({...field,
                    target:index===0?field.target:index<3?'Translated '+field.form:index===3?' \t':'',
                    required:index<3,originalMissing:false,outdated:index>0}))});
            host.ctUnits=Vue.markRaw([unit]);host._ctUnitIndex=Vue.markRaw(new Map([[unit.id,unit]]));host.ctSelection=unit.id;
            host.ctValues=Object.fromEntries(unit.fields.map(field=>[field.id,field.target]));host.ctReviewed={};host.ctSaved=Vue.markRaw({});
            host.ctVariantSelections={};host.ctChoices=[];host.ctDraftDirty=false;host._ctSaveJob=null;host._ctEditRevision=0;host._ctDraftRevision=null;
            host.ctSheet='';host.ctSearch='';host.ctAppliedSearch='';host.ctSelectedFilters=['missing','outdated','saved','revised','unchanged'];
            host.ctEditor=full;host.ctInlineClosed=false;host.ctInitializeVariants();host.ctRevision++;
            host._dialogueSaveCount=0;host._dialogueOriginal=JSON.stringify(unit);
            const store={getDraft:async()=>null,async save(scope,unitId,command){
                host._dialogueSaveCount++;
                return {saved:{unitId,revision:host._dialogueSaveCount,values:structuredClone(command.values),reviewed:structuredClone(command.reviewed),saved:true}};
            }};
            host.ctStorage=()=>store;host.ctSync=()=>{};host.ctLoadMemory=()=>{};host.ctRefreshDiagnostics=()=>{};
        },{theme,full});await settle();
        const name=theme+' '+(full?'full':'inline'),picker=()=>page.getByRole('combobox',{name:'All worksheet class variants'}),
            bulk=()=>page.getByRole('button',{name:'Review blank variants (10)',exact:true}),
            blank=()=>page.locator('[data-ct-target="regular-DexFour"]');
        assert.equal(await page.locator('.ctClassVariantsHeader small').innerText(),'2 translated · 10 use English',name);
        await picker().selectOption('regular-DexFour');await settle();
        assert.equal(await blank().inputValue(),' \t',name+': whitespace remains exact');
        assert.equal(await blank().getAttribute('placeholder'),'-- Use English --');
        assert.equal(await page.locator('.ctTarget .ctEnglishPlaceholder').innerText(),'-- Use English --');
        assert.match(await picker().locator('option:checked').innerText(),/Use English.*Outdated/);
        assert.equal(await page.evaluate(()=>{const host=window.__ctLayoutFixture;return host.ctPreviewValue(host.ctCurrentUnit.fields[3])===host.ctCurrentUnit.fields[3].source;}),true);
        await bulk().hover();await page.getByRole('tooltip').waitFor();
        assert.match(await page.getByRole('tooltip').innerText(),/Save applies the review/);
        if(theme==='light' || theme==='modern-dark'){
            const path=join(fixtureArtifacts,'dialogue-variants-'+theme+'-'+(full?'full':'inline')+'-before.png');
            await page.screenshot({path});screenshots.push(path);
        }
        const before=await page.evaluate(()=>JSON.stringify(window.__ctLayoutFixture.ctValues));
        if(full)await bulk().click();else {await bulk().focus();await page.keyboard.press('Enter');}
        await settle();
        assert.equal(await bulk().count(),0,name+': pointer/keyboard activation stages all ten reviews');
        assert.equal(await blank().evaluate(element=>element===document.activeElement),true,name+': removing the action keeps focus inside the editor');
        assert.equal(await page.getByText('10 blank variants reviewed · Save to apply',{exact:true}).count(),1);
        assert.deepEqual(await page.evaluate(()=>{const host=window.__ctLayoutFixture;return {
            reviews:Object.keys(host.ctReviewed).length,saves:host._dialogueSaveCount,saved:Object.keys(host.ctSaved).length,
            dirty:host.ctDraftDirty,outdated:Object.values(host.ctStatus().fields).filter(field=>field.outdated).length,values:JSON.stringify(host.ctValues)
        };}),{reviews:10,saves:0,saved:0,dirty:true,outdated:12,values:before});
        assert.equal(await page.locator('.ctVariantTabs button.outdated').count(),2,name+': populated badges stay individually Outdated');
        assert.equal(await page.locator('.ctTarget .ctFieldFacts').getByText('Reviewed',{exact:true}).count(),1);
        const geometry=await page.locator('.ctClassVariants').evaluate(element=>({right:element.getBoundingClientRect().right,viewport:innerWidth}));
        assert.ok(geometry.right<=geometry.viewport+1,name+': controls fit a resized desktop');
        const path=join(fixtureArtifacts,'dialogue-variants-'+theme+'-'+(full?'full':'inline')+'.png');
        await page.screenshot({path});screenshots.push(path);
        if(!full){await blank().press('Control+Enter');await page.locator('.ctFullEditor').waitFor();await settle();}
        await page.locator('.ctEditorActionButtons').getByRole('button',{name:'Save',exact:true}).click();await settle();
        assert.equal(await page.evaluate(()=>window.__ctLayoutFixture.ctError),'',name+': Save succeeds');
        assert.deepEqual(await page.evaluate(()=>{const host=window.__ctLayoutFixture;return {
            saves:host._dialogueSaveCount,dirty:host.ctDraftDirty,outdated:Object.values(host.ctStatus().fields).filter(field=>field.outdated).length,
            values:JSON.stringify(host.ctSaved[host.ctSelection].values),original:JSON.stringify(host.ctCurrentUnit)===host._dialogueOriginal
        };}),{saves:1,dirty:false,outdated:2,values:before,original:true});
        assert.equal(await page.getByText('10 blank variants reviewed · Save to apply',{exact:true}).count(),0);
        for(const form of ['StrFour','IntFour']){
            await picker().selectOption('regular-'+form);await settle();
            await page.locator('.ctClassVariants .ctTarget').getByRole('button',{name:'Mark reviewed',exact:true}).click();
        }
        assert.equal(await page.evaluate(()=>window.__ctLayoutFixture.ctStatus().outdated),true,'individual reviews also wait for Save');
        await page.locator('.ctEditorActionButtons').getByRole('button',{name:'Save',exact:true}).click();await settle();
        assert.equal(await page.evaluate(()=>window.__ctLayoutFixture.ctStatus().outdated),false);
        assert.equal(await page.locator('.ctVariantTabs button.outdated').count(),0);
        results.push({name:name+' English fallback, exact blanks, bulk staging, Save, individual reviews and immutable source'});
    }
};
