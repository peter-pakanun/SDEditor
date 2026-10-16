const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const Audio=require('../public/clientTextAudio.js');
const first='4.0/NPC/Part1/Act1/Una/Una_01A.ogg';
const second='4.0/NPC/Tujen/Tujen_A4_Intro_SkippedAlvaRog_01=StrDex4.ogg';
const unit=(audio=first,sheet='NPCTextAudio')=>({id:'una',sheet,metadata:{'Audio File':audio}});
function harness(changes={},environment={}){
    const calls={play:0,pause:0,load:0,removed:[],hidden:0,media:[],leases:[],released:[]};
    const player={play:async()=>{assert.match(app.request.url,/^blob:/,'native playback only receives an authenticated Blob URL');calls.play++;},pause:()=>calls.pause++,load:()=>calls.load++,removeAttribute:name=>calls.removed.push(name)};
    const window={CloudUI:{apiBase:()=> 'https://api.example.test'},AbortController,setTimeout,clearTimeout,...environment};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/clientTextAudio.js'),'utf8'),{window});
    const component=window.ClientTextAudio.component,host={ctActive:true,ctEditor:true,ctCurrentUnit:unit(),ctWorkspace:{scope:{accountId:'alice',game:'poe2',language:'Thai',groupId:'v1'}},hideTooltip:()=>calls.hidden++,
        privateMediaAllowed:true,privateMediaKey:'alice:translator:Thai:access1',
        privateMediaLoad:async(path,kind,options)=>{
            calls.media.push({path,kind,options});
            let released=false;
            const lease={url:'blob:audio-'+calls.leases.length,release(){if(!released){released=true;calls.released.push(lease.url);}}};
            calls.leases.push(lease);return lease;
        },...changes};
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

test('NullFile directories are excluded from playback without using text markers or changing metadata',()=>{
    const placeholders=['NullFile/Null_3s.ogg','Audio/Dialogue/NullFile/Null_3s.ogg','4.0/NULLFILE/Other.wav'];
    for(const sheet of ['NPCTextAudio','NPCTalkDialogueTextAudio','NPCTextAudio_Gender','NPCTalkDialogueTextAudio_Gender']){
        for(const reference of placeholders)assert.deepEqual(Audio.clipsFor(unit(reference,sheet)),[]);
    }
    const record=unit(placeholders[0]+', '+first+', '+placeholders[2]+', '+second);
    record.fields=[{id:'Text',source:'[NOAUDIO] Dialogue still has a valid recording.'}];
    const original=structuredClone(record);
    assert.deepEqual(Audio.clipsFor(record).map(clip=>clip.path),[first.toLowerCase(),second.toLowerCase()]);
    assert.deepEqual(record,original,'filtering playback choices preserves workbook references and authored text');
    const similar=['4.0/NPC/NullFileActor/Speech.ogg','4.0/NPC/NullFile.ogg'];
    assert.deepEqual(Audio.clipsFor(unit(similar.join(', '))).map(clip=>clip.path),similar.map(path=>path.toLowerCase()),
        'only the exact directory name denotes a placeholder');
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

test('filtering NullFile tracks preserves leading, middle and trailing dialogue slots',()=>{
    const silent='NullFile/Null_3s.ogg',extra='4.0/NPC/Extra.ogg';
    const cases=[
        {references:[silent,first,second],blocks:3,expected:[[],[0],[1]]},
        {references:[first,silent,second],blocks:3,expected:[[0],[],[1]]},
        {references:[first,second,silent],blocks:3,expected:[[0],[1],[]]},
        {references:[silent,silent,first,silent,second],blocks:5,expected:[[],[],[0],[],[1]]},
        {references:[first,silent,second,extra],blocks:3,expected:[[0],[],[1,2]]},
        {references:[silent,first,second],blocks:1,expected:[[0,1]]},
        {references:[silent,first],blocks:3,expected:[[],[0],[]]},
        {references:[silent,silent],blocks:2,expected:[[],[]]},
    ];
    for(const {references,blocks,expected} of cases){
        const segments=Array.from({length:blocks},(_,index)=>[{type:'text',text:'Block '+index},
            ...(index < blocks-1 ? [{type:'continue'}] : [])]).flat();
        const snapshot=structuredClone(segments),record=unit(references.join(', ')),clips=Audio.clipsFor(record),assigned=[[]];
        for(const segment of Audio.previewSegments(segments,clips)){
            if(segment.type==='continue')assigned.push([]);
            else if(segment.type==='playback')assigned.at(-1).push(...segment.tracks);
        }
        assert.deepEqual(assigned,expected,references.join(', '));
        assert.deepEqual(clips.map(clip=>clip.referenceIndex),references.flatMap((reference,index)=>reference===silent?[]:[index]));
        assert.deepEqual(segments,snapshot,'track placement never rewrites preview text');
    }
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
    assert.deepEqual(h.calls.released,[],'unmounting presentation controls must retain the shared playing lease');
    await field.session.play(0);assert.equal(h.app.request,null);assert.equal(preview.session.trackState(0),'idle');
    assert.deepEqual(h.calls.released,[request.url],'explicit stop releases shared media exactly once');
    h.app.host.ctInlineClosed=true;
    await h.app.play(0);assert.ok(h.app.request,'preview-only playback works after the inline fields close');
});

test('opening and selecting records stay network silent; explicit play uses authenticated media and a Blob URL',async()=>{
    let fetched=0;const h=harness({}, {fetch:async()=>{fetched++;return {ok:true};}});
    assert.equal(h.app.request,null);assert.equal(h.calls.play,0);assert.equal(h.app.clips.length,1);
    await h.app.play();
    assert.equal(h.calls.play,1);assert.equal(h.app.request.url,'blob:audio-0');
    assert.equal(h.calls.media.length,1);assert.equal(h.calls.media[0].path,'/audio/poe2db?path='+encodeURIComponent(first.toLowerCase()));
    assert.equal(h.calls.media[0].kind,'audio');assert.ok(h.calls.media[0].options.signal instanceof AbortSignal);
    assert.equal(h.app.request.url.includes('token'),false);
    assert.equal(h.app.playbackState,'loading');assert.equal(fetched,0);
    assert.match(h.component.template,/controls preload="none"/);
    h.app.host.ctCurrentUnit=unit(second);
    h.component.watch.contextKey.handler.call(h.app);
    assert.equal(h.app.request,null);assert.equal(h.calls.pause,2);assert.equal(h.app.error,'');
    assert.deepEqual(h.calls.released,['blob:audio-0']);assert.equal(h.calls.media[0].options.signal.aborted,true);
    assert.equal(fetched,0);
});

test('scope, record, hidden surface and unmount cancel playback and ignore stale events',async()=>{
    for(const change of [app=>app.host.ctCurrentUnit=unit(second),app=>app.host.cloudProfileId='bob',app=>app.host.gameVersion='poe1',app=>app.host.ctWorkspace.scope.language='French',app=>app.host.privateMediaKey='alice:translator:Thai:access2']){
        const h=harness();await h.app.play();const request=h.app.request;change(h.app);
        assert.equal(h.calls.play,1);assert.ok(request,'each fixture has active authenticated playback before switching');
        h.component.watch.contextKey.handler.call(h.app);h.app.failed({currentTarget:h.player},request);
        assert.equal(h.app.request,null);assert.equal(h.app.error,'');assert.equal(h.calls.pause,2);
        assert.deepEqual(h.calls.released,[request.url]);assert.equal(h.calls.media[0].options.signal.aborted,true);
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
    assert.equal(h.calls.media.at(-1).path,'/audio/poe2db?path='+encodeURIComponent(second.toLowerCase()));
    assert.equal(h.app.request.url,'blob:audio-1');assert.deepEqual(h.calls.released,[old.url]);
    const current=h.app.request;
    for(const event of ['playing','waiting','stalled','paused','ended','failed'])h.app[event]({currentTarget:h.player},old);
    assert.equal(h.app.request,current);assert.equal(h.app.playbackState,'loading');
    h.app.playing({currentTarget:h.player},current);assert.equal(h.app.trackState(1),'playing');assert.equal(h.app.trackState(0),'idle');
});

test('authenticated fetch failures retain HTTP details per track until retry without anonymous probes',async()=>{
    let fetched=0;
    const h=harness({ctCurrentUnit:unit(first+', '+second)},{fetch:async()=>{fetched++;throw new Error('Anonymous probes are forbidden');}});
    const successfulLoad=h.app.host.privateMediaLoad;
    h.app.host.privateMediaLoad=async(...args)=>{if(args[0].endsWith(encodeURIComponent(first.toLowerCase())))throw Object.assign(new Error('Not found'),{status:404});return successfulLoad(...args);};
    const before=h.calls.pause;await h.app.play(0);
    assert.equal(h.app.playbackState,'error');assert.equal(h.app.trackState(0),'error');
    assert.ok(h.calls.pause>before,'errors stop native playback before hiding its controls');
    assert.match(h.app.trackTooltip(h.app.clips[0],0),/HTTP 404.*Click to retry/);
    assert.equal(h.calls.play,0,'failed authenticated downloads never reach the native player');assert.equal(fetched,0);
    await h.app.play(1);assert.equal(h.app.trackState(0),'error');assert.equal(h.app.trackState(1),'loading');
    h.app.host.privateMediaLoad=successfulLoad;
    await h.app.play(0);assert.equal(h.app.trackState(0),'loading');assert.equal(h.app.error,'');
    assert.equal(fetched,0,'retry playback uses only the authenticated loader');
    h.app.reset();
});

test('stale authenticated fetch failures and play promise failures are fenced after context changes',async()=>{
    let finish,signal;
    const h=harness({privateMediaLoad:(_path,_kind,options)=>{signal=options.signal;return new Promise((_resolve,reject)=>{finish=reject;});}});
    const failure=h.app.play();
    assert.equal(signal.aborted,false);h.app.host.cloudProfileId='bob';h.component.watch.contextKey.handler.call(h.app);
    assert.equal(signal.aborted,true);finish(Object.assign(new Error('Not found'),{status:404}));await failure;
    assert.equal(h.app.request,null);assert.equal(h.app.error,'');assert.deepEqual(Object.keys(h.app.trackErrors),[]);
    let rejectPlay,started;const playStarted=new Promise(resolve=>{started=resolve;});
    h.app.host.privateMediaLoad=async()=>({url:'blob:retry',release(){}});
    h.player.play=()=>new Promise((_resolve,reject)=>{rejectPlay=reject;started();});
    const pending=h.app.play();await playStarted;h.app.reset();rejectPlay(new Error('late failure'));await pending;
    assert.equal(h.app.playbackState,'idle');assert.equal(h.app.error,'');
});

test('native decode detail needs no HTTP probe and browser playback rejection remains retryable',async()=>{
    let fetched=0;const h=harness({}, {fetch:async()=>{fetched++;throw new TypeError('CORS');}});
    await h.app.play();h.player.error={code:3};await h.app.failed({currentTarget:h.player},h.app.request);
    assert.match(h.app.error,/decoded/);assert.match(h.app.trackTooltip(h.app.clips[0],0),/Click to retry/);
    h.player.play=async()=>{throw Object.assign(new Error('blocked'),{name:'NotAllowedError'});};
    await h.app.play();assert.equal(h.app.playbackState,'error');assert.match(h.app.error,/blocked by the browser/);
    assert.equal(fetched,0,'native decoder errors must not issue unauthenticated HEAD requests');
    h.app.reset();
});

test('signed-out or denied access never loads media or passes a direct API URL to the player',async()=>{
    let fetched=0;const h=harness({privateMediaAllowed:false},{fetch:async()=>{fetched++;}});
    const snapshot=structuredClone(h.app.host.ctCurrentUnit);
    await h.app.play();
    assert.equal(h.calls.media.length,0);assert.equal(h.calls.play,0);assert.equal(fetched,0);
    assert.equal(h.app.request,null);assert.equal(h.app.playbackState,'error');assert.match(h.app.error,/unavailable/);
    assert.deepEqual(h.app.host.ctCurrentUnit,snapshot,'authorization failure does not modify workbook data');
});

test('a download completing after an access change is released and cannot start former-account playback',async()=>{
    let finish,signal,released=0;
    const h=harness({privateMediaLoad:(_path,_kind,options)=>{signal=options.signal;return new Promise(resolve=>{finish=resolve;});}});
    const pending=h.app.play();assert.equal(h.app.playbackState,'loading');assert.equal(h.calls.play,0);
    const previous=h.app.contextKey;
    h.app.host.privateMediaAllowed=false;h.app.host.privateMediaKey='signed-out';
    assert.notEqual(h.app.contextKey,previous,'access revision participates in the media scope');
    h.component.watch.contextKey.handler.call(h.app);
    assert.equal(signal.aborted,true);finish({url:'blob:former-account',release(){released++;}});await pending;
    assert.equal(released,1);assert.equal(h.calls.play,0);assert.equal(h.app.request,null);
    assert.equal(h.app.playbackState,'idle');assert.equal(h.app.error,'');
});

test('unmount cancels a pending download and releases a late lease without retaining a controller',async()=>{
    let finish,signal,released=0;
    const h=harness({privateMediaLoad:(_path,_kind,options)=>{signal=options.signal;return new Promise(resolve=>{finish=resolve;});}});
    h.app.host.ctAudioController=h.app;
    const pending=h.app.play();h.component.beforeUnmount.call(h.app);
    assert.equal(signal.aborted,true);assert.equal(h.app._mediaAbort,null);assert.equal(h.app.host.ctAudioController,null);
    finish({url:'blob:unmounted',release(){released++;}});await pending;
    assert.equal(released,1);assert.equal(h.calls.play,0);assert.equal(h.app._mediaLease,null);assert.equal(h.app.request,null);
});

test('native pause retains the local seekable Blob until end or reset releases it exactly once',async()=>{
    const h=harness();await h.app.play();const request=h.app.request;
    h.app.playing({currentTarget:h.player},request);await h.app.paused({currentTarget:h.player},request);
    assert.deepEqual(h.calls.released,[]);assert.equal(h.calls.media.length,1);
    await h.app.play();assert.equal(h.calls.media.length,1,'native resume reuses its already authorized local media');
    h.app.playing({currentTarget:h.player},request);h.app.ended({currentTarget:h.player},request);
    h.app.reset();h.component.beforeUnmount.call(h.app);
    assert.deepEqual(h.calls.released,[request.url]);assert.equal(h.app._mediaLease,null);
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
