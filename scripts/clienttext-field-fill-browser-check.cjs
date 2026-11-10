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
    await input.press('Escape');assert.equal(await dock.count(),1);assert.equal(await input.inputValue(),'Same');
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
                draft:draft?.values[field('Description')],history:(await store.listHistory(scope,unit.id)).length};
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
    assert.deepEqual(failures,[]);console.log('PASS ClientText field selection, shared native toolbar, history, Ctrl+S, local receipts and preserved inline sibling drafts.');
};
