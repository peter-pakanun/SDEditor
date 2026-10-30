const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');

// Actual editor controls with a recording save adapter; the UI unit checks
// cover transactional persistence. An optional read-only production extract
// can replace the synthetic row without committing workbook content.
module.exports=async function({page,settle,fixtureArtifacts,results,screenshots}){
    await page.addScriptTag({url:new URL('/clientTextStore.js',page.url()).href});
    const rows=process.env.CLIENTTEXT_BLANK_SOURCE_ROWS
        ? JSON.parse(readFileSync(process.env.CLIENTTEXT_BLANK_SOURCE_ROWS,'utf8'))
        : [{id:JSON.stringify(['normal','PassiveSkills','atlas_domination_2_4']),role:'normal',sheet:'PassiveSkills',recordId:'atlas_domination_2_4',fields:[
            {id:'name',name:'Display Name',kind:'text',source:'Shrine Effect',target:'Translated name',required:true,sourceCell:'B2',targetCell:'C2'},
            {id:'flavour',name:'Flavour Text',kind:'text',source:'',target:'',required:false,sourceCell:'E2',targetCell:'F2'},
            {id:'hard-mode',name:'Hard Mode Display Name',kind:'text',source:'',target:'',required:false,outdated:true,originalFill:'FF9966',sourceCell:'H2',targetCell:'I2'}]}];
    for(const theme of ['light','grey','dark','modern-dark'])for(const full of [false,true]){
        await page.setViewportSize({width:1100,height:900});
        for(const original of rows){
            await page.evaluate(({original,theme,full})=>{
                document.documentElement.dataset.theme=theme;
                const host=window.__ctLayoutFixture,unit=Vue.markRaw(original);
                host.ctUnits=Vue.markRaw([unit]);host._ctUnitIndex=Vue.markRaw(new Map([[unit.id,unit]]));host.ctSelection=unit.id;
                host.gameVersion='poe1';host.ctWorkspace.scope.game='poe1';host.ctWorkspace.scope.language='Thai';
                host.ctValues=ClientTextState.valuesFor(unit);host.ctReviewed={};host.ctSaved=Vue.markRaw({});
                host.ctChoices=[];host.ctDraftDirty=false;host._ctSaveJob=null;host._ctEditRevision=0;host._ctDraftRevision=null;
                host.ctSheet='';host.ctSearch='';host.ctAppliedSearch='';host.ctSelectedFilters=['missing','outdated','saved','revised','unchanged'];
                host.ctEditor=full;host.ctInlineClosed=false;host.ctRevision++;
                let revision=0;
                host.ctStorage=()=>({getDraft:async()=>null,async save(scope,unitId,command){
                    return {saved:{unitId,revision:++revision,values:structuredClone(command.values),reviewed:structuredClone(command.reviewed),saved:true}};
                }});
                host.ctSync=()=>{};host.ctLoadMemory=()=>{};host.ctRefreshDiagnostics=()=>{};
            },{original,theme,full});await settle();
            const label=original.recordId+' '+theme+' '+(full?'full':'inline');
            assert.equal(await page.evaluate(()=>window.__ctLayoutFixture.ctStatus().outdated),true,label+': the original needs review');
            const field=original.fields.find(field=>field.outdated && !field.source.trim());assert.ok(field,label);
            const target=page.locator('[data-ct-target]');
            assert.equal(await target.count(),2,label+': the ordinary blank field stays hidden');
            const input=target.nth(1);
            assert.equal(await input.inputValue(),field.target,label);
            const review=page.getByRole('button',{name:'Mark reviewed',exact:true});await review.waitFor({state:'visible'});
            if(original===rows[0]){
                const path=join(fixtureArtifacts,'blank-source-review-'+theme+'-'+(full?'full':'inline')+'.png');
                await page.screenshot({path});screenshots.push(path);
            }
            if(full)await review.click();else {await review.focus();await page.keyboard.press('Enter');}
            await settle();assert.equal(await review.count(),0,label+': review action is reachable');
            const outcome=await page.evaluate(async()=>{
                const host=window.__ctLayoutFixture,unit=host.ctCurrentUnit,values=JSON.stringify(host.ctValues);
                if(!await host.ctSave())throw new Error(host.ctError || 'Save failed');
                return {after:host.ctStatus(unit).outdated,sameValues:values===JSON.stringify(host.ctValues),saved:host.ctStatus(unit).saved};
            });
            assert.deepEqual(outcome,{after:false,sameValues:true,saved:true},label);
            results.push({case:label,ok:true});
        }
    }
};
