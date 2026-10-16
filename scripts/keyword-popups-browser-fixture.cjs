'use strict';
// Actual app, shared inline/full preview, parser and app-owned overlay in a
// disposable Edge/Chrome profile. No production accounts or storage are used.
const assert = require('node:assert/strict');
const { readFileSync, writeFileSync, existsSync, mkdirSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { createServer } = require('node:http');
const express = require('express');
const modules = 'C:/Users/lpeac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || require.resolve('playwright', { paths: [modules] }));
const executablePath = process.env.FIXTURE_BROWSER_PATH || ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const root = resolve(__dirname, '..'), folder = join(root, 'temp/keyword-popups-browser');
const app = express();
app.get('/index.js', (_req, res) => res.type('js').send(readFileSync(join(root, 'public/index.js'), 'utf8').replace("app.mount('#app');", "window.fixtureApp = app.mount('#app');")));
app.use(express.static(join(root, 'public')));
const server = createServer(app);
const settle = page => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
async function enterAdjacentCard(page, trigger, card) {
  const a = await trigger.boundingBox(), b = await card.boundingBox();
  let from, to;
  if (Math.abs(b.y - a.y - a.height) < 1) {
    const x = Math.max(b.x + 2, Math.min(a.x + a.width / 2, b.x + b.width - 2));
    from = [x, a.y + a.height - 1]; to = [x, b.y + 2];
  } else if (Math.abs(b.y + b.height - a.y) < 1) {
    const x = Math.max(b.x + 2, Math.min(a.x + a.width / 2, b.x + b.width - 2));
    from = [x, a.y + 1]; to = [x, b.y + b.height - 2];
  } else if (Math.abs(b.x - a.x - a.width) < 1) {
    const y = Math.max(b.y + 2, Math.min(a.y + a.height / 2, b.y + b.height - 2));
    from = [a.x + a.width - 1, y]; to = [b.x + 2, y];
  } else {
    assert.ok(Math.abs(b.x + b.width - a.x) < 1, 'card touches a keyword edge: ' + JSON.stringify({ a, b }));
    const y = Math.max(b.y + 2, Math.min(a.y + a.height / 2, b.y + b.height - 2));
    from = [a.x + 1, y]; to = [b.x + b.width - 2, y];
  }
  await page.mouse.move(...from); await page.mouse.move(...to, { steps: 5 });
  assert.equal(await card.count(), 1, 'crossing the touching edge retains the card without a timeout');
}
async function dragCard(page, card, x, y) {
  const box = await card.boundingBox(), header = await card.locator('.keywordPreviewHeader').boundingBox();
  const start = { x: header.x + header.width / 2, y: header.y + header.height / 2 };
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(start.x + x - box.x, start.y + y - box.y, { steps: 8 });
  await page.mouse.up(); await settle(page);
}
async function checkFocusGestures(page, target, windows) {
  await target.click(); await settle(page);
  const parentId=await windows.first().getAttribute('id'), parent=page.locator('#'+parentId);
  const keyword=parent.locator('.keywordPreviewContent .gamePreviewKw').first();
  await page.locator('.gamePreviewTargetPane .gamePreviewKw').nth(1).click();await settle(page);
  const otherId=await windows.last().getAttribute('id'), other=page.locator('#'+otherId);
  await dragCard(page,other,8,600);await keyword.hover();await settle(page);
  const childId=await windows.last().getAttribute('id'), child=page.locator('#'+childId);
  await page.evaluate(()=>{
    const host=fixtureApp;window.keywordGestureTrace=[];
    window.keywordTraceRaise=host.raiseKeywordWindow;window.keywordTracePin=host.pinKeywordWindow;
    host.raiseKeywordWindow=item=>{keywordGestureTrace.push({kind:'raise',id:item.id});return keywordTraceRaise(item);};
    host.pinKeywordWindow=item=>{keywordGestureTrace.push({kind:'pin',id:item.id});return keywordTracePin(item);};
    window.keywordTraceFocus=event=>keywordGestureTrace.push({kind:'focus',id:Number(event.target.closest?.('[data-keyword-window]')?.dataset.keywordWindow)||null});
    document.addEventListener('focusin',keywordTraceFocus,true);
  });
  const state=()=>page.evaluate(()=>({active:fixtureApp.keywordActiveId,order:fixtureApp.keywordWindows.map(item=>item.id),trace:keywordGestureTrace.slice()}));
  const parentNumber=Number(parentId.replace('keyword-window-','')), childNumber=Number(childId.replace('keyword-window-',''));
  const otherNumber=Number(otherId.replace('keyword-window-',''));
  await keyword.hover();await page.evaluate(()=>{keywordGestureTrace.length=0;});
  await page.mouse.down();await settle(page);
  let current=await state();assert.equal(current.active,otherNumber);assert.equal(current.order.at(-1),childNumber);
  assert.ok(!current.trace.some(event=>event.id===parentNumber),'pressing nested keyword must not focus/raise parent');
  await page.mouse.up();await settle(page);current=await state();
  assert.equal(current.active,childNumber);assert.equal(current.order.at(-1),childNumber);
  assert.ok(!current.trace.some(event=>event.id===parentNumber),'completed nested click never activates parent at any event stage');
  assert.deepEqual(current.trace.filter(event=>event.kind==='pin').map(event=>event.id),[childNumber]);
  const completed=current;
  await other.locator('.keywordPreviewClose').click();await dragCard(page,child,800,400);

  // A canceled keyword click activates its containing card only on release.
  await keyword.hover();await page.evaluate(()=>{keywordGestureTrace.length=0;});await page.mouse.down();
  current=await state();assert.equal(current.active,childNumber);assert.ok(!current.trace.length);
  const p=await parent.boundingBox();await page.mouse.move(p.x+5,p.y+5,{steps:5});
  current=await state();assert.equal(current.active,childNumber);assert.ok(!current.trace.some(event=>event.kind==='raise'));
  await page.mouse.up();await settle(page);current=await state();
  assert.equal(current.active,parentNumber);assert.equal(current.order.at(-1),parentNumber);
  assert.ok(!current.trace.some(event=>event.kind==='pin'),'release outside keyword never pins the child');
  writeFileSync(join(folder,'nested-click-events.json'),JSON.stringify({parent:parentNumber,child:childNumber,completed,canceled:current},null,2));

  // Both top/left padding and the blank right edge belong to the drag handle.
  let b=await child.boundingBox(), h=await child.locator('.keywordPreviewHeader').boundingBox();
  assert.ok(h.x<=b.x+1.1&&h.y<=b.y+1.1&&h.x+h.width>=b.x+b.width-1.1,'header reaches card borders');
  await page.mouse.move(b.x+5,b.y+5);await page.mouse.down();await page.mouse.move(b.x+7,b.y+5);
  assert.equal((await state()).active,parentNumber,'sub-threshold movement does not activate drag');
  await page.mouse.move(b.x+85,b.y+55,{steps:6});await page.mouse.up();await settle(page);
  let moved=await child.boundingBox();assert.ok(Math.abs(moved.x-b.x-80)<1&&Math.abs(moved.y-b.y-50)<1);
  assert.equal((await state()).active,childNumber);
  await page.mouse.move(moved.x+moved.width-5,moved.y+30);await page.mouse.down();
  await page.mouse.move(moved.x+moved.width-45,moved.y+10,{steps:5});await page.mouse.up();await settle(page);
  b=await child.boundingBox();assert.ok(Math.abs(b.x-moved.x+40)<1&&Math.abs(b.y-moved.y+20)<1,'right blank header padding drags');
  const alpha=card=>card.evaluate(node=>({bg:getComputedStyle(node).backgroundColor,opacity:getComputedStyle(node).opacity}));
  assert.equal((await alpha(child)).bg,'rgb(18, 17, 16)');assert.match((await alpha(parent)).bg,/0\.7\)/);
  assert.equal((await alpha(child)).opacity,'1');assert.equal(await page.evaluate(()=>String(getSelection())), '');
  await parent.locator('.keywordPreviewContent').click({position:{x:5,y:5}});await settle(page);
  assert.equal((await state()).active,parentNumber);assert.equal((await alpha(parent)).bg,'rgb(18, 17, 16)');assert.match((await alpha(child)).bg,/0\.7\)/);
  await page.screenshot({path:join(folder,'focus-active.png')});

  const positions=[await parent.boundingBox(),await child.boundingBox()];
  await page.mouse.click(5,5);await settle(page);assert.equal((await state()).active,null);
  assert.match((await alpha(parent)).bg,/0\.7\)/);assert.match((await alpha(child)).bg,/0\.7\)/);
  assert.deepEqual([await parent.boundingBox(),await child.boundingBox()],positions,'outside click retains pinned positions');
  await page.screenshot({path:join(folder,'focus-cleared.png')});
  await page.keyboard.press('Escape');await settle(page);assert.equal(await windows.count(),2,'Escape after outside click never closes an arbitrary pin');
  await page.evaluate(async()=>{fixtureApp.ctEditor=true;await fixtureApp.$nextTick();});
  await child.locator('.keywordPreviewContent').click({position:{x:5,y:5}});await page.keyboard.press('Escape');await settle(page);
  assert.equal(await child.count(),0);assert.equal(await parent.count(),1,'Escape closes only active card');
  await parent.locator('.keywordPreviewClose').click();assert.equal(await windows.count(),0,'X remains excluded from dragging');
  await page.evaluate(()=>{fixtureApp.raiseKeywordWindow=keywordTraceRaise;fixtureApp.pinKeywordWindow=keywordTracePin;document.removeEventListener('focusin',keywordTraceFocus,true);});
}
async function checkPointerBehavior(page, target, source, windows) {
  await target.hover(); await page.waitForSelector('.keywordPreviewWindow[data-keyword-window]');
  const transient = windows.first(), box = await transient.boundingBox();
  await page.evaluate(() => document.querySelector('.keywordPreviewWindow[data-keyword-window]').click());
  assert.equal(await page.evaluate(() => fixtureApp.keywordWindows[0].pinned), false, 'card click raises/focuses but never pins');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  assert.equal(await windows.count(), 0, 'entering an unpinned card dismisses it immediately');
  await target.click(); await settle(page); const parent = windows.first();
  assert.equal(await parent.locator('.keywordPreviewClose').count(), 1, 'keyword click pins');
  const beforeHeaderClick=await parent.boundingBox();await parent.locator('.keywordPreviewTitle').click();
  assert.deepEqual(await parent.boundingBox(),beforeHeaderClick,'plain header click never starts movement');
  const keyword = parent.locator('.keywordPreviewContent .gamePreviewKw').first();
  await keyword.hover(); const child = windows.last(), c = await child.boundingBox();
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
  assert.equal(await windows.count(), 1, 'nested hover ends at its trigger, too');
  await keyword.click(); const pinnedChild = windows.last(), childId = await pinnedChild.getAttribute('id');
  await enterAdjacentCard(page, keyword, pinnedChild);
  await dragCard(page, pinnedChild, 350, 350); await page.mouse.move(5, 5);
  assert.equal(await windows.count(), 2); assert.equal(await pinnedChild.locator('.keywordPreviewClose').count(), 1);
  assert.equal(await page.evaluate(() => String(getSelection())), '');
  await dragCard(page, pinnedChild, -1000, -1000);
  let b = await pinnedChild.boundingBox(); assert.equal(b.x, 8); assert.equal(b.y, 8);
  await dragCard(page, pinnedChild, 3000, 3000);
  b = await pinnedChild.boundingBox(); assert.ok(b.x + b.width <= 1432 && b.y + b.height <= 892);
  await page.keyboard.press('Escape'); assert.equal(await windows.count(), 1);
  assert.equal(await page.evaluate(() => fixtureApp.ctEditor), true);
  await keyword.click(); const covering = windows.last(), coveringId = await covering.getAttribute('id');
  for (const trigger of [keyword, source]) {
    const a = await trigger.boundingBox(), point = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
    await dragCard(page, covering, point.x - 80, point.y - 40); await page.mouse.move(point.x, point.y);
    assert.equal(await page.evaluate(p => document.elementFromPoint(p.x,p.y)?.closest('[data-keyword-window]')?.id,point), coveringId);
    assert.equal(await windows.count(), 2);
  }
  // Card click may raise and focus, while pin states stay unchanged.
  await dragCard(page, covering, 800, 400);
  const parentId = await parent.getAttribute('id');
  await page.locator('#'+parentId+' .keywordPreviewContent').click({position:{x:5,y:5}});
  assert.equal(await windows.last().getAttribute('id'), parentId);
  assert.ok(await page.evaluate(() => fixtureApp.keywordWindows.every(item=>item.pinned)));
  await windows.last().locator('.keywordPreviewClose').click();
  assert.equal(await windows.count(), 1, 'pinned child survives parent closure');
  await windows.first().locator('.keywordPreviewClose').click();
  for (const [x,y,width,height] of [[8,250,1440,900],[1052,250,1440,900],[200,80,700,650],[200,500,700,650]]) {
    await target.click(); const parent = windows.first();
    await page.setViewportSize({width,height}); await settle(page); await dragCard(page,parent,x,y);
    const trigger=parent.locator('.keywordPreviewContent .gamePreviewKw').first();
    await trigger.click(); const child=windows.last(); await enterAdjacentCard(page,trigger,child);
    await page.screenshot({path:join(folder,'edge-'+x+'-'+y+'.png')});
    await child.locator('.keywordPreviewClose').click(); await parent.locator('.keywordPreviewClose').click();
    await page.setViewportSize({width:1440,height:900});
  }
}
async function checkAutocompleteWheel(page, ct, label) {
  const details=page.locator('.hlPopupDetails'), card=page.locator('.keywordAutocompleteCard');
  const snapshot=()=>page.evaluate(ct=>{
    const host=fixtureApp,input=document.querySelector('[data-autocomplete-fixture-input]');
    return {value:input.value,selection:[input.selectionStart,input.selectionEnd],focused:document.activeElement===input,
      index:ct?host.ctCompletion?.selectedIndex:host.hlPopup.selectedIndex,visible:ct?!!host.ctCompletion:host.hlPopup.visible,
      active:host.keywordActiveId,details:document.querySelector('.hlPopupDetails').scrollTop,
      editor:[...document.querySelectorAll('.editor .edit,.fileTableScroll,.ctTableScroll,.workspaceContent')].map(node=>[node.scrollLeft,node.scrollTop]),
      page:[scrollX,scrollY],inputScroll:[input.scrollLeft,input.scrollTop]};
  },ct);
  const stable=(actual,before)=>{const {details:ignored,...rest}=actual;const {details:previous,...expected}=before;assert.deepEqual(rest,expected,'wheel preserves editor, page, menu selection and caret: '+label);};
  await page.evaluate(async()=>{
    const host=fixtureApp;window.keywordWheelContent=host.keywordAutocomplete.content;
    host.keywordAutocomplete.content=host.buildGamePreviewSegments('Long keyword information\n'+Array.from({length:100},(_,index)=>'Wheel paragraph '+index+' remains readable.').join('\n'),{contentMode:'clienttext'}).segments;
    await host.$nextTick();
  });
  const d=await details.boundingBox(), c=await card.boundingBox(), point={x:c.x+10,y:Math.min(c.y+60,d.y+d.height-12)};
  await page.mouse.move(point.x,point.y);
  assert.equal(await page.evaluate(p=>!!document.elementFromPoint(p.x,p.y)?.closest('.keywordAutocompleteCard'),point),true,'wheel targets the card, not its scrollbar');
  const before=await snapshot();assert.equal(before.focused,true);
  await page.mouse.wheel(0,180);await page.waitForTimeout(150);
  let after=await snapshot();assert.ok(after.details>before.details,'actual mouse wheel scrolls keyword details: '+label);stable(after,before);
  const mouseScroll=after.details;
  await page.mouse.wheel(2.5,37.5);await page.waitForTimeout(150);
  after=await snapshot();assert.ok(after.details>mouseScroll,'fractional diagonal trackpad-style delta scrolls details');stable(after,before);
  await page.mouse.wheel(0,100000);await page.waitForTimeout(150);
  let bounds=await details.evaluate(node=>({top:node.scrollTop,max:node.scrollHeight-node.clientHeight}));
  assert.ok(Math.abs(bounds.top-bounds.max)<=1,'wheel reaches detail bottom');
  await page.mouse.wheel(0,500);await page.waitForTimeout(150);stable(await snapshot(),before);
  assert.ok(Math.abs((await snapshot()).details-bounds.max)<=1,'bottom boundary does not chain');
  for(let attempt=0;attempt<4;attempt++){
    await page.mouse.wheel(0,-100000);await page.waitForTimeout(150);
    if((await snapshot()).details<=1)break;
  }
  assert.ok((await snapshot()).details<=1);
  await page.mouse.wheel(0,-500);await page.waitForTimeout(150);stable(await snapshot(),before);assert.equal((await snapshot()).details,0);

  // The adjacent TL Note owns its own overflow. Wheel at its boundary must not
  // start moving the surrounding keyword/detail area or the editor underneath.
  const note=page.locator('.hlPopupTlnoteText'), oldNote=await note.innerText();
  await note.evaluate(node=>node.textContent=Array.from({length:80},(_,index)=>'Long translator note '+index).join('\n'));
  const n=await note.boundingBox();await page.mouse.move(n.x+n.width/2,n.y+n.height/2);
  await page.mouse.wheel(0,140);await page.waitForTimeout(150);
  assert.ok(await note.evaluate(node=>node.scrollTop>0),'TL Note scrolls with wheel');stable(await snapshot(),before);assert.equal((await snapshot()).details,0);
  await page.mouse.wheel(0,100000);await page.waitForFunction(()=>{const n=document.querySelector('.hlPopupTlnoteText');return n.scrollTop>=n.scrollHeight-n.clientHeight-1;});await page.mouse.wheel(0,500);await page.waitForTimeout(150);
  assert.equal((await snapshot()).details,0,'TL Note bottom contains scrolling');stable(await snapshot(),before);
  await page.mouse.wheel(0,-100000);await page.waitForFunction(()=>document.querySelector('.hlPopupTlnoteText').scrollTop<=1);await page.mouse.wheel(0,-500);await page.waitForTimeout(150);
  assert.equal(await note.evaluate(node=>node.scrollTop),0);assert.equal((await snapshot()).details,0);stable(await snapshot(),before);
  await note.evaluate((node,text)=>node.textContent=text,oldNote);

  await page.evaluate(async()=>{fixtureApp.keywordAutocomplete.content=keywordWheelContent;await fixtureApp.$nextTick();});
  console.log(JSON.stringify({wheel:label,mouseScroll,details:'top/bottom contained',note:'wheel and boundaries passed',editor:'selection, caret and page unchanged'}));
}
async function checkAutocomplete(page, ct, label) {
  const card = page.locator('.keywordAutocompleteCard'), windows = page.locator('.keywordPreviewWindow[data-keyword-window]');
  const prepare = async () => {
    await page.evaluate(async ct => {
      const host=fixtureApp;
      document.querySelectorAll('[data-autocomplete-fixture-input]').forEach(node=>node.removeAttribute('data-autocomplete-fixture-input'));
      const input=ct ? [...document.querySelectorAll('[data-ct-target="Text"]')].find(node=>node.getClientRects().length)
        : host.getEditorRef('translation',0);
      if(!input)throw new Error('No visible translation field for autocomplete fixture');
      input.setAttribute('data-autocomplete-fixture-input','');input.focus();input.setSelectionRange(0,input.value.length);
      const items=[{value:'[Physical]',label:'Physical',kwTagName:'Physical',tlnote:'Translator note for Physical'},
        {value:'[Armour]',label:'Armour',kwTagName:'Armour'},{value:'{0}',label:'Variable'},
        {value:'[Blank]',label:'Blank',kwTagName:'Blank'}];
      if(ct){
        const field=host.ctCurrentUnit.fields.find(field=>field.id==='Text');
        if(!host.ctSuggest(field,{target:input},{manual:true}))throw new Error('Could not open actual ClientText completion');
        host.ctCompletion.items=items;host.ctCompletion.allItems=items;host.ctCompletion.selectedIndex=0;
      }else{
        if(!host._fixtureAssistance)host._fixtureAssistance=host.getDictionaryAssistanceEntry;
        host.getDictionaryAssistanceEntry=(id,...args)=>id==='fixture-note'?{_id:id,tlnote:items[0].tlnote}:host._fixtureAssistance(id,...args);
        items[0].dictEntryId='fixture-note';
        host.openHlPopup(0,{focusFilter:false});host.hlPopup.items=items;host.hlPopup.filtered=items;host.hlPopup.selectedIndex=0;
      }
      await host.$nextTick();
    },ct);
    await page.waitForSelector('.keywordAutocompleteCard');
    return page.locator('[data-autocomplete-fixture-input]');
  };
  let input=await prepare(); const original=await input.inputValue();
  assert.equal(await card.locator('.keywordPreviewTitle').innerText(),'Thai Physical',label);
  const note=page.locator('.hlPopupTlnote'), n=await note.boundingBox(), b=await card.boundingBox();
  assert.ok(b.y>=n.y+n.height,'keyword information appears beneath TL note');
  await page.screenshot({path:join(folder,'autocomplete-'+label+'-with-note.png')});
  assert.equal(await input.evaluate(node=>document.activeElement===node),true,'showing details never steals caret focus');
  await checkAutocompleteWheel(page,ct,label);
  await input.press('ArrowDown'); await settle(page);
  assert.equal(await card.locator('.keywordPreviewTitle').innerText(),'Thai Armour Title');assert.equal(await note.count(),0);
  await input.press('ArrowDown');await settle(page);assert.equal(await card.count(),0,'ordinary variable suggestion clears keyword details');
  await page.locator('.hlPopupItem').first().hover();await settle(page);
  assert.equal(await card.locator('.keywordPreviewTitle').innerText(),'Thai Physical');assert.equal(await input.inputValue(),original);
  await card.locator('.keywordPreviewContent').click({position:{x:5,y:5}});
  assert.equal(await windows.count(),0,'detail text click never pins');
  assert.equal(await input.evaluate(node=>document.activeElement===node),true,'detail text does not blur the translation field');
  assert.deepEqual(await input.evaluate(node=>[node.selectionStart,node.selectionEnd]),[0,original.length],'caret selection stays intact');
  await card.locator('.keywordPreviewTitle .gamePreviewKw').click();await settle(page);
  assert.equal(await windows.count(),1);assert.equal(await windows.locator('.keywordPreviewClose').count(),1);
  await dragCard(page,windows.first(),8,8);
  await windows.first().locator('.keywordPreviewContent .gamePreviewKw').first().click();await settle(page);
  assert.equal(await windows.last().locator('.keywordPreviewTitle').innerText(),'Thai Armour Title','nested details inherit translation context');
  await windows.last().locator('.keywordPreviewClose').click();
  await page.locator('.hlPopupItem').nth(1).hover();await settle(page);
  assert.equal(await card.locator('.keywordPreviewTitle').innerText(),'Thai Armour Title');assert.equal(await windows.count(),1);
  await input.focus();await input.press('Escape');await settle(page);
  assert.equal(await card.count(),0);assert.equal(await page.locator('.hlPopup').count(),0);assert.equal(await windows.count(),1,'autocomplete close preserves independent pin');
  assert.equal(await page.evaluate(ct=>ct?fixtureApp.ctActive:fixtureApp.editorSessionActive,ct),true,'Escape does not leave editor');
  await windows.locator('.keywordPreviewClose').click();
  input=await prepare();await input.press('Enter');await settle(page);
  assert.equal(await input.inputValue(),'[Physical]','Enter still accepts highlighted suggestion');assert.equal(await card.count(),0);
  if(ct){input=await prepare();await input.press('Tab');await settle(page);assert.equal(await input.inputValue(),'[Physical]','ClientText Tab still accepts');}
  input=await prepare();const beforeTyping=await input.inputValue();await input.press('x');await settle(page);
  if(ct){assert.equal(await input.inputValue(),'x','ClientText keeps native field input');assert.equal(await input.evaluate(node=>node.selectionStart),1);}
  else {assert.equal(await input.inputValue(),beforeTyping,'SD keeps its existing autocomplete text-filter behavior');assert.equal(await page.evaluate(()=>fixtureApp.hlPopup.filter),'x');}
  if(await page.locator('.hlPopup').count())await input.press('Escape');
  input=await prepare();await page.locator('.hlPopupItem').nth(3).hover();await settle(page);
  assert.match(await card.innerText(),/Missing Thai translation/);assert.doesNotMatch(await card.innerText(),/English must not leak/);
  for(const theme of ['light','grey','dark','modern-dark']){
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await settle(page);
    const geometry=await page.locator('.hlPopupDetails').evaluate(node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom};});
    assert.ok(geometry.x>=7&&geometry.y>=7&&geometry.right<=1440&&geometry.bottom<=900,JSON.stringify(geometry));
    const bg=await card.evaluate(node=>({background:getComputedStyle(node).backgroundColor,opacity:getComputedStyle(node).opacity}));
    assert.match(bg.background,/0\.7\)/);assert.equal(bg.opacity,'1');
    if(theme==='modern-dark')await page.screenshot({path:join(folder,'autocomplete-'+label+'.png')});
  }
  await page.setViewportSize({width:700,height:450});await settle(page);
  const small=await page.locator('.hlPopupDetails').evaluate(node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom};});
  assert.ok(small.x>=7&&small.y>=7&&small.right<=701&&small.bottom<=451,'detail area fits resized desktop viewport');
  await page.setViewportSize({width:1440,height:900});await settle(page);
  if(ct){
    await page.locator('.hlPopupItem').first().hover();
    await page.evaluate(async()=>{const host=fixtureApp;host._fixtureUnits=host.ctUnits;host.ctUnits=Vue.markRaw(host.ctUnits.filter(unit=>unit.sheet!=='KeywordPopups'));host.ctRevision++;await host.$nextTick();});
    await settle(page);assert.equal(await card.count(),0,'partial workbook with no popup sheet hides keyword details');assert.equal(await note.count(),1);
    await page.evaluate(async()=>{fixtureApp.ctUnits=fixtureApp._fixtureUnits;fixtureApp.ctRevision++;await fixtureApp.$nextTick();});await settle(page);
    assert.equal(await card.locator('.keywordPreviewTitle').innerText(),'Thai Physical');
  }
  await input.focus();await input.press('Escape');
  await page.evaluate(async ({ct,original})=>{
    const host=fixtureApp;if(ct){host.ctValues.Text=original;host.ctDraftDirty=false;host.ctCloseCompletion();}
    else {host.editorBlocks[0].translation=original;host.closeHlPopup();if(host._fixtureAssistance)host.getDictionaryAssistanceEntry=host._fixtureAssistance;}
    await host.$nextTick();
  },{ct,original});
}

