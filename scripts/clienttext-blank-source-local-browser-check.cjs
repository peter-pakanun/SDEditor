const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const JSZip=require('../../SDEditor-API/node_modules/jszip');
const Codec=require('../public/clientTextCodec.js'),S=require('../public/clientTextState.js');

// Real normal-mode SPA, worker, native IndexedDB and local workspace ownership.
// Generated input only; uses the disposable origin/profile of the parent fixture.
module.exports=async function({page,bootstrap,temp,reports,errors,networkWrites}){
    const zip=new JSZip(),ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    const cell=(ref,text,style=0)=>`<c r="${ref}" s="${style}" t="inlineStr"><is><t>${text}</t></is></c>`;
    zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>');
    zip.file('xl/workbook.xml',`<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="ClientStrings" sheetId="1" r:id="r1"/></sheets></workbook>`);
    zip.file('xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
    zip.file('xl/styles.xml','<styleSheet xmlns="'+ns+'"><fonts count="1"><font/></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFF9966"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf fillId="0"/><xf fillId="1"/></cellXfs></styleSheet>');
    zip.file('xl/worksheets/sheet1.xml',`<worksheet xmlns="${ns}"><sheetData>`+
        `<row r="1">${cell('A1','ID')}${cell('B1','Text')}${cell('C1','Translation')}</row>`+
        [['review-empty','',1],['review-retained','Old translated text',1],['target-only','Retained non-orange text',0],['unused','',0]].map(([id,text,style],i)=>`<row r="${i+2}">${cell('A'+(i+2),id)}${cell('B'+(i+2),'')}${cell('C'+(i+2),text,style)}</row>`).join('')+'</sheetData></worksheet>');
    const buffer=await zip.generateAsync({type:'nodebuffer'});
    for(const game of ['poe1','poe2']){
        await bootstrap(page,game);await page.evaluate(()=>window.__localApp.ctOpenOfflineTest());
        await page.locator('.ctTestWorkbookGroup').first().locator('input[type=file]').first().setInputFiles({name:'Thai.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer});
        const scope=await page.evaluate(async()=>{
            const vm=window.__localApp;vm.ctUploadName='Blank-source native save';
            if(!await vm.ctOpenTestSheet())throw new Error(vm.ctUploadError || vm.ctError);
            if(vm.ctRows.length!==3)throw new Error('Only unused blank rows should hide');
            return JSON.parse(JSON.stringify(vm.ctWorkspace.scope));
        });
        const select=async id=>{await page.evaluate(async id=>{const vm=window.__localApp;await vm.ctSelect(vm.ctUnits.find(unit=>unit.recordId===id),true);},id);};
        const save=async()=>{
            await page.locator('.ctFullEditor').getByRole('button',{name:'Save',exact:true}).click();
            await page.waitForFunction(()=>{const vm=window.__localApp;return !vm.ctBusy && !vm.ctDraftDirty && !vm._ctSaveJob;});
            assert.equal(await page.evaluate(()=>window.__localApp.ctError),'');
        };
        await select('review-empty');
        const review=page.getByRole('button',{name:'Mark reviewed',exact:true});await review.click();
        assert.equal(await page.evaluate(()=>Object.keys(window.__localApp.ctSaved).length),0,'review alone does not save');
        await save();
        await select('review-retained');await page.locator('[data-ct-target]').fill('');await save();
        await select('target-only');assert.equal(await page.locator('[data-ct-target]').inputValue(),'Retained non-orange text');await save();
        await page.reload();await bootstrap(page,game);
        const reopened=await page.evaluate(async scope=>{
            const vm=window.__localApp;if(!await vm.ctOpenCached(await vm._ctStore.getMetadata(scope)))throw new Error(vm.ctError);
            return vm.ctUnits.filter(unit=>unit.recordId!=='unused').map(unit=>({id:unit.recordId,visible:vm.ctFieldsFor(unit).length,saved:vm.ctSaved[unit.id]?.values[unit.fields[0].id],outdated:vm.ctStatus(unit).outdated}));
        },scope);
        assert.deepEqual(reopened,[{id:'review-empty',visible:1,saved:'',outdated:false},{id:'review-retained',visible:1,saved:'',outdated:false},{id:'target-only',visible:1,saved:'Retained non-orange text',outdated:false}]);
        await select('target-only');await page.locator('[data-ct-target]').fill('');await save();
        const output=await page.evaluate(async()=>{
            const vm=window.__localApp,native=window.saveAs;let captured;
            window.saveAs=(blob,name)=>{captured={blob,name};};
            try{if(!await vm.ctDownload())throw new Error(vm.ctError);}finally{window.saveAs=native;}
            if(!captured)throw new Error('No workbook export');
            return {name:captured.name,bytes:Array.from(new Uint8Array(await captured.blob.arrayBuffer()))};
        });
        const bytes=Buffer.from(output.bytes),parsed=await Codec.parseWorkbook(bytes,{filename:output.name,role:'normal',language:'Thai',game});
        for(const id of ['review-empty','review-retained','target-only']){
            const field=parsed.units.find(unit=>unit.recordId===id).fields[0];assert.equal(field.target,'');
            assert.equal(field.originalFill,id==='target-only'?S.FILLS.revised:S.FILLS.reviewed);
        }
        const history=await page.evaluate(async()=>{const vm=window.__localApp,unit=vm.ctUnits.find(unit=>unit.recordId==='target-only');return{original:unit.fields[0].target,events:await vm._ctLocalStore.listHistory(vm.ctWorkspace.scope,unit.id)};});
        assert.equal(history.original,'Retained non-orange text');assert.ok(history.events.some(event=>event.before?.values?.[JSON.stringify(['Text',null])]==='Retained non-orange text' && event.after.values[JSON.stringify(['Text',null])]===''));
        fs.writeFileSync(path.join(temp,'blank-source-native-'+game+'.xlsx'),bytes);
        reports.push({case:game+' blank source: empty approval, clear retained text, non-orange visibility, native reload, history and blank export',ok:true,reopened});
    }
    assert.deepEqual(errors,[]);assert.deepEqual(networkWrites,[]);
    fs.writeFileSync(path.join(temp,'blank-source-native-results.json'),JSON.stringify({ok:true,reports,errors,networkWrites},null,2));
};
