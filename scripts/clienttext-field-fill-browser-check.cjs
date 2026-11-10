'use strict';
const assert=require('node:assert/strict');
module.exports=async function({page,files,failures}){
    await page.evaluate(()=>window.__clientFixtureApp.ctOpenOfflineTest());
    const upload=page.locator('.ctUploadDialog');
    await upload.locator('section[aria-label="Current workbooks"] input[type=file]').first().setInputFiles(files);
    await upload.getByRole('button',{name:'Open',exact:true}).click();
    await page.waitForFunction(()=>{const app=window.__clientFixtureApp;return app.ctActive&&!app.ctBusy&&!app.ctUploading&&!app.workspaceInitializationActive;});
    await page.evaluate(async()=>{
        const app=window.__clientFixtureApp;
        app.inlineEditor=true;await app.ctShowAllLoaded();await app.ctSetSheet(JSON.stringify(['normal','Normal']));
        app.ctSort='row';app.ctSortDir='asc';app.ctInlineClosed=true;
    });
    const target=(unit,field)=>page.getByRole('button',{name:unit+', '+field,exact:true});
    const dock=page.locator('.ctCellFill'),input=dock.getByRole('textbox',{name:'Replacement translation',exact:true});
    const point=async locator=>{await locator.scrollIntoViewIfNeeded();const b=await locator.boundingBox();assert.ok(b);return {x:b.x+b.width/2,y:b.y+b.height/2};};
    const drag=async(first,last)=>{
        const a=await point(first),b=await point(last);
        await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:9});
        assert.equal(await dock.count(),0,'Bulk editor opens only after release');
        await page.mouse.up();await dock.waitFor();
    };
    await drag(target('complete','Name'),target('record','Description'));
    assert.equal(await page.locator('.ctBulkCell[aria-pressed=true]').count(),2);
    assert.match(await dock.textContent(),/1 empty · 1 populated/);
    const theme=await page.evaluate(()=>document.documentElement.dataset.theme);
    for(const name of ['light','grey','dark','modern-dark']){
        await page.evaluate(name=>document.documentElement.dataset.theme=name,name);
        const colors=await dock.evaluate(node=>{
            const selected=document.querySelector('.ctBulkCell[aria-pressed=true]'),style=getComputedStyle(node),active=getComputedStyle(selected);
            const bounds=node.getBoundingClientRect(),footer=document.querySelector('.ctListWorkspace .workspaceFooter')?.getBoundingClientRect();
            return {diff:active.backgroundColor!==getComputedStyle(document.querySelector('.ctBulkCell[aria-pressed=false]')).backgroundColor,
                text:style.color,surface:style.backgroundColor,visible:bounds.width>200 && bounds.height>30 && bounds.right<=innerWidth+1,
                footerClear:!footer || bounds.bottom<=footer.top+2};
        });
        assert.ok(colors.diff && colors.text!==colors.surface && colors.visible && colors.footerClear, name+' bulk panel '+JSON.stringify(colors));
    }
    await page.evaluate(theme=>{if(theme)document.documentElement.dataset.theme=theme;else delete document.documentElement.dataset.theme;},theme);
    await input.fill('Same');
    assert.equal(await page.evaluate(()=>{const v=window.__clientFixtureApp;return v.ctPreviewField.name+' '+v.ctPreviewValue(v.ctPreviewField);}), 'Name Same');
    await input.press('Control+Enter');await page.locator('.ctCellFill.ctBulkFullSize').waitFor();
    await input.press('Escape');await dock.waitFor({state:'detached'});
    assert.equal(await page.locator('[data-ct-bulk-field][aria-pressed=true]').count(),0,'Escape dismisses an expanded selection');
    await drag(target('complete','Name'),target('record','Description'));await input.fill('Same');
    await page.evaluate(()=>{window.__clientFixtureApp.ctSortDir='desc';});
    await dock.getByRole('alert').waitFor();
    assert.equal(await dock.getByRole('button',{name:'Save',exact:true}).isDisabled(),true);
    await page.evaluate(()=>{window.__clientFixtureApp.ctSortDir='asc';});
    assert.equal(await input.inputValue(),'Same');
    await input.press('Control+a');await input.press('Control+b');
    assert.equal(await input.inputValue(),'<b>{Same}');
    await dock.getByRole('button',{name:'Compare translation',exact:true}).click();
    await dock.getByRole('combobox',{name:'Translation revision to compare'}).waitFor();
    await input.press('Control+s');
    await dock.waitFor({state:'detached'});
    const snapshot=()=>page.evaluate(async()=>{
        const app=window.__clientFixtureApp,scope=app.ctWorkspace.scope,store=app.ctStorage(scope);
        const saved=await store.getSaved(scope),rows={};
        for(const id of ['record','complete']){
            const unit=app.ctUnits.find(u=>u.role==='normal'&&u.sheet==='Normal'&&u.recordId===id);
            const field=name=>unit.fields.find(f=>f.name===name).id,draft=await store.getDraft(scope,unit.id);
            rows[id]={name:saved[unit.id]?.values[field('Name')],description:saved[unit.id]?.values[field('Description')],
                draft:draft?.values[field('Description')],draftName:draft?.values[field('Name')],history:(await store.listHistory(scope,unit.id)).length};
        }
        return rows;
    });
    const before=await snapshot();assert.equal(before.record.name,'<b>{Same}');assert.equal(before.complete.name,'<b>{Same}');
    assert.equal(before.record.description,'Old description');assert.equal(before.record.history,1);
    await target('record','Description').click();const inline=page.locator('.ctTable .ctFields[data-side=translation]');
    const description=inline.getByRole('textbox',{name:'Description',exact:true});
    await description.fill('Retained unsaved description');
    await drag(inline.locator('.ctBulkFieldLabel').filter({hasText:/^Name$/}),target('complete','Description'));
    await input.fill('Updated name');await input.press('Control+s');await dock.waitFor({state:'detached'});
    const next=await snapshot();assert.equal(next.record.name,'Updated name');assert.equal(next.complete.name,'Updated name');
    assert.equal(next.record.description,'Old description');assert.equal(next.record.draft,'Retained unsaved description');
    assert.equal(await description.inputValue(),'Retained unsaved description');
    await target('complete','Name').click({modifiers:['Control']});await dock.waitFor();
    await input.fill('Do not save');await input.press('Escape');await dock.waitFor({state:'detached'});
    assert.deepEqual(await snapshot(),next);
    await target('complete','Description').click({modifiers:['Control']});await dock.waitFor();
    await input.fill('');await input.press('Control+Space');
    const popup=page.locator('#sharedEditorAutocompleteList');
    await popup.waitFor();await input.press('ArrowDown');await input.press('Enter');
    assert.ok((await input.inputValue()).length>0);
    await input.fill('');assert.match(await dock.textContent(),/1 to clear/);
    await input.press('F1');await dock.waitFor({state:'detached'});
    await page.waitForFunction(()=>{const v=window.__clientFixtureApp;return !v.ctNavigationBusy && v.ctCurrentUnit?.recordId==='record';});
    const cleared=await snapshot();assert.equal(cleared.complete.description,'');assert.equal(cleared.record.description,'Old description');
    assert.equal(cleared.record.draft,'Retained unsaved description');
    await page.context().grantPermissions(['clipboard-read','clipboard-write'],{origin:new URL(page.url()).origin});
    const english=(unit,name)=>page.getByRole('button',{name:unit+', English '+name,exact:true});
    const readClipboard=expected=>page.evaluate(async expected=>{
        for(let attempt=0;attempt<60;attempt++)try{
            const [item]=await navigator.clipboard.read(),text=await (await item.getType('text/plain')).text();
            const html=item.types.includes('text/html')?await(await item.getType('text/html')).text():'',rows=window.ClientTextClipboard.decode(text,html).rows;
            if(!expected || JSON.stringify(rows.map(r=>r[0]))===JSON.stringify(expected))return {text,html,rows};
            await new Promise(resolve=>setTimeout(resolve,15));
        }catch(error){if(error.name!=='InvalidStateError')throw error;await new Promise(resolve=>setTimeout(resolve,15));}
        throw Error('The expected spreadsheet clipboard write did not settle.');
    },expected);
    // Select the final source before the first source. The unselected middle worksheet row
    // must still occupy a clipboard position. English gestures never open another record.
    await english('noaudio','Name').click({modifiers:['Control']});
    await english('record','Name').click({modifiers:['Control']});
    await page.keyboard.press('Control+c');
    const copied=await readClipboard();
    assert.deepEqual(copied.rows.map(r=>r[0]),['Sword','','[NOAUDIO] ']);
    assert.ok(copied.html.includes('data-sheets-value'));
    const copiedSide=side=>page.locator('.fileTableScroll[data-ct-copied-side="'+side+'"]');
    await copiedSide('source').waitFor();
    assert.equal(await english('record','Name').evaluate(node=>getComputedStyle(node).borderTopStyle),'dashed');
    const clearBackground='rgba(0, 0, 0, 0)',cellColor=cell=>cell.evaluate(node=>getComputedStyle(node).backgroundColor);
    await english('complete','Name').click();
    assert.equal(await english('record','Name').getAttribute('aria-pressed'),'false');
    assert.equal(await english('record','Name').evaluate(node=>getComputedStyle(node).borderTopStyle),'dashed');
    assert.equal(await cellColor(english('record','Name')),clearBackground,'the old copied range has only an outline');
    assert.notEqual(await cellColor(english('complete','Name')),clearBackground,'the new selection owns the active fill');
    await page.evaluate(()=>{window.__clientFixtureApp.ctSortDir='desc';});
    assert.equal(await english('noaudio','Name').getAttribute('data-ct-copied'),'true','the copied record survives a same-workbook reorder');
    await page.evaluate(()=>{window.__clientFixtureApp.ctSortDir='asc';});
    await english('record','Name').click();await english('noaudio','Name').click({modifiers:['Control']});
    assert.equal(await dock.count(),0);assert.equal(await description.inputValue(),'Retained unsaved description');
    // Target selection and source selection coexist, including native copy while the shared field has a draft.
    await drag(inline.locator('.ctBulkFieldLabel').filter({hasText:/^Name$/}),target('noaudio','Name'));
    await input.fill('Temporary replacement');
    assert.equal(await english('record','Name').evaluate(node=>getComputedStyle(node).borderTopStyle),'dashed');
    assert.equal(await cellColor(english('record','Name')),clearBackground,'moving to the target keeps only the source outline');
    await page.evaluate(()=>{
        window.__ctFixtureClipboard=window.ClientTextClipboard;
        window.ClientTextClipboard={...window.ClientTextClipboard,write:async()=>{throw Error('Fixture clipboard denied');}};
    });
    await dock.getByRole('button',{name:'Copy all',exact:true}).click();
    await dock.getByText(/Fixture clipboard denied/).waitFor();
    assert.equal(await english('record','Name').getAttribute('data-ct-copied'),'true','a failed new copy keeps the earlier range');
    assert.equal(await target('complete','Name').getAttribute('data-ct-copied'),null);
    await page.evaluate(()=>{window.ClientTextClipboard=window.__ctFixtureClipboard;delete window.__ctFixtureClipboard;});
    await english('record','Name').focus();await page.keyboard.press('Control+c');
    assert.equal(await input.inputValue(),'Temporary replacement');
    await input.press('Control+v');await dock.locator('.ctBulkPastePreview').waitFor();
    await dock.getByRole('button',{name:'Copy all',exact:true}).click();
    assert.ok((await readClipboard(['Sword','Temporary replacement','[NOAUDIO] '])).html.includes('data-sheets-value'));
    await copiedSide('target').waitFor();
    assert.equal(await target('complete','Name').evaluate(node=>getComputedStyle(node).borderTopStyle),'dashed');
    assert.equal(await english('record','Name').evaluate(node=>getComputedStyle(node).borderTopStyle),'solid');
    await input.press('Escape');await dock.waitFor({state:'detached'});
    assert.equal(await page.locator('[data-ct-bulk-field][aria-pressed=true]').count(),0,'one Escape clears both English and target selections');
    assert.equal(await page.locator('.fileTableScroll[data-ct-copied-side]').count(),0);
    assert.equal(await description.inputValue(),'Retained unsaved description');
    await english('noaudio','Name').click({modifiers:['Control']});
    await english('record','Name').click({modifiers:['Control']});
    await page.keyboard.press('Control+c');
    await drag(inline.locator('.ctBulkFieldLabel').filter({hasText:/^Name$/}),target('noaudio','Name'));
    await input.press('Control+v');await dock.locator('.ctBulkPastePreview').waitFor();
    assert.match(await dock.textContent(),/1 skipped/);
    assert.deepEqual(await snapshot(),cleared);
    await dock.getByRole('button',{name:'Copy all',exact:true}).click();
    const copiedTargets=await readClipboard(['Sword','Updated name','[NOAUDIO] ']);assert.ok(copiedTargets.html.includes('data-sheets-value'));
    await page.evaluate(()=>navigator.clipboard.writeText(' \n\t \n'));await input.press('Control+v');
    assert.match(await dock.getByRole('alert').textContent(),/no values/);
    const records=dock.getByRole('combobox',{name:'Record to edit'});
    await records.selectOption({label:'noaudio'});await input.fill('New third value');
    await dock.getByRole('button',{name:'Copy all',exact:true}).click();
    assert.ok((await readClipboard(['Sword','Updated name','New third value'])).html.includes('data-sheets-value'));
    await page.evaluate(()=>navigator.clipboard.writeText('Corrected\tunused column\r\n\r\n\r\nOverflow must be ignored'));
    await input.press('Control+v');
    await dock.getByRole('button',{name:'Copy all',exact:true}).click();
    assert.ok((await readClipboard(['Corrected','Updated name','New third value'])).html.includes('data-sheets-value'));
    await input.press('Control+s');await dock.waitFor({state:'detached'});
    const latest=await snapshot();assert.equal(latest.record.name,'Corrected');assert.equal(latest.complete.name,'Updated name');
    assert.equal(latest.complete.history,cleared.complete.history);assert.equal(latest.record.draft,'Retained unsaved description');
    const last=await page.evaluate(async()=>{
        const vm=window.__clientFixtureApp,unit=vm.ctUnits.find(u=>u.recordId==='noaudio');
        return (await vm.ctStorage(vm.ctWorkspace.scope).getSaved(vm.ctWorkspace.scope))[unit.id].values[unit.fields.find(f=>f.name==='Name').id];
    });
    assert.equal(last,'New third value');
    await description.press('Control+a');await description.press('Control+c');
    assert.equal((await readClipboard()).text,'Retained unsaved description','native text selection has independent clipboard ownership');
    // In reverse order the noaudio record is the first displayed row. It has no Description
    // field, but the released/Shift-clicked endpoint still occupies the first clipboard slot.
    await page.evaluate(()=>{window.__clientFixtureApp.ctSortDir='desc';});
    await english('complete','Description').click({modifiers:['Control']});
    await english('noaudio','Name').click({modifiers:['Shift']});await page.keyboard.press('Control+c');
    assert.deepEqual((await readClipboard()).rows.map(r=>r[0]),['','{0:+d} <<keybind:open_panel>>']);
    await drag(target('complete','Description'),target('noaudio','Name'));
    await page.evaluate(()=>navigator.clipboard.writeText('Unmapped first row\r\nMapped second row'));
    await input.press('Control+v');await dock.locator('.ctBulkPastePreview').waitFor();
    assert.equal(await input.inputValue(),'Mapped second row');
    await dock.getByRole('button',{name:'Copy all',exact:true}).click();
    assert.ok((await readClipboard(['','Mapped second row'])).html.includes('data-sheets-value'));
    await input.press('Escape');await dock.waitFor({state:'detached'});
    // A physical drag then Ctrl+C must replace an OS clipboard sentinel without the test
    // moving focus to a source handle, even if a native translation field owned focus.
    assert.equal((await snapshot()).record.draft,'Retained unsaved description','endpoint tests retain the previous draft');
    await page.evaluate(()=>{window.__clientFixtureApp.ctSortDir='asc';});
    await description.focus();await description.press('Control+a');
    await page.evaluate(()=>navigator.clipboard.writeText('Old clipboard sentinel'));
    const from=await point(english('complete','Name')),to=await point(english('record','Description'));
    await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:8});await page.mouse.up();
    await page.keyboard.press('Control+c');
    assert.ok((await readClipboard(['Sword','Shield'])).html.includes('data-sheets-value'));
    assert.equal((await snapshot()).record.draft,'Retained unsaved description','source dragging retains the prior focused translation draft');
    // No target selection exists. Paste into a regular row's native field and verify both
    // spreadsheet cells are proposed in order, even when the second row is on the next page.
    await page.evaluate(()=>{window.__clientFixtureApp.pageSize=1;window.__clientFixtureApp.ctPage=1;});
    const normalName=inline.getByRole('textbox',{name:'Name',exact:true});
    if(!await normalName.isVisible())await target('record','Name').click();
    assert.equal((await snapshot()).record.draft,'Retained unsaved description','the ordinary paste begins with a sibling draft');
    await normalName.focus();await normalName.press('Control+v');
    await dock.locator('.ctBulkPastePreview').waitFor();
    assert.equal(await dock.getByRole('combobox',{name:'Record to edit'}).locator('option').count(),2);
    assert.equal((await snapshot()).record.name,'Corrected');
    await input.press('Control+s');await dock.waitFor({state:'detached'});
    const ordinary=await snapshot();assert.equal(ordinary.record.name,'Sword');assert.equal(ordinary.complete.name,'Shield');
    assert.equal(ordinary.record.draft,'Retained unsaved description');
    // A prior ordinary target draft can be deliberately replaced. Undo restores that
    // draft and the second row together, while the sibling draft remains unpublished.
    await normalName.fill('Prior unsaved Name');await page.evaluate(()=>window.__clientFixtureApp.ctFlushDraft());
    await page.evaluate(()=>navigator.clipboard.writeText('Jaw Trap\nSecond replacement'));
    await normalName.press('Control+v');await dock.locator('.ctBulkPastePreview').waitFor();
    assert.equal(await input.inputValue(),'Jaw Trap');assert.equal((await snapshot()).record.name,'Sword');
    await input.press('Control+z');
    assert.equal(await input.inputValue(),'Prior unsaved Name');
    assert.equal(await dock.getByRole('button',{name:'Save',exact:true}).isDisabled(),true);
    await dock.getByRole('button',{name:'Copy all',exact:true}).click();
    assert.ok((await readClipboard(['Prior unsaved Name','Shield'])).html);
    await input.press('Control+Shift+z');assert.equal(await input.inputValue(),'Jaw Trap');
    await input.press('End');await input.pressSequentially('xyz',{delay:5});assert.equal(await input.inputValue(),'Jaw Trapxyz');
    await input.press('Control+z');assert.equal(await input.inputValue(),'Jaw Trap');
    await input.press('Control+y');assert.equal(await input.inputValue(),'Jaw Trapxyz');
    await input.press('Control+z');assert.equal(await input.inputValue(),'Jaw Trap');
    await input.press('Control+a');await input.press('Control+b');assert.equal(await input.inputValue(),'<b>{Jaw Trap}');
    await input.press('Control+z');assert.equal(await input.inputValue(),'Jaw Trap');
    assert.deepEqual(await input.evaluate(node=>[node.selectionStart,node.selectionEnd]),[0,8]);
    await input.press('Control+y');assert.equal(await input.inputValue(),'<b>{Jaw Trap}');
    assert.deepEqual(await input.evaluate(node=>[node.selectionStart,node.selectionEnd]),[4,12]);
    await input.evaluate(node=>node.setSelectionRange(6,6));await input.press('Control+b');
    assert.equal(await input.inputValue(),'Jaw Trap');await input.press('Control+z');
    assert.deepEqual(await input.evaluate(node=>[node.value,node.selectionStart,node.selectionEnd]),['<b>{Jaw Trap}',6,6]);
    await input.press('Control+b');assert.equal(await input.inputValue(),'Jaw Trap');
    await dock.getByRole('button',{name:'Copy all',exact:true}).click();
    assert.ok((await readClipboard(['Jaw Trap','Second replacement'])).html);
    await input.press('Control+s');await dock.waitFor({state:'detached'});
    const replaced=await snapshot();assert.equal(replaced.record.name,'Jaw Trap');assert.equal(replaced.complete.name,'Second replacement');
    assert.equal(replaced.record.draft,'Retained unsaved description');assert.equal(replaced.record.description,'Old description');
    await normalName.fill('Skipped Name draft');await page.evaluate(()=>window.__clientFixtureApp.ctFlushDraft());
    await page.evaluate(()=>navigator.clipboard.writeText('To undo\nAnother row to undo'));
    await normalName.press('Control+v');await dock.locator('.ctBulkPastePreview').waitFor();
    await input.press('Control+z');assert.equal(await input.inputValue(),'Skipped Name draft');
    await page.evaluate(()=>navigator.clipboard.writeText('\nOnly the second row changes'));
    await input.press('Control+v');assert.match(await dock.textContent(),/1 skipped/);
    await input.press('Control+s');await dock.waitFor({state:'detached'});
    const skipped=await snapshot();assert.equal(skipped.record.name,'Jaw Trap');assert.equal(skipped.record.history,replaced.record.history);
    assert.equal(skipped.record.draftName,'Skipped Name draft');assert.equal(skipped.complete.name,'Only the second row changes');
    await copiedSide('target').waitFor();
    await normalName.press('Escape');
    assert.equal(await page.locator('.ctTable [data-ct-copied]').count(),0,'Escape clears a copied-only range after Save');
    assert.ok(await normalName.isVisible(),'clearing a copied range keeps the ordinary editor open');
    assert.deepEqual(failures,[]);console.log('PASS ClientText field selection, source clipboard, ordered target paste, dual-format Copy all, shared toolbar, Ctrl+S and preserved sibling drafts.');
};
