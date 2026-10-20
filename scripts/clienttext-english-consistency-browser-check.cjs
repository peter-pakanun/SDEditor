'use strict';
// Real SPA/worker/IndexedDB/authenticated HTTP; synthetic originals only.
const assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const {randomUUID,createHash}=require('node:crypto');
const {writeFileSync}=require('node:fs');
const {join}=require('node:path');
module.exports=async function({page,api,files,Codec,ClientState:S,JSZip,failures,directory}){
    const rows=[['save-approved','Same save source',''],['save-peer','Same save source','Peer translation'],
        ['shared-approved','Same shared source',''],['shared-peer','Same shared source','Peer translation'],
        ['unrelated-a','Other source','Other translation A'],['unrelated-b','Other source','Other translation B']];
    const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main',zip=new JSZip();
    const cell=(address,value)=>`<c r="${address}" t="inlineStr"><is><t>${value}</t></is></c>`;
    zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>');
    zip.file('xl/workbook.xml',`<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Consistency" sheetId="1" r:id="rId1"/></sheets></workbook>`);
    zip.file('xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
    zip.file('xl/worksheets/sheet1.xml',`<worksheet xmlns="${ns}"><sheetData><row r="1">${['ID','Text','Translation'].map((v,i)=>cell(String.fromCharCode(65+i)+'1',v)).join('')}</row>${rows.map((values,i)=>`<row r="${i+2}">${values.map((v,c)=>cell(String.fromCharCode(65+c)+(i+2),v)).join('')}</row>`).join('')}</sheetData></worksheet>`);
    const originals=[{name:'French.xlsx',buffer:await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'})},files[1]],units=[],assets=[];
    const content=api.locals.content,upload=content.createUpload('fixture-admin',{game:'poe2',name:'English consistency refresh',contentMode:'clienttext',storageProtocol:S.STORAGE_PROTOCOL,language:'French',idempotencyKey:randomUUID()});
    for(const [index,file]of originals.entries()){
        const role=index?'gender':'normal',parsed=await Codec.parseWorkbook(file.buffer,{filename:file.name,role,language:'French',game:'poe2'});
        units.push(...parsed.units);assets.push({role,hash:createHash('sha256').update(file.buffer).digest('hex'),parserVersion:parsed.parserVersion});
        await content.receiveAsset(upload.upload.id,role,'fixture-admin',Readable.from([file.buffer]),file.name);
    }
    const built=await S.buildDescriptors(units,assets),accepted=await content.finalize(upload.upload.id,'fixture-admin',{storageProtocol:S.STORAGE_PROTOCOL,descriptors:built.descriptors,summaries:built.summaries,idempotencyKey:randomUUID()});
    const inference=[];page.on('request',request=>{if(request.method()==='POST' && /\/v1\/mtl\/(?:local\/)?requests/.test(request.url()))inference.push(request.url());});
    await page.evaluate(async accepted=>{
        const vm=window.__clientFixtureApp;window.__consistencyRequests=[];window.__syncConsistency=vm.ctSync.bind(vm);vm.ctSync=()=>{};
        window.__consistencyHttp=vm._cloud.request.bind(vm._cloud);
        vm._cloud.request=async(path,init={})=>{const entry=init.method==='PATCH'&&/\/units\//.test(path)?{path,body:JSON.parse(JSON.stringify(init.body))}:null;
            if(entry)window.__consistencyRequests.push(entry);const result=await window.__consistencyHttp(path,init);if(entry)entry.revision=result.unit?.revision;return result;};
        if(!await vm.ctOpenGroup(accepted.version,accepted.group,'French'))throw Error(vm.ctError || 'Shared fixture open failed');
        clearInterval(vm._ctSyncTimer);vm.appConfirm=async()=>true;
        window.__consistencyUnit=id=>vm.ctUnits.find(unit=>unit.role==='normal' && unit.recordId===id);
        window.__consistencyState=(prefix)=>{const unit=window.__consistencyUnit(prefix+'-approved'),peer=window.__consistencyUnit(prefix+'-peer'),key=vm.ctConsistencyKey(unit.fields[0]);
            return{edited:(vm.ctDiagnostics[unit.id] || []).filter(i=>i.code==='clienttext-consistency').length,peer:(vm.ctDiagnostics[peer.id] || []).filter(i=>i.code==='clienttext-consistency').length,
                warningFiles:vm.ctScanWarningFileCount,scanDone:vm.ctScanDone,runId:vm.ctScanRunId,indexed:vm._ctConsistencyIndex?.get(key)?.some(entry=>entry.unitId===unit.id) && vm._ctConsistencyByUnit?.get(unit.id)?.has(key),
                unrelatedPreserved:!window.__consistencyUnrelated || ['unrelated-a','unrelated-b'].every(id=>vm.ctDiagnostics[window.__consistencyUnit(id).id]===window.__consistencyUnrelated[id])};};
        window.__retainConsistencyUnrelated=()=>{window.__consistencyUnrelated=Object.fromEntries(['unrelated-a','unrelated-b'].map(id=>[id,vm.ctDiagnostics[window.__consistencyUnit(id).id]]));};
    },accepted);
    const select=async id=>page.evaluate(async id=>{const vm=window.__clientFixtureApp;await vm.ctSelect(window.__consistencyUnit(id),true);vm.ctEditor=true;},id);
    const waitSaved=async previous=>page.waitForFunction(previous=>{const vm=window.__clientFixtureApp;return !vm.ctBusy && !vm._ctSaveJob && (vm.ctSaved[vm.ctSelection]?.revision || 0)>previous;},previous);
    const save=async()=>{const previous=await page.evaluate(()=>window.__clientFixtureApp.ctSaved[window.__clientFixtureApp.ctSelection]?.revision || 0);await page.getByRole('button',{name:'Save',exact:true}).first().click();await waitSaved(previous);};
    for(const id of ['save-approved','shared-approved']){
        await select(id);await page.getByRole('button',{name:'Use English',exact:true}).first().click();
        await page.waitForFunction(()=>{const vm=window.__clientFixtureApp;return !vm.ctBusy && vm.ctUsesEnglish(vm.ctCurrentUnit.fields[0]);});await page.evaluate(()=>window.__syncConsistency());
    }
    await page.getByRole('button',{name:'Close',exact:true}).first().click();await page.waitForFunction(()=>!window.__clientFixtureApp.ctEditor);
    await page.getByRole('button',{name:'Scan diagnostics',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Scan diagnostics',exact:true});await dialog.waitFor();
    await page.evaluate(()=>{const vm=window.__clientFixtureApp;vm.ctScanChecks=Object.fromEntries(vm.ctScanTypes.map(type=>[type.key,type.key==='consistency']));});
    await dialog.getByRole('button',{name:'Start scan',exact:true}).click();await page.waitForFunction(()=>window.__clientFixtureApp.ctScanDone && !window.__clientFixtureApp.ctScanRunning);
    await dialog.getByRole('button',{name:'Close',exact:true}).last().click();await page.evaluate(()=>window.__retainConsistencyUnrelated());
    const before=await page.evaluate(()=>window.__consistencyState('save'));assert.equal(before.edited,0);assert.equal(before.peer,0);assert.equal(before.warningFiles,2);assert.equal(before.indexed,true);
    await select('save-approved');await page.locator('[data-ct-target]').filter({visible:true}).first().fill('Different saved translation');await save();
    const afterSave=await page.evaluate(()=>window.__consistencyState('save'));assert.equal(afterSave.edited,1);assert.equal(afterSave.peer,1);assert.equal(afterSave.warningFiles,4);assert.equal(afterSave.runId,before.runId);assert.equal(afterSave.unrelatedPreserved,true);assert.equal(afterSave.scanDone,true);
    await page.evaluate(()=>window.__syncConsistency());
    const afterSaveRescan=await page.evaluate(async()=>{const vm=window.__clientFixtureApp;await vm.ctStartScan();return window.__consistencyState('save');});assert.equal(afterSaveRescan.edited,afterSave.edited);assert.equal(afterSaveRescan.peer,afterSave.peer);assert.equal(afterSaveRescan.warningFiles,afterSave.warningFiles);
    await page.evaluate(()=>window.__retainConsistencyUnrelated());
    const beforeShared=await page.evaluate(()=>window.__consistencyState('shared'));
    const peerWrite=async text=>page.evaluate(async text=>{
        const vm=window.__clientFixtureApp,unit=window.__consistencyUnit('shared-approved'),entry=window.__consistencyRequests.find(request=>request.body.englishActions && request.path.includes(encodeURIComponent(unit.id)));
        const current=await window.__consistencyHttp('/v1/content-groups/'+encodeURIComponent(vm.ctWorkspace.scope.groupId)+'/teams/French/units');
        const work=current.units.find(row=>row.id===unit.id).work,body={...entry.body,mutationId:crypto.randomUUID(),baseRevision:work.revision,values:{...entry.body.values,[unit.fields[0].id]:text}};
        delete body.englishActions;delete body.englishEligibility;
        await window.__consistencyHttp('/v1/content-groups/'+encodeURIComponent(vm.ctWorkspace.scope.groupId)+'/teams/French/units/'+encodeURIComponent(unit.id),{method:'PATCH',body,headers:{'X-SDEditor-ClientText-Protocol':ClientTextState.STORAGE_PROTOCOL}});
        await window.__syncConsistency();return window.__consistencyState('shared');
    },text);
    const afterShared=await peerWrite('Different received translation');assert.equal(afterShared.edited,1);assert.equal(afterShared.peer,1);assert.equal(afterShared.warningFiles,6);assert.equal(afterShared.runId,beforeShared.runId);assert.equal(afterShared.unrelatedPreserved,true);assert.equal(afterShared.scanDone,true);
    const afterSharedCorrection=await peerWrite('Peer translation');assert.equal(afterSharedCorrection.edited,0);assert.equal(afterSharedCorrection.peer,0);assert.equal(afterSharedCorrection.warningFiles,4);assert.equal(afterSharedCorrection.unrelatedPreserved,true);
    const afterSharedRescan=await page.evaluate(async()=>{const vm=window.__clientFixtureApp;await vm.ctStartScan();return window.__consistencyState('shared');});assert.equal(afterSharedRescan.warningFiles,afterSharedCorrection.warningFiles);assert.equal(afterSharedRescan.edited,0);assert.equal(afterSharedRescan.peer,0);
    assert.deepEqual(failures,[]);assert.deepEqual(inference,[]);
    const report={ok:true,before,afterSave,afterSaveRescan,beforeShared,afterShared,afterSharedCorrection,afterSharedRescan,errors:failures,inference};
    writeFileSync(join(directory,'clienttext-english-consistency-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
};
