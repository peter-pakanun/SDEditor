'use strict';
const assert=require('node:assert/strict');
const {join}=require('node:path');
const {mkdirSync}=require('node:fs');
module.exports=async({page,directory})=>{
  mkdirSync(directory,{recursive:true});
  await page.evaluate(async()=>{
    const h=window.__sharedFixtureApp;h.editorBlocks[1]=h.makeEditorBlock('<bold>{{Damage {0}%}}','ความเสียหาย {0}%',true);h.editorFocusedIndex=1;h.refreshGamePreview();await h.$nextTick();
  });
  const input=page.locator('.editor [data-editor-ref="translation_1"]'),tools=input.locator('xpath=ancestor::*[contains(@class,"editorFieldTools")][1]');
  assert.equal(await page.getByRole('button',{name:'Use English',exact:true}).count(),0);
  await input.focus();await input.evaluate(e=>e.setSelectionRange(0,e.value.length));await tools.getByRole('button',{name:'Bold',exact:true}).click();
  assert.equal(await input.inputValue(),'<bold>{{ความเสียหาย {0}%}}');
  assert.equal(await page.evaluate(()=>window.__sharedFixtureApp.editorBlocks[1].translationDiagnostics.filter(x=>x.code==='text-decoration-tag-name-mismatch').length),0);
  for(const theme of ['light','grey','dark','modern-dark']){
    await page.evaluate(async theme=>{document.documentElement.dataset.theme=theme;const h=window.__sharedFixtureApp;h.refreshGamePreview();await h.$nextTick();},theme);
    const weights=await page.locator('.gamePreviewWindow .gamePreviewText').evaluateAll(es=>es.filter(e=>e.textContent.includes('ความเสียหาย')).map(e=>getComputedStyle(e).fontWeight));
    assert.ok(weights.some(w=>Number(w)>=700),'SD double-brace bold renders in '+theme);
  }
  await input.press('Control+z');assert.equal(await input.inputValue(),'ความเสียหาย {0}%','native undo restores pre-format text');
  await input.press('Control+y');assert.equal(await input.inputValue(),'<bold>{{ความเสียหาย {0}%}}');
  await page.evaluate(async()=>{
    const h=window.__sharedFixtureApp;h.sourceIdentity='a'.repeat(64);h.cloudSignedIn=true;h.cloudProfileId='sd-fixture';h.cloudUser={id:'sd-fixture',role:'translator',language:'Thai',assignmentVersion:1};h.mtlConsentVersion='mtl-v2';
    h._cloud=Vue.markRaw({epoch:0,request:async(path,options={})=>{
      if(path==='/v1/mtl/capabilities')return {enabled:true,statdescription:{version:'statdescription-mtl-v1'}};
      if(path.includes('/statdescription/requests'))return {requestId:options.body.requestId,status:'completed',result:{requestId:options.body.requestId,translation:'<bold>{{ความเสียหาย {0}% จาก MTL}}',provenance:{model:'synthetic',promptVersion:'statdescription-mtl-v1',sdSourceHash:options.body.sourceHash,sdBaselineId:options.body.scope.baselineId,sdFieldId:JSON.stringify([options.body.scope.filepath,options.body.field.index,options.body.field.column])}}};
      return {};
    }});await h.$nextTick();
  });
  for(const inline of [false,true]){
    await page.evaluate(async inline=>{const h=window.__sharedFixtureApp;h.inlineEditor=inline;await h.$nextTick();},inline);
    for(const [role,language,visible] of [['translator','Thai',true],['translator',null,false],['manager','Thai',true],['manager',null,false],['admin',null,true]]){
      await page.evaluate(async({role,language})=>{const h=window.__sharedFixtureApp;h.cloudUser={...h.cloudUser,role,language,isAdmin:role==='admin',assignmentVersion:h.cloudUser.assignmentVersion+1};await h.$nextTick();},{role,language});
      await page.evaluate(async inline=>{const h=window.__sharedFixtureApp;await new Promise(r=>setTimeout(r,0));h.inlineEditor=inline;await h.$nextTick();if(inline){h.editorVisible=false;h.inlineActive=false;await h.activateInlineRow(h.descs[0].filepath);}else await h.editFile(h.descs[0].filepath);await h.$nextTick();},inline);
      assert.equal(await page.locator('.ctMtlButton').count()>0,visible,(inline?'inline':'full')+' '+role+'/'+language);
      assert.equal(await page.getByRole('button',{name:'Use English',exact:true}).count(),0);
    }
    await page.screenshot({path:join(directory,inline?'inline.png':'full.png')});
  }
  await page.evaluate(async()=>{const h=window.__sharedFixtureApp;h.inlineEditor=false;await h.$nextTick();h.cloudUser={id:'sd-fixture',role:'translator',language:'Thai',assignmentVersion:50};await h.$nextTick();await new Promise(r=>setTimeout(r,0));await h.editFile(h.descs[0].filepath);h.editorBlocks[1]=h.makeEditorBlock('<bold>{{Damage {0}%}}','<bold>{{ความเสียหาย {0}%}}',true);await h.$nextTick();await h.sdLoadReviews();});
  const before=await input.inputValue();
  await tools.locator('.ctMtlButton').click();await page.getByText('MTL suggestion · review before Save',{exact:true}).waitFor();
  assert.equal(await input.inputValue(),'<bold>{{ความเสียหาย {0}% จาก MTL}}');
  assert.equal(await page.evaluate(()=>window.__sharedFixtureApp.editorBlocks[1].translation),before,'MTL overlay leaves ordinary draft untouched');
  await input.fill('<bold>{{ข้อความตรวจแล้ว {0}%}}');
  assert.equal(await page.evaluate(()=>window.__sharedFixtureApp.editorBlocks[1].translation),before);
  await page.getByRole('button',{name:'Accept',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.__sharedFixtureApp.editorBlocks[1].translation),'<bold>{{ข้อความตรวจแล้ว {0}%}}');
  const counts=await page.evaluate(async()=>{const h=window.__sharedFixtureApp,lines=h.serializeEditorTranslations(),claims=await h.sdSaveClaims(lines);const bad=[...lines];bad[1]='';return {claims:claims.length,blankRejected:h.editorSaveFindings(bad).errors.some(e=>e.code==='blank-translation')};});
  assert.equal(counts.claims,1);assert.equal(counts.blankRejected,true);
  const atomic=await page.evaluate(async()=>{
    const scope={accountId:'sd-atomic',game:'poe2',branchId:'default',sourceHash:'b'.repeat(64)},language='Thai';
    const desc={filepath:'atomic.txt',filename:'atomic.txt',filedir:'',name:'atomic',stats:['damage'],variables:['#'],remarks:[''],translations:{English:['Damage {0}%'],Thai:['เก่า {0}%']}};
    OfflineStore.setWorkspaceContext(scope);await OfflineStore.setSource([desc],scope);
    await OfflineStore.setWorkspace({...scope,collaborationAccountId:scope.accountId,descs:[desc],status:{},staged:{},stagedVersion:1,statusMetadataVersion:1},scope);
    const store=SDMtlStore.create(),row=await store.put({key:'sd-atomic-field',scopeKey:'sd-atomic',scope:{...scope,baselineId:scope.sourceHash,language},filepath:desc.filepath,index:0,column:null,requestId:'sd-atomic-request',sourceHash:SDText.hash(desc.translations.English[0]),status:'acceptedDraft',reviewText:'ใหม่ {0}%'},0);
    const claim={key:row.key,requestId:row.requestId,revision:row.revision,text:row.reviewText,sourceHash:row.sourceHash};
    const batch={...scope,language,jobId:'sd-atomic-save',files:[{filepath:desc.filepath,translations:[row.reviewText],trackedForExport:true,needsReview:false}],descriptions:[desc],statuses:{},revisions:[{filepath:desc.filepath,lang:language,savedAt:1,translations:[row.reviewText]}],sdMtl:[claim]};
    await OfflineStore.saveTranslationBatch(batch);const accepted=(await store.read('sd-atomic'))[0];
    const replacement=await store.put({...accepted,requestId:'next-request',status:'acceptedDraft',reviewText:'แก้ไข {0}%'},accepted.revision);
    const replay=await OfflineStore.saveTranslationBatch(batch);const afterReplay=(await store.read('sd-atomic'))[0];
    let conflict=false;try{await OfflineStore.saveTranslationBatch({...batch,jobId:'sd-atomic-stale'});}catch(error){conflict=error.code==='MTL_REVIEW_CHANGED';}
    let blank=false;try{await OfflineStore.saveTranslationBatch({...batch,jobId:'sd-atomic-blank',files:[{...batch.files[0],translations:['']}],sdMtl:[{...claim,requestId:replacement.requestId,revision:replacement.revision,text:''}]});}catch(error){blank=true;}
    const final=(await store.read('sd-atomic'))[0];return {accepted:accepted.status,replay:replay.duplicate,nextRetained:afterReplay.requestId===replacement.requestId,conflict,blank,finalStatus:final.status,finalRevision:final.revision,replacementRevision:replacement.revision};
  });
  assert.equal(atomic.accepted,'accepted');assert.equal(atomic.replay,true);assert.equal(atomic.nextRetained,true);assert.equal(atomic.conflict,true);assert.equal(atomic.blank,true);assert.equal(atomic.finalStatus,'acceptedDraft');assert.equal(atomic.finalRevision,atomic.replacementRevision);
  console.log('PASS SD inline/full toolbar, exact role visibility, no Eng, native undo/redo, double-brace preview in four themes, review/draft separation and whole-file blank validation.');
  console.log('PASS native IndexedDB atomic MTL acceptance, exact-receipt replay, newer-review protection and complete-file rollback.');
};
