// Disposable loopback UI fixture using current ClientText templates/components and CSS.
// It avoids API, IndexedDB, workbook imports and application lifecycle hooks.
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const { createServer } = require('node:http');
const { tmpdir } = require('node:os');
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
const table = between(html, '<table class="display compact cell-border fileTable ctTable"', '</table>') + '</table>';
const fullEditor = between(html, '<div v-else class="editor ctFull ctFullEditor', '      <dialog ref="ctDiagnosticDialog"')
    // The application Teleports its 200px preview into this host. Reserve that
    // same real CSS shell so the sticky actions do not obscure this fixture.
    .replace('<div id="ctFullEditorPreviewHost"></div>', '<div id="ctFullEditorPreviewHost"><div class="gamePreviewStrip"><strong class="gamePreviewLabel">Preview</strong><p>English source for the current record.</p></div></div>');
const tooltipComponent = between(indexJs, 'const AppTooltip = {', 'function escapeTooltipAttr');
const tooltipMethods = between(indexJs, '    normalizeTooltipText(value) {', '    htmlTooltipMouseMove(e) {');
const tooltipDirective = between(indexJs, "app.directive('tooltip', {", "app.mount('#app');");
const longSheet = 'A very long ClientText sheet name that must remain readable through the tooltip without widening the sheet navigation';
const sheetData = [
    ['normal', longSheet], ['normal', 'QuestDialogues'], ['normal', 'ItemNames'],
    ['gender', longSheet], ['gender', 'ItemNames'],
].map(([role, name]) => ({ role, name, key: JSON.stringify([role, name]) }));

const fixtureJs = `${tooltipComponent}
const ct = window.ClientTextUI.mixin;
const sheets = ${JSON.stringify(sheetData)};
const fields = ['MS','MP','FS','FP','NS','NP'].map((form,index)=>({
    id:'form-'+form,kind:'form',group:'Text',name:'Text',form,source:'English source for the current record.',
    target:index===0 ? 'A long singular translation deliberately wraps into several lines when its column is narrower.' : form+' translation',
    targetCell:String.fromCharCode(66+index)+'2',required:true,originalMissing:false,outdated:false
}));
const unit = Vue.markRaw({id:'layout-record',role:'normal',sheet:sheets[0].name,recordId:'FixtureIdentifier',fields,notes:[]});
const app = Vue.createApp({
    data() { return {...ct.data(),ctActive:true,ctUnits:Vue.markRaw([unit]),ctSelection:unit.id,
        ctWorkspace:{scope:{game:'poe2',branchId:'default',language:'Thai',versionId:'fixture',groupId:'fixture'},metadata:{version:{name:'ClientText layout fixture'}}},
        ctSheet:sheets[0].key,ctSearch:'Main search retained',ctAppliedSearch:'',ctSelectedFilters:['unchanged','missing','saved'],
        ctValues:Object.fromEntries(fields.map(field=>[field.id,field.target])),
        inlineEditor:true,inlineSidebarVisible:false,lang:'Thai',translationEditorBcp47:'th',
        gameVersion:'poe2',branchId:'default',dictionary:[],pageSize:20,
        tooltip:{visible:false,text:'',x:0,y:0,maxWidth:360}
    };},
    computed:Object.fromEntries(['ctCurrentUnit','ctFieldGroups','ctSheets','ctFilteredSheets','ctRows','ctPageRows','ctEffectivePageSize']
        .map(key=>[key,ct.computed[key]])),
    methods:{...ct.methods,${tooltipMethods}
        ctQueueDraft(){},ctSuggest(){},ctCompletionSelectionChanged(){},
    },
    created(){this._ctUnitIndex=Vue.markRaw(new Map([[unit.id,unit]]));this._ctSheets=Vue.markRaw(sheets);}
});
app.component('ct-fields',window.ClientTextUI.fieldsComponent);
app.component('ct-target',window.ClientTextUI.targetComponent);
app.component('ct-tools',{props:['host'],template:'<aside class="side sharedEditorSidebar ctTools"><h3>File tools</h3><p>Disposable layout fixture</p></aside>'});
app.component('app-tooltip',AppTooltip);
${tooltipDirective}
window.__ctLayoutFixture=app.mount('#app');`;

