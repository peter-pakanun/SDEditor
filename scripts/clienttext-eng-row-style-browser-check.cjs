'use strict';
// Real local workbook/worker saves produce Revised rows; other row classes are
// presentation-only cascade projections and never change saved work.
const assert=require('node:assert/strict');
const {readFileSync,writeFileSync}=require('node:fs');
const {join}=require('node:path');
module.exports=async function({page,directory,JSZip,Codec,failures}){
    const phase=process.env.ENG_ROW_STYLE_PHASE||'candidate',rows=[],samples=[],inference=[],ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    page.on('request',request=>{if(request.method()==='POST'&&/\/v1\/mtl\/(?:local\/)?requests/.test(request.url()))inference.push(request.url());});
    const zip=new JSZip(),text=(cell,value)=>`<c r="${cell}" t="inlineStr"><is><t>${value}</t></is></c>`;
    zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>');
    zip.file('xl/workbook.xml',`<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="BaseItemTypes" sheetId="1" r:id="rId1"/></sheets></workbook>`);
    zip.file('xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
    const sources=['Synthetic Arcane Tool','Synthetic Wisdom Scroll','Synthetic Chaos Token'];
    zip.file('xl/worksheets/sheet1.xml',`<worksheet xmlns="${ns}"><sheetData><row r="1">${text('A1','ID')+text('C1','Name')+text('D1','Translation')}</row>${sources.map((source,i)=>`<row r="${i+3}">${text('A'+(i+3),'Synthetic/Items/Currency/Item'+i)+text('C'+(i+3),source)+text('D'+(i+3),source)}</row>`).join('')}</sheetData></worksheet>`);
    zip.file('xl/styles.xml',`<styleSheet xmlns="${ns}"><fonts count="1"><font><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`);
    await page.evaluate(()=>{const vm=window.__clientFixtureApp;vm.ctOpenOfflineTest();});
    await page.locator('.ctTestWorkbookGroup').first().locator('input[type=file]').first().setInputFiles({name:'French.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:await zip.generateAsync({type:'nodebuffer'})});
    const opened=await page.evaluate(async()=>{const vm=window.__clientFixtureApp;vm.ctUploadName='Synthetic Revised cue regression';if(!await vm.ctOpenTestSheet())throw Error(vm.ctError||vm.ctUploadError);vm.ctSelectedFilters=vm.ctStatusFilterOptions.map(x=>x.key);vm.ctEditor=true;return vm.ctUnits.map(u=>({id:u.id,field:u.fields[0].id}));});
    assert.equal(opened.length,3);
    const select=async id=>page.evaluate(async id=>{const vm=window.__clientFixtureApp;await vm.ctSelect(vm.ctUnits.find(u=>u.id===id),true);vm.ctFocusedField=vm.ctCurrentUnit.fields[0].id;await vm.$nextTick();},id);
    const input=()=>page.getByRole('textbox',{name:'Name',exact:true});
    for(const unit of opened){await select(unit.id);const eng=page.getByRole('button',{name:'Use English',exact:true});await eng.focus();await page.keyboard.press('Space');await page.waitForFunction(()=>{const vm=window.__clientFixtureApp;return !vm.ctBusy&&!vm._ctSaveJob&&vm.ctUsesEnglish(vm.ctPreviewField);});}
    await select(opened[0].id);
    const durableBefore=await page.evaluate(async()=>{const vm=window.__clientFixtureApp;return{saved:JSON.stringify(await vm._ctStore.getSaved(vm.ctWorkspace.scope)),counts:vm.ctCounts,status:vm.ctUnits.map(u=>vm.ctStatus(u))};});
    assert.equal(durableBefore.counts.revised,3);assert.equal(durableBefore.counts.missing,0);assert.ok(durableBefore.status.every(s=>s.revised&&s.saved));
    const original=await page.evaluate(()=>{const vm=window.__clientFixtureApp;window.__rowStyleQueueDraft=vm.ctQueueDraft;vm.ctQueueDraft=()=>{};return{theme:document.documentElement.dataset.theme,density:vm.uiDensity};});
    const variants={revised:['isRevised','hasChanges'],saved:['hasChanges'],unchanged:[],missing:['isMissing'],outdated:['isOutdated'],warning:['hasChanges','diagnosticWarning'],error:['hasChanges','diagnosticError'],'revised-warning':['isRevised','hasChanges','diagnosticWarning'],'revised-error':['isRevised','hasChanges','diagnosticError']};
    const view=async(surface)=>page.evaluate(async surface=>{const vm=window.__clientFixtureApp;vm.ctEditor=surface==='full';vm.inlineEditor=!surface.startsWith('collapsed')&&surface!=='full';vm.ctInlineClosed=false;vm.ctValues={...vm.ctValues,[vm.ctCurrentUnit.fields[0].id]:surface==='whitespace'?' \t':''};await vm.$nextTick();},surface);
    const measure=async(theme,density,surface,status,focus)=>{
        if(focus)await input().focus();else await page.locator('tr[data-unit-id='+JSON.stringify(opened[0].id)+'] .fileOpenButton').focus();
        const data=await page.evaluate(({surface,classes})=>{
            const vm=window.__clientFixtureApp,row=document.querySelector('tr[data-unit-id='+JSON.stringify(surface==='collapsed-unselected'?vm.ctUnits[1].id:vm.ctSelection)+']');
            const originalClass=row.className;row.classList.remove('isRevised','hasChanges','isMissing','isOutdated','diagnosticWarning','diagnosticError');row.classList.add(...classes);
            if(surface==='collapsed-unselected')row.classList.remove('selectedFileRow','inlineFocusedRow');
            const target=[...document.querySelectorAll('[data-ct-target]')].find(e=>e.getAttribute('aria-label')==='Name'&&e.getClientRects().length);
            const el=surface.startsWith('collapsed')?row.querySelector('.ctEnglishPlaceholder'):surface==='whitespace'?target.closest('.editorTextField').querySelector('.ctEnglishPlaceholder'):target;
            if(!el)throw Error('Missing cue '+JSON.stringify({surface,classes,values:vm.ctValues,inline:vm.inlineEditor,closed:vm.ctInlineClosed,selection:vm.ctSelection,target:target?.outerHTML}));
            const style=getComputedStyle(el,el===target?'::placeholder':null),root=getComputedStyle(document.documentElement),probe=document.createElement('span');document.body.append(probe);probe.style.color=root.getPropertyValue('--ui-muted');const neutral=getComputedStyle(probe).color;probe.remove();
            const result={text:el===target?target.placeholder:el.textContent,color:style.color,fontWeight:style.fontWeight,opacity:Number(style.opacity),rootMuted:root.getPropertyValue('--ui-muted').trim(),neutralColor:neutral,rowMuted:getComputedStyle(row).getPropertyValue('--ui-muted').trim(),rowClasses:row.className,translationWeight:getComputedStyle(row.querySelector('.translationTr')).fontWeight,metadataColor:getComputedStyle(row.querySelector('.ctFilePath')).color,background:getComputedStyle(row.querySelector('.translationTr')).backgroundColor,focused:target===document.activeElement,raw:target?.value,active:vm.ctUsesEnglish(vm.ctCurrentUnit.fields[0])};
            row.className=originalClass;return result;
        },{surface,classes:variants[status]});
        assert.equal(data.text,'-- Use English --');assert.equal(data.active,true);
        assert.equal(data.opacity,['dark','modern-dark'].includes(theme)?.65:.85);
        if(phase==='candidate'){assert.equal(data.color,data.neutralColor,JSON.stringify({theme,density,surface,status,...data}));assert.equal(data.fontWeight,'400');}
        if(variants[status].includes('hasChanges'))assert.equal(data.translationWeight,'700','authored translation emphasis preserved');
        if(status==='revised')assert.notEqual(data.metadataColor,data.neutralColor,'Revised metadata remains status-colored');
        rows.push({theme,density,surface,status,...data});
    };
    for(const theme of ['light','grey','dark','modern-dark'])for(const density of ['compact','spacious']){
        await page.evaluate(async({theme,density})=>{document.documentElement.dataset.theme=theme;window.__clientFixtureApp.uiDensity=density;await window.__clientFixtureApp.$nextTick();},{theme,density});
        await view('full');await measure(theme,density,'full','revised',true);
        for(const surface of ['inline-focused','inline-blurred','whitespace','collapsed-selected','collapsed-unselected']){
            await view(surface);for(const status of Object.keys(variants))await measure(theme,density,surface,status,surface==='inline-focused'||surface==='whitespace');
            if(density==='compact'){
                if(surface==='inline-focused')await input().focus();
                await page.screenshot({path:join(directory,phase+'-row-'+theme+'-'+surface+'.png')});
            }
        }
    }
    const durableAfter=await page.evaluate(async original=>{const vm=window.__clientFixtureApp;document.documentElement.dataset.theme=original.theme;vm.uiDensity=original.density;vm.ctQueueDraft=window.__rowStyleQueueDraft;delete window.__rowStyleQueueDraft;vm.ctEditor=true;vm.inlineEditor=false;vm.ctValues={...vm.ctValues,[vm.ctCurrentUnit.fields[0].id]:''};await vm.$nextTick();return JSON.stringify(await vm._ctStore.getSaved(vm.ctWorkspace.scope));},original);
    assert.equal(durableAfter,durableBefore.saved,'style projections do not change saved work');assert.equal(durableAfter.includes('-- Use English --'),false);
    await view('inline-focused');await input().fill('An actual translated draft');assert.equal(await input().inputValue(),'An actual translated draft');assert.equal(await input().evaluate(el=>getComputedStyle(el).fontWeight),'700','actual translation retains row emphasis');assert.equal(await input().evaluate(el=>el.matches(':placeholder-shown')),false);samples.push('real translated draft stays bold; cue hidden');
    await input().fill('');const eng=page.getByRole('button',{name:'Use English',exact:true});await eng.focus();await page.keyboard.press('Space');await page.waitForFunction(()=>{const vm=window.__clientFixtureApp;return !vm.ctBusy&&!vm._ctSaveJob&&!vm.ctUsesEnglish(vm.ctPreviewField);});
    assert.equal(await input().getAttribute('placeholder'),'Translation');assert.equal(await page.evaluate(()=>window.__clientFixtureApp.ctCounts.missing),1);samples.push('revoke removes cue and restores actionable Missing');
    await eng.focus();await page.keyboard.press('Space');await page.waitForFunction(()=>{const vm=window.__clientFixtureApp;return !vm.ctBusy&&!vm._ctSaveJob&&vm.ctUsesEnglish(vm.ctPreviewField);});
    const downloadEvent=page.waitForEvent('download');await page.evaluate(()=>window.__clientFixtureApp.ctDownload());const downloaded=await downloadEvent;
    const bytes=readFileSync(await downloaded.path()),parsed=await Codec.parseWorkbook(bytes,{filename:downloaded.suggestedFilename(),role:'normal',language:'French',game:'poe2'});
    assert.ok(parsed.units.every(u=>u.fields[0].target===''));assert.deepEqual(parsed.units.map(u=>u.fields[0].source),sources);assert.equal(JSON.stringify(parsed.units).includes('-- Use English --'),false);samples.push('download retains empty targets and exact English source');
    assert.deepEqual(failures,[]);assert.deepEqual(inference,[]);
    const report={ok:true,phase,actualRevisedRows:3,initialStatus:durableBefore.status,renderedCases:rows.length,rows,samples,pageErrors:failures,inference,source:'Synthetic desktop fixture only. Three real local workbook/worker approvals create Revised rows. Other status classes are explicit presentation-only projections; no shared production data or inference.',libraryScreenshot:'Parent inspected the user screenshot. Library metadata/OCR was read; Windows materialization failed because helper requires os.setxattr. No download workaround used.'};
    writeFileSync(join(directory,'eng-row-style-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({ok:true,phase,actualRevisedRows:3,renderedCases:rows.length,samples,baselineMismatch:rows.filter(x=>x.color!==x.neutralColor||x.fontWeight!=='400').length,directory},null,2));
};
