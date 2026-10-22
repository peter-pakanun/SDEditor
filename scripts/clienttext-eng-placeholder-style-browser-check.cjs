'use strict';
// Rendered style/contrast evidence in the native synthetic ClientText SPA.
const assert=require('node:assert/strict');
const {readFileSync,writeFileSync}=require('node:fs');
const {join}=require('node:path');
module.exports=async function({page,directory}){
    const phase=process.env.ENG_PLACEHOLDER_STYLE_PHASE||'candidate',rows=[];
    const baseline=process.env.ENG_PLACEHOLDER_STYLE_BASELINE?JSON.parse(readFileSync(process.env.ENG_PLACEHOLDER_STYLE_BASELINE,'utf8')):null;
    const original=await page.evaluate(()=>{const vm=window.__clientFixtureApp;window.__placeholderStyleQueueDraft=vm.ctQueueDraft;vm.ctQueueDraft=()=>{};return{theme:document.documentElement.dataset.theme,density:vm.uiDensity,inline:vm.inlineEditor,editor:vm.ctEditor,closed:vm.ctInlineClosed,selection:vm.ctSelection,values:{...vm.ctValues},saved:JSON.stringify(vm.ctSaved),dirty:vm.ctDraftDirty,sheet:vm.ctSheet,filter:vm.ctFilter,search:vm.ctSearch,applied:vm.ctAppliedSearch,filters:[...vm.ctSelectedFilters],page:vm.ctPage};});
    const showValue=value=>page.evaluate(async value=>{const vm=window.__clientFixtureApp;vm.ctValues={...vm.ctValues,[vm.ctCurrentUnit.fields.find(field=>field.name==='Name').id]:value};await vm.$nextTick();},value);
    const measure=async(surface,theme,density)=>{
        const data=await page.evaluate(surface=>{
            const vm=window.__clientFixtureApp,input=[...document.querySelectorAll('[data-ct-target]')].find(el=>el.getAttribute('aria-label')==='Name'&&el.getClientRects().length);
            const row=[...document.querySelectorAll('tr[data-unit-id]')].find(el=>el.dataset.unitId===vm.ctSelection);
            const el=surface.startsWith('collapsed')?row.querySelector('.ctEnglishPlaceholder'):surface.endsWith('whitespace')?input.closest('.editorTextField').querySelector('.ctEnglishPlaceholder'):input;
            const sample=surface.startsWith('collapsed')?el:input,style=getComputedStyle(el,el===input?'::placeholder':null),canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');
            const rgba=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].map((v,i)=>i===3?v/255:v);};
            const mix=(front,back,opacity=1)=>front.slice(0,3).map((v,i)=>v*front[3]*opacity+back[i]*(1-front[3]*opacity));
            const luminance=color=>color.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
            const contrast=(ink,bg)=>{const values=[luminance(ink),luminance(bg)].sort((a,b)=>b-a);return(values[0]+.05)/(values[1]+.05);};
            let background=[255,255,255];const parents=[];for(let node=sample;node;node=node.parentElement)parents.unshift(node);
            const images=[];for(const node of parents){const s=getComputedStyle(node);background=mix(rgba(s.backgroundColor),background);if(s.backgroundImage!=='none')images.push(s.backgroundImage);}
            const color=rgba(style.color),opacity=Number(style.opacity),ink=mix(color,background,opacity);
            const other=[...document.querySelectorAll('[data-ct-target]')].find(el=>el.getAttribute('aria-label')==='Description'&&el.getClientRects().length),ordinary=other?getComputedStyle(other,'::placeholder'):null;
            return{text:el===input?input.placeholder:el.textContent,color:style.color,opacity,background,ink,contrast:contrast(ink,background),fontSize:style.fontSize,backgroundImages:images,
                ordinaryPlaceholder:ordinary?{color:ordinary.color,opacity:ordinary.opacity,contrast:contrast(mix(rgba(ordinary.color),background,Number(ordinary.opacity)),background)}:null,
                simulatedOpacity:Object.fromEntries([.65,.7,.75,.8,.85].map(alpha=>[alpha,contrast(mix(color,background,alpha),background)]))};
        },surface);
        assert.equal(data.text,'-- Use English --');assert.ok(data.contrast>=3,'readable cue: '+JSON.stringify({surface,theme,density,...data}));
        if(phase==='candidate'){
            assert.ok(data.opacity<1,'cue is dimmer than the released full-opacity style');
            if(baseline){const old=baseline.rows.find(row=>row.surface===surface&&row.theme===theme&&row.density===density);assert.ok(old);assert.ok(data.contrast<old.contrast,'lower rendered contrast than released cue');
                if(data.ordinaryPlaceholder)assert.ok(Math.abs(data.contrast-data.ordinaryPlaceholder.contrast)<Math.abs(old.contrast-old.ordinaryPlaceholder.contrast),'closer to ordinary native placeholder contrast');}
        }
        rows.push({surface,theme,density,...data});
    };
    const view=async(editor,inline)=>page.evaluate(async({editor,inline})=>{const vm=window.__clientFixtureApp;vm.ctEditor=editor;vm.inlineEditor=inline;vm.ctInlineClosed=false;vm.ctSheet='';vm.ctFilter='';vm.ctSearch='';vm.ctAppliedSearch='';vm.ctPage=1;vm.ctSelectedFilters=vm.ctStatusFilterOptions.map(option=>option.key);await vm.$nextTick();},{editor,inline});
    for(const theme of ['light','grey','dark','modern-dark'])for(const density of ['compact','spacious']){
        await page.evaluate(async({theme,density})=>{document.documentElement.dataset.theme=theme;window.__clientFixtureApp.uiDensity=density;await window.__clientFixtureApp.$nextTick();},{theme,density});
        await view(true,false);await showValue('');await measure('full-native',theme,density);
        if(density==='compact')await page.screenshot({path:join(directory,phase+'-'+theme+'-full.png')});
        await view(false,true);await measure('inline-native',theme,density);
        if(density==='compact')await page.screenshot({path:join(directory,phase+'-'+theme+'-inline.png')});
        await showValue(' \t');await measure('inline-whitespace',theme,density);
        if(density==='compact')await page.screenshot({path:join(directory,phase+'-'+theme+'-whitespace.png')});
        await showValue('');await view(false,false);await measure('collapsed-selected',theme,density);
        if(density==='compact')await page.screenshot({path:join(directory,phase+'-'+theme+'-collapsed.png')});
    }
    const savedUnchanged=await page.evaluate(async original=>{const vm=window.__clientFixtureApp;document.documentElement.dataset.theme=original.theme;vm.uiDensity=original.density;vm.inlineEditor=original.inline;vm.ctEditor=original.editor;vm.ctInlineClosed=original.closed;vm.ctValues=original.values;vm.ctDraftDirty=original.dirty;vm.ctSheet=original.sheet;vm.ctFilter=original.filter;vm.ctSearch=original.search;vm.ctAppliedSearch=original.applied;vm.ctSelectedFilters=original.filters;vm.ctPage=original.page;vm.ctQueueDraft=window.__placeholderStyleQueueDraft;delete window.__placeholderStyleQueueDraft;await vm.$nextTick();return JSON.stringify(vm.ctSaved)===original.saved;},original);
    assert.equal(savedUnchanged,true,'presentation measurements do not change saved work');
    const report={ok:true,phase,rows,minimumContrast:Math.min(...rows.map(row=>row.contrast)),scope:'Four desktop themes, compact/spacious density, full/inline native cue, whitespace overlay and selected collapsed row. CSS alpha composited over rendered solid backgrounds; screenshots verify appearance.'};
    writeFileSync(join(directory,'eng-placeholder-style-results.json'),JSON.stringify(report,null,2));console.log('Placeholder style '+phase+': '+rows.length+' cases; minimum contrast '+report.minimumContrast.toFixed(2));
};
