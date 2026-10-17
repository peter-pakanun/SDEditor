'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const Progress=require('../public/clientTextMtlProgress.js');

test('inline progress uses escaped read-only text and a skeleton without a dialog or another button',()=>{
    const text='<img src=x onerror=alert(1)> Translation {0}\nNext';
    assert.equal(Progress.Overlay.computed.text.call({state:{text}}),text);
    assert.equal(Progress.Overlay.computed.text.call({state:{text:null}}),'');
    assert.match(Progress.Overlay.template,/v-if="!text" class="ctMtlSkeleton"/);
    assert.match(Progress.Overlay.template,/\{\{ text \}\}/);assert.match(Progress.Overlay.template,/aria-readonly="true"/);
    assert.match(Progress.Overlay.template,/not yet validated/);assert.match(Progress.Overlay.template,/role="status" aria-live="polite"/);
    assert.doesNotMatch(Progress.Overlay.template,/v-html|v-model|data-ct-target|<button|dialog|teleport|Live/);
});

test('removing a focused provisional region restores the original field without scrolling or stealing focus',()=>{
    const previous=global.document;let owned=true,focuses=0;
    global.document={activeElement:{}};
    try{
        const app={$el:{contains:()=>owned,parentElement:{querySelector:selector=>{assert.equal(selector,'[data-ct-target]');return{focus:options=>{assert.deepEqual(options,{preventScroll:true});focuses++;}};}}}};
        Progress.Overlay.beforeUnmount.call(app);assert.equal(focuses,1);
        owned=false;Progress.Overlay.beforeUnmount.call(app);assert.equal(focuses,1);
    }finally{global.document=previous;}
});

test('all transport phases have short neutral accessible labels and reduced motion disables skeleton animation',()=>{
    for(const phase of ['waiting','receiving','validating','reconnecting','cancelling'])assert.equal(typeof Progress.labels[phase],'string');
    const css=require('node:fs').readFileSync(require('node:path').join(__dirname,'../public/client-text.css'),'utf8');
    assert.match(css,/@media \(prefers-reduced-motion:reduce\)\s*\{\.ctMtlSkeleton i \{animation:none/);
    assert.doesNotMatch(css,/ctMtlProgressPopup|ctMtlLiveButton/);
});