async function run() {
    const frontend = express(), server = createServer(frontend);
    frontend.get('/', (req, res) => res.type('html').send(`<!doctype html><html data-theme="dark"><head>
        <meta charset="utf-8">${stylesheets}</head><body><div id="app"><div class="appRoot" data-density="compact">
        <section class="ctWorkspace" aria-label="ClientText workspace">
        <div v-if="!ctEditor" class="workspace ctListWorkspace inlineEditorMode"><main class="workspaceContent">
        <div class="ctWorkspaceBody">${navigation}<div class="workspaceMain ctList"><div class="fileTableScroll">${table}</div></div></div>
        </main></div>${fullEditor}</section><app-tooltip :state="tooltip"></app-tooltip></div></div>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/vue/3.0.11/vue.global.prod.js"></script>
        <script src="/clientTextState.js"></script><script src="/clientTextUi.js"></script><script src="/fixture.js"></script></body></html>`));
    frontend.get('/fixture.js', (req, res) => res.type('js').send(fixtureJs));
    frontend.use(express.static(publicDir));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const results = [], screenshots = [], errors = [];
    let browser;
    try {
        browser = await playwright.chromium.launch({ executablePath, headless: true, args: ['--disable-gpu'] });
        const context = await browser.newContext({viewport:{width:1440,height:900},locale:'en-US',timezoneId:'Asia/Bangkok',ignoreHTTPSErrors:true});
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => {if(message.type()==='error')errors.push(message.text());});
        await page.goto('http://127.0.0.1:' + server.address().port);
        await page.waitForFunction(() => !!window.__ctLayoutFixture);
        const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const nav = page.getByRole('navigation', {name:'Workbook sheets'});
        const filter = page.getByRole('searchbox', {name:'Filter sheets'});
        const tooltip = page.getByRole('tooltip');
        const assertPreserved = async () => assert.deepEqual(await page.evaluate(() => {
            const host=window.__ctLayoutFixture;
            return {sheet:host.ctSheet,selection:host.ctSelection,search:host.ctSearch,applied:host.ctAppliedSearch};
        }), {sheet:sheetData[0].key,selection:'layout-record',search:'Main search retained',applied:''}, 'Sheet filtering preserves the selected sheet, record and main search');
        await filter.fill('  ITEMnames  ');
        assert.deepEqual(await nav.locator('h3').allTextContents(), ['Normal','Gender']);
        assert.equal(await nav.getByRole('button', {name:'ItemNames',exact:true}).count(), 2);
        assert.equal(await nav.getByRole('button').count(), 3);
        await assertPreserved();
        await filter.fill('no such sheet');
        assert.equal(await nav.getByRole('status').textContent(), 'No sheets match.');
        assert.equal(await nav.getByRole('button', {name:'All sheets',exact:true}).count(), 1);
        assert.equal(await nav.locator('h3').count(), 0);
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
                return {table:rect(element),full:!!element.closest('.ctFullEditor'),headers:[...element.tHead.rows[0].cells].map(cell=>({
                    ...rect(cell),text:cell.textContent.trim(),align:getComputedStyle(cell).textAlign,unobscured:unobscured(cell)})),
                    rows:[...element.tBodies[0].rows].map(row=>[...row.cells].map(cell=>({
                        ...rect(cell),text:cell.tagName==='TH'?cell.textContent.trim():undefined,
                        verticalAlign:getComputedStyle(cell).verticalAlign,unobscured:unobscured(cell),
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
                for(const header of geometry.headers) assert.ok(header.unobscured,name+': full form header is visible');
                for(const row of geometry.rows) assert.ok(row[0].unobscured,name+': full M/F/N label is visible');
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
        for(const theme of ['light','grey','dark','modern-dark']) for(const width of [1440,1100]) {
            await page.setViewportSize({width,height:900});
            await page.evaluate(theme=>{document.documentElement.setAttribute('data-theme',theme);window.__ctLayoutFixture.ctEditor=false;},theme);
            await settle();
            const longButton=nav.getByRole('button',{name:longSheet,exact:true}).first();
            const ellipsis=await longButton.evaluate(element=>({whiteSpace:getComputedStyle(element).whiteSpace,overflow:getComputedStyle(element).overflow,textOverflow:getComputedStyle(element).textOverflow,client:element.clientWidth,scroll:element.scrollWidth}));
            assert.equal(ellipsis.whiteSpace,'nowrap');assert.equal(ellipsis.overflow,'hidden');assert.equal(ellipsis.textOverflow,'ellipsis');
            assert.ok(ellipsis.scroll>ellipsis.client,theme+'/'+width+': long sheet is truncated without widening navigation');
            await checkTooltip(longButton,longSheet+'\nNormal workbook',theme+'/'+width);
            await checkGrid(theme+'/'+width+' inline');
            if(theme==='modern-dark' && width===1100) {
                await longButton.hover();await tooltip.waitFor();await settle();
                const path=join(tmpdir(),'sdeditor-clienttext-inline-'+randomUUID()+'.png');
                await page.screenshot({path});screenshots.push(path);
                await page.mouse.move(1,1);await tooltip.waitFor({state:'detached'});
            }
            await page.evaluate(()=>{window.__ctLayoutFixture.ctEditor=true;});await settle();
            assert.deepEqual(errors,[],theme+'/'+width+': no browser errors switching to full editor');
            assert.equal(await page.locator('.ctFullEditor').count(),1,theme+'/'+width+': full editor template mounted');
            await checkGrid(theme+'/'+width+' full');
            const gutter=await page.locator('.ctFullEditor > .edit').evaluate(element=>({left:element.getBoundingClientRect().left,padding:getComputedStyle(element).paddingLeft,margin:getComputedStyle(element).marginLeft}));
            assert.equal(gutter.left,0,theme+'/'+width+': full editor begins at left edge');
            assert.equal(gutter.padding,'0px',theme+'/'+width+': full editor has no left padding');
            assert.equal(gutter.margin,'0px',theme+'/'+width+': full editor has no left margin');
            if(theme==='modern-dark' && width===1440) {
                const path=join(tmpdir(),'sdeditor-clienttext-full-'+randomUUID()+'.png');
                await page.screenshot({path});screenshots.push(path);
            }
        }
        assert.deepEqual(errors,[],'No browser page errors');
        console.log(JSON.stringify({passed:results.length,screenshots,results},null,2));
    } finally {
        await browser?.close();
        await new Promise(resolve=>server.close(resolve));
    }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
