'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const Progress=require('../public/clientTextMtlProgress.js');

test('progress elapsed time uses an anchored observation and preserves zero without percentages',()=>{
    assert.equal(Progress.elapsed({elapsedMs:4000,receivedAt:1000},3500),6500);
    assert.equal(Progress.elapsed({elapsedMs:0,receivedAt:0},1000),1000);
    assert.equal(Progress.elapsed({elapsedMs:1000,receivedAt:5000},4000),1000);
    assert.equal(Progress.formatElapsed(65000),'1m 05s');assert.equal(Progress.formatElapsed(0),'0s');assert.equal(Progress.formatElapsed(Infinity),'0s');
});

test('live preview is escaped, clearly provisional and separate from editor values',()=>{
    const text='<img src=x onerror=alert(1)> Translation {0}\nNext';
    assert.equal(Progress.Preview.computed.preview.call({state:{text}}),text);
    assert.match(Progress.Preview.template,/Working preview · not yet validated/);assert.match(Progress.Preview.template,/separate from your draft and exports/);
    assert.match(Progress.Preview.template,/\{\{ preview \|\|/);assert.doesNotMatch(Progress.Preview.template,/v-html|v-model|data-ct-target/);
    assert.match(Progress.Preview.template,/data-inline-focus-surface/);assert.match(Progress.Preview.template,/aria-live="polite"/);
});

test('closing or finishing a focused preview returns focus to a stable control without taking focus from typing',()=>{
    let focused='',owned=true;
    const app={state:{requestId:'synthetic'},$refs:{popup:{contains:()=>owned},live:{isConnected:true,focus:()=>{focused='live';}}},
        $el:{focus:()=>{focused='wrapper';}},$nextTick(){},dismissed:false,pinned:true};
    Progress.Preview.methods.close.call(app);assert.equal(focused,'live');assert.equal(app.dismissed,true);
    app.state=null;Progress.Preview.methods.close.call(app);assert.equal(focused,'wrapper');
    focused='';owned=false;Progress.Preview.methods.close.call(app);assert.equal(focused,'');
});

test('keyboard Stop moves focus before disabling and repeated cancellation cannot emit another action',()=>{
    const previous=global.document,button={},events=[];
    global.document={activeElement:button};
    try{
        const app={state:{canCancel:true,phase:'receiving'},$refs:{text:{focus:options=>events.push(['focus',options])}},$emit:value=>events.push(['emit',value])};
        Progress.Preview.methods.cancel.call(app,{currentTarget:button});
        assert.deepEqual(events,[['focus',{preventScroll:true}],['emit','cancel']]);
        app.state={canCancel:false,phase:'cancelling'};Progress.Preview.methods.cancel.call(app,{currentTarget:button});assert.equal(events.length,2);
        assert.match(Progress.Preview.template,/state.canCancel \|\| state.phase==='cancelling'/);
    }finally{global.document=previous;}
});

test('terminal preview cleanup restores enabled Translate after rendering without stealing a newer focus',()=>{
    const previous=global.document,ticks=[],events=[],button={focus:options=>events.push(['translate',options])};
    const wrapper={focus:options=>{events.push(['wrapper',options]);global.document.activeElement=wrapper;},querySelector:()=>button};
    global.document={activeElement:{}};
    try{
        const app={state:null,$refs:{popup:{contains:()=>true}},$el:wrapper,$nextTick:callback=>ticks.push(callback)};
        Progress.Preview.methods.close.call(app);ticks.shift()();
        assert.deepEqual(events,[['wrapper',{preventScroll:true}],['translate',{preventScroll:true}]]);
        Progress.Preview.methods.close.call(app);global.document.activeElement={};ticks.shift()();assert.equal(events.length,3);
    }finally{global.document=previous;}
});

test('Escape dismissal survives layout enter events until the pointer actually leaves and returns',()=>{
    const inside={},outside={},app={state:{requestId:'synthetic'},hovered:true,dismissed:true,$el:{contains:target=>target===inside},$refs:{},_pointerPosition:[50,50]};
    app.enter=()=>Progress.Preview.methods.enter.call(app);
    for(let i=0;i<24;i++){
        app.enter();Progress.Preview.methods.pointerMove.call(app,{clientX:50,clientY:50,target:inside});
        assert.equal(app.dismissed,true,'Stationary layout events must not reopen a dismissed preview');
    }
    Progress.Preview.methods.pointerMove.call(app,{clientX:75,clientY:50,target:inside});assert.equal(app.dismissed,true,'Movement within the anchor is not a fresh hover');
    Progress.Preview.methods.pointerMove.call(app,{clientX:150,clientY:50,target:outside});assert.equal(app.dismissed,true);
    app.enter();assert.equal(app.dismissed,true,'The enter event alone still cannot reopen it');
    Progress.Preview.methods.pointerMove.call(app,{clientX:75,clientY:50,target:inside});assert.equal(app.dismissed,false,'Actual departure and re-entry opens the preview');
});

test('focus restored by Escape preserves dismissal while a later deliberate keyboard visit can reopen',()=>{
    const inside={},outside={},app={focused:false,dismissed:true,_restoringFocus:true,$el:{contains:target=>target===inside},$refs:{}};
    Progress.Preview.methods.focusIn.call(app,{relatedTarget:outside});assert.equal(app.dismissed,true);
    app._restoringFocus=false;Progress.Preview.methods.focusIn.call(app,{relatedTarget:inside});assert.equal(app.dismissed,true);
    Progress.Preview.methods.focusIn.call(app,{relatedTarget:outside});assert.equal(app.dismissed,false);assert.equal(app.focused,true);
});
