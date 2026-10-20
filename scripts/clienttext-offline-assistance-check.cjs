'use strict';
// Runs inside the real offline fixture with synthetic workbooks and accounts.
const assert = require('node:assert/strict');
module.exports = async function ({page,workspace,translation,unit,normal,openTest,bootstrap,monitor,assertLocal,failures}) {
    page.setDefaultTimeout(10000);
    await page.evaluate(()=>{window.__offlineTestApp.appConfirm=async()=>true;});
    const files=[{name:'French.xlsm',mimeType:'application/vnd.ms-excel.sheet.macroEnabled.12',buffer:normal}];
    const tools=workspace.locator('.ctTools:visible');
    await tools.getByRole('button',{name:/Dictionary$/}).click();
    const sword=tools.locator('[data-dict-id="cached-sword"]').first();
    await sword.locator('input[placeholder="Replace"]').first().fill('Session sword');
    await sword.locator('summary').click();
    await sword.locator('textarea').fill('Temporary note');
    await page.waitForFunction(()=>{
        const app=window.__offlineTestApp;
        return app.ctDictionaryPack?.entriesById?.['cached-sword']?.replace==='Session sword';
    });
    const isolation=await page.evaluate(()=>{
        const app=window.__offlineTestApp,field=app.ctCurrentUnit.fields.find(field=>field.name==='Name');
        return {normal:app._cloud.snapshot().dictionary[0].replace,payload:app.cloudPayload().dictionary[0].replace,
            settings:app.settingsSavePayload().dictionary[0].replace,matched:app.ctDictionaryMatchedDefinitions.has('cached-sword'),
            completions:app.ctCompletionItems({...field,source:'[Sword|Sword]'}).map(item=>item.value),history:app.cloudEntryHistoryAvailable};
    });
    assert.equal(isolation.normal,'Cached sword');assert.equal(isolation.payload,'Cached sword');assert.equal(isolation.settings,'Cached sword');
    assert.equal(isolation.matched,true);assert.ok(isolation.completions.includes('[Sword|Session sword]'));assert.equal(isolation.history,false);
    await sword.locator('input[placeholder="Replace"]').first().press('Control+Enter');
    assert.equal(await translation.inputValue(),'Session sword','Dictionary insertion reaches the focused temporary target');
    await sword.getByRole('button',{name:'Add an alternate for Sword',exact:true}).click();
    await sword.locator('.dictAltRow input[placeholder="Find"]').fill('Blade');
    await sword.locator('.dictAltRow input[placeholder="Replace"]').fill('Session blade');
    await sword.getByRole('combobox',{name:'Game for Sword',exact:true}).selectOption('poe1');
    await page.waitForFunction(()=>!window.__offlineTestApp.ctDictionaryMatchedDefinitions.has('cached-sword'));
    await sword.getByRole('combobox',{name:'Game for Sword',exact:true}).selectOption('all');
    await page.waitForFunction(()=>window.__offlineTestApp.ctDictionaryMatchedDefinitions.has('cached-sword'));
    console.log('Dictionary copy, matching and completion verified');
    await page.evaluate(async()=>{
        const app=window.__offlineTestApp,snapshot=app._cloud.snapshot();
        snapshot.dictionary[0].replace='Background sword';
        await app.cloudApply(snapshot);
        if(app.dictionary[0].replace!=='Session sword')throw new Error('Background sync replaced the temporary Dictionary');
        // A settings payload must use the latest normal rows, never the overlay.
        if(app.cloudPayload().dictionary[0].replace!=='Background sword')throw new Error('Temporary Dictionary escaped through settings');
    });
    await tools.getByRole('button',{name:'Add entry',exact:true}).click();
    const added=tools.locator('.dictRow').first();
    await added.locator('input[placeholder="Find"]').first().fill('Temporary term');
    await added.locator('input[placeholder="Replace"]').first().fill('Temporary target');
    await tools.getByRole('searchbox',{name:'Search dictionary entries'}).fill('Temporary term');
    assert.equal(await tools.locator('.dictRow').count(),1);
    await tools.getByRole('button',{name:'Delete Dictionary entry Temporary term',exact:true}).click();
    await page.waitForFunction(()=>!window.__offlineTestApp.dictionary.some(word=>word.find==='Temporary term'));
    await tools.getByRole('searchbox',{name:'Search dictionary entries'}).fill('');
    await translation.fill('Session saved sword');
    assert.equal(await page.evaluate(()=>window.__offlineTestApp.ctSave()),true);
    await page.waitForFunction(()=>window.__offlineTestApp.ctMemory.some(entry=>entry.target==='Session saved sword'));
    await translation.fill('');await tools.getByRole('button',{name:'TM',exact:true}).click();
    const tm=tools.getByRole('region',{name:'Translation memory suggestions'});
    await tm.getByRole('option').filter({hasText:'Session saved sword'}).dblclick();
    assert.equal(await translation.inputValue(),'Session saved sword');
    console.log('TM learning and insertion verified');
    await assertLocal(page,'Dictionary edit/add, worker matches, autocomplete and TM learning/insertion');
    // Save a detached synthetic package for the subsequent persistent regression.
    const persistent=await page.evaluate(async()=>{
        const app=window.__offlineTestApp,ctx=app.ctContext(),store=app.ctStorage(ctx.scope);
        window.__assistanceOriginals={units:app.ctUnits,assets:[await store.getAsset(ctx.scope,'normal')]};
        window.__assistanceClosedStore=store;window.__assistanceClosedScope=ctx.scope;
        return {...ctx.scope,versionId:'local:persistent-fixture',groupId:'local:persistent-fixture'};
    });
    await page.evaluate(()=>window.__offlineTestApp.ctShowVersionChooser());
    await page.waitForFunction(()=>!window.__offlineTestApp.ctActive);
    assert.equal(await page.evaluate(()=>window.__offlineTestApp.dictionary[0].replace),'Cached sword');
    assert.equal(await page.evaluate(()=>window.__offlineTestApp.dictionary.some(word=>word.find==='Temporary term')),false);
    assert.equal(await page.evaluate(async()=>{
        try{await window.__assistanceClosedStore.getMemory(window.__assistanceClosedScope);return false;}
        catch(error){return error.code==='LOCAL_TEST_DISPOSED';}
    }),true);
    await assertLocal(page,'Leaving restores ordinary Dictionary and disposes temporary TM',true);
    await monitor(page,false);
    // Both the durable Dictionary and learned ClientText memory still persist.
    await page.evaluate(async scope=>{
        const app=window.__offlineTestApp;
        app.dictionary[0].replace='Persistent sword';app.dictionaryEntryInput(app.dictionary[0]);await app.saveSettings();
        await app._ctStore.import(scope,window.__assistanceOriginals);
        const source=window.__assistanceOriginals.units.find(unit=>unit.recordId==='offline-test-record');
        const values=ClientTextState.valuesFor(source),field=source.fields.find(field=>field.name==='Name');
        values[field.id]='Persistent TM sword';
        await app._ctStore.save(scope,source.id,{jobId:'persistent-assistance-save',values,reviewed:{}});
    },persistent);
    await monitor(page,true);await openTest(files);
    await workspace.getByRole('button',{name:'offline-test-record',exact:true}).click();
    await page.waitForFunction(()=>window.__offlineTestApp.ctMemory.some(entry=>entry.target==='Persistent TM sword'));
    assert.equal(await page.evaluate(()=>window.__offlineTestApp.dictionary[0].replace),'Persistent sword');
    assert.equal(await page.evaluate(()=>window.__offlineTestApp.ctMemory.some(entry=>entry.target==='Session saved sword')),false);
    assert.equal(await page.evaluate(()=>{const app=window.__offlineTestApp;return app.ctMemoryResults.some(match=>match.target==='Persistent TM sword');}),true);
    const dimensions=['language','account','game','branch'];
    for(const dimension of dimensions){
        await assertLocal(page,'Cached TM and temporary Dictionary before '+dimension+' change');
        await monitor(page,false); // Explicit settings/account changes use their ordinary persistence.
        await page.evaluate(async dimension=>{
            const app=window.__offlineTestApp;
            app.dictionary[0].replace='Discard on '+dimension;app.dictionaryEntryInput(app.dictionary[0]);
            if(dimension==='language')app.lang='German';
            else if(dimension==='game')app.gameVersion='poe1';
            else if(dimension==='branch')app.branchId='other';
            else {const snapshot=app._cloud.snapshot();snapshot.profileId='other-account';snapshot.user={...snapshot.user,id:'other-account'};await app.cloudApply(snapshot);}
            await app.$nextTick();
        },dimension);
        await page.waitForFunction(()=>!window.__offlineTestApp.ctActive && !window.__offlineTestApp._ctTestDictionary);
        assert.equal(await page.evaluate(()=>window.__offlineTestApp.ctMemory.length),0,dimension+': TM clears');
        assert.equal(await page.evaluate(()=>window.__offlineTestApp.dictionary.some(word=>word.replace.startsWith('Discard on '))),false,dimension+': Dictionary edits clear');
        await monitor(page,false);await bootstrap('manager','French',true);
        if(dimension!=='branch'){await monitor(page,true);await openTest(files);await workspace.getByRole('button',{name:'offline-test-record',exact:true}).click();}
    }
    // A translator opening another workbook language gets only that language's
    // local cache; the existing assigned-language MTL rule remains intact.
    await bootstrap('translator');await monitor(page,true);await openTest([{...files[0],name:'German.xlsm'}]);
    assert.equal(await page.evaluate(()=>window.__offlineTestApp.ctMemory.length),0);
    assert.equal(await page.evaluate(()=>window.__offlineTestApp.dictionary.some(word=>word.replace==='Persistent sword')),false);
    assert.equal(await page.evaluate(()=>{const app=window.__offlineTestApp;return app.ctMtlCanGenerate?.(app.ctUnits[0].fields[0]) || false;}),false);
    await assertLocal(page,'Translator language isolation');
    console.log('Session/workbook/language/account/game/branch cleanup verified');
    await monitor(page,false);
    await page.evaluate(()=>OfflineStore.updateHybridState(state=>{state.auth=null;state.activeProfile='guest';return state;}));
    await page.reload();
    await page.waitForFunction(()=>window.__offlineTestApp?.offlineStoreReady && !window.__offlineTestApp.workspaceInitializationActive);
    assert.equal(await page.evaluate(()=>window.__offlineTestApp.ctActive),false);
    await bootstrap('manager','French',true);
    assert.equal(await page.evaluate(()=>window.__offlineTestApp.dictionary[0].replace),'Persistent sword');
    assert.equal(await page.evaluate(async scope=>(await window.__offlineTestApp._ctStore.getMemory(scope)).units.some(entry=>entry.target==='Persistent TM sword'),persistent),true);
    assert.deepEqual(failures,[]);
    console.log(JSON.stringify({ok:true,checks:['Dictionary edits/add/search/worker/autocomplete','TM explicit-save learning and double-click insertion',
        'no IndexedDB/browser-storage/cloud authoring during session','background Dictionary update isolation','session/workbook/language/account/game/branch cleanup',
        'read-only cached TM seed','persistent Dictionary and TM survive reload','assigned-language MTL permissions unchanged']},null,2));
};
