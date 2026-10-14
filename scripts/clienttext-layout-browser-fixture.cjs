// Disposable loopback UI fixture using current ClientText templates/components and CSS.
// It avoids API, IndexedDB, workbook imports and application lifecycle hooks.
const assert = require('node:assert/strict');
const { readFileSync, existsSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { createServer } = require('node:http');
const { randomUUID } = require('node:crypto');
const express = require('express');

const runtimeModules = 'C:/Users/lpeac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const playwright = require(process.env.PLAYWRIGHT_MODULE_PATH || require.resolve('playwright', { paths: [runtimeModules] }));
const executablePath = process.env.FIXTURE_BROWSER_PATH || [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(existsSync);
if (!executablePath) throw new Error('Set FIXTURE_BROWSER_PATH to an installed Edge/Chrome; no browser download is needed.');

const publicDir = join(__dirname, '../public');
const fixtureArtifacts = join(__dirname, '../temp/clienttext-layout-fixture');
const html = readFileSync(join(publicDir, 'index.html'), 'utf8');
const indexJs = readFileSync(join(publicDir, 'index.js'), 'utf8');
const stylesheets = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"/:]+\.css)"[^>]*>/g)]
    .map(match=>match[0].replace('href="','href="/')).join('\n');
assert.ok(stylesheets.includes('/inline-editor.css'), 'Use current local stylesheet order including inline editor rules.');
function between(source, start, end) {
    const first = source.indexOf(start), last = source.indexOf(end, first + start.length);
    assert.ok(first >= 0 && last > first, 'Current fixture markers must exist: ' + start);
    return source.slice(first, last);
}
const navigation = between(html, '<nav class="ctNavigation"', '</nav>') + '</nav>';
const workspaceShell = between(html, '<editor-workspace-shell ', '>') + '>';
const table = between(html, '<table class="display compact cell-border fileTable ctTable"', '</table>') + '</table>';
const npcHeading = between(html, '<section v-if="ctBrowseMode===\'npcs\'" class="ctNpcHeading"', '</section>') + '</section>';
const fullEditor = between(html, '<editor-full-shell v-if="ctEditor" class="ctFull ctFullEditor', '</editor-full-shell>') + '</editor-full-shell>';
const tooltipComponent = between(indexJs, 'const AppTooltip = {', 'function escapeTooltipAttr');
const tooltipMethods = between(indexJs, '    normalizeTooltipText(value) {', '    htmlTooltipMouseMove(e) {');
const tooltipDirective = between(indexJs, "app.directive('tooltip', {", "app.mount('#app');");
const longSheet = 'A very long ClientText sheet name that must remain readable through the tooltip without widening the sheet navigation';
const longNpc = 'An exceptionally long NPC name that stays readable in its tooltip while the navigation panel retains its desktop width';
const sheetData = [
    ['normal', longSheet], ['normal', 'QuestDialogues'], ['normal', 'ItemNames'],
    ['gender', longSheet], ['gender', 'ItemNames'],
].concat(Array.from({length:60},(_,index)=>['normal','Sheet '+String(index+1).padStart(3,'0')]))
    .map(([role, name]) => ({ role, name, key: JSON.stringify([role, name]) }));

