/* Selection is scoped to actual worksheet fields in the current table projection. */
(function(root,factory){
    const api=factory(root);
    if(typeof module==='object' && module.exports)module.exports=api;
    else root.ClientTextFieldFill=api;
})(typeof window==='object'?window:globalThis,function(root){
    'use strict';
    const raw=value=>root.Vue?.markRaw ? root.Vue.markRaw(value) : value;
    const cellKey=(unitId,fieldId)=>JSON.stringify([unitId,fieldId]);
    const sameColumn=(session,unit,field,side)=>session.role===unit.role && session.sheet===unit.sheet && session.fieldId===field.id && session.side===side;
    function range(page,start,end){
        const first=page.findIndex(unit=>unit.id===start),last=page.findIndex(unit=>unit.id===end);
        return first<0 || last<0 ? [] : page.slice(Math.min(first,last),Math.max(first,last)+1);
    }
    function impact(rows,value){
        const result={blank:0,replace:0,same:0};
        for(const row of rows){
            const prior=row.expectedDraftValue ?? row.expectedValue;
            if(prior===value && value!=='')result.same++;
            else if(prior==='')result.blank++;
            else result.replace++;
        }
        return result;
    }
    function slots(page,selected,edges){
        if(!selected.length)return [];
        const ids=new Set(selected.map(row=>row.unitId)),bounds=new Set([...ids,...edges]);
        const first=page.findIndex(unit=>bounds.has(unit.id)),last=page.findLastIndex(unit=>bounds.has(unit.id));
        return first<0?[]:page.slice(first,last+1).map(unit=>ids.has(unit.id)?unit.id:null);
    }
    const mixin={
        data(){return {ctBulkDraftVersion:0,ctBulkCopiedRange:null,ctBulkSession:null,ctBulkSources:null,ctBulkPreview:null,ctBulkText:'',ctBulkTouched:false,ctBulkError:'',ctBulkSaving:false,ctBulkRetry:null,ctBulkFull:false,ctDirectValues:raw({}),ctDirectSelection:null,ctDirectRetry:null};},
        computed:{
            ctDirectPending(){return Object.keys(this.ctDirectValues).length>0;},
            ctBulkScopeKey(){return JSON.stringify([this.ctTmSelectionScopeKey,this.ctActive,this.ctEditor,this.ctPage,this.ctEffectivePageSize,this.ctSort,this.ctSortDir]);},
            ctBulkOwner(){return this.ctActive && this.ctWorkspace && JSON.stringify([this.ctWorkspace.scope,this.cloudProfileId,this.cloudUser?.id,this.cloudUser?.role,this.lang,this.gameVersion]);},
            ctBulkView(){return JSON.stringify([this.ctPage,this.ctEffectivePageSize,this.ctSort,this.ctSortDir,this.ctEditor,this.hideDNT,this.inlineEditor,
                this.ctBrowseMode,this.ctSheet,this.ctSheetFilter,this.ctAppliedSearch,this.ctSearchCaseSensitive,this.ctFilter,this.ctSelectedFilters,
                this.ctNpcSelection,this.ctNpcKind,this.ctNpcFilter,this.ctConvoSelection,this.ctConvoFilter]);},
            ctBulkStale(){return !!this.ctBulkSession && (this.ctBulkSession.owner!==this.ctBulkOwner || this.ctBulkSession.view!==this.ctBulkView || this.ctBulkSession.scope!==this.ctBulkScopeKey);},
            ctBulkToolUnit(){return !this.ctBulkStale && this.ctBulkSession?.side==='target' ? this._ctUnitIndex?.get(this.ctBulkSession.sourceId) : null;},
            ctBulkToolField(){return this.ctBulkToolUnit?.fields.find(f=>f.id===this.ctBulkSession.fieldId);},
            ctBulkToolValues(){const unit=this.ctBulkToolUnit;return unit ? {...(unit===this.ctCurrentUnit?this.ctValues:this.ctValuesFor(unit)),[this.ctBulkToolField.id]:this.ctBulkText} : null;},
            ctBulkHint(){return 'Click to edit. Drag across records to fill this field. Ctrl/⌘ + click toggles cells; Shift + click selects a range.';},
            ctBulkMarks(){
                const marks={};
                for(const state of [this.ctBulkSources,this.ctDirectSelection,this.ctBulkSession,this.ctBulkPreview]){
                    if(state)marks[state.side]={fieldId:state.fieldId,ids:new Set(state.rows.map(row=>row.unitId))};
                }
                return marks;
            },
            ctBulkImpact(){
                if(!this.ctBulkSession)return '';
                this.ctBulkDraftVersion;
                const {blank,replace,same}=impact(this.ctBulkSession.rows,this.ctBulkText);
                if(this.ctBulkTouched && !this.ctBulkText)return [replace && replace+' to clear',blank && blank+' already blank'].filter(Boolean).join(' · ');
                return [blank && blank+(this.ctBulkText?' to fill':' empty'),replace && replace+(this.ctBulkText?' to replace':' populated'),
                    same && same+' already match'].filter(Boolean).join(' · ');
            },
            ctBulkCanSave(){
                this.ctBulkDraftVersion;
                return !!(this.ctBulkSession && this.ctBulkTouched && this.ctBulkSession.rows.some(r=>{
                    const next=this.ctBulkEffective(r);
                    const direct=this.ctDirectValue(r.unitId,this.ctBulkSession.fieldId);
                    return next!==r.expectedValue || next!==(r.expectedDraftValue ?? r.expectedValue) || direct!==undefined && next!==direct;
                }) && !this.ctBulkStale && !this.ctBusy && !this.ctBrowseBusy && !this.ctBulkSaving);
            },
        },
        watch:{ctBulkScopeKey:'ctBulkViewChanged',ctBulkView:'ctBulkViewChanged',ctBulkOwner(next,previous){this.ctDirectSwitch(next,previous);this.ctBulkResetCopy();this.ctBulkViewChanged();}},
        mounted(){
            this._ctFillUnload=event=>{if(this.ctBulkTouched || this.ctBulkRetry || this.ctDirectPending || this._ctParkedFills?.size || this._ctParkedPastes?.size){event.preventDefault();event.returnValue='';}};
            this._ctFillBlur=()=>this.ctBulkEndPointer();
            root.addEventListener('beforeunload',this._ctFillUnload);root.addEventListener('blur',this._ctFillBlur);
            root.document.addEventListener('copy',this.ctBulkCopySource);
        },
        beforeUnmount(){root.removeEventListener('beforeunload',this._ctFillUnload);root.removeEventListener('blur',this._ctFillBlur);root.document.removeEventListener('copy',this.ctBulkCopySource);this.ctBulkEndPointer();},
        methods:{
            ctBulkFieldAllowed(field){return !!field && ['text','form'].includes(field.kind);},
            ctDirectValue(unitId,fieldId){return this.ctDirectPending ? this.ctDirectValues[cellKey(unitId,fieldId)] : undefined;},
            ctBulkShownText(unit,part){return this.ctDirectValue(unit.id,part.id) ?? part.text;},
            ctBulkSourceFields(unit){
                const seen=new Set();
                return this.ctFieldsFor(unit).filter(field=>{
                    const key=field.sourceCell || field.id;
                    if(!this.ctBulkFieldAllowed(field) || seen.has(key))return false;
                    seen.add(key);return true;
                });
            },
            ctBulkSourceField(unit,source){
                const first=unit.fields.find(f=>f.id===source.key);
                return first && this.ctBulkSourceFields(unit).find(f=>f.id===first.id || first.sourceCell && first.sourceCell===f.sourceCell);
            },
            ctBulkMarked(unitId,fieldId,side='target'){const marks=this.ctBulkMarks[side];return !!marks && marks.fieldId===fieldId && marks.ids.has(unitId);},
            ctBulkEffective(row,fieldId=this.ctBulkSession?.fieldId){
                return this.ctBulkTouched ? this.ctBulkText : this.ctDirectValue(row.unitId,fieldId) ?? row.expectedDraftValue ?? row.expectedValue;
            },
            ctBulkSnapshot(){
                const input=this.$refs.ctBulkEditor?.ctDictionaryTarget();
                return {text:this.ctBulkText,touched:this.ctBulkTouched,
                    sourceId:this.ctBulkSession?.sourceId,selection:input?{start:input.selectionStart,end:input.selectionEnd,direction:input.selectionDirection}:null};
            },
            ctBulkHistory(){
                const session=this.ctBulkSession;
                if(!session)return null;
                const signature=JSON.stringify([session.owner,session.view,session.fieldId,session.rows.map(row=>row.unitId)]);
                if(this._ctBulkUndoKey!==signature){
                    this._ctBulkUndoKey=signature;
                    this._ctBulkUndo=root.ClientTextUndo.create({key:state=>JSON.stringify([state.touched,state.text])});
                }
                return this._ctBulkUndo;
            },
            ctBulkBeforeInput(event){
                if(event.target?.id!=='ctBulkTranslation' || event.isComposing)return;
                if(['historyUndo','historyRedo'].includes(event.inputType)){
                    event.preventDefault();event.stopPropagation();this.ctBulkUndoStep(event.inputType==='historyRedo');return;
                }
                this._ctBulkBeforeEdit=this.ctBulkSnapshot();
                this._ctBulkInputType=event.inputType;
                const before=this._ctBulkBeforeEdit;
                root.setTimeout?.(()=>{if(this._ctBulkBeforeEdit===before){this._ctBulkBeforeEdit=null;this._ctBulkInputType=null;}},0);
            },
            ctBulkWrite(value){
                if(!this.ctBulkSession)return;
                if(value===this.ctBulkText && this.ctBulkTouched){this._ctBulkBeforeEdit=null;this._ctBulkInputType=null;return;}
                const before=this._ctBulkBeforeEdit || this.ctBulkSnapshot(),inputType=this._ctBulkInputType;
                this._ctBulkBeforeEdit=null;this._ctBulkInputType=null;
                this.ctBulkText=value;this.ctBulkTouched=true;this.ctBulkError='';
                const after=this.ctBulkSnapshot(),previous=this._ctBulkTyping,now=Date.now();
                const typing=['insertText','deleteContentBackward','deleteContentForward'].includes(inputType)
                    && before.selection?.start===before.selection?.end && Math.abs(value.length-before.text.length)<=2;
                const continuing=typing && previous && previous.inputType===inputType && previous.sourceId===before.sourceId
                    && previous.text===before.text && previous.caret===before.selection?.start && now-previous.at<750;
                this._ctBulkTypingId=(this._ctBulkTypingId || 0)+1;
                const group=typing?(continuing?previous.group:'typing-'+this._ctBulkTypingId):null;
                this._ctBulkTyping=typing?{inputType,sourceId:after.sourceId,text:value,caret:after.selection?.start,at:now,group}:null;
                this.ctBulkHistory().record(before,after,group);
            },
            ctBulkUndoStep(redo=false){
                if(!this.ctBulkSession || this.ctBulkStale || this.ctBulkSaving || this.ctBulkRetry || this.ctBusy)return false;
                const history=this.ctBulkHistory(),current=this.ctBulkSnapshot(),state=redo?history.redo(current):history.undo(current);
                if(!state)return false;
                const session=this.ctBulkSession,id=session.rows.some(row=>row.unitId===state.sourceId)?state.sourceId:session.sourceId;
                this.ctBulkSession=raw({...session,sourceId:id});this.ctBulkTouched=state.touched;
                this.ctBulkText=state.text;
                this.ctBulkError='';this._ctBulkBeforeEdit=null;this._ctBulkTyping=null;
                const owner=this.$refs.ctBulkEditor;owner?.ctCloseCompletion();
                // The regular formatter records its original caret before temporarily selecting
                // the replacement extent. Reuse those raw checkpoints for both directions.
                const record=owner?._ctRawEditHistory?.fields.get(session.fieldId),direction=redo?1:-1;
                let keepRaw=false;
                if(record && current.sourceId===id && record.values[record.at]===current.text){
                    const previous=record.at;
                    for(let at=previous+direction;at>=0 && at<record.values.length;at+=direction){
                        if(record.values[at]!==this.ctBulkText)continue;
                        const formatted=redo?record.formatEdits.slice(previous+1,at+1).some(Boolean):record.formatEdits.slice(at+1,previous+1).some(Boolean);
                        if(formatted && record.selections[at])state.selection=record.selections[at];
                        record.at=at;keepRaw=true;break;
                    }
                }
                if(owner){if(!keepRaw)owner._ctRawEditHistory=null;owner._ctRawSelectionRun={};}
                const restored=this.ctBulkSession,text=this.ctBulkText,focused=root.document.activeElement,run=this._ctBulkUndoRun={};
                this.$nextTick(()=>{
                    if(this._ctBulkUndoRun!==run || this.ctBulkSession!==restored || this.ctBulkText!==text || this.ctBulkStale)return;
                    const input=this.$refs.ctBulkEditor?.ctDictionaryTarget();if(!input)return;
                    const active=root.document.activeElement;
                    if(active && active!==focused && active!==input && active!==root.document.body)return;
                    input.focus({preventScroll:true});
                    const selection=state.selection;
                    if(selection)input.setSelectionRange(selection.start,selection.end,selection.direction || 'none');
                });
                return true;
            },
            ctBulkUndoKey(event){
                if(!this.ctBulkSession || !event.target?.closest?.('.ctCellFill,[data-ct-bulk-field]:not([data-ct-source-selection])')
                    || !(event.ctrlKey || event.metaKey) || event.altKey || event.isComposing)return false;
                const code=event.code,key=event.key.toLowerCase(),z=code==='KeyZ' || key==='z',y=code==='KeyY' || key==='y';
                if(!z && (!y || event.shiftKey))return false;
                if(!this.ctBulkUndoStep(y || event.shiftKey))return false;
                event.preventDefault();event.stopPropagation();return true;
            },
            ctBulkCopyValues(session){
                const values=new Map(session.rows.map(row=>[row.unitId,session.side==='source'?row.expectedValue:this.ctBulkEffective(row,session.fieldId)]));
                return session.slots.map(id=>id===null?null:values.get(id));
            },
            ctBulkResetCopy(){this._ctBulkCopyEpoch={};this.ctBulkCopiedRange=null;},
            ctBulkCopiedCell(unit,fieldId,side='target'){
                const copy=this.ctBulkCopiedRange;
                return !!copy && copy.side===side && copy.role===unit.role && copy.sheet===unit.sheet && copy.fieldId===fieldId && copy.ids.has(unit.id);
            },
            ctBulkCopySnapshot(session){
                const sequence=this._ctBulkCopySequence=(this._ctBulkCopySequence || 0)+1;
                return raw({owner:session.owner,side:session.side,role:session.role,sheet:session.sheet,fieldId:session.fieldId,
                    ids:new Set(session.rows.map(row=>row.unitId)),epoch:this._ctBulkCopyEpoch,sequence});
            },
            ctBulkCopied(snapshot){
                if(snapshot.owner!==this.ctBulkOwner || snapshot.epoch!==this._ctBulkCopyEpoch || snapshot.sequence<=(this.ctBulkCopiedRange?.sequence || 0))return;
                this.ctBulkCopiedRange=snapshot;
                if(snapshot.side==='source' && this.ctError?.startsWith('Could not copy the English cells: '))this.ctError='';
                if(snapshot.side==='target' && this.ctBulkError?.startsWith('Could not copy the cells: '))this.ctBulkError='';
            },
            async ctBulkWriteCopy(session){
                const snapshot=this.ctBulkCopySnapshot(session);
                try{
                    await root.ClientTextClipboard.write(this.ctBulkCopyValues(session));
                    this.ctBulkCopied(snapshot);
                }catch(error){
                    if(snapshot.epoch!==this._ctBulkCopyEpoch || snapshot.owner!==this.ctBulkOwner || snapshot.sequence!==this._ctBulkCopySequence)return;
                    if(session.side==='source')this.ctError='Could not copy the English cells: '+error.message;
                    else this.ctBulkError='Could not copy the cells: '+error.message;
                }
            },
            ctBulkCopySource(event){
                const session=this.ctBulkSources,source=root.document.activeElement?.closest('[data-ct-source-selection]');
                if(event.defaultPrevented || !session || session.owner!==this.ctBulkOwner || session.scope!==this.ctBulkScopeKey || session.view!==this.ctBulkView
                    || !source || !this.$refs.ctFileTableRegion?.contains(source) || !event.clipboardData || this.ctKeyboardOverlayOpen())return;
                const payload=root.ClientTextClipboard.encode(this.ctBulkCopyValues(session));
                event.clipboardData.setData('text/plain',payload.text);event.clipboardData.setData('text/html',payload.html);event.preventDefault();
                this.ctBulkCopied(this.ctBulkCopySnapshot(session));
            },
            async ctBulkCopyAll(){
                const session=this.ctBulkSession;if(!session || this.ctBulkStale)return;
                await this.ctBulkWriteCopy(session);
            },
            ctBulkPaste(event){
                const data=event.clipboardData;
                if(!data || event.defaultPrevented || event.target?.composing || this.ctBulkSaving || this.ctBulkRetry || this.ctBulkStale)return;
                const session=this.ctBulkSession || this.ctDirectSelection;
                const inline=event.target?.closest?.('.ctFields[data-side="translation"] textarea[data-ct-target]');
                if(inline && this.ctInlineUnitVisible() && !this.ctKeyboardBlocked()){
                    const unit=this.ctCurrentUnit,field=unit?.fields.find(f=>f.id===inline.dataset.ctTarget);
                    if(!field || !this.ctBulkFieldAllowed(field) || !this.ctKeyboardTarget(field,inline) || inline.readOnly
                        || this.ctMtlCandidate?.(field) || this.ctTmCandidate?.(field))return;
                    const clip=root.ClientTextClipboard.decode(data.getData('text/plain'),data.getData('text/html'));
                    if(clip.rows.length===1 && clip.rows[0]?.length===1 && session?.rows.length>1
                        && session.fieldId===field.id && session.rows.some(row=>row.unitId===unit.id)){
                        event.preventDefault();event.stopPropagation();
                        const assigned=root.ClientTextClipboard.assign(session.slots,clip.rows);
                        if(assigned.length)this.ctDirectPaste(session,assigned,inline);
                        return;
                    }
                    if(!clip.tabular)return;
                    event.preventDefault();event.stopPropagation();
                    if(clip.rows.length===1){
                        const text=clip.rows[0]?.[0];if(typeof text==='string' && text.trim())root.EditorSession.insert(this,field,text,{input:inline});
                        return;
                    }
                    if(this.ctBulkTouched){this.ctBulkError='Save or cancel the current replacement first.';return;}
                    const order=this.ctRows,start=order.findIndex(row=>row.id===unit.id);
                    if(start<0)return;
                    const rows=[];
                    for(const row of order.slice(start,start+Math.min(100,clip.rows.length))){
                        if(row.role!==unit.role || row.sheet!==unit.sheet)break;
                        rows.push(row);
                    }
                    const next=this.ctBulkMakeSession(unit,field,rows,false,unit.id,'target',rows,true);
                    const assigned=root.ClientTextClipboard.assign(slots(rows,next.rows,[unit.id,rows.at(-1).id]),clip.rows);
                    if(!assigned.length)return;
                    if(this.ctBulkSession)this.ctBulkCancel();
                    next.slots=slots(rows,next.rows,[unit.id,rows.at(-1).id]);
                    this.ctDirectPaste(next,assigned,inline);return;
                }
                if(!session)return;
                const target=event.target?.closest?.('#ctBulkTranslation,[data-ct-bulk-field]:not([data-ct-source-selection])');
                if(!target || target.id!=='ctBulkTranslation' && !this.ctBulkMarked(target.closest('tr[data-unit-id]')?.dataset.unitId,target.dataset.ctBulkField))return;
                const clip=root.ClientTextClipboard.decode(data.getData('text/plain'),data.getData('text/html'));
                if(!clip.tabular && session.rows.length<2){
                    if(event.target.id==='ctBulkTranslation')return;
                    const text=data.getData('text/plain');
                    if(!text)return;
                    event.preventDefault();event.stopPropagation();
                    if(!this.ctBulkSession){this.ctDirectPaste(session,session.rows.map(row=>({unitId:row.unitId,value:text})),target);return;}
                    const before=this.ctBulkSnapshot();this.ctBulkText=text;this.ctBulkTouched=true;this.ctBulkError='';
                    this.ctBulkHistory().record(before,this.ctBulkSnapshot());this.$refs.ctBulkEditor?.focus();return;
                }
                event.preventDefault();event.stopPropagation();
                const assigned=root.ClientTextClipboard.assign(session.slots,clip.rows);
                if(!assigned.length){this.ctBulkError='The pasted cells have no values for this selection.';return;}
                this.ctDirectPaste(session,assigned,this._ctBulkFocus || target);
            },
            ctDirectSwitch(next,previous){
                const parked=this._ctParkedPastes ||= new Map();
                if(previous && this.ctDirectPending)parked.set(previous,{values:this.ctDirectValues,cells:this._ctDirectCells,history:this._ctDirectHistory,retry:this.ctDirectRetry});
                const work=parked.get(next);parked.delete(next);
                this.ctDirectValues=work?.values || raw({});this._ctDirectCells=work?.cells || new Map();
                this._ctDirectHistory=work?.history || null;this.ctDirectRetry=work?.retry || null;this.ctDirectSelection=null;
            },
            ctDirectHistory(){return this._ctDirectHistory ||= root.ClientTextUndo.create({key:state=>JSON.stringify(state.values)});},
            ctDirectChange(next,group=null,before=null,after=null){
                if(this.ctDirectHistory().record({values:this.ctDirectValues,selection:before},{values:next,selection:after},group))this.ctDirectValues=raw(next);
            },
            ctDirectBeforeInput(event){
                const input=event.target,fieldId=input?.dataset?.ctTarget;
                if(!fieldId || this.ctDirectValue(this.ctSelection,fieldId)===undefined || event.isComposing)return;
                const before=this._ctDirectInput={id:cellKey(this.ctSelection,fieldId),input,type:event.inputType,start:input.selectionStart,end:input.selectionEnd,direction:input.selectionDirection};
                root.setTimeout(()=>{if(this._ctDirectInput===before)this._ctDirectInput=null;},0);
            },
            ctDirectEdit(unitId,fieldId,value){
                const id=cellKey(unitId,fieldId);
                if(!Object.hasOwn(this.ctDirectValues,id)){
                    // A native edit after undo starts a new branch; redoing the old paste
                    // must never replace that later ordinary edit.
                    if(this._ctDirectCells?.has(id) && this._ctDirectHistory?.canRedo({values:this.ctDirectValues})){
                        this._ctDirectHistory=null;
                        if(this.ctDirectPending)this.ctDirectHistory().record({values:{}},{values:this.ctDirectValues});
                    }
                    return false;
                }
                if(!this.ctDirectRetry && !this.ctBusy && this.ctDirectValues[id]!==value){
                    const old=this.ctDirectValues[id],input=this._ctDirectInput,prev=this._ctDirectTyping,now=Date.now();
                    const typing=input?.id===id && ['insertText','deleteContentBackward','deleteContentForward'].includes(input.type)
                        && input.start===input.end && Math.abs(value.length-old.length)<=2;
                    const group=typing && prev?.id===id && prev.type===input.type && prev.caret===input.start && prev.text===old && now-prev.at<750
                        ? prev.group : typing ? root.crypto.randomUUID() : null;
                    const before=input?.id===id ? {id,start:input.start,end:input.end,direction:input.direction} : null;
                    const after=before && {id,start:input.input.selectionStart,end:input.input.selectionEnd,direction:input.input.selectionDirection};
                    this._ctDirectTyping=typing?{id,type:input.type,caret:after.start,text:value,at:now,group}:null;
                    this._ctDirectInput=null;this.ctDirectChange({...this.ctDirectValues,[id]:value},group,before,after);
                }
                return true;
            },
            ctDirectPaste(session,assigned,focus){
                if(this.ctDirectRetry){this.ctError='Retry the pending Save before changing these cells.';return;}
                const cells=this._ctDirectCells ||= new Map(),entries=new Map(assigned.map(item=>[item.unitId,item.value]));
                const shared=this.ctBulkTouched && this.ctBulkSession===session;
                const base={...this.ctDirectValues},next={...base},fresh=[];
                for(const row of session.rows){
                    if(!shared && !entries.has(row.unitId))continue;
                    const id=cellKey(row.unitId,session.fieldId);
                    if(!Object.hasOwn(base,id)){
                        cells.set(id,{row,fieldId:session.fieldId,role:session.role,sheet:session.sheet});fresh.push(row);
                    }
                    if(shared)base[id]=this.ctBulkText;
                    next[id]=entries.get(row.unitId) ?? base[id];
                }
                if(fresh.length)this.ctBulkCaptureDraftValues({...session,rows:fresh});
                this._ctDirectTyping=null;
                if(shared)this.ctDirectChange(base);
                this.ctDirectChange(next);this.ctBulkCancel();this.ctCloseCompletion();this.ctDirectSelection=raw(session);
                if(focus?.isConnected)focus.focus({preventScroll:true});
            },
            ctDirectKey(event){
                const key=event.key?.toLowerCase(),mod=event.ctrlKey || event.metaKey;
                if(event.defaultPrevented || !mod || event.altKey || event.isComposing || this.ctKeyboardOverlayOpen() || this.ctHistoryViewer)return false;
                const target=event.target,inline=target?.closest?.('textarea[data-ct-target]'),input=target?.closest?.('input,textarea,select,[contenteditable=true]');
                const handle=target?.closest?.('[data-ct-bulk-field]:not([data-ct-source-selection])'),selection=this.ctDirectSelection;
                if(key==='c' && !event.shiftKey && handle && selection && this.ctBulkMarked(handle.closest('tr[data-unit-id]')?.dataset.unitId,handle.dataset.ctBulkField)){
                    event.preventDefault();event.stopPropagation();void this.ctBulkWriteCopy(selection);return true;
                }
                if(key==='s' && !event.shiftKey && this.ctDirectPending && !this.ctBulkTouched && (!input || inline || target.id==='ctBulkTranslation')){
                    event.preventDefault();event.stopPropagation();void this.ctSave();return true;
                }
                if(!['z','y'].includes(key) || key==='y' && event.shiftKey || !this._ctDirectHistory || this.ctBusy || this.ctDirectRetry)return false;
                if(input && !(inline && this._ctDirectCells?.has(cellKey(this.ctSelection,inline.dataset.ctTarget))))return false;
                if(!input && target!==root.document.body && !target?.closest?.('.fileTableScroll,#ctPendingPasteSave'))return false;
                const redo=key==='y' || event.shiftKey,current={values:this.ctDirectValues},state=redo?this._ctDirectHistory.redo(current):this._ctDirectHistory.undo(current);
                if(!state)return false;
                event.preventDefault();event.stopPropagation();this.ctDirectValues=raw(state.values);this.ctCloseCompletion();this._ctDirectTyping=null;
                if(inline){
                    const fieldId=inline.dataset.ctTarget,id=cellKey(this.ctSelection,fieldId),previous=current.values[id],next=state.values[id] ?? this.ctValues[fieldId];
                    const record=this._ctRawEditHistory?.fields.get(fieldId);
                    let selection=state.selection?.id===id && state.selection;
                    if(record && record.values[record.at]===previous){
                        const from=record.at,step=redo?1:-1;
                        for(let i=from+step;i>=0 && i<record.values.length;i+=step){
                            if(record.values[i]!==next)continue;
                            if(record.formatEdits.slice(Math.min(from,i)+1,Math.max(from,i)+1).some(Boolean))selection=record.selections[i] || selection;
                            record.at=i;break;
                        }
                    }
                    if(selection)this.$nextTick(()=>{if(inline===root.document.activeElement && this.ctSelection && this.ctDirectValues===state.values)inline.setSelectionRange(selection.start,selection.end,selection.direction || 'none');});
                }
                return true;
            },
            async ctDirectSave(){
                if(!this.ctDirectPending || this.ctBusy || this.ctBulkSaving || this._ctSaveJob)return false;
                const ctx=this.ctContext(),owner=this.ctBulkOwner,current=()=>this.ctBulkOwner===owner && this.ctTmCurrent(ctx);
                this.ctBusy=true;this.ctBulkSaving=true;
                try{
                    if(!await this.ctFlushDraft() || !current())return false;
                    while(this.ctDirectPending){
                        const ids=Object.keys(this.ctDirectValues),cells=this._ctDirectCells,first=cells.get(ids[0]);
                        const group=ids.filter(id=>{const c=cells.get(id);return c.fieldId===first.fieldId && c.role===first.role && c.sheet===first.sheet;}).slice(0,100);
                        const rows=group.map(id=>cells.get(id).row);
                        const error=(await Promise.all(this.ctBulkCaptureDraftValues({rows,fieldId:first.fieldId}))).find(Boolean);
                        if(error)throw error;
                        const job=this.ctDirectRetry || raw({jobId:root.crypto.randomUUID(),role:first.role,sheet:first.sheet,fieldId:first.fieldId,mode:'rows',
                            rows:rows.map((row,i)=>({...row,value:this.ctDirectValues[group[i]]}))});
                        this.ctDirectRetry=job;
                        const results=await this.ctStorage(ctx.scope).saveFieldBatch(ctx.scope,job,{guard:current});
                        if(!current())return false;
                        this.ctPublishFieldResults(results,ctx);this.ctDirectRetry=null;
                        const next={...this.ctDirectValues};
                        for(const id of group){delete next[id];cells.delete(id);}
                        // An acknowledged edit to a sibling increments the record revision, although
                        // its independent field witnesses still need to pass the storage transaction.
                        for(const result of results){
                            const saved=result.saved;
                            if(result.current && result.current.revision!==saved.revision)continue;
                            for(const row of this.ctDirectSelection?.rows || [])if(row.unitId===result.unitId && row.revision===saved.revision-1){
                                row.revision=saved.revision;
                                if(this.ctDirectSelection.fieldId===first.fieldId){
                                    row.expectedValue=saved.values[first.fieldId];
                                    row.expectedDraftValue=result.draft?.values[first.fieldId] ?? row.expectedValue;
                                }
                            }
                            for(const {row} of cells.values())if(row.unitId===result.unitId && row.revision===saved.revision-1)row.revision=saved.revision;
                        }
                        this.ctDirectValues=raw(next);
                        if(this.ctDirectPending){
                            const confirmed=new Set(group);
                            this._ctDirectHistory?.project(state=>({
                                values:Object.fromEntries(Object.entries(state.values).filter(([id])=>!confirmed.has(id))),
                                selection:confirmed.has(state.selection?.id)?null:state.selection,
                            }));
                        }else this._ctDirectHistory=null;
                    }
                    if(this.ctError===this._ctDirectSaveError)this.ctError='';
                    this._ctDirectSaveError=null;this._ctDirectCells=new Map();this.ctDirectSelection=null;void this.ctSync(ctx);return true;
                }catch(error){
                    if(current()){
                        this._ctDirectSaveError=this.ctError=error.message;
                        if(['CLIENTTEXT_FIELD_SELECTION_CHANGED','CLIENTTEXT_PENDING_RESOLUTION_REQUIRED','DRAFT_CHANGED','UNIT_CHANGED'].includes(error.code))this.ctDirectRetry=null;
                    }
                    return false;
                }finally{if(current())this.ctBusy=false;this.ctBulkSaving=false;}
            },
            ctBulkViewChanged(){
                this.ctBulkEndPointer();
                this.ctBulkSources=null;this.ctDirectSelection=null;
                const session=this.ctBulkSession,owner=this.ctBulkOwner;
                if(session && session.owner!==owner){
                    if(this.ctBulkTouched || this.ctBulkRetry)(this._ctParkedFills ||= new Map()).set(session.owner,{session,text:this.ctBulkText,retry:this.ctBulkRetry,undo:this._ctBulkUndo,undoKey:this._ctBulkUndoKey});
                    this.ctBulkCancel();
                }
                if(!this.ctBulkSession && owner && this._ctParkedFills?.has(owner)){
                    const p=this._ctParkedFills.get(owner);this._ctParkedFills.delete(owner);
                    this.ctBulkSession=p.session;this.ctBulkText=p.text;this.ctBulkTouched=true;this.ctBulkRetry=p.retry;
                    this._ctBulkUndo=p.undo;this._ctBulkUndoKey=p.undoKey;
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
                this._ctBulkUndo=null;this._ctBulkUndoKey=null;this._ctBulkBeforeEdit=null;this._ctBulkTyping=null;
                if(restore && origin?.isConnected)origin.focus({preventScroll:true});
            },
            ctBulkPointerDown(unit,field,event,side='target'){
                if(event.button!==0 || !event.isPrimary || this.ctKeyboardBlocked() || this.ctBulkSaving || !this.ctBulkFieldAllowed(field))return;
                event.preventDefault();
                const target=event.currentTarget;
                this.ctBulkEndPointer();
                this._ctBulkPointer=raw({unit,field,side,target,pointerId:event.pointerId,x:event.clientX,y:event.clientY,scope:this.ctBulkScopeKey,
                    add:event.ctrlKey || event.metaKey,extend:event.shiftKey,dragging:false,last:null});
                target.setPointerCapture(event.pointerId);
            },
            ctBulkMakeSession(unit,field,units,keep,anchor,side,order=this.ctPageRows,fresh=false){
                const base=side==='source'?this.ctBulkSources:this.ctBulkSession || this.ctDirectSelection,previous=!fresh && base && sameColumn(base,unit,field,side) ? new Map(base.rows.map(row=>[row.unitId,row])) : new Map();
                const selected=new Map(keep?previous:[]);
                for(const target of units){
                    if(target.role!==unit.role || target.sheet!==unit.sheet || selected.has(target.id))continue;
                    const original=target.fields.find(f=>f.id===field.id);
                    const visible=side==='source' ? this.ctBulkSourceFields(target).some(f=>f.id===field.id) : target.id===this.ctSelection && this.ctInlineUnitVisible() ?
                        this.ctDisplayedFields().some(f=>f.id===field.id) : this.ctListTargetParts(target,true).some(part=>part.field?.id===field.id);
                    if(!visible)continue;
                    selected.set(target.id,previous.get(target.id) || {unitId:target.id,expectedValue:side==='source'?original.source:this.ctValuesFor(target)[field.id],revision:this.ctSaved[target.id]?.revision || 0});
                }
                return {role:unit.role,sheet:unit.sheet,fieldId:field.id,side,label:this.ctHistoryFieldLabel(field),owner:this.ctBulkOwner,view:this.ctBulkView,
                    sourceId:keep && previous.size ? base.sourceId : unit.id,anchor,scope:this.ctBulkScopeKey,rows:order.filter(r=>selected.has(r.id)).map(r=>selected.get(r.id))};
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
                const base=g.side==='source'?this.ctBulkSources:this.ctBulkSession || this.ctDirectSelection;
                if(g.add && base && !sameColumn(base,g.unit,g.field,g.side))return;
                this.ctBulkPreview=raw(this.ctBulkMakeSession(g.unit,g.field,range(this.ctPageRows,g.unit.id,g.last),g.add,g.unit.id,g.side));
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
                    if(preview)this.ctBulkApplySelection(preview,g.target,true,[g.unit.id,g.last]);
                }else this.ctBulkChoose(g.unit,g.field,g.add,g.extend,g.target,g.side);
            },
            ctBulkClick(unit,field,event,side='target'){
                if(event.detail===0)this.ctBulkChoose(unit,field,event.ctrlKey || event.metaKey,event.shiftKey,event.currentTarget,side);
            },
            ctBulkCaptureDraftValues(session){
                const reads=this._ctBulkDraftReads ||= new WeakMap();
                const fresh=session.rows.filter(row=>!reads.has(row) && !Object.hasOwn(row,'expectedDraftValue'));
                if(fresh.length){
                    const ctx=this.ctContext(),fieldId=session.fieldId;
                    const active=this.ctDraftDirty && fresh.find(r=>r.unitId===this.ctSelection);
                    // The active field may still be waiting for its normal local checkpoint.
                    const live=active ? this.ctValues[fieldId] : null;
                    const task=this.ctStorage(ctx.scope).getFieldDraftValues(ctx.scope,fresh.map(r=>r.unitId),fieldId,{guard:()=>this.ctCurrent(ctx)})
                        .then(values=>{
                            for(const row of fresh)row.expectedDraftValue=row===active?live:values[row.unitId] ?? row.expectedValue;
                            this.ctBulkDraftVersion++;
                        },error=>{
                            for(const row of fresh)reads.delete(row);
                            return error;
                        });
                    for(const row of fresh)reads.set(row,task);
                }
                return [...new Set(session.rows.map(row=>reads.get(row)).filter(Boolean))];
            },
            ctBulkApplySelection(next,origin,focus,edges=[],order=this.ctPageRows){
                next.slots=slots(order,next.rows,edges);
                if(next.side==='source'){
                    this.ctBulkSources=next.rows.length?raw(next):null;origin.focus({preventScroll:true});return;
                }
                const current=this.ctBulkSession;
                if(this.ctBulkStale){this.ctBulkError='Return to the original table view or cancel the retained edit.';return;}
                if(this.ctBulkRetry){this.ctBulkError='Retry or cancel the previous Save first.';return;}
                if(current && this.ctBulkTouched && (next.side!==current.side || next.fieldId!==current.fieldId || next.role!==current.role || next.sheet!==current.sheet || !next.rows.length)){
                    this.ctBulkError='Save or cancel the current replacement first.';return;
                }
                if(!next.rows.length){this.ctDirectSelection=null;this.ctBulkCancel(true);return;}
                if(!next.rows.some(row=>row.unitId===next.sourceId))next.sourceId=next.rows[0].unitId;
                if(next.side==='target' && next.rows.length>100){this.ctBulkError='Select at most 100 cells for one Save.';this.ctError=this.ctBulkError;return;}
                this.ctBulkCaptureDraftValues(next);
                this.ctDirectSelection=null;
                this._ctBulkFocus=origin;this.ctCloseCompletion();this.ctBulkSession=raw(next);this.ctBulkError='';
                if(focus || !current)this.$nextTick(()=>{if(this.ctBulkSession===next)this.$refs.ctBulkEditor?.focus();});
            },
            async ctBulkChoose(unit,field,add,extend,origin,side='target'){
                if(this.ctKeyboardBlocked() || this.ctBulkSaving)return;
                const current=side==='source'?this.ctBulkSources:this.ctBulkSession || this.ctDirectSelection;
                // The dedicated handle toggles its cell. Clicking the value itself still opens the ordinary editor.
                if(origin?.classList?.contains('ctFieldGrip') && !add && !extend){
                    if(current && !sameColumn(current,unit,field,side)){
                        this.ctBulkApplySelection(this.ctBulkMakeSession(unit,field,[unit],false,unit.id,side),origin,true);
                        return;
                    }
                    add=true;
                }
                if(!add && !extend){
                    if(side==='source'){this.ctBulkApplySelection(this.ctBulkMakeSession(unit,field,[unit],false,unit.id,side),origin,false);return;}
                    if(current && (this.ctBulkTouched || this.ctBulkRetry)){this.ctBulkError='Save or cancel the current replacement first.';return;}
                    this.ctDirectSelection=null;this.ctBulkCancel();
                    if(this.ctInlineUnitVisible() && this.ctCurrentUnit===unit){this.ctFocusTarget(false,field.id);return;}
                    if(await this.ctSelect(unit,!this.inlineEditor,{saveInline:true,focus:false}) && this.ctCurrentUnit===unit)this.ctFocusTarget(false,field.id);
                    return;
                }
                if(extend && current && current.side===side){
                    const start=this._ctUnitIndex.get(current.anchor),locked=start?.fields.find(f=>f.id===current.fieldId);
                    if(!locked)return;
                    this.ctBulkApplySelection(this.ctBulkMakeSession(start,locked,range(this.ctPageRows,start.id,unit.id),add,start.id,side),origin,false,[start.id,unit.id]);return;
                }
                if(current && current.side===side && !sameColumn(current,unit,field,side)){this.ctBulkError='Select another '+current.label+' cell in the same worksheet.';return;}
                const next=this.ctBulkMakeSession(unit,field,[unit],true,unit.id,side);
                if(current?.side===side && current.rows.some(r=>r.unitId===unit.id)){
                    next.rows=next.rows.filter(r=>r.unitId!==unit.id);
                    if(!next.rows.length && side==='target' && origin?.classList?.contains('ctFieldGrip')){this.ctDirectSelection=null;this.ctBulkCancel(true);return;}
                }
                this.ctBulkApplySelection(next,origin,false);
            },
            ctBulkKey(event){
                if(event.defaultPrevented || event.isComposing || event.keyCode===229 || this.ctKeyboardOverlayOpen())return false;
                if(this.ctBulkUndoKey(event))return true;
                if(event.key==='Escape' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey){
                    if(this.ctHistoryViewer || this.ctCompletion)return false;
                    const editor=this.$refs?.ctBulkEditor;
                    if(editor?.ctCompletion){event.preventDefault();event.stopPropagation();editor.ctCloseCompletion();return true;}
                    if(this._ctBulkPointer || this.ctBulkSources || this.ctBulkSession || this.ctDirectSelection || this.ctBulkCopiedRange){
                        event.preventDefault();event.stopPropagation();
                        this.ctBulkResetCopy();
                        if(!this.ctBulkSaving){this.ctBulkSources=null;this.ctDirectSelection=null;this.ctBulkCancel(!!this.ctBulkSession);}
                        return true;
                    }
                }
                if(this.ctDirectKey(event))return true;
                if(this.ctBulkSources && event.target?.closest?.('[data-ct-source-selection]')){
                    if((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && (event.code==='KeyC' || event.key.toLowerCase()==='c')){
                        const session=this.ctBulkSources;
                        if(session.scope===this.ctBulkScopeKey && session.view===this.ctBulkView && session.owner===this.ctBulkOwner){
                            event.preventDefault();event.stopPropagation();
                            void this.ctBulkWriteCopy(session);
                        }
                        return true;
                    }
                    if((event.metaKey || event.ctrlKey) && ['s','v'].includes(event.key.toLowerCase()))event.preventDefault();
                    return true;
                }
                if(!this.ctBulkSession)return false;
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
            ctPublishFieldResults(results,ctx){
                const saved={...this.ctSaved};
                for(const {unitId,saved:receipt,current:latest,draft} of results){
                    const row=latest || receipt;
                    if((saved[unitId]?.revision || 0)>row.revision)continue;
                    saved[unitId]=row;
                    if(unitId===this.ctSelection){
                        this.ctValues={...(draft?.values || row.values)};this.ctReviewed={...(draft?.reviewed || row.reviewed)};
                        this._ctEditRevision=row.revision;this._ctDraftRevision=draft?.revision || null;this.ctDraftDirty=!!draft;
                        this.ctTmRestoreAcceptances?.(draft);this.ctMtlRestoreAcceptances?.(draft);
                        const head=this._ctDraftHeads?.get(JSON.stringify([root.ClientTextStore.scopeKey(ctx.scope),unitId]));
                        if(head && !head.pending){head.signature=null;head.revision=this._ctDraftRevision;}
                    }
                }
                this.ctSaved=raw(saved);this.ctRevision++;
                this.ctRefreshDiagnostics(results.map(r=>r.unitId));this.ctRefreshDraftSummaries(ctx);this.ctLoadMemory(ctx);
                if(results.some(r=>r.unitId===this.ctSelection))this.ctLoadHistory(ctx,this.ctSelection);
                for(const row of results)void this.ctQueueResourceMemory?.(ctx,this._ctUnitIndex.get(row.unitId),row.saved);
            },
            async ctBulkSave(){
                const session=this.ctBulkSession;
                if(!this.ctBulkCanSave || session.scope!==this.ctBulkScopeKey || this._ctSaveJob)return false;
                if(this.ctDirectPending && !this.ctBulkRetry){
                    if(!this.ctDirectRetry)this.ctDirectPaste(session,session.rows.map(r=>({unitId:r.unitId,value:this.ctBulkText})),this._ctBulkFocus);
                    return this.ctDirectSave();
                }
                const ctx=this.ctContext(),store=this.ctStorage(ctx.scope),current=()=>this.ctBulkSession===session && this.ctBulkScopeKey===session.scope && this.ctTmCurrent(ctx);
                if(!current())return false;
                this.ctBusy=true;this.ctBulkSaving=true;this.ctBulkError='';
                try{
                    const failed=(await Promise.all(this.ctBulkCaptureDraftValues(session))).find(Boolean);
                    if(failed)throw failed;
                    if(!await this.ctFlushDraft() || !current())return false;
                    const job=this.ctBulkRetry || raw({jobId:root.crypto.randomUUID(),role:session.role,sheet:session.sheet,fieldId:session.fieldId,value:this.ctBulkText,rows:session.rows});
                    this.ctBulkRetry=job;
                    const results=await store.saveFieldBatch(ctx.scope,job,{guard:current});
                    if(!current())return false;
                    this.ctPublishFieldResults(results,ctx);this.ctBulkCancel();
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
                    Object.defineProperty(map,id,{enumerable:true,get:()=>host.ctBulkText,set:value=>{host.ctBulkWrite(value);}});
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
                sourceToolbar(){return Object.assign(this.ctFieldToolbar(this.field,'source'),{sourceDiffBelow:true});},
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
                ctEdited(){
                    this.host.ctBulkError='';
                },ctResizeField(input){this.host.ctResizeField(input);},
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
            template:`<div class="ctBulkEditingFields" @beforeinput.capture="host.ctBulkBeforeInput($event)"><div class="ctBulkSource"><editor-field-toolbar :controller="sourceToolbar"><editor-native-field :controller="sourceControl" kind="english" compact></editor-native-field></editor-field-toolbar></div><div><editor-field-toolbar :controller="toolbar"><editor-native-field :controller="targetControl" kind="translation" compact></editor-native-field></editor-field-toolbar><editor-diagnostic-meta :presentation="targetControl.diagnosticPresentation"></editor-diagnostic-meta></div><editor-autocomplete v-if="ctCompletion" :controller="clientTextPopupController()"></editor-autocomplete></div>`
        };
    }
    // Workbook page changes frequently rerender the root. Keeping the collapsed field lists in
    // their own row component leaves unaffected rows mounted during editor focus and history updates.
    const browseFields={props:['host','unit','side'],template:`
        <div v-if="side==='source'" class="ctReadPreview ctBulkFieldList" lang="en"><button v-for="field in host.ctBulkSourceFields(unit)" :key="field.id" type="button" class="ctBulkCell" data-inline-focus-surface data-ct-source-selection :data-ct-bulk-field="field.id" :aria-label="unit.recordId+', English '+host.ctHistoryFieldLabel(field)" :aria-pressed="host.ctBulkMarked(unit.id,field.id,'source')" :data-ct-copied="host.ctBulkCopiedCell(unit,field.id,'source') || null" :title="host.ctHistoryFieldLabel(field)" @pointerdown="host.ctBulkPointerDown(unit,field,$event,'source')" @click.stop="host.ctBulkClick(unit,field,$event,'source')" @dblclick.stop><small>{{ host.ctHistoryFieldLabel(field) }}</small><span>{{ field.source || 'Empty' }}</span></button></div>
        <template v-else><div class="ctReadPreview ctBulkFieldList" :lang="host.translationEditorBcp47"><template v-for="part in host.ctListTargetParts(unit,true)" :key="part.id"><button v-if="part.field" type="button" class="ctBulkCell" data-inline-focus-surface :data-ct-bulk-field="part.id" :aria-label="unit.recordId+', '+host.ctHistoryFieldLabel(part.field)" :aria-pressed="host.ctBulkMarked(unit.id,part.id)" :data-ct-copied="host.ctBulkCopiedCell(unit,part.id) || null" :title="host.ctHistoryFieldLabel(part.field)+' · '+host.ctBulkHint" @pointerdown="host.ctBulkPointerDown(unit,part.field,$event)" @click.stop="host.ctBulkClick(unit,part.field,$event)" @dblclick.stop><small>{{ host.ctHistoryFieldLabel(part.field) }}</small><span :class="{ctEnglishPlaceholder:!host.ctBulkShownText(unit,part) || part.english && host.ctDirectValue(unit.id,part.id)===undefined}">{{ host.ctBulkShownText(unit,part) || 'Empty' }}</span></button><span v-else :class="{ctEnglishPlaceholder:part.english}">{{ part.text }}</span></template></div><small v-for="field in host.ctFieldsFor(unit).filter(field=>field.kind==='gender')" :key="field.id" class="ctMetadataValue">Gender: {{ host.ctValuesFor(unit)[field.id] || 'Blank' }}</small></template>`};
    const grip={
        props:['host','unit','field','side'],
        computed:{
            label(){return this.field && 'Select '+(this.side==='source'?'English ':'translation ')+this.host.ctHistoryFieldLabel(this.field)+', '+this.unit.recordId;},
        },
        template:`<button v-if="host.ctBulkFieldAllowed(field)" type="button" class="ctFieldGrip" data-inline-focus-surface
            :data-ct-source-selection="side==='source' ? '' : null" :data-ct-bulk-field="field.id" :aria-label="label" :title="label+' · Drag to select cells'"
            :aria-pressed="host.ctBulkMarked(unit.id,field.id,side)" :data-ct-copied="host.ctBulkCopiedCell(unit,field.id,side) || null"
            @pointerdown="host.ctBulkPointerDown(unit,field,$event,side)" @click.stop="host.ctBulkClick(unit,field,$event,side)" @dblclick.stop>
            <svg aria-hidden="true" viewBox="0 0 24 24" data-icon="square-dashed-plus"><path d="M5 3a2 2 0 0 0-2 2M19 3a2 2 0 0 1 2 2M21 19a2 2 0 0 1-2 2M5 21a2 2 0 0 1-2-2M9 3h1m4 0h1M9 21h1m4 0h1M3 9v1m0 4v1M21 9v1m0 4v1M8 12h8m-4-4v8"/></svg></button>`,
    };
    return {mixin,editor,browseFields,grip,range,impact};
});
