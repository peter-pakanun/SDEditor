/* Private ClientText TM proposals use the same review boundary as MTL. */
(function(root,factory){
    const S=root.ClientTextState || (typeof require==='function'?require('./clientTextState.js'):null);
    const api=factory(root,S);
    if(typeof module==='object'&&module.exports)module.exports=api;else root.ClientTextTmUI=api;
})(typeof window==='object'?window:globalThis,function(root,S){
    'use strict';
    const copy=S.copy,raw=value=>root.Vue?.markRaw?root.Vue.markRaw(value):value;
    const state=()=>root.ClientTextTmState || require('./clientTextTmState.js');
    const adapter=()=>root.ContentAdapters || require('./contentAdapters.js');
    const name=(unitId,fieldId)=>JSON.stringify([unitId,fieldId]);
    const stale=()=>Object.assign(new Error('The workbook or TM review changed. Review the current suggestion.'),{stale:true,name:'AbortError'});
    const changed=error=>error?.stale||error?.name==='AbortError';
    const text=value=>String(value??'');
    const uuid=()=> 'tm-review-'+(root.crypto || globalThis.crypto).randomUUID();
    const access=host=>JSON.stringify([host.cloudProfileId || 'guest',host.lang,host.gameVersion,host.cloudSignedIn,
        host.cloudUser?.id,host.cloudUser?.role,host.cloudUser?.language,host.cloudUser?.assignmentVersion,host.cloudCanAccessAllLanguages]);
    const mixin={
        data(){return{ctTmSelectedIds:raw([]),ctTmCandidates:raw([]),ctTmReviews:{},ctTmRevision:0,
            ctTmBusy:false,ctTmProgress:null,ctTmError:'',ctTmReviewBusy:{},ctTmRecoveries:raw([]),ctTmLoadedScopeKey:''};},
        computed:{
            ctTmWorkspaceScopeKey(){return JSON.stringify([this.ctContext?.(),access(this)]);},
            ctTmSelectedSet(){return new Set(this.ctTmSelectedIds);},
            ctTmSelectedCount(){return this.ctTmSelectedIds.length;},
            ctTmPageSelection(){const rows=this.ctPageRows || [],count=rows.filter(unit=>this.ctTmSelectedSet.has(unit.id)).length;
                return !count?'none':count===rows.length?'all':'some';},
            ctTmCanPrepare(){return !!(this.ctActive&&this.ctWorkspace&&this.ctTmLoadedScopeKey===this.ctTmWorkspaceScopeKey&&this.ctTmSelectedCount&&!this.ctTmBusy&&!this.ctBusy&&!this.ctBrowseBusy&&!this.ctRecoveryBusy&&!this._ctSaveJob);},
            ctTmSelectionScopeKey(){return JSON.stringify([this.ctContext?.(),access(this),this.ctBrowseMode,this.ctSheet,this.ctSheetFilter,
                this.ctAppliedSearch,this.ctSearchCaseSensitive,this.ctFilter,this.ctSelectedFilters,
                this.ctNpcSelection,this.ctNpcKind,this.ctNpcFilter,this.ctConvoSelection,this.ctConvoFilter]);},
            ctTmCandidateIndex(){this.ctTmRevision;const result=new Map();
                for(const candidate of this.ctTmCandidates){if(candidate.status!=='pending')continue;const key=name(candidate.unitId,candidate.fieldId),before=result.get(key);
                    if(!before||candidate.createdAt>before.createdAt||candidate.createdAt===before.createdAt&&candidate.revision>before.revision)result.set(key,candidate);}
                return result;},
            ctTmUnitIds(){this.ctTmRevision;const ids=new Set();if(this.ctTmLoadedScopeKey!==this.ctTmWorkspaceScopeKey)return ids;
                for(const candidate of this.ctTmCandidates)if(candidate.status==='pending'&&this._ctUnitIndex?.has(candidate.unitId))ids.add(candidate.unitId);return ids;},
            ctTmCount(){return this.ctTmUnitIds.size;},
        },
        watch:{ctTmSelectionScopeKey(){this.ctTmClearSelection();this.ctTmStop();},ctTmWorkspaceScopeKey(){
            this.ctTmReset();const ctx=this.ctContext();if(this.ctTmCurrent(ctx))Promise.resolve().then(()=>{if(this.ctTmCurrent(ctx))this.ctTmActivate(ctx);});
        }},
        beforeUnmount(){this.ctTmReset();},
        methods:{
            ctTmCurrent(ctx){return !!this.ctActive&&this.ctCurrent(ctx)&&ctx.scope.accountId===(this.cloudProfileId || 'guest')
                &&ctx.scope.language===this.lang&&ctx.scope.game===this.gameVersion;},
            ctTmStorage(ctx=this.ctContext()){
                const normal=this.ctStorage(ctx.scope);if(normal?.tm)return normal.tm;
                const Store=root.ClientTextTmStore || require('./clientTextTmStore.js');
                return this._ctTmStore ||= raw(Store.create());
            },
            ctTmDescriptor(unit=this.ctCurrentUnit){const descriptor=(this._ctTmDescriptors || this.ctWorkspace?.metadata?.descriptors || []).find(value=>value.role===unit?.role);
                return descriptor?{...descriptor,role:unit.role,unitId:unit.id}:null;},
            ctTmToggleRow(unit,event={}){
                event.stopPropagation?.();if(!unit||this.ctTmBusy)return false;
                const ids=new Set(this.ctTmSelectedIds),checked=typeof event.target?.checked==='boolean'?event.target.checked:!ids.has(unit.id);
                const rows=this.ctRows || [],anchor=rows.findIndex(value=>value.id===this._ctTmSelectionAnchor),end=rows.findIndex(value=>value.id===unit.id);
                const selected=event.shiftKey&&anchor>=0&&end>=0?rows.slice(Math.min(anchor,end),Math.max(anchor,end)+1):[unit];
                for(const item of selected)if(checked)ids.add(item.id);else ids.delete(item.id);
                this._ctTmSelectionAnchor=unit.id;this.ctTmSelectedIds=raw([...ids]);return true;
            },
            ctTmSelectPage(event={}){event.stopPropagation?.();if(this.ctTmBusy)return;
                const ids=new Set(this.ctTmSelectedIds),checked=typeof event.target?.checked==='boolean'?event.target.checked:this.ctTmPageSelection!=='all';
                for(const unit of this.ctPageRows || [])if(checked)ids.add(unit.id);else ids.delete(unit.id);this.ctTmSelectedIds=raw([...ids]);},
            ctTmSelectAllFiltered(){if(!this.ctTmBusy)this.ctTmSelectedIds=raw((this.ctRows || []).map(unit=>unit.id));},
            ctTmClearSelection(){this.ctTmSelectedIds=raw([]);this._ctTmSelectionAnchor=null;},
            ctTmStop(){const run=this._ctTmBatch;if(run){run.stopped=true;run.controller.abort();run.session?.dispose();}},
            ctTmReset(){this.ctTmStop();this._ctTmBatch=null;this._ctTmActivation=null;this._ctTmReviewLoad=null;
                this._ctTmDescriptors=raw([]);this._ctTmClaims={};this._ctTmReviewQueues=new Map();this._ctTmEditVersions=new Map();
                this.ctTmSelectedIds=raw([]);this.ctTmCandidates=raw([]);this.ctTmReviews={};this.ctTmReviewBusy={};
                this.ctTmRecoveries=raw([]);this.ctTmLoadedScopeKey='';this.ctTmBusy=false;this.ctTmProgress=null;this.ctTmError='';this.ctTmRevision++;},
            async ctTmActivate(ctx=this.ctContext()){
                if(!this.ctTmCurrent(ctx))return false;const scopeKey=this.ctTmWorkspaceScopeKey;
                if(this.ctTmLoadedScopeKey&&this.ctTmLoadedScopeKey!==scopeKey)this.ctTmReset();
                const run=this._ctTmActivation={},store=this.ctTmStorage(ctx);
                try{const [candidates,metadata]=await Promise.all([store.list(ctx.scope),this.ctStorage(ctx.scope).getMetadata(ctx.scope)]);
                    if(this._ctTmActivation!==run||!this.ctTmCurrent(ctx)||this.ctTmWorkspaceScopeKey!==scopeKey)return false;
                    this.ctTmLoadedScopeKey=scopeKey;this._ctTmDescriptors=raw(metadata?.descriptors || []);this.ctTmCandidates=raw(candidates || []);this.ctTmRevision++;
                    if(this.ctCurrentUnit)await this.ctTmLoadReviews(this.ctCurrentUnit,ctx);return true;
                }catch(error){if(this.ctTmCurrent(ctx)&&!changed(error))this.ctTmError='TM reviews could not be loaded: '+error.message;return false;}
            },
            async ctTmLoadReviews(unit=this.ctCurrentUnit,ctx=this.ctContext()){
                if(!unit||!this.ctTmCurrent(ctx))return;const run=this._ctTmReviewLoad={},store=this.ctTmStorage(ctx);
                try{const [reviews,recoveries]=await Promise.all([store.listReviews(ctx.scope,unit.id),store.listRecoveries?.(ctx.scope,unit.id) || []]);if(this._ctTmReviewLoad!==run||!this.ctTmCurrent(ctx)||this.ctCurrentUnit!==unit)return;
                    const next={...this.ctTmReviews};for(const review of reviews || []){const key=name(review.unitId,review.fieldId);
                        if(!next[key]?.dirty)next[key]=review;const head=this._ctTmReviewQueues?.get(key);if(head&&!head.pending)head.revision=review.revision;}
                    this.ctTmReviews=next;this.ctTmRecoveries=raw([...this.ctTmRecoveries.filter(value=>value.unitId!==unit.id),...recoveries]);this.ctTmRevision++;
                }catch(error){if(this.ctTmCurrent(ctx)&&!changed(error))this.ctTmError='TM review text could not be loaded: '+error.message;}
            },
            ctTmPendingCandidate(field,unit=this.ctCurrentUnit){return this.ctTmLoadedScopeKey===this.ctTmWorkspaceScopeKey&&unit&&field?this.ctTmCandidateIndex.get(name(unit.id,field.id)) || null:null;},
            ctTmApplicable(candidate,field,unit=this.ctCurrentUnit){return !!unit?.fields.includes(field)&&candidate?.unitId===unit.id&&state().applicable(candidate,field,this.ctTmDescriptor(unit));},
            ctTmReviewFor(candidate){if(!candidate)return null;const existing=this.ctTmReviews[name(candidate.unitId,candidate.fieldId)];
                if(existing?.candidateId===candidate.id)return existing;
                const unique=candidate.matches?.length===1&&!candidate.overflow?candidate.matches[0]:null;
                return{candidateId:candidate.id,candidateRevision:candidate.revision,rawSourceHash:candidate.rawSourceHash,
                    text:unique?.target || '',matchId:candidate.restored?null:unique?.id || null,dirty:false,opened:true,acceptedDraft:false,
                    ...(candidate.restored?{restored:true}:{})};},
            ctTmChosenMatch(candidate,review=this.ctTmReviewFor(candidate)){return candidate?.matches?.find(match=>match.id===review?.matchId) || null;},
            ctTmAccepted(field,unit=this.ctCurrentUnit){const candidate=this.ctTmPendingCandidate(field,unit),review=this.ctTmReviewFor(candidate);
                return !!candidate&&!candidate.restored&&!review?.restored&&!!review?.acceptedDraft&&this.ctTmApplicable(candidate,field,unit)
                    &&!!this._ctTmClaims?.[unit.id]?.some(claim=>claim.candidateId===candidate.id&&claim.fieldId===field.id&&claim.candidateRevision===candidate.revision);},
            ctTmCandidate(field){const candidate=this.ctTmPendingCandidate(field);if(!candidate||!this.ctTmApplicable(candidate,field)||this.ctTmAccepted(field))return null;
                const review=this.ctTmReviewFor(candidate);if(review?.suppressed||review?.opened===false)return null;
                if(text(this.ctValues[field.id]).trim()||!this.ctTmFieldEligible(this.ctCurrentUnit,field,null,{allowOwn:true})
                    ||state().targetHash(text(S.valuesFor(this.ctCurrentUnit,this.ctSaved[this.ctSelection])[field.id]))!==candidate.baseTargetHash)return null;return candidate;},
            ctTmFieldValue(field){const candidate=this.ctTmCandidate(field);return candidate?text(this.ctTmReviewFor(candidate)?.text):text(this.ctValues[field.id]);},
            ctTmLiveMemory(){return this.ctEditorMemory || this.ctMemory || [];},
            ctTmMatchCurrent(match){return !!match&&state().matchCurrent(match,this.ctTmLiveMemory());},
            ctTmFieldEligible(unit,field,draft=null,{allowOwn=false}={}){
                const saved=this.ctSaved[unit.id],values=S.valuesFor(unit,saved),status=S.statusFor(unit,saved,{game:this.gameVersion});
                if(!['text','form'].includes(field.kind)||!text(field.source).trim()||S.audioOnly(field.source)||/\bDNT\b/i.test(field.source)
                    ||text(values[field.id]).trim()||!status.fields[field.id]?.missing||S.englishIntentFor(field,saved,{game:this.gameVersion})
                    ||saved?.syncRecovery||saved?.conflicts?.length||saved?.provenance?.conflicts?.length)return false;
                const typed=unit.id===this.ctSelection?this.ctValues:draft?.values;if(text(typed?.[field.id]).trim())return false;
                if(unit.id===this.ctSelection&&(this.ctChoices?.length||this.ctMtlBusy?.(field)||this.ctMtlAccepted?.(field)||this.ctMtlPendingDismissal?.(field)))return false;
                if(this.ctMtlPendingGeneration?.(field,unit)||this.ctMtlRequests?.[name(unit.id,field.id)])return false;
                if(unit.id===this.ctSelection&&this.ctMtlPendingCandidate?.(field)||this.ctMtlCandidates?.some(value=>value.status==='pending'&&value.unitId===unit.id&&value.fieldId===field.id))return false;
                if(!allowOwn&&this.ctTmPendingCandidate(field,unit))return false;
                return true;
            },
            async ctTmPrepareSelected(){
                if(!this.ctTmCanPrepare)return false;const ctx=this.ctContext(),capturedAccess=access(this),ids=this.ctTmSelectedIds.slice(),controller=new AbortController();
                const run=this._ctTmBatch={ctx,controller,session:null,stopped:false},owns=()=>this._ctTmBatch===run&&this.ctTmCurrent(ctx)&&access(this)===capturedAccess,
                    current=()=>owns()&&!controller.signal.aborted;
                const threshold=Math.max(1,Math.min(99,Number(this.tmThreshold)||60)),memory=this.ctTmLiveMemory().slice();
                this.ctTmBusy=true;this.ctTmError='';this.ctTmProgress={total:ids.length,processed:0,prepared:0,unmatched:0,skipped:0,stopped:false};
                const pending=[];let session;
                const flush=async(stopped=false)=>{if(!pending.length)return;const guard=stopped?owns:current;if(!guard())throw stale();const attempted=pending.splice(0),
                    input=attempted.filter(candidate=>{const unit=this._ctUnitIndex.get(candidate.unitId),field=unit?.fields.find(value=>value.id===candidate.fieldId);
                        return !!field&&this.ctTmFieldEligible(unit,field);});
                    if(!input.length){this.ctTmProgress={...this.ctTmProgress,skipped:this.ctTmProgress.skipped+attempted.length};return;}
                    // Stop cancels further matching, not an already admitted
                    // write of completed proposals. Scope/access still fence it.
                    const accepted=await this.ctTmStorage(ctx).putBatch(ctx.scope,input,{guard:owns});
                    if(!this.ctTmCurrent(ctx)||this._ctTmBatch!==run)return;
                    this.ctTmCandidates=raw([...this.ctTmCandidates,...accepted]);this.ctTmRevision++;this.ctTmProgress={...this.ctTmProgress,
                        prepared:this.ctTmProgress.prepared+accepted.length,skipped:this.ctTmProgress.skipped+attempted.length-accepted.length};};
                try{
                    if(await this.ctFlushDraft?.()===false)return false;if(!current())throw stale();
                    session=run.session=await adapter().clienttext.prepareMemoryBatch(memory,{game:ctx.scope.game,threshold,signal:controller.signal,guard:current,sliceMs:4});
                    for(const id of ids){if(!current())throw stale();const unit=this._ctUnitIndex.get(id);if(!unit){this.ctTmProgress={...this.ctTmProgress,processed:this.ctTmProgress.processed+1,skipped:this.ctTmProgress.skipped+1};continue;}
                        const draft=await this.ctStorage(ctx.scope).getDraft(ctx.scope,id),descriptor=this.ctTmDescriptor(unit);if(!current())throw stale();
                        if(!descriptor)throw new Error('The workbook source identity is unavailable. Reopen this workbook.');
                        for(const field of unit.fields){if(!current())throw stale();
                            if(!this.ctTmFieldEligible(unit,field,draft)){this.ctTmProgress={...this.ctTmProgress,skipped:this.ctTmProgress.skipped+1};continue;}
                            const result=await session.find(unit,field,{limit:100});if(!current())throw stale();
                            if(!result.matches.length){this.ctTmProgress={...this.ctTmProgress,unmatched:this.ctTmProgress.unmatched+1};continue;}
                            if(!this.ctTmFieldEligible(unit,field,draft)){this.ctTmProgress={...this.ctTmProgress,skipped:this.ctTmProgress.skipped+1};continue;}
                            pending.push({id:uuid(),unitId:unit.id,fieldId:field.id,role:unit.role,assetHash:descriptor.assetHash,parserVersion:descriptor.parserVersion,
                                source:field.source,rawSourceHash:state().rawSourceHash(field.source),baseTargetHash:state().targetHash(text(S.valuesFor(unit,this.ctSaved[unit.id])[field.id])),threshold,
                                matches:result.matches.map(match=>({...copy(match.unit),score:match.score,kind:match.kind})),overflow:!!result.overflow,status:'pending',revision:1,createdAt:Date.now()});
                            if(pending.length>=64)await flush();
                        }
                        this.ctTmProgress={...this.ctTmProgress,processed:this.ctTmProgress.processed+1};await new Promise(resolve=>setTimeout(resolve,0));
                    }
                    await flush();return true;
                }catch(error){if(this.ctTmCurrent(ctx)&&this._ctTmBatch===run&&!changed(error))this.ctTmError='TM preparation stopped. Completed suggestions are retained: '+error.message;return false;}
                finally{session?.dispose();if(this._ctTmBatch===run){
                    if(run.stopped&&pending.length&&owns())try{await flush(true);}catch(error){if(owns()&&!changed(error))this.ctTmError='Completed TM suggestions could not be stored: '+error.message;}
                    this.ctTmBusy=false;this.ctTmProgress={...this.ctTmProgress,stopped:run.stopped};this._ctTmBatch=null;}}
            },
            ctTmPersistReview(ctx,unitId,fieldId,review){
                const key=name(unitId,fieldId),queues=this._ctTmReviewQueues ||= new Map(),normal=this.ctStorage(ctx.scope),store=this.ctTmStorage(ctx),
                    localLease=normal.captureLease?.(ctx.scope),admitted=this.ctTmCurrent(ctx),writeOptions={...(localLease?{localLease}:{}),guard:()=>admitted};
                let head=queues.get(key);if(!head){head={revision:this.ctTmReviews[key]?.revision || review.revision || null,pending:0,queue:Promise.resolve(),recoveryId:uuid(),editRevision:0};queues.set(key,head);}
                const snapshot=copy(review),editRevision=++head.editRevision,capturedAccess=access(this),current=()=>this.ctTmCurrent(ctx)&&access(this)===capturedAccess;head.pending++;
                const operation=head.queue.catch(()=>{}).then(async()=>{
                    if(!admitted)throw stale();
                    // Admission captures the full private scope and ownership
                    // lease. A later UI switch cannot retarget or erase typing.
                    const saved=await store.putReview(ctx.scope,unitId,fieldId,snapshot,{...writeOptions,expectedRevision:head.revision});
                    head.revision=saved.revision;head.failed=null;
                    if(this.ctTmCurrent(ctx)&&this.ctTmReviews[key]===review)this.ctTmReviews={...this.ctTmReviews,[key]:{...review,revision:saved.revision}};
                    return saved;
                }).catch(async error=>{
                    head.failed=error;head.recoveryStored=false;
                    if(admitted&&!changed(error)&&store.putRecovery)try{
                        const recovery=await store.putRecovery(ctx.scope,unitId,fieldId,snapshot,{...writeOptions,recoveryId:head.recoveryId,editRevision});
                        head.recoveryStored=true;
                        if(current()){this.ctTmRecoveries=raw([...this.ctTmRecoveries.filter(value=>value.recoveryId!==recovery.recoveryId),recovery]);this.ctTmRevision++;}
                    }catch(recoveryError){if(current())this.ctTmError='TM review could not be stored or retained for recovery. Keep this tab open: '+recoveryError.message;}
                    throw error;
                }).finally(()=>{head.pending--;});head.queue=operation;
                return operation;
            },
            async ctTmFlushReviews(ctx=this.ctContext()){
                if(!this.ctTmCurrent(ctx))return false;const queues=this._ctTmReviewQueues || new Map();let failure;
                // Drain the captured queue, including edits admitted while an
                // earlier write was finishing, before releasing its old lease.
                for(;;){const heads=[...queues.values()],pending=heads.map(head=>head.queue),results=await Promise.allSettled(pending);
                    failure=results.find(result=>result.status==='rejected');
                    if(queues.size===heads.length&&heads.every((head,index)=>!head.pending&&head.queue===pending[index]))break;
                }
                if(failure){if(this.ctTmCurrent(ctx)&&!changed(failure.reason))this.ctTmError='TM review text needs recovery before leaving this record: '+failure.reason.message;return false;}return true;
            },
            ctTmEdited(field,value){const candidate=this.ctTmCandidate(field);if(!candidate)return false;
                const ctx=this.ctContext(),unitId=this.ctSelection,key=name(unitId,field.id),before=this.ctTmReviewFor(candidate),versions=this._ctTmEditVersions ||= new Map();versions.set(key,(versions.get(key)||0)+1);
                const review={...before,text:text(value),dirty:true,opened:true,acceptedDraft:false};this.ctTmReviews={...this.ctTmReviews,[key]:review};this.ctTmRevision++;
                this.ctTmPersistReview(ctx,unitId,field.id,review).catch(error=>{if(this.ctTmCurrent(ctx)&&!changed(error))this.ctTmError='TM review text was not stored: '+error.message;});return true;
            },
            ctTmUnderlyingEdited(field){const key=name(this.ctSelection,field.id),versions=this._ctTmEditVersions ||= new Map();versions.set(key,(versions.get(key)||0)+1);},
            async ctTmChooseMatch(field,matchId){const candidate=this.ctTmPendingCandidate(field),before=this.ctTmReviewFor(candidate),match=candidate?.matches.find(value=>value.id===matchId);
                if(!candidate||!match||this.ctTmAccepted(field)||this.ctBusy||this.ctTmReviewBusy[name(this.ctSelection,field.id)])return false;
                const ctx=this.ctContext(),key=name(this.ctSelection,field.id),review={...before,matchId,text:before.dirty?before.text:match.target,opened:true,acceptedDraft:false};
                const versions=this._ctTmEditVersions ||= new Map();versions.set(key,(versions.get(key)||0)+1);
                this.ctTmReviews={...this.ctTmReviews,[key]:review};this.ctTmRevision++;
                try{await this.ctTmPersistReview(ctx,this.ctSelection,field.id,review);return this.ctTmCurrent(ctx);}catch(error){if(this.ctTmCurrent(ctx)&&!changed(error))this.ctTmError=error.message;return false;}
            },
            async ctTmShow(field){const candidate=this.ctTmPendingCandidate(field);if(!candidate||this.ctBusy)return false;
                const ctx=this.ctContext(),key=name(this.ctSelection,field.id),review={...this.ctTmReviewFor(candidate),opened:true,suppressed:false};this.ctTmReviews={...this.ctTmReviews,[key]:review};this.ctTmRevision++;
                try{await this.ctTmPersistReview(ctx,this.ctSelection,field.id,review);return this.ctTmCurrent(ctx);}catch(error){if(this.ctTmCurrent(ctx)&&!changed(error))this.ctTmError=error.message;return false;}
            },
            async ctTmAccept(field){
                const candidate=this.ctTmCandidate(field),unit=this.ctCurrentUnit,ctx=this.ctContext(),review=this.ctTmReviewFor(candidate),match=this.ctTmChosenMatch(candidate,review);
                if(!candidate||this.ctBusy||this.ctHistoryViewer||this.ctTmReviewBusy[name(unit.id,field.id)]||!this.ctTmFieldEligible(unit,field,null,{allowOwn:true}))return false;
                if(candidate.restored||review.restored){this.ctTmError='This restored suggestion needs a current TM review before accepting. Your edited text is retained.';return false;}
                if(candidate.overflow||!match){this.ctTmError=candidate.overflow?'Too many equally ranked translations. Choose a more specific TM entry manually.':'Choose a TM translation before accepting.';return false;}
                if(review.candidateRevision!==candidate.revision){this.ctTmError='This suggestion was renewed elsewhere. Revalidate it before accepting; your review text is retained.';return false;}
                if(!this.ctTmMatchCurrent(match)){this.ctTmError='The remembered translation changed or was deleted. Revalidate this suggestion; your review text is retained.';return false;}
                const check=state().validate(field,review.text);if(!check.valid){this.ctTmError=check.errors.map(issue=>issue.message).join(' ');return false;}
                const key=name(unit.id,field.id),value=text(this.ctValues[field.id]),capturedAccess=access(this),version=this._ctTmEditVersions?.get(key)||0;
                const current=()=>this.ctTmCurrent(ctx)&&this.ctCurrentUnit===unit&&this.ctTmPendingCandidate(field)?.id===candidate.id&&this.ctTmPendingCandidate(field)?.revision===candidate.revision
                    &&text(this.ctValues[field.id])===value&&this.ctTmFieldValue(field)===review.text&&this.ctTmReviewFor(candidate)?.matchId===match.id
                    &&(this._ctTmEditVersions?.get(key)||0)===version&&access(this)===capturedAccess
                    &&!this.ctBusy&&!this.ctHistoryViewer&&this.ctTmFieldEligible(unit,field,null,{allowOwn:true})&&this.ctTmMatchCurrent(match);
                const accepted={...review,acceptedDraft:true,opened:true,suppressed:false,previousValue:review.previousValue ?? value,
                    previousDraft:review.previousDraft || {values:copy(this.ctValues),reviewed:copy(this.ctReviewed),dirty:!!this.ctDraftDirty}};
                this.ctTmReviewBusy={...this.ctTmReviewBusy,[key]:true};
                try{
                    const stored=await this.ctTmPersistReview(ctx,unit.id,field.id,accepted);if(!current())return false;
                    this.ctTmReviews={...this.ctTmReviews,[key]:{...accepted,revision:stored.revision}};this._ctTmClaims ||= {};
                    this._ctTmClaims[unit.id]=[...(this._ctTmClaims[unit.id] || []).filter(claim=>claim.fieldId!==field.id),state().acceptance(candidate,review.text,match.id)];
                    this.ctValues[field.id]=review.text;this.ctTmRevision++;this.ctEdited(field);this.ctCloseCompletion?.();this.ctTmError='';return true;
                }catch(error){if(this.ctTmCurrent(ctx)&&!changed(error))this.ctTmError=error.message;return false;}
                finally{if(this.ctTmCurrent(ctx)){const next={...this.ctTmReviewBusy};delete next[key];this.ctTmReviewBusy=next;}}
            },
            ctTmAcceptances(unitId=this.ctSelection,values=this.ctValues){
                const unit=this._ctUnitIndex?.get(unitId);if(!unit)return[];
                return(this._ctTmClaims?.[unitId] || []).map(claim=>{const candidate=this.ctTmCandidates.find(value=>value.id===claim.candidateId),field=unit.fields.find(value=>value.id===claim.fieldId);
                    if(!candidate||!this.ctTmApplicable(candidate,field,unit))throw stale();return state().acceptance(candidate,text(values[field.id]),claim.matchId);});
            },
            ctTmCheckpointAcceptances(unitId=this.ctSelection,values=this.ctValues){return(this._ctTmClaims?.[unitId] || []).map(claim=>({...copy(claim),reviewedTextHash:S.hash(text(values[claim.fieldId]))}));},
            ctTmRestoreAcceptances(draft){const unit=this.ctCurrentUnit;if(!unit)return;const claims=draft?.tmAcceptances || [];this._ctTmClaims ||= {};this._ctTmClaims[unit.id]=copy(claims);
                const reviews={...this.ctTmReviews};for(const field of unit.fields){const key=name(unit.id,field.id),review=reviews[key];if(!review)continue;
                    reviews[key]={...review,acceptedDraft:claims.some(claim=>claim.fieldId===field.id&&claim.candidateId===review.candidateId&&claim.candidateRevision===review.candidateRevision
                        &&claim.rawSourceHash===state().rawSourceHash(field.source)&&claim.reviewedTextHash===S.hash(text(this.ctValues[field.id])))};}
                this.ctTmReviews=reviews;this.ctTmRevision++;
            },
            async ctTmUndoAccept(field){const candidate=this.ctTmPendingCandidate(field),unit=this.ctCurrentUnit,ctx=this.ctContext(),key=name(unit?.id,field?.id),before=this.ctTmReviews[key];
                if(!candidate||!this.ctTmAccepted(field)||this.ctBusy||this.ctHistoryViewer||this.ctTmReviewBusy[key]||typeof before?.previousValue!=='string')return false;
                const value=text(this.ctValues[field.id]),version=this._ctTmEditVersions?.get(key)||0,review={...before,text:value,dirty:true,acceptedDraft:false,opened:true,suppressed:false};
                this.ctTmReviewBusy={...this.ctTmReviewBusy,[key]:true};
                try{await this.ctTmPersistReview(ctx,unit.id,field.id,review);
                    if(!this.ctTmCurrent(ctx)||this.ctCurrentUnit!==unit||text(this.ctValues[field.id])!==value||(this._ctTmEditVersions?.get(key)||0)!==version)return false;
                    this._ctTmClaims[unit.id]=(this._ctTmClaims[unit.id] || []).filter(claim=>claim.fieldId!==field.id);
                    this.ctTmReviews={...this.ctTmReviews,[key]:review};this.ctValues[field.id]=before.previousValue;
                    if(Object.hasOwn(before.previousDraft?.reviewed || {},field.id))this.ctReviewed[field.id]=before.previousDraft.reviewed[field.id];else delete this.ctReviewed[field.id];
                    this.ctTmUnderlyingEdited(field);this.ctTmRevision++;this.ctDraftDirty=true;this.ctQueueDraft?.();this.ctCloseCompletion?.();this.ctTmError='';return true;
                }catch(error){if(this.ctTmCurrent(ctx)&&!changed(error))this.ctTmError=error.message;return false;}
                finally{if(this.ctTmCurrent(ctx)){const next={...this.ctTmReviewBusy};delete next[key];this.ctTmReviewBusy=next;}}
            },
            async ctTmDismiss(field){const candidate=this.ctTmPendingCandidate(field),unit=this.ctCurrentUnit,ctx=this.ctContext();if(!candidate||this.ctTmAccepted(field)||this.ctBusy)return false;
                const key=name(unit.id,field.id);try{const head=this._ctTmReviewQueues?.get(key);let failure;await head?.queue.catch(error=>{failure=error;});
                    if(failure&&!head.recoveryStored)throw failure;
                    const updated=await this.ctTmStorage(ctx).dismiss(ctx.scope,candidate,{expectedRevision:candidate.revision,guard:()=>this.ctTmCurrent(ctx)});
                    if(!this.ctTmCurrent(ctx))return false;if(head){head.queue=Promise.resolve();head.failed=null;}
                    this.ctTmCandidates=raw(this.ctTmCandidates.map(value=>value.id===candidate.id?updated:value));this.ctTmRevision++;this.ctTmError='';return true;
                }catch(error){if(this.ctTmCurrent(ctx)&&!changed(error))this.ctTmError=error.message;return false;}
            },
            async ctTmRevalidate(field){
                const candidate=this.ctTmPendingCandidate(field),unit=this.ctCurrentUnit,ctx=this.ctContext(),before=this.ctTmReviewFor(candidate),store=this.ctTmStorage(ctx);
                if(!candidate||this.ctTmAccepted(field)||this.ctBusy||!this.ctTmApplicable(candidate,field)||!this.ctTmFieldEligible(unit,field,null,{allowOwn:true}))return false;
                const key=name(unit.id,field.id),capturedAccess=access(this),editVersion=this._ctTmEditVersions?.get(key)||0,
                    current=()=>this.ctTmCurrent(ctx)&&this.ctCurrentUnit===unit&&access(this)===capturedAccess&&this.ctTmPendingCandidate(field)?.id===candidate.id
                        &&(this._ctTmEditVersions?.get(key)||0)===editVersion;
                this.ctTmReviewBusy={...this.ctTmReviewBusy,[key]:true};let session;
                try{await this._ctTmReviewQueues?.get(key)?.queue;session=await adapter().clienttext.prepareMemoryBatch(this.ctTmLiveMemory().slice(),{game:ctx.scope.game,threshold:candidate.threshold,guard:current,sliceMs:4});
                    const result=await session.find(unit,field,{limit:100});if(!current())return false;
                    if(!result.matches.length){this.ctTmError='No current TM match meets this percentage. Your review text is retained.';return false;}
                    const next={...candidate,revision:candidate.revision+1,matches:result.matches.map(match=>({...copy(match.unit),score:match.score,kind:match.kind})),overflow:!!result.overflow};
                    let revised;if(store.revalidate)revised=await store.revalidate(ctx.scope,next,{expectedRevision:candidate.revision,guard:current});
                    else revised=(await store.putBatch(ctx.scope,[next],{replace:true,expectedRevisions:{[candidate.id]:candidate.revision},guard:current}))[0];
                    if(!current())return false;this.ctTmCandidates=raw(this.ctTmCandidates.map(value=>value.id===candidate.id?revised:value));
                    const stored=await store.getReview(ctx.scope,unit.id,field.id);if(!current())return false;
                    const head=this._ctTmReviewQueues?.get(key);if(head&&!head.pending)head.revision=stored?.revision || null;
                    const match=revised.matches.length===1&&!revised.overflow?revised.matches[0]:null,review={...before,candidateRevision:revised.revision,matchId:match?.id || null,
                        text:before.dirty||before.restored&&this.ctTmReviews[key]?.candidateId===candidate.id?before.text:match?.target || before.text,
                        revision:stored?.revision,opened:true,acceptedDraft:false,restored:false};
                    this.ctTmReviews={...this.ctTmReviews,[key]:review};this.ctTmRevision++;await this.ctTmPersistReview(ctx,unit.id,field.id,review);this.ctTmError='';return true;
                }catch(error){if(this.ctTmCurrent(ctx)&&!changed(error))this.ctTmError=error.message;return false;}
                finally{session?.dispose();if(this.ctTmCurrent(ctx)){const next={...this.ctTmReviewBusy};delete next[key];this.ctTmReviewBusy=next;}}
            },
            ctTmRecoveryReviews(field){const candidate=this.ctTmPendingCandidate(field);if(!candidate||this.ctTmAccepted(field))return[];
                return this.ctTmRecoveries.filter(value=>value.unitId===this.ctSelection&&value.fieldId===field.id
                    &&value.rawSourceHash===state().rawSourceHash(field.source)&&typeof value.text==='string')
                    .sort((a,b)=>(b.updatedAt || b.createdAt || 0)-(a.updatedAt || a.createdAt || 0)||(b.editRevision || 0)-(a.editRevision || 0));
            },
            async ctTmRecoverReview(field){
                const recovery=this.ctTmRecoveryReviews(field)[0],candidate=this.ctTmPendingCandidate(field),unit=this.ctCurrentUnit,ctx=this.ctContext();
                if(!recovery||!candidate||this.ctBusy||!this.ctTmApplicable(candidate,field))return false;
                const key=name(unit.id,field.id),store=this.ctTmStorage(ctx),version=this._ctTmEditVersions?.get(key)||0,
                    current=()=>this.ctTmCurrent(ctx)&&this.ctCurrentUnit===unit&&this.ctTmPendingCandidate(field)?.id===candidate.id
                        &&this.ctTmPendingCandidate(field)?.revision===candidate.revision&&(this._ctTmEditVersions?.get(key)||0)===version;
                this.ctTmReviewBusy={...this.ctTmReviewBusy,[key]:true};
                try{
                    await this._ctTmReviewQueues?.get(key)?.queue.catch(()=>{});if(!current())return false;
                    const before=await store.getReview(ctx.scope,unit.id,field.id);if(!current())return false;
                    if(before&&store.putRecovery)await store.putRecovery(ctx.scope,unit.id,field.id,before,{recoveryId:uuid(),editRevision:1,guard:current});
                    if(!current())return false;const selected=candidate.matches.find(match=>match.id===recovery.matchId),review={...copy(recovery),
                        candidateId:candidate.id,candidateRevision:candidate.revision,rawSourceHash:candidate.rawSourceHash,matchId:selected?.id || null,
                        dirty:true,opened:true,acceptedDraft:false,revision:before?.revision};
                    const head=this._ctTmReviewQueues?.get(key);if(head&&!head.pending)head.revision=before?.revision || null;
                    this.ctTmReviews={...this.ctTmReviews,[key]:review};await this.ctTmPersistReview(ctx,unit.id,field.id,review);
                    if(!current())return false;this.ctTmRevision++;this.ctTmError='';return true;
                }catch(error){if(this.ctTmCurrent(ctx)&&!changed(error))this.ctTmError='TM review could not be recovered: '+error.message;return false;}
                finally{if(this.ctTmCurrent(ctx)){const next={...this.ctTmReviewBusy};delete next[key];this.ctTmReviewBusy=next;}}
            },
            async ctTmSaved(ctx,unitId){if(!this.ctTmCurrent(ctx))return;const claims=this._ctTmClaims?.[unitId] || [];if(this._ctTmClaims)delete this._ctTmClaims[unitId];
                if(!claims.length)return;const store=this.ctTmStorage(ctx),updates=await Promise.all(claims.map(async claim=>({claim,
                    candidate:await store.get(ctx.scope,claim.candidateId),review:await store.getReview(ctx.scope,unitId,claim.fieldId)})));if(!this.ctTmCurrent(ctx))return;
                const byId=new Map(updates.filter(value=>value.candidate).map(value=>[value.candidate.id,value.candidate])),reviews={...this.ctTmReviews};
                for(const {claim,review}of updates){if(!review)continue;const key=name(unitId,claim.fieldId),head=this._ctTmReviewQueues?.get(key);
                    if(head&&!head.pending&&Number(head.revision || 0)<=review.revision){head.revision=review.revision;head.queue=Promise.resolve();head.failed=null;}
                    if(reviews[key]?.candidateId===claim.candidateId&&Number(reviews[key]?.revision || 0)<=review.revision)reviews[key]=review;
                }
                this.ctTmReviews=reviews;this.ctTmCandidates=raw(this.ctTmCandidates.map(candidate=>byId.get(candidate.id) || candidate));this.ctTmRevision++;
            },
            ctTmReviewController(field){const candidate=this.ctTmPendingCandidate(field);if(!candidate)return null;const review=this.ctTmReviewFor(candidate),match=this.ctTmChosenMatch(candidate,review),accepted=this.ctTmAccepted(field);
                const validSource=this.ctTmApplicable(candidate,field),restored=!!(candidate.restored||review.restored),staleMatch=restored||!!match&&!this.ctTmMatchCurrent(match)||review.candidateRevision!==candidate.revision,
                    targetCurrent=accepted||this.ctTmFieldEligible(this.ctCurrentUnit,field,null,{allowOwn:true})
                        &&state().targetHash(text(S.valuesFor(this.ctCurrentUnit,this.ctSaved[this.ctSelection])[field.id]))===candidate.baseTargetHash,
                    validation=state().validate(field,accepted?text(this.ctValues[field.id]):review.text);
                const context=match?.context || {},contextText=[context.role,context.sheet,context.recordId,context.fieldName,context.form].filter(Boolean).join(' · ');
                return{sourceLabel:'TM',status:accepted?'Accepted draft · Save to apply':'Needs review',opened:!!this.ctTmCandidate(field),accepted,
                    busy:!!(this.ctBusy||this.ctTmReviewBusy[name(this.ctSelection,field.id)]),score:match?.score,kind:match?.kind,
                    rememberedSource:match?.source || '',currentSource:field.source,diff:match&&root.TranslationMemory?.sourceDiff?root.TranslationMemory.sourceDiff(match.source,field.source):null,
                    matches:candidate.matches,selectedMatchId:review.matchId,needsChoice:!!candidate.overflow||candidate.matches.length>1&&!review.matchId,overflow:!!candidate.overflow,
                    stale:!validSource||staleMatch||!targetCurrent,error:!validSource?'The workbook source changed. Your earlier review is retained.':!targetCurrent?'This field is no longer an empty translation. Its current work and your review text are preserved.':restored?'This restored suggestion needs a current TM review before accepting. Your edited text is retained.':staleMatch?'The remembered entry changed or was deleted. Revalidate before accepting.':candidate.overflow?'Too many top-ranked alternatives. Use the TM sidebar to choose a more specific entry manually.':'',validation,contextText,
                    choose:id=>this.ctTmChooseMatch(field,id),accept:()=>this.ctTmAccept(field),dismiss:()=>this.ctTmDismiss(field),show:()=>this.ctTmShow(field),undo:()=>this.ctTmUndoAccept(field),
                    revalidate:()=>this.ctTmRevalidate(field),recover:this.ctTmRecoveryReviews(field).length?()=>this.ctTmRecoverReview(field):null,
                    focus:event=>this.ctMtlReviewFocus?.(field,event)};
            },
        }
    };
    return{mixin};
});
