/* Explicit shared tone-note edits; drafts, examples and retry bodies never mix. */
(function(root,factory){
    const api=factory(root,typeof module==='object'&&module.exports?require('./clientTextToneNotes.js'):root.ClientTextToneNotes);
    if(typeof module==='object'&&module.exports)module.exports=api;else root.ClientTextToneNotesUI=api;
})(typeof window!=='undefined'?window:globalThis,function(root,N){
    'use strict';
    const copy=value=>JSON.parse(JSON.stringify(value)),own=(value,key)=>Object.prototype.hasOwnProperty.call(value||{},key);
    const access=host=>JSON.stringify([host.cloudSignedIn,host.cloudProfileId,host.cloudUser?.id,host.cloudUser?.role,host.cloudUser?.language,
        host.cloudUser?.assignmentVersion,host.cloudUser?.isAdmin,host._cloud?.epoch,host.privateMediaEpoch]);
    const allowed=(host,scope=host.ctWorkspace?.scope)=>!!host.ctActive&&host.cloudSignedIn===true&&!!host._cloud&&!host._cloud.destroyed
        &&String(host.cloudUser?.id)===String(scope?.accountId)&&String(host.cloudProfileId)===String(scope?.accountId)
        &&host.lang===scope?.language&&(host.cloudUser?.role==='manager'||host.cloudUser?.role==='admin'&&host.cloudUser.isAdmin===true||host.cloudUser?.role==='translator'&&host.cloudUser.language===scope.language);
    function accessIssue(host){
        if(allowed(host))return '';
        const scope=host.ctWorkspace?.scope,user=host.cloudUser;
        if(!host.ctActive||!scope)return 'Open a ClientText workspace to edit shared tone notes.';
        if(host.cloudSignedIn!==true||!host._cloud||host._cloud.destroyed)return 'Sign in with access to this language to read or edit shared tone notes.';
        if(String(user?.id)!==String(scope.accountId)||String(host.cloudProfileId)!==String(scope.accountId))
            return 'This workbook is open under another account or a guest profile. Reopen it under your signed-in account to edit shared tone notes.';
        if(host.lang!==scope.language){
            const test=String(scope.groupId||'').startsWith('local:test:');
            return `Workbook language: ${scope.language}. Selected language: ${host.lang||'not selected'}. Choose ${scope.language} in Settings before reopening ${test?'this test':'this workbook'} to edit shared tone notes.${test?' Changing language closes the current test.':''}`;
        }
        return user?.role==='translator'?'Shared tone notes are available only in your assigned language. Select that language or ask an administrator to check your assignment.'
            :'This account does not have permission to edit shared tone notes. Ask an administrator to check your role.';
    }
    function loadError(error){
        const status=Number(error?.status||error?.statusCode),code=error?.code;
        const reason=code==='BRANCH_NOT_FOUND'?'This workbook branch is unavailable on the server. Reopen an available branch or ask an administrator to check it.'
            :status===401?'Your session expired. Sign in again, then reopen Tone notes.'
            :status===403?'The server denied access to shared tone notes. Check your selected language and account assignment, or ask an administrator to check your access.'
            :[404,501].includes(status)?'Shared tone notes need a server update. Ask an administrator to update the API, then retry loading.'
            :status===400?'The server rejected the tone-note identity or workspace scope. Reopen this workbook; if it persists, ask an administrator to check frontend/API compatibility.'
            :status===429?'Shared tone-note requests are temporarily limited. Wait briefly, then retry loading.'
            :status>=500?'The shared tone-note service is unavailable. Retry loading when the server is available.'
            :error?.name==='AbortError'?'The shared tone-note request timed out or was interrupted. Retry loading.'
            :error instanceof TypeError&&/^Invalid shared tone-note response\.|^Tone-note response is unavailable\.|^Shared tone-note response identifies another scope\./.test(error.message)
                ?'The server returned an incompatible shared tone-note response. Ask an administrator to check frontend/API compatibility, then retry loading.'
                :'Shared tone notes could not be loaded. Check your connection, then retry loading.';
        return reason+' Your draft is unchanged.';
    }
    const offline=()=>root.navigator?.onLine===false;
    const scopeKey=scope=>JSON.stringify([scope.accountId,scope.game,scope.branchId,scope.language]);
    function endpoint(scope,key,history=false,cursor=''){
        const query=new URLSearchParams({...N.scope(scope),identityKey:key,...(cursor?{cursor}:{})});
        return '/v1/mtl/tone-notes/'+(history?'history':'latest')+'?'+query;
    }
    function note(input,scope,key){
        if(input===null)return{identityKey:key,text:'',revision:0};
        if(!input||input.identityKey!==key||!N.validText(input.text)||!Number.isSafeInteger(input.revision)||input.revision<0
            ||input.revision===0&&input.text!==''||['game','branchId','language'].some(name=>own(input,name)&&input[name]!==scope[name])
            ||input.scope&&['game','branchId','language'].some(name=>input.scope[name]!==scope[name]))throw new TypeError('Invalid shared tone-note response.');
        const author=input.author||input.updatedBy||input.actor;
        const timestamp=input.updatedAt??input.createdAt;
        return{identityKey:key,text:input.text,revision:input.revision,
            ...(typeof timestamp==='string'||Number.isSafeInteger(timestamp)?{updatedAt:timestamp}:{}),
            ...(author&&typeof author.name==='string'?{author:{name:author.name.slice(0,256)}}:{})};
    }
    function responseScope(response,scope){if(!response?.scope||['game','branchId','language'].some(key=>response.scope[key]!==scope[key]))throw new TypeError('Shared tone-note response identifies another scope.');}
    function fresh(){return{saved:null,draft:'',baseRevision:0,loaded:false,loading:false,saving:false,loadError:'',saveError:'',conflict:null,pending:null,
        verified:false,history:[],historyOpen:false,historyLoaded:false,historyLoading:false,historyError:'',nextCursor:''};}
    const mixin={
        data(){return{ctToneWindow:null,ctToneRecords:{},ctToneRevision:0,ctToneOffline:offline()};},
        computed:{
            ctToneAllowed(){return allowed(this);},
            ctToneState(){
                const value=this.ctToneCurrent,issue=accessIssue(this);if(issue)return issue;
                if(this.ctToneError(value))return this.ctToneError(value);
                if(value?.saving)return 'Saving shared note…';
                if(value?.pending)return 'The previous save is awaiting confirmation. Retry Save note before editing again.';
                if(!value?.loaded)return value?.loading?'Loading shared note…':'The shared note has not been loaded. Retry loading to enable editing.';
                return '';
            },
            ctToneFenceKey(){return JSON.stringify([this.ctActive,this.ctWorkspace?.scope,this.ctSelection,this.lang,this.gameVersion,this.branchId,access(this)]);},
            ctToneIdentities(){
                this.ctRevision;const units=this.ctUnits,unit=this.ctCurrentUnit,workspace=this.ctWorkspace,cache=this._ctToneIdentityCache;
                if(cache&&cache.units===units&&cache.unit===unit&&cache.workspace===workspace&&cache.game===workspace?.scope?.game&&cache.length===units?.length
                    &&cache.npc===this._ctNpcIndex&&cache.convo===this._ctConvoIndex)return cache.entries;
                const entries=N.participants(this);this._ctToneIdentityCache={units,unit,workspace,game:workspace?.scope?.game,length:units?.length,npc:this._ctNpcIndex,convo:this._ctConvoIndex,entries};return entries;
            },
            ctToneWarning(){const scope=this.ctWorkspace?.scope;return !!scope&&this.ctToneIdentities.some(entry=>{
                const value=this.ctToneRecords[scopeKey(scope)+':'+entry.key];return value&&(this.ctToneError(value)||value.conflict||value.pending);
            });},
            ctToneCurrent(){this.ctToneRevision;return this.ctToneWindow?this.ctToneRecord(this.ctToneWindow.identityKey):null;},
            ctTonePlaceholder(){return N.placeholder(this.ctWorkspace?.scope?.language||this.lang);},
            ctToneCount(){return N.count(this.ctToneCurrent?.draft||'');},
            ctToneCanSave(){const value=this.ctToneCurrent;return this.ctToneAllowed&&!this.ctToneOffline&&!offline()&&value?.loaded&&!value.loading&&!value.saving
                &&N.validText(value.draft)&&!value.conflict&&(!!value.pending||N.normalize(value.draft)!==(value.saved?.text||''));}
        },
        watch:{ctToneFenceKey:{flush:'sync',handler(){
            const owner=String(this.cloudUser?.id||'');this.ctToneReset(!this.cloudSignedIn||owner!==this._ctToneOwner);this._ctToneOwner=owner;
        }}},
        mounted(){
            this._ctToneOwner=String(this.cloudUser?.id||'');this.ctToneOffline=offline();this._ctToneOnline=()=>{this.ctToneOffline=false;if(this.ctToneWindow&&this.ctToneAllowed)this.ctToneLoad(this.ctToneWindow.identityKey);};
            this._ctToneOffline=()=>{this.ctToneOffline=true;for(const value of Object.values(this.ctToneRecords))value.verified=false;
                const value=this.ctToneCurrent;if(value)value.loadError='Shared tone notes are unavailable offline. Your draft remains in this tab.';};
            this._ctToneTick=()=>{const value=this.ctToneCurrent;if(this.ctToneWindow&&this.ctToneAllowed&&!root.document?.hidden&&!offline()&&!value?.saving&&!value?.pending)this.ctToneLoad(this.ctToneWindow.identityKey);};
            this._ctToneTimer=setInterval(this._ctToneTick,20000);this._ctToneTimer?.unref?.();
            root.addEventListener?.('online',this._ctToneOnline);root.addEventListener?.('offline',this._ctToneOffline);root.document?.addEventListener?.('visibilitychange',this._ctToneTick);
        },
        beforeUnmount(){this.ctToneReset(true);clearInterval(this._ctToneTimer);root.removeEventListener?.('online',this._ctToneOnline);root.removeEventListener?.('offline',this._ctToneOffline);root.document?.removeEventListener?.('visibilitychange',this._ctToneTick);},
        methods:{
            ctToneCapture(){
                const ctx=this.ctContext(),client=this._cloud,key=access(this),fence=this.ctToneFenceKey;
                return{ctx,scope:copy(ctx.scope),client,current:()=>this.ctActive&&this.ctCurrent(ctx)&&client===this._cloud&&key===access(this)&&fence===this.ctToneFenceKey&&allowed(this,ctx.scope)};
            },
            ctToneRecord(identityKey,scope=this.ctWorkspace?.scope){
                if(!N.identity(identityKey)||!scope)return null;
                const key=scopeKey(scope)+':'+identityKey;
                if(!this.ctToneRecords[key])this.ctToneRecords={...this.ctToneRecords,[key]:fresh()};
                return this.ctToneRecords[key];
            },
            ctToneReset(clear=false){
                for(const run of this._ctToneRuns?.values()||[])run.controller.abort();this._ctToneRuns=new Map();
                for(const value of Object.values(this.ctToneRecords)){value.loading=false;value.saving=false;value.historyLoading=false;value.verified=false;}
                this.ctToneClose(false);if(clear)this.ctToneRecords={};this.ctToneRevision++;
            },
            ctToneClose(restore=true){
                this.ctToneWindow=null;const focus=this._ctToneReturnFocus;this._ctToneReturnFocus=null;
                if(restore)this.$nextTick?.(()=>{if(focus?.isConnected)focus.focus({preventScroll:true});});
            },
            async ctToneOpen(identityKey=this.ctToneIdentities[0]?.key,event){
                if(!this.ctToneIdentities.some(value=>value.key===identityKey))return false;
                if(!this.ctToneWindow)this._ctToneReturnFocus=event?.currentTarget||root.document?.activeElement;
                this.ctToneWindow={identityKey};this.ctToneRecord(identityKey);
                await this.$nextTick?.();this.$refs?.ctToneDialog?.focusEditor?.();
                return this.ctToneAllowed?this.ctToneLoad(identityKey):false;
            },
            ctToneSelect(event){this.ctToneOpen(event.target.value);},
            ctToneEdited(text){const value=this.ctToneCurrent;if(!value||value.saving||value.pending)return;value.draft=String(text);this.ctToneRevision++;},
            ctToneError(value=this.ctToneCurrent){return value?.saveError||value?.loadError||'';},
            ctTonePublish(value,next){
                if(value.saved&&next.revision<value.saved.revision)throw new Error('Shared tone-note revision moved backwards.');
                const dirty=value.loaded&&N.normalize(value.draft)!==(value.saved?.text||'');
                value.saved=next;value.loaded=true;value.verified=true;
                if(!dirty&&!value.pending){value.draft=next.text;value.baseRevision=next.revision;value.conflict=null;}
                else if(!value.pending&&next.revision!==value.baseRevision)value.conflict=next;
                this.ctToneRevision++;
            },
            async ctToneLoad(identityKey,options={}){
                const capture=this.ctToneCapture(),value=this.ctToneRecord(identityKey,capture.scope);if(!value||!capture.current())return false;
                if(value.loading)return this._ctToneRuns?.get('read:'+scopeKey(capture.scope)+identityKey)?.promise||false;
                if(offline()){value.verified=false;value.loadError='Shared tone notes are unavailable offline. Your draft remains in this tab.';return false;}
                const key='read:'+scopeKey(capture.scope)+identityKey,run={controller:new AbortController()},runs=this._ctToneRuns ||=new Map();runs.set(key,run);value.loading=true;
                const operation=(async()=>{
                    try{
                        const response=await capture.client.request(endpoint(capture.scope,identityKey),{signal:run.controller.signal});
                        if(!capture.current()||run.controller.signal.aborted)return false;
                        responseScope(response,capture.scope);
                        if(!own(response,'note'))throw new TypeError('Tone-note response is unavailable.');
                        this.ctTonePublish(value,note(response.note,capture.scope,identityKey));value.loadError='';return true;
                    }catch(error){if(capture.current()&&!run.controller.signal.aborted){value.verified=false;value.loadError=loadError(error);}return false;}
                    finally{if(runs.get(key)===run){runs.delete(key);if(this._ctToneRuns===runs)value.loading=false;}}
                })();run.promise=operation;return operation;
            },
            async ctToneNotesPrepare(identityKeys,ctx=this.ctContext()){
                const keys=[...new Set(identityKeys||[])].filter(value=>N.identity(value)).slice(0,2);
                if(!this.ctCurrent(ctx)||!allowed(this,ctx.scope))return this.ctToneNotesSnapshot([]);
                const results=await Promise.all(keys.map(key=>this.ctToneLoad(key)));
                if(!this.ctCurrent(ctx))return{status:'unavailable',entries:[]};
                if(results.some(value=>!value))throw Object.assign(new Error('Shared tone notes could not be checked. Open Tone notes to resolve the warning, then request translation again.'),{code:'MTL_TONE_NOTES_UNAVAILABLE'});
                if(keys.some(key=>{const value=this.ctToneRecord(key,ctx.scope);return value.conflict||value.pending;}))
                    throw Object.assign(new Error('Resolve the shared tone-note conflict or pending Save before requesting translation again.'),{code:'MTL_TONE_NOTES_UNAVAILABLE'});
                return this.ctToneNotesSnapshot(keys);
            },
            ctToneNotesSnapshot(identityKeys){
                const scope=this.ctWorkspace?.scope||{},keys=identityKeys||N.roleKeys(this),notes=[];
                if(allowed(this,scope)&&!offline())for(const key of [...new Set(keys)].slice(0,2)){
                    const value=this.ctToneRecords[scopeKey(scope)+':'+key];
                    if(value?.loaded&&value.verified&&!value.conflict&&!value.pending&&value.saved?.revision>0)notes.push({...copy(value.saved),game:scope.game,branchId:scope.branchId,language:scope.language,saved:true});
                }
                return{status:allowed(this,scope)&&!offline()?'ready':'unavailable',accountId:scope.accountId,scope:{game:scope.game,branchId:scope.branchId,language:scope.language},entries:notes};
            },
            async ctToneSave(){
                const identityKey=this.ctToneWindow?.identityKey,value=this.ctToneCurrent,capture=this.ctToneCapture();
                if(offline()){if(value)value.saveError='Shared tone notes cannot be saved while offline. Your draft is unchanged.';return false;}
                if(!this.ctToneCanSave||!capture.current())return false;
                value.pending ||= {scope:N.scope(capture.scope),identityKey,mutationId:root.crypto.randomUUID(),baseRevision:value.baseRevision,text:N.normalize(value.draft)};
                const body=copy(value.pending),key='save:'+scopeKey(capture.scope)+identityKey,run={controller:new AbortController()},runs=this._ctToneRuns ||=new Map();
                this.$refs?.ctToneDialog?.focusSave?.();runs.set(key,run);value.saving=true;
                try{
                    const response=await capture.client.request('/v1/mtl/tone-notes',{method:'PUT',body,signal:run.controller.signal});
                    if(!capture.current()||run.controller.signal.aborted)return false;
                    responseScope(response,capture.scope);
                    const saved=note(response?.note,capture.scope,identityKey);
                    if(!Number.isSafeInteger(response.appliedRevision)||response.appliedRevision<=body.baseRevision||saved.revision<response.appliedRevision
                        ||response.mutationId&&response.mutationId!==body.mutationId||saved.revision===response.appliedRevision&&saved.text!==body.text)
                        throw new TypeError('Tone-note save receipt does not match this edit.');
                    value.pending=null;value.saved=saved;value.draft=body.text;value.baseRevision=saved.revision;value.loaded=true;value.verified=true;
                    value.conflict=saved.text===body.text?null:saved;value.saveError=value.conflict?'Your edit was saved, then the shared note changed. Compare the latest note before saving again.':'';value.loadError='';value.historyLoaded=false;
                    if(value.historyOpen)this.ctToneLoadHistory(identityKey);this.ctToneRevision++;return true;
                }catch(error){
                    if(!capture.current()||run.controller.signal.aborted)return false;
                    const status=error.status||error.statusCode;
                    if(status&&status<500&&![408,429].includes(status)&&(status!==409||error.code==='MTL_TONE_NOTE_CHANGED'))value.pending=null;
                    if(status===409&&error.code==='MTL_TONE_NOTE_CHANGED'){
                        try{const latest=note(error.current||error.details?.current||error.details?.note,capture.scope,identityKey);value.saved=latest;value.conflict=latest;value.verified=true;}catch(_){value.verified=false;}
                        value.saveError='This shared note changed. Compare the latest note with your draft before saving again.';
                    }else value.saveError=value.pending?'The save could not be confirmed. Retry Save to send the exact same edit.':'The tone note was not saved. Your draft is unchanged.';
                    this.ctToneRevision++;return false;
                }finally{if(runs.get(key)===run){runs.delete(key);if(this._ctToneRuns===runs)value.saving=false;}}
            },
            ctToneResolveConflict(keepDraft){
                const value=this.ctToneCurrent;if(!value?.conflict||!this.ctToneAllowed||value.saving)return;
                if(!keepDraft)value.draft=value.conflict.text;value.baseRevision=value.conflict.revision;value.conflict=null;value.saveError='';this.ctToneRevision++;
            },
            ctToneHistoryToggle(event){const value=this.ctToneCurrent;if(!value)return;value.historyOpen=event.currentTarget.open;if(value.historyOpen&&!value.historyLoaded)this.ctToneLoadHistory(this.ctToneWindow.identityKey);},
            async ctToneLoadHistory(identityKey,more=false){
                const capture=this.ctToneCapture(),value=this.ctToneRecord(identityKey,capture.scope);if(!capture.current()||value.historyLoading)return false;
                if(offline()){value.historyError='History is unavailable offline.';return false;}
                const key='history:'+scopeKey(capture.scope)+identityKey,run={controller:new AbortController()},runs=this._ctToneRuns ||=new Map();runs.set(key,run);value.historyLoading=true;
                try{
                    const response=await capture.client.request(endpoint(capture.scope,identityKey,true,more?value.nextCursor:''),{signal:run.controller.signal});
                    if(!capture.current()||run.controller.signal.aborted)return false;
                    responseScope(response,capture.scope);
                    if(response.identityKey!==identityKey||!Array.isArray(response.entries)||response.entries.length>50)throw new TypeError('Invalid tone-note history.');
                    const entries=response.entries.map(input=>note(input,capture.scope,identityKey));
                    if(entries.some((value,index)=>value.revision<1||index&&value.revision>=entries[index-1].revision)
                        ||response.nextCursor!==null&&response.nextCursor!==undefined&&(typeof response.nextCursor!=='string'||!/^[1-9]\d*$/.test(response.nextCursor)))
                        throw new TypeError('Invalid tone-note history order.');
                    value.history=more?[...value.history,...entries.filter(next=>!value.history.some(old=>old.revision===next.revision))]:entries;
                    value.nextCursor=typeof response.nextCursor==='string'?response.nextCursor:'';value.historyLoaded=true;value.historyError='';return true;
                }catch(error){if(capture.current()&&!run.controller.signal.aborted)value.historyError='Tone-note history could not be loaded. Your draft is unchanged.';return false;}
                finally{if(runs.get(key)===run){runs.delete(key);if(this._ctToneRuns===runs)value.historyLoading=false;}}
            },
            ctToneDate(value){const date=new Date(value);return value&&!Number.isNaN(date.getTime())?date.toLocaleString():'';}
        }
    };
    const Button={props:{host:Object},computed:{entries(){return this.host.ctToneIdentities||[];}},
        template:`<button v-if="entries.length" type="button" class="ctToneButton" data-inline-focus-surface @click.stop="host.ctToneOpen(entries[0].key,$event)" @dblclick.stop :title="host.ctToneWarning ? 'Shared tone notes need attention. Open to review.' : 'Edit shared character tone notes'" aria-label="Character tone notes"><span v-if="host.ctToneWarning" class="ctToneWarning" aria-hidden="true">⚠ </span>Tone notes</button>`};
    const Dialog={props:{host:Object},computed:{value(){return this.host.ctToneCurrent;},identity(){return this.host.ctToneIdentities.find(value=>value.key===this.host.ctToneWindow?.identityKey);}},
        watch:{'value.loaded'(loaded){if(loaded&&root.document?.activeElement===this.$refs.close)this.$nextTick(()=>this.focusEditor());}},
        mounted(){this._bodyOverflow=root.document.body.style.overflow;root.document.body.style.overflow='hidden';this.$nextTick(()=>this.focusEditor());},
        beforeUnmount(){root.document.body.style.overflow=this._bodyOverflow||'';},
        methods:{focusEditor(){(this.$refs.text?.disabled?this.$refs.close:this.$refs.text)?.focus({preventScroll:true});},
            focusSave(){if(this.$refs.dialog?.contains(root.document?.activeElement))this.$refs.save?.focus({preventScroll:true});},trap(event){
            const controls=[...this.$refs.dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary,[tabindex="0"]')].filter(value=>value.getClientRects().length);
            const first=controls[0],last=controls.at(-1);if(event.shiftKey&&root.document.activeElement===first){event.preventDefault();last?.focus();}
            else if(!event.shiftKey&&root.document.activeElement===last){event.preventDefault();first?.focus();}
        },keydown(event){
            if(event.isComposing||event.keyCode===229)return;
            if(event.key==='Tab')this.trap(event);
            else if(event.key==='Escape'){event.preventDefault();this.host.ctToneClose();}
            else if((event.ctrlKey||event.metaKey)&&event.code==='KeyS'&&!event.altKey&&!event.shiftKey){event.preventDefault();this.host.ctToneSave();}
        }},
        template:`<teleport to="body"><div class="appDialogOverlay ctToneBackdrop" data-inline-focus-surface @keydown.stop="keydown" @click.self="host.ctToneClose()">
          <section ref="dialog" class="settingsDialog ctToneDialog" role="dialog" aria-modal="true" aria-labelledby="ct-tone-title" tabindex="-1">
            <header class="settingsHeader"><div><h2 id="ct-tone-title">Character tone notes</h2><p>{{ host.ctWorkspace.scope.language }} · Shared with this language team</p></div><button ref="close" type="button" aria-label="Close tone notes" @click="host.ctToneClose()">Close</button></header>
            <div class="settingsBody settingsPanel">
              <label v-if="host.ctToneIdentities.length>1" class="settingsField">Character<select :value="host.ctToneWindow.identityKey" @change="host.ctToneSelect"><option v-for="entry in host.ctToneIdentities" :key="entry.key" :value="entry.key">{{ entry.name }} · {{ entry.path }}</option></select></label>
              <h3 v-else>{{ identity?.name }}</h3><p class="ctToneIdentity">{{ identity?.path }}</p>
              <p v-if="host.ctToneState" id="ct-tone-state" :role="host.ctToneError(value) || !host.ctToneAllowed ? 'alert' : 'status'">{{ host.ctToneState }}</p>
              <label for="ct-tone-text">Tone and forms of address</label>
              <textarea id="ct-tone-text" ref="text" rows="5" :value="value.draft" @input="host.ctToneEdited($event.target.value)" :placeholder="host.ctTonePlaceholder" :disabled="!host.ctToneAllowed || !value.loaded || value.saving || !!value.pending" :aria-invalid="host.ctToneCount>300 || undefined" aria-describedby="ct-tone-counter ct-tone-help ct-tone-state"></textarea>
              <p id="ct-tone-counter" :class="{ctToneInvalid:host.ctToneCount>300}" aria-live="polite">{{ host.ctToneCount }} / 300 characters</p>
              <p id="ct-tone-help" class="settingsHelp">Saved notes are sent to the translation service when you request MTL. Clearing a saved note creates a history revision. Unsaved edits remain in this tab until sign-out or reload.</p>
              <p v-if="value.saved?.revision">Revision {{ value.saved.revision }} · {{ value.saved.author?.name || 'Contributor' }} · {{ host.ctToneDate(value.saved.updatedAt) }}</p>
              <section v-if="value.conflict" class="ctToneConflict" aria-label="Latest shared note"><strong>Latest shared note · Revision {{ value.conflict.revision }}</strong><pre>{{ value.conflict.text || '(cleared)' }}</pre><button type="button" @click="host.ctToneResolveConflict(false)">Use latest</button><button type="button" @click="host.ctToneResolveConflict(true)">Keep my draft</button></section>
              <details v-if="host.ctToneAllowed" :open="value.historyOpen" @toggle="host.ctToneHistoryToggle"><summary>Revision history</summary><p v-if="value.historyLoading && !value.historyLoaded" role="status">Loading history…</p><p v-if="value.historyError" role="alert">{{ value.historyError }}</p><p v-if="value.historyLoaded && !value.history.length">No revisions yet.</p><ol class="ctToneHistory"><li v-for="entry in value.history" :key="entry.revision"><strong>Revision {{ entry.revision }} · {{ entry.author?.name || 'Contributor' }}</strong><time>{{ host.ctToneDate(entry.updatedAt) }}</time><pre>{{ entry.text || '(cleared)' }}</pre></li></ol><button v-if="value.nextCursor || value.historyError" type="button" :disabled="value.historyLoading" @click="host.ctToneLoadHistory(host.ctToneWindow.identityKey,!!value.nextCursor)">{{ value.nextCursor ? 'Load more' : 'Load history' }}</button></details>
            </div><footer class="settingsFooter"><button v-if="(!value.loaded || value.loadError) && !value.pending && host.ctToneAllowed" type="button" @click="host.ctToneLoad(host.ctToneWindow.identityKey)" :disabled="value.loading || value.saving">Retry loading</button><button ref="save" class="settingsActionPrimary" type="button" :aria-disabled="!host.ctToneCanSave" :aria-busy="value.saving || undefined" @click="host.ctToneSave()">{{ value.saving ? 'Saving…' : value.pending ? 'Retry Save note' : 'Save note' }}</button></footer>
          </section></div></teleport>`
    };
    return{mixin,Button,Dialog,allowed,note,endpoint};
});
