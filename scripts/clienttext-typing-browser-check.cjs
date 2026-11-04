const assert=require('node:assert/strict');

// Run through clienttext-layout-browser-fixture.cjs --typing-only. Uses the
// production Vue runtime, worklist and editor controls with a large controlled
// corpus. Persistence and application lifecycle hooks remain outside this fixture.
module.exports=async function({page,settle,results}){
    await page.evaluate(async()=>{
        const host=window.__ctLayoutFixture;
        await host.ctStartNpcFixture();
        const original=host.ctCurrentUnit,selected={...original,fields:[...original.fields,
            {id:'blank-text',name:'Optional text',kind:'text',source:'',target:'',sourceCell:'E2',targetCell:'F2',required:false}]};
        const background=Array.from({length:150000},(_,index)=>({
            id:'background-'+index,role:'normal',sheet:'Background',recordId:'Background'+index,notes:[],metadata:{},
            fields:[{id:'text',name:'Text',kind:'text',source:'English '+index,target:'Translation '+index,
                sourceCell:'B'+(index+2),targetCell:'C'+(index+2),required:true}]
        }));
        // Unused blank records subscribe the worklist to draft membership, as
        // in the full production workbooks. Revision-only refreshes must not
        // turn those records into a full scan after every checkpoint.
        background[0].fields[0].source='';background[0].fields[0].target='';
        host.ctUnits=Vue.markRaw([...host.ctUnits.map(unit=>unit.id===selected.id?selected:unit),...background]);
        host._ctUnitIndex=Vue.markRaw(new Map(host.ctUnits.map(unit=>[unit.id,unit])));
        host.ctRebuildSheets();host.ctPage=1;host.ctRevision++;
        const ordered=host.ctBrowseOrderedUnits;
        host._typingScans=0;
        host.ctBrowseOrderedUnits=function(...args){this._typingScans++;return ordered(...args);};
        host.ctRefreshDraftSummaries=window.ClientTextUI.mixin.methods.ctRefreshDraftSummaries.bind(host);
        host._typingDraftRevision=0;
        host.ctStorage=()=>({getDraft:async()=>null,getDraftSummaries:async()=>[
            {unitId:host.ctSelection,revision:++host._typingDraftRevision,updatedAt:Date.now()}
        ]});
    });
    await settle();
    for(const game of ['poe1','poe2'])for(const theme of ['light','grey','dark','modern-dark'])for(const full of [false,true])for(const target of ['npc-text','blank-text']){
        const initial=target==='npc-text'?'Localized Renly':'Retained blank-source draft';
        await page.evaluate(({game,theme,full,target,initial})=>{
            const host=window.__ctLayoutFixture;
            document.documentElement.dataset.theme=theme;
            host.gameVersion=game;host.ctWorkspace.scope.game=game;
            host.ctBrowseMode='sheets';host.ctSheet=JSON.stringify(['normal','NPCs']);
            host.ctEditor=full;host.ctInlineClosed=false;host.ctPage=1;
            host.ctSelection='npc-renly';host.ctValues={'npc-text':'Localized Renly','blank-text':'',[target]:initial};
            host.ctReviewed={};host.ctDraftDirty=target==='blank-text';host.ctFocusedField=target;
            host.ctDraftSummaries=Vue.markRaw([]);
        },{game,theme,full,target,initial});
        await settle();
        const input=page.locator((full?'.ctFullEditor':'.ctListWorkspace')+' [data-ct-target="'+target+'"]');
        await input.focus();await input.press('End');
        // The first edit legitimately adds this record to the Draft filter.
        await page.keyboard.type('a');
        await page.evaluate(()=>window.__ctLayoutFixture.ctRefreshDraftSummaries());await settle();
        const before=await page.evaluate(()=>{
            const host=window.__ctLayoutFixture,region=host.$refs.ctFileTableRegion;
            return {scans:host._typingScans,records:host.ctUnits.length,rows:host.ctRows.map(unit=>unit.id),
                scrollTop:region.scrollTop,scrollLeft:region.scrollLeft,selection:host.ctSelection};
        });
        const started=Date.now();
        for(const character of 'bcdefghi'){
            await page.keyboard.type(character);
            await page.evaluate(()=>window.__ctLayoutFixture.ctRefreshDraftSummaries());
        }
        await settle();
        const elapsedMs=Date.now()-started;
        const after=await page.evaluate(target=>{
            const host=window.__ctLayoutFixture,input=document.activeElement,region=host.$refs.ctFileTableRegion;
            return {scans:host._typingScans,rows:host.ctRows.map(unit=>unit.id),value:host.ctValues[target],
                inputValue:input.value,field:input.dataset.ctTarget,start:input.selectionStart,end:input.selectionEnd,
                scrollTop:region.scrollTop,scrollLeft:region.scrollLeft,selection:host.ctSelection};
        },target);
        const label=game+' '+theme+' '+(full?'full':'inline')+' '+target;
        assert.equal(after.scans,before.scans,label+': typing does not rerun worklist filtering');
        assert.equal(after.value,initial+'abcdefghi',label+': every keystroke reaches the draft');
        assert.equal(after.inputValue,after.value,label+': native field and draft stay in sync');
        assert.equal(after.field,target,label+': focus is retained');
        assert.equal(after.start,after.value.length,label+': caret is retained');assert.equal(after.end,after.start);
        assert.deepEqual(after.rows,before.rows,label+': worklist order is stable');
        assert.equal(after.selection,before.selection);assert.equal(after.scrollTop,before.scrollTop);assert.equal(after.scrollLeft,before.scrollLeft);
        results.push({name:label,records:before.records,keystrokes:8,worklistScans:after.scans-before.scans,elapsedMs});
    }
};