const fixtureJs = `${tooltipComponent}
(async()=>{
const ct = window.ClientTextUI.mixin;
const sheets = ${JSON.stringify(sheetData)};
const fields = ['MS','MP','FS','FP','NS','NP'].map((form,index)=>({
    id:'form-'+form,kind:'form',group:'Text',name:'Text',form,source:'English source for the current record.',
    target:index===0 ? 'A long singular translation deliberately wraps into several lines when its column is narrower.' : form+' translation',
    sourceCell:'J2',targetCell:String.fromCharCode(66+index)+'2',required:true,originalMissing:false,outdated:false
}));
const unit = Vue.markRaw({id:'layout-record',role:'normal',sheet:sheets[0].name,recordId:'FixtureIdentifier',fields,notes:[],
    metadata:{Character:'Metadata/Characters/Dex/DexFourb, Metadata/Characters/Str/StrFourb',Context:'Raw <img src=x onerror=alert(1)> reference',
        Tags:'ring, crossbow, default',Arbitrary:'  keep\\tthese\\nspaces  ',Zero:'0',Flag:'false',Empty:'  '},developerNotes:'Separate developer note'});
const inactiveUnit=Vue.markRaw({id:'inactive-layout-record',role:'normal',sheet:sheets[0].name,recordId:'InactiveFixtureIdentifier',notes:[],metadata:{Tags:'inactive context',
    ...Object.fromEntries(Array.from({length:30},(_,index)=>['Reference '+index,'Additional metadata entry '+index]))},
    fields:[{id:'inactive-Text',kind:'text',name:'Text',source:'Inactive English.',target:'Inactive translation.',sourceCell:'J3',targetCell:'K3',required:true,originalMissing:false,outdated:false}]});
const referenceCharacterUnits=Vue.markRaw([['Dex','DexFourb','Huntress','B10'],['Str','StrFourb','Warrior','B8']].map(([attribute,form,source,sourceCell])=>({
    id:'reference-character-'+form,role:'normal',sheet:'Characters',recordId:'Metadata/Characters/'+attribute+'/'+form,
    fields:[{id:'Name',name:'Name',kind:'text',source,target:'Localized '+source,sourceCell,targetCell:'C'+sourceCell.slice(1),required:true},
        ...(source==='Huntress'?[
            {id:'Description',name:'Description',kind:'text',source:'An agile adventurer skilled with spear and bow. This longer biography supplies useful English context in the tooltip while the short worksheet name remains the inline label.\\nThe remaining biography continues beyond the compact tooltip preview.',target:'Localized biography',sourceCell:'E10',targetCell:'F10',required:true},
            {id:'Traits Description',name:'Traits Description',kind:'text',source:'Agility, precision and versatility.',target:'Localized traits',sourceCell:'H10',targetCell:'I10',required:true}
        ]:[])]
})));
const tagUnits=Vue.markRaw([['ring','DelveCraftingTags','Rings','B12'],['crossbow','FilterSearchOptions','Crossbow','B30'],['crossbow','GemTags','[Crossbow]','B4']].map(([recordId,sheet,source,sourceCell],index)=>({
    id:'tag-reference-'+index,role:'normal',sheet,recordId,fields:[{id:'Text',name:'Text',kind:'text',source,target:'Localized '+source,sourceCell,targetCell:'C'+sourceCell.slice(1),required:true}]
})));
const initialUnits=Vue.markRaw([unit,inactiveUnit,...referenceCharacterUnits,...tagUnits]);
await window.ContentAdapters.clienttext.contextReferenceIndex(initialUnits,{yield:()=>new Promise(resolve=>setTimeout(resolve,0))});
const classForms=['MS','FS','DexFour','DexFourb','IntFourb'];
const classUnit=Vue.markRaw({id:'class-layout-record',role:'normal',sheet:sheets[0].name,recordId:'ClassVariantFixture',notes:[],fields:classForms.map((form,index)=>({
    id:'class-'+form,kind:'form',group:'Text',name:'Text',form,source:'Raw English [Keyword] {0} @ text.',
    target:form==='DexFour'?'Ranger raw translation':form==='DexFourb'?'Huntress raw translation':index<2?'Default '+form+' translation':'',
    targetCell:String.fromCharCode(68+index)+'2',required:index<2 || form==='IntFourb',originalMissing:form==='IntFourb',outdated:false
}))});
const characterUnits=Vue.markRaw([['Dex','DexFour','Ranger'],['Dex','DexFourb','Huntress'],['Int','IntFourb','Sorceress']].map(([attribute,form,source])=>({
    id:'character-'+form,role:'normal',sheet:'Characters',recordId:'Metadata/Characters/'+attribute+'/'+form,notes:[],
    fields:[{id:'Name',kind:'text',name:'Name',source,target:'Localized label '+form,targetCell:'D2',required:true,originalMissing:false,outdated:false}]
})));
const namedFormUnit=Vue.markRaw({id:'named-form-layout-record',role:'normal',sheet:'BaseItemTypes',recordId:'Metadata/Items/Currency/CurrencyAddModToRare',notes:[],fields:
    ['Normal Translation','Possessive Translation'].map((form,index)=>({id:JSON.stringify(['Display Name',form]),kind:'form',group:'Display Name',name:'Display Name',form,
        source:'Exalted Orb {0}',target:index?'':'Yüce Küre {0}',sourceCell:'B2',targetCell:(index?'D':'C')+'2',required:!index,originalMissing:false,outdated:false}))});
const app = Vue.createApp({
    data() { return {...ct.data(),ctActive:true,ctUnits:initialUnits,ctSelection:unit.id,
        ctWorkspace:{scope:{game:'poe2',branchId:'default',language:'Thai',versionId:'fixture',groupId:'fixture'},metadata:{version:{name:'ClientText layout fixture'}}},
        ctSheet:sheets[0].key,ctSearch:'Main search retained',ctAppliedSearch:'',ctSelectedFilters:['unchanged','missing','saved'],
        ctValues:Object.fromEntries(fields.map(field=>[field.id,field.target])),
        inlineEditor:true,inlineSidebarVisible:false,mapClientTextClassNames:true,lang:'Thai',translationEditorBcp47:'th',
        gameVersion:'poe2',branchId:'default',dictionary:[],pageSize:20,hideEditorClipboard:true,
        tooltip:{visible:false,text:'',x:0,y:0,maxWidth:360}
    };},
    computed:{...Object.fromEntries(['ctCurrentUnit','ctFieldGroups','ctSheets','ctFilteredSheets','ctRows','ctPageRows','ctEffectivePageSize','ctDraftUnitIds','ctDraftCount',
        'ctOfflineTest','ctNpcGroups','ctNpcFilteredGroups','ctNpcBrowseTitle','ctNpcTotal','ctNpcKindOptions','ctNpcSeverities']
        .map(key=>[key,ct.computed[key]])),sharedEditorController:window.EditorSession.mixin.computed.sharedEditorController},
    methods:{...ct.methods,scheduleInlineAlignment:window.InlineEditor.mixin.methods.scheduleInlineAlignment,${tooltipMethods}
        ctQueueDraft(){},ctSuggest(){},ctCompletionSelectionChanged(){},
        async ctFlushDraft(){return true;},async ctFlushCommentDraft(){},
        ctStorage(){return {getDraft:async()=>null};},ctLoadHistory(){},ctLoadCommentDraft(){},ctRefreshDraftSummaries(){},
        ctPresence(){},scheduleClientTextDictionaryMatches(){},
        ctStartClassVariantFixture(){
            this.ctEditor=false;this.ctUnits=Vue.markRaw([classUnit,...characterUnits]);
            this._ctUnitIndex=Vue.markRaw(new Map(this.ctUnits.map(unit=>[unit.id,unit])));
            this.ctSelection=classUnit.id;this.ctValues=Object.fromEntries(classUnit.fields.map(field=>[field.id,field.target]));
            this.ctVariantSelections={};this.ctFocusedField='class-MS';this.ctInitializeVariants();
        },
        ctStartNamedFormFixture(){
            this.ctEditor=false;this.ctInlineClosed=false;this.ctSheet='';this.ctUnits=Vue.markRaw([namedFormUnit]);this.ctSaved=Vue.markRaw({});
            this._ctUnitIndex=Vue.markRaw(new Map([[namedFormUnit.id,namedFormUnit]]));this.ctSelection=namedFormUnit.id;
            this.ctValues=Object.fromEntries(namedFormUnit.fields.map(field=>[field.id,field.target]));this.ctReviewed={};this.ctDraftDirty=false;
            this.ctVariantSelections={};this.ctFocusedField=namedFormUnit.fields[0].id;this.lang='Turkish';this.ctWorkspace.scope.language='Turkish';
            this._ctInlineReturn=null;this.ctCloseCompletion();
        },
        async ctStartNpcFixture(){
            const text=(id,sheet,recordId,source,row=2)=>({id,role:'normal',sheet,recordId,notes:[],metadata:{},
                fields:[{id:'npc-text',name:sheet==='NPCs'?'Name':'Text',kind:'text',source,target:'Localized '+source,
                    sourceCell:'B'+row,targetCell:'C'+row,required:true,originalMissing:false,outdated:false}]});
            const npcUnits=[text('npc-renly','NPCs','Metadata/NPC/Renly','Renly'),text('npc-una','NPCs','Metadata/NPC/Una','Una',3),
                text('npc-long','NPCs','Metadata/NPC/LongResident',${JSON.stringify(longNpc)},4),
                ...Array.from({length:65},(_,index)=>text('npc-resident-'+index,'NPCs','Metadata/NPC/TownResident'+index,'Town Resident '+String(index).padStart(3,'0'),index+5)),
                text('npc-renly-topic','NPCTalk','Metadata/NPC/Renly::0','A menu topic concerning Renly'),
                text('npc-renly-audio','NPCTextAudio','RenlyLayoutIntro','Renly welcomes an adventurer.'),
                text('npc-renly-conversation','NPCTalkDialogueTextAudio','RenlyLayoutReply','A player reply addressing Renly.'),
                text('npc-unassigned-audio','NPCTextAudio','UnarmedLayoutIntro','Unrelated to Una.')];
            const index=await window.ClientTextNpcIndex.buildNpcIndex(npcUnits,{yield:()=>new Promise(resolve=>setTimeout(resolve,0))});
            this.ctEditor=false;this.ctInlineClosed=false;this._ctNpcIndex=Vue.markRaw(index);this.ctUnits=Vue.markRaw(npcUnits);this.ctRevision++;
            this._ctUnitIndex=Vue.markRaw(new Map(npcUnits.map(unit=>[unit.id,unit])));
            this._ctSheets=Vue.markRaw([...new Set(npcUnits.map(unit=>JSON.stringify([unit.role,unit.sheet])))].map(key=>({key,role:JSON.parse(key)[0],name:JSON.parse(key)[1]})));
            this.ctBrowseMode='sheets';this.ctNpcSelection='all';this.ctNpcKind='';this.ctNpcFilter='';this.ctSheet=JSON.stringify(['normal','NPCs']);
            this.ctSheetFilter='';this.ctSearch='';this.ctAppliedSearch='';this.ctFilter='';this.ctSelectedFilters=['unchanged'];this.ctPage=2;
            this.ctSaved=Vue.markRaw({});this.ctSelection='npc-renly';this.ctValues={'npc-text':'Localized Renly'};this.ctReviewed={};this.ctDraftDirty=false;
            this.ctVariantSelections={};this.ctFocusedField='npc-text';this.lang='Thai';this.ctWorkspace.scope.language='Thai';
            this._ctInlineReturn=null;this._ctBrowseViews=null;this._ctBrowseCandidateCache=null;this._ctOrderCache=null;this._ctSelectRun={};this.ctCloseCompletion();
        },
    },
    created(){this._ctUnitIndex=Vue.markRaw(new Map(this.ctUnits.map(unit=>[unit.id,unit])));this._ctSheets=Vue.markRaw(sheets);},
    mounted(){this._fixtureKey=event=>this.ctKey(event);document.addEventListener('keydown',this._fixtureKey);},
    beforeUnmount(){document.removeEventListener('keydown',this._fixtureKey);}
});
app.component('editor-workspace-shell',window.EditorComponents.WorkspaceShell);
app.component('ct-fields',window.ClientTextUI.fieldsComponent);
app.component('ct-context',window.ClientTextUI.contextComponent);
app.component('ct-target',window.ClientTextUI.targetComponent);
app.component('editor-native-field',window.EditorComponents.NativeField);
app.component('editor-diagnostic-meta',window.EditorComponents.DiagnosticMeta);
// Reserve the actual preview shell without invoking the app preview lifecycle.
app.component('editor-full-shell',{...window.EditorComponents.FullEditorShell,template:window.EditorComponents.FullEditorShell.template.replace('<div :id="previewHostId"></div>','<div :id="previewHostId"><div class="gamePreviewStrip"><strong class="gamePreviewLabel">Preview</strong><p>English source for the current record.</p></div></div>')});
app.component('ct-tools',{props:['host'],template:'<aside class="side sharedEditorSidebar ctTools"><h3>File tools</h3><p>Disposable layout fixture</p></aside>'});
app.component('app-tooltip',AppTooltip);
${tooltipDirective}
window.__ctLayoutFixture=app.mount('#app');
})().catch(error=>{console.error(error);window.__ctLayoutFixtureError=String(error);});`;

