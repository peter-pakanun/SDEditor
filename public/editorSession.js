/* Presentation adapters. Format codecs and durable saves remain their owners. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.EditorSession = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const mode = host => host.ctActive ? 'clienttext' : 'statdescription';
  function context(host) {
    const ct = host.ctActive, scope = ct ? host.ctWorkspace?.scope || {} : typeof host.managedWorkspaceScope==='function' ? host.managedWorkspaceScope() || {} : host.managedWorkspaceScope || {};
    const baseline=ct ? scope.sourceHash || scope.baselineId || (host.ctWorkspace?.metadata?.descriptors?.length ? root.ClientTextState.hash(host.ctWorkspace.metadata.descriptors.map(asset=>asset.baselineId)): '')
      : scope.sourceHash || scope.baselineId || host.sourceIdentity || '';
    return { mode:mode(host), accountId:scope.accountId || host.cloudProfileId || host.cloudUser?.id || 'guest',
      game:scope.game || host.gameVersion, branchId:scope.branchId || host.branchId || 'default',
      versionId:scope.versionId || host.activeContentGroup?.versionId || host.managedActiveVersion?.id || '',
      groupId:scope.groupId || host.activeContentGroup?.id || '', sourceHash:baseline,
      language:scope.language || host.lang || '', unitId:ct ? host.ctSelection || '' : host.editorCurrentEditingDesc?.filepath || '',
      fieldId:ct ? host.ctFocusedField || '' : String(host.editorFocusedIndex || 0)+':'+String(host.editorFocusedColumnIndex || 0),
      access:[host.cloudSignedIn,host.cloudUser?.id,host.cloudUser?.role,host.cloudUser?.language,host.cloudUser?.assignmentVersion,host.cloudCanAccessAllLanguages],
      generation:ct ? host._ctEpoch || 0 : host._editorOpenCancelRevision || 0 };
  }
  const key = (host, includeUnit=true) => {const ctx=context(host);if(!includeUnit){delete ctx.unitId;delete ctx.fieldId;}return JSON.stringify(ctx);};
  function rawOffset(text, offset) {
    let raw=0,shown=0;
    while(raw<text.length && shown<offset){raw+=text[raw]==='\r' && text[raw+1]==='\n'?2:1;shown++;}
    return raw;
  }
  function preserveRawEdit(previous, shown) {
    const original=String(previous ?? ''),next=String(shown ?? '');
    if(!original.includes('\r') || next.includes('\r'))return next;
    const before=original.replace(/\r\n?/g,'\n');let start=0,a=before.length,b=next.length;
    while(start<a && start<b && before[start]===next[start])start++;
    while(a>start && b>start && before[a-1]===next[b-1]){a--;b--;}
    return original.slice(0,rawOffset(original,start))+next.slice(start,b)+original.slice(rawOffset(original,a));
  }
  const nativeText=value=>String(value ?? '').replace(/\r\n?/g,'\n');
  function rawHistory(host,field,previous) {
    const scope=key(host,false),unit=host.ctCurrentUnit;
    if(host._ctRawEditHistory?.scope!==scope || host._ctRawEditHistory.unit!==unit)host._ctRawEditHistory={scope,unit,fields:new Map()};
    const records=host._ctRawEditHistory.fields;let record=records.get(field.id);
    if(!record || record.values[record.at]!==previous){record={values:[previous],at:0,newlines:new Map()};records.set(field.id,record);}
    return record;
  }
  function rememberRawNewlines(record,previous,value) {
    if(previous.includes('\r') || value.includes('\r')){
      let start=0,before=previous.length,after=value.length;
      while(start<before && start<after && previous[start]===value[start])start++;
      while(before>start && after>start && previous[before-1]===value[after-1]){before--;after--;}
      if(/[\r\n]/.test(previous.slice(start,before)+value.slice(start,after))){
        record.newlines.set(nativeText(previous),previous);record.newlines.set(nativeText(value),value);
      }
    }
  }
  function recordRawValue(record,value) {
    if(record.values[record.at]===value)return;
    rememberRawNewlines(record,record.values[record.at],value);
    record.values.splice(record.at+1);record.values.push(value);
    if(record.values.length>128)record.values.shift();record.at=record.values.length-1;
  }
  function applyRawInput(host,field,shown,inputType) {
    const previous=String(host.ctValues[field.id] ?? ''),record=rawHistory(host,field,previous),text=String(shown ?? '');
    if(inputType==='historyUndo' || inputType==='historyRedo'){
      const direction=inputType==='historyUndo'?-1:1;
      for(let at=record.at+direction;at>=0 && at<record.values.length;at+=direction)if(nativeText(record.values[at])===text){record.at=at;return record.values[at];}
      // Ordinary typing may exceed the small state ring while the browser still
      // retains an older multiline undo step. Its newline checkpoint stays.
      if(record.newlines.has(text)){const value=record.newlines.get(text);record.values=[value];record.at=0;return value;}
    }
    const value=preserveRawEdit(previous,text);recordRawValue(record,value);return value;
  }
  function renderRanges(text, ranges) {
    text=String(text ?? '');let at=0;const clean=[];
    for(const [index,range] of (Array.isArray(ranges)?ranges.filter(range=>range && typeof range==='object'):[]).sort((a,b)=>a.start-b.start || b.end-a.end).entries()){
      if(!Number.isInteger(range.start)||!Number.isInteger(range.end)||range.start<at||range.end<=range.start||range.end>text.length)continue;
      clean.push({...range,classes:[range.className || 'hl'],attrs:{'data-ct-hl':index,'data-hl-id':index}});
      at=range.end;
    }
    return renderAnnotatedRanges(text,clean);
  }
  function renderAnnotatedRanges(text,ranges) {
    const source=String(text ?? ''),length=source.length,clean=(Array.isArray(ranges)?ranges:[]).filter(range=>range && typeof range==='object' && Number.isInteger(Number(range.start)) && Number.isInteger(Number(range.end)))
      .map(range=>({...range,start:Math.max(0,Math.min(length,Number(range.start))),end:Math.max(0,Math.min(length,Number(range.end)))})).filter(range=>range.end>range.start);
    const points=new Set([0,length]);for(let i=0;i<length;i++)if(source[i]==='\r' || source[i]==='\n'){
      const end=i+(source[i]==='\r' && source[i+1]==='\n'?2:1);points.add(i);points.add(end);i=end-1;
    }
    for(const range of clean){points.add(range.start);points.add(range.end);}const sorted=[...points].sort((a,b)=>a-b);let html='';
    for(let index=0;index<sorted.length-1;index++){
      const start=sorted[index],end=sorted[index+1],raw=source.slice(start,end),active=clean.filter(range=>range.start<end && start<range.end);
      if(!active.length || /^[\r\n]+$/.test(raw)){html+=escape(raw);continue;}
      const classes=[...new Set(active.flatMap(range=>range.classes || []))].filter(Boolean),messages=[...new Set(active.map(range=>range.message).filter(Boolean))];
      const metadata=active.find(range=>range.attrs)?.attrs || {},attrs=Object.entries(metadata)
        .filter(([name])=>/^data-[a-z0-9-]+$/.test(name)).map(([name,value])=>' '+name+'="'+escape(value)+'"').join('');
      html+='<span'+attrs+(classes.length?' class="'+escape(classes.join(' '))+'"':'')+(messages.length?' data-tooltip="'+escape(messages.join('\n'))+'"':'')+'>'+escape(raw)+'</span>';
    }
    return html;
  }
  function diagnosticPresentation(issues) {
    const diagnostics=(Array.isArray(issues)?issues:[]).filter(issue=>issue && typeof issue==='object')
      .map(issue=>({...issue,level:issue.level || issue.severity || 'warning',severity:issue.level || issue.severity || 'warning'}));
    const title=level=>{const matching=diagnostics.filter(issue=>issue.level===level),lines=matching.slice(0,8).map(issue=>issue.message || issue.code || 'Translation diagnostic');
      if(matching.length>8)lines.push('...and '+(matching.length-8)+' more');return lines.join('\n');};
    return {diagnostics,warningCount:diagnostics.filter(issue=>issue.level==='warning').length,errorCount:diagnostics.filter(issue=>issue.level==='error').length,
      warningTitle:title('warning'),errorTitle:title('error'),notes:diagnostics.filter(issue=>['clienttext-consistency','inconsistent-translation','dictionary-terminology'].includes(issue.code))
        .map(issue=>({...issue,kind:issue.code==='dictionary-terminology'?'terminology':'consistency'}))};
  }
  function ranges(host, field, text, source) {
    const tokens=root.ClientTextState?.tokenize(text) || [],output=tokens.map(token=>{
      const insertion=root.ClientTextState.tokenInsertion(token,text);
      return {start:token.start,end:token.end,value:token.full,identity:token.identity,kind:token.kind,
        className:token.kind==='keyword'?'hl keywordHL':'hl',replace:insertion.value,caretOffset:insertion.caretOffset};
    });
    if(source){
      const pack=host.ctDictionaryPack,unit=pack?.units?.find(unit=>unit.key===field.id && unit.english===text);
      for(const hl of unit?.HLs || []){
        if(!Number.isInteger(hl.rawStart))continue;
        const existing=output.find(range=>range.start===hl.rawStart && range.end===hl.rawEnd);
        if(existing)Object.assign(existing,{dictId:hl.dictId,replace:hl.replace || existing.value,dictDefFind:hl.dictDefFind,className:hl.dictId?'vocab':existing.className});
        else output.push({start:hl.rawStart,end:hl.rawEnd,value:text.slice(hl.rawStart,hl.rawEnd),replace:hl.replace,
          dictId:hl.dictId,dictDefFind:hl.dictDefFind,className:'vocab'});
      }
      const completion=host.ctCompletion,selected=completion?.items?.[completion.selectedIndex];
      if(completion?.fieldId===field.id && completion.source===text && host.ctCompletionValid?.(field)){
        for(const range of output)if(selected?.sourceRanges?.some(item=>range.start<=item.start && range.end>=item.end))range.className+=' hlPopupActive';
      }
    }
    return output.sort((a,b)=>a.start-b.start || b.end-a.end).reduce((all,range)=>{if(!all.length || range.start>=all[all.length-1].end)all.push(range);return all;},[]);
  }
  function insert(host, field, replacement, options={}) {
    if(!field || typeof replacement!=='string' || host.ctBusy || !host.ctActive || host.ctHistoryViewer)return false;
    const scope=key(host,false),unit=host.ctCurrentUnit,input=options.input || host.ctDictionaryTarget?.(field.id);
    if(!unit?.fields.includes(field) || !input || input.isConnected===false || input.composing || input.readOnly
      || input.dataset?.ctTarget && input.dataset.ctTarget!==field.id || input.dataset?.ctSource)return false;
    const previous=String(host.ctValues[field.id] ?? ''),start=options.whole ? 0 : options.raw ? options.start : rawOffset(previous,options.start ?? input.selectionStart ?? 0),
      end=options.whole ? previous.length : options.raw ? options.end : rawOffset(previous,options.end ?? input.selectionEnd ?? input.selectionStart ?? 0);
    if(typeof input.value==='string' && input.value!==previous.replace(/\r\n?/g,'\n') || !Number.isInteger(start) || !Number.isInteger(end) || start<0 || end<start || end>previous.length)return false;
    const next=previous.slice(0,start)+replacement+previous.slice(end),offset=Number.isInteger(options.caretOffset) ? Math.max(0,Math.min(replacement.length,options.caretOffset)) : replacement.length,
      caret=next.slice(0,start+offset).replace(/\r\n?/g,'\n').length;
    const history=rawHistory(host,field,previous);
    input.focus?.();
    const shownStart=previous.slice(0,start).replace(/\r\n?/g,'\n').length,shownEnd=previous.slice(0,end).replace(/\r\n?/g,'\n').length;
    input.setSelectionRange?.(shownStart,shownEnd);
    let native=false;
    try {native=!!root.document?.execCommand?.(replacement ? 'insertText' : 'delete',false,replacement || null);}catch(_){}
    if(!native){input.setRangeText?.(replacement.replace(/\r\n?/g,'\n'),shownStart,shownEnd,'end');}
    // Native input normalizes newline bytes. Keep its undo stack while retaining
    // the exact raw states that historyUndo/historyRedo must recover.
    rememberRawNewlines(history,previous,next);
    if(history.values[history.at]!==previous && nativeText(history.values[history.at])===nativeText(next))history.values[history.at]=next;else recordRawValue(history,next);
    host.ctValues[field.id]=next;host.ctFocusedField=field.id;host.ctEdited(field);host.ctCloseCompletion?.();
    host.$nextTick?.(()=>{const active=root.document?.activeElement;if(key(host,false)!==scope || host.ctCurrentUnit!==unit || host.ctFocusedField!==field.id || host.ctValues[field.id]!==next || input.isConnected===false
      || active && active!==input && active!==root.document.body && active!==root.document.documentElement)return;
      input.focus?.({preventScroll:true});input.setSelectionRange?.(caret,caret);host.ctResizeField?.(input);});return true;
  }
  function fieldController(host, field, sourceText) {
    const source=sourceText!==undefined,unit=host.ctCurrentUnit,captured=key(host,false),fieldId=field.id;
    const valid=()=>host.ctActive && key(host,false)===captured && host.ctCurrentUnit===unit && unit?.fields.includes(field);
    const value=()=>source ? String(sourceText) : String(host.ctValues[fieldId] ?? '');
    const list=()=>ranges(host,field,value(),source),descriptor={id:fieldId,isMultiline:true,
      get english(){return source ? value() : String(field.source ?? '');},get translation(){return value();},
      set translation(text){if(valid() && !host.ctBusy && !host.ctHistoryViewer)host.ctValues[fieldId]=applyRawInput(host,field,text);},get readonly(){return source || !valid() || host.ctBusy || host.ctHistoryViewer;},
      get placeholder(){return source?'English':field.kind==='form' && !field.required?'Optional translation':'Translation';},
      get lang(){return source?'en':host.translationEditorBcp47;},
      get dataAttrs(){const issues=diagnostics();
        return source ? {'data-ct-source':fieldId,'aria-label':field.name+' English'}
        : {'data-ct-target':fieldId,id:'ctfield-'+field.targetCell,'aria-label':field.name+(field.form?' '+(host.ctClassVariantLabel?.(field) ?? field.form):''),
          title:issues.map(issue=>issue.message).join('\n') || undefined,'aria-invalid':issues.some(issue=>(issue.level || issue.severity)==='error') || undefined,
          'aria-autocomplete':'list','aria-controls':'sharedEditorAutocompleteList','aria-expanded':host.ctCompletion?.fieldId===fieldId,
          'aria-activedescendant':host.ctCompletion?.fieldId===fieldId && host.ctCompletion?.items?.length?'sharedEditorAutocompleteOption-'+(host.ctCompletion.selectedIndex || 0):undefined};}};
    const diagnostics=()=>{
      const text=value(),exempt=field.kind==='gender' || root.ClientTextState?.allowsNonexistent(field) && text.trim()==='NONEXISTENT' || root.ClientTextState?.audioOnly(field.source);
      if(exempt)return [];
      const common=root.TranslationDiagnostics?.analyze(text,{lang:host.lang,contentMode:'clienttext',checks:{whitespace:true,dash:true,tagSyntax:false}})?.diagnostics || [],
        manualCurrent=!host.ctValuesFor || host.ctValuesFor(unit)[fieldId]===text;
      return [...(root.ClientTextState?.diagnose(field,text) || []),...common,
        ...(manualCurrent ? host.ctDiagnostics?.[unit?.id] || [] : []).filter(issue=>issue.fieldId===fieldId && ['clienttext-consistency','inconsistent-translation','dictionary-terminology'].includes(issue.code))];
    };
    const controller={field:descriptor,get ready(){return valid();},get diagnostics(){return diagnosticPresentation(diagnostics()).diagnostics;},
      get diagnosticPresentation(){return diagnosticPresentation(diagnostics());},get highlight(){return source ? renderRanges(value(),list()) : renderAnnotatedRanges(value(),[
      ...list().map(range=>({...range,classes:['tagRange',...(range.kind==='keyword'?['vocab']:[])]})),
      ...diagnostics().map(issue=>({...issue,classes:['diagnosticRange',(issue.level || issue.severity)==='error'?'diagError':'diagWarning']})),
    ]);},highlightAttrs:{},
      input(event){if(!valid() || host.ctBusy || host.ctHistoryViewer || event.isComposing || event.keyCode===229)return;
        host.ctValues[fieldId]=applyRawInput(host,field,event.target.value,event.inputType);host.ctEdited(field);host.ctResizeField(event.target);host.ctSuggest?.(field,event);},
      focus(event){if(!valid())return;host.ctFocusedField=fieldId;host.ctCompletionSelectionChanged?.(field,event);},
      keydown(event){if(!valid())return;host.ctTargetKeydown?.(field,event);},
      selection(event){if(valid())host.ctCompletionSelectionChanged?.(field,event);},
      blur(){/* The shared popup is part of the same editor focus surface. */},
      scroll(event){const overlay=event.target.parentElement?.querySelector?.('.HLter'),content=overlay?.querySelector?.('.editorHighlightContent') || overlay;
        if(content)content.style.transform='translate('+(-event.target.scrollLeft)+'px, '+(-event.target.scrollTop)+'px)';},
      paste(event){const text=event.clipboardData?.getData?.('text/plain');if(!valid() || source || typeof text!=='string')return;event.preventDefault();insert(host,field,text,{input:event.target});},
      altKeyup(event){if(!valid() || !event.altKey || event.ctrlKey || event.metaKey || !/^[0-9]$/.test(event.key))return;
        const tokens=ranges(host,field,String(field.source ?? ''),true),range=tokens[(Number(event.key)||10)-1];if(range)insert(host,field,range.replace || range.value,{input:event.target,caretOffset:range.caretOffset});},
      sourceClick(event){if(!valid())return;const span=event.target?.closest?.('[data-ct-hl]'),range=list()[Number(span?.dataset.ctHl)];if(!span || !range)return;
        if(event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey){host.ctOpenHighlightDictionary?.(field,range);return;}
        if(event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey){host.editorClipboard=range.value;root.navigator?.clipboard?.writeText?.(range.value).catch?.(()=>{});return;}
        if(!event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey)insert(host,field,range.replace || range.value,{caretOffset:range.caretOffset});},
      tooltip(event){if(!valid())return;
        if(!source){const overlay=event.target?.parentElement?.querySelector?.('.HLter'),span=host.getTooltipElementAtPoint?.(overlay,event.clientX,event.clientY,'.diagnosticRange[data-tooltip]');
          if(span)host.showTooltip?.(event,span.getAttribute('data-tooltip'));else host.hideTooltip?.();return;}
        const span=event.target?.closest?.('[data-ct-hl]'),index=Number(span?.dataset.ctHl),range=list()[index];if(!range)return;
        const word=(host.dictionary || []).find(word=>String(word._id)===String(range.dictId));host.showTooltip?.(event,
          [range.value,word?.replace,word?.tlnote,'Click / Alt+'+(index+1)+' = Paste below','Alt+Click = Copy to Clipboard',
            range.dictId?'Ctrl+Click = Jump to Dictionary':range.kind==='keyword'?'Ctrl+Click = Add to Dictionary':''].filter(Boolean).join('\n'));},
      hideTooltip(){host.hideTooltip?.();}};
    controller.commitInput=controller.input;
    return controller;
  }
  function memoryKeydown(controller,event) {
    if(event.defaultPrevented || event.isComposing || event.keyCode===229)return;
    if(controller.isFilterFocusShortcut?.(event)){event.preventDefault();if(controller.tmManageAvailable!==false)controller.openTMManager?.();return;}
    if(event.target?.matches?.('input,textarea,select') || event.target?.matches?.('button') && event.target.getAttribute?.('role')!=='option')return;
    if(event.key==='ArrowDown' || event.key==='ArrowUp'){
      event.preventDefault();controller.tmSelectedIndex=Math.max(0,Math.min(controller.tmMatches.length-1,controller.tmSelectedIndex+(event.key==='ArrowDown'?1:-1)));
    } else if(event.key==='Enter'){event.preventDefault();controller.useTMMatch();}
  }
  function dispatchShortcut(host,event) {
    if(event.defaultPrevented || event.isComposing || event.keyCode===229 || event.target?.composing || root.AppDialogs?.isOpen)return true;
    if(host.ctActive){host.ctKey(event);return true;}
    return false;
  }
  // These contracts keep workbook data and SD recovery/save rules outside the
  // native controls. Hidden fields remain part of ClientText's field contract.
  function formatAdapter(host,id) {
    const ct=id==='clienttext',getFields=()=>ct ? (host.ctCurrentUnit?.fields || []).map(field=>({
      sessionKey:key(host,false),unitId:host.ctSelection,
      identity:JSON.stringify([host.ctSelection,field.id]),id:field.id,source:field.source,target:host.ctValues[field.id] ?? '',
      control:field.kind==='gender' && !host.ctGenderMultiline?.(field)?'input':'textarea',tokens:root.ClientTextState?.tokenize(field.source) || [],
      diagnostics:fieldController(host,field).diagnostics,metadata:field,
    })) : (host.editorBlocks || []).flatMap((block,index)=>(block.isTable?block.tableColumns:[block]).map((field,column)=>({
      sessionKey:key(host,false),unitId:host.editorCurrentEditingDesc?.filepath,
      identity:JSON.stringify([host.editorCurrentEditingDesc?.filepath,index,block.isTable?column:null]),id:index+':'+column,
      source:field.english,target:field.translation,control:field.isMultiline?'textarea':'input',tokens:field.HLs || [],
      diagnostics:field.translationDiagnostics || [],metadata:{blockIndex:index,columnIndex:block.isTable?column:null,block,field},
    })));
    const fieldCurrent=field=>!field || field.sessionKey===key(host,false) && field.unitId===(ct?host.ctSelection:host.editorCurrentEditingDesc?.filepath)
      && (ct ? host.ctCurrentUnit?.fields.includes(field.metadata) : host.editorBlocks?.includes(field.metadata.block)
        && (field.metadata.block.isTable?field.metadata.block.tableColumns.includes(field.metadata.field):field.metadata.block===field.metadata.field));
    const inputFor=field=>!fieldCurrent(field)?null:ct ? host.ctDictionaryTarget?.(field?.id || host.ctFocusedField) : host.getEditorRef?.('translation',
      field?.metadata.blockIndex ?? host.editorFocusedIndex,field?.metadata.columnIndex ?? (host.editorBlocks?.[host.editorFocusedIndex]?.isTable?host.editorFocusedColumnIndex:null));
    const actions={
      save:options=>ct ? host.ctSave(!!options?.close,options) : host.editorSave(options),
      complete:()=>ct ? host.ctSave(false) : host.editorSave({close:false}),
      navigate:reverse=>ct ? host.ctSaveAndNavigate(reverse) : host.saveAndSkipFile(reverse,true),
      copy:text=>{host.editorClipboard=String(text);return root.navigator?.clipboard?.writeText?.(String(text));},
      captureSelection:field=>{const input=inputFor(field);return input?{identity:field?.identity,start:input.selectionStart,end:input.selectionEnd,direction:input.selectionDirection,scrollTop:input.scrollTop,scrollLeft:input.scrollLeft,value:input.value,scope:key(host)}:null;},
      restoreSelection:(field,selection)=>{if(!selection || selection.scope!==key(host) || selection.identity!==field?.identity)return false;
        const input=inputFor(field);if(!input || input.isConnected===false || selection.value!==input.value)return false;input.focus?.({preventScroll:true});
        input.setSelectionRange?.(selection.start,selection.end,selection.direction);input.scrollTop=selection.scrollTop;input.scrollLeft=selection.scrollLeft;return true;},
      focus:field=>fieldCurrent(field) && (ct ? host.ctFocusTarget(false,field?.id) : inputFor(field)?.focus?.()),
      insert:(field,text)=>fieldCurrent(field) && (ct ? insert(host,host.ctCurrentUnit?.fields.find(value=>value.id===field.id),text) : host.insertTranslationText(field.metadata.blockIndex,text,{columnIndex:field.metadata.columnIndex || 0})),
      edit:(field,text)=>{if(!fieldCurrent(field))return false;if(ct){const actual=host.ctCurrentUnit?.fields.find(value=>value.id===field.id);if(actual&&!host.ctBusy && !host.ctHistoryViewer){host.ctValues[field.id]=String(text);host.ctEdited(actual);}}
        else if(!host.editorTranslationReadOnly){field.metadata.field.translation=String(text);host.refreshEditorBlockHLter(field.metadata.blockIndex);host.queueEditorDraft?.();}},
    };
    return {id,get context(){return context(host);},get fields(){return getFields();},actions,
      get tools(){return host.sharedEditorController;},
      capabilities:ct ? {forms:true,gender:true,developerNotes:true,optionalBlank:true,nonexistentForms:true,outdatedReview:true,translationChoices:true}
        : {tableSplitting:true,entryAlignment:true,dnt:true,droppedRecovery:true},
      slots:ct ? ['developerNotes','formGrid','classVariants','outdatedReview','translationChoices'] : ['entryAlignment','droppedRecovery','dnt'],
    };
  }
  function create(host) {
    const refs=new Map();
    const aliases={
      editorVisible:()=>host.ctEditor,editorReady:()=>!!host.ctWorkspace && !host.ctInitializing,
      editorCurrentEditingDesc:()=>host.ctCurrentUnit ? {filename:host.ctCurrentUnit.recordId,filepath:host.ctCurrentUnit.id}:null,
      editorTranslationReadOnly:()=>host.ctBusy || !host.ctCurrentUnit,editorCompareActive:()=>host.ctHistoryViewer,
      editorFocusedIndex:()=>Math.max(0,host.ctFieldsFor().findIndex(field=>field.id===host.ctFocusedField)),
      sideTab:()=>host.ctTool,entryAlignment:()=>null,historyClientText:()=>true,dictionaryReady:()=>host.ctDictionaryReady,
      dictionaryFilter:()=>host.ctDictionaryFilter,dictionaryPage:()=>host.ctDictionaryPage,dictionaryPageCount:()=>host.ctDictionaryPageCount,
      dictionaryRangeLabel:()=>host.ctDictionaryRangeLabel,visibleDictionary:()=>host.ctDictionaryVisible,
      sideAddClicked:()=>()=>host.ctDictionaryAdd(),setDictionaryPage:()=>page=>host.ctSetDictionaryPage(page),
      tmConflicts:()=>[],tmUnits:()=>host.ctMemory,tmBusy:()=>host.ctBusy,tmLocalIssue:()=>host.ctError,tmIssue:()=>'',
      tmEditorKey:()=>host.ctPreviewField?.id || '',tmLastMatchKey:()=>host.ctPreviewField?.id || '',tmMatches:()=>host.ctMemoryResults,
      tmSelectedMatch:()=>host.ctMemoryResults[host.tmSelectedIndex || 0] || null,tmText:()=>text=>String(text ?? ''),
      tmMatchLabel:()=>match=>match.score===101?'Context match':match.kind==='exact'?'Exact match':'Fuzzy match',
      tmMatchContext:()=>unit=>[unit.context?.role,unit.context?.sheet,unit.context?.recordId,unit.context?.fieldName,unit.context?.form].filter(Boolean).join(' · '),
      useTMMatch:()=>match=>host.ctApplyMemory(match || host.ctMemoryResults[host.tmSelectedIndex || 0]),
      tmPanelKeydown:()=>event=>memoryKeydown(proxy,event),
      tmManageAvailable:()=>false,tmPrefillAvailable:()=>false,inlineRowFocusOut:()=>event=>host.ctInlineFocusOut(event),
    };
    const setters={sideTab:value=>{host.ctTool=value;},dictionaryFilter:value=>{host.ctDictionaryFilter=value;},dictionaryPage:value=>{host.ctDictionaryPage=value;}};
    const adapters={statdescription:formatAdapter(host,'statdescription'),clienttext:formatAdapter(host,'clienttext')};
    const extra={controller:null,get adapter(){return adapters[mode(host)];},get context(){return context(host);},registerRefs(componentRefs,surface){
      const previous=refs.get(surface) || {};
      const registered=host._sharedEditorRefs ||= Object.create(null);
      for(const [name,value]of Object.entries(previous))if(registered[name]===value && !Object.hasOwn(componentRefs,name))delete registered[name];
      for(const [name,value]of Object.entries(componentRefs || {}))registered[name]=value;
      refs.set(surface,{...componentRefs});},unregisterRefs(surface){extra.registerRefs({},surface);refs.delete(surface);},
      getSessionContext:()=>context(host),sessionCurrent:captured=>JSON.stringify(context(host))===JSON.stringify(captured)};
    const proxy=new Proxy(extra,{
      get(target,name){if(name in target)return target[name];if(host.ctActive && name in aliases)return aliases[name]();
        if(host.ctActive && name in (host.ctDictionaryController || {}) && !String(name).startsWith('lookup'))return host.ctDictionaryController[name];
        if(!host.ctActive && ['historyClientText','tmManageAvailable','tmPrefillAvailable'].includes(name))return name!=='historyClientText';
        if(!host.ctActive && name==='dictionaryReady')return host.editorReady;
        const value=host[name];return typeof value==='function'?value.bind(host):value;},
      set(target,name,value){if(host.ctActive && setters[name])setters[name](value);else host[name]=value;return true;},
      has(target,name){return name in target || name in aliases || name in host;},
      ownKeys(){return [...new Set([...Object.keys(host),...Object.keys(aliases),...Object.keys(extra)])];},
      getOwnPropertyDescriptor(){return {enumerable:true,configurable:true};},
    });extra.controller=proxy;return proxy;
  }
  function toolsView(host) {
    const scope={...context(host),profileId:host.cloudProfileId || '',catalogScope:host.managedCatalogScope || ''};delete scope.fieldId;
    return {scope:JSON.stringify(scope),target:host.sharedEditorToolsTarget,
      tool:host.ctActive ? host.ctTool : host.sideTab,node:host.getEditorComponentRef('editorSide')};
  }
  const mixin={
    mounted(){this._sharedEditorToolsView=toolsView(this);},
    beforeUpdate(){
      // Capture before the root removes the old host; a detached scrollport
      // loses its offsets before the Teleport child updates.
      const view=this._sharedEditorToolsView,node=view?.node;
      this._sharedEditorToolsScroll=node?.isConnected ? {...view,top:node.scrollTop,left:node.scrollLeft}:null;
    },
    updated(){
      const view=toolsView(this),saved=this._sharedEditorToolsScroll;
      if(saved && saved.node===view.node && view.node?.isConnected && saved.target!==view.target
        && saved.scope===view.scope && saved.tool===view.tool){
        view.node.scrollTop=saved.top;view.node.scrollLeft=saved.left;
      }
      this._sharedEditorToolsView=view;this._sharedEditorToolsScroll=null;
    },
    beforeUnmount(){this._sharedEditorToolsView=null;this._sharedEditorToolsScroll=null;},
    computed:{
    sharedEditorController(){return this._sharedEditorController ||= create(this);},
    sharedEditorPreviewController(){return this.sharedEditorController;},sharedEditorPopupController(){return this.ctActive ? this.clientTextPopupController() : this.sharedEditorController;},
    sharedEditorToolsMounted(){return this.ctActive ? !!this.ctWorkspace && !this.versionChooserVisible && (this.ctEditor || this.inlineEditor) : this.editorToolsMounted;},
    sharedEditorToolsVisible(){return this.sharedEditorToolsMounted && !this.workspaceInitializationActive && (this.ctEditor || this.editorVisible || this.inlineSidebarVisible);},
    sharedEditorToolsTarget(){return this.ctActive ? (this.ctEditor?'#ctFullEditorSidebarHost':'#ctInlineEditorSidebarHost') : (this.editorVisible?'#fullEditorSidebarHost':'#inlineEditorSidebarHost');},
    sharedEditorPreviewMounted(){return this.gamePreviewMounted;},sharedEditorPreviewTarget(){return this.gamePreviewFullEditor ? this.gamePreviewTarget : '#inlineEditorPreviewHost';},
    sharedCommentIdentity(){const ctx=context(this);return {...ctx,filepath:ctx.unitId,label:this.ctActive ? [this.ctCurrentUnit?.role,this.ctCurrentUnit?.sheet,this.ctCurrentUnit?.recordId].filter(Boolean).join(' / '):ctx.unitId,
      sourceHash:this.ctActive?this.ctWorkspace?.metadata?.descriptors?.find(asset=>asset.role===this.ctCurrentUnit?.role)?.baselineId
        || this.ctWorkspace?.metadata?.assets?.find(asset=>asset.role===this.ctCurrentUnit?.role)?.compact?.hash || this.ctWorkspace?.scope.sourceHash || '':this.sourceIdentity};},
  },methods:{
    getEditorComponentRef(name){return this._sharedEditorRefs?.[name] || this.$refs?.[name];},
    sharedCommentIdentityFor(filepath){const identity=this.sharedCommentIdentity;if(!this.ctActive)return identity;
      const unit=this._ctUnitIndex?.get(filepath);if(!unit)return identity;
      return {...identity,filepath,label:[unit.role,unit.sheet,unit.recordId].filter(Boolean).join(' / '),
        sourceHash:this.ctWorkspace?.metadata?.descriptors?.find(asset=>asset.role===unit.role)?.baselineId || this.ctWorkspace?.metadata?.assets?.find(asset=>asset.role===unit.role)?.compact?.hash || ''};},
    editorLookupSession(){const ctx=context(this);return {mode:ctx.mode,scope:ctx,language:ctx.language,unitId:ctx.unitId,
      toolsVisible:this.sharedEditorToolsMounted && (this.ctEditor || this.editorVisible || this.inlineSidebarVisible),tool:this.ctActive?this.ctTool:this.sideTab,
      version:this.ctActive ? this.ctWorkspace?.metadata?.version || this.ctWorkspace?.version : this.managedActiveVersion,group:this.activeContentGroup};},
  }};
  return {mixin,context,key,create,fieldController,formatAdapter,renderRanges,renderAnnotatedRanges,diagnosticPresentation,ranges,insert,preserveRawEdit,applyRawInput,rawOffset,escape,memoryKeydown,dispatchShortcut};
});
