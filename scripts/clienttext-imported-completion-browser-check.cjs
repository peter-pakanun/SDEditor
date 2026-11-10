const assert=require('node:assert/strict');
const {readFileSync,writeFileSync}=require('node:fs');
const {join}=require('node:path');

// Synthetic workbook through the normal offline importer, worker and native IDB.
module.exports=async function({page,directory,JSZip,Codec,ClientState,failures,bootstrap}){
    const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main',zip=new JSZip();
    const colors=[null,...Object.values(ClientState.FILLS)],cell=(ref,text,style=0)=>`<c r="${ref}" s="${style}" t="inlineStr"><is><t>${text}</t></is></c>`;
    const records=[['filled','Completed',ClientState.FILLS.filled],['reviewed','Reviewed text',ClientState.FILLS.reviewed],
        ['revised','Corrected text',ClientState.FILLS.revised],['unchanged','Original',null],['missing','',ClientState.FILLS.missing],
        ['outdated','Old translation',ClientState.FILLS.outdated],['invalid-grey','',ClientState.FILLS.filled]];
    zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>');
    zip.file('xl/workbook.xml',`<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="ClientStrings" sheetId="1" r:id="rId1"/></sheets></workbook>`);
    zip.file('xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
    zip.file('xl/styles.xml',`<styleSheet xmlns="${ns}"><fonts count="1"><font/></fonts><fills count="${colors.length}">${colors.map(color=>'<fill><patternFill patternType="'+(color?'solid':'none')+'">'+(color?'<fgColor rgb="FF'+color+'"/>':'')+'</patternFill></fill>').join('')}</fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${colors.length}">${colors.map((_,index)=>`<xf fontId="0" fillId="${index}" borderId="0" xfId="0"/>`).join('')}</cellXfs></styleSheet>`);
    zip.file('xl/worksheets/sheet1.xml',`<worksheet xmlns="${ns}"><sheetPr><tabColor rgb="FF793BB6"/></sheetPr><sheetData><row r="1">${cell('A1','ID')+cell('B1','Text')+cell('C1','Translation')}</row>${records.map(([id,value,color],index)=>`<row r="${index+2}">${cell('A'+(index+2),id)+cell('B'+(index+2),'English '+id)+cell('C'+(index+2),value,colors.indexOf(color))}</row>`).join('')}</sheetData></worksheet>`);
    const buffer=await zip.generateAsync({type:'nodebuffer'}),expected={total:7,missing:2,outdated:1,saved:3,revised:1,unchanged:1};
    await page.evaluate(()=>window.__clientFixtureApp.ctOpenOfflineTest());
    await page.locator('.ctTestWorkbookGroup').first().locator('input[type=file]').first().setInputFiles({name:'French.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer});
    const scope=await page.evaluate(async()=>{
        const vm=window.__clientFixtureApp;vm.ctUploadName='Imported completion colors';
        if(!await vm.ctOpenTestSheet())throw Error(vm.ctUploadError || vm.ctError);
        vm.inlineEditor=false;vm.ctEditor=false;return JSON.parse(JSON.stringify(vm.ctWorkspace.scope));
    });
    assert.deepEqual(await page.evaluate(()=>window.__clientFixtureApp.ctCounts),expected);
    const filters=async()=>{
        await page.locator('.statusPill.saved.workspaceFilterLink:visible').click();
        assert.deepEqual(await page.evaluate(()=>window.__clientFixtureApp.ctRows.map(unit=>unit.recordId)),['filled','reviewed','revised']);
        const revised=page.locator('.statusPill.revised.workspaceFilterLink:visible');await revised.focus();await page.keyboard.press('Enter');
        assert.deepEqual(await page.evaluate(()=>window.__clientFixtureApp.ctRows.map(unit=>unit.recordId)),['revised']);
        await page.waitForFunction(()=>document.querySelectorAll('tr[data-unit-id].isRevised').length===1);
    };
    const themes=[];
    for(const theme of ['light','grey','dark','modern-dark']){
        await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await filters();
        themes.push({theme,counts:await page.evaluate(()=>window.__clientFixtureApp.ctCounts)});
        await page.screenshot({path:join(directory,'imported-completion-'+theme+'.png'),fullPage:true});
    }
    const durable=async()=>page.evaluate(async()=>{
        const vm=window.__clientFixtureApp,scope=vm.ctWorkspace.scope,store=vm.ctStorage(scope);
        const history=await Promise.all(vm.ctUnits.map(unit=>store.listHistory(scope,unit.id)));
        return {saved:await store.getSaved(scope),history:history.flat().length,receipts:await new Promise((resolve,reject)=>{
            OfflineStore.openClientTextDb().then(db=>{const tx=db.transaction([ClientTextStore.stores.receipts],'readonly'),request=tx.objectStore(ClientTextStore.stores.receipts).index('by_scope').getAll(ClientTextStore.scopeKey(scope));tx.oncomplete=()=>resolve(request.result.length);tx.onerror=()=>reject(tx.error);},reject);
        })};
    });
    assert.deepEqual(await durable(),{saved:{},history:0,receipts:0});
    const downloadEvent=page.waitForEvent('download');await page.evaluate(()=>window.__clientFixtureApp.ctDownload());
    const downloaded=await downloadEvent,output=readFileSync(await downloaded.path());
    assert.deepEqual(output,buffer,'Imported status recognition keeps a no-op export byte-identical');
    const parsed=await Codec.parseWorkbook(output,{filename:downloaded.suggestedFilename(),role:'normal',language:'French',game:'poe2'});
    assert.deepEqual(parsed.units.map(unit=>unit.fields[0].target),records.map(record=>record[1]));
    await page.reload();await bootstrap(page);
    await page.evaluate(async scope=>{const vm=window.__clientFixtureApp,metadata=await vm._ctStore.getMetadata(scope);if(!await vm.ctOpenCached(metadata))throw Error(vm.ctError);},scope);
    assert.deepEqual(await page.evaluate(()=>window.__clientFixtureApp.ctCounts),expected);await filters();
    assert.deepEqual(await durable(),{saved:{},history:0,receipts:0});
    assert.deepEqual(failures,[]);
    const result={ok:true,counts:expected,themes,normalMode:true,nativeReload:true,unchangedExport:true,authoredRecords:0,history:0,receipts:0};
    writeFileSync(join(directory,'imported-completion-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
};