async function run() {
    mkdirSync(fixtureArtifacts, { recursive: true });
    const frontend = express(), server = createServer(frontend);
    frontend.get('/', (req, res) => res.type('html').send(`<!doctype html><html data-theme="dark"><head>
        <meta charset="utf-8">${stylesheets}</head><body><div id="app"><div class="appRoot" data-density="compact">
        <section class="ctWorkspace" aria-label="ClientText workspace">
        ${workspaceShell}<template #content>
        <div class="ctWorkspaceBody">${navigation}<div class="workspaceMain ctList">${npcHeading}<div ref="ctFileTableRegion" class="fileTableScroll">${table}</div></div></div>
        </template></editor-workspace-shell>${fullEditor}</section><app-tooltip :state="tooltip"></app-tooltip></div></div>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/vue/3.0.11/vue.global.prod.js"></script>
        <script src="/statDescCodec.js"></script><script src="/translationDiagnostics.js"></script><script src="/clientTextState.js"></script><script src="/contentAdapters.js"></script><script src="/clientTextNpcIndex.js"></script><script src="/editorSession.js"></script><script src="/editorComponents.js"></script><script src="/inlineEditor.js"></script><script src="/clientTextUi.js"></script><script src="/fixture.js"></script></body></html>`));
    frontend.get('/fixture.js', (req, res) => res.type('js').send(fixtureJs));
    frontend.use(express.static(publicDir));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const results = [], screenshots = [], errors = [];
    let browser,page;
    try {
        browser = await playwright.chromium.launch({ executablePath, headless: true, args: ['--disable-gpu'] });
        const context = await browser.newContext({viewport:{width:1440,height:900},locale:'en-US',timezoneId:'Asia/Bangkok',ignoreHTTPSErrors:true,permissions:['clipboard-read','clipboard-write']});
        page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => {if(message.type()==='error')errors.push(message.text());});
        await page.goto('http://127.0.0.1:' + server.address().port);
        await page.waitForFunction(() => !!window.__ctLayoutFixture || !!window.__ctLayoutFixtureError);
        assert.equal(await page.evaluate(()=>window.__ctLayoutFixtureError),undefined,'Fixture preparation succeeds');
        const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const nav = page.getByRole('navigation', {name:'Workbook navigation'});
        const filter = page.getByRole('searchbox', {name:'Filter sheets'});
        const tooltip = page.getByRole('tooltip');
        const rowHeader = page.getByRole('columnheader', {name:'Row number'});
        assert.equal(await rowHeader.getAttribute('aria-sort'), 'ascending', 'Worksheet row order is the default');
        assert.equal(await page.locator('.ctTable > tbody > tr > .ctRowNumber').first().textContent(), '2', 'Show the original worksheet row');
        await rowHeader.getByRole('button', {name:'Row number'}).click();
        assert.equal(await rowHeader.getAttribute('aria-sort'), 'descending', 'Pointer activation reverses row order');
        await rowHeader.getByRole('button', {name:'Row number'}).press('Enter');
        assert.equal(await rowHeader.getAttribute('aria-sort'), 'ascending', 'Keyboard activation restores ascending row order');
        results.push({name:'Worksheet row number, default ASC and pointer/keyboard sort toggle'});
        const assertPreserved = async () => assert.deepEqual(await page.evaluate(() => {
            const host=window.__ctLayoutFixture;
            return {sheet:host.ctSheet,selection:host.ctSelection,search:host.ctSearch,applied:host.ctAppliedSearch};
        }), {sheet:sheetData[0].key,selection:'layout-record',search:'Main search retained',applied:''}, 'Sheet filtering preserves the selected sheet, record and main search');
        await filter.fill('  ITEMnames  ');
        assert.deepEqual(await nav.locator('h3:visible').allTextContents(), ['Normal','Gender']);
        assert.equal(await nav.getByRole('button', {name:'ItemNames',exact:true}).count(), 2);
        assert.equal(await nav.getByRole('button').count(), 3);
        await assertPreserved();
        await filter.fill('no such sheet');
        assert.equal(await nav.getByRole('status').textContent(), 'No sheets match.');
        assert.equal(await nav.getByRole('button', {name:'All sheets',exact:true}).count(), 1);
        assert.equal(await nav.locator('h3:visible').count(), 0);
        await assertPreserved();
        await filter.press('Escape');
        assert.equal(await filter.inputValue(), '');
        assert.equal(await nav.getByRole('button').count(), sheetData.length+1);
        await assertPreserved();
        results.push({name:'Sheet filter case/trim, groups, empty state, Escape and selection/search preservation'});

        const checkGrid = async name => {
            const geometry = await page.locator('.ctFormGrid').evaluate(element => {
                const rect = node => {const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
                const unobscured = cell => {const r=cell.getBoundingClientRect();return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest('.ctFormGrid')===element;};
                const inViewport = cell => {const r=cell.getBoundingClientRect();return r.top+r.height/2>=16 && r.top+r.height/2<innerHeight-16;};
                return {table:rect(element),full:!!element.closest('.ctFullEditor'),headers:[...element.tHead.rows[0].cells].map(cell=>({
                    ...rect(cell),text:cell.textContent.trim(),align:getComputedStyle(cell).textAlign,unobscured:unobscured(cell),inViewport:inViewport(cell)})),
                    rows:[...element.tBodies[0].rows].map(row=>[...row.cells].map(cell=>({
                        ...rect(cell),text:cell.tagName==='TH'?cell.textContent.trim():undefined,
                        verticalAlign:getComputedStyle(cell).verticalAlign,unobscured:unobscured(cell),inViewport:inViewport(cell),
                        field:cell.querySelector('textarea')?rect(cell.querySelector('textarea')):null
                    }))) };
            });
            assert.deepEqual(geometry.headers.map(cell=>cell.text), ['Form','Singular','Plural'], name+': column labels');
            assert.deepEqual(geometry.rows.map(row=>row[0].text), ['M','F','N'], name+': row labels');
            assert.ok(Math.abs(geometry.headers[1].width-geometry.headers[2].width)<1, name+': equal singular/plural columns');
            for(const row of geometry.rows) for(const [index,cell] of row.entries()) {
                assert.ok(Math.abs(cell.left-geometry.headers[index].left)<1 && Math.abs(cell.right-geometry.headers[index].right)<1, name+': row/header column boundaries');
                if(index===0) assert.equal(cell.verticalAlign,'middle',name+': M/F/N labels centered vertically');
                if(cell.field) assert.ok(cell.field.left>=cell.left && cell.field.right<=cell.right && cell.field.top>=cell.top && cell.field.bottom<=cell.bottom, name+': textarea contained');
            }
            for(const header of geometry.headers) assert.equal(header.align,'center',name+': headings centered');
            if(geometry.full) {
                for(const header of geometry.headers) if(header.inViewport)assert.ok(header.unobscured,name+': full form header is visible');
                for(const row of geometry.rows) if(row[0].inViewport)assert.ok(row[0].unobscured,name+': full M/F/N label is visible');
            }
            results.push({name,formWidth:Math.round(geometry.headers[0].width),columnWidth:Math.round(geometry.headers[1].width)});
        };
        const checkTooltip = async (button, expected, name) => {
            await button.hover();await tooltip.waitFor();await settle();
            assert.equal(await tooltip.evaluate(element=>[...element.children].map(line=>line.textContent).join('\n')), expected, name+': complete custom tooltip');
            const bounds=await tooltip.boundingBox();
            assert.ok(bounds.x>=7 && bounds.y>=7 && bounds.x+bounds.width<=page.viewportSize().width-7 && bounds.y+bounds.height<=page.viewportSize().height-7,name+': tooltip stays visible');
            assert.equal(await button.getAttribute('title'),null,name+': native title removed');
            await page.mouse.move(1,1);await tooltip.waitFor({state:'detached'});
            await button.focus();await tooltip.waitFor();
            assert.equal(await tooltip.evaluate(element=>[...element.children].map(line=>line.textContent).join('\n')),expected,name+': keyboard tooltip');
            await filter.focus();await tooltip.waitFor({state:'detached'});
        };
        const checkFieldLayout=async (full,name)=>{
            const geometry=await page.locator('.ctFields[data-side="source"] .ctFieldSource, .ctFullEditor .ctFieldSource').evaluate(element=>{
                const rect=node=>{const value=node.getBoundingClientRect();return {left:value.left,right:value.right,top:value.top,bottom:value.bottom,width:value.width};};
                const source=element.closest('.ctBlock'),target=source.closest('.ctFullEditor')?source.querySelector('.ctFieldTranslation')
                    :document.querySelector('.ctFields[data-side="translation"] .ctFieldTranslation');
                return {source:rect(element),target:rect(target),highlights:document.querySelectorAll('.ctFields .HLter').length};
            });
            if(full){
                assert.ok(geometry.source.right<=geometry.target.left,name+': English stays left of translation in the full editor');
                assert.ok(Math.abs(geometry.source.width-geometry.target.width)<1,name+': English and translation get equal column widths');
                assert.ok(Math.abs(geometry.source.top-geometry.target.top)<1,name+': English and translation are top-aligned');
            }else {
                assert.ok(geometry.source.right<=geometry.target.left,name+': inline English and translation retain separate table columns');
                assert.ok(Math.abs(geometry.source.top-geometry.target.top)<1,name+': context in the identity column keeps English aligned with translation');
            }
            assert.equal(geometry.highlights,7,name+': source and all six form targets use shared highlight overlays');
            results.push({name:name+' native field layout',sourceWidth:Math.round(geometry.source.width),targetWidth:Math.round(geometry.target.width)});
        };
        const checkReferences=async (full,name)=>{
            const prefix=full?'.ctFullEditor':'tr[data-unit-id="layout-record"] .fileIdentityCell',references=page.locator(prefix+' .ctReferenceContext');
            assert.equal(await page.locator('.ctReferenceContext:visible').count(),full?1:2,name+': each visible record with metadata has context');
            assert.equal(await page.locator('tr[data-unit-id="inactive-layout-record"] .ctReferenceContext').count(),1,name+': inactive row retains its context');
            assert.equal(await page.locator('.ctFields .ctReferenceContext').count(),0,name+': context is absent from English and translation fields');
            assert.deepEqual(await references.locator('dt').allTextContents(),['Character','Context','Tags','Arbitrary','Zero','Flag'],name+': all nonblank headings preserve workbook column order');
            assert.deepEqual(await references.locator('dd').allTextContents(),[
                'Huntress, Warrior','Raw <img src=x onerror=alert(1)> reference','ring, crossbow, default','  keep\tthese\nspaces  ','0','false'
            ],name+': names replace structured paths while raw tags and exact arbitrary text remain visible');
            assert.equal(await references.locator('img,input,textarea,button').count(),0,name+': escaped read-only reference text');
            assert.equal(await page.locator((full?'.ctFullEditor':'.ctFields[data-side="source"]')+' .ctDeveloperNotes pre').textContent(),'Separate developer note',name+': developer notes remain separate');
            assert.equal(await references.locator('dd').evaluateAll(elements=>elements.every(element=>getComputedStyle(element).userSelect==='text'
                && getComputedStyle(element).whiteSpace==='pre-wrap' && element.scrollWidth<=element.clientWidth+1)),true,name+': selectable wrapped reference paths');
            const tooltipText=()=>tooltip.evaluate(element=>[...element.children].map(line=>line.textContent===' '?'':line.textContent).join('\n'));
            const expectedParts=await page.evaluate(()=>window.__ctLayoutFixture.ctReferenceMetadata().flatMap(item=>item.parts.filter(part=>part.tooltip)));
            assert.deepEqual(expectedParts.map(part=>part.text),['Huntress','Warrior','ring','crossbow'],name+': matched list items have individual tooltips');
            for(const [index,part] of expectedParts.entries()) {
                const token=references.locator('.ctContextPart[tabindex="0"]').nth(index);
                assert.equal(await token.getAttribute('title'),null,name+': use shared tooltip component');
                await token.hover();await tooltip.waitFor();await settle();
                assert.equal(await tooltipText(),part.tooltip,name+': hover reveals exact token reference details');
                const bounds=await tooltip.boundingBox();assert.ok(bounds.x>=7 && bounds.y>=7 && bounds.x+bounds.width<=page.viewportSize().width-7 && bounds.y+bounds.height<=page.viewportSize().height-7,name+': reference tooltip stays in viewport');
                await page.mouse.move(1,1);await tooltip.waitFor({state:'detached'});
                await token.focus();await tooltip.waitFor();assert.equal(await tooltipText(),part.tooltip,name+': keyboard focus reveals the same token information');
                await page.locator(full?'.ctFullEditor [data-ct-target="form-FS"]':'.ctFields[data-side="translation"] [data-ct-target="form-FS"]').focus();await tooltip.waitFor({state:'detached'});
            }
            for(const detail of ['Metadata/Characters/Dex/DexFourb','Huntress','Characters!B10','English Description:','Characters!E10','+1 more English fields'])assert.ok(expectedParts[0].tooltip.includes(detail),name+': Character tooltip includes '+detail);
            for(const detail of ['ring','Rings','DelveCraftingTags!B12'])assert.ok(expectedParts[2].tooltip.includes(detail),name+': bare tag tooltip includes related '+detail);
            for(const detail of ['crossbow','Crossbow','[Crossbow]','FilterSearchOptions!B30','GemTags!B4'])assert.ok(expectedParts[3].tooltip.includes(detail),name+': ambiguous tag includes each related '+detail);
            assert.equal(await references.evaluate(element=>{
                const identity=element.closest('.ctFullEditor')?element.previousElementSibling:element.parentElement.querySelector('.ctFilePath');
                return identity.nextElementSibling===element && (!element.closest('.ctFullEditor') || element.nextElementSibling.classList.contains('ctEditorNavigation'));
            }),true,name+': context follows the filepath and precedes full-editor navigation');
            await page.locator(full?'.ctFullEditor [data-ct-target="form-FS"]':'.ctFields[data-side="translation"] [data-ct-target="form-FS"]').focus();await tooltip.waitFor({state:'detached'});
        };
        const checkContextInteraction=async name=>{
            const input=page.locator('.ctFields[data-side="translation"] [data-ct-target="form-FS"]'),original=await input.inputValue();
            await input.fill('Draft retained while selecting context text.');
            const before=await page.evaluate(()=>{
                const host=window.__ctLayoutFixture;
                return {values:JSON.stringify(host.ctValues),selection:host.ctSelection,editor:host.ctEditor,closed:host.ctInlineClosed};
            });
            const context=page.locator('tr[data-unit-id="layout-record"] .ctReferenceContext'),token=context.locator('.ctContextPart[tabindex="0"]').first();
            await context.locator('dd').nth(3).click();await context.locator('dd').nth(3).dblclick();
            await token.focus();await token.press('ArrowDown');await token.press('Enter');await settle();
            assert.deepEqual(await page.evaluate(()=>{
                const host=window.__ctLayoutFixture;
                return {values:JSON.stringify(host.ctValues),selection:host.ctSelection,editor:host.ctEditor,closed:host.ctInlineClosed};
            }),before,name+': pointer and keyboard context actions preserve the draft and active row');
            await token.press('Tab');
            assert.equal(await context.locator('.ctContextPart[tabindex="0"]').nth(1).evaluate(element=>element===document.activeElement),true,name+': Tab traverses individual reference tokens');
            const raw=context.locator('dd').nth(3),expected=await raw.textContent();
            await raw.evaluate(element=>{
                const selection=window.getSelection(),range=document.createRange();range.selectNodeContents(element);selection.removeAllRanges();selection.addRange(range);
            });
            assert.equal(await page.evaluate(()=>window.getSelection().toString()),expected,name+': raw context is selectable without modifying text');
            await page.keyboard.press('Control+c');
            assert.equal((await page.evaluate(()=>navigator.clipboard.readText())).replace(/\r\n/g,'\n'),expected,name+': copying preserves raw context whitespace with native Windows line endings');
            await input.fill(original);await input.focus();await tooltip.waitFor({state:'detached'});
            results.push({name:name+' context selection, copying, token Tab navigation and draft retention'});
        };
        for(const mode of [{inlineEditor:false,ctInlineClosed:false},{inlineEditor:true,ctInlineClosed:true}]) {
            await page.evaluate(mode=>Object.assign(window.__ctLayoutFixture,mode),mode);await settle();
            assert.equal(await page.locator('.ctReferenceContext:visible').count(),2,'Context is available before selecting or editing a row');
        }
        await page.evaluate(()=>Object.assign(window.__ctLayoutFixture,{inlineEditor:true,ctInlineClosed:false}));await settle();
        results.push({name:'Context visible on selected and unselected rows in regular and closed inline modes'});
        const checkContextBounds=async name=>{
            const context=page.locator('tr[data-unit-id="inactive-layout-record"] .ctReferenceContext'),
                active=page.locator('tr[data-unit-id="layout-record"] .ctReferenceContext');
            const short=await context.evaluate(element=>{
                element.scrollTop=0;
                const rect=element.getBoundingClientRect(),first=element.querySelector('.ctContextEntry').getBoundingClientRect();
                const row=element.closest('tr').getBoundingClientRect().height,list=element.firstElementChild,extras=[...list.children].slice(1);
                extras.forEach(node=>node.remove());const oneEntryRow=element.closest('tr').getBoundingClientRect().height;
                list.append(...extras);
                return {height:rect.height,firstInside:first.top>=rect.top && first.bottom<=rect.bottom,
                    scroll:element.scrollHeight,client:element.clientHeight,row,oneEntryRow};
            });
            assert.ok(short.firstInside,name+': at least one complete metadata entry fits in a short row');
            assert.ok(short.scroll>short.client,name+': excess metadata scrolls inside the context');
            assert.ok(Math.abs(short.row-short.oneEntryRow)<=1,name+': thirty metadata entries take the same row height as one');
            const before=await page.evaluate(()=>({selection:window.__ctLayoutFixture.ctSelection,values:JSON.stringify(window.__ctLayoutFixture.ctValues)}));
            await context.focus();await context.press('End');
            await page.waitForFunction(()=>document.querySelector('tr[data-unit-id="inactive-layout-record"] .ctReferenceContext').scrollTop>0);
            assert.deepEqual(await page.evaluate(()=>({selection:window.__ctLayoutFixture.ctSelection,values:JSON.stringify(window.__ctLayoutFixture.ctValues)})),before,name+': keyboard scrolling metadata leaves the active draft intact');
            await context.evaluate(element=>element.scrollTop=0);
            const tall=await active.evaluate(element=>({row:element.closest('tr').getBoundingClientRect().height,
                padding:[...element.closest('tr').children].reduce((maximum,cell)=>{const style=getComputedStyle(cell);return Math.max(maximum,parseFloat(style.paddingTop)+parseFloat(style.paddingBottom)+parseFloat(style.borderBottomWidth));},0),
                content:Math.max(...[...element.closest('tr').querySelectorAll(':scope > .inlineSourceCell > *,:scope > .inlineTranslationCell > *')].map(node=>node.getBoundingClientRect().height)),
                height:element.getBoundingClientRect().height}));
            assert.ok(tall.height>short.height,name+': inline metadata uses the taller source/translation area');
            assert.ok(tall.row<=tall.content+tall.padding+1,name+': metadata does not increase the tall source/translation row '+JSON.stringify(tall));
            results.push({name:name+' all-row metadata, one-entry minimum, bounded row height and keyboard scrolling'});
        };
        for(const theme of ['light','grey','dark','modern-dark']) for(const width of [1440,1100,1000]) {
            await page.setViewportSize({width,height:900});
            await page.evaluate(theme=>{document.documentElement.setAttribute('data-theme',theme);window.__ctLayoutFixture.ctEditor=false;},theme);
            await settle();
            const tableGeometry=await page.locator('.ctTable').evaluate(table=>({
                headers:[...table.tHead.rows[0].cells].map(cell=>cell.getBoundingClientRect().width),
                number:table.tBodies[0].rows[0].cells[0].textContent.trim(),
                numberFits:table.tBodies[0].rows[0].cells[0].scrollWidth<=table.tBodies[0].rows[0].cells[0].clientWidth
            }));
            assert.equal(tableGeometry.headers.length,4,theme+'/'+width+': worksheet row column is visible');
            assert.equal(tableGeometry.number,'2');assert.equal(tableGeometry.numberFits,true,theme+'/'+width+': row number fits');
            assert.ok(Math.abs(tableGeometry.headers[2]-tableGeometry.headers[3])<1,theme+'/'+width+': equal English/translation widths');
            const longButton=nav.getByRole('button',{name:longSheet,exact:true}).first();
            const ellipsis=await longButton.evaluate(element=>({whiteSpace:getComputedStyle(element).whiteSpace,overflow:getComputedStyle(element).overflow,textOverflow:getComputedStyle(element).textOverflow,client:element.clientWidth,scroll:element.scrollWidth}));
            assert.equal(ellipsis.whiteSpace,'nowrap');assert.equal(ellipsis.overflow,'hidden');assert.equal(ellipsis.textOverflow,'ellipsis');
            assert.ok(ellipsis.scroll>ellipsis.client,theme+'/'+width+': long sheet is truncated without widening navigation');
            await checkTooltip(longButton,longSheet+'\nNormal workbook',theme+'/'+width);
            await checkGrid(theme+'/'+width+' inline');
            await checkFieldLayout(false,theme+'/'+width+' inline');
            await checkContextBounds(theme+'/'+width+' inline');
            await checkReferences(false,theme+'/'+width+' inline');
            if(width===1100)await checkContextInteraction(theme+'/'+width+' inline');
            if(theme==='modern-dark' && width===1100) {
                await longButton.hover();await tooltip.waitFor();await settle();
                const path=join(fixtureArtifacts,'sdeditor-clienttext-inline-'+randomUUID()+'.png');
                await page.screenshot({path});screenshots.push(path);
                await page.mouse.move(1,1);await tooltip.waitFor({state:'detached'});
            }
            const scrollBefore=await nav.evaluate(element=>{
                const list=element.querySelector('.ctSheetList'),filter=element.querySelector('.ctSheetFilter'),top=filter.getBoundingClientRect().top;
                window.__ctSheetNodes={nav:element,list,filter,button:list.querySelector('button')};
                list.scrollTop=413;
                return {top:list.scrollTop,filterTopBefore:top,filterTopAfter:filter.getBoundingClientRect().top,
                    filterInsideList:list.contains(filter),navScrollTop:element.scrollTop,client:list.clientHeight,height:list.scrollHeight};
            });
            assert.ok(scrollBefore.top>0 && scrollBefore.height>scrollBefore.client,theme+'/'+width+': sheet list scrolls');
            assert.equal(scrollBefore.filterInsideList,false,theme+'/'+width+': filter is outside the scroll container');
            assert.equal(scrollBefore.filterTopBefore,scrollBefore.filterTopAfter,theme+'/'+width+': sheet scrolling keeps the filter fixed');
            assert.equal(scrollBefore.navScrollTop,0,theme+'/'+width+': navigation shell does not scroll');
            const inlineField=page.locator('.ctListWorkspace [data-ct-target="form-FS"]');
            await inlineField.focus();await inlineField.evaluate(input=>input.setSelectionRange(2,5,'backward'));
            await inlineField.press('Control+Enter');await page.locator('.ctFullEditor').waitFor();await settle();
            assert.deepEqual(errors,[],theme+'/'+width+': no browser errors switching to full editor');
            assert.equal(await page.locator('.ctFullEditor').count(),1,theme+'/'+width+': full editor template mounted');
            assert.equal(await page.locator('.ctListWorkspace').evaluate(element=>getComputedStyle(element).display),'none');
            assert.equal(await page.locator('.ctListWorkspace [data-ct-target]').count(),0,theme+'/'+width+': hidden workspace cannot compete for field refs');
            const fullField=page.locator('.ctFullEditor [data-ct-target="form-FS"]');
            const caret=()=>fullField.evaluate(input=>({active:input===document.activeElement,start:input.selectionStart,end:input.selectionEnd,direction:input.selectionDirection}));
            assert.deepEqual(await caret(),{active:true,start:2,end:5,direction:'backward'},theme+'/'+width+': Ctrl+Enter retains field and selection');
            await fullField.press('Escape');await page.locator('.ctFullEditor').waitFor({state:'detached'});await settle();
            assert.deepEqual(await inlineField.evaluate(input=>({active:input===document.activeElement,start:input.selectionStart,end:input.selectionEnd,direction:input.selectionDirection})),
                {active:true,start:2,end:5,direction:'backward'},theme+'/'+width+': Escape restores inline field and selection');
            const retained=await nav.evaluate(element=>{
                const saved=window.__ctSheetNodes,list=element.querySelector('.ctSheetList');
                return {nav:element===saved.nav,list:list===saved.list,filter:element.querySelector('.ctSheetFilter')===saved.filter,
                    button:list.querySelector('button')===saved.button,top:list.scrollTop};
            });
            assert.deepEqual(retained,{nav:true,list:true,filter:true,button:true,top:scrollBefore.top},theme+'/'+width+': returning preserves original Sheets DOM and scroll');
            await page.locator('.ctID').first().click();await page.locator('.ctFullEditor').waitFor();
            await page.locator('.ctEditorActionButtons').getByRole('button',{name:'Close',exact:true}).click();await settle();
            assert.equal(await page.locator('#ctSheetsPanel .ctSheetList').evaluate(element=>element.scrollTop),scrollBefore.top,theme+'/'+width+': pointer open and Close retain Sheets scroll');
            await assertPreserved();
            results.push({name:theme+'/'+width+' Sheets DOM, fixed filter, scroll and keyboard focus retention',scrollTop:retained.top});
            await page.locator('.ctID').first().click();await page.locator('.ctFullEditor').waitFor();await page.mouse.move(1,1);await tooltip.waitFor({state:'detached'});await settle();
            await checkGrid(theme+'/'+width+' full');
            await checkFieldLayout(true,theme+'/'+width+' full');
            await checkReferences(true,theme+'/'+width+' full');
            const lastFormLabel=page.locator('.ctFullEditor .ctFormGrid tbody tr:last-child > th');
            await lastFormLabel.scrollIntoViewIfNeeded();
            assert.equal(await lastFormLabel.evaluate(element=>{const r=element.getBoundingClientRect();return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)===element;}),true,theme+'/'+width+': last full form label remains reachable by scrolling');
            await page.evaluate(()=>window.scrollTo(0,0));await settle();
            const actions=await page.locator('.ctEditorActionButtons').evaluate(element=>({
                right:element.getBoundingClientRect().right,headerRight:element.closest('.editorActions').getBoundingClientRect().right,
                buttons:[...element.children].map(button=>{const rect=button.getBoundingClientRect();return {text:button.textContent.trim(),left:rect.left,right:rect.right,top:rect.top};})
            }));
            assert.deepEqual(actions.buttons.map(button=>button.text),['Save','Save & close','Close']);
            assert.ok(actions.right<=actions.headerRight+1,theme+'/'+width+': grouped actions fit the editor header');
            for(let index=1;index<actions.buttons.length;index++){
                const before=actions.buttons[index-1],after=actions.buttons[index];
                if(Math.abs(before.top-after.top)<1)assert.ok(after.left-before.right>=0 && after.left-before.right<12,theme+'/'+width+': action buttons remain adjacent');
            }
            const gutter=await page.locator('.ctFullEditor > .edit').evaluate(element=>{
                const probe=document.createElement('div');probe.className='editor';probe.style.cssText='position:absolute;left:-10000px;visibility:hidden';
                const edit=document.createElement('div');edit.className='edit';probe.append(edit);element.closest('[data-density]').append(probe);
                const result={left:element.getBoundingClientRect().left,padding:getComputedStyle(element).paddingLeft,margin:getComputedStyle(element).marginLeft,shellPadding:getComputedStyle(edit).paddingLeft};probe.remove();return result;
            });
            assert.equal(gutter.left,0,theme+'/'+width+': full editor begins at left edge');
            assert.equal(gutter.padding,gutter.shellPadding,theme+'/'+width+': full editor keeps the shared shell gutter');
            assert.equal(gutter.margin,'0px',theme+'/'+width+': full editor has no left margin');
            if(theme==='modern-dark' && width===1440) {
                const path=join(fixtureArtifacts,'sdeditor-clienttext-full-'+randomUUID()+'.png');
                await page.screenshot({path});screenshots.push(path);
            }
        }
        await page.evaluate(()=>window.__ctLayoutFixture.ctStartClassVariantFixture());await settle();
        const assertClassLabels=async (mapped,name)=>{
            const ranger=mapped?'Ranger (DexFour)':'DexFour',huntress=mapped?'Huntress (DexFourb)':'DexFourb',
                sorceress=mapped?'Sorceress (IntFourb)':'IntFourb',tabs=page.getByRole('tablist',{name:'Populated class variants'}),
                picker=page.getByRole('combobox',{name:'All worksheet class variants'});
            assert.deepEqual(await tabs.getByRole('tab').allTextContents(),mapped?['Ranger','Huntress']:['DexFour','DexFourb'],name+': mapped tab text');
            assert.deepEqual(await tabs.getByRole('tab').evaluateAll(elements=>elements.map(element=>element.getAttribute('aria-label'))),[ranger,huntress],name+': tab accessibility retains raw class codes');
            assert.deepEqual(await picker.locator('option').evaluateAll(elements=>elements.map(element=>({value:element.value,label:element.textContent}))),[
                {value:'class-DexFour',label:ranger},{value:'class-DexFourb',label:huntress},{value:'class-IntFourb',label:sorceress+' (blank) · Missing'}
            ],name+': picker preserves raw IDs and blank/workload facts');
            const input=page.locator('[data-ct-target="class-DexFour"]');
            assert.ok((await input.getAttribute('aria-label')).includes(ranger),name+': translation accessibility follows display setting');
        };
        const captureClassState=()=>page.evaluate(()=>{
            const host=window.__ctLayoutFixture,input=document.querySelector('[data-ct-target="class-DexFour"]');
            return {units:JSON.stringify(host.ctUnits),saved:JSON.stringify(host.ctSaved),values:JSON.stringify(host.ctValues),
                selections:JSON.stringify(host.ctVariantSelections),selection:host.ctSelection,focused:host.ctFocusedField,dirty:host.ctDraftDirty,
                input:{value:input.value,active:input===document.activeElement,start:input.selectionStart,end:input.selectionEnd,direction:input.selectionDirection}};
        });
        for(const theme of ['light','grey','dark','modern-dark'])for(const full of [false,true]){
            await page.setViewportSize({width:1100,height:900});
            await page.evaluate(({theme,full})=>{document.documentElement.setAttribute('data-theme',theme);const host=window.__ctLayoutFixture;
                host.mapClientTextClassNames=true;host.ctEditor=full;host.ctSelectVariant(host.ctFieldGroups[0],'class-DexFour',{focus:false});}, {theme,full});
            await settle();const name=theme+' class variants '+(full?'full':'inline'),input=page.locator('[data-ct-target="class-DexFour"]');
            await input.fill('Draft @ raw\\n\ntranslation');await input.evaluate(element=>element.setSelectionRange(2,7,'backward'));
            await assertClassLabels(true,name);
            const before=await captureClassState();
            await page.evaluate(()=>window.__ctLayoutFixture.mapClientTextClassNames=false);await settle();
            await assertClassLabels(false,name+' disabled');assert.deepEqual(await captureClassState(),before,name+': disabling only changes labels');
            await page.evaluate(()=>window.__ctLayoutFixture.mapClientTextClassNames=true);await settle();
            await assertClassLabels(true,name+' re-enabled');assert.deepEqual(await captureClassState(),before,name+': re-enabling preserves draft, data, raw variant and caret');
            const tabs=page.getByRole('tablist',{name:'Populated class variants'});
            await tabs.getByRole('tab',{name:'Ranger (DexFour)',exact:true}).press('ArrowRight');await settle();
            assert.equal(await page.getByRole('combobox',{name:'All worksheet class variants'}).inputValue(),'class-DexFourb',name+': keyboard selects the independent Fourb field');
            assert.equal(await page.locator('[data-ct-target="class-DexFourb"]').inputValue(),'Huntress raw translation',name+': selection uses its exact unchanged raw target');
            await page.getByRole('combobox',{name:'All worksheet class variants'}).selectOption('class-IntFourb');await settle();
            assert.equal(await page.locator('[data-ct-target="class-IntFourb"]').inputValue(),'',name+': mapped blank Missing variant remains selectable');
            results.push({name:name+' default/disabled display, immutable values, exact IDs, caret and keyboard selection'});
            if(theme==='modern-dark' && full){
                const path=join(fixtureArtifacts,'sdeditor-clienttext-class-mapping-'+randomUUID()+'.png');
                await page.screenshot({path});screenshots.push(path);
            }
        }
        for(const theme of ['light','grey','dark','modern-dark'])for(const full of [false,true]){
            await page.setViewportSize({width:1100,height:900});
            await page.evaluate(({theme,full})=>{document.documentElement.setAttribute('data-theme',theme);const host=window.__ctLayoutFixture;
                host.ctStartNamedFormFixture();host.ctEditor=full;}, {theme,full});await settle();
            const name=theme+' named forms '+(full?'full':'inline'),normal=page.locator('#ctfield-C2'),possessive=page.locator('#ctfield-D2'),grid=page.locator('.ctNamedFormGrid');
            assert.deepEqual(await grid.locator('thead th').allTextContents(),['Form','Translation'],name+': named form headings');
            assert.deepEqual(await grid.locator('tbody th').allTextContents(),['Normal','Possessive'],name+': short row labels preserve raw identities');
            assert.equal(await page.locator('.ctSourceBlock textarea[data-ct-source]').count(),1,name+': both targets share one English source');
            assert.equal(await normal.inputValue(),'Yüce Küre {0}');assert.equal(await possessive.inputValue(),'');
            assert.equal(await possessive.getAttribute('placeholder'),'Optional translation',name+': original blank possessive stays optional');
            assert.equal(await possessive.getAttribute('aria-invalid'),null,name+': optional blank is not an SD validation error');
            assert.equal(await grid.locator('tbody tr').nth(1).locator('.diagnosticErrorPill').count(),0,name+': no blank-translation error pill');
            assert.deepEqual(await page.evaluate(()=>{
                const host=window.__ctLayoutFixture,[normal,possessive]=host.ctCurrentUnit.fields;
                return {analyzer:typeof window.TranslationDiagnostics.analyze,normalRequired:normal.required,possessiveRequired:possessive.required,
                    source:possessive.source,original:possessive.target,missing:host.ctFieldStatus(possessive).missing,outdated:host.ctFieldStatus(possessive).outdated,
                    diagnostics:host.ctFieldController(possessive).diagnostics.map(issue=>issue.code)};
            }),{analyzer:'function',normalRequired:true,possessiveRequired:false,source:'Exalted Orb {0}',original:'',missing:false,outdated:false,diagnostics:[]},
                name+': real shared analyzer preserves independent workbook status and blank optional form facts');
            await normal.fill('NON');await normal.press('Tab');await settle();
            assert.equal(await possessive.evaluate(element=>element===document.activeElement),true,name+': C to D Tab traversal');
            assert.equal(await normal.inputValue(),'NON',name+': named form does not complete NONEXISTENT');
            await possessive.press('Shift+Tab');await settle();assert.equal(await normal.evaluate(element=>element===document.activeElement),true,name+': D to C reverse traversal');
            await normal.fill('Normal raw @\\n\n{0}');await possessive.fill('Independent possessive {0}');
            assert.equal(await normal.inputValue(),'Normal raw @\\n\n{0}',name+': possessive editing preserves normal draft');
            const bounds=await grid.evaluate(element=>{const rect=element.getBoundingClientRect();return{left:rect.left,right:rect.right,width:window.innerWidth,
                rows:[...element.querySelectorAll('tbody th')].map(label=>({text:label.textContent,width:label.clientWidth,scroll:label.scrollWidth}))};});
            assert.ok(bounds.left>=0 && bounds.right<=bounds.width+1,name+': named forms fit resized desktop');
            assert.ok(bounds.rows.every(row=>row.scroll<=row.width+1),name+': Normal/Possessive labels remain readable');
            if(!full){
                await possessive.focus();await possessive.evaluate(element=>element.setSelectionRange(1,5,'backward'));
                await possessive.press('Control+Enter');await page.waitForFunction(()=>window.__ctLayoutFixture.ctEditor);await settle();
                assert.equal(await possessive.evaluate(element=>element===document.activeElement),true,name+': full editor restores exact possessive field');
                assert.deepEqual(await possessive.evaluate(element=>[element.selectionStart,element.selectionEnd,element.selectionDirection]),[1,5,'backward']);
                await possessive.press('Escape');await page.waitForFunction(()=>!window.__ctLayoutFixture.ctEditor);await settle();
                assert.equal(await possessive.evaluate(element=>element===document.activeElement),true,name+': Escape returns to inline possessive field');
                assert.deepEqual(await possessive.evaluate(element=>[element.selectionStart,element.selectionEnd,element.selectionDirection]),[1,5,'backward']);
                assert.equal(await normal.inputValue(),'Normal raw @\\n\n{0}');assert.equal(await possessive.inputValue(),'Independent possessive {0}');
            }
            results.push({name:name+' blank optional validation, independent fields, shared English, worksheet keyboard order and exact full/inline handoff'});
        }
        for(const theme of ['light','grey','dark','modern-dark'])for(const width of [1440,1100]){
            await page.setViewportSize({width,height:900});
            await page.evaluate(async theme=>{document.documentElement.dataset.theme=theme;await window.__ctLayoutFixture.ctStartNpcFixture();},theme);
            await settle();const name=theme+'/'+width+' NPC browsing',tabs=page.getByRole('tablist',{name:'Browse workbooks'}),
                sheetsTab=tabs.getByRole('tab',{name:'Sheets',exact:true}),npcTab=tabs.getByRole('tab',{name:'NPCs',exact:true});
            assert.equal(await sheetsTab.getAttribute('aria-selected'),'true',name+': Sheets is the default');
            await sheetsTab.focus();await sheetsTab.press('ArrowRight');await settle();
            assert.equal(await npcTab.evaluate(element=>element===document.activeElement),true,name+': ArrowRight moves tab focus');
            await npcTab.press('Space');await page.waitForFunction(()=>window.__ctLayoutFixture.ctBrowseMode==='npcs' && !window.__ctLayoutFixture.ctBrowseBusy);await settle();
            const npcFilter=page.getByRole('searchbox',{name:'Filter NPCs',exact:true});
            assert.ok(await page.evaluate(()=>window.__ctLayoutFixture.ctSelectedFilters.includes('unchanged')),name+': NPC view includes Unchanged');
            const heading=page.getByRole('region',{name:'NPC text'});
            assert.equal(await heading.getByRole('heading',{level:2}).textContent(),'All NPC text',name+': production heading');
            const longNpcButton=nav.getByRole('button',{name:longNpc,exact:true}),longNpcLabel=longNpcButton.locator('.ctNpcName');
            const clipped=await longNpcLabel.evaluate(element=>({client:element.clientWidth,scroll:element.scrollWidth,
                overflow:getComputedStyle(element).overflow,textOverflow:getComputedStyle(element).textOverflow,whiteSpace:getComputedStyle(element).whiteSpace}));
            assert.equal(clipped.overflow,'hidden');assert.equal(clipped.textOverflow,'ellipsis');assert.equal(clipped.whiteSpace,'nowrap');
            assert.ok(clipped.scroll>clipped.client,name+': long name truncates inside navigation');
            const geometry=await nav.evaluate(element=>({left:element.getBoundingClientRect().left,right:element.getBoundingClientRect().right,
                width:innerWidth,document:document.documentElement.scrollWidth,
                controls:[...element.querySelectorAll('button,input')].filter(control=>control.getClientRects().length && getComputedStyle(control).visibility!=='hidden')
                    .map(control=>({left:control.getBoundingClientRect().left,right:control.getBoundingClientRect().right}))}));
            assert.ok(geometry.left>=-1 && geometry.right<=width+1 && geometry.document<=width+1,name+': panel and page fit desktop width');
            assert.ok(geometry.controls.every(control=>control.left>=-1 && control.right<=width+1),name+': all navigation controls fit');
            await npcFilter.fill('RENLY');
            assert.equal(await nav.locator('.ctNpcButton:visible').count(),1,name+': NPC filter ignores case');
            await nav.getByRole('button',{name:'Renly',exact:true}).click();await page.waitForFunction(()=>!window.__ctLayoutFixture.ctBrowseBusy);await settle();
            assert.deepEqual(await page.evaluate(()=>window.__ctLayoutFixture.ctRows.map(unit=>unit.sheet).sort()),['NPCTextAudio','NPCs','NPCTalk','NPCTalkDialogueTextAudio'].sort(),name+': one worklist spans all four sheets');
            await npcFilter.press('Escape');await settle();
            const list=nav.locator('.ctNpcList'),scrollBefore=await list.evaluate(element=>{element.scrollTop=413;return element.scrollTop;});
            assert.ok(scrollBefore>0,name+': NPC list scrolls independently');
            await page.locator('.ctID').filter({hasText:'RenlyLayoutIntro'}).click();await page.locator('.ctFullEditor').waitFor();await settle();
            const field=page.locator('.ctFullEditor [data-ct-target="npc-text"]');
            await field.focus();await field.evaluate(element=>element.setSelectionRange(1,5,'backward'));await field.press('Escape');
            await page.locator('.ctFullEditor').waitFor({state:'detached'});await settle();
            assert.equal(await list.evaluate(element=>element.scrollTop),scrollBefore,name+': returning retains NPC scroll');
            const inline=page.locator('.ctListWorkspace [data-ct-target="npc-text"]');
            await inline.focus();await inline.evaluate(element=>element.setSelectionRange(2,6,'backward'));await inline.press('Control+Enter');
            await page.locator('.ctFullEditor').waitFor();await settle();
            assert.deepEqual(await field.evaluate(element=>({active:element===document.activeElement,start:element.selectionStart,end:element.selectionEnd,direction:element.selectionDirection})),
                {active:true,start:2,end:6,direction:'backward'},name+': NPC full editor preserves exact inline caret');
            await field.press('Escape');await page.locator('.ctFullEditor').waitFor({state:'detached'});await settle();
            assert.deepEqual(await inline.evaluate(element=>({active:element===document.activeElement,start:element.selectionStart,end:element.selectionEnd,direction:element.selectionDirection})),
                {active:true,start:2,end:6,direction:'backward'},name+': NPC Escape restores inline caret');
            await sheetsTab.click();await page.waitForFunction(()=>window.__ctLayoutFixture.ctBrowseMode==='sheets' && !window.__ctLayoutFixture.ctBrowseBusy);await settle();
            assert.equal(await page.evaluate(()=>window.__ctLayoutFixture.ctPage),2,name+': Sheets retains its independent page');
            await npcTab.click();await page.waitForFunction(()=>window.__ctLayoutFixture.ctBrowseMode==='npcs' && !window.__ctLayoutFixture.ctBrowseBusy);await settle();
            assert.equal(await heading.getByRole('heading',{level:2}).textContent(),'Renly',name+': NPC selection survives return');
            assert.equal(await list.evaluate(element=>element.scrollTop),scrollBefore,name+': tab return preserves NPC scroll');
            await page.evaluate(()=>{
                const vm=window.__ctLayoutFixture,renly=vm.ctUnits.find(unit=>unit.recordId==='RenlyLayoutIntro'),una=vm.ctUnits.find(unit=>unit.recordId==='Metadata/NPC/Una');
                vm.ctSaved=Vue.markRaw({[renly.id]:{saved:true,values:{'npc-text':''},reviewed:{}}});
                vm.ctDiagnostics=Vue.markRaw({[renly.id]:[{severity:'warning'}],[una.id]:[{severity:'warning'}]});vm.ctRevision++;
                vm.ctSelectedFilters=['unchanged'];vm.ctNpcKind='names';
            });await settle();
            const renlyButton=nav.getByRole('button',{name:'Renly',exact:true}),unaButton=nav.getByRole('button',{name:'Una',exact:true}),
                renlyName=renlyButton.locator('.ctNpcName'),unaName=unaButton.locator('.ctNpcName');
            assert.equal(await renlyName.evaluate(element=>element.classList.contains('ctNpcSeverity-error')),true,name+': a hidden Missing entry takes precedence over Warning');
            assert.equal(await renlyName.evaluate(element=>getComputedStyle(element).color),await renlyName.evaluate(element=>{
                const probe=document.createElement('span');probe.style.color='var(--ui-error)';element.append(probe);const color=getComputedStyle(probe).color;probe.remove();return color;
            }),name+': selected NPC name retains red rather than the selection accent');
            assert.equal(await renlyButton.getAttribute('aria-description'),'Missing or Error in related text');
            assert.equal(await unaName.evaluate(element=>getComputedStyle(element).color),['dark','modern-dark'].includes(theme)?'rgb(243, 211, 107)':'rgb(114, 85, 0)',name+': warning name uses readable yellow');
            await page.evaluate(()=>{
                const vm=window.__ctLayoutFixture,renly=vm.ctUnits.find(unit=>unit.recordId==='RenlyLayoutIntro');
                vm.ctSaved=Vue.markRaw({[renly.id]:{saved:true,values:{'npc-text':'Complete translation'},reviewed:{}}});vm.ctRevision++;
            });await settle();
            assert.equal(await renlyName.evaluate(element=>element.classList.contains('ctNpcSeverity-warning')),true,name+': completed text falls back to its remaining Warning');
            await page.evaluate(()=>{window.__ctLayoutFixture.ctDiagnostics=Vue.markRaw({});});await settle();
            assert.equal(await renlyName.evaluate(element=>element.classList.contains('ctNpcSeverity-error') || element.classList.contains('ctNpcSeverity-warning')),false,name+': removing the final finding restores normal text');
            assert.equal(await unaName.evaluate(element=>element.classList.contains('ctNpcSeverity-warning')),false,name+': other resolved names also return to normal');
            results.push({name:name+' accessible tabs, production labels, long names, fixed filter, independent scroll/page and exact editor caret handoff'});
        }
        assert.deepEqual(errors,[],'No browser page errors');
        console.log(JSON.stringify({passed:results.length,screenshots,results},null,2));
    } catch(error) {
        if(page && !page.isClosed()) {
            const path=join(fixtureArtifacts,'sdeditor-clienttext-failure-'+randomUUID()+'.png');
            await page.screenshot({path});console.error('Failure screenshot: '+path);
        }
        throw error;
    } finally {
        await browser?.close();
        await new Promise(resolve=>server.close(resolve));
    }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
