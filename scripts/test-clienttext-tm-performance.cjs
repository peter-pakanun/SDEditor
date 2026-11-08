'use strict';
// Pure, disposable bulk lookup benchmark. No browser/profile/API writes.
const assert=require('node:assert/strict'),{performance}=require('node:perf_hooks');
const A=require('../public/contentAdapters.js'),{unit,fieldId}=require('./clienttext-storage-fixture.cjs');
let heartbeat;

(async()=>{
    const count=200000,queries=1000,original=unit('Existing text 0','');
    const rows=Array.from({length:count},(_,index)=>({id:'bulk-'+index,source:'Existing text '+index,
        target:'Translated text '+index,gameScope:'poe2',revision:1,localRevision:1,
        context:{contentMode:'clienttext',fieldKind:'text',role:'normal',sheet:original.sheet,recordId:'record-'+index,fieldId}}));
    let inputReads=0,pauses=0,ticks=0,lastYield=performance.now(),largestSlice=0;
    const input=new Proxy(rows,{get(target,name,receiver){if(typeof name==='string'&&/^\d+$/.test(name))inputReads++;return Reflect.get(target,name,receiver);}});
    const controller=new AbortController();
    heartbeat=setInterval(()=>ticks++,1);const start=performance.now();
    const session=await A.clienttext.prepareMemoryBatch(input,{game:'poe2',threshold:60,signal:controller.signal,sliceMs:4,yield:async()=>{
        const now=performance.now();largestSlice=Math.max(largestSlice,now-lastYield);pauses++;
        await new Promise(resolve=>setImmediate(resolve));lastYield=performance.now();
    }});
    const buildMs=performance.now()-start,capturedReads=inputReads,beforePauses=pauses,beforeTicks=ticks,queryStart=performance.now();
    for(let index=0;index<queries;index++){
        const position=index*173%count,field={...original.fields[0],source:rows[position].source};
        const result=await session.find({...original,recordId:'record-'+position},field);
        assert.equal(result.matches.length,1);assert.equal(result.score,101);assert.equal(result.ambiguous,false);
        assert.equal(result.matches[0].id,'bulk-'+position);assert.equal(result.matches[0].target,rows[position].target);
    }
    const queryMs=performance.now()-queryStart;
    assert.equal(inputReads,capturedReads,'queries never re-read or revalidate the original corpus');
    assert.ok(pauses>beforePauses&&ticks>beforeTicks,'a long sequence of fast exact lookups yields to other work');
    const fuzzyStart=performance.now(),beforeFuzzyTicks=ticks;
    const fuzzy=await session.find(original,{...original.fields[0],source:'Existing text 19999x'});
    const fuzzyMs=performance.now()-fuzzyStart;
    assert.ok(fuzzy.matches.length>0&&fuzzy.matches[0].kind==='fuzzy');
    assert.ok(ticks>beforeFuzzyTicks,'a full-library fuzzy traversal yields to other work');
    setTimeout(()=>controller.abort(),1);
    const cancelStart=performance.now();
    await assert.rejects(session.find(original,{...original.fields[0],source:'Existing text 12345x'}),error=>error.name==='AbortError');
    const cancelMs=performance.now()-cancelStart;
    assert.equal(inputReads,capturedReads,'fuzzy and cancelled queries also reuse the captured corpus');
    session.dispose();clearInterval(heartbeat);
    console.log(JSON.stringify({ok:true,units:count,uniqueSources:count,queries,buildMs:Math.round(buildMs),queryMs:Math.round(queryMs),
        meanQueryMs:Math.round(queryMs/queries*1000)/1000,cooperativeYields:pauses,largestObservedSliceMs:Math.round(largestSlice),
        fuzzyMs:Math.round(fuzzyMs),cancelMs:Math.round(cancelMs),inputReadsDuringQueries:inputReads-capturedReads},null,2));
})().catch(error=>{clearInterval(heartbeat);console.error(error);process.exitCode=1;});
