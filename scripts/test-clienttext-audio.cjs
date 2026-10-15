const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const Audio=require('../public/clientTextAudio.js');
const first='4.0/NPC/Part1/Act1/Una/Una_01A.ogg';
const second='4.0/NPC/Tujen/Tujen_A4_Intro_SkippedAlvaRog_01=StrDex4.ogg';
const unit=(audio=first,sheet='NPCTextAudio')=>({id:'una',sheet,metadata:{'Audio File':audio}});
function harness(changes={}){
    const calls={play:0,pause:0,load:0,removed:[]};
    const player={play:async()=>{calls.play++;},pause:()=>calls.pause++,load:()=>calls.load++,removeAttribute:name=>calls.removed.push(name)};
    const window={CloudUI:{apiBase:()=> 'https://api.example.test'}};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/clientTextAudio.js'),'utf8'),{window});
    const component=window.ClientTextAudio.component,host={ctActive:true,ctEditor:true,ctCurrentUnit:unit(),ctWorkspace:{scope:{accountId:'alice',game:'poe2',language:'Thai',groupId:'v1'}},...changes};
    const app={...component.data(),host,surface:'both',$refs:{player:[player]},$nextTick:async()=>{}};
    for(const[name,method]of Object.entries(component.methods))app[name]=method.bind(app);
    for(const[name,get]of Object.entries(component.computed))Object.defineProperty(app,name,{get:()=>get.call(app)});
    return {app,component,calls,player,window};
}

test('audio references accept real workbook paths, prefix, equals filenames, and multiple unique clips',()=>{
    assert.equal(Audio.normalizeReference(' Audio/Dialogue/'+first+' '),first.toLowerCase());
    assert.equal(Audio.normalizeReference(second),second.toLowerCase());
    assert.equal(Audio.normalizeReference('4.0/NPC/Test/One_clip.wav'),'4.0/npc/test/one_clip.wav');
    const clips=Audio.clipsFor(unit(first+', '+second+', '+first.toLowerCase()));
    assert.equal(clips.length,2);assert.equal(clips[0].label,'Una_01A.ogg');assert.equal(clips[1].path,second.toLowerCase());
    for(const sheet of ['NPCTextAudio','NPCTalkDialogueTextAudio','NPCTextAudio_Gender','NPCTalkDialogueTextAudio_Gender'])assert.equal(Audio.clipsFor(unit(first,sheet)).length,1);
    assert.deepEqual(Audio.clipsFor(unit(first,'ClientStrings')),[]);
});

test('untrusted workbook audio cannot create arbitrary URLs or traversal requests',()=>{
    for(const value of ['https://evil.test/a.ogg','//evil.test/a.ogg','/a.ogg','../a.ogg','4.0/../a.ogg','4.0/./a.ogg','4.0//a.ogg','4.0/a\\b.ogg','4.0/a.ogg?q=x','4.0/a.ogg#x','4.0/a%2f.ogg','4.0/a.mp3','4.0/a\n.ogg','4.0/ a.ogg','4.0/One clip.ogg','4.0/'+ 'a'.repeat(1024)+'.ogg'])assert.equal(Audio.normalizeReference(value),null,value);
    assert.deepEqual(Audio.clipsFor(unit('https://evil.test/a.ogg, '+first)).map(clip=>clip.path),[first.toLowerCase()]);
});

test('opening and selecting records stays network silent; explicit play uses the shared API resolver without credentials',async()=>{
    const h=harness();
    assert.equal(h.app.request,null);assert.equal(h.calls.play,0);assert.equal(h.app.clips.length,1);
    await h.app.play();
    assert.equal(h.calls.play,1);assert.equal(h.app.request.url,'https://api.example.test/audio/poe2db?path='+encodeURIComponent(first.toLowerCase()));
    assert.equal(h.app.request.url.includes('token'),false);
    assert.match(h.component.template,/controls preload="none"/);
    h.app.host.ctCurrentUnit=unit(second);
    h.component.watch.contextKey.handler.call(h.app);
    assert.equal(h.app.request,null);assert.equal(h.calls.pause,2);assert.equal(h.app.error,'');
});

test('scope, record, hidden surface and unmount cancel playback and ignore stale events',async()=>{
    for(const change of [app=>app.host.ctCurrentUnit=unit(second),app=>app.host.cloudProfileId='bob',app=>app.host.gameVersion='poe1',app=>app.host.ctWorkspace.scope.language='French']){
        const h=harness();await h.app.play();const request=h.app.request;change(h.app);
        h.component.watch.contextKey.handler.call(h.app);h.app.failed({currentTarget:h.player},request);
        assert.equal(h.app.request,null);assert.equal(h.app.error,'');assert.equal(h.calls.pause,2);
    }
    const h=harness();await h.app.play();const request=h.app.request;
    h.app.host.ctEditor=false;h.component.watch.visible.handler.call(h.app,false);
    h.app.failed({currentTarget:h.player},request);assert.equal(h.app.error,'');assert.equal(h.app.request,null);
    h.component.beforeUnmount.call(h.app);assert.equal(h.app._disposed,true);
    assert.ok(h.calls.removed.every(name=>name==='src'));
});

test('navigation during mount does not start the former record, and a stale failure does not replace the current clip',async()=>{
    const h=harness();h.app.$nextTick=async()=>{h.app.host.cloudProfileId='bob';};await h.app.play();assert.equal(h.calls.play,0);
    h.app.$nextTick=async()=>{};await h.app.play();const old=h.app.request;
    h.app.failed({currentTarget:h.player},old);assert.match(h.app.error,/unavailable/);
    await h.app.play();assert.equal(h.app.error,'');h.app.failed({currentTarget:h.player},old);assert.equal(h.app.error,'');
    h.app.failed({currentTarget:h.player},h.app.request);assert.match(h.app.error,/unavailable/);
    h.app.ready({currentTarget:h.player},h.app.request);assert.equal(h.app.error,'');
});

test('changing the selected clip stops it and waits for another explicit play',async()=>{
    const h=harness({ctCurrentUnit:unit(first+', '+second)});await h.app.play();
    h.app.choose({target:{value:'1'}});assert.equal(h.app.selectedClip.path,second.toLowerCase());assert.equal(h.app.request,null);assert.equal(h.calls.play,1);
    await h.app.play();assert.equal(h.calls.play,2);assert.ok(h.app.request.url.endsWith(encodeURIComponent(second.toLowerCase())));
});

test('API URL follows the existing loopback-only cloud API override policy',()=>{
    const source=fs.readFileSync(path.join(__dirname,'../public/cloudUi.js'),'utf8');
    const resolve=(hostname,search)=>{
        const window={};vm.runInNewContext(source,{window,location:{hostname,search},URL,URLSearchParams});return window.CloudUI.apiBase();
    };
    assert.equal(resolve('127.0.0.1','?cloudApi=http%3A%2F%2F127.0.0.1%3A4444'),'http://127.0.0.1:4444');
    assert.equal(resolve('localhost','?cloudApi=https%3A%2F%2Fevil.test'),'https://sdeditor-api.poemaid.com');
    assert.equal(resolve('sdeditor.example','?cloudApi=http%3A%2F%2F127.0.0.1%3A4444'),'https://sdeditor-api.poemaid.com');
});
