'use strict';
const assert=require('node:assert/strict');
module.exports=async function({page,files,failures}){
    await page.evaluate(()=>window.__clientFixtureApp.ctOpenOfflineTest());
    const upload=page.locator('.ctUploadDialog');
    await upload.locator('section[aria-label="Current workbooks"] input[type=file]').first().setInputFiles(files);
    await upload.getByRole('button',{name:'Open',exact:true}).click();
    await page.waitForFunction(()=>{const app=window.__clientFixtureApp;return app.ctActive&&!app.ctBusy&&!app.ctUploading&&!app.workspaceInitializationActive;});
    await page.evaluate(async()=>{
        const app=window.__clientFixtureApp;
        app.inlineEditor=true;await app.ctShowAllLoaded();await app.ctSetSheet(JSON.stringify(['normal','Normal']));
        const seed=app.ctUnits.find(unit=>unit.role==='normal'&&unit.recordId==='complete');
        const background=Array.from({length:30000},(_,i)=>{
            const recordId='click-fixture-'+i;
            return {...seed,recordId,id:JSON.stringify(['normal',seed.sheet,recordId]),
                fields:seed.fields.map(field=>({...field,sourceCell:(field.sourceCell || 'A3').replace(/\d+$/,String(i+10)),
                    targetCell:field.targetCell.replace(/\d+$/,String(i+10))}))};
        });
        app.ctUnits=Vue.markRaw([...app.ctUnits,...background]);
        app._ctUnitIndex=Vue.markRaw(new Map(app.ctUnits.map(unit=>[unit.id,unit])));
        app.ctRevision++;app.ctRebuildSheets();
        app.ctSort='row';app.ctSortDir='asc';app.pageSize=20;app.ctPage=1;app.ctInlineClosed=true;
        const order=app.ctBrowseOrderedUnits;
        window.__rowScanCount=0;window.__rowPaintCount=0;
        app.ctBrowseOrderedUnits=function(...args){window.__rowScanCount++;return order(...args);};
        const parts=app.ctListTargetParts;
        app.ctListTargetParts=function(...args){window.__rowPaintCount++;return parts(...args);};
        app.$refs.ctFileTableRegion.addEventListener('pointerdown',()=>{window.__rowClickStart=performance.now();window.__rowClickScans=window.__rowScanCount;window.__rowClickPaints=window.__rowPaintCount;},true);
        await app.$nextTick();
    });
    const samples=[];
    for(const recordId of ['record','complete','record','complete','record','complete','record']){
        const row=page.locator('tr[data-unit-id]').filter({has:page.getByRole('button',{name:recordId,exact:true})});
        await row.locator('.ctFilePath').click();
        await page.waitForFunction(id=>{const v=window.__clientFixtureApp;return v.ctCurrentUnit?.recordId===id&&!v.ctBusy&&!v._ctSelectRun?.pending
            && document.activeElement?.hasAttribute('data-ct-target');},recordId);
        samples.push(await page.evaluate(()=>({ms:Math.round(performance.now()-window.__rowClickStart),scans:window.__rowScanCount-window.__rowClickScans,
            projections:window.__rowPaintCount-window.__rowClickPaints})));
    }
    console.log(JSON.stringify({records:await page.evaluate(()=>window.__clientFixtureApp.ctUnits.length),samples}));
    assert.ok(samples.every(sample=>sample.scans===0),'Opening clean records must not refilter the full workbook');
    assert.ok(samples.every(sample=>sample.projections<=1),'Only the departing editor row should rebuild its collapsed fields');
    assert.deepEqual(failures,[]);
};
