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
    const translationHistory=dock.locator('.editorFieldTools[data-comparison-side=translation]');
    await translationHistory.getByRole('button',{name:'Comparison options and revision history'}).click();
    await translationHistory.getByRole('button',{name:'Close revision menu'}).click();
    const sourceHistory=dock.locator('.editorFieldTools[data-comparison-side=source]');
    await sourceHistory.getByRole('button',{name:'Compare English source'}).click();
    await sourceHistory.getByRole('combobox',{name:'English version to compare'}).waitFor();
    assert.equal(await dock.locator('.ctMtlButtonTarget,.ctMtlReview').count(),0);
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
    const nameGrip=inline.getByRole('button',{name:'Select translation Name, record',exact:true});
    const sourceGrip=page.getByRole('button',{name:'Select English Name, record',exact:true});
    const buttonsOf=grip=>grip.evaluate(node=>[...node.closest('.editorFieldToolbar').querySelectorAll('button')].map(b=>b.getAttribute('aria-label')));
    assert.deepEqual(await buttonsOf(sourceGrip),['Select English Name, record','Compare English source','Comparison options and revision history']);
    const targetTools=await buttonsOf(nameGrip);
    assert.deepEqual(targetTools.filter(name=>name!=='Use English'),['Select translation Name, record','Bold','Italic','Underline','Compare translation']);
    assert.equal(await nameGrip.textContent(),'');assert.equal(await sourceGrip.textContent(),'');
    for(const themeName of ['light','grey','dark','modern-dark']){
        await page.evaluate(value=>document.documentElement.dataset.theme=value,themeName);
        assert.ok(await nameGrip.evaluate(button=>{
            const bar=button.closest('.editorFieldToolbar'),barBox=bar.getBoundingClientRect(),grip=button.getBoundingClientRect(),
                end=bar.querySelector('.fieldDiffButton').getBoundingClientRect();
            return bar.firstElementChild===button && grip.x<=barBox.x+12 && end.right>=barBox.right-12 && getComputedStyle(button).cursor==='grab';
        }),themeName+' grip and actions are at opposite edges of the toolbar');
    }
    await page.evaluate(value=>{if(value)document.documentElement.dataset.theme=value;else delete document.documentElement.dataset.theme;},theme);
    await nameGrip.focus();await nameGrip.press('Enter');await dock.waitFor();
    assert.match(await dock.textContent(),/Name · 1 selected/);await input.press('Escape');await dock.waitFor({state:'detached'});
    await nameGrip.click();await dock.waitFor();await input.fill('Deselect without saving');
    await nameGrip.click();await dock.waitFor({state:'detached'});assert.deepEqual(await snapshot(),before);
    await nameGrip.focus();await nameGrip.press('Space');await dock.waitFor();await target('complete','Name').click({modifiers:['Control']});
    await nameGrip.click();assert.match(await dock.textContent(),/Name · 1 selected/);assert.equal(await nameGrip.getAttribute('aria-pressed'),'false');
    await input.press('Escape');await dock.waitFor({state:'detached'});
    await sourceGrip.focus();await sourceGrip.press('Space');assert.equal(await sourceGrip.getAttribute('aria-pressed'),'true');
    await sourceGrip.press('Enter');assert.equal(await sourceGrip.getAttribute('aria-pressed'),'false');
    assert.equal(await nameGrip.locator('svg[data-icon=square-dashed-plus]').count(),1);
    assert.equal(await page.evaluate(()=>window.__clientFixtureApp.ctMtlVisible),false);
    await description.fill('Retained unsaved description');
    await drag(inline.getByRole('button',{name:'Select translation Name, record',exact:true}),target('complete','Description'));
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
    const english=(unit,name)=>page.getByRole('button',{name:'Select English '+name+', '+unit,exact:true}).or(page.getByRole('button',{name:unit+', English '+name,exact:true}));
    const readClipboard=expected=>page.evaluate(async expected=>{
        for(let attempt=0;attempt<60;attempt++)try{
            const [item]=await navigator.clipboard.read(),text=await (await item.getType('text/plain')).text();
            const html=item.types.includes('text/html')?await(await item.getType('text/html')).text():'',rows=window.ClientTextClipboard.decode(text,html).rows;
            if(!expected || JSON.stringify(rows.map(r=>r[0]))===JSON.stringify(expected))return {text,html,rows};
            await new Promise(resolve=>setTimeout(resolve,15));
        }catch(error){if(!['InvalidStateError','NotFoundError'].includes(error.name))throw error;await new Promise(resolve=>setTimeout(resolve,15));}
        throw Error('The expected spreadsheet clipboard write did not settle.');
    },expected);
    const singleName=inline.getByRole('textbox',{name:'Name',exact:true});
    const selectedNames=async()=>[await singleName.inputValue(),await target('complete','Name').locator('span').textContent(),await target('noaudio','Name').locator('span').textContent()];
    const originalNames=await selectedNames();
    for(const value of ['One shared cell','One\nmultiline\t"cell"']){
        await drag(nameGrip,target('noaudio','Name'));
        if(value.includes('\n'))await page.evaluate(value=>window.ClientTextClipboard.write([value]),value);
        else await page.evaluate(value=>navigator.clipboard.writeText(value),value);
        await readClipboard([value]);await input.press('Control+v');await dock.waitFor({state:'detached'});
        assert.deepEqual(await selectedNames(),[value,value,value],'one clipboard cell immediately fills all selected fields');
        assert.deepEqual(await snapshot(),cleared,'single-cell fill is pending until Save');
        await page.evaluate(()=>navigator.clipboard.writeText('Second shared cell'));
        await singleName.press('Control+v');
        assert.deepEqual(await selectedNames(),Array(3).fill('Second shared cell'),'inline paste keeps the selected range');
        await singleName.press('Control+z');assert.deepEqual(await selectedNames(),[value,value,value]);
        await singleName.press('Control+z');assert.deepEqual(await selectedNames(),originalNames,'one Undo restores the whole fill');
        await singleName.press('Escape');
    }
    // Select the final source before the first source. The unselected middle worksheet row
    // must still occupy a clipboard position. English gestures never open another record.
    await english('noaudio','Name').click({modifiers:['Control']});
    await english('record','Name').click({modifiers:['Control']});
    await page.keyboard.press('Control+c');
    const copied=await readClipboard(['Sword','','[NOAUDIO] ']);
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
    await drag(inline.getByRole('button',{name:'Select translation Name, record',exact:true}),target('noaudio','Name'));
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
    // The clipboard already supplies the translations. Pasting from a repeated-value
    // editor merges them with its existing draft and closes the extra editing surface.
    const normalName=inline.getByRole('textbox',{name:'Name',exact:true});
    const collapsed=(unit,field)=>target(unit,field).locator('span').textContent();
    const noPasteDock=async()=>{
        await dock.waitFor({state:'detached'});
        assert.equal(await page.getByRole('combobox',{name:'Record to edit'}).count(),0);
    };
    const saveDirect=async(key,value,field='Name')=>{
        await page.keyboard.press('Control+s');
        await page.waitForFunction(({key,value,field})=>{
            const v=window.__clientFixtureApp,u=v.ctUnits.find(row=>row.sheet==='Normal' && row.recordId===key);
            return !v.ctBusy && !v.ctBulkSaving && v.ctSaved[u.id]?.values[u.fields.find(f=>f.name===field).id]===value;
        },{key,value,field},{timeout:5000}).catch(async error=>{
            const state=await page.evaluate(()=>{const v=window.__clientFixtureApp;return {pending:v.ctDirectValues,error:v.ctError,fillError:v.ctBulkError,
                retry:!!v.ctDirectRetry,focused:document.activeElement?.getAttribute('aria-label')};});
            throw Error('Direct Save of '+key+' '+field+' did not finish: '+JSON.stringify(state),{cause:error});
        });
    };
    await input.press('Control+v');await noPasteDock();
    assert.equal(await normalName.inputValue(),'Sword');assert.equal(await collapsed('complete','Name'),'Temporary replacement');
    assert.equal(await collapsed('noaudio','Name'),'[NOAUDIO] ');
    assert.deepEqual(await snapshot(),cleared,'paste has not committed translations or the sibling draft');
    await page.keyboard.press('Control+c');
    assert.ok((await readClipboard(['Sword','Temporary replacement','[NOAUDIO] '])).html.includes('data-sheets-value'));
    await copiedSide('target').waitFor();
    assert.equal(await target('complete','Name').evaluate(node=>getComputedStyle(node).borderTopStyle),'dashed');
    await page.keyboard.press('Escape');await noPasteDock();
    assert.equal(await page.locator('[data-ct-bulk-field][aria-pressed=true]').count(),0);
    assert.equal(await page.locator('.fileTableScroll[data-ct-copied-side]').count(),0);
    assert.equal(await normalName.inputValue(),'Sword','clearing selection retains pasted values');
    await normalName.press('Control+z');
    await normalName.press('Control+y');
    assert.equal(await normalName.inputValue(),'Sword');assert.equal(await collapsed('complete','Name'),'Temporary replacement');
    // A second paste overlaps the first. A blank clipboard cell preserves the pending
    // value, excess rows and additional clipboard columns have no destination.
    await page.evaluate(()=>navigator.clipboard.writeText('Corrected\tunused column\r\n\r\nNew third value\r\nOverflow'));
    await normalName.press('Control+v');await noPasteDock();
    assert.equal(await normalName.inputValue(),'Corrected');assert.equal(await collapsed('complete','Name'),'Temporary replacement');
    assert.equal(await collapsed('noaudio','Name'),'New third value');
    await normalName.press('Control+z');
    assert.equal(await normalName.inputValue(),'Sword');assert.equal(await collapsed('noaudio','Name'),'[NOAUDIO] ');
    await normalName.press('Control+Shift+z');
    assert.equal(await normalName.inputValue(),'Corrected');assert.equal(await collapsed('noaudio','Name'),'New third value');
    assert.equal(await normalName.evaluate(node=>node===document.activeElement),true);
    assert.deepEqual(await snapshot(),cleared);
    await saveDirect('record','Corrected');
    const latest=await snapshot();
    assert.equal(latest.complete.name,'Temporary replacement');assert.equal(latest.record.draft,'Retained unsaved description');
    await description.press('Control+a');await description.press('Control+c');
    assert.equal((await readClipboard()).text,'Retained unsaved description','native text selection has independent clipboard ownership');

    // Reverse the table. The first displayed row lacks Description; that physical
    // position consumes a clipboard slot and the second row gets its own value.
    await page.evaluate(()=>{window.__clientFixtureApp.ctSortDir='desc';});
    await english('complete','Description').click({modifiers:['Control']});
    await english('noaudio','Name').click({modifiers:['Shift']});await page.keyboard.press('Control+c');
    assert.deepEqual((await readClipboard(['','{0:+d} <<keybind:open_panel>>'])).rows.map(r=>r[0]),['','{0:+d} <<keybind:open_panel>>']);
    await drag(target('complete','Description'),target('noaudio','Name'));
    await page.evaluate(()=>navigator.clipboard.writeText('Unmapped first row\r\nMapped second row'));
    await input.press('Control+v');await noPasteDock();
    assert.equal(await collapsed('complete','Description'),'Mapped second row');
    await saveDirect('complete','Mapped second row','Description');
    // Exercise trusted Ctrl+C after actual pointer capture and an existing native selection.
    await page.evaluate(()=>{window.__clientFixtureApp.ctSortDir='asc';});
    await description.focus();await description.press('Control+a');
    await page.evaluate(()=>navigator.clipboard.writeText('Old clipboard sentinel'));
    const from=await point(english('complete','Name')),to=await point(english('record','Description'));
    await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:9});await page.mouse.up();
    await page.keyboard.press('Control+c');
    assert.ok((await readClipboard(['Sword','Shield'])).html.includes('data-sheets-value'));
    // Start directly inside the native field at a page boundary.
    await page.evaluate(()=>{window.__clientFixtureApp.pageSize=1;window.__clientFixtureApp.ctPage=1;});
    if(!await normalName.isVisible())await target('record','Name').click();
    await normalName.press('Control+v');await noPasteDock();assert.equal(await normalName.inputValue(),'Sword');
    assert.equal(await normalName.evaluate(node=>node===document.activeElement),true);
    assert.equal((await snapshot()).record.name,'Corrected');
    await saveDirect('complete','Shield');
    const ordinary=await snapshot();assert.equal(ordinary.record.name,'Sword');assert.equal(ordinary.record.draft,'Retained unsaved description');
    // The ordinary selected draft precedes this paste and must come back on Undo.
    await normalName.fill('Prior unsaved Name');await page.evaluate(()=>window.__clientFixtureApp.ctFlushDraft());
    await page.evaluate(()=>navigator.clipboard.writeText('Jaw Trap\nSecond replacement'));
    await normalName.press('Control+v');await noPasteDock();assert.equal(await normalName.inputValue(),'Jaw Trap');
    assert.equal((await snapshot()).record.name,'Sword');
    await normalName.press('Escape');await normalName.press('Control+z');
    assert.equal(await normalName.inputValue(),'Prior unsaved Name');
    await normalName.press('Control+y');assert.equal(await normalName.inputValue(),'Jaw Trap');
    await normalName.press('End');await normalName.pressSequentially('xyz',{delay:5});assert.equal(await normalName.inputValue(),'Jaw Trapxyz');
    await normalName.press('Control+z');assert.equal(await normalName.inputValue(),'Jaw Trap');
    await normalName.press('Control+y');assert.equal(await normalName.inputValue(),'Jaw Trapxyz');
    await normalName.press('Control+z');
    await normalName.press('Control+a');await normalName.press('Control+b');assert.equal(await normalName.inputValue(),'<b>{Jaw Trap}');
    await normalName.press('Control+z');assert.equal(await normalName.inputValue(),'Jaw Trap');
    assert.deepEqual(await normalName.evaluate(node=>[node.selectionStart,node.selectionEnd]),[0,8]);
    await saveDirect('complete','Second replacement');
    const replaced=await snapshot();assert.equal(replaced.record.name,'Jaw Trap');
    assert.equal(replaced.record.draft,'Retained unsaved description');assert.equal(replaced.record.description,'Old description');
    await normalName.fill('Skipped Name draft');await page.evaluate(()=>window.__clientFixtureApp.ctFlushDraft());
    await page.evaluate(()=>navigator.clipboard.writeText('\nOnly the second row changes'));
    await normalName.press('Control+v');await noPasteDock();assert.equal(await normalName.inputValue(),'Skipped Name draft');
    await saveDirect('complete','Only the second row changes');
    const skipped=await snapshot();assert.equal(skipped.record.name,'Jaw Trap');assert.equal(skipped.record.history,replaced.record.history);
    assert.equal(skipped.record.draftName,'Skipped Name draft');
    // Two distinct column pastes address the same physical rows before one Save.
    await page.evaluate(()=>navigator.clipboard.writeText('Written description\nSecond description'));
    await description.press('Control+v');await noPasteDock();
    await page.evaluate(()=>navigator.clipboard.writeText('Written name\nSecond name'));
    await normalName.press('Control+v');await noPasteDock();
    assert.equal(await description.inputValue(),'Written description');assert.equal(await normalName.inputValue(),'Written name');
    assert.deepEqual(await snapshot(),skipped);
    await normalName.press('Control+z');assert.equal(await normalName.inputValue(),'Skipped Name draft');assert.equal(await description.inputValue(),'Written description');
    await normalName.press('Control+y');await saveDirect('record','Written name');
    const multiple=await snapshot();assert.equal(multiple.record.description,'Written description');
    assert.equal(multiple.complete.description,'Second description');assert.equal(multiple.complete.name,'Second name');
    assert.deepEqual(failures,[]);
    console.log('PASS ClientText direct paste stays in the table, preserves drafts and blank positions, groups Undo across Escape, and saves using ordinary Ctrl+S.');
};
