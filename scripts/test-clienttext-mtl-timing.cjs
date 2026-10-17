'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const T=require('../public/clientTextMtlTiming.js');

test('browser timings use monotonic offsets and stop at completion while frame-ready observations may follow',()=>{
    let now=500;const timing=T.create({now:()=>now});now=505;timing.mark('toneNotesStart');now=525;timing.mark('toneNotesEnd');
    now=550;timing.mark('firstProgress');now=560;timing.finish();now=576;timing.mark('firstTextFrameReady');timing.mark('finalFrameReady');
    const value=timing.snapshot();assert.equal(value.durationsMs.toneNotesMs,20);assert.equal(value.durationsMs.totalMs,60);
    assert.equal(value.milestonesMs.firstTextFrameReady,76);assert.equal(value.milestonesMs.contextEnd,null);
    assert.equal(timing.mark('postStart'),false);value.milestonesMs.click=999;assert.equal(timing.snapshot().milestonesMs.click,0);
    assert.equal(timing.mark('authorization'),false);
});

test('failure and cancellation never gain a late text frame or fabricated completion milestones',()=>{
    for(const outcome of ['failed','cancelled','stale','recovery']){
        let now=0;const timing=T.create({now:()=>now});now=12;timing.finish(outcome);now=40;
        assert.equal(timing.mark('firstTextFrameReady'),false);assert.equal(timing.snapshot().outcome,outcome);
        assert.equal(timing.snapshot().milestonesMs.candidateReceived,null);assert.equal(timing.snapshot().durationsMs.totalMs,12);
        assert.equal(timing.mark('finalFrameReady'),['failed','cancelled'].includes(outcome));
    }
});

test('numeric timing projection rejects opaque fields, invalid clocks, malformed versions and unbounded values',()=>{
    assert.equal(T.create({now:()=>NaN}),null);assert.equal(T.create({now:()=>{throw Error('Synthetic clock unavailable');}}),null);
    let now=0;const timing=T.create({now:()=>now,onChange(){throw Error('Synthetic broken observer');}});
    now=20;assert.doesNotThrow(()=>timing.mark('contextStart'));now=600001;assert.equal(timing.mark('contextEnd'),false);
    assert.equal(T.sanitize({version:'future',domain:'browser'},'browser'),null);
    const projected=T.sanitize({version:T.VERSION,domain:'browser',origin:'secret',outcome:'secret',milestonesMs:{click:0,postStart:Infinity,postEnd:-1,contextEnd:'secret',firstProgress:600001,token:'secret'},durationsMs:{totalMs:20,secret:'opaque'}},'browser');
    assert.equal(projected.origin,'unavailable');assert.equal(projected.outcome,'unavailable');assert.equal(projected.milestonesMs.postStart,null);
    assert.doesNotMatch(JSON.stringify(projected),/secret|opaque|Infinity/);assert.equal(T.format(null),'Unavailable');assert.equal(T.format(0),'0.0 ms');
});

test('API and browser rows correlate by request ID and never subtract offsets from different clock domains',()=>{
    const browser=T.create({now:()=>1000}).snapshot();browser.milestonesMs.firstProgress=900;
    const api={version:T.VERSION,domain:'api-process',origin:'request-handler-entry',outcome:'completed',milestonesMs:{providerRequest:20,providerFirstTranslation:45},durationsMs:{}};
    const record={requestId:'synthetic',browserTiming:browser,server:{requestId:'synthetic',timing:api}};
    const groups=T.groups(record),provider=groups.find(value=>value.title==='Observed provider wait');
    assert.equal(provider.rows.find(value=>value.key==='providerFirstTranslation').value,25);
    assert.equal(groups.find(value=>value.title==='Browser milestones').rows[0].value,900);
    assert.match(provider.description,/queue and reasoning durations cannot be distinguished/);
    record.server.requestId='another';assert.ok(T.groups(record).find(value=>value.title==='Observed provider wait').rows.every(value=>value.value===null));
    assert.ok(T.groups({}).every(group=>group.rows.every(row=>row.value===null)));
});
