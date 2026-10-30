/* SD toolbar adapters. Ordinary drafts and MTL review buffers remain independent. */
(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.SDEditorTools=api;})(typeof window!=='undefined'?window:globalThis,function(root){
    'use strict';
    const plain=v=>JSON.parse(JSON.stringify(v)),raw=v=>root.Vue?.markRaw?root.Vue.markRaw(v):v;
    const fieldId=(index,column)=>JSON.stringify([index,column]);
    const mixin={
        data:()=>({sdMtlRows:{},sdMtlJobs:{},sdMtlError:'',sdComparisons:{},sdHistoryMenu:'',sdDetails:null,sdStyleRevision:0}),
        computed:{
            sdMtlVisible(){return root.ClientTextMtlUI?.visible(this)===true;},
            sdMtlScopeKey(){return JSON.stringify(this.sdScope());},
            sdToolContext(){return JSON.stringify([this.ctActive,this.editorSessionActive,this.sdMtlScopeKey,this.editorCurrentEditingDesc?.filepath,this._editorOpenCancelRevision,this.cloudSignedIn,this.cloudUser?.role,this.cloudUser?.language,this.cloudUser?.assignmentVersion,this._cloud?.epoch]);}
        },
        watch:{sdToolContext:{flush:'sync',handler(){this.sdAbort();this._sdWrites=new Map();this._sdKnownRevisions=new Map();this.sdMtlRows={};this.sdComparisons={};this.sdHistoryMenu='';this.sdDetails=null;this.sdMtlError='';this.sdLoadReviews();}}},
        beforeUnmount(){this.sdAbort();},
        methods:{
            sdScope(){const managed=this.managedWorkspaceScope?.()||{},room=this._collaboration?.room?.(),roomId=room?.roomId||room?.id;
                return {accountId:String(managed.accountId||this.cloudProfileId||this.cloudUser?.id||'guest'),game:this.gameVersion,branchId:this.branchId||'default',language:this.lang,
                    baselineId:this.sourceIdentity||managed.sourceHash||'',...(managed.groupId?{groupId:managed.groupId,versionId:managed.versionId}:{}),
                    ...(roomId?{roomId}:{}),filepath:this.editorCurrentEditingDesc?.filepath||''};},
            sdField(index,column=null){const block=this.editorBlocks?.[index],target=column==null?block:block?.tableColumns?.[column];return target?{id:fieldId(index,column),kind:'sd',index,column,block,target}:null;},
            sdFieldCurrent(field){return !this.ctActive&&this.sdField(field.index,field.column)?.target===field.target;},
            sdKey(field){return JSON.stringify([this.sdMtlScopeKey,field.id]);},
            sdStore(){return this._sdStore||=(raw(root.SDMtlStore.create({memory:!!this.testMode})));},
            async sdLoadReviews(){if(this.ctActive||!this.editorCurrentEditingDesc||!this.editorSessionActive)return;const scope=this.sdMtlScopeKey;
                try{const rows=await this.sdStore().read(scope);if(scope!==this.sdMtlScopeKey||this.ctActive)return;this.sdMtlRows=Object.fromEntries(rows.map(r=>[r.key,r]));
                    this._sdKnownRevisions=new Map(rows.map(r=>[r.key,r.revision]));this.refreshGamePreview?.();
                }catch(error){if(scope===this.sdMtlScopeKey)this.sdMtlError=error.message;}},
            sdRow(field){const row=this.sdMtlRows[this.sdKey(field)];return this.sdMtlVisible&&row?.sourceHash===root.SDText.hash(field.target.english)&&['review','acceptedDraft','pending'].includes(row.status)?row:null;},
            sdReview(field){const row=this.sdRow(field);return row?.status==='review'?row:null;},
            sdValue(field){return this.sdReview(field)?.reviewText??field.target.translation;},
            sdSetValue(field,text){const row=this.sdReview(field);if(row)row.reviewText=text;else field.target.translation=text;},
            sdBusy(field){return this.sdMtlJobs[this.sdKey(field)];},
            sdPersist(row){const key=row.key,snapshot=plain(row),scope=this.sdMtlScopeKey,client=this._cloud;
                const writes=this._sdWrites||=new Map(),known=this._sdKnownRevisions||=new Map();
                const promise=(writes.get(key)||Promise.resolve()).then(async()=>{
                    const next=await this.sdStore().put(snapshot,known.get(key)??row.revision??0,()=>scope===this.sdMtlScopeKey&&client===this._cloud);
                    known.set(key,next.revision);if(this.sdMtlRows[key]?.requestId===next.requestId)this.sdMtlRows[key].revision=next.revision;return next;
                });writes.set(key,promise);promise.catch(error=>{if(scope===this.sdMtlScopeKey)this.sdMtlError=error.message;});return promise;},
            async sdFlush(){await Promise.all(this._sdWrites?.values()||[]);},
            sdFieldInput(field){const row=this.sdReview(field);if(!row)return false;this.sdPersist(row);this.sdStyleRevision++;this.refreshGamePreview();return true;},
            sdPreviewValue(index){const block=this.editorBlocks?.[index];if(!block)return '';return block.isTable?block.tableColumns.map((_,column)=>this.sdValue(this.sdField(index,column))).join('@'):this.sdValue(this.sdField(index));},
            sdInsert(field,text,{start,end,offset,selectionEnd}={}){
                if(!this.sdFieldCurrent(field)||this.editorTranslationReadOnly||this.sdBusy(field))return false;
                const input=this.getEditorRef('translation',field.index,field.column);if(!input||input.composing)return false;
                const value=String(this.sdValue(field)||'');start??=input.selectionStart;end??=input.selectionEnd;
                input.focus({preventScroll:true});input.setSelectionRange(start,end);let native=false;
                try{native=!!root.document.execCommand('insertText',false,text);}catch(_){}
                if(!native)input.setRangeText(text,start,end,'end');
                this.sdSetValue(field,value.slice(0,start)+text+value.slice(end));
                if(!this.sdFieldInput(field)){if(field.column==null)this.translationInput(field.block,field.index);else this.tableColumnInput(field.block,field.index,field.column);}
                this.$nextTick(()=>{if(this.sdFieldCurrent(field)){input.focus({preventScroll:true});input.setSelectionRange(start+(offset??text.length),start+(selectionEnd??offset??text.length));this.sdStyleRevision++;}});return true;},
            sdReviewInsert(index,text,options={}){const field=this.sdField(index,this.editorBlocks?.[index]?.isTable?(options.columnIndex??this.editorFocusedColumnIndex??0):null);
                if(!field||!this.sdReview(field))return false;return this.sdInsert(field,text,{offset:options.caretOffset});},
            sdFormat(field,style){const input=this.getEditorRef('translation',field.index,field.column),selection=this._sdSelection;
                const value=String(this.sdValue(field)||'');if(!input||input.composing)return false;
                const start=selection?.field===field.id&&selection.value===value?selection.start:input.selectionStart,end=selection?.field===field.id&&selection.value===value?selection.end:input.selectionEnd;
                this._sdSelection=null;const edit=root.SDText.format(value,field.target.english,start,end,style);return edit&&this.sdInsert(field,edit.text,{start:edit.start,end:edit.end,offset:edit.offset,selectionEnd:edit.text.length-(edit.offset?2:0)});},
            sdKeydown(event,field,source=false){
                if(event.isComposing||event.keyCode===229)return false;
                if(event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.shiftKey&&['b','i','u'].includes(event.key.toLowerCase())){
                    event.preventDefault();event.stopPropagation();if(!source)this.sdFormat(field,event.key.toLowerCase());return true;}
                if(!source&&this.mtlShortcut!=='disabled'&&event.code==='F8'&&!event.shiftKey&&!event.metaKey
                    &&(this.mtlShortcut==='f8'&&!event.ctrlKey&&!event.altKey||this.mtlShortcut==='ctrl-alt-f8'&&event.ctrlKey&&event.altKey)){
                    if(!this.sdMtlVisible)return false;event.preventDefault();event.stopPropagation();this.sdGenerate(field);return true;}
                return false;
            },
            sdAllowed(){return !!this.cloudSignedIn&&!!this._cloud&&!!this.cloudUser&&(this.cloudCanAccessAllLanguages||['manager','admin'].includes(this.cloudUser.role)||this.cloudUser.language===this.lang);},
            sdMtlHint(field){if(this.getEditorRef?.('translation',field.index,field.column)?.composing)return 'Finish composing text before requesting MTL.';if(field.target.english?.length>12000)return 'MTL supports at most 12000 source characters.';if(!this.sdAllowed())return 'MTL is unavailable for this selected language.';if(root.navigator?.onLine===false)return 'MTL requires a network connection.';
                if(this.mtlConsentVersion!=='mtl-v2')return 'Enable MTL data sharing in Settings first.';if(this.sdRow(field))return 'Review this MTL attempt before generating again.';return 'Translate this SD field with MTL';},
            sdCanGenerate(field){return this.sdMtlVisible&&this.sdAllowed()&&!this.editorTranslationReadOnly&&!this.editorSaving&&!this.getEditorRef?.('translation',field.index,field.column)?.composing&&!this.sdBusy(field)&&!this.sdRow(field)
                &&!!field.target.english?.trim()&&field.target.english.length<=12000&&this.mtlConsentVersion==='mtl-v2'&&root.navigator?.onLine!==false;},
            sdAbort(){for(const job of Object.values(this.sdMtlJobs||{})){job.detached=true;job.controller.abort();}this.sdMtlJobs={};},
            async sdCancel(field){const job=this.sdBusy(field);if(!job)return;job.cancelled=true;job.phase='cancelling';
                try{await job.client.request('/v1/mtl/requests/'+encodeURIComponent(job.requestId)+'/cancellations',{method:'POST',body:{}});job.cancelSent=true;}catch(error){if(!job.detached)this.sdMtlError='The stop request could not be confirmed. This attempt will be checked again.';}},
            async sdContext(field){
                const key=this.sdToolContext,desc=this.editorCurrentEditingDesc;
                const context=root.SDText.context(this.workspaceSourceFile(desc.filepath)||desc,field.index,field.column,this.getActiveDictionaryEntries?.()||this.dictionary,this.gameVersion,{language:this.lang,committed:desc.translations?.[this.lang]});
                const original=await this.keywordContext?.(false,{approvedOnly:true}),translated=await this.keywordContext?.(true,{approvedOnly:true});
                if(key!==this.sdToolContext)throw new Error('The SD context changed.');
                context.keywords=[];context.unavailable=[];
                for(const id of [...new Set(root.ClientTextState.tokenize(field.target.english).filter(t=>t.kind==='keyword').map(t=>t.identity))].slice(0,6)){
                    const source=original?.entries.get(id),target=translated?.entries.get(id);
                    if(!source){context.unavailable.push({keyword:id,reason:'matching-definition-not-loaded'});continue;}
                    const record={id,source:{title:source.title,content:source.content},translation:{}};
                    for(const name of ['title','content'])if(target?.[name]?.trim()&&root.ClientTextMtlState.validate({id:name,kind:'text',source:source[name]},target[name]).valid)record.translation[name]=target[name];
                    if(JSON.stringify(record).length<=4000&&JSON.stringify({...context,keywords:[...context.keywords,record]}).length<=15000)context.keywords.push(record);
                    else context.unavailable.push({keyword:id,reason:'whole-definition-exceeds-context-budget'});
                }
                return context;
            },
            async sdGenerate(field,{recover=false}={}){
                const previous=this.sdRow(field);if(!this.sdCanGenerate(field)&&!(recover&&previous?.status==='pending'&&this.sdAllowed()&&!this.sdBusy(field)))return false;const scopeKey=this.sdMtlScopeKey,client=this._cloud,scope=this.sdScope(),key=this.sdKey(field),controller=new AbortController();
                const current=()=>scopeKey===this.sdMtlScopeKey&&client===this._cloud&&this.sdFieldCurrent(field)&&this.sdAllowed();
                this.setEditorFocus?.(field.index,field.column??0);
                const source=field.target.english,requestId=recover?previous.requestId:root.crypto.randomUUID(),sourceHash=root.SDText.hash(source),baseText=field.target.translation;
                const row=recover?previous:{key,scopeKey,scope:plain(scope),filepath:scope.filepath,index:field.index,column:field.column,sourceHash,requestId,baseText,status:'pending',revision:0};
                const job=raw({requestId,controller,client,phase:'waiting',text:'',cancelled:false,startedAt:Date.now()});this.sdMtlJobs={...this.sdMtlJobs,[key]:job};this.sdMtlError='';
                try{
                    let response;
                    if(!recover){
                    const capabilities=await client.request('/v1/mtl/capabilities',{signal:controller.signal});if(!current())return false;
                    if(!capabilities.statdescription)throw new Error('The server needs an SD MTL upgrade.');
                    const inferenceSettings=this.ctMtlSettingsCapture?.();
                    const context=await this.sdContext(field);
                    const {accountId,...serverScope}=scope;
                    const body={requestId,source,sourceHash,scope:serverScope,field:{index:field.index,column:field.column},context,consentVersion:'mtl-v2',...(inferenceSettings?{inferenceSettings}:{})};
                    if(!current()||job.cancelled||this.mtlConsentVersion!=='mtl-v2')return false;
                    this.sdMtlRows={...this.sdMtlRows,[key]:row};if(!recover)await this.sdPersist(row);if(!current())return false;
                    try{response=await client.request('/v1/mtl/statdescription/requests?async=1',{method:'POST',body,signal:controller.signal});}
                    catch(error){if(['MTL_NOT_CONFIGURED','MTL_MODEL_UNAVAILABLE','MTL_SHUTTING_DOWN'].includes(error.code))throw Object.assign(error,{confirmed:true});if(error.status&&error.status<500)throw error;job.phase='reconnecting';}
                    }
                    for(let attempts=0;current()&&attempts<760;attempts++){
                        if(response?.requestId&&response.requestId!==requestId)throw new Error('The MTL response belongs to another request.');
                        if(response?.result){const result=response.result;if(result.requestId!==requestId||result.provenance?.sdSourceHash!==sourceHash||result.provenance?.sdBaselineId!==scope.baselineId||result.provenance?.sdFieldId!==JSON.stringify([scope.filepath,field.index,field.column])||root.SDText.issues(source,result.translation,{cell:field.column!==null}).length)throw new Error('MTL returned invalid SD syntax. The ordinary draft is unchanged.');
                            const next={...row,revision:this.sdMtlRows[key]?.revision||0,status:job.cancelled?'dismissed':'review',generatedText:result.translation,reviewText:result.translation,provenance:result.provenance};
                            if(field.target.translation!==baseText)next.needsReview=true;
                            this.sdMtlRows={...this.sdMtlRows,[key]:next};await this.sdPersist(next);this.refreshGamePreview();return true;}
                        if(['failed','expired'].includes(response?.status))throw Object.assign(new Error('MTL could not complete this attempt ('+(response.errorCode||response.status)+').'),{confirmed:true});
                        if(job.cancelled&&!job.cancelSent&&response?.status&&['running','reserved'].includes(response.status)){try{await client.request('/v1/mtl/requests/'+encodeURIComponent(requestId)+'/cancellations',{method:'POST',body:{}});job.cancelSent=true;}catch(_){}}
                        if(!job.cancelled&&response?.progress){job.text=response.progress.translation||'';job.phase=response.progress.phase||'waiting';}
                        await new Promise(resolve=>setTimeout(resolve,250));if(!current())return false;
                        try{response=await client.request('/v1/mtl/requests/'+encodeURIComponent(requestId),{signal:controller.signal});}catch(error){if(error.status&&error.status<500&&error.status!==404)throw error;job.phase='reconnecting';}
                    }
                    throw new Error('The MTL attempt could not be confirmed. Reopen this field to check the same request.');
                }catch(error){if(current()&&!controller.signal.aborted){this.sdMtlError=error.message;if(error.confirmed||error.status&&error.status<500&&error.status!==404||row.status==='pending'&&error.message.includes('invalid SD syntax')){row.status='dismissed';this.sdMtlRows={...this.sdMtlRows,[key]:row};await this.sdPersist(row).catch(()=>{});}}return false;}
                finally{if(this.sdMtlJobs[key]===job){const jobs={...this.sdMtlJobs};delete jobs[key];this.sdMtlJobs=jobs;}}
            },
            sdReviewAction(field,work){const key=this.sdKey(field),scope=this.sdMtlScopeKey,actions=this._sdReviewActions||=new Map();if(actions.has(key))return actions.get(key);
                const action=Promise.resolve().then(work).catch(error=>{if(scope===this.sdMtlScopeKey)this.sdMtlError=error.message;return false;}).finally(()=>{if(actions.get(key)===action)actions.delete(key);});actions.set(key,action);return action;},
            sdAccept(field){return this.sdReviewAction(field,async()=>{const row=this.sdReview(field);if(!row||this.editorTranslationReadOnly||this.editorSaving)return;await this.sdFlush();if(!this.sdFieldCurrent(field)||row!==this.sdReview(field))return;
                const text=row.reviewText;if(root.SDText.issues(field.target.english,text,{cell:field.column!==null}).length){this.sdMtlError='Correct the SD syntax before accepting this suggestion.';return;}
                row.acceptedFrom=field.target.translation;row.acceptedText=text;await this.sdPersist(row);if(!this.sdFieldCurrent(field))return;
                field.target.translation=text;if(field.column==null)this.translationInput(field.block,field.index);else this.tableColumnInput(field.block,field.index,field.column);
                if(this.flushEditorDraft&&!this.testMode&&!await this.flushEditorDraft({force:true}))return;
                if(!this.sdFieldCurrent(field))return;row.status='acceptedDraft';await this.sdPersist(row);
                this.sdMtlError='';this.getEditorRef('translation',field.index,field.column)?.focus({preventScroll:true});});},
            sdUnaccept(field){return this.sdReviewAction(field,async()=>{const row=this.sdRow(field);if(!row||row.status!=='acceptedDraft'||this.editorSaving||this.editorTranslationReadOnly||field.target.translation!==row.acceptedText)return;
                field.target.translation=row.acceptedFrom;if(field.column==null)this.translationInput(field.block,field.index);else this.tableColumnInput(field.block,field.index,field.column);
                if(this.flushEditorDraft&&!this.testMode&&!await this.flushEditorDraft({force:true}))return;
                if(!this.sdFieldCurrent(field))return;row.status='review';await this.sdPersist(row);this.refreshGamePreview();});},
            sdDismiss(field){return this.sdReviewAction(field,async()=>{const row=this.sdRow(field);if(!row||this.editorSaving)return;await this.sdFlush();if(!this.sdFieldCurrent(field))return;
                row.status='dismissed';await this.sdPersist(row);this.refreshGamePreview();this.getEditorRef('translation',field.index,field.column)?.focus({preventScroll:true});});},
            async sdSaveClaims(lines){await Promise.all(this._sdReviewActions?.values()||[]);await this.sdFlush();const claims=[];
                for(const [index,block]of this.editorBlocks.entries())for(const field of block.isTable?block.tableColumns.map((_,column)=>this.sdField(index,column)):[this.sdField(index)]){
                    const row=this.sdRow(field);if(row?.status!=='acceptedDraft')continue;
                    const text=field.column==null?root.SDText.decode(lines[index]):root.SDText.decode(lines[index]).split('@')[field.column];
                    claims.push({key:row.key,requestId:row.requestId,revision:row.revision,text,sourceHash:row.sourceHash,provenance:plain(row.provenance)});
                }return claims;},
            sdSaved(claims){for(const claim of claims||[]){const row=this.sdMtlRows[claim.key];if(row?.requestId===claim.requestId&&row.revision===claim.revision){row.status='accepted';row.revision++;this._sdKnownRevisions?.set(row.key,row.revision);}}},
            async sdOpenDetails(field){const scope=this.sdToolContext,row=this.sdRow(field),details=raw({field:field.id,preview:!row,source:field.target.english,context:null});this.sdDetails=details;
                try{const result=row?.requestId?await this._cloud.request('/v1/admin/mtl/requests/'+encodeURIComponent(row.requestId)+'/debug'):{context:await this.sdContext(field)};
                    if(scope===this.sdToolContext&&this.sdDetails===details)this.sdDetails={...details,...result};
                }catch(error){if(scope===this.sdToolContext&&this.sdDetails===details)this.sdDetails={...details,error:error.message};}},
            async sdLoadHistory(side){this.historyMode=side==='source'?'source':'translation';await this.refreshHistory();},
            sdToolbar(index,column,side){const host=this,field=this.sdField(index,column),key=side+':'+field.id,ctx=this.sdToolContext,valid=()=>host.sdToolContext===ctx&&host.sdFieldCurrent(field),state=()=>host.sdComparisons[key]||{},row=()=>host.sdRow(field);
                const choices=()=>host.historyMode===(side==='source'?'source':'translation')?host.historyItems.map((entry,index)=>({key:String(index),label:host.formatHistoryTime(entry.savedAt)+' · '+(entry.note||'Saved'),group:side==='source'?'English versions':'Saved revisions'})):[];
                const reference=()=>host.historyItems[Number(state().reference||0)];
                const snapshot=entry=>{if(entry?.translations?.length!==host.editorBlocks.length)return undefined;const text=entry?.translations?.[index];return typeof text==='string'?(column==null?root.SDText.decode(text):root.SDText.decode(text).split('@')[column]):undefined;};
                return {side,sourceDiffBelow:true,english:false,formatting:true,get disabled(){return !valid()||host.editorSaving;},get formattingDisabled(){return side==='source'||this.disabled||host.editorTranslationReadOnly||!!host.sdBusy(field);},
                    get mtl(){return side==='translation'&&host.sdMtlVisible&&!!field.target.english?.trim();},get mtlBusy(){return !!host.sdBusy(field);},get mtlDisabled(){return !host.sdCanGenerate(field);},get mtlHint(){return host.sdMtlHint(field);},
                    get mtlProgress(){const job=host.sdBusy(field);return job?{phase:job.phase,translation:job.text,text:job.text,elapsedMs:Date.now()-job.startedAt,canCancel:job.phase!=='cancelling'}:null;},
                    get mtlShortcut(){return host.mtlShortcut==='f8'?'F8':host.mtlShortcut==='ctrl-alt-f8'?'Control+Alt+F8':undefined;},generate:()=>valid()&&host.sdGenerate(field),cancelMtl:()=>valid()&&host.sdCancel(field),
                    get mtlSettings(){return side==='translation'&&host.ctMtlSettingsAllowed;},get mtlSettingsState(){return host.ctMtlSettingsFor?.(field);},toggleMtlSettings:()=>valid()&&host.ctMtlSettingsToggle(field),
                    get mtlDebug(){return host.ctMtlSettingsAllowed;},debugMtl:()=>valid()&&host.sdOpenDetails(field),
                    get tone(){return side==='translation'&&row()?.status==='review'?'ctMtlReviewFrame':'';},
                    capture(){const input=host.getEditorRef('translation',index,column);if(input)host._sdSelection={field:field.id,value:host.sdValue(field),start:input.selectionStart,end:input.selectionEnd};},format:style=>valid()&&host.sdFormat(field,style),
                    styleActive(style){host.sdStyleRevision;const input=host.getEditorRef('translation',index,column);return side==='translation'&&!!input&&!!root.SDText.styles(String(host.sdValue(field)||''),input.selectionStart,input.selectionEnd)[style];},
                    get open(){return !!state().open;},get menuOpen(){return host.sdHistoryMenu===key;},get reference(){return state().reference||'0';},get choices(){return choices();},get groups(){return choices().length?[choices()[0].group]:[];},
                    get parts(){const before=snapshot(reference()),after=side==='source'?field.target.english:host.sdValue(field);if(before===undefined)return null;const diff=state().characters?root.Diff?.diffChars:root.Diff?.diffWordsWithSpace;return diff?.(before,after)||[{value:after}];},display:text=>state().whitespace?String(text).replace(/ /g,'·').replace(/\t/g,'→').replace(/\n/g,'↵\n'):text,
                    async toggle(){if(!valid())return;host.sdComparisons={...host.sdComparisons,[key]:{...state(),open:!state().open}};await host.sdLoadHistory(side);},select:reference=>{if(valid())host.sdComparisons={...host.sdComparisons,[key]:{...state(),reference}};},
                    async menu(){if(!valid())return;host.sdHistoryMenu=host.sdHistoryMenu===key?'':key;await host.sdLoadHistory(side);},closeMenu:()=>{host.sdHistoryMenu='';},get busy(){return host.historyLoading;},error:'',moreVersions:false,moreHistory:false,get whitespace(){return !!state().whitespace;},get characters(){return !!state().characters;},options(name,value){if(valid())host.sdComparisons={...host.sdComparisons,[key]:{...state(),[name]:value}};},
                    get entries(){return host.historyItems.map((entry,n)=>({key:String(n),original:entry,action:entry.note||'Saved',before:{available:side!=='source'&&Array.isArray(host.historyItems[n+1]?.translations)},beforeOriginal:host.historyItems[n+1],after:{available:Array.isArray(entry.translations)&&!entry.legacyReference&&!entry.incompleteRecovery}}));},
                    label:entry=>host.formatHistoryTime(entry.original.savedAt),restoreDisabled:side==='source'||host.editorTranslationReadOnly||!!host.entryAlignment,
                    restore:(entry,part)=>valid()&&host.restoreHistoryRevision(part==='before'?entry.beforeOriginal:entry.original),details:(entry,part)=>{host.sideTab='history';host.pickHistoryRevision(part==='before'?entry.beforeOriginal:entry.original);},detailRows:[],detailNotes:null,restoreLabel:'Restoring creates a saved revision of the whole file.'};
            }
        }
    };
    const Review={props:{host:Object,index:Number,column:{default:null}},computed:{field(){return this.host.sdField(this.index,this.column);},row(){return this.field&&this.host.sdRow(this.field);},SDTextIssues(){return this.field&&this.host.sdReview(this.field)?root.SDText.issues(this.field.target.english,this.row.reviewText,{cell:this.column!==null}):[];}},template:`<section v-if="row" class="sdMtlReview" data-inline-focus-surface @click.stop><template v-if="row.status==='review'"><span>MTL suggestion · review before Save</span><button type="button" @click="host.sdAccept(field)" :disabled="host.editorTranslationReadOnly || host.editorSaving">Accept</button><button type="button" @click="host.sdDismiss(field)">Dismiss</button><ul v-if="host.sdReview(field) && SDTextIssues.length"><li v-for="(issue,n) in SDTextIssues" :key="n">{{ issue.message }}</li></ul></template><template v-else-if="row.status==='acceptedDraft'"><span>MTL accepted into draft · Save the complete file to apply</span><button type="button" @click="host.sdUnaccept(field)" :disabled="host.editorSaving || host.editorTranslationReadOnly || field.target.translation!==row.acceptedText">Undo acceptance</button></template><template v-else><span>MTL attempt awaiting confirmation</span><button type="button" @click="host.sdGenerate(field,{recover:true})" :disabled="!!host.sdBusy(field)">Check attempt</button><button type="button" @click="host.sdDismiss(field)" :disabled="!!host.sdBusy(field)">Dismiss attempt</button></template></section>`};
    const Details={props:{host:Object},template:`<div class="sdMtlDetails" role="dialog" aria-label="SD MTL request details · Admin" aria-modal="false" data-inline-focus-surface @keydown.esc.stop.prevent="host.sdDetails=null"><header><strong>{{ host.sdDetails.preview ? 'SD MTL context preview · no request sent' : 'SD MTL request details' }}</strong><button type="button" @click="host.sdDetails=null">Close</button></header><pre>{{ JSON.stringify(host.sdDetails,null,2) }}</pre></div>`};
    return {mixin,Review,Details};
});
