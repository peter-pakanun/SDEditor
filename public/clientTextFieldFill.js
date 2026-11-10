/* Selection is scoped to actual worksheet fields in the current table projection. */
(function(root,factory){
    const api=factory(root);
    if(typeof module==='object' && module.exports)module.exports=api;
    else root.ClientTextFieldFill=api;
})(typeof window==='object'?window:globalThis,function(root){
    'use strict';
    const raw=value=>root.Vue?.markRaw ? root.Vue.markRaw(value) : value;
    const sameColumn=(session,unit,field)=>session.role===unit.role && session.sheet===unit.sheet && session.fieldId===field.id;
    function range(page,start,end){
        const first=page.findIndex(unit=>unit.id===start),last=page.findIndex(unit=>unit.id===end);
        return first<0 || last<0 ? [] : page.slice(Math.min(first,last),Math.max(first,last)+1);
    }
    function impact(rows,value){
        const result={blank:0,replace:0,same:0};
        for(const row of rows){
            if(row.expectedValue===value && value!=='')result.same++;
            else if(row.expectedValue==='')result.blank++;
            else result.replace++;
        }
        return result;
    }
    const mixin={
        data(){return {ctBulkSession:null,ctBulkPreview:null,ctBulkText:'',ctBulkTouched:false,ctBulkError:'',ctBulkSaving:false,ctBulkRetry:null,ctBulkFull:false};},
        computed:{
            ctBulkScopeKey(){return JSON.stringify([this.ctTmSelectionScopeKey,this.ctActive,this.ctEditor,this.ctPage,this.ctEffectivePageSize,this.ctSort,this.ctSortDir]);},
            ctBulkOwner(){return this.ctActive && this.ctWorkspace && JSON.stringify([this.ctWorkspace.scope,this.cloudProfileId,this.cloudUser?.id,this.cloudUser?.role,this.lang,this.gameVersion]);},
            ctBulkView(){return JSON.stringify([this.ctPage,this.ctEffectivePageSize,this.ctSort,this.ctSortDir,this.ctEditor,this.hideDNT,this.inlineEditor,
                this.ctBrowseMode,this.ctSheet,this.ctSheetFilter,this.ctAppliedSearch,this.ctSearchCaseSensitive,this.ctFilter,this.ctSelectedFilters,
                this.ctNpcSelection,this.ctNpcKind,this.ctNpcFilter,this.ctConvoSelection,this.ctConvoFilter]);},
            ctBulkStale(){return !!this.ctBulkSession && (this.ctBulkSession.owner!==this.ctBulkOwner || this.ctBulkSession.view!==this.ctBulkView || this.ctBulkSession.scope!==this.ctBulkScopeKey);},
            ctBulkToolUnit(){return !this.ctBulkStale && this.ctBulkSession ? this._ctUnitIndex?.get(this.ctBulkSession.sourceId) : null;},
            ctBulkToolField(){return this.ctBulkToolUnit?.fields.find(f=>f.id===this.ctBulkSession.fieldId);},
            ctBulkToolValues(){const unit=this.ctBulkToolUnit;return unit ? {...(unit===this.ctCurrentUnit?this.ctValues:this.ctValuesFor(unit)),[this.ctBulkToolField.id]:this.ctBulkText} : null;},
            ctBulkHint(){return 'Click to edit. Drag across records to fill this field. Ctrl/⌘ + click toggles cells; Shift + click selects a range.';},
            ctBulkMarks(){
                const state=this.ctBulkPreview || this.ctBulkSession;
                return state ? {fieldId:state.fieldId,ids:new Set(state.rows.map(row=>row.unitId))} : null;
            },
            ctBulkImpact(){
                if(!this.ctBulkSession)return '';
                const {blank,replace,same}=impact(this.ctBulkSession.rows,this.ctBulkText);
                if(this.ctBulkTouched && !this.ctBulkText)return [replace && replace+' to clear',blank && blank+' already blank'].filter(Boolean).join(' · ');
                return [blank && blank+(this.ctBulkText?' to fill':' empty'),replace && replace+(this.ctBulkText?' to replace':' populated'),
                    same && same+' already match'].filter(Boolean).join(' · ');
            },
            ctBulkCanSave(){return !!(this.ctBulkSession && this.ctBulkTouched && this.ctBulkSession.rows.some(r=>r.expectedValue!==this.ctBulkText)
                && !this.ctBulkStale && !this.ctBusy && !this.ctBrowseBusy && !this.ctBulkSaving);},
        },
        watch:{ctBulkScopeKey:'ctBulkViewChanged',ctBulkView:'ctBulkViewChanged',ctBulkOwner:'ctBulkViewChanged'},
        mounted(){
            this._ctFillUnload=event=>{if(this.ctBulkTouched || this.ctBulkRetry || this._ctParkedFills?.size){event.preventDefault();event.returnValue='';}};
            this._ctFillBlur=()=>this.ctBulkEndPointer();
            root.addEventListener('beforeunload',this._ctFillUnload);root.addEventListener('blur',this._ctFillBlur);
        },
        beforeUnmount(){root.removeEventListener('beforeunload',this._ctFillUnload);root.removeEventListener('blur',this._ctFillBlur);this.ctBulkEndPointer();},
        methods:{
            ctBulkFieldAllowed(field){return !!field && ['text','form'].includes(field.kind);},
            ctBulkMarked(unitId,fieldId){return this.ctBulkMarks?.fieldId===fieldId && this.ctBulkMarks.ids.has(unitId);},
            ctBulkViewChanged(){
                this.ctBulkEndPointer();
                const session=this.ctBulkSession,owner=this.ctBulkOwner;
                if(session && session.owner!==owner){
                    if(this.ctBulkTouched || this.ctBulkRetry)(this._ctParkedFills ||= new Map()).set(session.owner,{session,text:this.ctBulkText,retry:this.ctBulkRetry});
                    this.ctBulkCancel();
                }
                if(!this.ctBulkSession && owner && this._ctParkedFills?.has(owner)){
                    const p=this._ctParkedFills.get(owner);this._ctParkedFills.delete(owner);
                    this.ctBulkSession=p.session;this.ctBulkText=p.text;this.ctBulkTouched=true;this.ctBulkRetry=p.retry;
                }
                if(this.ctBulkSession && this.ctBulkStale){
                    if(!this.ctBulkTouched && !this.ctBulkRetry)this.ctBulkCancel();
                    else if(this.ctBulkSession.owner===owner && this.ctBulkSession.view===this.ctBulkView)
                        this.ctBulkSession=raw({...this.ctBulkSession,scope:this.ctBulkScopeKey});
                }
            },
            ctBulkEndPointer(event){
                const g=this._ctBulkPointer;
                if(!g || event && g.pointerId!==event.pointerId)return;
                this._ctBulkPointer=null;this.ctBulkPreview=null;
                root.cancelAnimationFrame?.(g.frame);
                if(g.target.hasPointerCapture?.(g.pointerId))g.target.releasePointerCapture(g.pointerId);
            },
            ctBulkCancel(restore=false){
                if(restore && this.ctBulkSaving)return;
                this.ctBulkEndPointer();
                const origin=this._ctBulkFocus;
                this.ctBulkSession=null;this.ctBulkPreview=null;this.ctBulkRetry=null;this.ctBulkError='';this.ctBulkText='';this.ctBulkTouched=false;this.ctBulkFull=false;this._ctBulkFocus=null;
                if(restore && origin?.isConnected)origin.focus({preventScroll:true});
            },
            ctBulkPointerDown(unit,field,event){
                if(event.button!==0 || !event.isPrimary || this.ctKeyboardBlocked() || this.ctBulkSaving || !this.ctBulkFieldAllowed(field))return;
                event.preventDefault();
                const target=event.currentTarget;
                this.ctBulkEndPointer();
                this._ctBulkPointer=raw({unit,field,target,pointerId:event.pointerId,x:event.clientX,y:event.clientY,scope:this.ctBulkScopeKey,
                    add:event.ctrlKey || event.metaKey,extend:event.shiftKey,dragging:false,last:null});
                target.setPointerCapture(event.pointerId);
            },
            ctBulkMakeSession(unit,field,units,keep,anchor,base=this.ctBulkSession){
                const previous=base && sameColumn(base,unit,field) ? new Map(base.rows.map(row=>[row.unitId,row])) : new Map();
                const selected=new Map(keep?previous:[]);
                for(const target of units){
                    if(target.role!==unit.role || target.sheet!==unit.sheet || selected.has(target.id))continue;
                    const visible=target.id===this.ctSelection && this.ctInlineUnitVisible() ?
                        this.ctDisplayedFields().some(f=>f.id===field.id) : this.ctListTargetParts(target,true).some(part=>part.field?.id===field.id);
                    if(!visible)continue;
                    selected.set(target.id,previous.get(target.id) || {unitId:target.id,expectedValue:this.ctValuesFor(target)[field.id],revision:this.ctSaved[target.id]?.revision || 0});
                }
                return {role:unit.role,sheet:unit.sheet,fieldId:field.id,label:this.ctHistoryFieldLabel(field),owner:this.ctBulkOwner,view:this.ctBulkView,
                    sourceId:keep && previous.size ? base.sourceId : unit.id,anchor,scope:this.ctBulkScopeKey,rows:[...selected.values()]};
            },
            ctBulkPointerMove(event){
                const g=this._ctBulkPointer;
                if(!g || event.pointerId!==g.pointerId || g.scope!==this.ctBulkScopeKey)return;
                g.lastX=event.clientX;g.lastY=event.clientY;
                const row=root.document.elementFromPoint(event.clientX,event.clientY)?.closest('tr[data-unit-id]');
                if(!row || !this.$refs.ctFileTableRegion.contains(row) || g.last===row.dataset.unitId)return;
                if(!g.dragging && (row.dataset.unitId===g.unit.id || Math.hypot(event.clientX-g.x,event.clientY-g.y)<4))return;
                g.dragging=true;g.last=row.dataset.unitId;
                if(!g.frame){
                    const scroll=()=>{
                        g.frame=0;if(this._ctBulkPointer!==g)return;
                        const table=this.$refs.ctFileTableRegion,r=table.getBoundingClientRect(),top=Math.max(0,r.top),bottom=Math.min(root.innerHeight,r.bottom);
                        if(g.lastX<r.left || g.lastX>r.right)return;
                        const dy=g.lastY<top+28?-12:g.lastY>bottom-28?12:0;
                        if(!dy)return;
                        const node=table.scrollHeight>table.clientHeight+1?table:root.document.scrollingElement,prior=node.scrollTop;
                        node.scrollTop+=dy;if(node.scrollTop===prior)return;
                        this.ctBulkPointerMove({pointerId:g.pointerId,clientX:g.lastX,clientY:Math.max(top+1,Math.min(bottom-1,g.lastY))});
                        if(!g.frame)g.frame=root.requestAnimationFrame(scroll);
                    };
                    g.frame=root.requestAnimationFrame(scroll);
                }
                if(g.add && this.ctBulkSession && !sameColumn(this.ctBulkSession,g.unit,g.field))return;
                this.ctBulkPreview=raw(this.ctBulkMakeSession(g.unit,g.field,range(this.ctPageRows,g.unit.id,g.last),g.add,g.unit.id));
            },
            ctBulkPointerUp(event){
                const g=this._ctBulkPointer;
                if(!g || event.pointerId!==g.pointerId)return;
                this.ctBulkPointerMove(event);
                const preview=this.ctBulkPreview;
                this.ctBulkEndPointer();
                if(g.scope!==this.ctBulkScopeKey)return;
                // The browser subsequently dispatches its pointer-generated click or dblclick.
                // A selection does not open a second editor or move focus between pointer events.
                if(g.dragging){
                    if(preview)this.ctBulkApplySelection(preview,g.target,true);
                }else this.ctBulkChoose(g.unit,g.field,g.add,g.extend,g.target);
            },
            ctBulkClick(unit,field,event){
                if(event.detail===0)this.ctBulkChoose(unit,field,event.ctrlKey || event.metaKey,event.shiftKey,event.currentTarget);
            },
            ctBulkApplySelection(next,origin,focus){
                const current=this.ctBulkSession;
                if(this.ctBulkStale){this.ctBulkError='Return to the original table view or cancel the retained edit.';return;}
                if(this.ctBulkRetry){this.ctBulkError='Retry or cancel the previous Save first.';return;}
                if(current && this.ctBulkTouched && (next.fieldId!==current.fieldId || next.role!==current.role || next.sheet!==current.sheet || !next.rows.length)){
                    this.ctBulkError='Save or cancel the current replacement first.';return;
                }
                if(!next.rows.length){this.ctBulkCancel(true);return;}
                if(!next.rows.some(row=>row.unitId===next.sourceId))next.sourceId=next.rows[0].unitId;
                if(next.rows.length>100){this.ctBulkError='Select at most 100 cells for one Save.';this.ctError=this.ctBulkError;return;}
                this._ctBulkFocus=origin;this.ctCloseCompletion();this.ctBulkSession=raw(next);this.ctBulkError='';
                if(focus || !current)this.$nextTick(()=>{if(this.ctBulkSession===next)this.$refs.ctBulkEditor?.focus();});
            },
            async ctBulkChoose(unit,field,add,extend,origin){
                if(this.ctKeyboardBlocked() || this.ctBulkSaving)return;
                const current=this.ctBulkSession;
                if(!add && !extend){
                    if(current && (this.ctBulkTouched || this.ctBulkRetry)){this.ctBulkError='Save or cancel the current replacement first.';return;}
                    this.ctBulkCancel();
                    if(this.ctInlineUnitVisible() && this.ctCurrentUnit===unit){this.ctFocusTarget(false,field.id);return;}
                    if(await this.ctSelect(unit,!this.inlineEditor,{saveInline:true,focus:false}) && this.ctCurrentUnit===unit)this.ctFocusTarget(false,field.id);
                    return;
                }
                if(extend && current){
                    const start=this._ctUnitIndex.get(current.anchor),locked=start?.fields.find(f=>f.id===current.fieldId);
                    if(!locked)return;
                    this.ctBulkApplySelection(this.ctBulkMakeSession(start,locked,range(this.ctPageRows,start.id,unit.id),add,start.id),origin,false);return;
                }
                if(current && !sameColumn(current,unit,field)){this.ctBulkError='Select another '+current.label+' cell in the same worksheet.';return;}
                const next=this.ctBulkMakeSession(unit,field,[unit],true,unit.id);
                if(current?.rows.some(r=>r.unitId===unit.id))next.rows=next.rows.filter(r=>r.unitId!==unit.id);
                this.ctBulkApplySelection(next,origin,false);
            },
            ctBulkKey(event){
                if(event.defaultPrevented || event.isComposing || event.keyCode===229 || this.ctKeyboardOverlayOpen())return false;
                if(event.key==='Escape' && this._ctBulkPointer){event.preventDefault();this.ctBulkEndPointer();return true;}
                if(!this.ctBulkSession)return false;
                if(event.key==='Escape' && !event.altKey && !event.ctrlKey && !event.metaKey){
                    event.preventDefault();event.stopPropagation();
                    if(this.ctBulkFull)this.ctBulkFull=false;else this.ctBulkCancel(true);return true;
                }
                const owner=event.target?.closest?.('.ctCellFill,[data-ct-bulk-field]');
                if(!owner)return false;
                if(!event.altKey && !event.shiftKey && (['F1','F2'].includes(event.key) || event.ctrlKey && ['Comma','Period'].includes(event.code))){
                    event.preventDefault();event.stopPropagation();
                    void this.ctBulkSaveAndNavigate(event.key==='F1' || event.code==='Comma');return true;
                }
                if(event.key==='Enter' && event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && !this.ctBulkStale){
                    event.preventDefault();event.stopPropagation();this.ctBulkFull=!this.ctBulkFull;
                    this.$nextTick(()=>this.$refs.ctBulkEditor?.focus());return true;
                }
                if((event.ctrlKey || event.metaKey) && event.key.toLowerCase()==='s' && !event.shiftKey){
                    event.preventDefault();event.stopPropagation();this.ctSave(false,{bulk:true});return true;
                }
                if(event.target?.closest('.ctCellFill')){
                    return true;
                }
                return false;
            },
            async ctBulkSaveAndNavigate(reverse){
                const session=this.ctBulkSession,ctx=this.ctContext(),full=this.ctBulkFull || !this.inlineEditor;
                if(!session || this.ctBulkStale || this.ctKeyboardBlocked())return false;
                if(this.ctBulkCanSave){if(!await this.ctSave(false,{bulk:true}))return false;}
                else if(this.ctBulkRetry)return false;
                else this.ctBulkCancel();
                if(!this.ctCurrent(ctx) || this.ctKeyboardOverlayOpen() || !this._ctUnitIndex.has(session.sourceId))return false;
                return this.ctSaveAndNavigate(reverse,{inline:!full,afterBulk:this._ctUnitIndex.get(session.sourceId)});
            },
            async ctBulkSave(){
                const session=this.ctBulkSession;
                if(!this.ctBulkCanSave || session.scope!==this.ctBulkScopeKey || this._ctSaveJob)return false;
                const ctx=this.ctContext(),store=this.ctStorage(ctx.scope),current=()=>this.ctBulkSession===session && this.ctBulkScopeKey===session.scope && this.ctTmCurrent(ctx);
                if(!current())return false;
                this.ctBusy=true;this.ctBulkSaving=true;this.ctBulkError='';
                try{
                    if(!await this.ctFlushDraft() || !current())return false;
                    const job=this.ctBulkRetry || raw({jobId:root.crypto.randomUUID(),role:session.role,sheet:session.sheet,fieldId:session.fieldId,
                        value:this.ctBulkText,rows:session.rows});
                    this.ctBulkRetry=job;
                    const results=await store.saveFieldBatch(ctx.scope,job,{guard:current});
                    if(!current())return false;
                    const saved={...this.ctSaved};
                    for(const {unitId,saved:receipt,current:latest,draft} of results){
                        const row=latest || receipt;
                        if((saved[unitId]?.revision || 0)>row.revision)continue;
                        saved[unitId]=row;
                        if(unitId===this.ctSelection){
                            this.ctValues={...(draft?.values || row.values)};this.ctReviewed={...(draft?.reviewed || row.reviewed)};
                            this._ctEditRevision=row.revision;this._ctDraftRevision=draft?.revision || null;this.ctDraftDirty=!!draft;
                            const head=this._ctDraftHeads?.get(JSON.stringify([root.ClientTextStore.scopeKey(ctx.scope),unitId]));
                            if(head && !head.pending){head.signature=null;head.revision=this._ctDraftRevision;}
                        }
                    }
                    this.ctSaved=raw(saved);this.ctRevision++;this.ctBulkCancel();
                    this.ctRefreshDiagnostics(results.map(r=>r.unitId));this.ctRefreshDraftSummaries(ctx);this.ctLoadMemory(ctx);
                    if(results.some(r=>r.unitId===this.ctSelection))this.ctLoadHistory(ctx,this.ctSelection);
                    for(const row of results)void this.ctQueueResourceMemory?.(ctx,this._ctUnitIndex.get(row.unitId),row.saved);
                    void this.ctSync(ctx);return true;
                }catch(error){
                    if(current()){
                        this.ctBulkError=error.message;
                        if(['CLIENTTEXT_FIELD_SELECTION_CHANGED','CLIENTTEXT_PENDING_RESOLUTION_REQUIRED','DRAFT_CHANGED','UNIT_CHANGED'].includes(error.code))this.ctBulkRetry=null;
                    }
                    return false;
                }finally{
                    if(this.ctCurrent(ctx))this.ctBusy=false;
                    this.ctBulkSaving=false;
                }
            },
        }
    };
    // Native input, raw undo/paste, formatting, autocomplete, diagnostics and revision comparison
    // use the regular controllers. This editing owner has its own text, caret, popup and history.
    // An insertion from the anchor's English or revision history can only change the fill buffer.
    function editor(){
        const ui=root.ClientTextUI.mixin.methods,comparisons=root.ClientTextComparisons.mixin;
        const shared=['ctFieldController','ctCompleteForm','ctSuggest','ctApplyCompletion','ctCompletionValid','ctCompletionSelectionChanged',
            'ctSyncCompletionSelection','ctCloseCompletion','clientTextPopupController','ctResetHistory','ctMergeHistory','ctLoadHistory',
            'ctLoadOlderHistory','ctHistoryEntryCurrent','ctHistorySnapshotFor','ctHistoryLabel','ctHistoryDiffParts','ctHistoryDisplay','ctNotes',
            'ctCompletionEnter','ctEditCompletionDictionary','ctDictionaryPresentation','ctDictionaryReturnCurrent','ctDictionaryReturnEnter','ctDictionaryContextCurrent','ctOpenHighlightDictionary'];
        const props=['ctWorkspace','ctSaved','ctOfflineTest','cloudUser','cloudCanAccessAllLanguages','managedOnlineAvailable','gameVersion','lang',
            'translationEditorBcp47','ctDiagnostics','cloudProfileId','cloudSignedIn','branchId','autocompleteShortcut','dictionary','ctDictionaryPack','ctDictionaryReady'];
        return {
            props:{host:{type:Object,required:true},session:{type:Object,required:true}},
            data(){return {...comparisons.data(),ctCompletion:null,ctFocusedField:this.session.fieldId,ctHistory:[],ctHistoryError:'',
                ctHistoryCharacters:false,ctHistoryWhitespace:false,ctHistoryCursor:null,ctHistoryLocalMore:false,ctHistoryLoading:false};},
            computed:{
                ...Object.fromEntries(props.map(name=>[name,function(){return this.host[name];}])),
                ctCurrentUnit(){return this.host._ctUnitIndex.get(this.session.sourceId);},
                ctSelection(){return this.session.sourceId;},field(){return this.ctCurrentUnit.fields.find(f=>f.id===this.session.fieldId);},
                ctActive(){return this.host.ctActive && this.host.ctBulkSession?.sourceId===this.session.sourceId && this.session.scope===this.host.ctBulkScopeKey;},
                ctBusy(){return this.host.ctBusy || !!this.host.ctBulkRetry;},
                ctTool:{get(){return this.host.ctTool;},set(value){this.host.ctTool=value;}},
                ctDictionaryFilter:{get(){return this.host.ctDictionaryFilter;},set(value){this.host.ctDictionaryFilter=value;}},
                ctValues(){
                    const map={...this.host.ctValuesFor(this.ctCurrentUnit)},host=this.host,id=this.field.id;
                    Object.defineProperty(map,id,{enumerable:true,get:()=>host.ctBulkText,set:value=>{host.ctBulkText=value;}});
                    return map;
                },
                ctReviewed(){return this.ctSaved[this.ctSelection]?.reviewed || {};},
                sourceControl(){return root.EditorSession.fieldController(this,this.field,this.field.source);},
                targetControl(){
                    const control=this.ctFieldController(this.field),original=control.field;
                    control.field=Object.create(original,{dataAttrs:{get:()=>({...original.dataAttrs,id:'ctBulkTranslation','aria-label':'Replacement translation'})}});
                    return control;
                },
                toolbar(){return this.ctFieldToolbar(this.field,'translation');},
            },
            mounted(){
                this._ctUnitIndex=this.host._ctUnitIndex;this._cloud=this.host._cloud;
                this.ctResetHistory();void this.ctLoadHistory();
            },
            beforeUnmount(){this._ctHistoryRun={};this.ctResetComparisons();this.ctCloseCompletion();},
            methods:{
                ...Object.fromEntries(shared.map(name=>[name,ui[name]])),...comparisons.methods,
                focus(){this.ctDictionaryTarget()?.focus({preventScroll:true});},
                insertText(value,whole=false){return this.ctActive && root.EditorSession.insert(this,this.field,value,{whole});},
                ctDictionaryTarget(){return this.$el?.querySelector('[data-ct-target]');},
                ctContext(){return this.host.ctContext();},ctCurrent(ctx){return this.ctActive && this.host.ctCurrent(ctx);},
                ctFieldStatus(field){return this.host.ctStatus(this.ctCurrentUnit).fields[field.id] || {};},
                ctFieldsFor(){return [this.field];},ctHistoryFieldLabel(field){return this.host.ctHistoryFieldLabel(field);},
                ctStorage(scope){return this.host.ctStorage(scope);},ctClassVariantLabel(field){return this.host.ctClassVariantLabel(field);},
                ctValuesFor(unit){return this.host.ctValuesFor(unit);},ctReviewHash(field){return this.host.ctReviewHash(field);},
                ctEdited(){this.host.ctBulkTouched=true;this.host.ctBulkError='';},ctResizeField(input){this.host.ctResizeField(input);},
                ctKeyboardOverlayOpen(){return this.host.ctKeyboardOverlayOpen();},ctDiagnosticDialog(){return this.host.ctDiagnosticDialog();},
                ctCompletionItems(field,marker,prefix){return this.host.ctCompletionItems(field,marker,prefix);},
                ctDictionaryPairs(word){return this.host.ctDictionaryPairs(word);},
                ctRevealDictionaryEntry(id){return this.host.ctRevealDictionaryEntry(id);},
                ctDictionaryBeginEdit(...args){return this.host.ctDictionaryBeginEdit(...args);},
                ctFocusDictionaryReplace(id,options={}){
                    if(!this.ctActive || !this.host.ctRevealDictionaryEntry(id))return;
                    this.host.ctTool='dictionary';this.host.ctDictionaryBeginEdit(id,options);
                    const session=this.session,info=this._ctDictionaryReturn;
                    this.$nextTick(()=>{
                        if(!this.ctActive || this.session!==session || info && !this.ctDictionaryReturnCurrent(info))return;
                        const row=[...root.document.querySelectorAll('.ctTools [data-dict-id]')].find(node=>node.dataset.dictId===String(id) && (node.dataset.dictAltId || '')===(options.altId || ''));
                        row?.querySelector('input[placeholder="Replace"],textarea[placeholder="Replace"]')?.focus();
                    });
                },
                ensureDictionaryKeywordTag(...args){return this.host.ensureDictionaryKeywordTag(...args);},
                dictionaryEntryInput(word){return this.host.dictionaryEntryInput?.(word);},
                scheduleClientTextDictionaryMatches(){return this.host.scheduleClientTextDictionaryMatches();},
                getDictionaryEntryById(id){return this.host.getDictionaryEntryById?.(id);},
                isDictionaryEntryActive(word){return this.host.isDictionaryEntryActive?.(word) ?? true;},
                showTooltip(event,text){this.host.showTooltip(event,text);},hideTooltip(){this.host.hideTooltip();},
                getTooltipElementAtPoint(...args){return this.host.getTooltipElementAtPoint(...args);},
                ctTargetKeydown(field,event){
                    if(event.isComposing || event.keyCode===229 || this.ctBusy || this.ctFormattingKeydown(event))return;
                    if(this.host.isAutocompleteShortcut?.(event) || (this.autocompleteShortcut==='ctrl-i' && event.ctrlKey && event.code==='Space')){
                        event.preventDefault();event.stopPropagation();
                        if(this.ctCompletionValid(field,event.target))this.ctCloseCompletion();else this.ctSuggest(field,event,{manual:true});
                    }else this.ctCompleteForm(field,event);
                },
                ctRestoreHistory(entry,part){
                    if(!this.ctHistoryEntryCurrent(entry) || !entry[part]?.available)return false;
                    const value=entry[part].values?.[this.field.id];
                    return typeof value==='string' && root.EditorSession.insert(this,this.field,value,{whole:true});
                },
            },
            template:`<div class="ctBulkEditingFields"><div class="ctBulkSource"><editor-native-field :controller="sourceControl" kind="english" compact></editor-native-field></div><div><editor-field-toolbar :controller="toolbar"><editor-native-field :controller="targetControl" kind="translation" compact></editor-native-field></editor-field-toolbar><editor-diagnostic-meta :presentation="targetControl.diagnosticPresentation"></editor-diagnostic-meta></div><editor-autocomplete v-if="ctCompletion" :controller="clientTextPopupController()"></editor-autocomplete></div>`
        };
    }
    return {mixin,editor,range,impact};
});
