const assert=require('node:assert/strict');
const {join}=require('node:path');

// Render the actual editor components with a synthetic current workbook and a
// recording save adapter. Transactional draft/save coverage lives in the UI tests.
module.exports=async function({page,settle,fixtureArtifacts,results,screenshots}){
    await page.addScriptTag({url:new URL('/clientTextStore.js',page.url()).href});
    for(const sheet of ['NPCTextAudio','NPCTalkDialogueTextAudio']){
    for(const theme of ['light','grey','dark','modern-dark'])for(const full of [false,true]){
        await page.setViewportSize({width:1100,height:900});
        await page.evaluate(({theme,full,sheet})=>{
            document.documentElement.dataset.theme=theme;
            const host=window.__ctLayoutFixture;host.ctStartClassVariantFixture(true);
            const original=host.ctCurrentUnit,unit=Vue.markRaw({...original,sheet,id:JSON.stringify(['normal',sheet,'DialogueReview']),
                fields:original.fields.map((field,index)=>({...field,
                    target:index===0?'':index<3?'Translated '+field.form:index===3?' \t':'',
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
        },{theme,full,sheet});await settle();
        const name=sheet+' '+theme+' '+(full?'full':'inline'),picker=()=>page.getByRole('combobox',{name:'All worksheet class variants'}),
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
            const path=join(fixtureArtifacts,sheet+'-dialogue-variants-'+theme+'-'+(full?'full':'inline')+'-before.png');
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
        const path=join(fixtureArtifacts,sheet+'-dialogue-variants-'+theme+'-'+(full?'full':'inline')+'.png');
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
    for(const theme of ['light','grey','dark','modern-dark'])for(const full of [false,true])for(const forms of [[null],['MS','FS'],['MS','FS','NS','MP','FP','NP']]){
        await page.evaluate(({theme,full,forms,sheet})=>{
            document.documentElement.dataset.theme=theme;
            const host=window.__ctLayoutFixture;host.ctStartClassVariantFixture(true);
            const previous=host.ctCurrentUnit,base=previous.fields[0],gender=forms[0]!==null,
                unit=Vue.markRaw({...previous,role:gender?'gender':'normal',sheet:sheet+(gender?'_Gender':''),
                    id:JSON.stringify([gender?'gender':'normal',sheet+(gender?'_Gender':''),'GenericReview']),
                    fields:[...forms.map((form,index)=>({...base,id:JSON.stringify(['Text',form]),kind:form?'form':'text',group:'Text',form,
                        target:'Generic '+(form || 'text'),targetCell:String.fromCharCode(68+index)+'3',required:true,originalMissing:false,outdated:true})),
                        ...previous.fields.slice(1).map((field,index)=>({...field,target:index<2?'Class '+field.form:index===2?' \t':'',required:index<2,originalMissing:false,outdated:true}))]});
            host.ctUnits=Vue.markRaw([unit]);host._ctUnitIndex=Vue.markRaw(new Map([[unit.id,unit]]));host.ctSelection=unit.id;
            host.ctValues=Object.fromEntries(unit.fields.map(field=>[field.id,field.target]));host.ctReviewed={};host.ctSaved=Vue.markRaw({});
            host.ctVariantSelections={};host.ctChoices=[];host.ctDraftDirty=false;host._ctSaveJob=null;host._ctEditRevision=0;host._ctDraftRevision=null;
            host.ctEditor=full;host.ctInlineClosed=false;host.ctInitializeVariants();host.ctSelectVariant(host.ctFieldGroups[0],'regular-DexFour',{focus:false});host.ctRevision++;
            host._dialogueSaveCount=0;host._dialogueOriginal=JSON.stringify(unit);
            host.buildGamePreviewSegments=text=>({segments:[{text}],keysOrder:[]});
            const store={getDraft:async()=>null,async save(scope,unitId,command){host._dialogueSaveCount++;return {saved:{unitId,revision:host._dialogueSaveCount,
                values:structuredClone(command.values),reviewed:structuredClone(command.reviewed),saved:true}};}};
            host.ctStorage=()=>store;host.ctSync=()=>{};host.ctLoadMemory=()=>{};host.ctRefreshDiagnostics=()=>{};
        },{theme,full,forms,sheet});await settle();
        const name=sheet+' '+theme+' '+(full?'full':'inline')+' '+forms.length+' generic defaults',blank=page.locator('[data-ct-target="regular-DexFour"]');
        assert.equal(await blank.getAttribute('placeholder'),'-- Use generic --',name);
        assert.equal(await page.locator('.ctTarget .ctEnglishPlaceholder').innerText(),'-- Use generic --');
        assert.equal(await page.locator('.ctClassVariantsHeader small').innerText(),'2 translated · 10 use generic');
        assert.equal(await page.getByRole('button',{name:/Review blank variants/}).count(),0);
        assert.equal(await page.locator('.ctClassVariants .ctTarget').getByRole('button',{name:'Mark reviewed',exact:true}).count(),0);
        const preview=await page.evaluate(()=>{const host=window.__ctLayoutFixture,field=host.ctCurrentUnit.fields.find(field=>field.id==='regular-DexFour');return {value:host.ctPreviewValue(field),
            variants:window.ClientTextUI.mixin.computed.ctGamePreviewVariants.call({ctPreviewField:field,ctClassFallback:host.ctClassFallback,
                buildGamePreviewSegments:host.buildGamePreviewSegments}).map(variant=>({label:variant.label,value:variant.segments[0].text}))};});
        assert.equal(preview.value,forms.length===1?'Generic text':'');
        assert.deepEqual(preview.variants,forms.length===1?[]:forms.map(form=>({label:form+' · Generic',value:'Generic '+form})));
        assert.equal(await page.evaluate(()=>{const host=window.__ctLayoutFixture;return host.ctStatus().fields['regular-DexFour'].outdated;}),true);
        if(!full){await blank.press('Control+Enter');await page.locator('.ctFullEditor').waitFor();await settle();}
        await page.locator('.ctEditorActionButtons').getByRole('button',{name:'Save',exact:true}).click();await settle();
        assert.deepEqual(await page.evaluate(()=>{const host=window.__ctLayoutFixture;return {generic:host.ctStatus().fields['regular-DexFour'].generic,
            outdated:host.ctStatus().fields['regular-DexFour'].outdated,review:host.ctSaved[host.ctSelection].reviewed['regular-DexFour'] || '',
            target:host.ctSaved[host.ctSelection].values['regular-DexFour'],original:JSON.stringify(host.ctCurrentUnit)===host._dialogueOriginal};}),
            {generic:true,outdated:false,review:'',target:' \t',original:true});
        assert.equal(await page.locator('.ctVariantTabs button.outdated').count(),2,'populated overrides still require their own reviews');
        if(theme==='modern-dark' && full){const path=join(fixtureArtifacts,sheet+'-generic-defaults-'+forms.length+'.png');await page.locator('.ctClassVariants').screenshot({path});screenshots.push(path);}
        const genericId=await page.evaluate(()=>window.__ctLayoutFixture.ctCurrentUnit.fields[0].id);
        await page.locator('[data-ct-target]').evaluateAll((elements,id)=>elements.find(element=>element.dataset.ctTarget===id).focus(),genericId);
        await page.keyboard.press('Control+A');await page.keyboard.press('Backspace');await settle();
        assert.equal(await blank.getAttribute('placeholder'),forms.length===1?'-- Use English --':'-- Use generic / English --');
        assert.equal(await page.evaluate(()=>window.__ctLayoutFixture.ctStatus().fields['regular-DexFour'].outdated),false,'draft generic clearing does not change committed review');
        await page.locator('.ctEditorActionButtons').getByRole('button',{name:'Save',exact:true}).click();await settle();
        assert.equal(await page.evaluate(()=>window.__ctLayoutFixture.ctStatus().fields['regular-DexFour'].outdated),true,'saving one absent generic restores blank review');
        assert.equal(await page.getByRole('button',{name:'Review blank variants (10)',exact:true}).count(),1);
        results.push({name:name+' complete and partial defaults, separate previews, saved-only completion and independent populated reviews'});
    }
    }
};
