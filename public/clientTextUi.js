(function (root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.ClientTextUI = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
    'use strict';
    const teams = ['French', 'German', 'Spanish', 'Portuguese', 'Russian', 'Thai', 'Korean', 'Japanese', 'Simplified Chinese', 'Traditional Chinese', 'Turkish', 'Polish'];
    const copy = value => JSON.parse(JSON.stringify(value));
    const raw = value => root.Vue?.markRaw ? root.Vue.markRaw(value) : value;
    const uuid = () => root.crypto.randomUUID();
    const mode = group => String(group?.contentMode || group?.mode || '').toLowerCase();
    const statusFilters = [
        {key:'missing',label:'Missing translation',tone:'missing'}, {key:'saved',label:'Saved changes',tone:'saved'},
        {key:'revised',label:'Revised translations',tone:'revised'}, {key:'outdated',label:'Outdated translation',tone:'outdated'},
        {key:'error',label:'Diagnostic errors',tone:'error'}, {key:'warning',label:'Diagnostic warnings',tone:'warning'},
        {key:'unchanged',label:'Unchanged',tone:'unchanged'}
    ];
    // CT drafts currently have no sparse list index. Keep complete records
    // visible so a durable draft can always be reopened after a reload.
    const defaultFilters = () => statusFilters.filter(item=>item.key!=='unchanged').map(item=>item.key);
    const rowControl = event => !!event?.target?.closest?.('textarea,input,select,button,label,a,[contenteditable="true"],.HLter');
    const genderSuggestions = ['M', 'F', 'N', 'MP', 'FP', 'NP'];
    function genderRawOffset(value,offset) {
        let raw=0,shown=0;while(raw<value.length && shown<offset){raw+=value[raw]==='\r' && value[raw+1]==='\n'?2:1;shown++;}return raw;
    }
    function detect(filename) {
        const stem=String(filename).replace(/\.[^.]+$/,''),name=stem.replace(/[_.\s-]+/g,' ').trim().toLowerCase();
        const language=teams.find(team=>name===team.toLowerCase() || name.startsWith(team.toLowerCase()+' ')) || '';
        return { language, role: /(?:^|[_.\s-])Gender(?=$|[_.\s-])/i.test(stem) ? 'gender' : 'normal' };
    }
    function groupFields(unit) {
        const groups = [];
        for (const field of unit?.fields || []) {
            const key = field.kind === 'form' ? field.group || field.name : field.id;
            let group = groups.find(item => item.key === key);
            if (!group) groups.push(group = { key, name: field.name, source: field.source, fields: [], forms: field.kind === 'form' });
            group.fields.push(field);
        }
        return groups;
    }
    function assetBytes(asset) { return asset?.blob || asset?.bytes || asset?.buffer; }
    function historySnapshot(unit, record) {
        // History values are scoped to one immutable group. English/layout
        // come from its verified client original, never an unverified payload
        // or an ancestral group's source guessed from translation history.
        const context = unit;
        const values = Object.fromEntries(context.fields.map(field => [field.id,
            typeof record?.values?.[field.id] === 'string' ? record.values[field.id] : String(field.target ?? '')]));
        return { unit: copy(context), values, reviewed: copy(record?.reviewed || {}), available: !record || !!record.values,
            originalContext: context === unit, provenance: copy(record?.provenance || {}) };
    }
    function normalizeHistory(entry, origin, unit, ctx) {
        const record = entry.after || entry.saved || entry.value || entry;
        const unitId = entry.unitId || record.unitId || (record !== entry ? record.id : '') || unit.id;
        if (unitId !== unit.id) return null;
        const createdAt = entry.createdAt || entry.at || record.savedAt || 0;
        const time = typeof createdAt === 'number' ? createdAt : Date.parse(createdAt) || 0;
        const key = origin + ':' + String(entry.id ?? entry.jobId ?? root.ClientTextState.hash([unitId, time, entry.before, record]));
        return { key, id: entry.id, unitId, origin, action: entry.origin || record.origin || 'save', createdAt: time,
            actor: copy(entry.actor || {}), before: historySnapshot(unit, entry.before || null), after: historySnapshot(unit, record),
            context: copy(ctx), provenance: copy(record.provenance || {}), sequence: entry.sequence };
    }
    const mixin = {
        data() { return {
            ctActive: false, ctWorkspace: null, ctUnits: raw([]), ctSaved: raw({}), ctRevision: 0,
            ctSheet: '', ctSearch: '', ctAppliedSearch: '', ctFilter: '', ctPage: 1, ctPageSize: 20,
            ctSort: 'filename', ctSortDir: 'asc', ctSelectedFilters: defaultFilters(), ctFiltersVisible: false, ctIncludeConsistency: false,
            ctSelection: '', ctEditor: false, ctInlineClosed: false, ctValues: {}, ctReviewed: {}, ctDraftDirty: false, ctCompletion: null,
            ctBusy: false, ctProgress: null, ctError: '', ctNotice: '', ctDiagnostics: raw({}), ctScanDone: false,
            ctHistory: [], ctHistoryLoading: false, ctHistoryPreviousLoading: false, ctHistoryError: '', ctHistoryCursor: null, ctHistoryLocalMore: false,
            ctHistoryCompareA: 'original', ctHistoryCompareB: 'current', ctHistoryWhitespace: false, ctHistoryCharacters: true, ctHistoryViewer: false,
            ctTool: 'dictionary', ctLookup: '', ctFocusedField: '', ctMemory: raw([]), ctComments: [], ctCommentText: '', ctCommentGlobal: false, ctChoices: [],
            ctDictionaryFilter:'',ctDictionaryPage:1,ctDictionaryEditingId:'',ctDictionaryEditOrder:[],
            ctPreviewGggVars: {},
            ctPeers: [], ctLocalWorkspaces: [], ctRequests: [], ctUploadVisible: false, ctUploadLocal: false,
            ctUploadVersion: null, ctUploadName: '', ctUploadDeadline: '', ctUploadFiles: raw([]), ctPrepared: raw([]),
            ctUploadAssignments: teams.slice(), ctPolicy: null, ctPolicyText: '', ctUploadError: '', ctUploading: false, ctDuplicateChoices: {},
            activeContentGroup: null, ctTeamOptions: teams
        }; },
        computed: {
            ctGroups() { return this.managedSelectedDetails?.contentGroups || this.managedSelectedVersion?.contentGroups || []; },
            ctAssignmentRows() {
                const version=this.managedSelectedVersion;
                if(!version || this.managedCatalogAccess===false || (version.game && version.game!==this.gameVersion)
                    || (version.branchId || 'default')!==(this.branchId || 'default'))return [];
                const details=this.managedSelectedDetails;
                const matches=!details?.version?.id || details.version.id===version.id;
                const groups=matches ? this.ctGroups : version.contentGroups || [];
                const eligibleGroups=(groups || []).filter(group=>group?.id && ['clienttext','statdescription'].includes(mode(group))
                    && (!group.versionId || group.versionId===version.id) && (!group.version?.id || group.version.id===version.id)
                    && (!group.version?.game || group.version.game===this.gameVersion)
                    && (!group.version?.branchId || group.version.branchId===(this.branchId || 'default')));
                const assigned=this.managedSingleLanguage || this.cloudUser?.language;
                const allowed=team=>!!team?.language && (this.cloudCanAccessAllLanguages || team.language===assigned);
                const rows=[],seen=new Set();
                const add=(group,team,legacy,contentMode)=>{
                    if(!allowed(team))return;
                    const identity=legacy ? ['legacy',version.id,team.language] : [group.id,contentMode,team.language];
                    const key=JSON.stringify(identity);if(seen.has(key))return;seen.add(key);
                    rows.push({key,group,team,legacy,contentMode,label:team.language+' — '+(contentMode==='clienttext'?'ClientText':'StatDescription')});
                };
                // Old APIs expose team details directly. Prefer that richer
                // legacy row (including presence), deduplicating its group copy.
                // Modern SD activation also caches its teams at the top level;
                // explicit groups remain authoritative for that cached payload.
                const legacyFallback=!groups?.length || eligibleGroups.some(group=>group.legacyVersionId && mode(group)==='statdescription');
                if(matches && legacyFallback)for(const team of details?.teams || [])add(null,team,true,'statdescription');
                for(const group of eligibleGroups){
                    const contentMode=mode(group);
                    for(const team of group.teams || [])add(group,team,!!group.legacyVersionId,contentMode);
                }
                const modifier=this.managedTeamSortDir==='desc'?-1:1;
                const label=(a,b)=>a.label.localeCompare(b.label,undefined,{numeric:true,sensitivity:'base'}) || a.key.localeCompare(b.key);
                return rows.sort((a,b)=>{
                    if(this.managedTeamSort==='language')return label(a,b)*modifier;
                    const first=this.ctAssignmentProgress(a),second=this.ctAssignmentProgress(b);
                    return (first.percent-second.percent || second.total-first.total)*modifier || label(a,b);
                });
            },
            ctCurrentUnit() { this.ctUnits;const id=this.ctSelection;return this._ctUnitIndex?.get(id) || null; },
            ctPreviewMounted() { return this.ctActive && !this.versionChooserVisible && !!this.ctCurrentUnit && (this.ctEditor || this.inlineEditor); },
            ctPreviewField() {
                const fields=this.ctFieldsFor();
                return fields.find(field=>field.id===this.ctFocusedField && field.kind!=='gender') || fields.find(field=>field.kind!=='gender') || null;
            },
            ctGamePreview() {
                const empty={segments:[],keysOrder:[]};
                if(!this.ctActive)return {source:empty,target:empty};
                const field=this.ctPreviewField;
                if(!field)return {source:empty,target:empty};
                return {source:this.buildGamePreviewSegments(field.source,{contentMode:'clienttext'}),
                    target:this.buildGamePreviewSegments(this.ctValues[field.id] ?? '',{contentMode:'clienttext'})};
            },
            ctPreviewKeys() { return [...new Set([...this.ctGamePreview.source.keysOrder,...this.ctGamePreview.target.keysOrder])]; },
            ctFieldGroups() { return groupFields({fields:this.ctFieldsFor()}); },
            ctHistoryChoices() {
                return [{ key: 'original', label: 'Original workbook' }, { key: 'current', label: 'Current draft / saved translation' },
                    ...this.ctHistory.flatMap(entry => ['before', 'after'].map(side => ({ key: entry.key + ':' + side,
                        label: this.ctHistoryLabel(entry) + ' · ' + side, unavailable: !entry[side].available })))];
            },
            ctHistoryPreviousProvenance() {
                const currentGroup = this.ctWorkspace?.scope.groupId;
                return [this.ctSaved[this.ctSelection]?.provenance, ...this.ctHistory.map(entry => entry.provenance)]
                    .find(value => value?.groupId && value.groupId !== currentGroup) || null;
            },
            ctHistoryComparison() {
                const before = this.ctHistorySnapshotFor(this.ctHistoryCompareA), after = this.ctHistorySnapshotFor(this.ctHistoryCompareB);
                if (!before || !after) return null;
                const fields = new Map([...before.unit.fields, ...after.unit.fields].map(field => [field.id, field]));
                const rows = [...fields.values()].map(field => {
                    const a = before.unit.fields.find(value => value.id === field.id), b = after.unit.fields.find(value => value.id === field.id);
                    return { id: field.id, name: field.name, kind: field.kind, form: field.form || '',
                        beforeSource: String(a?.source ?? ''), afterSource: String(b?.source ?? ''),
                        beforeTarget: before.values[field.id] ?? '', afterTarget: after.values[field.id] ?? '',
                        sourceParts: this.ctHistoryDiffParts(a?.source ?? '', b?.source ?? ''),
                        targetParts: this.ctHistoryDiffParts(before.values[field.id] ?? '', after.values[field.id] ?? ''),
                        removed: !b, added: !a };
                });
                const aNotes = this.ctNotes(before.unit).join('\n\n'), bNotes = this.ctNotes(after.unit).join('\n\n');
                return { before, after, rows, notes: this.ctHistoryDiffParts(aNotes, bNotes), hasNotes: !!(aNotes || bNotes) };
            },
            ctSheets() { this.ctUnits; return this._ctSheets || []; },
            ctDiagnosticCounts() {
                const counts={error:0,warning:0};
                for(const issues of Object.values(this.ctDiagnostics))for(const severity of ['error','warning'])if(issues.some(issue=>issue.severity===severity))counts[severity]++;
                return counts;
            },
            ctStatusFilterOptions() {
                const counts={...this.ctCounts,error:0,warning:0};
                for(const issues of Object.values(this.ctDiagnostics))for(const severity of ['error','warning'])if(issues.some(issue=>issue.severity===severity))counts[severity]++;
                return statusFilters.map(item=>({...item,count:counts[item.key] || 0}));
            },
            ctEffectivePageSize() { return Math.max(1,Math.floor(Number(this.pageSize || this.ctPageSize) || 20)); },
            ctRows() {
                this.ctRevision;
                const query = this.ctAppliedSearch.toLocaleLowerCase();
                return this.ctOrderedUnits().filter(unit => {
                    const fields=this.ctFieldsFor(unit);if(!fields.length)return false;
                    if (this.ctSheet && JSON.stringify([unit.role, unit.sheet]) !== this.ctSheet) return false;
                    const status = this.ctStatus(unit);
                    if (this.ctFilter === 'error' || this.ctFilter === 'warning') {
                        if (!(this.ctDiagnostics[unit.id] || []).some(item => item.severity === this.ctFilter)) return false;
                    } else if (this.ctFilter && !status[this.ctFilter]) return false;
                    if(!this.ctFilter && !this.ctSelectedFilters.some(key=>key==='error'||key==='warning'
                        ? (this.ctDiagnostics[unit.id] || []).some(issue=>issue.severity===key) : status[key]))return false;
                    if (!query) return true;
                    const values = root.ClientTextState.valuesFor(unit, this.ctSaved[unit.id]);
                    return [unit.recordId, unit.sheet, ...fields.flatMap(field => [field.source, values[field.id]]), ...this.ctNotes(unit)].some(text => String(text).toLocaleLowerCase().includes(query));
                });
            },
            ctPageRows() { return this.ctRows.slice((this.ctPage - 1) * this.ctEffectivePageSize, this.ctPage * this.ctEffectivePageSize); },
            ctPageCount() { return Math.max(1, Math.ceil(this.ctRows.length / this.ctEffectivePageSize)); },
            ctCounts() {
                this.ctRevision;
                const counts={total:this.ctUnits.length,missing:0,outdated:0,revised:0,saved:0,unchanged:0};
                for(const unit of this.ctUnits){const status=this.ctStatus(unit);for(const name of ['missing','outdated','revised','saved','unchanged'])if(status[name])counts[name]++;}
                return counts;
            },
            ctWorkProgress() {
                this.ctRevision;
                let total = 0, resolved = 0;
                for (const unit of this._ctWorkUnits?.values() || []) {
                    const status = this.ctStatus(unit);
                    for (const field of unit.fields) if (field.originalMissing || field.outdated || this.ctSaved[unit.id]?.outdated?.includes(field.id)) {
                        total++; if (!status.fields[field.id]?.missing && !status.fields[field.id]?.outdated) resolved++;
                    }
                }
                return { total, resolved, percent: total ? Math.floor(100 * resolved / total) : 100 };
            },
            ctLookupResults() {
                const current=this.ctCurrentUnit,fields=this.ctFieldsFor(current),focused=fields.find(field=>field.id===this.ctFocusedField && field.kind!=='gender') || fields.find(field=>field.kind!=='gender');
                const query=(this.ctLookup || focused?.source || '').toLocaleLowerCase();
                if (!query) return [];
                const output = [];
                const kinds = new Set(focused ? [JSON.stringify([focused.kind,focused.form || null])] : []);
                for (const unit of this.ctUnits) {
                    if (unit.id === current?.id) continue;
                    const values = root.ClientTextState.valuesFor(unit, this.ctSaved[unit.id]);
                    for (const field of this.ctFieldsFor(unit)) {
                        const target = values[field.id];
                        if (field.kind === 'gender' || !target?.trim() || target.trim() === 'NONEXISTENT' || !kinds.has(JSON.stringify([field.kind, field.form || null]))) continue;
                        if (field.source.toLocaleLowerCase().includes(query)) output.push({ unitId: unit.id, sheet: unit.sheet, recordId: unit.recordId, name: field.name, form: field.form, source: field.source, target });
                        if (output.length >= 40) return output;
                    }
                }
                return output;
            },
            ctMemoryResults() {const unit=this.ctCurrentUnit,field=this.ctPreviewField;return field ? root.ContentAdapters.clienttext.findMemory(this.ctMemory,unit,field,{game:this.gameVersion,limit:20}) : [];},
            ctDictionaryMatches() {
                return (this.dictionary || []).filter(entry=>this.ctDictionaryMatchedDefinitions.has(String(entry?._id || '')));
            },
            ctDictionaryReady() {
                return !!(this.ctActive && this.ctWorkspace && this.ctCurrentUnit && !this.ctBusy && !this.ctHistoryViewer
                    && !this.versionChooserVisible && !this.settingsDialogVisible && !this.showSetting
                    && (!this.lang || this.lang===this.ctWorkspace.scope.language)
                    && this.gameVersion===this.ctWorkspace.scope.game && (this.branchId || 'default')===(this.ctWorkspace.scope.branchId || 'default'));
            },
            ctDictionaryScopeKey() {return JSON.stringify([this.ctContext(),this.ctSelection]);},
            ctDictionaryMatchedDefinitions() {
                const map=new Map(),texts=this.ctFieldsFor().filter(field=>field.kind!=='gender').map(field=>String(field.source || ''));
                const keywordNames=new Set(texts.flatMap(text=>root.ClientTextState.tokenize(text).filter(token=>token.kind==='keyword')
                    .map(token=>this.ctDictionaryKeywordName(token.identity).toLowerCase())));
                const active=this.getActiveDictionaryEntries?.() || root.DictionaryScope?.activeEntries(this.dictionary || [],this.gameVersion) || this.dictionary || [];
                for(const word of active){
                    const definitions=new Set(),pairs=this.ctDictionaryPairs(word);
                    for(const pair of pairs){
                        const find=String(pair.find || '').trim();if(!find)continue;
                        const pattern=new RegExp('\\b'+find.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b');
                        if(texts.some(text=>pattern.test(text)) || pair.isMain && keywordNames.has(find.toLowerCase()))definitions.add(find.toLowerCase());
                    }
                    if(definitions.size)map.set(String(word._id || ''),definitions);
                }
                return map;
            },
            ctDictionaryFiltered() {
                const entries=(this.dictionary || []).slice(),matched=this.ctDictionaryMatchedDefinitions;
                let ordered;
                if(this.ctDictionaryEditOrder.length){
                    const remaining=new Map(entries.map(word=>[String(word._id),word]));ordered=[];
                    for(const id of this.ctDictionaryEditOrder)if(remaining.has(id)){ordered.push(remaining.get(id));remaining.delete(id);}
                    ordered.push(...remaining.values());
                }else ordered=entries.filter(word=>matched.has(String(word._id))).concat(entries.filter(word=>!matched.has(String(word._id))));
                const filter=this.ctDictionaryFilter.trim().toLocaleLowerCase();
                return filter ? ordered.filter(word=>String(word._id)===this.ctDictionaryEditingId
                    || [word.find,word.replace,word.tlnote,...(word.alts || []).flatMap(alt=>[alt.find,alt.replace])].some(value=>String(value || '').toLocaleLowerCase().includes(filter))) : ordered;
            },
            ctDictionaryPageSize() {return Math.max(1,Number(this.dictionaryPageSize) || 50);},
            ctDictionaryPageCount() {return Math.max(1,Math.ceil(this.ctDictionaryFiltered.length/this.ctDictionaryPageSize));},
            ctDictionaryVisible() {
                if(!this.ctDictionaryReady)return [];
                const page=Math.min(this.ctDictionaryPage,this.ctDictionaryPageCount);
                return this.ctDictionaryFiltered.slice((page-1)*this.ctDictionaryPageSize,page*this.ctDictionaryPageSize).map(word=>this.getLiveDictionaryEntry?.(word) || word);
            },
            ctDictionaryRangeLabel() {
                const count=this.ctDictionaryFiltered.length,page=Math.min(this.ctDictionaryPage,this.ctDictionaryPageCount),size=this.ctDictionaryPageSize;
                const first=count ? (page-1)*size+1 : 0,last=Math.min(page*size,count);
                return first.toLocaleString('en-US')+'–'+last.toLocaleString('en-US')+' of '+count.toLocaleString('en-US');
            },
            ctDictionaryController() {
                const host=this,ctx=this.ctContext(),unitId=this.ctSelection,dictionary=this.dictionary,current=()=>host.ctDictionaryContextCurrent(ctx,unitId,dictionary);
                const member=word=>current() && host.ctDictionaryReady && dictionary?.includes(word);
                return {
                    get editorReady(){return current() && host.ctDictionaryReady;},get visibleDictionary(){return current() ? host.ctDictionaryVisible : [];},
                    get dictionaryFlashId(){return host.dictionaryFlashId;},get translationEditorBcp47(){return host.translationEditorBcp47;},
                    dictionaryMultiline:true,get dictionaryCanUse(){return current() && host.ctDictionaryReady && host.ctCurrentUnit?.fields.some(field=>field.id===host.ctFocusedField && field.kind!=='gender');},
                    get cloudEntryHistoryAvailable(){return current() && host.cloudEntryHistoryAvailable;},get cloudEntryHistoryHint(){return host.cloudEntryHistoryHint;},
                    isDictionaryEntryFound:word=>host.ctDictionaryMatchedDefinitions.has(String(word._id)),
                    isDictionaryEntryFindMatched:word=>host.ctDictionaryMatchedDefinitions.get(String(word._id))?.has(String(word.find || '').trim().toLowerCase()) || false,
                    isDictionaryAltFindMatched:(word,alt)=>host.ctDictionaryMatchedDefinitions.get(String(word._id))?.has(String(alt.find || '').trim().toLowerCase()) || false,
                    dictionaryEntryScope:word=>host.dictionaryEntryScope?.(word) || root.DictionaryScope?.normalize(word) || 'all',
                    dictionaryEntryScopeWarning:word=>host.dictionaryEntryScopeWarning?.(word) || '',
                    dictionaryEntryInput:word=>{if(member(word))host.dictionaryEntryInput?.(word);},
                    setDictionaryEntryScope:(word,scope)=>{if(member(word)){host.ctDictionaryBeginEdit(word._id);host.setDictionaryEntryScope?.(word,scope);}},
                    addDictionaryAltRow:word=>{if(member(word)){host.ctDictionaryBeginEdit(word._id);host.addDictionaryAltRow?.(word);}},
                    removeDictionaryAltRow:(word,alt)=>member(word) && host.removeDictionaryAltRow?.(word,alt,{isCurrent:()=>member(word)}),
                    removeVocab:word=>member(word) && host.removeVocab?.(word,{isCurrent:()=>member(word)}),
                    cloudOpenHistory:id=>{if(current() && host.cloudEntryHistoryAvailable && dictionary.some(word=>String(word._id)===String(id)))return host.cloudOpenHistory?.(id);},
                    useDictionaryTranslation:(word,alt,event)=>{
                        if(event){if(event.isComposing || event.keyCode===229)return false;event.preventDefault();event.stopPropagation?.();}
                        return member(word) && (!alt || word.alts?.includes(alt)) && host.ctDictionaryUse(word,alt,ctx,unitId,dictionary);
                    },
                    dictionaryEntryFocusIn:event=>{if(current())host.ctDictionaryFocusIn(event);},
                    dictionaryEntryFocusOut:event=>{if(current())host.ctDictionaryFocusOut(event,ctx,unitId,dictionary);},
                    onDictionaryReplaceEnter:()=>{},
                };
            },
        },
        watch: {
            ctDictionaryFilter() {this.ctDictionaryPage=1;},
            ctDictionaryPageCount(value) {this.ctDictionaryPage=Math.min(this.ctDictionaryPage,value);},
            ctDictionaryScopeKey() {this.ctDictionaryEndEdit();this.ctDictionaryPage=1;},
            ctPreviewKeys: {flush:'sync',handler(keys) {
                const next={};for(const key of keys)next[key]=this.ctPreviewGggVars[key] ?? this.defaultPreviewVarValue(key);
                this.ctPreviewGggVars=next;
            }},
            ctSearch() { clearTimeout(this._ctSearchTimer); this._ctSearchTimer = setTimeout(() => { this.ctAppliedSearch = this.ctSearch; this.ctPage = 1; }, 250); },
            ctFilter() { this.ctPage = 1; }, ctSheet() { this.ctPage = 1; },
            ctSelectedFilters: {deep:true,handler() {this.ctPage=1;}},
            inlineEditor() { this.ctFlushDraft().catch(()=>{});this.$nextTick?.(()=>this.ctRefreshLayout()); },
            ctFiltersVisible() { this.$nextTick?.(()=>this.ctRefreshLayout()); },
            ctPageCount(value) { this.ctPage = Math.min(this.ctPage, value); },
            managedCatalogScope() { this.ctFence(); this.ctRefreshLocal(); },
            lang() { if (this.ctActive && this.ctWorkspace?.scope.language !== this.lang) this.ctFence(); },
            gameVersion() { if (this.ctActive && this.ctWorkspace?.scope.game !== this.gameVersion) this.ctFence(); },
            versionChooserVisible(value) {
                if(value)this.ctRefreshLocal();
                else if(this.ctActive)this.$nextTick?.(()=>{if(this.ctActive && !this.versionChooserVisible)this.ctRefreshLayout();});
            }
        },
        mounted() { this._ctStore = root.ClientTextStore.create(); this._ctWorker = root.ClientTextWorkerClient.create(); },
        beforeUnmount() { this.ctFence(); this._ctWorker?.dispose(); clearTimeout(this._ctSearchTimer); },
        methods: {
            ctDictionaryKeywordName(identity) {return root.getKeywordPopupLookupName?.(identity) || String(identity).trim().replace(/<gemlevel=(?:\d+|\{\d+\})>$/i,'').trim();},
            ctDictionaryPairs(word) {
                return this.getDictionaryDefinitionPairs?.(word) || [{find:word.find,replace:word.replace,isMain:true},...(word.alts || []).map(alt=>({...alt,isMain:false}))];
            },
            ctDictionaryContextCurrent(ctx,unitId,dictionary) {return this.ctActive && this.ctCurrent(ctx) && this.ctSelection===unitId && this.dictionary===dictionary;},
            ctDictionaryBeginEdit(id,options={}) {
                id=String(id || '');if(!id || !(this.dictionary || []).some(word=>String(word._id)===id))return;
                if(!this.ctDictionaryEditOrder.length || options.newEntry){
                    const order=this.ctDictionaryFiltered.map(word=>String(word._id));this.ctDictionaryEditOrder=options.newEntry ? [id,...order.filter(value=>value!==id)] : order;
                }
                this.ctDictionaryEditingId=id;
            },
            ctDictionaryEndEdit() {this.ctDictionaryEditOrder=[];this.ctDictionaryEditingId='';if(this.ctActive)this.endDictionaryEdit?.();},
            ctDictionaryFocusIn(event) {
                const id=event.target?.closest?.('.editBlock[data-dict-id]')?.getAttribute?.('data-dict-id');if(id)this.ctDictionaryBeginEdit(id);
            },
            ctDictionaryFocusOut(event,ctx=this.ctContext(),unitId=this.ctSelection,dictionary=this.dictionary) {
                const nextId=event.relatedTarget?.closest?.('.editBlock[data-dict-id]')?.getAttribute?.('data-dict-id');
                if(nextId){this.ctDictionaryBeginEdit(nextId);return;}
                const id=this.ctDictionaryEditingId;
                this.$nextTick?.(()=>{
                    if(!this.ctDictionaryContextCurrent(ctx,unitId,dictionary) || id!==this.ctDictionaryEditingId)return;
                    const target=root.document?.activeElement,active=target?.closest?.('.ctTools .editBlock[data-dict-id]')?.getAttribute?.('data-dict-id');
                    if(active && this.ctTool==='dictionary')this.ctDictionaryBeginEdit(active);else this.ctDictionaryEndEdit();
                });
            },
            ctSetDictionaryPage(page) {
                this.ctDictionaryEndEdit();this.ctDictionaryPage=Math.max(1,Math.min(Number(page) || 1,this.ctDictionaryPageCount));
                this.$nextTick?.(()=>{const side=root.document?.querySelector?.('.ctTools');if(side)side.scrollTop=0;});
            },
            ctDictionaryAdd() {
                if(!this.ctDictionaryReady || !this.createDictionaryEntry)return false;
                const ctx=this.ctContext(),unitId=this.ctSelection,dictionary=this.dictionary,word=this.createDictionaryEntry();
                this.ctDictionaryFilter='';dictionary.unshift(word);this.invalidateEditorDictionaryIndex?.(word._id,{membership:true});
                this.ctDictionaryBeginEdit(word._id,{newEntry:true});this.ctDictionaryPage=1;this.dictionaryFlashId=word._id;
                this.$nextTick?.(()=>{
                    if(!this.ctDictionaryContextCurrent(ctx,unitId,dictionary))return;
                    const rows=root.document?.querySelectorAll?.('.ctTools .dictRow[data-dict-id]') || [],row=[...rows].find(row=>row.getAttribute('data-dict-id')===word._id);
                    row?.querySelector?.('textarea[placeholder="Replace"],input[placeholder="Replace"]')?.focus();
                });return word;
            },
            ctDictionaryTarget(fieldId=this.ctFocusedField) {
                const refs=this.$refs?.ctEditorRegion,ref=Array.isArray(refs)?refs[0]:refs,region=ref?.$el || ref;
                return [...(region?.querySelectorAll?.('[data-ct-target]') || root.document?.querySelectorAll?.('[data-ct-target]') || [])].find(input=>input.dataset.ctTarget===fieldId);
            },
            ctDictionaryUse(word,alt,ctx=this.ctContext(),unitId=this.ctSelection,dictionary=this.dictionary) {
                if(!this.ctDictionaryContextCurrent(ctx,unitId,dictionary) || !this.ctDictionaryReady || !dictionary.includes(word) || alt && !word.alts?.includes(alt))return false;
                const field=this.ctCurrentUnit?.fields.find(field=>field.id===this.ctFocusedField),input=this.ctDictionaryTarget(field?.id),replacement=(alt || word).replace;
                if(!field || field.kind==='gender' || !input || input.isConnected===false || typeof replacement!=='string')return false;
                const text=this.ctValues[field.id],start=input.selectionStart,end=input.selectionEnd;
                if(typeof text!=='string' || input.value!==text || !Number.isInteger(start) || !Number.isInteger(end) || start<0 || end<start || end>text.length)return false;
                const next=text.slice(0,start)+replacement+text.slice(end);this.ctValues[field.id]=next;this.ctCloseCompletion();this.ctEdited(field);
                this.$nextTick?.(()=>{
                    if(!this.ctDictionaryContextCurrent(ctx,unitId,dictionary) || this.ctFocusedField!==field.id || this.ctValues[field.id]!==next || input.isConnected===false)return;
                    input.focus();input.setSelectionRange?.(start+replacement.length,start+replacement.length);this.ctResizeField(input);
                });return true;
            },
            ctOrderedUnits() {
                const key=this.ctSort,units=this.ctUnits,saved=key==='translation'?this.ctSaved:null;
                let cache=this._ctOrderCache;
                if(!cache || cache.units!==units || cache.key!==key || cache.saved!==saved){
                    const collator=this._ctCollator ||= new Intl.Collator(undefined,{numeric:true,sensitivity:'base'});
                    const ascending=units.slice().sort((a,b)=>collator.compare(this.ctSortValue(a,key),this.ctSortValue(b,key))
                        || collator.compare(a.recordId,b.recordId) || a.id.localeCompare(b.id));
                    cache=this._ctOrderCache={units,key,saved,ascending,descending:null};
                }
                return this.ctSortDir==='desc'?(cache.descending ||= cache.ascending.slice().reverse()):cache.ascending;
            },
            ctSortValue(unit,key) {
                const cache=this._ctSortCache ||= new WeakMap(),saved=this.ctSaved[unit.id];let item=cache.get(unit);
                if(!item){item={filename:String(unit.recordId)};cache.set(unit,item);}
                if(key==='english' && item.english===undefined)item.english=this.ctListText(unit,'source');
                if(key==='translation' && (item.saved!==saved || item.translation===undefined)){
                    item.saved=saved;item.translation=this.ctListText(unit,'target');
                }
                return item[key] ?? item.filename;
            },
            ctSortBy(key) {
                if(!['filename','english','translation'].includes(key) || this.ctBusy)return;
                this.ctSortDir=this.ctSort===key && this.ctSortDir==='asc'?'desc':'asc';this.ctSort=key;this.ctPage=1;
            },
            ctApplySearch() {clearTimeout(this._ctSearchTimer);this.ctAppliedSearch=this.ctSearch;this.ctPage=1;},
            ctClearSearch() {this.ctSearch='';this.ctApplySearch();this.$refs?.ctSearchInput?.focus();},
            ctResetFilters() {this.ctFilter='';this.ctSelectedFilters=defaultFilters();this.ctSearch='';this.ctApplySearch();},
            ctOpenScanDialog() {if(!this.ctBusy)this.$refs?.ctDiagnosticDialog?.showModal();},
            ctCloseScanDialog() {this.$refs?.ctDiagnosticDialog?.close();},
            ctStartScan() {this.ctCloseScanDialog();return this.ctScan(this.ctIncludeConsistency);},
            async ctShowVersionChooser() {
                if(!this.ctActive || this.ctBusy)return false;
                const ctx=this.ctContext(),unitId=this.ctSelection,current=()=>this.ctActive && !this.ctBusy && this.ctCurrent(ctx) && this.ctSelection===unitId;
                try {
                    if(!await this.ctFlushDraft() || !current())return false;
                    await this.ctFlushCommentDraft();if(!current())return false;
                    this.versionChooserVisible=true;return true;
                } catch(error){if(current())this.ctError='Draft was not stored before opening Versions: '+error.message;return false;}
            },
            async ctSetPage(value) {
                if(this.ctBusy)return false;const ctx=this.ctContext();
                if(!await this.ctFlushDraft() || !this.ctCurrent(ctx))return false;
                this.ctPage=Math.max(1,Math.min(this.ctPageCount,Math.floor(Number(value)||1)));return true;
            },
            ctFocusRow(unitId=this.ctSelection) {
                const region=this.$refs?.ctFileTableRegion;
                const row=[...(region?.querySelectorAll?.('[data-unit-id]') || [])].find(item=>item.dataset.unitId===unitId);
                (row || region)?.focus?.({preventScroll:true});row?.scrollIntoView?.({block:'nearest'});
            },
            ctRefreshLayout() {this.observeInlineBlocks?.();this.measureWorkspaceChrome?.();},
            ctRowClick(unit,event) {
                if(this.ctBusy || rowControl(event))return false;
                return this.ctSelect(unit,!this.inlineEditor);
            },
            ctRowDoubleClick(unit,event) {
                if(rowControl(event))return false;
                const pending=this._ctSelectRun;
                if(pending?.pending && pending.unitId===unit?.id && this.ctCurrent(pending.ctx)){pending.full=true;if(this.ctSelection===unit.id)this.ctEditor=true;return true;}
                if(this.ctBusy)return false;
                return this.ctSelect(unit,true);
            },
            async ctRowKeydown(unit,event) {
                if(!event || event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
                    || this.ctBusy || this.ctEditor || this.ctHistoryViewer || this.$refs?.ctDiagnosticDialog?.open || rowControl(event))return false;
                const keys=['ArrowUp','ArrowDown','Home','End','PageUp','PageDown','ArrowLeft','ArrowRight','Enter'];
                if(!keys.includes(event.key))return false;
                unit ||= this.ctCurrentUnit || this.ctPageRows[0];if(!unit)return false;
                event.preventDefault();const ctx=this.ctContext();
                if(event.key==='Enter')return this.ctSelect(unit,true);
                const rows=this.ctRows,size=this.ctEffectivePageSize,index=Math.max(0,rows.findIndex(item=>item.id===unit.id));
                let targetIndex=index;
                if(event.key==='Home')targetIndex=0;else if(event.key==='End')targetIndex=rows.length-1;
                else if(event.key==='ArrowUp')targetIndex--;else if(event.key==='ArrowDown')targetIndex++;
                else targetIndex+=(event.key==='PageUp'||event.key==='ArrowLeft'?-size:size);
                targetIndex=Math.max(0,Math.min(rows.length-1,targetIndex));const target=rows[targetIndex];if(!target)return false;
                if(!await this.ctSelect(target,false,{focus:false}) || !this.ctCurrent(ctx))return false;
                this.ctPage=Math.floor(targetIndex/size)+1;await this.$nextTick?.();
                if(this.ctCurrent(ctx) && this.ctSelection===target.id)this.ctFocusRow(target.id);return true;
            },
            async ctCloseEditor() {
                if(this.ctBusy || this._ctCloseRun)return false;
                const ctx=this.ctContext(),unit=this.ctCurrentUnit,unitId=this.ctSelection,selectionRun=this._ctSelectRun,
                    returning=this._ctInlineReturn,run=this._ctCloseRun={};
                const current=()=>this._ctCloseRun===run && this.ctCurrent(ctx) && this.ctSelection===unitId
                    && this.ctCurrentUnit===unit && this._ctSelectRun===selectionRun && !this.ctKeyboardOverlayOpen() && !this.ctHistoryViewer;
                const input=this.ctTargetInputs().find(input=>input.dataset.ctTarget===returning?.fieldId);
                const caret=input && this.ctFocusedField===returning?.fieldId ? this.ctCaptureCaret(input) : returning?.caret;
                try {
                    if(!await this.ctFlushDraft() || !current())return false;
                    await this.ctFlushCommentDraft();if(!current())return false;
                    this.ctEditor=false;this.ctInlineClosed=false;this.ctCloseCompletion();await this.$nextTick?.();
                    if(!current())return false;
                    this.ctRefreshLayout();
                    if(returning && this._ctInlineReturn===returning && this.inlineEditor && this.ctCurrent(returning.ctx)
                        && returning.unit===unit && returning.unitId===unitId && returning.selectionRun===selectionRun){
                        this.ctFocusedField=returning.fieldId;this.ctFocusTarget(false,returning.fieldId,caret);
                    } else this.ctFocusRow(unitId);
                    this._ctInlineReturn=null;return true;
                } finally {if(this._ctCloseRun===run)this._ctCloseRun=null;}
            },
            async ctCloseInline() {
                if(this.ctKeyboardBlocked() || this._ctCloseRun)return false;
                const ctx=this.ctContext(),unit=this.ctCurrentUnit,run=this._ctCloseRun={},selectionRun=this._ctSelectRun;
                const current=()=>this._ctCloseRun===run && this.ctCurrent(ctx) && this.ctCurrentUnit===unit
                    && this._ctSelectRun===selectionRun && !this.ctEditor && !this.ctKeyboardOverlayOpen() && !this.ctHistoryViewer;
                try {
                    if(!await this.ctFlushDraft() || !current())return false;
                    await this.ctFlushCommentDraft();if(!current())return false;
                    this.ctInlineClosed=true;this.ctCloseCompletion();this._ctInlineReturn=null;await this.$nextTick?.();
                    if(!current())return false;this.ctRefreshLayout();this.ctFocusRow(unit.id);return true;
                } finally {if(this._ctCloseRun===run)this._ctCloseRun=null;}
            },
            async ctDiscardDraft() {
                if(this.ctBusy || !this.ctCurrentUnit || !this.ctDraftDirty)return false;
                const ctx=this.ctContext(),unitId=this.ctSelection,signature=JSON.stringify([this.ctValues,this.ctReviewed]);
                if(!await this.ctFlushDraft() || !this.ctCurrent(ctx) || this.ctSelection!==unitId)return false;
                const revision=this._ctDraftRevision;this.ctBusy=true;
                try {
                    await this._ctStore.discardDraft(ctx.scope,unitId,{expectedRevision:revision});
                    if(!this.ctCurrent(ctx) || this.ctSelection!==unitId)return false;
                    if(this._ctDraftRevision===revision){this._ctDraftRevision=null;const head=this._ctDraftHeads?.get(JSON.stringify([root.ClientTextStore.scopeKey(ctx.scope),unitId]));if(head&&!head.pending){head.revision=null;head.signature=null;}}
                    if(signature!==JSON.stringify([this.ctValues,this.ctReviewed])){this.ctQueueDraft();return false;}
                    this.ctValues=this.ctValuesFor(this.ctCurrentUnit);this.ctReviewed={...(this.ctSaved[unitId]?.reviewed || {})};
                    this.ctChoices=copy(this.ctSaved[unitId]?.conflicts || []);this.ctDraftDirty=false;this.ctCompletion=null;return true;
                } catch(error){if(this.ctCurrent(ctx))this.ctError='Draft was not discarded: '+error.message;return false;}
                finally{if(this.ctCurrent(ctx))this.ctBusy=false;}
            },
            ctAssignmentProgress(row) {
                if(row.contentMode!=='clienttext'){
                    const progress=this.managedProgress(row.team);
                    return {...progress,outdated:0,outdatedWidth:'0%',empty:!progress.total,known:true};
                }
                const counts=row.team.counts || {},count=value=>Number.isFinite(Number(value))?Math.max(0,Math.floor(Number(value))):0;
                const known=counts.workloadFields!==undefined && counts.workloadFields!==null && Number.isFinite(Number(counts.workloadFields));
                const total=count(counts.workloadFields),saved=Math.min(total,count(counts.resolvedFields)),unresolved=total-saved;
                // Outdated is always initial workload; Missing can also arise
                // from a correction outside it. Do not use all Missing counts
                // as a segment. Orange owns overlap; red is unresolved without
                // Outdated, so the initial-workload segments sum exactly once.
                const outdated=Math.min(unresolved,count(counts.outdatedFields)),missing=unresolved-outdated;
                const width=value=>total?100*value/total+'%':'0%';
                return {saved,total,percent:total?Math.round(100*saved/total):0,ordinarySaved:saved,revised:0,missing,outdated,unresolved,
                    savedWidth:width(saved),revisedWidth:'0%',missingWidth:width(missing),outdatedWidth:width(outdated),empty:!total,known,
                    loaded:count(counts.loaded),savedIds:count(counts.saved),revisedIds:count(counts.revised),missingIds:count(counts.missing),outdatedIds:count(counts.outdated),
                    fields:count(counts.fields),savedFields:count(counts.savedFields),revisedFields:count(counts.revisedFields),
                    missingFields:count(counts.missingFields),outdatedFields:count(counts.outdatedFields)};
            },
            ctAssignmentProgressTooltip(row) {
                if(row.contentMode!=='clienttext')return this.managedProgressTooltip(row.team);
                const progress=this.ctAssignmentProgress(row),lines=[row.label+' progress',
                    progress.known?`Resolved initial fields: ${progress.saved} / ${progress.total} (${progress.percent}%)`:'Initial field workload counts are unavailable.',
                    'Workload denominator: original Missing or Outdated fields, including carried source changes. Each field is counted once.'];
                if(progress.known && !progress.total)lines.push('No initial field workload; the bar is neutral.');
                lines.push(`Remaining initial fields: ${progress.unresolved} · Missing only: ${progress.missing} · Outdated: ${progress.outdated}`,
                    'Orange fields are Outdated and may also be Missing; red fields are unresolved without Outdated.',
                    `IDs: ${progress.loaded} loaded · Saved: ${progress.savedIds} · Revised: ${progress.revisedIds} · Missing: ${progress.missingIds} · Outdated: ${progress.outdatedIds}`,
                    `Field statuses: ${progress.fields} fields · Saved: ${progress.savedFields} · Revised corrections: ${progress.revisedFields} · Missing: ${progress.missingFields} · Outdated: ${progress.outdatedFields}`,
                    'Saved and Revised counts describe explicit accepted saves; status counts can overlap. They do not define this progress denominator.',
                    'Revised field corrections are outside the initial workload and are excluded from the progress bar.',
                    'Only server-accepted work is counted; unsaved drafts and pending offline saves are excluded.');
                return lines.join('\n');
            },
            ctScope(versionId, groupId, language = this.lang) { return { accountId: this.cloudProfileId || this.cloudUser?.id || 'guest', game: this.gameVersion, branchId: this.branchId || 'default', versionId, groupId, language }; },
            ctContext() { return { key: this.managedCatalogScope, scope: copy(this.ctWorkspace?.scope || {}), epoch: this._ctEpoch || 0 }; },
            ctCurrent(ctx) { return ctx.key === this.managedCatalogScope && ctx.epoch === (this._ctEpoch || 0) && JSON.stringify(ctx.scope) === JSON.stringify(this.ctWorkspace?.scope || {}); },
            ctFence() {
                this.ctFlushDraft().catch(()=>{});
                this.ctFlushCommentDraft().catch(()=>{});
                this._ctEpoch = (this._ctEpoch || 0) + 1; this._ctAbort?.abort(); clearInterval(this._ctSyncTimer); clearTimeout(this._ctDraftTimer);
                this._ctSync?.stop?.(); this._ctSync = null;
                this._ctSaveJob = null; this._ctDraftRevision = null; this._ctEditRevision = 0; this._ctSyncError = '';this._ctNavigationRun=null;
                this._ctInlineReturn=null;this._ctCloseRun=null;this._ctGenderInsertRun=null;this.ctInlineClosed=false;
                this._ctStatusCache = new WeakMap(); this._ctSortCache=new WeakMap();this._ctOrderCache=null;this._ctSelectRun={}; this.ctDraftDirty = false; this.ctBusy = false;
                this._ctConsistencyIndex=null;this._ctConsistencyByUnit=null;this.ctMemory=raw([]);
                this.ctActive = false; this.ctEditor = false; this.ctSelection = ''; this.ctComments = []; this.ctPeers = []; this.ctProgress = null;
                this.ctPreviewGggVars={};this.ctFocusedField='';
                this.ctWorkspace=null;this.ctUnits=raw([]);this.ctSaved=raw({});this.activeContentGroup=null;
                this._ctUnitIndex=raw(new Map());this._ctWorkUnits=raw(new Map());this._ctSheets=raw([]);
                this.ctResetHistory();
                this.ctUploadVisible=false;this.ctUploading=false;this.ctRequests=[];
            },
            ctStatus(unit = this.ctCurrentUnit) {
                if(!unit)return {fields:{}};
                const cache=this._ctStatusCache ||= new WeakMap(),saved=this.ctSaved[unit.id],previous=cache.get(unit);
                if(previous && previous.saved===saved)return previous.status;
                const status=root.ClientTextState.statusFor(unit,saved);cache.set(unit,{saved,status});return status;
            },
            ctFieldStatus(field) { return this.ctStatus().fields[field.id] || {}; },
            ctReviewHash(field) { return root.ClientTextState.sourceHash(field.source); },
            ctValuesFor(unit) { return root.ClientTextState.valuesFor(unit, this.ctSaved[unit.id]); },
            ctFieldsFor(unit=this.ctCurrentUnit) {
                if(!unit)return [];
                // Originals are immutable. Cache visibility without removing
                // any field from the unit, save payload, history or export.
                const cache=this._ctVisibleFields ||= new WeakMap();let item=cache.get(unit);
                if(!item || item.fields!==unit.fields){
                    const hasEnglish=field=>field.kind!=='gender' && String(field.source ?? '').trim().length>0;
                    const fields=unit.fields || [],text=fields.filter(hasEnglish);
                    item={fields:unit.fields,visible:text.length ? fields.filter(field=>field.kind==='gender' || hasEnglish(field)) : []};cache.set(unit,item);
                }
                return item.visible;
            },
            ctTabFields(unit=this.ctCurrentUnit) {
                const column=field=>{
                    const name=/^([A-Z]+)\d+$/i.exec(field.targetCell || '')?.[1];
                    return name ? [...name.toUpperCase()].reduce((value,char)=>value*26+char.charCodeAt(0)-64,0) : Infinity;
                };
                // The form grid's visual rows and parser metadata order differ
                // from the original worksheet. Coordinates define navigation only.
                return this.ctFieldsFor(unit).slice().sort((a,b)=>column(a)-column(b));
            },
            ctListText(unit,side) {
                const fields=this.ctFieldsFor(unit).filter(field=>field.kind!=='gender');
                if(side==='source')return [...new Set(fields.map(field=>field.source))].join('\n');
                const values=this.ctValuesFor(unit);
                return fields.map(field=>values[field.id]).filter(text=>String(text ?? '').trim().length>0).join('\n');
            },
            ctDiagnose(unit) { const values = this.ctValuesFor(unit); return unit.fields.flatMap(field => root.ClientTextState.diagnose(field, values[field.id]).map(issue => ({ ...issue, severity: issue.level || issue.severity, fieldId: field.id }))); },
            ctTone(unit) { const s = this.ctStatus(unit); return s.missing ? 'missing' : s.outdated ? 'outdated' : s.revised ? 'revised' : s.saved ? 'saved' : ''; },
            ctStatusLabel(unit) { const s = this.ctStatus(unit); return ['Missing', 'Outdated', 'Revised', 'Saved'].filter(label => s[label.toLowerCase()]).join(' · ') || 'Unchanged'; },
            ctForm(group, form) { return group.fields.find(field => field.form === form); },
            ctGroupSources(group) {
                const sources=new Map();for(const field of group.fields){const text=String(field.source ?? ''),item=sources.get(text);
                    if(item)item.names.push(field.form || field.name);else sources.set(text,{key:field.id,text,names:[field.form || field.name]});}
                return [...sources.values()].map(item=>({...item,label:sources.size>1?item.names.join(' / '):group.name}));
            },
            ctNotes(unit = this.ctCurrentUnit) { return (Array.isArray(unit?.developerNotes) ? unit.developerNotes : unit?.developerNotes ? [unit.developerNotes] : []).map(note => typeof note === 'string' ? note : note.text || note.value || '').filter(Boolean); },
            ctReport(progress) { this.ctProgress = { ...this.ctProgress, ...progress, completed: progress.completed ?? progress.processed ?? this.ctProgress?.completed ?? 0 }; },
            ctCancel() { this._ctAbort?.abort(); this.ctNotice = 'Cancelled. Saved work is retained.'; },
            async ctRefreshLocal() {
                if (!this._ctStore) return;
                const key = this.managedCatalogScope;
                try { const [rows,requests] = await Promise.all([this._ctStore.listWorkspaces({ accountId: this.cloudProfileId || this.cloudUser?.id || 'guest', game: this.gameVersion }),this._ctStore.listRequests(this.ctRequestScope())]); if (key === this.managedCatalogScope) {this.ctLocalWorkspaces = raw(rows.filter(row => row.state === 'ready' && !row.groupId.startsWith('staged:')));this.ctRequests=raw(requests);} } catch (_) { /* Startup storage owns the actionable error. */ }
            },
            async ctActivate(scope, metadata) {
                const owner=this.ctRequestScope();if(scope.accountId!==owner.accountId || scope.game!==owner.game || scope.branchId!==owner.branchId)return false;
                const openingKey=this.managedCatalogScope,openingEpoch=this._ctEpoch || 0;
                if(!await this.ctFlushDraft() || openingKey!==this.managedCatalogScope || openingEpoch!==(this._ctEpoch || 0))return false;
                this.ctFence(); this.ctWorkspace = { scope: copy(scope), metadata: metadata || {} };
                const ctx = this.ctContext(); this.ctBusy = true; this.ctError = '';
                this._collaboration?.disconnect(); this._collaboration = null; this._collabKey = '';
                this.clearEditorToolsFile?.();
                try {
                    const [units, saved] = await Promise.all([this._ctStore.getUnits(scope), this._ctStore.getSaved(scope)]);
                    if (!this.ctCurrent(ctx)) return false;
                    this.ctUnits = raw(units); this._ctUnitIndex = raw(new Map(units.map(unit => [unit.id, unit]))); this.ctSaved = raw(saved); this.ctRevision++;
                    const visibleUnits=units.filter(unit=>this.ctFieldsFor(unit).length);
                    this._ctSheets = raw([...new Set(visibleUnits.map(unit=>JSON.stringify([unit.role,unit.sheet])))].map(key=>({key,role:JSON.parse(key)[0],name:JSON.parse(key)[1]})));
                    this._ctWorkUnits=raw(new Map(units.filter(unit=>unit.fields.some(field=>field.originalMissing || field.outdated) || saved[unit.id]?.outdated?.length).map(unit=>[unit.id,unit])));
                    this.ctSheet = visibleUnits.length ? JSON.stringify([visibleUnits[0].role, visibleUnits[0].sheet]) : ''; this.ctPage = 1;
                    this.ctDiagnostics = raw({}); this.ctScanDone = false; this.ctSearch = ''; this.ctAppliedSearch = '';
                    this.ctActive = true; this.lang = scope.language; this.versionChooserVisible = false; this.editorVisible = false;
                    this.ctLoadMemory(ctx);
                    this.activeContentGroup = metadata?.group || { id: scope.groupId, contentMode: 'clienttext' };
                    if (this.managedOnlineAvailable && (this.cloudCanAccessAllLanguages || scope.language===this.cloudUser?.language) && !String(scope.groupId).startsWith('local:')) {
                        const request = (path, options) => this._cloud.request(path, options);
                        this._ctSync = root.ClientTextSync.create({ scope, store: this._ctStore, request, isCurrent: () => this.ctCurrent(ctx) && this.ctActive });
                        this.ctSync(ctx); this._ctSyncTimer = setInterval(() => { if (!root.document.hidden) this.ctSync(ctx); }, 20000);
                    }
                    await this.$nextTick?.();if(!this.ctCurrent(ctx))return false;this.ctRefreshLayout();return true;
                } catch (error) { if (this.ctCurrent(ctx)) this.ctError = error.message; return false; }
                finally { if (this.ctCurrent(ctx)) this.ctBusy = false; }
            },
            async ctOpenCached(row) { const scope = this._ctStore.normalizeScope(row.scope || row); return this.ctActivate(scope, row.metadata || row); },
            async ctSync(ctx = this.ctContext()) {
                if (!this._ctSync || !this.ctCurrent(ctx)) return;
                const sync=this._ctSync;if(this._ctSyncRun?.sync===sync)return this._ctSyncRun.promise;
                const operation=(async()=>{
                    try {
                        const flushed=await sync.flush();if(!this.ctCurrent(ctx)||this._ctSync!==sync)return;
                        await sync.pull();if(!this.ctCurrent(ctx)||this._ctSync!==sync)return;
                        const saved = await this._ctStore.getSaved(ctx.scope);
                        if (!this.ctCurrent(ctx)||this._ctSync!==sync) return;
                        const affected = [...new Set([...Object.keys(saved),...Object.keys(this.ctSaved)])].filter(id => JSON.stringify(saved[id]) !== JSON.stringify(this.ctSaved[id]));
                        if(affected.length){
                            const next={...this.ctSaved};for(const id of affected){if(saved[id])next[id]=saved[id];else delete next[id];
                                if(saved[id]?.outdated?.length){const unit=this._ctUnitIndex.get(id);if(unit)this._ctWorkUnits.set(id,unit);}}
                            this.ctSaved=raw(next);this.ctRevision++;this.ctRefreshDiagnostics(affected);this.ctLoadMemory(ctx);
                            if(affected.includes(this.ctSelection) && this.ctCurrentUnit && !this.ctDraftDirty){this.ctValues=root.ClientTextState.valuesFor(this.ctCurrentUnit,saved[this.ctSelection]);this.ctReviewed={...saved[this.ctSelection]?.reviewed};this.ctChoices=copy(saved[this.ctSelection]?.conflicts||[]);this._ctEditRevision=saved[this.ctSelection]?.revision||0;}
                        }
                        const issue=sync.snapshot?.().error || (flushed?.conflicts?'Shared translation conflicts require a reviewed choice.':'');
                        if(issue){this._ctSyncError=issue;this.ctError=issue;}
                        else {if(this.ctError===this._ctSyncError)this.ctError='';this._ctSyncError='';}
                        await this.ctPresence(ctx);
                        if(this.ctSelection)await this.ctLoadComments(ctx);
                    } catch (error) { if (this.ctCurrent(ctx) && !error.stale){this._ctSyncError=error.message;this.ctError=error.message;} }
                })();
                const run={sync,promise:operation};this._ctSyncRun=run;
                try{return await operation;}finally{if(this._ctSyncRun===run)this._ctSyncRun=null;}
            },
            async ctSelect(unit, full = false, options = {}) {
                if (!unit || this.ctBusy || this._ctUnitIndex?.get(unit.id)!==unit) return false;
                const ctx = this.ctContext(),run=this._ctSelectRun={unitId:unit.id,ctx,full,pending:true};
                const current=()=>{
                    const valid=this.ctCurrent(ctx) && this._ctSelectRun===run && this._ctUnitIndex?.get(unit.id)===unit
                        && (!options.guard || options.guard());
                    if(!valid && this._ctSelectRun===run)run.pending=false;
                    return valid;
                };
                if(this.ctSelection===unit.id){
                    this.ctEditor=run.full;this.ctInlineClosed=false;if(run.full && this.ctTool==='preview')this.ctTool='dictionary';await this.$nextTick?.();if(!current())return false;
                    run.pending=false;this.ctRefreshLayout();if(options.focus!==false && (run.full || this.inlineEditor))this.ctFocusTarget();return true;
                }
                if (!await this.ctFlushDraft()) {run.pending=false;return false;}
                if(!current())return false;
                await this.ctFlushCommentDraft();
                if(!current())return false;
                this.ctBusy=true;let draft;
                try{draft=await this._ctStore.getDraft(ctx.scope,unit.id);}catch(error){run.pending=false;if(current())this.ctError=error.message;return false;}finally{if(this.ctCurrent(ctx) && this._ctSelectRun===run)this.ctBusy=false;}
                if(!current())return false;
                this.ctSelection = unit.id; this.ctEditor = run.full;this.ctInlineClosed=false;this._ctInlineReturn=null; this.ctLookup = ''; this.ctCompletion=null;this.ctCommentText='';this.ctCommentGlobal=false;
                if(run.full && this.ctTool==='preview')this.ctTool='dictionary';
                this.ctPreviewGggVars={};
                this.ctFocusedField=this.ctTabFields(unit)[0]?.id || '';
                this.ctValues = root.ClientTextState.valuesFor(unit, this.ctSaved[unit.id]); this.ctReviewed = { ...(this.ctSaved[unit.id]?.reviewed || {}) }; this.ctDraftDirty = false;
                this.ctChoices = copy(this.ctSaved[unit.id]?.conflicts || []); this._ctEditRevision = this.ctSaved[unit.id]?.revision || 0;
                this._ctDraftRevision = draft?.revision || null;
                if (draft?.values) { this.ctValues = { ...this.ctValues, ...draft.values }; this.ctReviewed = { ...this.ctReviewed, ...draft.reviewed }; this.ctDraftDirty = true; }
                this.ctResetHistory(); this.ctComments = [];
                this.ctLoadHistory(ctx, unit.id); this.ctLoadComments(ctx, unit.id); this.ctPresence(ctx);
                this.ctLoadCommentDraft(ctx,unit.id);
                await this.$nextTick?.();if(!current() || this.ctSelection!==unit.id)return false;
                run.pending=false;this.ctRefreshLayout();if(options.focus!==false && (run.full || this.inlineEditor))this.ctFocusTarget();return true;
            },
            ctEditorElement() {
                const refs=this.$refs?.ctEditorRegion,ref=Array.isArray(refs)?refs[0]:refs,region=ref?.$el || ref;
                return region;
            },
            ctTargetInputs() {
                const inputs=[...(this.ctEditorElement()?.querySelectorAll?.('[data-ct-target]') || [])];
                return this.ctTabFields().map(field=>inputs.find(input=>input.dataset.ctTarget===field.id))
                    .filter(input=>input && input.isConnected!==false && !input.disabled && !input.closest?.('[inert]'));
            },
            ctCaptureCaret(input) {
                return Number.isInteger(input?.selectionStart) ? {start:input.selectionStart,end:input.selectionEnd,direction:input.selectionDirection} : null;
            },
            ctFocusTarget(last=false,fieldId=last?null:this.ctFocusedField,caret=null) {
                const fields=this.ctTargetInputs(),field=fields.find(input=>input.dataset.ctTarget===fieldId) || fields[last?fields.length-1:0];
                if(!field)return false;
                this.ctFocusedField=field.dataset.ctTarget;field.focus?.();
                if(caret && field.setSelectionRange){
                    const length=String(field.value ?? '').length;
                    field.setSelectionRange(Math.min(caret.start,length),Math.min(caret.end,length),caret.direction || 'none');
                }
                return true;
            },
            ctKeyboardOverlayOpen() {
                return !!(root.AppDialogs?.isOpen
                    || this.versionChooserVisible || this.settingsDialogVisible || this.showSetting || this.ctUploadVisible
                    || this.$refs?.ctDiagnosticDialog?.open || this.workspaceInitializationActive || this._importingSource
                    || this.cloudResolverVisible || this.cloudHistoryVisible || this.settingsImportDraft || this.draftRecoveryVisible);
            },
            ctKeyboardBlocked() {
                return !this.ctActive || this.ctBusy || this._ctSelectRun?.pending || this.ctHistoryViewer || this.ctKeyboardOverlayOpen();
            },
            ctKeyboardTarget(field,input) {
                const current=this.ctCurrentUnit?.fields.find(item=>item.id===field?.id),region=this.ctEditorElement();
                if(!current || !this.ctTabFields().includes(current) || current.source!==field.source || current.kind!==field.kind
                    || current.targetCell!==field.targetCell || input?.dataset?.ctTarget!==field.id || input.isConnected===false
                    || input.disabled || input.closest?.('[inert]') || region?.contains && !region.contains(input))return false;
                const row=input.closest?.('tr[data-unit-id]');
                return this.ctEditor || this.ctInlineUnitVisible() && (!row || row.dataset.unitId===this.ctSelection);
            },
            ctInlineNavigationTarget(input) {
                if(this.ctTargetInputs().includes(input))return true;
                const region=this.$refs?.ctFileTableRegion,row=input?.closest?.('tr[data-unit-id]');
                return !!(region && (input===region || row?.dataset.unitId===this.ctSelection
                    && region.contains?.(input) && !rowControl({target:input})));
            },
            ctFullTabControls() {
                return [...(this.ctEditorElement()?.querySelectorAll?.('button,a[href],input,textarea,select,[tabindex]') || [])]
                    .filter(input=>!input.dataset?.ctTarget && !input.dataset?.ctSource && input.tabIndex>=0 && !input.disabled
                        && input.isConnected!==false && !input.closest?.('[inert]') && (!input.getClientRects || input.getClientRects().length));
            },
            ctMoveFullTab(input,direction) {
                const region=this.ctEditorElement(),targets=this.ctTargetInputs(),stops=[...targets,...this.ctFullTabControls()],index=stops.indexOf(input);
                if(index<0)return false;
                let next=stops[index+direction];
                if(!next){
                    const controls=[...(root.document?.querySelectorAll?.('button,a[href],input,textarea,select,[tabindex]') || [])]
                        .filter(input=>input.tabIndex>=0 && !input.disabled && !input.closest?.('[inert]')
                            && (!input.getClientRects || input.getClientRects().length));
                    const inside=controls.map((input,index)=>region?.contains?.(input)?index:-1).filter(index=>index>=0);
                    if(inside.length)next=controls[(direction>0?Math.max(...inside):Math.min(...inside))+direction];
                }
                if(!next)return false;
                next.focus?.();return true;
            },
            ctFieldsKeydown(event) {
                if(!this.ctEditor || this.ctKeyboardBlocked() || event.defaultPrevented || event.isComposing || event.keyCode===229
                    || event.key!=='Tab' || event.ctrlKey || event.altKey || event.metaKey || event.target?.dataset?.ctTarget)return;
                if(this.ctMoveFullTab(event.target,event.shiftKey?-1:1)){event.preventDefault();event.stopPropagation?.();}
            },
            async ctOpenInlineFull(field,input) {
                if(this.ctKeyboardBlocked() || this._ctNavigationRun || this.ctEditor || !this.ctKeyboardTarget(field,input))return false;
                const unit=this.ctCurrentUnit,ctx=this.ctContext(),returning=this._ctInlineReturn={ctx,unit,unitId:unit.id,fieldId:field.id,caret:this.ctCaptureCaret(input)};
                this.ctCloseCompletion();this.ctFocusedField=field.id;
                let opened=false;
                try {
                    if(!await this.ctSelect(unit,true,{focus:false,guard:()=>!this.ctKeyboardOverlayOpen() && !this.ctHistoryViewer})
                        || !this.ctCurrent(ctx) || this._ctInlineReturn!==returning || this.ctCurrentUnit!==unit || !this.ctEditor
                        || this.ctKeyboardOverlayOpen() || this.ctHistoryViewer)return false;
                    returning.selectionRun=this._ctSelectRun;
                    opened=this.ctFocusTarget(false,field.id,returning.caret);return opened;
                } finally {if(!opened && this._ctInlineReturn===returning)this._ctInlineReturn=null;}
            },
            ctResizeFields(region) {
                // Inline source and target live in separate table cells. Measure
                // both together so a shorter edit can shrink the pair again.
                const area=region?.closest?.('tr[data-unit-id]') || region;
                const fields=[...(area?.querySelectorAll?.('textarea') || [])],scrolls=new Map(fields.map(field=>[field,field.scrollTop]));
                for(const field of fields)field.style.height='auto';
                const heights=new Map(fields.map(field=>[field,field.scrollHeight+2])),groups=new Map();
                for(const block of area?.querySelectorAll?.('.ctBlock:not(.ctFormBlock)') || []){
                    const key=block.dataset.fieldGroup;
                    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(block);
                }
                for(const blocks of groups.values()){
                    const sources=blocks.flatMap(block=>[...block.querySelectorAll('textarea[data-ct-source]')]);
                    const targets=blocks.flatMap(block=>[...block.querySelectorAll('textarea[data-ct-target]')]);
                    if(sources.length===1 && targets.length===1){
                        const height=Math.max(heights.get(sources[0]) || 0,heights.get(targets[0]) || 0);
                        heights.set(sources[0],height);heights.set(targets[0],height);
                    }
                }
                for(const[field,height]of heights){field.style.height=height+'px';field.scrollTop=scrolls.get(field);}
                this.scheduleInlineAlignment?.();
            },
            ctResizeField(field) {
                if(!field?.style || !field.scrollHeight)return;
                const region=field.closest?.('.ctFields');if(region)return this.ctResizeFields(region);
                const scrollTop=field.scrollTop;field.style.height='auto';field.style.height=field.scrollHeight+2+'px';field.scrollTop=scrollTop;
            },
            ctEdited(field) {
                this.ctReviewed[field.id] = this.ctReviewHash(field);
                this.ctDraftDirty = true; this.ctQueueDraft();
            },
            ctGenderSuggestions(field) {
                const original=field.target;
                return typeof original==='string' && original!=='' && !/[\r\n]/.test(original) && !genderSuggestions.includes(original)
                    ? [...genderSuggestions,original] : genderSuggestions.slice();
            },
            ctGenderSuggestionLabel(value,field) {
                if(genderSuggestions.includes(value))return value;
                if(/^ +$/.test(value))return 'Original value ('+value.length+' '+(value.length===1?'space':'spaces')+')';
                if(/^\s+$/.test(value))return 'Original value ('+value.length+' whitespace characters)';
                return value===field.target?'Original value: '+value:value;
            },
            ctGenderMultiline(field) {
                return /[\r\n]/.test(field.target || '') || /[\r\n]/.test(this.ctValues[field.id] || '');
            },
            ctGenderCanEdit(field,input,event={}) {
                return field?.kind==='gender' && !event.defaultPrevented && !event.isComposing && event.keyCode!==229
                    && !input?.composing && !this.ctKeyboardBlocked() && this.ctKeyboardTarget(field,input)
                    && typeof input?.value==='string';
            },
            ctGenderEdited(field,event) {
                const input=event?.target;
                if(!this.ctGenderCanEdit(field,input,event))return false;
                let next=input.value;const value=this.ctValues[field.id] ?? '';
                // Preserve raw CRLF outside the user's edit, even though the
                // textarea's value and selection use normalized LF characters.
                if(input.tagName==='TEXTAREA' && value.includes('\r') && !next.includes('\r')){
                    const shown=value.replace(/\r\n?/g,'\n');let start=0,oldEnd=shown.length,newEnd=next.length;
                    while(start<oldEnd && start<newEnd && shown[start]===next[start])start++;
                    while(oldEnd>start && newEnd>start && shown[oldEnd-1]===next[newEnd-1]){oldEnd--;newEnd--;}
                    next=value.slice(0,genderRawOffset(value,start))+next.slice(start,newEnd)+value.slice(genderRawOffset(value,oldEnd));
                }
                this.ctValues[field.id]=next;this.ctEdited(field);
                if(input.tagName==='TEXTAREA')this.ctResizeField(input);
                return true;
            },
            ctGenderPaste(field,event) {
                const text=event.clipboardData?.getData?.('text/plain');
                if(typeof text!=='string' || !/[\r\n]/.test(text) || !this.ctGenderCanEdit(field,event.target,event))return false;
                event.preventDefault();event.stopPropagation?.();return this.ctInsertGenderText(field,event.target,text);
            },
            ctGenderKeydown(field,event) {
                if(event.key==='Enter' && event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey
                    && this.ctGenderCanEdit(field,event.target,event)){
                    event.preventDefault();event.stopPropagation?.();return this.ctInsertGenderText(field,event.target,'\n');
                }
                return this.ctTargetKeydown(field,event);
            },
            async ctInsertGenderText(field,input,text) {
                if(typeof text!=='string' || !this.ctGenderCanEdit(field,input))return false;
                const ctx=this.ctContext(),unit=this.ctCurrentUnit,selectionRun=this._ctSelectRun,full=this.ctEditor,
                    run=this._ctGenderInsertRun={},value=this.ctValues[field.id] ?? '';
                // Textareas expose normalized LF offsets, while originals and
                // pasted text can retain CRLF. Map only the selection coordinates.
                const rawOffset=offset=>{
                    if(input.tagName!=='TEXTAREA')return Math.min(offset,value.length);
                    return genderRawOffset(value,offset);
                };
                const start=rawOffset(Number.isInteger(input.selectionStart)?input.selectionStart:input.value.length),
                    end=rawOffset(Number.isInteger(input.selectionEnd)?input.selectionEnd:input.value.length),
                    next=value.slice(0,start)+text+value.slice(end),caret=next.slice(0,start+text.length).replace(/\r\n?/g,'\n').length;
                this.ctValues[field.id]=next;this.ctFocusedField=field.id;this.ctEdited(field);
                await this.$nextTick?.();
                if(this._ctGenderInsertRun!==run || !this.ctCurrent(ctx) || this.ctCurrentUnit!==unit || this._ctSelectRun!==selectionRun
                    || this.ctEditor!==full || this.ctInlineClosed || this.ctKeyboardBlocked() || this.ctFocusedField!==field.id
                    || this.ctValues[field.id]!==next)return true;
                const target=this.ctTargetInputs().find(target=>target.dataset.ctTarget===field.id),active=root.document?.activeElement;
                if(!target || active && active!==input && active!==target && active!==root.document?.body && active!==root.document?.documentElement)return true;
                target.focus?.({preventScroll:true});target.setSelectionRange?.(caret,caret,'none');this.ctResizeField(target);return true;
            },
            ctMarkReviewed(field) { this.ctReviewed[field.id] = this.ctReviewHash(field); this.ctDraftDirty = true; this.ctQueueDraft(); },
            ctChooseAlternative(choice, side) { const field = this.ctCurrentUnit.fields.find(field=>field.id===choice.fieldId); this.ctValues[choice.fieldId] = side === 'local' ? choice.local : choice.upstream ?? choice.remote; this.ctChoices = this.ctChoices.filter(item=>item!==choice); if(field)this.ctEdited(field); },
            ctCompleteForm(field, event) {
                if(event.isComposing || event.keyCode===229)return;
                if(event.key==='Escape'){if(this.ctCompletion){event.preventDefault();event.stopPropagation?.();}this.ctCloseCompletion();return;}
                const plain=!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
                if(this.ctCompletion && !this.ctCompletionValid(field,event.target))this.ctCloseCompletion();
                if(this.ctCompletion && plain && ['ArrowDown','ArrowUp'].includes(event.key)){
                    event.preventDefault();event.stopPropagation?.();
                    const completion=this.ctCompletion,count=completion.items.length;
                    completion.selectedIndex=(completion.selectedIndex+(event.key==='ArrowDown'?1:-1)+count)%count;
                    this.$nextTick?.(()=>this._ctCompletionInput?.closest?.('.ctTarget')?.querySelector?.('[role="option"][aria-selected="true"]')?.scrollIntoView?.({block:'nearest'}));return;
                }
                if(this.ctCompletion && plain && ['Tab','Enter'].includes(event.key)){
                    event.preventDefault();event.stopPropagation?.();this.ctApplyCompletion(field,this.ctCompletion.items[this.ctCompletion.selectedIndex],event.target);return;
                }
                if(this.ctCompletion && (event.key==='Tab' || event.key==='Enter' || ['ArrowLeft','ArrowRight','Home','End','PageUp','PageDown'].includes(event.key)))this.ctCloseCompletion();
                const current=this.ctCurrentUnit?.fields.find(item=>item.id===field.id);
                if (field.kind !== 'form' || event.key !== 'Tab' || !plain || !this.ctActive || this.ctBusy
                    || this.ctHistoryViewer || this.versionChooserVisible || this.settingsDialogVisible || this.showSetting || this.$refs?.ctDiagnosticDialog?.open
                    || !current || current.source!==field.source || current.kind!==field.kind) return;
                const value = this.ctValues[field.id];
                const caret=event.target?.selectionStart,end=event.target?.selectionEnd;
                if (value && 'NONEXISTENT'.startsWith(value.toUpperCase()) && value !== 'NONEXISTENT'
                    && (!Number.isInteger(caret) || caret===value.length && end===caret)) { event.preventDefault(); this.ctValues[field.id] = 'NONEXISTENT'; this.ctEdited(field); }
            },
            ctTargetKeydown(field,event) {
                if(event.defaultPrevented || event.isComposing || event.keyCode===229 || this.ctKeyboardBlocked()
                    || !this.ctKeyboardTarget(field,event.target))return;
                const shortcut=this.isAutocompleteShortcut ? this.isAutocompleteShortcut(event)
                    : event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
                        && (this.autocompleteShortcut==='ctrl-i' ? event.code==='KeyI' || event.key.toLowerCase()==='i'
                            : this.autocompleteShortcut!=='disabled' && (event.code==='Space' || event.key===' '));
                if(shortcut && field.kind!=='gender'){
                    event.preventDefault();event.stopPropagation?.();
                    if(this.ctCompletionValid(field,event.target))this.ctCloseCompletion();else this.ctSuggest(field,event,{manual:true});return;
                }
                this.ctCompleteForm(field,event);if(event.defaultPrevented || this._ctNavigationRun)return;
                if(!this.ctEditor && event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && event.key==='Enter'){
                    event.preventDefault();event.stopPropagation?.();return this.ctOpenInlineFull(field,event.target);
                }
                if(event.key!=='Tab' || event.ctrlKey || event.altKey || event.metaKey)return;
                const fields=this.ctTargetInputs(),index=fields.indexOf(event.target),direction=event.shiftKey?-1:1;
                if(index<0)return;
                if(this.ctEditor){
                    if(this.ctMoveFullTab(event.target,direction)){event.preventDefault();event.stopPropagation?.();}return;
                }
                event.preventDefault();event.stopPropagation?.();this.ctCloseCompletion();
                const next=fields[index+direction];
                if(next){next.focus?.();return true;}
                return this.ctSaveAndNavigate(direction<0,{inline:true,focusEnd:direction<0});
            },
            ctCloseCompletion() {this.ctCompletion=null;this._ctCompletionInput=null;},
            ctCompletionValid(field,input=this._ctCompletionInput) {
                const completion=this.ctCompletion,current=this.ctCurrentUnit?.fields.find(item=>item.id===field?.id);
                return !!(completion && completion.items?.length && this.ctActive && !this.ctBusy && !this.ctHistoryViewer
                    && !this.versionChooserVisible && !this.settingsDialogVisible && !this.showSetting && !this.$refs?.ctDiagnosticDialog?.open
                    && completion.fieldId===field?.id && completion.unitId===this.ctSelection && this.ctCurrent(completion.context)
                    && current && current.kind!=='gender' && current.source===completion.source
                    && (!this.ctFocusedField || this.ctFocusedField===field.id) && this.ctValues[field.id]===completion.text
                    && input && input.isConnected!==false && input.selectionStart===completion.selectionStart && input.selectionEnd===completion.selectionEnd
                    && (typeof input.value!=='string' || input.value===completion.text));
            },
            ctCompletionSelectionChanged(field,event) {
                if(this.ctCompletion && !this.ctCompletionValid(field,event.target))this.ctCloseCompletion();
            },
            ctCompletionItems(field,openedByChar='',prefix='') {
                const tokens=root.ClientTextState.suggestions(field,{openedByChar}),items=[],seen=new Set();
                const add=item=>{if(!seen.has(item.value)){seen.add(item.value);items.push(item);}};
                const entries=this.getActiveDictionaryEntries?.() || this.dictionary || [];
                for(const token of tokens){
                    const keyword=/^\[([^\]|]+)(?:\|([^\]]*))?\]$/.exec(token.value);
                    if(keyword){
                        const identity=keyword[1],lookup=(root.getKeywordPopupLookupName?.(identity) || identity.replace(/<gemlevel=(?:\d+|\{\d+\})>$/i,'')).trim().toLocaleLowerCase();
                        const candidates=[];
                        for(const entry of entries){
                            if(String(entry?.find ?? '').trim().toLocaleLowerCase()!==lookup || this.isDictionaryEntryActive && !this.isDictionaryEntryActive(entry))continue;
                            const pairs=this.getDictionaryDefinitionPairs?.(entry) || [{find:entry.find,replace:entry.replace},...(entry.alts || []).map(alt=>({...alt,replace:alt.replace ?? entry.replace}))];
                            for(const pair of pairs){
                                const display=pair.replace;if(typeof display!=='string' || !display.trim() || /[\[\]]/.test(display))continue;
                                candidates.push({value:'['+identity+'|'+display+']',label:'['+identity+'|'+String(pair.find ?? '')+'] → ['+identity+'|'+display+']',
                                    dictionaryKey:JSON.stringify([entry._id || entry.id || entry.find,pair._id || '',pair.find,display]),
                                    exact:String(pair.find ?? '').trim().toLocaleLowerCase()===String(keyword[2] || identity).trim().toLocaleLowerCase()});
                            }
                        }
                        candidates.sort((a,b)=>Number(b.exact)-Number(a.exact));for(const item of candidates)add(item);
                    }
                    add(token);
                }
                const query=prefix.toLocaleLowerCase();
                return items.filter(item=>!query || item.value.toLocaleLowerCase().startsWith(query) || item.label.toLocaleLowerCase().startsWith(query)).slice(0,100);
            },
            ctSuggest(field,event,options={}) {
                this.ctCloseCompletion();
                if(!this.ctActive || this.ctBusy || this.ctHistoryViewer || event.isComposing || event.keyCode===229 || field.kind==='gender')return false;
                const current=this.ctCurrentUnit?.fields.find(item=>item.id===field.id),input=event.target,text=this.ctValues[field.id];
                const caret=input?.selectionStart,selectionEnd=input?.selectionEnd;
                if(!current || current.source!==field.source || current.kind!==field.kind || typeof text!=='string'
                    || !Number.isInteger(caret) || !Number.isInteger(selectionEnd) || !options.manual && selectionEnd!==caret)return false;
                const before=text.slice(0,caret),match=selectionEnd===caret ? /([\[<{])([^\]\}>\r\n]*)$/.exec(before) : null;
                const wholeForm=field.kind==='form' && caret===text.length && selectionEnd===caret && 'NONEXISTENT'.startsWith(text.toUpperCase());
                let start=caret,end=selectionEnd,items;
                if(match){start=caret-match[0].length;items=this.ctCompletionItems(field,match[1],match[0]);}
                else if(wholeForm && (text || options.manual)){start=0;end=text.length;items=options.manual && !text ? this.ctCompletionItems(field) : root.ClientTextState.suggestions(field).filter(item=>item.replaceWholeField);}
                else if(options.manual)items=this.ctCompletionItems(field).filter(item=>!item.replaceWholeField);
                else return false;
                if(!items.length)return false;
                this._ctCompletionInput=input;
                this.ctCompletion={fieldId:field.id,unitId:this.ctSelection,context:this.ctContext(),source:current.source,text,
                    selectionStart:caret,selectionEnd,start,end,items,selectedIndex:0};return true;
            },
            ctApplyCompletion(field,item,input) {
                const completion=this.ctCompletion,target=input || this._ctCompletionInput;
                if(!this.ctCompletionValid(field,target) || !completion.items.includes(item)
                    || item.replaceWholeField && (field.kind!=='form' || completion.start!==0 || completion.end!==completion.text.length)
                    || item.dictionaryKey && !this.ctCompletionItems(field).some(current=>current.value===item.value && current.dictionaryKey===item.dictionaryKey)){
                    this.ctCloseCompletion();return false;
                }
                const text=completion.text.slice(0,completion.start)+item.value+completion.text.slice(completion.end);
                this.ctValues[field.id]=text;this.ctCloseCompletion();this.ctEdited(field);
                this.$nextTick?.(()=>{
                    if(!this.ctCurrent(completion.context) || this.ctSelection!==completion.unitId || this.ctValues[field.id]!==text
                        || this.ctFocusedField && this.ctFocusedField!==field.id || target?.isConnected===false)return;
                    target?.focus();target?.setSelectionRange(completion.start+item.value.length,completion.start+item.value.length);this.ctResizeField(target);
                });return true;
            },
            ctQueueDraft() { clearTimeout(this._ctDraftTimer); this._ctDraftTimer = setTimeout(() => this.ctFlushDraft(), 250); },
            async ctFlushDraft() {
                clearTimeout(this._ctDraftTimer);
                if (!this.ctDraftDirty || !this.ctCurrentUnit || !this.ctWorkspace) return true;
                const ctx = this.ctContext(), unitId = this.ctSelection, values = copy(this.ctValues), reviewed = copy(this.ctReviewed);
                const id=JSON.stringify([root.ClientTextStore.scopeKey(ctx.scope),unitId]),heads=this._ctDraftHeads ||= new Map();
                let head=heads.get(id);
                if(!head){head={revision:this._ctDraftRevision||null,pending:0,queue:Promise.resolve(),signature:null};heads.set(id,head);}
                else if(!head.pending && head.revision!==(this._ctDraftRevision||null)){head.revision=this._ctDraftRevision||null;head.signature=null;}
                const signature=JSON.stringify([values,reviewed]);head.pending++;
                try {
                    const pending = head.queue.catch(()=>{}).then(async()=>{
                        if(head.signature===signature)return;
                        const saved = await this._ctStore.putDraft(ctx.scope, unitId, { values, reviewed }, { expectedRevision: head.revision });
                        head.revision=saved.revision;head.signature=signature;
                        if(this.ctCurrent(ctx) && this.ctSelection===unitId)this._ctDraftRevision=saved.revision;
                    });head.queue=pending;
                    this._ctDraftQueue=Promise.all([...heads.values()].map(value=>value.queue));this._ctDraftQueue.catch(()=>{});
                    await pending; return true;
                }
                catch (error) { if (this.ctCurrent(ctx)) this.ctError = 'Draft was not stored: ' + error.message; return false; }
                finally{head.pending--;}
            },
            async ctSave(close = false) {
                if (this.ctBusy || !this.ctCurrentUnit) return false;
                if(this.ctChoices.length){this.ctError='Choose between the retained alternatives before saving this ID.';return false;}
                const ctx=this.ctContext(),unitId=this.ctSelection,scopeKey=root.ClientTextStore.scopeKey(ctx.scope);
                const existing=this._ctSaveJob, retry=existing?.unitId===unitId && existing.scopeKey===scopeKey && existing.command;
                // An uncertain commit must find its receipt with the exact old
                // command before checkpointing any newer editor text.
                if(!retry && !await this.ctFlushDraft())return false;
                if(!this.ctCurrent(ctx)||this.ctSelection!==unitId)return false;
                const job=existing?.unitId===unitId && existing.scopeKey===scopeKey ? existing : {unitId,scopeKey,id:uuid()};
                this._ctSaveJob=job;this.ctBusy = true;
                try {
                    const command=job.command ||= { jobId:job.id, values: copy(this.ctValues), reviewed: copy(this.ctReviewed), baseRevision: this.ctSaved[unitId]?.serverRevision || 0, expectedRevision: this._ctEditRevision || 0, expectedDraftRevision:this._ctDraftRevision || null };
                    const result = await this._ctStore.save(ctx.scope, unitId, command);
                    if (!this.ctCurrent(ctx)) return false;
                    const sameEditor=JSON.stringify([this.ctValues,this.ctReviewed])===JSON.stringify([command.values,command.reviewed]);
                    this.ctSaved = raw({ ...this.ctSaved, [unitId]: result.saved }); this.ctRevision++; this.ctDraftDirty = !sameEditor; if(this._ctSaveJob===job)this._ctSaveJob = null;
                    this._ctEditRevision=result.saved.revision;
                    const head=this._ctDraftHeads?.get(JSON.stringify([scopeKey,unitId]));
                    if(this._ctDraftRevision===command.expectedDraftRevision){this._ctDraftRevision=null;if(head&&!head.pending){head.revision=null;head.signature=null;}}
                    this.ctRefreshDiagnostics([unitId]); this.ctError = ''; this.ctLoadHistory(ctx, unitId);this.ctLoadMemory(ctx);
                    if (close && sameEditor) {
                        this.ctEditor = false;this.ctInlineClosed=false;this._ctInlineReturn=null;this.ctCompletion=null;await this.$nextTick?.();
                        if(!this.ctCurrent(ctx) || this.ctSelection!==unitId)return false;
                        this.ctRefreshLayout();this.ctFocusRow(unitId);
                    }
                    this.ctSync(ctx); return sameEditor;
                } catch (error) {
                    if (this.ctCurrent(ctx)) {
                        this.ctError = error.message;
                        if(error.code==='DRAFT_CHANGED')this._ctSaveJob=null;
                        if(error.code==='UNIT_CHANGED'){
                            this._ctSaveJob=null; const latest=await this._ctStore.getSaved(ctx.scope);
                            if(this.ctCurrent(ctx)){
                                const remote=root.ClientTextState.valuesFor(this.ctCurrentUnit,latest[unitId]);
                                this.ctChoices=this.ctCurrentUnit.fields.filter(field=>this.ctValues[field.id]!==remote[field.id]).map(field=>({fieldId:field.id,local:this.ctValues[field.id],remote:remote[field.id]}));
                                this.ctSaved=raw(latest);this.ctRevision++;this._ctEditRevision=latest[unitId]?.revision || 0;
                            }
                        }
                    } return false;
                }
                finally { if (this.ctCurrent(ctx)) this.ctBusy = false; }
            },
            async ctNavigate(offset) {
                if(![-1,1].includes(offset))return false;
                return this.ctSaveAndNavigate(offset<0,{inline:!this.ctEditor && this.inlineEditor,focusEnd:false});
            },
            ctHasEditorChanges() {
                const unit=this.ctCurrentUnit;if(!unit)return false;
                const committed=this.ctValuesFor(unit),saved=this.ctSaved[unit.id],status=this.ctStatus(unit);
                return unit.fields.some(field=>this.ctValues[field.id]!==committed[field.id]
                    || status.fields[field.id]?.outdated && this.ctReviewed[field.id]===this.ctReviewHash(field) && saved?.reviewed?.[field.id]!==this.ctReviewed[field.id])
                    || !this.ctChoices.length && !!saved?.conflicts?.length;
            },
            ctInlineUnitVisible() {return !this.ctEditor && !this.ctInlineClosed && this.inlineEditor && !!this.ctCurrentUnit && this.ctPageRows.some(unit=>unit.id===this.ctSelection);},
            ctUnitOccupied(unitId) {
                return this.ctPeers.some(peer=>peer.unitId===unitId && peer.sessionId!==this.instanceTabId && !peer.away);
            },
            async ctSaveAndNavigate(reverse=false,options={}) {
                if(this.ctKeyboardBlocked() || this._ctNavigationRun)return false;
                const ctx=this.ctContext(),unitId=this.ctSelection,original=this.ctCurrentUnit,selectionRun=this._ctSelectRun,
                    hadEditor=this.ctEditor || this.ctInlineUnitVisible(),direction=reverse?-1:1;
                if(!hadEditor)this.ctApplySearch();
                let rows=this.ctRows.slice();
                if(hadEditor && original && !rows.some(unit=>unit.id===unitId)){
                    const visible=new Set(rows.map(unit=>unit.id));
                    rows=this.ctOrderedUnits().filter(unit=>unit.id===unitId || visible.has(unit.id));
                }
                const anchor=hadEditor?rows.findIndex(unit=>unit.id===unitId)
                    :(this.ctPage-1)*this.ctEffectivePageSize+(reverse?this.ctPageRows.length-1:0);
                const candidates=[];for(let index=hadEditor?anchor+direction:anchor;index>=0&&index<rows.length;index+=direction)candidates.push(rows[index].id);
                if(options.inline && !candidates.some(id=>this._ctUnitIndex.has(id) && !this.ctUnitOccupied(id))){
                    this.ctNotice='No available files in this direction.';return false;
                }
                const run=this._ctNavigationRun={},current=()=>this._ctNavigationRun===run && this.ctCurrent(ctx) && this.ctSelection===unitId
                    && this.ctCurrentUnit===original && this._ctSelectRun===selectionRun && !this.ctKeyboardOverlayOpen() && !this.ctHistoryViewer;
                try {
                    const pending=this._ctSaveJob,retry=pending?.unitId===unitId && pending.scopeKey===root.ClientTextStore.scopeKey(ctx.scope) && pending.command;
                    if(hadEditor && (retry || options.saveUnchanged || this.ctHasEditorChanges()) && !await this.ctSave())return false;
                    if(!current())return false;
                    for(const id of candidates){
                        const ordered=this.ctRows,index=ordered.findIndex(unit=>unit.id===id);if(index<0)continue;
                        const unit=this._ctUnitIndex.get(id);if(!unit || this.ctUnitOccupied(id))continue;
                        if(!current() || !await this.ctSelect(unit,!options.inline,{focus:false,guard:()=>this._ctNavigationRun===run
                            && !this.ctKeyboardOverlayOpen() && !this.ctHistoryViewer}))return false;
                        const opened=this._ctSelectRun;
                        if(this._ctNavigationRun!==run || !this.ctCurrent(ctx) || this.ctCurrentUnit!==unit || this.ctSelection!==id
                            || this.ctKeyboardOverlayOpen() || this.ctHistoryViewer)return false;
                        this.ctPage=Math.floor(index/this.ctEffectivePageSize)+1;await this.$nextTick?.();
                        if(this._ctNavigationRun!==run || !this.ctCurrent(ctx) || this.ctCurrentUnit!==unit || this._ctSelectRun!==opened
                            || this.ctKeyboardOverlayOpen() || this.ctHistoryViewer)return false;
                        const fields=this.ctTabFields(unit),field=fields[options.focusEnd?fields.length-1:0];
                        this.ctFocusedField=field?.id || '';this.ctFocusTarget(!!options.focusEnd,this.ctFocusedField);return true;
                    }
                    this.ctNotice='No available files in this direction.';return false;
                } finally {if(this._ctNavigationRun===run)this._ctNavigationRun=null;}
            },
            async ctKey(event) {
                if(event.isComposing || event.keyCode===229 || event.defaultPrevented || event.altKey || event.shiftKey)return;
                if(this.ctKeyboardOverlayOpen()){
                    if(['F1','F2'].includes(event.key) || (event.ctrlKey || event.metaKey)
                        && (event.key.toLowerCase()==='s' || ['Comma','Period'].includes(event.code)))event.preventDefault();
                    return;
                }
                if(this.ctHistoryViewer){
                    if(event.key==='Escape'){event.preventDefault();this.ctCloseHistoryViewer();}
                    else if(['F1','F2'].includes(event.key) || ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase()==='s' || ['Comma','Period'].includes(event.code))))event.preventDefault();
                    return;
                }
                if(event.ctrlKey && event.code===(this.filterShortcutCtrlD?'KeyD':'KeyF')){event.preventDefault();this.$refs.ctSearchInput?.focus();return;}
                if(event.target?.closest?.('.ctTools')){if(['F1','F2'].includes(event.key) || (event.ctrlKey || event.metaKey) && (event.key.toLowerCase()==='s' || ['Comma','Period'].includes(event.code)))event.preventDefault();return;}
                if(['F1','F2'].includes(event.key) || event.ctrlKey && ['Comma','Period'].includes(event.code)){
                    event.preventDefault();await this.ctSaveAndNavigate(event.key==='F1' || event.code==='Comma');
                }
                else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                    event.preventDefault();if(this.ctEditor){if(this.autoOpenNextFile)await this.ctSaveAndNavigate(false,{saveUnchanged:true});else await this.ctSave(true);}
                    else if(this.ctInlineUnitVisible())await this.ctSave();else await this.ctDownload();
                }
                else if (event.ctrlKey && !event.metaKey && ['ArrowUp', 'ArrowDown'].includes(event.key)
                    && this.ctInlineUnitVisible() && this.ctInlineNavigationTarget(event.target)) {
                    event.preventDefault();event.stopPropagation?.();await this.ctNavigate(event.key === 'ArrowUp' ? -1 : 1);
                }
                else if (event.key === 'Escape' && !event.ctrlKey && !event.metaKey) {
                    if(this.ctCompletion){event.preventDefault();event.stopPropagation?.();this.ctCloseCompletion();}
                    else if(this.ctEditor){event.preventDefault();event.stopPropagation?.();await this.ctCloseEditor();}
                    else if(this.ctInlineUnitVisible()){event.preventDefault();event.stopPropagation?.();await this.ctCloseInline();}
                }
            },
            ctResetHistory() {
                this._ctHistoryRun = {}; this._ctHistoryPreviousRun = {}; this._ctHistoryLocal = []; this._ctHistoryShared = []; this._ctHistoryReferences = []; this._ctHistoryLocalLimit = 100;
                this.ctHistory = []; this.ctHistoryCursor = null; this.ctHistoryLocalMore = false;
                this.ctHistoryLoading = false; this.ctHistoryPreviousLoading = false; this.ctHistoryError = ''; this.ctHistoryViewer = false;
                this.ctHistoryCompareA = 'original'; this.ctHistoryCompareB = 'current';
            },
            ctMergeHistory() {
                this.ctHistory = raw([...new Map([...(this._ctHistoryLocal || []), ...(this._ctHistoryShared || []), ...(this._ctHistoryReferences || [])]
                    .map(entry => [entry.key, entry])).values()].sort((a, b) => b.createdAt - a.createdAt || b.key.localeCompare(a.key)));
                for (const name of ['ctHistoryCompareA', 'ctHistoryCompareB']) if (!this.ctHistorySnapshotFor(this[name])) this[name] = name.endsWith('A') ? 'original' : 'current';
            },
            async ctLoadHistory(ctx = this.ctContext(), unitId = this.ctSelection, options = {}) {
                const unit = this._ctUnitIndex?.get(unitId);
                if (!unit || !this.ctCurrent(ctx) || this.ctSelection !== unitId || options.older && this.ctHistoryLoading) return false;
                const run = this._ctHistoryRun = {}, client = this._cloud;
                const current = () => this._ctHistoryRun === run && this.ctCurrent(ctx) && this.ctSelection === unitId && this.ctCurrentUnit === unit;
                this.ctHistoryLoading = true; this.ctHistoryError = '';
                const localLimit = options.older ? (this._ctHistoryLocalLimit || 100) + 100 : 100;
                const sharedAllowed = this.managedOnlineAvailable && client?.request && !/^(?:local|staged):/.test(ctx.scope.groupId)
                    && (this.cloudCanAccessAllLanguages || this.cloudUser?.language === ctx.scope.language);
                const tasks = [async () => {
                    const rows = await this._ctStore.listHistory(ctx.scope, unitId, { limit: localLimit + 1 });
                    if (!current()) return;
                    this._ctHistoryLocalLimit = localLimit; this.ctHistoryLocalMore = rows.length > localLimit;
                    this._ctHistoryLocal = rows.slice(0, localLimit).map(entry => normalizeHistory(entry, 'local', unit, ctx)).filter(Boolean);
                    this.ctMergeHistory();
                }];
                if (sharedAllowed && (!options.older || this.ctHistoryCursor)) tasks.push(async () => {
                    const cursor = options.older ? this.ctHistoryCursor : null;
                    const result = await client.request('/v1/content-groups/' + encodeURIComponent(ctx.scope.groupId) + '/units/'
                        + encodeURIComponent(unitId) + '/history?language=' + encodeURIComponent(ctx.scope.language) + '&limit=50'
                        + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
                    if (!current() || this._cloud !== client) return;
                    const rows = (result.history || []).map(entry => normalizeHistory(entry, 'shared', unit, ctx)).filter(Boolean);
                    this._ctHistoryShared = options.older ? [...this._ctHistoryShared || [], ...rows] : rows;
                    this.ctHistoryCursor = result.nextCursor || null; this.ctMergeHistory();
                });
                try {
                    const results = await Promise.allSettled(tasks.map(task => task()));
                    if (!current()) return false;
                    this.ctHistoryError = results.filter(result => result.status === 'rejected').map(result => result.reason.message || String(result.reason)).join('; ');
                    return !this.ctHistoryError;
                } finally { if (current()) this.ctHistoryLoading = false; }
            },
            ctLoadOlderHistory() { return this.ctLoadHistory(this.ctContext(), this.ctSelection, { older: true }); },
            async ctLoadPreviousHistory() {
                const provenance = this.ctHistoryPreviousProvenance, unit = this.ctCurrentUnit;
                if (!provenance || !unit || this.ctBusy || this.ctHistoryPreviousLoading) return false;
                const ctx = this.ctContext(), client = this._cloud, run = this._ctHistoryPreviousRun = {}, originalUnitId = provenance.unitId || unit.id;
                const current = () => this._ctHistoryPreviousRun === run && this.ctCurrent(ctx) && this.ctCurrentUnit === unit && this._cloud === client;
                const revision = Number(provenance.revision ?? 0);
                if (!Number.isSafeInteger(revision) || revision < 0) return false;
                this.ctHistoryPreviousLoading = true; this.ctHistoryError = '';
                try {
                    const rows = await this._ctStore.listWorkspaces({ accountId: ctx.scope.accountId, game: ctx.scope.game });
                    if (!current()) return false;
                    const cached = rows.find(row => row.groupId === provenance.groupId && row.language === ctx.scope.language
                        && row.branchId === ctx.scope.branchId && row.state === 'ready');
                    let previousScope = cached && this.ctScope(cached.versionId, cached.groupId, ctx.scope.language);
                    if (!previousScope) {
                        if (!this.managedOnlineAvailable || !client?.request) throw new Error('Connect once to verify the previous version original before comparing its English.');
                        const result = await client.request('/v1/content-groups/' + encodeURIComponent(provenance.groupId));
                        if (!current()) return false;
                        const group = result.group, version = result.version || group?.version;
                        if (group?.id !== provenance.groupId || group.contentMode !== 'clienttext' || group.language !== ctx.scope.language
                            || !version || group.versionId !== version.id || version.game !== ctx.scope.game || (version.branchId || 'default') !== ctx.scope.branchId)
                            throw new Error('The previous content group does not match this game, branch and language.');
                        if (!await this.ctOpenGroup(version, group, ctx.scope.language, false) || !current()) return false;
                        previousScope = this.ctScope(version.id, group.id, ctx.scope.language);
                    }
                    const previous = await this._ctStore.getUnit(previousScope, originalUnitId);
                    if (!current()) return false;
                    if (!previous) throw new Error('This record is unavailable in the verified previous version.');
                    let record = revision === 0 ? null : undefined;
                    if (revision) {
                        const local = await this._ctStore.listHistory(previousScope, originalUnitId, { limit: 5000 });
                        if (!current()) return false;
                        // Remote bases are accepted facts, even if their local
                        // overlay contains a later pending correction.
                        record = local.map(entry => entry.after?.remoteBase).find(value => value?.revision === revision);
                        let cursor = null; const seen = new Set();
                        if (!record && this.managedOnlineAvailable && client?.request) do {
                            const result = await client.request('/v1/content-groups/' + encodeURIComponent(previousScope.groupId) + '/units/'
                                + encodeURIComponent(originalUnitId) + '/history?language=' + encodeURIComponent(ctx.scope.language) + '&limit=100'
                                + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
                            if (!current()) return false;
                            record = (result.history || []).flatMap(entry => [entry.after, entry.before])
                                .find(value => (value?.unitId || value?.id) === originalUnitId && value.revision === revision);
                            const next = result.nextCursor || null;
                            if (next && seen.has(next)) throw new Error('Previous-version history cursor repeated. Try the comparison again.');
                            if (next) seen.add(next); cursor = next;
                        } while (!record && cursor);
                    }
                    if (!current()) return false;
                    const exact = revision === 0 || !!record;
                    const reference = { key: 'previous:' + previousScope.groupId + ':' + revision, unitId: unit.id, origin: 'reference',
                        action: exact ? 'Accepted revision ' + revision : 'Original workbook · saved revision ' + revision + ' unavailable',
                        createdAt: 0, actor: {}, before: historySnapshot(previous, null), after: historySnapshot(previous, record || null),
                        context: copy(ctx), provenance: copy(provenance), previousScope: copy(previousScope) };
                    this._ctHistoryReferences = [reference]; this.ctMergeHistory();
                    this.ctHistoryCompareA = reference.key + ':after'; this.ctHistoryCompareB = 'current'; this.ctOpenHistoryViewer();
                    if (!exact) this.ctHistoryError = 'The previous original English is verified. Saved revision ' + revision + ' is unavailable here, so the comparison uses its original workbook translation.';
                    return true;
                } catch (error) { if (current()) this.ctHistoryError = error.message; return false; }
                finally { if (current()) this.ctHistoryPreviousLoading = false; }
            },
            ctHistoryLabel(entry) {
                const time = entry.createdAt ? new Date(entry.createdAt).toLocaleString() : 'Unknown time';
                return (entry.origin === 'reference' ? 'Verified previous version' : entry.origin === 'shared' ? 'Shared' : 'Local')
                    + ' · ' + time + ' · ' + (entry.actor.name || entry.actor.id || entry.action);
            },
            ctHistoryEntryCurrent(entry) { return !!entry && this.ctHistory.includes(entry) && this.ctCurrent(entry.context) && entry.unitId === this.ctSelection; },
            ctHistorySnapshotFor(key) {
                const unit = this.ctCurrentUnit; if (!unit) return null;
                if (key === 'original') return historySnapshot(unit, null);
                if (key === 'current') return historySnapshot(unit, { values: this.ctValues, reviewed: this.ctReviewed });
                for (const entry of this.ctHistory) for (const side of ['before', 'after']) if (key === entry.key + ':' + side)
                    return this.ctHistoryEntryCurrent(entry) && entry[side].available ? entry[side] : null;
                return null;
            },
            ctHistoryDiffParts(before, after) {
                before = String(before ?? ''); after = String(after ?? '');
                if (before === after) return [{ value: before }];
                try { const diff = this.ctHistoryCharacters && root.Diff?.diffChars || root.Diff?.diffWordsWithSpace;
                    if (diff) return diff(before, after).map(part => ({ value: String(part.value), added: !!part.added, removed: !!part.removed })); }
                catch (_) { /* Exact raw before/after remains available if the optional diff library fails. */ }
                return [{ value: before, removed: true }, { value: after, added: true }];
            },
            ctHistoryDisplay(value) { return this.ctHistoryWhitespace ? String(value).replace(/ /g, '·').replace(/\u00a0/g, '⍽').replace(/\t/g, '⇥\t').replace(/\n/g, '↵\n').replace(/\r/g, '␍') : value; },
            ctHistoryFieldLabel(field) {
                const forms = { MS: 'Masculine singular', FS: 'Feminine singular', NS: 'Neuter singular', MP: 'Masculine plural', FP: 'Feminine plural', NP: 'Neuter plural' };
                return field.name + (field.form ? ' · ' + (forms[field.form] || field.form) + ' (' + field.form + ')' : field.kind === 'gender' ? ' · Gender' : '');
            },
            ctOpenHistoryViewer() {
                if (!this.ctCurrentUnit) return;
                if (!this.ctHistoryViewer) this._ctHistoryReturnFocus = root.document?.activeElement;
                this.ctHistoryViewer = true;
                this.$nextTick?.(() => root.document?.getElementById('ctHistoryClose')?.focus());
            },
            ctCloseHistoryViewer() {
                this.ctHistoryViewer = false;
                const target = this._ctHistoryReturnFocus; this._ctHistoryReturnFocus = null;
                this.$nextTick?.(() => (target?.isConnected ? target : root.document?.querySelector('.ctHistoryPanel button'))?.focus());
            },
            ctTrapHistoryFocus(event) {
                if (event.key !== 'Tab') return;
                const controls = [...event.currentTarget.querySelectorAll('button:not([disabled]),select:not([disabled]),input:not([disabled])')];
                const target = event.shiftKey ? controls.at(-1) : controls[0], edge = event.shiftKey ? controls[0] : controls.at(-1);
                if (target && (event.target === edge || !controls.includes(event.target))) { event.preventDefault(); target.focus(); }
            },
            ctPickHistory(entry, mode = 'change') {
                if (!this.ctHistoryEntryCurrent(entry)) return false;
                this.ctHistoryCompareA = mode === 'current' ? 'current' : entry.key + ':before';
                this.ctHistoryCompareB = entry.key + ':after'; this.ctOpenHistoryViewer(); return true;
            },
            async ctLoadMemory(ctx=this.ctContext()) {if(!this._ctStore?.getMemory)return;try{const memory=await this._ctStore.getMemory(ctx.scope);if(this.ctCurrent(ctx))this.ctMemory=raw(memory.units);}catch(error){if(this.ctCurrent(ctx))this.ctError=error.message;}},
            ctApplyMemory(match) {const field=this.ctPreviewField;if(!field || this.ctBusy)return;this.ctValues[field.id]=match.target;this.ctEdited(field);},
            async ctRestoreHistory(entry, side = 'after') {
                if (this.ctBusy || !['before', 'after'].includes(side) || !this.ctHistoryEntryCurrent(entry) || !entry[side].available) return false;
                const ctx = this.ctContext(), unit = this.ctCurrentUnit, snapshot = entry[side];
                const editor = JSON.stringify([this.ctValues, this.ctReviewed]);
                if (!await this.ctFlushDraft() || !this.ctCurrent(ctx) || this.ctCurrentUnit !== unit || !this.ctHistoryEntryCurrent(entry)
                    || JSON.stringify([this.ctValues, this.ctReviewed]) !== editor) return false;
                this.ctValues = Object.fromEntries(unit.fields.map(field => [field.id,
                    typeof snapshot.values[field.id] === 'string' ? snapshot.values[field.id] : String(field.target ?? '')]));
                this.ctReviewed = Object.fromEntries(Object.entries(snapshot.reviewed).filter(([id, hash]) => unit.fields.some(field => field.id === id && this.ctReviewHash(field) === hash)));
                this.ctDraftDirty = true;
                return await this.ctFlushDraft();
            },
            ctRefreshDiagnostics(ids) {
                if (!this.ctScanDone) return;
                const next = { ...this.ctDiagnostics };
                const affected=new Set(ids),keys=new Set(ids.flatMap(id=>[...(this._ctConsistencyByUnit?.get(id) || [])]));
                for(const key of keys)for(const entry of this._ctConsistencyIndex.get(key))affected.add(entry.unitId);
                for (const id of affected) { const unit = this._ctUnitIndex.get(id); if (unit) next[id] = this.ctDiagnose(unit); }
                if(this._ctConsistencyIndex){const allKeys=new Set([...affected].flatMap(id=>[...(this._ctConsistencyByUnit.get(id) || [])]));for(const key of allKeys)this.ctAddConsistency(next,key,affected);}
                this.ctDiagnostics = raw(next);
            },
            ctConsistencyKey(field) {return JSON.stringify([field.kind,field.form || null,root.ClientTextState.canonicalSource(field.source)]);},
            ctAddConsistency(results,key,allowed) {
                const entries=(this._ctConsistencyIndex?.get(key)||[]).map(entry=>({...entry,target:this.ctValuesFor(this._ctUnitIndex.get(entry.unitId))[entry.fieldId]})).filter(entry=>entry.target?.trim() && entry.target.trim()!=='NONEXISTENT');
                if(new Set(entries.map(entry=>entry.target)).size<2)return;
                for(const entry of entries)if(!allowed || allowed.has(entry.unitId))results[entry.unitId].push({code:'clienttext-consistency',severity:'warning',fieldId:entry.fieldId,message:'Same English and grammatical form have different saved translations.'});
            },
            async ctScan(consistency = false) {
                const ctx = this.ctContext(), results = {}, consistencyMap = new Map(),byUnit=new Map(); this.ctBusy = true; this._ctAbort = new AbortController();
                try {
                    for (let i = 0; i < this.ctUnits.length; i++) {
                        const unit = this.ctUnits[i]; results[unit.id] = this.ctDiagnose(unit);
                        if (consistency) {
                            for (const field of unit.fields) {
                                if (field.kind === 'gender' || !field.source.trim() || root.ClientTextState.audioOnly(field.source)) continue;
                                const key = this.ctConsistencyKey(field),entries=consistencyMap.get(key) || [];entries.push({unitId:unit.id,fieldId:field.id});consistencyMap.set(key,entries);
                                const keys=byUnit.get(unit.id)||new Set();keys.add(key);byUnit.set(unit.id,keys);
                            }
                        }
                        if (i % 200 === 0) { this.ctReport({ phase: 'Diagnostics', completed: i, total: this.ctUnits.length, sheet: unit.sheet }); await new Promise(resolve => setTimeout(resolve, 0)); if (!this.ctCurrent(ctx) || this._ctAbort.signal.aborted) return; }
                    }
                    if (this.ctCurrent(ctx)) {if(consistency){this._ctConsistencyIndex=consistencyMap;this._ctConsistencyByUnit=byUnit;for(const key of consistencyMap.keys())this.ctAddConsistency(results,key);}else{this._ctConsistencyIndex=null;this._ctConsistencyByUnit=null;}this.ctDiagnostics = raw(results); this.ctScanDone = true; this.ctNotice = 'Diagnostic scan complete.'; }
                } finally { if (this.ctCurrent(ctx)) { this.ctBusy = false; this.ctProgress = null; } }
            },
            async ctOpenGroup(version, group, language = this.lang, activate = true) {
                if (!group || this.ctBusy || this.managedVersionBusy) return;
                const openingKey=this.managedCatalogScope,openingEpoch=this._ctEpoch || 0;
                if(version.game!==this.gameVersion || (version.branchId || 'default')!==(this.branchId || 'default')){this.ctError='Select a version in the current game and branch.';return;}
                if(group.teams?.length && !group.teams.some(team=>team.language===language) || mode(group)==='clienttext' && group.language && group.language!==language){this.ctError='This content group is not assigned to '+language+'.';return;}
                if (mode(group) !== 'clienttext') { if(!await this.ctFlushDraft() || openingKey!==this.managedCatalogScope || openingEpoch!==(this._ctEpoch || 0))return;const previousGroup=this.activeContentGroup?.contentMode==='statdescription'?this.activeContentGroup:null;this.ctFence(); return this.managedOpenStatGroup(version, group, language,previousGroup); }
                if (!this.cloudCanAccessAllLanguages && language !== this.cloudUser?.language) return;
                if(activate)this.lang = language;
                version={...version,contentGroups:this.managedSelectedDetails?.version?.id===version.id?this.managedSelectedDetails.contentGroups:version.contentGroups || []};
                const scope = this.ctScope(version.id, group.id, language), key = this.managedCatalogScope; this.ctBusy = true; this.ctError = ''; this._ctAbort = new AbortController();
                const signal=this._ctAbort.signal,current=()=>key===this.managedCatalogScope && openingEpoch===(this._ctEpoch || 0) && !signal.aborted;
                try {
                    const cached = (await this._ctStore.listWorkspaces({ accountId: scope.accountId })).find(row => root.ClientTextStore.scopeKey(row) === root.ClientTextStore.scopeKey(scope) && row.state === 'ready');
                    if(!current())return;
                    if (cached) return activate ? await this.ctActivate(scope, {...cached,version}) : cached;
                    const response = await this._cloud.request('/v1/content-groups/' + encodeURIComponent(group.id),{signal:this._ctAbort.signal}); const full = response.group || response.contentGroup || response;
                    if (!current()) return;
                    if(full.id!==group.id || full.versionId!==version.id || full.contentMode!=='clienttext' || full.language!==language || full.game && full.game!==scope.game || full.branchId && full.branchId!==scope.branchId)throw new Error('The returned content group differs from the selected version, team, game or branch.');
                    const units = [], assets = [], descriptors = (full.assets || []).map(asset=>({...asset,...asset.descriptor}));
                    for (const descriptor of descriptors) {
                        const role = descriptor.role;
                        const blob = await this._cloud.request('/v1/content-groups/' + encodeURIComponent(group.id) + '/assets/' + encodeURIComponent(role) + '/original', { responseType: 'blob', timeout: 180000,signal:this._ctAbort.signal });
                        if (!current()) return;
                        const parsed = await this._ctWorker.parseWorkbook(await blob.arrayBuffer(), { filename: descriptor.filename || descriptor.name, role, language, signal: this._ctAbort.signal, onProgress: progress => this.ctReport({...progress,workbook:descriptor.filename}) });
                        if ((descriptor.artifactHash || descriptor.hash) && parsed.artifactHash !== (descriptor.artifactHash || descriptor.hash)) throw new Error('The original workbook hash differs from the published manifest.');
                        for(const unit of parsed.units)units.push(unit); assets.push({ role, blob, hash: parsed.artifactHash, name: parsed.filename, parsed: { ...parsed, units: undefined } });
                    }
                    const manifest = await this._ctWorker.buildManifest(units, assets, {signal:this._ctAbort.signal,onProgress:progress=>this.ctReport(progress)});
                    for (const expected of descriptors) {
                        const actual = manifest.descriptors.find(item => item.role === expected.role);
                        if (expected.baselineId && actual.baselineId !== expected.baselineId) throw new Error('Workbook parsing differs from the manager’s accepted manifest. Import has been blocked.');
                    }
                    if (!current()) return;
                    const metadata = { version, group: full };
                    await this._ctStore.import(scope, { units, assets, manifest, metadata },{guard:current,onProgress:progress=>{if(current())this.ctReport(progress);}});
                    return activate ? await this.ctActivate(scope, metadata) : metadata;
                } catch (error) { if (key === this.managedCatalogScope && error.name !== 'AbortError') this.ctError = error.message; }
                finally { if (key === this.managedCatalogScope) { this.ctBusy = false; this.ctProgress = null; } }
            },
            async ctDownload(collection, group = this.ctWorkspace?.metadata.group, language = this.lang, version = this.ctWorkspace?.metadata.version) {
                if (this.ctBusy || !group) return;
                if (!await this.ctFlushDraft()) return;
                const scope = this.ctScope(version.id, group.id, language), key = this.managedCatalogScope;
                if((await this._ctStore.getMetadata(scope))?.state!=='ready' && !await this.ctOpenGroup(version,group,language,false))return;
                this.ctBusy = true; this.ctError = ''; this._ctAbort = new AbortController();
                try {
                    let saved = await this._ctStore.getSaved(scope);
                    if (collection) {
                        saved = {}; let cursor = '';
                        do {
                            const response = await this._cloud.request('/v1/content-collections/' + encodeURIComponent(collection.id) + '/manifest' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''),{signal:this._ctAbort.signal});
                            if (response.collection?.id !== collection.id) throw new Error('Collection identity changed.');
                            if(response.manifest?.groupId!==group.id || response.manifest?.versionId!==version.id || response.manifest?.language!==language)throw new Error('Collection scope differs from selected content group.');
                            for (const unit of response.manifest?.units || []) saved[unit.unitId || unit.id] = typeof unit.saved==='object' ? unit.saved : unit;
                            for (const unit of response.manifest?.sourceReviews || []) saved[unit.unitId || unit.id] = { ...unit,saved:false,values:unit.values || {} };
                            cursor = response.nextCursor || '';
                        } while (cursor && key === this.managedCatalogScope && !this._ctAbort.signal.aborted);
                    }
                    const units = await this._ctStore.getUnits(scope), roles = [...new Set(units.map(unit => unit.role))], outputs = [];
                    for (const role of roles) {
                        const asset = await this._ctStore.getAsset(scope, role); if (!asset) throw new Error('Open this content group once to verify and cache its originals before downloading.');
                        const bytes = assetBytes(asset), buffer = bytes instanceof Blob ? await bytes.arrayBuffer() : bytes;
                        const parsed = { ...asset.parsed, units: units.filter(unit => unit.role === role) };
                        const roleSaved=Object.fromEntries(parsed.units.filter(unit=>saved[unit.id]).map(unit=>[unit.id,saved[unit.id]]));
                        const output = await this._ctWorker.exportWorkbook(buffer, parsed, roleSaved, { signal: this._ctAbort.signal, onProgress: progress => this.ctReport({...progress,workbook:asset.name}) });
                        outputs.push({ name: asset.name || parsed.filename, bytes: output });
                        if (key !== this.managedCatalogScope || this._ctAbort.signal.aborted) return;
                    }
                    if (!outputs.length) throw new Error('This workbook group is not cached. Open its editor before downloading.');
                    let blob, name;
                    if (outputs.length === 1) { blob = new Blob([outputs[0].bytes]); name = outputs[0].name; }
                    else { const zip = new root.JSZip(); outputs.forEach(file => zip.file(file.name, file.bytes)); this.ctReport({ phase: 'Compressing paired workbooks', completed: 0, total: 100, sheet: '' }); blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }, progress => {if(this._ctAbort.signal.aborted)throw Object.assign(new Error('Cancelled'),{name:'AbortError'});this.ctReport({ completed: progress.percent });}); name = `${version.name}_${language}_ClientText.zip`; }
                    if (key === this.managedCatalogScope && !this._ctAbort.signal.aborted) {root.saveAs(blob, name);return true;}
                } catch (error) { if (key === this.managedCatalogScope && error.name !== 'AbortError') this.ctError = error.message; }
                finally { if (key === this.managedCatalogScope) { this.ctBusy = false; this.ctProgress = null; } }
            },
            async ctCollect(version, group, team, end = true) {
                const key = this.managedCatalogScope,epoch=this._ctEpoch || 0,client=this._cloud,current=()=>key===this.managedCatalogScope && epoch===(this._ctEpoch || 0); this.ctBusy = true;
                try {
                    const requestKey='collection:'+JSON.stringify([group.id,team.language,end]),requestScope=this.ctRequestScope();
                    let journal=await this._ctStore.getRequest(requestScope,requestKey);
                    if(!journal){await this._ctStore.putRequest(requestScope,requestKey,{kind:'collection',groupId:group.id,language:team.language,endWindow:end,idempotencyKey:uuid()});journal=await this._ctStore.getRequest(requestScope,requestKey);}
                    if(!current())return;
                    const response = journal.payload.collection ? {collection:journal.payload.collection} : await client.request('/v1/content-groups/' + encodeURIComponent(group.id) + '/teams/' + encodeURIComponent(team.language) + '/collections', { method: 'POST', body: { idempotencyKey: journal.payload.idempotencyKey, endWindow: end } });
                    await this._ctStore.putRequest(requestScope,requestKey,{...journal.payload,collection:response.collection});
                    if (!current()) return;
                    await this.managedReadDetails(version.id, false); this.ctBusy = false;
                    const downloaded=mode(group) === 'clienttext' ? await this.ctDownload(response.collection, group, team.language, version) : await this.managedDownloadStatGroupCollection(version, group, team, response.collection);
                    if(key===this.managedCatalogScope && downloaded)await this._ctStore.deleteRequest(requestScope,requestKey);
                } catch (error) { if (current()) this.ctError = error.message; }
                finally { if (current()) this.ctBusy = false; }
            },
            async ctReopen(version, group, team) {
                const key=this.managedCatalogScope,epoch=this._ctEpoch || 0,client=this._cloud,current=()=>key===this.managedCatalogScope && epoch===(this._ctEpoch || 0),scope=this.ctRequestScope(),requestKey='reopen:'+JSON.stringify([group.id,team.language]);
                try {let journal=await this._ctStore.getRequest(scope,requestKey);if(!journal){await this._ctStore.putRequest(scope,requestKey,{kind:'reopen',idempotencyKey:uuid()});journal=await this._ctStore.getRequest(scope,requestKey);}if(!current())return;await client.request('/v1/content-groups/' + encodeURIComponent(group.id) + '/teams/' + encodeURIComponent(team.language) + '/reopen', { method: 'POST',body:{idempotencyKey:journal.payload.idempotencyKey} });await this._ctStore.deleteRequest(scope,requestKey);if(current())await this.managedReadDetails(version.id, false); } catch (error) { if(current())this.ctError = error.message; }
            },
            async ctDownloadSnapshot(version,group,team,event) {const id=event.target.value;event.target.value='';const collection=team.collections?.find(item=>item.id===id);if(!collection)return;if(mode(group)==='clienttext')return this.ctDownload(collection,group,team.language,version);try{return await this.managedDownloadStatGroupCollection(version,group,team,collection);}catch(error){this.ctError=error.message;}},
            async ctLoadComments(ctx = this.ctContext(), unitId = this.ctSelection) {
                if (!this.managedOnlineAvailable || (!this.cloudCanAccessAllLanguages && ctx.scope.language!==this.cloudUser?.language) || String(ctx.scope.groupId).startsWith('local:')) return;
                try { const response = await this._cloud.request('/v1/content-groups/' + encodeURIComponent(ctx.scope.groupId) + '/units/' + encodeURIComponent(unitId) + '/comments?language='+encodeURIComponent(ctx.scope.language)); if (this.ctCurrent(ctx) && unitId === this.ctSelection && JSON.stringify(this.ctComments)!==JSON.stringify(response.comments || [])) this.ctComments = response.comments || []; }
                catch (error) { if (this.ctCurrent(ctx) && this.ctTool === 'comments') this.ctError = error.message; }
            },
            ctCommentKey(ctx=this.ctContext(),unitId=this.ctSelection) {return 'comment:'+root.ClientTextState.hash([root.ClientTextStore.scopeKey(ctx.scope),unitId]);},
            ctQueueCommentDraft() {clearTimeout(this._ctCommentTimer);this._ctCommentTimer=setTimeout(()=>this.ctFlushCommentDraft(),200);},
            async ctFlushCommentDraft() {
                clearTimeout(this._ctCommentTimer);if(!this._ctStore || !this.ctWorkspace || !this.ctSelection)return;
                const ctx=this.ctContext(),unitId=this.ctSelection,scope={accountId:ctx.scope.accountId,game:ctx.scope.game,branchId:ctx.scope.branchId},key=this.ctCommentKey(ctx,unitId),text=this.ctCommentText,audience=this.ctCommentGlobal?'global':'language';
                const pending=(this._ctCommentQueue || Promise.resolve()).catch(()=>{}).then(async()=>{const previous=await this._ctStore.getRequest(scope,key);if(!text.trim()&&!previous)return;const old=previous?.payload;await this._ctStore.putRequest(scope,key,{kind:'comment',groupId:ctx.scope.groupId,language:ctx.scope.language,unitId,text,audience,idempotencyKey:old?.text===text && old?.audience===audience?old.idempotencyKey:uuid()});});
                this._ctCommentQueue=pending;await pending;
            },
            async ctLoadCommentDraft(ctx,unitId) {const before=JSON.stringify([this.ctCommentText,this.ctCommentGlobal]);try{const request=await this._ctStore.getRequest({accountId:ctx.scope.accountId,game:ctx.scope.game,branchId:ctx.scope.branchId},this.ctCommentKey(ctx,unitId));if(this.ctCurrent(ctx)&&this.ctSelection===unitId && before===JSON.stringify([this.ctCommentText,this.ctCommentGlobal])){this.ctCommentText=request?.payload.text || '';this.ctCommentGlobal=request?.payload.audience==='global';}}catch(error){if(this.ctCurrent(ctx))this.ctError='Comment draft was not restored: '+error.message;}},
            async ctPostComment() {
                if (!this.ctCommentText.trim() || this.ctBusy) return;
                const ctx = this.ctContext(), unitId = this.ctSelection,scope=this.ctRequestScope(),key=this.ctCommentKey(ctx,unitId),client=this._cloud; this.ctBusy = true;
                try {await this.ctFlushCommentDraft();const request=await this._ctStore.getRequest(scope,key),command=request.payload;if(!this.ctCurrent(ctx) || unitId!==this.ctSelection)return;await client.request('/v1/content-groups/' + encodeURIComponent(ctx.scope.groupId) + '/units/' + encodeURIComponent(unitId) + '/comments', { method: 'POST', body: { text: command.text, language: ctx.scope.language, audience: command.audience, idempotencyKey: command.idempotencyKey } });await this._ctStore.deleteRequest(scope,key,{expectedIdempotencyKey:command.idempotencyKey});if (this.ctCurrent(ctx) && this.ctSelection === unitId) {if(this.ctCommentText===command.text && (this.ctCommentGlobal?'global':'language')===command.audience){this.ctCommentText = '';this.ctCommentGlobal=false;}await this.ctLoadComments(ctx, unitId); } }
                catch (error) { if (this.ctCurrent(ctx)) this.ctError = error.message; } finally { if (this.ctCurrent(ctx)) this.ctBusy = false; }
            },
            async ctPresence(ctx = this.ctContext()) {
                if (!this.managedOnlineAvailable || (!this.cloudCanAccessAllLanguages && ctx.scope.language!==this.cloudUser?.language) || String(ctx.scope.groupId).startsWith('local:')) return;
                try { await this._cloud.request('/v1/content-groups/' + encodeURIComponent(ctx.scope.groupId) + '/presence', { method: 'POST', body: { unitId: this.ctSelection || null, sessionId: this.instanceTabId, language: ctx.scope.language } }); const response=await this._cloud.request('/v1/content-groups/'+encodeURIComponent(ctx.scope.groupId)+'/presence'); if (this.ctCurrent(ctx)) this.ctPeers = response.presence || []; } catch (_) { /* Translation requests retain their own failures. */ }
            },
            async ctOpenUpload(version = null, local = false) {
                if (!local && !this.managedManagerAccess) return;
                this._ctPublicationRequest=null;this._ctReleaseRequest=null;this._ctReleaseCommand=null;this.ctDuplicateChoices={};
                this.ctUploadVisible = true; this.ctUploadVersion = version; this.ctUploadLocal = local; this.ctUploadFiles = raw([]); this.ctPrepared = raw([]); this.ctUploadError = ''; this.ctUploadAssignments = teams.slice();
                const defaults = root.ManagedVersions.defaults(this.gameVersion); this.ctUploadName = version?.name || defaults.name; this.ctUploadDeadline = root.ManagedVersions.deadlineInput(version?.deadlineAt || defaults.deadlineAt);
                const key=this.managedCatalogScope;
                if (!local) try { const policy = await this._cloud.request('/v1/content-policy');if(key!==this.managedCatalogScope)return;this.ctPolicy=policy;this.ctPolicyText = JSON.stringify(this.ctPolicy.clientTextRoles, null, 2); } catch (error) { if(key===this.managedCatalogScope)this.ctUploadError = error.message; }
                else this.ctPolicy = { clientTextRoles: { default: ['normal'], French: ['normal', 'gender'], German: ['normal', 'gender'] } };
            },
            ctChooseFiles(event) {
                this.ctPrepared = raw([]); this.ctUploadError = '';
                this.ctUploadFiles = raw(Array.from(event.target.files || []).filter(file => /\.(xlsx|xlsm|zip)$/i.test(file.name)).map(file => ({ file, ...detect(file.name) })));
            },
            async ctPrepareUpload() {
                if (this.ctUploading) return; this.ctUploading = true; this.ctUploadError = ''; this._ctAbort = new AbortController();
                const key = this.managedCatalogScope, prepared = [];
                try {
                    if (!this.ctUploadFiles.length) throw new Error('Select original workbook files or StatDescriptions.zip. Missing_XXX.txt is ignored.');
                    const groups = new Map();
                    for (const candidate of this.ctUploadFiles) {
                        if (/\.zip$/i.test(candidate.file.name)) {
                            if (this.ctUploadLocal) throw new Error('Use Import ZIP for local StatDescription imports.');
                            if (prepared.some(group => group.contentMode === 'statdescription')) throw new Error('A version can contain only one StatDescription ZIP group.');
                            const zip=await root.JSZip.loadAsync(candidate.file),entries=Object.values(zip.files).filter(entry=>!entry.dir && /\.txt$/i.test(entry.name));
                            if(!entries.length || root.StatDescCodec.detectGameVersionFromFilepaths(entries.map(entry=>entry.name))!==this.gameVersion)throw new Error('The ZIP does not match the selected game.');
                            const source=[];for(let index=0;index<entries.length;index++){const desc=await root.parseFile(entries[index].name,entries[index],this.lang || 'Thai',{strict:true});if(desc)source.push(desc);this.ctReport({phase:'Checking StatDescription',completed:index+1,total:entries.length,sheet:entries[index].name});if(key!==this.managedCatalogScope || this._ctAbort.signal.aborted)return;}
                            const duplicateGroups=root.StatDescCodec.collectDuplicateLangGroups(source);
                            const parent=(await this.ctFindPreviousGroup({contentMode:'statdescription'}))?.group;
                            prepared.push({ contentMode: 'statdescription', candidates: [candidate], assignments: this.ctUploadAssignments.slice(),parentGroupId:parent?.id,duplicateGroups }); continue;
                        }
                        if (!candidate.language) throw new Error('Confirm the language team for ' + candidate.file.name + '.');
                        const candidates = groups.get(candidate.language) || []; if (candidates.some(item => item.role === candidate.role)) throw new Error('Duplicate ' + candidate.role + ' workbook for ' + candidate.language + '.'); candidates.push(candidate); groups.set(candidate.language, candidates);
                    }
                    for (const [language, candidates] of groups) {
                        const required = this.ctPolicy.clientTextRoles[language] || this.ctPolicy.clientTextRoles.default || ['normal'];
                        if (required.some(role => !candidates.some(item => item.role === role)) || candidates.some(item => !required.includes(item.role))) throw new Error(language + ' requires exactly these workbook roles: ' + required.join(', ') + '.');
                        candidates.sort((a,b)=>required.indexOf(a.role)-required.indexOf(b.role));
                        const units = [], assets = [];
                        for (const candidate of candidates) {
                            // ClientText filenames are optional naming hints.
                            // The selected release supplies the game scope.
                            const bytes = await candidate.file.arrayBuffer();
                            const parsed = await this._ctWorker.parseWorkbook(bytes, { filename: candidate.file.name, role: candidate.role, language, signal: this._ctAbort.signal, onProgress: progress => this.ctReport(progress) });
                            for(const unit of parsed.units)units.push(unit);
                            assets.push({ role: candidate.role, blob: candidate.file, name: candidate.file.name, hash: parsed.artifactHash, parsed: { ...parsed, units: undefined } });
                            if (key !== this.managedCatalogScope || this._ctAbort.signal.aborted) return;
                        }
                        this.ctReport({ phase: 'Building compact manifest', workbook: language, sheet: '' });
                        const manifest = await this._ctWorker.buildManifest(units, assets,{signal:this._ctAbort.signal,onProgress:progress=>this.ctReport(progress)});
                        const preparedGroup={ contentMode: 'clienttext', language, assignments: [language], candidates, units, assets, manifest, warnings: assets.flatMap(asset => asset.parsed.warnings || []) };
                        if(!this.ctUploadLocal)await this.ctPrepareCarry(preparedGroup);
                        prepared.push(preparedGroup);
                    }
                    if (key === this.managedCatalogScope) this.ctPrepared = raw(prepared);
                } catch (error) { if (key === this.managedCatalogScope && error.name !== 'AbortError') this.ctUploadError = error.message; }
                finally { if (key === this.managedCatalogScope) { this.ctUploading = false; this.ctProgress = null; } }
            },
            async ctSavePolicy() {
                try { const roles = JSON.parse(this.ctPolicyText); this.ctPolicy = await this._cloud.request('/v1/content-policy', { method: 'PATCH', body: { expectedRevision: this.ctPolicy.revision, clientTextRoles: roles } }); this.ctUploadError = ''; } catch (error) { this.ctUploadError = error.message; }
            },
            ctRequestScope() {return {accountId:this.cloudProfileId || this.cloudUser?.id || 'guest',game:this.gameVersion,branchId:this.branchId || 'default'};},
            async ctSaveMetadataDraft() {
                if(this.ctUploading || this.ctUploadLocal || this.ctUploadVersion)return;
                const key=this.managedCatalogScope;this.ctUploading=true;
                try{
                    this._ctReleaseRequest ||= uuid();const scope=this.ctRequestScope(),client=this._cloud,existing=await this._ctStore.getRequest(scope,this._ctReleaseRequest);
                    const command=existing?.payload.command || {game:scope.game,branchId:scope.branchId,name:this.ctUploadName.trim(),deadlineAt:root.ManagedVersions.parseDeadline(this.ctUploadDeadline),idempotencyKey:this._ctReleaseRequest};
                    await this._ctStore.putRequest(scope,this._ctReleaseRequest,{kind:'metadata',name:command.name,deadline:this.ctUploadDeadline,command});if(key!==this.managedCatalogScope)return;
                    const response=await client.request('/v1/content-versions',{method:'POST',body:command});
                    if(key!==this.managedCatalogScope)return;
                    await this._ctStore.deleteRequest(this.ctRequestScope(),this._ctReleaseRequest);this._ctReleaseRequest=null;this.ctUploadVersion=response.version;await this.refreshManagedVersions();this.ctUploadError='';
                }catch(error){if(key===this.managedCatalogScope)this.ctUploadError=error.message;}finally{if(key===this.managedCatalogScope)this.ctUploading=false;}
            },
            async ctRememberPublication() {
                const key=this.managedCatalogScope,signal=this._ctAbort.signal;
                this._ctPublicationRequest ||= uuid();
                for(let index=0;index<this.ctPrepared.length;index++){
                    const prepared=this.ctPrepared[index];
                    if(prepared.contentMode==='clienttext' && (!prepared.cacheScope || (await this._ctStore.getMetadata(prepared.cacheScope))?.state!=='ready')){
                        prepared.cacheScope ||= this.ctScope('upload:'+this._ctPublicationRequest,'staged:'+this._ctPublicationRequest+':'+index,prepared.language);
                        await this._ctStore.import(prepared.cacheScope,{units:prepared.units,assets:prepared.assets,manifest:prepared.manifest,metadata:{name:this.ctUploadName}},{guard:()=>key===this.managedCatalogScope && !signal.aborted,onProgress:progress=>this.ctReport({...progress,workbook:prepared.language})});
                    }
                }
                const groups=this.ctPrepared.map(prepared=>({contentMode:prepared.contentMode,language:prepared.language,assignments:prepared.assignments,parentGroupId:prepared.parentGroupId,cacheScope:prepared.cacheScope,carry:prepared.carry,
                    requestId:prepared.requestId,uploadId:prepared.uploadId,createBody:prepared.createBody,finalizeBody:prepared.finalizeBody,published:prepared.published,
                    candidates:prepared.contentMode==='statdescription'?prepared.candidates:undefined,warnings:prepared.warnings,duplicateGroups:prepared.duplicateGroups}));
                if(key!==this.managedCatalogScope || signal.aborted)throw Object.assign(new Error('Publication context changed'),{stale:true});
                await this._ctStore.putRequest(this.ctRequestScope(),this._ctPublicationRequest,{kind:'publication',name:this.ctUploadName,deadline:this.ctUploadDeadline,version:this.ctUploadVersion ? copy(this.ctUploadVersion) : null,releaseRequest:this._ctReleaseRequest,releaseCommand:this._ctReleaseCommand,duplicateChoices:copy(this.ctDuplicateChoices),groups},{immutablePublicationData:true,guard:()=>key===this.managedCatalogScope && !signal.aborted});
            },
            async ctResumePublication(request) {
                const key=this.managedCatalogScope,epoch=this._ctEpoch || 0,current=()=>key===this.managedCatalogScope && epoch===(this._ctEpoch || 0);
                try {
                    const requestScope=this.ctRequestScope(),stored=await this._ctStore.getRequest(requestScope,request.requestId,{guard:current});
                    if(!current())return;
                    if(!stored){await this.ctRefreshLocal();return;}
                    const payload=stored.payload;await this.ctOpenUpload(payload.version || null,false);if(!current())return;this.ctUploadName=payload.name;this.ctUploadDeadline=payload.deadline;this._ctPublicationRequest=request.requestId;this._ctReleaseRequest=payload.releaseRequest || (payload.kind==='metadata'?request.requestId:null);this._ctReleaseCommand=payload.releaseCommand || payload.command || null;
                    this.ctDuplicateChoices=payload.duplicateChoices || {};const prepared=[];
                    for(const group of payload.groups || []){
                        if(group.cacheScope){
                            const units=await this._ctStore.getUnits(group.cacheScope,{guard:current}),metadata=await this._ctStore.getMetadata(group.cacheScope,{guard:current}),assets=[];
                            for(const descriptor of metadata.descriptors)assets.push(await this._ctStore.getAsset(group.cacheScope,descriptor.role,{guard:current}));
                            // Reuse the accepted immutable compact records. A
                            // resume must not rehash the workbook on the UI thread.
                            const compact=await this._ctStore.getCompactUnits(group.cacheScope,{guard:current});
                            const manifest={format:root.ClientTextState.FORMAT,units:compact,descriptors:assets.map(asset=>asset.descriptor),trees:Object.fromEntries(assets.map(asset=>[asset.role,asset.tree]))};
                            prepared.push({...group,units,assets,manifest,candidates:assets.map(asset=>({file:new File([assetBytes(asset)],asset.name),role:asset.role,language:group.language}))});
                        }else prepared.push(group);
                    }
                    if(current())this.ctPrepared=raw(prepared);
                } catch(error) { if(current() && !error.stale && error.name!=='AbortError')this.ctUploadError='Prepared upload could not be restored: '+error.message; }
            },
            async ctFindPreviousGroup(prepared) {
                const key=this.managedCatalogScope,game=this.gameVersion,branchId=this.branchId || 'default',versionId=this.ctUploadVersion?.id || '',signal=this._ctAbort?.signal,client=this._cloud;
                const query={game,branchId,contentMode:prepared.contentMode,...(prepared.contentMode==='clienttext'?{language:prepared.language}:{}),...(versionId?{versionId}:{}),...(prepared.logicalKey?{logicalKey:prepared.logicalKey}:{})};
                const result=await client.request('/v1/content-predecessor?'+Object.entries(query).map(([key,value])=>encodeURIComponent(key)+'='+encodeURIComponent(value)).join('&'),{signal});
                if(key!==this.managedCatalogScope || game!==this.gameVersion || branchId!==(this.branchId || 'default') || versionId!==(this.ctUploadVersion?.id || '') || signal?.aborted)throw Object.assign(new Error('Content preparation was superseded.'),{name:'AbortError',stale:true});
                if(!result.group && !result.version)return null;
                if(!result.group || !result.version || result.version.game!==game || (result.version.branchId || 'default')!==branchId || result.version.id===versionId || result.group.versionId!==result.version.id || mode(result.group)!==prepared.contentMode || prepared.contentMode==='clienttext' && result.group.language!==prepared.language)throw new Error('The previous content group does not match this release and team. Prepare the originals again.');
                return result;
            },
            async ctPrepareCarry(prepared) {
                const previous=await this.ctFindPreviousGroup(prepared),previousVersion=previous?.version,previousGroup=previous?.group;
                if(!previousGroup)return;
                const key=this.managedCatalogScope,scope=this.ctScope(previousVersion.id,previousGroup.id,prepared.language),signal=this._ctAbort.signal;
                const current=()=>{if(key!==this.managedCatalogScope || signal.aborted)throw Object.assign(new Error('Content preparation was superseded.'),{name:'AbortError',stale:true});};
                let metadata=await this._ctStore.getMetadata(scope);
                current();
                if(metadata?.state!=='ready'){
                    const group=(await this._cloud.request('/v1/content-groups/'+encodeURIComponent(previousGroup.id),{signal})).group;
                    current();
                    const units=[],assets=[];
                    for(const asset of group.assets){
                        const blob=await this._cloud.request('/v1/content-groups/'+encodeURIComponent(group.id)+'/assets/'+encodeURIComponent(asset.role)+'/original',{responseType:'blob',timeout:180000,signal});
                        current();
                        const parsed=await this._ctWorker.parseWorkbook(await blob.arrayBuffer(),{filename:asset.filename,role:asset.role,language:prepared.language,signal:this._ctAbort.signal,onProgress:progress=>this.ctReport({...progress,workbook:'Previous '+asset.filename})});
                        if(parsed.artifactHash!==asset.artifactHash)throw new Error('The previous original hash differs from its accepted manifest.');
                        for(const unit of parsed.units)units.push(unit);assets.push({role:asset.role,blob,name:asset.filename,hash:parsed.artifactHash,parsed:{...parsed,units:undefined}});
                    }
                    const manifest=await this._ctWorker.buildManifest(units,assets,{signal:this._ctAbort.signal,onProgress:progress=>this.ctReport(progress)});
                    for(const asset of group.assets)if(manifest.descriptors.find(item=>item.role===asset.role)?.baselineId!==asset.descriptor.baselineId)throw new Error('The previous workbook parser does not reproduce the accepted manifest.');
                    metadata={version:previousVersion,group};await this._ctStore.import(scope,{units,assets,manifest,metadata},{guard:()=>key===this.managedCatalogScope});
                }
                const previousUnits=new Map((await this._ctStore.getUnits(scope)).map(unit=>[unit.id,unit])),accepted={},previousTrees={};let after=0;
                current();
                // Hydrate each immutable proof tree once for this comparison.
                // Reading the entire workbook asset per carried ID makes this
                // loop grow with record count times workbook size.
                for(const asset of prepared.assets){const previous=await this._ctStore.getAsset(scope,asset.role);current();previousTrees[asset.role]=previous?.tree;const before=new Map((previous?.parsed?.sheets || []).map(sheet=>[sheet.name,sheet]));for(const sheet of asset.parsed.sheets){const old=before.get(sheet.name);before.delete(sheet.name);if(!old){prepared.warnings.push({message:asset.role+' / '+sheet.name+': added sheet.'});continue;}const oldHeaders=new Map(old.headers.map(header=>[header.name,header.column])),changes=[];for(const header of sheet.headers){const column=oldHeaders.get(header.name);oldHeaders.delete(header.name);if(column===undefined)changes.push('added '+header.name);else if(column!==header.column)changes.push(header.name+' moved from column '+column+' to '+header.column);}for(const heading of oldHeaders.keys())changes.push('removed '+heading);if(changes.length)prepared.warnings.push({message:asset.role+' / '+sheet.name+': '+changes.join('; ')+'. Recognized fields retain their identity.'});}for(const sheet of before.keys())prepared.warnings.push({message:asset.role+' / '+sheet+': removed sheet; previous work remains in history.'});}
                do{
                    const result=await this._cloud.request('/v1/content-groups/'+encodeURIComponent(previousGroup.id)+'/events?language='+encodeURIComponent(prepared.language)+'&after='+after+'&limit=100',{signal});
                    current();
                    for(const event of result.events){accepted[event.unitId]=event.unit;after=event.sequence;}
                    if(!result.hasMore)break;
                    current();
                }while(true);
                const carry=[];
                for(let index=0;index<prepared.units.length;index++){
                    const next=prepared.units[index],old=previousUnits.get(next.id);if(!old)continue;
                    const before=accepted[next.id],state=root.ClientTextState.carryForward(old,next,before);
                    const markerReview=next.fields.some(field=>{const previous=old.fields.find(item=>item.id===field.id);return previous && previous.source!==field.source && root.ClientTextState.canonicalSource(previous.source)===root.ClientTextState.canonicalSource(field.source) && field.outdated;});
                    if(before || state.outdated.length || markerReview){
                        const previousProof=root.ClientTextState.proofFor({trees:previousTrees},next.id);
                        carry.push({id:next.id,role:next.role,language:prepared.language,values:state.values,reviewed:state.reviewed,baseline:next,proof:root.ClientTextState.proofFor(prepared.manifest,next.id),previousBaseline:old,previousProof,sourceOnly:!before || before.saved===false,provenance:{groupId:previousGroup.id,unitId:next.id,revision:before?.revision||0}});
                    }
                    if(index%256===255){this.ctReport({phase:'Comparing verified source',completed:index,total:prepared.units.length,sheet:next.sheet});await new Promise(resolve=>setTimeout(resolve,0));current();}
                }
                prepared.parentGroupId=previousGroup.id;prepared.carry=carry;prepared.warnings.push({message:'Previous accepted work will carry forward independently: '+carry.length+' affected IDs. Removed IDs remain accessible in the previous version.'});
            },
            async ctPublishPrepared() {
                if (!this.ctPrepared.length || this.ctUploading) return; this.ctUploading = true; this.ctUploadError = ''; const key = this.managedCatalogScope,client=this._cloud; this._ctAbort = new AbortController();
                try {
                    if (this.ctUploadLocal) {
                        const versionId = 'local:' + uuid(), metadataVersion = { id: versionId, game: this.gameVersion, branchId: this.branchId, name: this.ctUploadName, contentGroups: this.ctPrepared.map(prepared=>({ id: 'local:' + uuid(), versionId, contentMode: 'clienttext', language: prepared.language, roles: prepared.assets.map(asset=>asset.role) })) };
                        for (let index=0;index<this.ctPrepared.length;index++) {
                            const prepared=this.ctPrepared[index],group=metadataVersion.contentGroups[index];
                            const scope = this.ctScope(versionId, group.id, prepared.language), metadata = { version: metadataVersion, group };
                            await this._ctStore.import(scope, { units: prepared.units, assets: prepared.assets, manifest: prepared.manifest, metadata },{guard:()=>key===this.managedCatalogScope && !this._ctAbort.signal.aborted,onProgress:progress=>this.ctReport({...progress,workbook:prepared.language})});
                        }
                        this.ctUploadVisible = false; await this.ctRefreshLocal(); return;
                    }
                    let version = this.ctUploadVersion;
                    this._ctReleaseRequest ||= uuid();if(!version)this._ctReleaseCommand ||= {game:this.gameVersion,branchId:this.branchId,name:this.ctUploadName.trim(),deadlineAt:root.ManagedVersions.parseDeadline(this.ctUploadDeadline),idempotencyKey:this._ctReleaseRequest};await this.ctRememberPublication();
                    if (!version) {
                        this._ctReleaseRequest ||= uuid();
                        const result = await client.request('/v1/content-versions', { method: 'POST', body: this._ctReleaseCommand,signal:this._ctAbort.signal }); version = result.version;
                        if(key!==this.managedCatalogScope || this._ctAbort.signal.aborted)return;
                        this.ctUploadVersion = version; this._ctReleaseRequest = null;
                        await this.ctRememberPublication();
                    }
                    for (const prepared of this.ctPrepared) {
                        if(key!==this.managedCatalogScope || this._ctAbort.signal.aborted)return;
                        if (prepared.published) continue;
                        prepared.requestId ||= uuid();
                        prepared.createBody ||= { versionId: version.id,game:this.gameVersion,branchId:this.branchId, contentMode: prepared.contentMode, language: prepared.language, assignments: prepared.assignments, roles: prepared.contentMode==='statdescription'?['source']:prepared.candidates.map(item => item.role),parentGroupId:prepared.parentGroupId, expectedMembershipRevision: version.membershipRevision || 0, idempotencyKey: prepared.requestId };
                        await this.ctRememberPublication();
                        const response = await this._cloud.request('/v1/content-uploads', { method: 'POST', body: prepared.createBody,signal:this._ctAbort.signal });
                        const upload = response.upload; prepared.uploadId = upload.id;
                        await this.ctRememberPublication();
                        if(upload.status==='accepted'){
                            prepared.published=true;version=(await this._cloud.request('/v1/content-groups/'+encodeURIComponent(upload.groupId))).group.version;this.ctUploadVersion=version;await this.ctRememberPublication();continue;
                        }
                        for (const candidate of prepared.candidates) {
                            if(key!==this.managedCatalogScope || this._ctAbort.signal.aborted)return;
                            this.ctReport({ phase: 'Uploading original', workbook: candidate.file.name, sheet: '', completed: 0, total: candidate.file.size });
                            await this._cloud.request('/v1/content-uploads/' + encodeURIComponent(upload.id) + '/assets/' + encodeURIComponent(prepared.contentMode === 'statdescription' ? 'source' : candidate.role) + '?filename='+encodeURIComponent(candidate.file.name), { method: 'PUT', rawBody: candidate.file,signal:this._ctAbort.signal, timeout: 180000, onUploadProgress: (completed, total) => this.ctReport({ completed, total }) });
                        }
                        if (prepared.contentMode === 'clienttext') for (const descriptor of prepared.manifest.descriptors) {
                            const units = prepared.manifest.units.filter(unit => unit.role === descriptor.role);
                            for (let start = 0, index = 0; start < units.length; index++) {
                                let end=start,bytes=0;while(end<units.length && end-start<2000){const size=new TextEncoder().encode(JSON.stringify(units[end])).length+1;if(bytes+size>1800000 && end>start)break;bytes+=size;end++;}
                                this.ctReport({ phase: 'Uploading compact manifest', workbook: descriptor.role, completed: start, total: units.length });
                                await this._cloud.request('/v1/content-uploads/' + encodeURIComponent(upload.id) + '/manifests/' + encodeURIComponent(descriptor.role) + '/chunks', { method: 'POST', body: { index, units: units.slice(start, end) },compressJson:this.ctPolicy.uploadEncodings?.includes('gzip'),signal:this._ctAbort.signal,timeout:180000 });start=end;
                                if (key !== this.managedCatalogScope || this._ctAbort.signal.aborted) return;
                            }
                        }
                        for(let start=0,index=0;start<(prepared.carry?.length||0);index++){
                            let end=start,bytes=0;while(end<prepared.carry.length && end-start<2000){const size=new TextEncoder().encode(JSON.stringify(prepared.carry[end])).length+1;if(bytes+size>1800000 && end>start)break;bytes+=size;end++;}
                            this.ctReport({phase:'Uploading carry-forward work',workbook:prepared.language,completed:start,total:prepared.carry.length,sheet:''});
                            await this._cloud.request('/v1/content-uploads/'+encodeURIComponent(upload.id)+'/carry/chunks',{method:'POST',body:{index,units:prepared.carry.slice(start,end)},compressJson:this.ctPolicy.uploadEncodings?.includes('gzip'),signal:this._ctAbort.signal,timeout:180000});start=end;
                            if(key!==this.managedCatalogScope || this._ctAbort.signal.aborted)return;
                        }
                        const decisions=[];for(const duplicate of prepared.duplicateGroups || []){const choice=this.ctDuplicateChoices[duplicate.filepath+'|'+(duplicate.language || duplicate.lang)],option=duplicate.options.find(option=>String(option.occurrence)===String(choice));if(!option)throw new Error('Choose one block for '+duplicate.filepath+' · '+(duplicate.language || duplicate.lang));decisions.push({filepath:duplicate.filepath,language:duplicate.language || duplicate.lang,occurrence:option.occurrence,blockHash:option.blockHash || await root.CollaborationProtocol.blockHash(option)});}
                        prepared.finalizeBody ||= { descriptors: prepared.manifest?.descriptors,decisions, expectedMembershipRevision: version.membershipRevision || 0, idempotencyKey: prepared.requestId };
                        await this.ctRememberPublication();
                        let result;
                        try{result=await this._cloud.request('/v1/content-uploads/' + encodeURIComponent(upload.id) + '/finalize', { method: 'POST', body: prepared.finalizeBody,signal:this._ctAbort.signal, timeout: 180000 });}
                        catch(error){if(error.code==='VERSION_MEMBERSHIP_CHANGED' && key===this.managedCatalogScope){const details=await this._cloud.request('/v1/versions/'+encodeURIComponent(version.id),{signal:this._ctAbort.signal});if(key!==this.managedCatalogScope)return;this.ctUploadVersion=details.version;prepared.finalizeBody.expectedMembershipRevision=details.version.membershipRevision;await this.ctRememberPublication();throw new Error('Another complete group was added to this version. Its membership is refreshed; retry publication to add your prepared group.');}throw error;}
                        if(key!==this.managedCatalogScope || this._ctAbort.signal.aborted)return;
                        prepared.published = true; version = result.version || { ...version, membershipRevision: (version.membershipRevision || 0) + 1 }; this.ctUploadVersion = version;
                        const group = result.group || result.contentGroup;
                        if (prepared.contentMode === 'clienttext' && group) await this._ctStore.import(this.ctScope(version.id, group.id, prepared.language), { units: prepared.units, assets: prepared.assets, manifest: prepared.manifest, metadata: { version, group } },{guard:()=>key===this.managedCatalogScope,onProgress:progress=>this.ctReport({...progress,workbook:prepared.language})});
                        await this.ctRememberPublication();
                        if (key !== this.managedCatalogScope || this._ctAbort.signal.aborted) return;
                    }
                    await this._ctStore.deleteRequest(this.ctRequestScope(),this._ctPublicationRequest);this._ctPublicationRequest=null;
                    this.ctUploadVisible = false; this.ctPrepared = raw([]); await this.refreshManagedVersions(); await this.managedReadDetails(version.id);
                } catch (error) { if (key === this.managedCatalogScope && error.name !== 'AbortError') this.ctUploadError = error.message; }
                finally { if (key === this.managedCatalogScope) { this.ctUploading = false; this.ctProgress = null; } }
            }
        }
    };
    const fieldsComponent = { props: {host:Object,side:{type:String,default:'both'}},
        mounted() {
            this.$nextTick(()=>this.host.ctResizeFields(this.$el));
            if(root.ResizeObserver){
                this._ctWidthObserver=new root.ResizeObserver(entries=>{
                    const width=entries[0]?.contentRect.width;
                    if(width===this._ctWidth)return;this._ctWidth=width;this.host.ctResizeFields(this.$el);
                });
                this._ctWidthObserver.observe(this.$el);
            }
        },
        beforeUnmount() {this._ctWidthObserver?.disconnect();},
        updated() {this.$nextTick(()=>this.host.ctResizeFields(this.$el));}, template: `
        <div class="ctFields" :data-side="side === 'both' ? undefined : side" :inert="host.ctBusy" @keydown="host.ctFieldsKeydown($event)">
            <div :class="{inlineFileBlock:side !== 'both',inlineBlockPrelude:side !== 'both'}" :data-inline-block="side !== 'both' ? 'prelude' : undefined" :data-inline-side="side === 'source' ? 'english' : side === 'translation' ? 'translation' : undefined"><div :class="{inlineBlockNatural:side !== 'both'}">
            <template v-if="side !== 'translation'">
                <section v-if="host.ctNotes().length" class="ctDeveloperNotes editBlock"><strong>Developer notes</strong><pre v-for="(note,index) in host.ctNotes()" :key="index">{{ note }}</pre></section>
            </template>
            <template v-if="side !== 'source'"><section v-for="(choice,index) in host.ctChoices" :key="index" class="ctDeveloperNotes editBlock"><strong>Translation choice · {{ host.ctCurrentUnit.fields.find(field=>field.id===choice.fieldId)?.name }}</strong><p>Incoming translation remains active. Choose the text to keep.</p><pre>{{ choice.upstream ?? choice.remote }}</pre><button @click="host.ctChooseAlternative(choice,'remote')">Keep incoming</button><pre>{{ choice.local }}</pre><button @click="host.ctChooseAlternative(choice,'local')">Use previous saved text</button></section></template>
            </div></div>
            <section v-for="group in host.ctFieldGroups" :key="group.key" class="ctBlock editBlock" :class="{inlineFileBlock:side !== 'both',ctFormBlock:group.forms}" :data-field-group="group.key" :data-inline-block="side !== 'both' ? 'field:'+group.key : undefined" :data-inline-side="side === 'source' ? 'english' : side === 'translation' ? 'translation' : undefined"><div :class="{inlineBlockNatural:side !== 'both'}">
                <h3 v-if="side === 'both'">{{ group.name }}</h3>
                <div class="ctFieldPair" :class="{ctFullFieldPair:side === 'both'}">
                <div v-if="side !== 'translation'" class="editorSourceField ctFieldSource">
                    <template v-if="group.fields.some(field=>field.kind !== 'gender' || field.source)">
                    <div v-for="source in host.ctGroupSources(group)" :key="source.key" class="ctSourceBlock inputField">
                        <label v-if="side === 'both' || host.ctGroupSources(group).length > 1" class="ctSourceLabel"><template v-if="side === 'both'">English<span v-if="host.ctGroupSources(group).length > 1"> · </span></template><span v-if="host.ctGroupSources(group).length > 1">{{ source.label }}</span></label>
                        <div class="textHL editorTextField multiline"><textarea :value="source.text" :data-ct-source="source.key" @focus="host.ctFocusedField=source.key" readonly tabindex="-1" :aria-label="source.label+' English'" placeholder="English" lang="en" spellcheck="false" rows="1"></textarea></div>
                    </div>
                    </template>
                </div>
                <div v-if="side !== 'source'" class="ctFieldTranslation">
                <table v-if="group.forms" class="ctFormGrid"><thead><tr><th>Form</th><th>Singular</th><th v-if="group.fields.some(field => ['MP','FP','NP'].includes(field.form))">Plural</th></tr></thead><tbody>
                    <tr v-for="row in ['M','F','N'].filter(row => group.fields.some(field => field.form.startsWith(row)))" :key="row"><th>{{ row }}</th>
                    <td v-for="number in (group.fields.some(field => ['MP','FP','NP'].includes(field.form)) ? ['S','P'] : ['S'])" :key="number">
                        <template v-if="host.ctForm(group,row+number)"><ct-target :host="host" :field="host.ctForm(group,row+number)" :compact="side !== 'both'"></ct-target></template><span v-else class="versionMuted">Unavailable</span>
                    </td></tr></tbody></table>
                <template v-else><ct-target v-for="field in group.fields" :key="field.id" :host="host" :field="field" :compact="side !== 'both'"></ct-target></template>
                </div>
                </div>
                </div>
            </section>
        </div>` };
    const targetComponent = { props: {host:Object,field:Object,compact:Boolean},
        data() {return {genderMultilineLatched:false};},
        computed: {
            genderMultilineRequired() {return this.field.kind==='gender' && this.host.ctGenderMultiline(this.field);},
            genderMultiline() {return this.genderMultilineRequired || this.genderMultilineLatched;},
        },
        watch: {
            field: {flush:'sync',handler() {this.genderMultilineLatched=this.genderMultilineRequired;}},
            genderMultilineRequired: {immediate:true,flush:'sync',handler(value) {if(value)this.genderMultilineLatched=true;}},
        }, template: `
        <div class="ctTarget" :class="{missing:host.ctFieldStatus(field).missing,outdated:host.ctFieldStatus(field).outdated}">
            <label :for="'ctfield-'+field.targetCell" :class="{srOnly:field.kind === 'form' || (field.kind === 'gender' ? !compact : compact)}">{{ field.kind === 'gender' ? 'Gender' : field.kind === 'form' ? field.name+' '+field.form : (host.ctWorkspace?.scope.language || host.lang)+' translation' }} <small>{{ field.required ? '' : 'Optional' }}</small></label>
            <template v-if="field.kind === 'gender'">
                <div v-if="genderMultiline" class="textHL editorTextField multiline"><textarea :id="'ctfield-'+field.targetCell" :data-ct-target="field.id" :value="host.ctValues[field.id]" @focus="host.ctFocusedField=field.id" @input="host.ctGenderEdited(field,$event)" @compositionend="host.ctGenderEdited(field,$event)" @paste="host.ctGenderPaste(field,$event)" @keydown="host.ctGenderKeydown(field,$event)" aria-label="Gender" spellcheck="false" rows="1"></textarea></div>
                <template v-else><input type="text" :id="'ctfield-'+field.targetCell" :data-ct-target="field.id" :list="'ctgender-'+field.targetCell" :value="host.ctValues[field.id]" @focus="host.ctFocusedField=field.id" @input="host.ctGenderEdited(field,$event)" @compositionend="host.ctGenderEdited(field,$event)" @paste="host.ctGenderPaste(field,$event)" @keydown="host.ctGenderKeydown(field,$event)" aria-label="Gender" placeholder="Blank" spellcheck="false" autocomplete="off"><datalist :id="'ctgender-'+field.targetCell"><option v-for="gender in host.ctGenderSuggestions(field)" :key="gender" :value="gender" :label="host.ctGenderSuggestionLabel(gender,field)"></option></datalist></template>
            </template>
            <div v-else class="textHL editorTextField multiline"><textarea :id="'ctfield-'+field.targetCell" :data-ct-target="field.id" v-model="host.ctValues[field.id]" @focus="host.ctFocusedField=field.id;host.ctCompletionSelectionChanged(field,$event)" @blur="host.ctCloseCompletion()" @select="host.ctCompletionSelectionChanged(field,$event)" @click="host.ctCompletionSelectionChanged(field,$event)" @keyup="host.ctCompletionSelectionChanged(field,$event)" @input="host.ctResizeField($event.target);host.ctEdited(field);host.ctSuggest(field,$event)" @keydown="host.ctTargetKeydown(field,$event)" :aria-expanded="host.ctCompletion?.fieldId===field.id" :aria-controls="host.ctCompletion?.fieldId===field.id ? 'ct-completion-'+field.targetCell : undefined" :aria-activedescendant="host.ctCompletion?.fieldId===field.id ? 'ct-completion-'+field.targetCell+'-'+host.ctCompletion.selectedIndex : undefined" :aria-label="field.name + (field.form ? ' '+field.form : '')" :lang="host.translationEditorBcp47 || undefined" :placeholder="field.kind === 'form' && !field.required ? 'Optional translation' : 'Translation'" spellcheck="false" rows="1"></textarea></div>
            <div v-if="host.ctCompletion?.fieldId===field.id" :id="'ct-completion-'+field.targetCell" class="ctCompletion" role="listbox" aria-label="Source and Dictionary completions"><button v-for="(item,index) in host.ctCompletion.items" :key="item.value" :id="'ct-completion-'+field.targetCell+'-'+index" type="button" role="option" tabindex="-1" :class="{selected:host.ctCompletion.selectedIndex===index}" :aria-selected="host.ctCompletion.selectedIndex===index" @mousedown.prevent @click="host.ctApplyCompletion(field,item)">{{ item.label }}</button></div>
            <div v-if="host.ctFieldStatus(field).missing || host.ctFieldStatus(field).outdated" class="ctFieldFacts fieldMeta"><span v-if="host.ctFieldStatus(field).missing">Missing</span><span v-if="host.ctFieldStatus(field).outdated">Outdated</span><span v-if="host.ctReviewed[field.id] === host.ctReviewHash(field) && host.ctFieldStatus(field).outdated">Reviewed in this draft</span><button v-if="host.ctFieldStatus(field).outdated && host.ctReviewed[field.id] !== host.ctReviewHash(field)" @click="host.ctMarkReviewed(field)">Mark reviewed</button></div>
            <p v-for="(issue,index) in (host.ctDiagnostics[host.ctSelection] || []).filter(item=>item.fieldId === field.id)" :key="index" :class="'ctDiagnostic '+issue.severity">{{ issue.message }}</p>
        </div>` };
    const toolsComponent = { props: ['host'], components:{'editor-dictionary-entries':root.EditorComponents?.DictionaryEntries}, template: `
        <aside class="side sharedEditorSidebar ctTools" :class="{commentsActive:host.ctTool === 'comments',lookupActive:host.ctTool === 'lookup'}" aria-label="File tools">
            <div class="sideHeader"><div class="sideTabs" aria-label="Editor tools">
                <button v-if="!host.ctEditor" type="button" class="tabBtn" :class="{active:host.ctTool === 'preview'}" :aria-pressed="host.ctTool === 'preview'" aria-label="Preview" @click="host.ctTool='preview'">Preview</button>
                <button type="button" class="tabBtn" :class="{active:host.ctTool === 'dictionary'}" :aria-pressed="host.ctTool === 'dictionary'" aria-label="Dictionary" @click="host.ctTool='dictionary'">📚 Dictionary</button>
                <button type="button" class="tabBtn lookupTab" :class="{active:host.ctTool === 'lookup'}" :aria-pressed="host.ctTool === 'lookup'" aria-label="Lookup" title="Lookup" @click="host.ctTool='lookup'">Lookup</button>
                <button type="button" class="tabBtn" :class="{active:host.ctTool === 'tm'}" :aria-pressed="host.ctTool === 'tm'" aria-label="TM" title="Translation memory" @click="host.ctTool='tm'">TM</button>
                <button type="button" class="tabBtn" :class="{active:host.ctTool === 'history'}" :aria-pressed="host.ctTool === 'history'" aria-label="History" title="History" @click="host.ctTool='history'">🕒 History</button>
                <button type="button" class="tabBtn commentsTab" :class="{active:host.ctTool === 'comments'}" :aria-pressed="host.ctTool === 'comments'" aria-label="Comments" title="Comments" @click="host.ctTool='comments'">Comments</button>
            </div>
            <div v-if="host.ctTool === 'dictionary'" class="dictionaryControls sideControls">
                <div class="sideSearchRow"><input class="sideFilter" type="search" v-model="host.ctDictionaryFilter" placeholder="Search dictionary…" aria-label="Search dictionary entries" @keydown.esc="host.ctDictionaryFilter=''" :disabled="!host.ctDictionaryReady"><button type="button" @click="host.ctDictionaryAdd()" title="Add a Dictionary entry" :disabled="!host.ctDictionaryReady">Add entry</button></div>
                <div class="dictionaryPagination sidePagination" aria-label="Dictionary pages"><span>{{ host.ctDictionaryRangeLabel }}<template v-if="host.ctCurrentUnit"> · Matches in this file first</template></span><button type="button" @click="host.ctSetDictionaryPage(host.ctDictionaryPage-1)" :disabled="!host.ctDictionaryReady || host.ctDictionaryPage<=1" aria-label="Previous dictionary page">Previous</button><button type="button" @click="host.ctSetDictionaryPage(host.ctDictionaryPage+1)" :disabled="!host.ctDictionaryReady || host.ctDictionaryPage>=host.ctDictionaryPageCount" aria-label="Next dictionary page">Next</button></div>
            </div></div>
            <div v-show="!host.ctEditor && host.ctTool === 'preview'" id="ctInlineEditorPreviewHost" class="inlinePreviewHost"></div>
            <section v-if="host.ctTool === 'tm'" class="tmResultsPanel"><h3>Translation memory</h3><p class="tmEmpty">Accepted text from this language, matched by field kind and grammatical form.</p><div class="tmResultList"><article v-for="match in host.ctMemoryResults" :key="match.id" class="tmMatchDetail" @dblclick.prevent="host.ctApplyMemory(match)" title="Double-click to use translation"><strong>{{ match.kind }} · {{ Math.min(100,match.score) }}%</strong><pre class="tmSourceSnippet">{{ match.source }}</pre><pre class="tmTargetSnippet">{{ match.target }}</pre><button @click="host.ctApplyMemory(match)" @dblclick.stop :disabled="host.ctBusy">Use translation</button><p v-for="(warning,index) in match.warnings" :key="index">{{ warning.message }}</p></article></div><p v-if="!host.ctMemoryResults.length" class="tmEmpty">No memory matches.</p></section>
            <section v-if="host.ctTool === 'lookup'" class="editorLookupPanel"><div class="lookupControls sideControls"><h3>Lookup</h3><div class="sideSearchRow"><input class="sideFilter" v-model="host.ctLookup" placeholder="Exact text lookup" aria-label="Lookup text"></div></div><div class="lookupResults"><article v-for="(match,index) in host.ctLookupResults" :key="index" class="editBlock"><button @click="host.ctSelect(host._ctUnitIndex.get(match.unitId),host.ctEditor)">{{ match.sheet }} · {{ match.recordId }} · {{ match.name }} {{ match.form }}</button><pre>{{ match.source }}</pre><pre>{{ match.target }}</pre></article><p v-if="!host.ctLookupResults.length" class="tmEmpty">No matches.</p></div></section>
            <template v-if="host.ctTool === 'dictionary'"><editor-dictionary-entries :controller="host.ctDictionaryController"></editor-dictionary-entries><p v-if="!host.ctDictionaryFiltered.length" class="tmEmpty">{{ host.ctDictionaryFilter ? 'No Dictionary entries match your search.' : 'No Dictionary entries. Add an entry to get started.' }}</p></template>
            <section v-if="host.ctTool === 'history'" class="ctHistoryPanel historyPanel"><h3>History</h3>
                <p>Local and shared saved changes for this group and language.</p>
                <button @click="host.ctOpenHistoryViewer()">Compare original and current</button>
                <button v-if="host.ctHistoryPreviousProvenance" class="ctHistoryPrevious" @click="host.ctLoadPreviousHistory()" :disabled="host.ctBusy || host.ctHistoryPreviousLoading">{{ host.ctHistoryPreviousLoading ? 'Preparing previous version…' : 'Compare previous version' }}</button>
                <p v-if="host.ctHistoryError" class="ctHistoryError" role="alert">{{ host.ctHistoryError }}</p>
                <article v-for="entry in host.ctHistory" :key="entry.key" class="ctHistoryEvent" :data-history-origin="entry.origin">
                    <p>{{ host.ctHistoryLabel(entry) }}</p><small>{{ entry.action }}</small>
                    <div class="ctHistoryActions"><button @click="host.ctPickHistory(entry)">Compare change</button><button @click="host.ctPickHistory(entry,'current')">Compare with current</button>
                    <button @click="host.ctRestoreHistory(entry,'before')" :disabled="host.ctBusy || !entry.before.available">Restore before as draft</button><button @click="host.ctRestoreHistory(entry,'after')" :disabled="host.ctBusy || !entry.after.available">Restore after as draft</button></div>
                </article>
                <p v-if="host.ctHistoryLoading" role="status">Loading history…</p><p v-else-if="!host.ctHistory.length">No saved history for this ID.</p>
                <button v-if="host.ctHistoryCursor || host.ctHistoryLocalMore" class="ctHistoryOlder" @click="host.ctLoadOlderHistory()" :disabled="host.ctHistoryLoading">Load older history</button>
                <div v-if="host.ctHistoryViewer" class="ctHistoryBackdrop" @keydown.esc.stop.prevent="host.ctCloseHistoryViewer()" @keydown.tab="host.ctTrapHistoryFocus($event)">
                    <section class="ctHistoryViewer" role="dialog" aria-modal="true" aria-labelledby="ctHistoryTitle">
                        <header><h3 id="ctHistoryTitle">Compare · {{ host.ctCurrentUnit.sheet }} · {{ host.ctCurrentUnit.recordId }}</h3><button id="ctHistoryClose" @click="host.ctCloseHistoryViewer()" aria-label="Close history comparison">Close</button></header>
                        <div class="ctHistoryCompareControls"><label>Before<select v-model="host.ctHistoryCompareA"><option v-for="choice in host.ctHistoryChoices" :key="choice.key" :value="choice.key" :disabled="choice.unavailable">{{ choice.label }}</option></select></label>
                        <label>After<select v-model="host.ctHistoryCompareB"><option v-for="choice in host.ctHistoryChoices" :key="choice.key" :value="choice.key" :disabled="choice.unavailable">{{ choice.label }}</option></select></label><label><input type="checkbox" v-model="host.ctHistoryWhitespace"> Show whitespace</label><label><input type="checkbox" v-model="host.ctHistoryCharacters"> Character differences</label></div>
                        <p class="ctHistoryContext">English, field layout and Developer notes come from verified originals. This group's history uses its immutable original; Compare previous version explicitly loads the earlier original and accepted revision. Unavailable saved revisions are labelled. This comparison is read only; restoring creates a draft.</p>
                        <p v-if="host.ctHistoryError" class="ctHistoryError" role="alert">{{ host.ctHistoryError }}</p>
                        <div v-if="host.ctHistoryComparison" class="ctHistoryComparison">
                            <article v-for="row in host.ctHistoryComparison.rows" :key="row.id" class="ctHistoryDiffField" :data-field-id="row.id" :data-field-kind="row.kind" :data-form="row.form">
                                <h4>{{ host.ctHistoryFieldLabel(row) }}</h4><p v-if="row.added || row.removed">{{ row.added ? 'Added field' : 'Removed field' }}</p>
                                <div class="ctHistoryColumns"><section v-for="side in ['before','after']" :key="side" :class="'ctHistory-'+side"><h5>{{ side === 'before' ? 'Before' : 'After' }}</h5>
                                    <label>English source</label><pre class="ctHistorySource"><span v-for="(part,index) in row.sourceParts.filter(part=>side === 'before' ? !part.added : !part.removed)" :key="index" :class="{diffInlineAdd:part.added,diffInlineDel:part.removed}">{{ host.ctHistoryDisplay(part.value) }}</span></pre>
                                    <label>{{ row.kind === 'gender' ? 'Gender metadata' : 'Translation · '+host.ctWorkspace.scope.language }}</label><pre class="ctHistoryTarget"><span v-for="(part,index) in row.targetParts.filter(part=>side === 'before' ? !part.added : !part.removed)" :key="index" :class="{diffInlineAdd:part.added,diffInlineDel:part.removed}">{{ host.ctHistoryDisplay(part.value) }}</span></pre>
                                </section></div>
                            </article>
                            <article v-if="host.ctHistoryComparison.hasNotes" class="ctHistoryNotes"><h4>Developer notes</h4><div class="ctHistoryColumns"><section v-for="side in ['before','after']" :key="side"><h5>{{ side === 'before' ? 'Before' : 'After' }}</h5><pre><span v-for="(part,index) in host.ctHistoryComparison.notes.filter(part=>side === 'before' ? !part.added : !part.removed)" :key="index" :class="{diffInlineAdd:part.added,diffInlineDel:part.removed}">{{ host.ctHistoryDisplay(part.value) }}</span></pre></section></div></article>
                        </div>
                    </section>
                </div>
            </section>
            <section v-if="host.ctTool === 'comments'" class="commentsPanel"><h3 class="commentsPanelHeader">Comments</h3><div class="commentsList"><article v-for="comment in host.ctComments" :key="comment.id" class="commentCard"><strong>{{ comment.actor?.name || comment.authorName || comment.actor?.id || comment.authorId }}</strong><small>{{ comment.audience }}</small><pre class="commentBody">{{ comment.text }}</pre></article></div><textarea v-model="host.ctCommentText" @input="host.ctQueueCommentDraft()" aria-label="Comment" placeholder="Write a comment" rows="3"></textarea><label class="commentsScopeOption"><input type="checkbox" v-model="host.ctCommentGlobal" @change="host.ctQueueCommentDraft()"> All language teams</label><button @click="host.ctPostComment" :disabled="!host.managedOnlineAvailable || host.ctBusy || !host.ctCommentText.trim()">Post comment</button></section>
        </aside>` };
    return { mixin, teams, detect, groupFields, mode, fieldsComponent, targetComponent, toolsComponent };
});