(async () => {
  let browser;
  try {
    mkdirSync(folder, { recursive: true });
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    browser = await chromium.launch({ executablePath, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message)); page.on('console',message=>{if(message.type()==='error' && !message.text().includes('Failed to load resource')){errors.push(message.text());console.log('browser error',message.text());}});
    await page.route('https://**/*', route => {
      const url = route.request().url();
      if (url.includes('vue.global')) return route.fulfill({ contentType: 'text/javascript', body: readFileSync(process.env.FIXTURE_VUE_PATH || join(root, 'temp/clienttext-fixture-vue.min.js')) });
      if (url.includes('jszip.min')) return route.fulfill({ contentType: 'text/javascript', body: readFileSync(join(root, '../SDEditor-API/node_modules/jszip/dist/jszip.min.js')) });
      return route.fulfill({ contentType: 'text/javascript', body: '' });
    });
    await page.goto('http://127.0.0.1:' + server.address().port + '/?testMode=1&lang=Thai');
    await page.waitForFunction(() => window.fixtureApp?.startupReady);
    await page.evaluate(async () => {
      const host = window.fixtureApp;
      const field = (name, source, target) => ({ id: name, name, source, target, kind: 'text', required: true });
      const popup = (id, en, th, content, target) => ({ id, role: 'normal', sheet: 'KeywordPopups', recordId: id, metadata: {}, fields: [field('Info Title', en, th), field('Info Content', content, target)] });
      const units = [popup('Physical', 'Physical Damage', 'Thai Physical', 'English body [Armour] <b>{Bold} <img src=x onerror=alert(1)>', 'Thai body [Armour|Thai Armour]'),
        popup('Armour', 'English Armour', 'Thai Armour Title', 'English nested body [Physical]', 'Thai nested body [Physical|Thai Physical]'),
        popup('Blank', 'English must not leak', '', 'English must not leak either', ''),
        { id: 'dialogue', role: 'normal', sheet: 'NPCTextAudio', recordId: 'Dialogue', metadata: {}, fields: [field('Text', '[Physical] [Blank]', '[Physical|Thai Physical] [Blank|Thai Blank]')] }];
      host.ctWorkspace = { metadata: {}, scope: { accountId: 'guest', game: 'poe1', language: 'Thai', branchId: 'default', groupId: 'local:test:keyword', versionId: 'local:test:keyword' } };
      for(const unit of units)unit.id=JSON.stringify([unit.role,unit.sheet,unit.recordId]);
      const store=ClientTextMemoryStore.create();
      await store.import(host.ctWorkspace.scope,{units,assets:[{role:'normal',name:'Thai.xlsx',hash:'a'.repeat(64),blob:new Blob(['fixture original'])}]});
      host._ctTestStores=new Map([[host.ctWorkspace.scope.groupId,store]]);
      host.ctUnits = Vue.markRaw(units); host._ctUnitIndex = Vue.markRaw(new Map(units.map(unit => [unit.id, unit])));
      window.fixtureKeywordSources = [{ mode: 'clienttext', units, saved: {}, scope: { ...host.ctWorkspace.scope } }];
      host.ctSelection = units[3].id; host.ctFocusedField = 'Text'; host.ctValues = { Text: units[3].fields[0].target };
      host.ctSheet = JSON.stringify(['normal', 'NPCTextAudio']); host.ctTool = 'preview'; host.ctActive = true; host.inlineEditor = true; host.ctEditor = true;
      host.versionChooserVisible = false; host.showSetting = false; host.ctRevision++;
      await host.$nextTick();
    });
    await settle(page);
    const source = page.locator('.gamePreviewSourcePane .gamePreviewKw').first();
    const target = page.locator('.gamePreviewTargetPane .gamePreviewKw').first();
    const windows = page.locator('.keywordPreviewWindow[data-keyword-window]');
    await checkFocusGestures(page,target,windows);
    await checkPointerBehavior(page, target, source, windows);
    await checkAutocomplete(page,true,'clienttext-full');
    await page.evaluate(async()=>{fixtureApp.ctSelectedFilters=['missing','outdated','revised','saved','unchanged'];fixtureApp.ctEditor=false;await fixtureApp.$nextTick();});
    await checkAutocomplete(page,true,'clienttext-inline');
    await page.evaluate(async()=>{fixtureApp.ctEditor=true;await fixtureApp.$nextTick();});
    await target.hover(); await page.waitForSelector('.keywordPreviewWindow[data-keyword-window]');
    assert.equal(await windows.locator('.keywordPreviewTitle').innerText(), 'Thai Physical');
    assert.match(await windows.locator('.keywordPreviewContent').innerText(), /^Thai body/);
    const parentId = await windows.getAttribute('id'); await target.click();
    await windows.locator('.keywordPreviewContent .gamePreviewKw').hover();
    await page.waitForFunction(() => document.querySelectorAll('.keywordPreviewWindow[data-keyword-window]').length === 2);
    const nested = windows.last();
    assert.equal(await nested.locator('.keywordPreviewTitle').innerText(), 'Thai Armour Title');
    await page.locator('#'+parentId+' .keywordPreviewContent .gamePreviewKw').click();
    await nested.hover();
    assert.equal(await windows.count(), 2, 'keyword-pinned nested cards persist');
    await nested.locator('.keywordPreviewTitle').click();
    assert.equal(await nested.locator('.keywordPreviewClose').count(), 1, 'keyword click pinned its popup');
    await page.keyboard.press('Escape');
    assert.equal(await windows.count(), 1, 'Escape closes only the focused child');
    assert.equal(await page.evaluate(() => fixtureApp.ctEditor), true, 'Escape never reaches the full editor');
    // Focus restored to the parent keyword must not immediately reopen the child.
    await page.waitForTimeout(80); assert.equal(await windows.count(), 1);
    await page.locator('#' + parentId + ' .keywordPreviewTitle').click();
    await source.hover(); await page.waitForFunction(() => document.querySelectorAll('.keywordPreviewWindow[data-keyword-window]').length === 2);
    const englishId = await windows.last().getAttribute('id'); await source.click();
    assert.equal(await page.locator('#' + englishId + ' .keywordPreviewTitle').innerText(), 'Physical Damage');
    assert.match(await page.locator('#' + englishId + ' .keywordPreviewContent').innerText(), /^English body/);
    assert.equal(await windows.locator('img,script').count(), 0, 'workbook HTML never becomes DOM');
    await page.locator('#' + englishId + ' .keywordPreviewTitle').click();
    await page.locator('#' + parentId + ' .keywordPreviewTitle').click();
    assert.equal(await windows.last().getAttribute('id'), parentId, 'most recently clicked window comes forward');
    await page.keyboard.press('Escape');
    assert.equal(await windows.count(), 1); assert.equal(await windows.getAttribute('id'), englishId);
    await page.locator('.gamePreviewTargetPane .gamePreviewKw').nth(1).focus();
    await page.keyboard.press('Enter'); await settle(page);
    assert.match(await windows.last().innerText(), /Missing Thai translation/);
    assert.doesNotMatch(await windows.last().innerText(), /English must not leak/);
    await page.keyboard.press('Escape');
    // Exiting full editor and selecting another record retains pinned windows.
    await page.evaluate(async () => {
      fixtureApp.ctEditor = false; await fixtureApp.$nextTick();
      fixtureApp.ctSelection = fixtureApp.ctUnits.find(unit=>unit.recordId==='Armour').id; fixtureApp.ctValues = { 'Info Title': 'New file title', 'Info Content': 'New file body' }; await fixtureApp.$nextTick();
    });
    assert.equal(await windows.count(), 1); assert.match(await windows.innerText(), /English body/);
    await windows.locator('.keywordPreviewContent .gamePreviewKw').first().click();
    assert.equal(await windows.last().locator('.keywordPreviewTitle').innerText(), 'English Armour', 'nested lookup retains the original English context');
    await windows.last().locator('.keywordPreviewTitle').click();
    // Inline preview opens translated records as well.
    await page.evaluate(async () => {
      fixtureApp.ctSelection = fixtureApp.ctUnits.find(unit=>unit.recordId==='Dialogue').id; fixtureApp.ctValues = { Text: '[Physical|Thai inline]' }; await fixtureApp.$nextTick();
    });
    const inlineTarget = page.locator('#inlineEditorPreviewHost .gamePreviewTargetPane .gamePreviewKw').first();
    await inlineTarget.focus(); await page.keyboard.press('Space'); await settle(page);
    assert.equal(await windows.last().locator('.keywordPreviewTitle').innerText(), 'Thai Physical');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => fixtureApp.ctActive), true, 'Escape does not end the inline editor');
    // A new game/language/source cannot retarget an already pinned branch.
    await page.evaluate(async () => {
      fixtureApp.ctWorkspace.scope = { ...fixtureApp.ctWorkspace.scope, game: 'poe2', language: 'German', versionId: 'next' };
      fixtureApp.ctUnits = []; fixtureApp.ctRevision++; await fixtureApp.$nextTick();
    });
    const oldChild = page.locator('.keywordPreviewWindow[data-keyword-window]').filter({ hasText: 'English nested body' });
    await oldChild.locator('.gamePreviewKw').hover(); await settle(page);
    assert.equal(await windows.last().locator('.keywordPreviewTitle').innerText(), 'Physical Damage');
    assert.equal(await windows.last().getAttribute('data-language'), 'English');
    await page.mouse.move(5, 640); await page.waitForTimeout(550);
    // Exercise the same shared triggers in StatDescription, using a read-only
    // verified-reference adapter response rather than another workbook import.
    while (await windows.count()) await windows.last().locator('.keywordPreviewClose').click();
    await page.evaluate(async () => {
      const host = fixtureApp; host.ctActive = false; host.ctWorkspace = null;
      host._keywordCatalog = { load: async () => ({ sources: window.fixtureKeywordSources }), dispose() {} };
      const desc = host.descs.find(desc => desc.translations.English?.length && !desc.isDNT && desc.translations.English.every(text=>!text.includes('@')));
      await host.openEditorFile(desc.filepath);
      host.editorBlocks[0].english = '[Physical]'; host.editorBlocks[0].translation = '[Physical|Thai SD]';
      host.refreshGamePreview();
      host.sideTab = 'preview'; await host.$nextTick();
    });
    await checkAutocomplete(page,false,'sd-full');
    await page.locator('.gamePreviewTargetPane .gamePreviewKw').first().focus(); await page.keyboard.press('Enter'); await settle(page);
    assert.equal(await windows.last().locator('.keywordPreviewTitle').innerText(), 'Thai Physical');
    await page.keyboard.press('Escape'); assert.equal(await page.evaluate(() => fixtureApp.editorVisible), true);
    await page.locator('.gamePreviewSourcePane .gamePreviewKw').first().focus(); await page.keyboard.press('Enter'); await settle(page);
    assert.equal(await windows.last().locator('.keywordPreviewTitle').innerText(), 'Physical Damage');
    await page.evaluate(async () => { fixtureApp.editorVisible = false; fixtureApp.inlineActive = true; await fixtureApp.$nextTick(); });
    assert.equal(await windows.count(), 1, 'SD pinned popup survives full-to-inline transition');
    await windows.locator('.keywordPreviewClose').click(); await checkAutocomplete(page,false,'sd-inline');
    await page.locator('#inlineEditorPreviewHost .gamePreviewSourcePane .gamePreviewKw').first().click(); await settle(page);
    await page.locator('#inlineEditorPreviewHost .gamePreviewTargetPane .gamePreviewKw').first().focus(); await page.keyboard.press('Space'); await settle(page);
    assert.equal(await windows.last().locator('.keywordPreviewTitle').innerText(), 'Thai Physical');
    await page.keyboard.press('Escape'); assert.equal(await page.evaluate(() => fixtureApp.inlineActive), true);
    await windows.locator('.keywordPreviewContent .gamePreviewKw').first().click(); await settle(page);
    await windows.last().locator('.keywordPreviewTitle').click();
    for (const theme of ['light', 'grey', 'dark', 'modern-dark']) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      await page.setViewportSize({ width: 900, height: 650 }); await settle(page);
      const bounds = await windows.evaluateAll(items => items.map(item => {
        const rect = item.getBoundingClientRect(), style = getComputedStyle(item);
        return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, bg: style.backgroundColor, opacity: style.opacity, active:item.classList.contains('keywordPreviewActive') };
      }));
      for (const rect of bounds) { assert.ok(rect.x >= 7 && rect.y >= 7 && rect.right <= 893 && rect.bottom <= 643, JSON.stringify(rect)); if(rect.active)assert.equal(rect.bg,'rgb(18, 17, 16)');else assert.match(rect.bg, /0\.7\)/); assert.equal(rect.opacity, '1'); }
      await page.screenshot({ path: join(folder, theme + '.png') });
    }
    await windows.last().locator('.keywordPreviewClose').click();
    // Long pinned content must remain scrollable and fully reachable after a
    // resized desktop viewport becomes shorter than the original card.
    await page.evaluate(async () => {
      const item = fixtureApp.keywordWindows[0];
      item.content = Array.from({ length: 100 }, (_, i) => [{ type: 'text', text: 'Long popup line ' + i }, { type: 'break' }]).flat();
      await fixtureApp.$nextTick();
    });
    await page.setViewportSize({ width: 700, height: 350 }); await settle(page);
    const long = await windows.first().evaluate(node => ({ bottom: node.getBoundingClientRect().bottom, scrollable: node.scrollHeight > node.clientHeight }));
    assert.ok(long.bottom <= 342 && long.scrollable, 'tall pinned card stays within resized viewport and scrolls');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ browser: executablePath, checks: 'nested pointer-down/up traces without parent activation, canceled keyword release, blank header dragging, active/inactive alpha, outside focus clear and focused Escape; autocomplete SD/ClientText inline/full: translated details below TL Note, pointer/keyboard selection, caret, Enter/ClientText Tab, typing/filtering, partial data, nested pins; trigger-only immediate dismissal, keyword-only pinning, card click raise/focus without pin, pinned root/nested pointer paths, hover blocking over cards and previews, captured header dragging of pinned cards and clamping, nested edge placement, translation/source, pin/close/focus/z-order, Escape isolation, file/game/language/source lifetime, SD and ClientText inline/full, safe markup, all themes, viewport bounds', screenshots: folder }));
  } finally {
    await browser?.close(); await new Promise(done => { server.close(done); server.closeAllConnections(); });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
