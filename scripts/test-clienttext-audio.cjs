const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const Audio=require('../public/clientTextAudio.js');
const first='4.0/NPC/Part1/Act1/Una/Una_01A.ogg';
const second='4.0/NPC/Tujen/Tujen_A4_Intro_SkippedAlvaRog_01=StrDex4.ogg';
const unit=(audio=first,sheet='NPCTextAudio')=>({id:'una',sheet,metadata:{'Audio File':audio}});
function harness(changes={},environment={}){
    const calls={play:0,pause:0,load:0,removed:[],hidden:0};
    const player={play:async()=>{calls.play++;},pause:()=>calls.pause++,load:()=>calls.load++,removeAttribute:name=>calls.removed.push(name)};
    const window={CloudUI:{apiBase:()=> 'https://api.example.test'},AbortController,setTimeout,clearTimeout,...environment};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/clientTextAudio.js'),'utf8'),{window});
    const component=window.ClientTextAudio.component,host={ctActive:true,ctEditor:true,ctCurrentUnit:unit(),ctWorkspace:{scope:{accountId:'alice',game:'poe2',language:'Thai',groupId:'v1'}},hideTooltip:()=>calls.hidden++,...changes};
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

test('preview tracks follow continue blocks, with every surplus track on the last text block',()=>{
    const clips=Array.from({length:4},(_,index)=>({path:index+'.ogg'}));
    const text=value=>({type:'text',text:value}),separator={type:'continue'};
    const source=[text('First'),separator,text('Second')],snapshot=structuredClone(source);
    const parts=Audio.previewSegments(source,clips);
    assert.deepEqual(parts.filter(part=>part.type==='playback').map(part=>part.tracks),[[0],[1,2,3]]);
    assert.deepEqual(source,snapshot,'playback presentation never mutates source text or segments');
    assert.equal(parts[0],source[0]);assert.equal(parts[2],separator);
    assert.deepEqual(Audio.previewSegments([text('One block')],clips).at(-1).tracks,[0,1,2,3]);
    assert.deepEqual(Audio.previewSegments([text('A'),separator,text('B'),separator,text('C')],clips.slice(0,1))
        .filter(part=>part.type==='playback').map(part=>part.tracks),[[0]]);
    assert.equal(Audio.previewSegments(source,[]),source);
});

test('empty continue blocks and trailing newlines do not move controls away from the spoken text',()=>{
    const styled={type:'text',text:'Spoken',decorStyle:{color:'red'}},separator={type:'continue'},newline={type:'break'};
    const parts=Audio.previewSegments([separator,styled,newline,separator,{type:'text',text:' '}],[{},{}]);
    assert.deepEqual(parts.filter(part=>part.type==='playback').map(part=>part.tracks),[[0,1]]);
    assert.equal(parts[1],styled);assert.equal(parts[2].type,'playback');assert.equal(parts[3],newline);
    assert.deepEqual(Audio.previewSegments([],[{}]),[{type:'playback',tracks:[0]}]);
});

test('field and preview controls use the same session and unmounting one view keeps playback alive',async()=>{
    const h=harness();h.app.host.ctAudioController=h.app;
    const controls=h.window.ClientTextAudio.controlsComponent;
    const view=indices=>{
        const value={host:h.app.host,indices};
        for(const[name,get]of Object.entries(controls.computed))Object.defineProperty(value,name,{get:()=>get.call(value)});
        controls.watch.session.handler.call(value,h.app);
        return value;
    };
    const field=view(null),preview=view([0]);
    assert.equal(field.session,preview.session);assert.equal(preview.tracks[0].clip.path,first.toLowerCase());
    await preview.session.play(0);const request=h.app.request;
    assert.equal(field.session.trackState(0),'loading');
    await h.app.playing({currentTarget:h.player},request);assert.equal(preview.session.trackState(0),'playing');
    controls.beforeUnmount.call(preview);assert.equal(field.session.trackState(0),'playing');assert.equal(h.calls.play,1);
    await field.session.play(0);assert.equal(h.app.request,null);assert.equal(preview.session.trackState(0),'idle');
    h.app.host.ctInlineClosed=true;
    await h.app.play(0);assert.ok(h.app.request,'preview-only playback works after the inline fields close');
});

test('opening and selecting records stays network silent; explicit play uses the shared API resolver without credentials',async()=>{
    let fetched=0;const h=harness({}, {fetch:async()=>{fetched++;return {ok:true};}});
    assert.equal(h.app.request,null);assert.equal(h.calls.play,0);assert.equal(h.app.clips.length,1);
    await h.app.play();
    assert.equal(h.calls.play,1);assert.equal(h.app.request.url,'https://api.example.test/audio/poe2db?path='+encodeURIComponent(first.toLowerCase()));
    assert.equal(h.app.request.url.includes('token'),false);
    assert.equal(h.app.playbackState,'loading');assert.equal(fetched,0);
    assert.match(h.component.template,/controls preload="none"/);
    h.app.host.ctCurrentUnit=unit(second);
    h.component.watch.contextKey.handler.call(h.app);
    assert.equal(h.app.request,null);assert.equal(h.calls.pause,2);assert.equal(h.app.error,'');
    assert.equal(fetched,0);
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

test('navigation during mount does not start the former record, and stale failures cannot replace the current clip',async()=>{
    const h=harness();h.app.$nextTick=async()=>{h.app.host.cloudProfileId='bob';};await h.app.play();assert.equal(h.calls.play,0);
    h.component.watch.contextKey.handler.call(h.app);h.app.$nextTick=async()=>{};await h.app.play();const old=h.app.request;
    await h.app.failed({currentTarget:h.player},old);assert.match(h.app.error,/unavailable/);
    await h.app.play();assert.equal(h.app.error,'');h.app.failed({currentTarget:h.player},old);assert.equal(h.app.error,'');
    h.app.playing({currentTarget:h.player},h.app.request);assert.equal(h.app.error,'');
});

test('one icon per track toggles play and stop, with loading and native playback event states',async()=>{
    const h=harness({ctCurrentUnit:unit(first+', '+second)});
    assert.equal(h.app.trackTooltip(h.app.clips[0],0),'Play Una_01A.ogg');
    await h.app.play(0);const request=h.app.request;
    assert.equal(h.app.trackState(0),'loading');assert.equal(h.app.trackState(1),'idle');
    assert.equal(h.app.trackTooltip(h.app.clips[0],0),'Loading Una_01A.ogg');
    await h.app.play(0);assert.equal(h.calls.play,1,'loading track cannot be clicked again');
    h.app.playing({currentTarget:h.player},request);
    assert.equal(h.app.trackState(0),'playing');assert.equal(h.app.trackTooltip(h.app.clips[0],0),'Stop Una_01A.ogg');
    h.player.readyState=4;h.player.paused=false;h.app.stalled({currentTarget:h.player},request);
    assert.equal(h.app.playbackState,'playing','stalled downloads do not hide controls while buffered audio is playing');
    h.app.waiting({currentTarget:h.player},request);assert.equal(h.app.playbackState,'loading');
    assert.equal(h.app.trackTooltip(h.app.clips[0],0),'Buffering Una_01A.ogg');
    h.app.playing({currentTarget:h.player},request);
    h.app.paused({currentTarget:h.player},request);assert.equal(h.app.playbackState,'idle');
    await h.app.play(0);assert.equal(h.calls.play,2);assert.equal(h.app.request,request,'native pause resumes the same media');
    h.app.playing({currentTarget:h.player},request);await h.app.play(0);
    assert.equal(h.app.request,null);assert.equal(h.app.playbackState,'idle');
    await h.app.play(0);h.app.playing({currentTarget:h.player},h.app.request);h.app.ended({currentTarget:h.player},h.app.request);
    assert.equal(h.app.request,null);assert.equal(h.app.playbackState,'idle');
});

test('switching tracks stops the previous clip, and its late media events cannot affect the current one',async()=>{
    const h=harness({ctCurrentUnit:unit(first+', '+second)});await h.app.play();
    const old=h.app.request;h.app.playing({currentTarget:h.player},old);
    await h.app.play(1);assert.equal(h.app.selectedClip.path,second.toLowerCase());assert.equal(h.calls.play,2);
    assert.ok(h.app.request.url.endsWith(encodeURIComponent(second.toLowerCase())));
    const current=h.app.request;
    for(const event of ['playing','waiting','stalled','paused','ended','failed'])h.app[event]({currentTarget:h.player},old);
    assert.equal(h.app.request,current);assert.equal(h.app.playbackState,'loading');
    h.app.playing({currentTarget:h.player},current);assert.equal(h.app.trackState(1),'playing');assert.equal(h.app.trackState(0),'idle');
});

test('native failures obtain bounded HTTP details only after failure and retain each track error until retry',async()=>{
    const requests=[];
    const h=harness({ctCurrentUnit:unit(first+', '+second)},{fetch:async(url,options)=>{requests.push({url,options});return {ok:false,status:404};}});
    await h.app.play(0);assert.equal(requests.length,0);
    h.player.error={code:4};const before=h.calls.pause;await h.app.failed({currentTarget:h.player},h.app.request);
    assert.equal(h.app.playbackState,'error');assert.equal(h.app.trackState(0),'error');
    assert.ok(h.calls.pause>before,'errors stop native playback before hiding its controls');
    assert.match(h.app.trackTooltip(h.app.clips[0],0),/HTTP 404.*Click to retry/);
    assert.equal(requests.length,1);assert.equal(requests[0].options.method,'HEAD');assert.equal(requests[0].options.credentials,'omit');
    await h.app.play(1);assert.equal(h.app.trackState(0),'error');assert.equal(h.app.trackState(1),'loading');
    await h.app.play(0);assert.equal(h.app.trackState(0),'loading');assert.equal(h.app.error,'');
    assert.equal(requests.length,1,'retry playback does not preflight');
    h.app.reset();
});

test('stale HTTP diagnostics and play promise failures are fenced after context changes',async()=>{
    let finish,signal;
    const h=harness({}, {fetch:(_url,options)=>{signal=options.signal;return new Promise(resolve=>{finish=resolve;});}});
    await h.app.play();const request=h.app.request;
    const failure=h.app.failed({currentTarget:h.player},request);
    assert.equal(signal.aborted,false);h.app.host.cloudProfileId='bob';h.component.watch.contextKey.handler.call(h.app);
    assert.equal(signal.aborted,true);finish({ok:false,status:404});await failure;
    assert.equal(h.app.request,null);assert.equal(h.app.error,'');assert.deepEqual(Object.keys(h.app.trackErrors),[]);
    let rejectPlay,started;const playStarted=new Promise(resolve=>{started=resolve;});
    h.player.play=()=>new Promise((_resolve,reject)=>{rejectPlay=reject;started();});
    const pending=h.app.play();await playStarted;h.app.reset();rejectPlay(new Error('late failure'));await pending;
    assert.equal(h.app.playbackState,'idle');assert.equal(h.app.error,'');
});

test('HEAD failure preserves native decode detail and playback rejection remains retryable',async()=>{
    const h=harness({}, {fetch:async()=>{throw new TypeError('CORS');}});
    await h.app.play();h.player.error={code:3};await h.app.failed({currentTarget:h.player},h.app.request);
    assert.match(h.app.error,/decoded/);assert.match(h.app.trackTooltip(h.app.clips[0],0),/Click to retry/);
    h.player.play=async()=>{throw Object.assign(new Error('blocked'),{name:'NotAllowedError'});};
    await h.app.play();assert.equal(h.app.playbackState,'error');assert.match(h.app.error,/blocked by the browser/);
});

test('visible footer measurement follows resize observers and removes observers/listeners on unmount',()=>{
    let height=78,resize,disconnected=0,removed=0;
    const hidden={getBoundingClientRect:()=>({height:0})},footer={getBoundingClientRect:()=>({height})};
    const h=harness({}, {document:{querySelectorAll:()=>[hidden,footer]},ResizeObserver:class{constructor(callback){resize=callback;}observe(element){assert.equal(element,footer);}disconnect(){disconnected++;}},addEventListener:(name)=>assert.equal(name,'resize'),removeEventListener:(name)=>{assert.equal(name,'resize');removed++;}});
    h.component.mounted.call(h.app);assert.equal(h.app.footerHeight,78);
    height=112;resize();assert.equal(h.app.footerHeight,112);
    h.component.beforeUnmount.call(h.app);assert.equal(disconnected,1);assert.equal(removed,1);
});

test('loading keeps row focus on the wrapper and restores it only while the same track still owns focus',async()=>{
    const document={activeElement:null,querySelectorAll:()=>[]},h=harness({}, {document});
    const wrapper={focus(){document.activeElement=this;}},button={closest:()=>wrapper,focus(){document.activeElement=this;},get disabled(){return h.app.playbackState==='loading';}};
    document.activeElement=button;
    await h.app.play(0,{currentTarget:button});
    assert.equal(document.activeElement,wrapper,'focus leaves the button before disabling it');
    const request=h.app.request;await h.app.playing({currentTarget:h.player},request);
    assert.equal(document.activeElement,button);
    h.app.waiting({currentTarget:h.player},request);document.activeElement=button;
    h.app.paused({currentTarget:h.player},request);document.activeElement=button;
    await h.app.play(0,{currentTarget:button});document.activeElement={id:'elsewhere'};
    await h.app.playing({currentTarget:h.player},request);
    assert.equal(document.activeElement.id,'elsewhere','completion does not steal focus after the user moves');
    h.app.reset();
});

test('native pause, errors and track end return focus before hidden controls could close the inline editor',async()=>{
    const document={activeElement:null,querySelectorAll:()=>[]},h=harness({}, {document});
    const wrapper={focus(){document.activeElement=this;}},button={closest:()=>wrapper,focus(){document.activeElement=this;},get disabled(){return h.app.playbackState==='loading';}};
    h.app.$el={querySelectorAll:()=>[button]};
    await h.app.play();let request=h.app.request;h.app.playing({currentTarget:h.player},request);
    document.activeElement=h.player;const paused=h.app.paused({currentTarget:h.player},request);
    assert.equal(document.activeElement,wrapper,'native pause moves focus into the row before hiding');
    await paused;assert.equal(document.activeElement,button);
    await h.app.play();h.app.playing({currentTarget:h.player},request);
    document.activeElement=h.player;const failed=h.app.setFailure(request,'Audio failed.');
    assert.equal(document.activeElement,wrapper);await failed;assert.equal(document.activeElement,button);
    await h.app.play();request=h.app.request;h.app.playing({currentTarget:h.player},request);
    document.activeElement=h.player;h.app.ended({currentTarget:h.player},request);
    assert.equal(document.activeElement,button);assert.equal(h.app.request,null);
    await h.app.play(0,{currentTarget:button});document.activeElement={id:'new-record'};h.app.reset(true);
    h.app.playing({currentTarget:h.player},request);await h.app.$nextTick();await h.app.$nextTick();
    assert.equal(document.activeElement.id,'new-record','navigation reset does not return focus to the former record');
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
