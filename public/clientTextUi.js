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
    function detect(filename) {
        const name = String(filename), language = teams.find(team => name.toLowerCase().startsWith(team.replace(/ /g, '_').toLowerCase() + '_')) || '';
        return { language, role: /(?:^|_)Gender(?:_|\.)/i.test(name) ? 'gender' : 'normal' };
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
            ctSheet: '', ctSearch: '', ctAppliedSearch: '', ctFilter: '', ctPage: 1, ctPageSize: 40,
            ctSelection: '', ctEditor: false, ctValues: {}, ctReviewed: {}, ctDraftDirty: false, ctCompletion: null,
            ctBusy: false, ctProgress: null, ctError: '', ctNotice: '', ctDiagnostics: raw({}), ctScanDone: false,
            ctHistory: [], ctHistoryLoading: false, ctHistoryPreviousLoading: false, ctHistoryError: '', ctHistoryCursor: null, ctHistoryLocalMore: false,
            ctHistoryCompareA: 'original', ctHistoryCompareB: 'current', ctHistoryWhitespace: false, ctHistoryCharacters: true, ctHistoryViewer: false,
            ctTool: 'lookup', ctLookup: '', ctFocusedField: '', ctMemory: raw([]), ctComments: [], ctCommentText: '', ctCommentGlobal: false, ctChoices: [],
            ctPeers: [], ctLocalWorkspaces: [], ctRequests: [], ctUploadVisible: false, ctUploadLocal: false,
            ctUploadVersion: null, ctUploadName: '', ctUploadDeadline: '', ctUploadFiles: raw([]), ctPrepared: raw([]),
            ctUploadAssignments: teams.slice(), ctPolicy: null, ctPolicyText: '', ctUploadError: '', ctUploading: false, ctDuplicateChoices: {},
            sdDirectory: '', activeContentGroup: null, ctTeamOptions: teams
        }; },
        computed: {
            ctGroups() { return this.managedSelectedDetails?.contentGroups || this.managedSelectedVersion?.contentGroups || []; },
            ctCurrentUnit() { return this._ctUnitIndex?.get(this.ctSelection) || null; },
            ctFieldGroups() { return groupFields(this.ctCurrentUnit); },
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
            ctRows() {
                this.ctRevision;
                const query = this.ctAppliedSearch.toLocaleLowerCase();
                return this.ctUnits.filter(unit => {
                    if (this.ctSheet && JSON.stringify([unit.role, unit.sheet]) !== this.ctSheet) return false;
                    const status = this.ctStatus(unit);
                    if (this.ctFilter === 'error' || this.ctFilter === 'warning') {
                        if (!(this.ctDiagnostics[unit.id] || []).some(item => item.severity === this.ctFilter)) return false;
                    } else if (this.ctFilter && !status[this.ctFilter]) return false;
                    if (!query) return true;
                    const values = root.ClientTextState.valuesFor(unit, this.ctSaved[unit.id]);
                    return [unit.recordId, unit.sheet, ...unit.fields.flatMap(field => [field.source, values[field.id]]), ...this.ctNotes(unit)].some(text => String(text).toLocaleLowerCase().includes(query));
                });
            },
            ctPageRows() { return this.ctRows.slice((this.ctPage - 1) * this.ctPageSize, this.ctPage * this.ctPageSize); },
            ctPageCount() { return Math.max(1, Math.ceil(this.ctRows.length / this.ctPageSize)); },
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
                const current = this.ctCurrentUnit, query = (this.ctLookup || current?.fields.find(field => field.kind !== 'gender')?.source || '').toLocaleLowerCase();
                if (!query) return [];
                const output = [];
                const focused=current?.fields.find(field=>field.id===this.ctFocusedField) || current?.fields.find(field=>field.kind!=='gender');
                const kinds = new Set(focused ? [JSON.stringify([focused.kind,focused.form || null])] : []);
                for (const unit of this.ctUnits) {
                    if (unit.id === current?.id) continue;
                    const values = root.ClientTextState.valuesFor(unit, this.ctSaved[unit.id]);
                    for (const field of unit.fields) {
                        const target = values[field.id];
                        if (field.kind === 'gender' || !target?.trim() || target.trim() === 'NONEXISTENT' || !kinds.has(JSON.stringify([field.kind, field.form || null]))) continue;
                        if (field.source.toLocaleLowerCase().includes(query)) output.push({ unitId: unit.id, sheet: unit.sheet, recordId: unit.recordId, name: field.name, form: field.form, source: field.source, target });
                        if (output.length >= 40) return output;
                    }
                }
                return output;
            },
            ctMemoryResults() {const unit=this.ctCurrentUnit,field=unit?.fields.find(field=>field.id===this.ctFocusedField) || unit?.fields.find(field=>field.kind!=='gender');return field ? root.ContentAdapters.clienttext.findMemory(this.ctMemory,unit,field,{game:this.gameVersion,limit:20}) : [];},
            ctDictionaryMatches() {
                const source = this.ctCurrentUnit?.fields.map(field => field.source).join('\n') || '';
                return (this.dictionary || []).filter(entry => entry.find && source.toLocaleLowerCase().includes(String(entry.find).toLocaleLowerCase())).slice(0, 80);
            },
            sdDirectories() { return [...new Set((this.descs || []).map(desc => String(desc.filepath || '').split('/').slice(0, -1).join('/') || '(root)'))].sort(); },
            activeContentGroups() { return this.managedVersions?.find(version=>version.id===this.ctWorkspace?.scope.versionId)?.contentGroups || this.ctWorkspace?.metadata?.version?.contentGroups || this.managedActiveDetails?.contentGroups || []; }
        },
        watch: {
            ctSearch() { clearTimeout(this._ctSearchTimer); this._ctSearchTimer = setTimeout(() => { this.ctAppliedSearch = this.ctSearch; this.ctPage = 1; }, 180); },
            ctFilter() { this.ctPage = 1; }, ctSheet() { this.ctPage = 1; },
            ctPageCount(value) { this.ctPage = Math.min(this.ctPage, value); },
            sdDirectory() { this.currentPage = 1; this.filterDesc?.(); },
            managedCatalogScope() { this.ctFence(); this.ctRefreshLocal(); },
            lang() { if (this.ctActive && this.ctWorkspace?.scope.language !== this.lang) this.ctFence(); },
            gameVersion() { if (this.ctActive && this.ctWorkspace?.scope.game !== this.gameVersion) this.ctFence(); },
            versionChooserVisible(value) { if (value) this.ctRefreshLocal(); }
        },
        mounted() { this._ctStore = root.ClientTextStore.create(); this._ctWorker = root.ClientTextWorkerClient.create(); },
        beforeUnmount() { this.ctFence(); this._ctWorker?.dispose(); clearTimeout(this._ctSearchTimer); },
        methods: {
            ctScope(versionId, groupId, language = this.lang) { return { accountId: this.cloudProfileId || this.cloudUser?.id || 'guest', game: this.gameVersion, branchId: this.branchId || 'default', versionId, groupId, language }; },
            ctContext() { return { key: this.managedCatalogScope, scope: copy(this.ctWorkspace?.scope || {}), epoch: this._ctEpoch || 0 }; },
            ctCurrent(ctx) { return ctx.key === this.managedCatalogScope && ctx.epoch === (this._ctEpoch || 0) && JSON.stringify(ctx.scope) === JSON.stringify(this.ctWorkspace?.scope || {}); },
            ctFence() {
                this.ctFlushDraft().catch(()=>{});
                this.ctFlushCommentDraft().catch(()=>{});
                this._ctEpoch = (this._ctEpoch || 0) + 1; this._ctAbort?.abort(); clearInterval(this._ctSyncTimer); clearTimeout(this._ctDraftTimer);
                this._ctSync?.stop?.(); this._ctSync = null;
                this._ctSaveJob = null; this._ctDraftRevision = null; this._ctEditRevision = 0; this._ctSyncError = '';
                this._ctStatusCache = new WeakMap(); this.ctDraftDirty = false; this.ctBusy = false;
                this._ctConsistencyIndex=null;this._ctConsistencyByUnit=null;this.ctMemory=raw([]);
                this.ctActive = false; this.ctEditor = false; this.ctSelection = ''; this.ctComments = []; this.ctPeers = []; this.ctProgress = null;
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
            ctDiagnose(unit) { const values = this.ctValuesFor(unit); return unit.fields.flatMap(field => root.ClientTextState.diagnose(field, values[field.id]).map(issue => ({ ...issue, severity: issue.level || issue.severity, fieldId: field.id }))); },
            ctTone(unit) { const s = this.ctStatus(unit); return s.missing ? 'missing' : s.outdated ? 'outdated' : s.revised ? 'revised' : s.saved ? 'saved' : ''; },
            ctStatusLabel(unit) { const s = this.ctStatus(unit); return ['Missing', 'Outdated', 'Revised', 'Saved'].filter(label => s[label.toLowerCase()]).join(' · ') || 'Unchanged'; },
            ctForm(group, form) { return group.fields.find(field => field.form === form); },
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
                    this._ctSheets = raw([...new Set(units.map(unit=>JSON.stringify([unit.role,unit.sheet])))].map(key=>({key,role:JSON.parse(key)[0],name:JSON.parse(key)[1]})));
                    this._ctWorkUnits=raw(new Map(units.filter(unit=>unit.fields.some(field=>field.originalMissing || field.outdated) || saved[unit.id]?.outdated?.length).map(unit=>[unit.id,unit])));
                    this.ctSheet = units.length ? JSON.stringify([units[0].role, units[0].sheet]) : ''; this.ctPage = 1;
                    this.ctDiagnostics = raw({}); this.ctScanDone = false; this.ctSearch = ''; this.ctAppliedSearch = '';
                    this.ctActive = true; this.lang = scope.language; this.versionChooserVisible = false; this.editorVisible = false;
                    this.ctLoadMemory(ctx);
                    this.activeContentGroup = metadata?.group || { id: scope.groupId, contentMode: 'clienttext' };
                    if (this.managedOnlineAvailable && (this.cloudCanAccessAllLanguages || scope.language===this.cloudUser?.language) && !String(scope.groupId).startsWith('local:')) {
                        const request = (path, options) => this._cloud.request(path, options);
                        this._ctSync = root.ClientTextSync.create({ scope, store: this._ctStore, request, isCurrent: () => this.ctCurrent(ctx) && this.ctActive });
                        this.ctSync(ctx); this._ctSyncTimer = setInterval(() => { if (!root.document.hidden) this.ctSync(ctx); }, 20000);
                    }
                    return true;
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
            async ctSelect(unit, full = false) {
                if (!unit || this.ctBusy) return;
                const ctx = this.ctContext();
                if (!await this.ctFlushDraft()) return;
                if(!this.ctCurrent(ctx))return;
                await this.ctFlushCommentDraft();
                if(!this.ctCurrent(ctx) || this._ctUnitIndex.get(unit.id)!==unit)return;
                this.ctBusy=true;let draft;
                try{draft=await this._ctStore.getDraft(ctx.scope,unit.id);}catch(error){if(this.ctCurrent(ctx))this.ctError=error.message;return;}finally{if(this.ctCurrent(ctx))this.ctBusy=false;}
                if(!this.ctCurrent(ctx))return;
                this.ctSelection = unit.id; this.ctEditor = full; this.ctTool = 'lookup'; this.ctLookup = ''; this.ctCompletion=null;this.ctCommentText='';this.ctCommentGlobal=false;
                this.ctFocusedField=unit.fields.find(field=>field.kind!=='gender')?.id || '';
                this.ctValues = root.ClientTextState.valuesFor(unit, this.ctSaved[unit.id]); this.ctReviewed = { ...(this.ctSaved[unit.id]?.reviewed || {}) }; this.ctDraftDirty = false;
                this.ctChoices = copy(this.ctSaved[unit.id]?.conflicts || []); this._ctEditRevision = this.ctSaved[unit.id]?.revision || 0;
                this._ctDraftRevision = draft?.revision || null;
                if (draft?.values) { this.ctValues = { ...this.ctValues, ...draft.values }; this.ctReviewed = { ...this.ctReviewed, ...draft.reviewed }; this.ctDraftDirty = true; }
                this.ctResetHistory(); this.ctComments = [];
                this.ctLoadHistory(ctx, unit.id); this.ctLoadComments(ctx, unit.id); this.ctPresence(ctx);
                this.ctLoadCommentDraft(ctx,unit.id);
                await this.$nextTick(); const region = this.$refs.ctEditorRegion; (Array.isArray(region) ? region[0]?.$el : region?.$el)?.querySelector('textarea,select')?.focus();
            },
            ctEdited(field) {
                this.ctReviewed[field.id] = this.ctReviewHash(field);
                this.ctDraftDirty = true; this.ctQueueDraft();
            },
            ctMarkReviewed(field) { this.ctReviewed[field.id] = this.ctReviewHash(field); this.ctDraftDirty = true; this.ctQueueDraft(); },
            ctChooseAlternative(choice, side) { const field = this.ctCurrentUnit.fields.find(field=>field.id===choice.fieldId); this.ctValues[choice.fieldId] = side === 'local' ? choice.local : choice.upstream ?? choice.remote; this.ctChoices = this.ctChoices.filter(item=>item!==choice); if(field)this.ctEdited(field); },
            ctCompleteForm(field, event) {
                if(this.ctCompletion?.fieldId===field.id && ['Tab','Enter'].includes(event.key)){event.preventDefault();this.ctApplyCompletion(field,this.ctCompletion.items[0],event.target);return;}
                if(event.key==='Escape'){this.ctCompletion=null;return;}
                if (field.kind !== 'form' || event.key !== 'Tab') return;
                const value = this.ctValues[field.id];
                if (value && 'NONEXISTENT'.startsWith(value.toUpperCase()) && value !== 'NONEXISTENT') { event.preventDefault(); this.ctValues[field.id] = 'NONEXISTENT'; this.ctEdited(field); }
            },
            ctSuggest(field,event) {
                const input=event.target,caret=input.selectionStart,text=this.ctValues[field.id],before=text.slice(0,caret),match=/([\[<{])([^\]\}>\r\n]*)$/.exec(before);
                if(!match){
                    if(field.kind==='form' && before && 'NONEXISTENT'.startsWith(before.toUpperCase()) && caret===text.length){this.ctCompletion={fieldId:field.id,start:0,end:text.length,items:root.ClientTextState.suggestions(field).filter(item=>item.replaceWholeField)};return;}
                    this.ctCompletion=null;return;
                }
                const items=root.ClientTextState.suggestions(field,{openedByChar:match[1]}).filter(item=>item.value.toLocaleLowerCase().startsWith(match[0].toLocaleLowerCase())).slice(0,15);
                this.ctCompletion=items.length?{fieldId:field.id,start:caret-match[0].length,end:caret,items}:null;
            },
            ctApplyCompletion(field,item,input) {
                const completion=this.ctCompletion;if(!completion || !item)return;
                this.ctValues[field.id]=this.ctValues[field.id].slice(0,completion.start)+item.value+this.ctValues[field.id].slice(completion.end);this.ctCompletion=null;this.ctEdited(field);
                this.$nextTick(()=>{const target=input || document.getElementById('ctfield-'+field.targetCell);target?.focus();target?.setSelectionRange(completion.start+item.value.length,completion.start+item.value.length);});
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
                    if (close && sameEditor) { this.ctEditor = false; this.ctSelection = ''; }
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
                const rows = this.ctRows, index = rows.findIndex(unit => unit.id === this.ctSelection), target = rows[index + offset];
                if (!target) return; if (this.ctDraftDirty && !await this.ctSave()) return;
                this.ctPage = Math.floor((index + offset) / this.ctPageSize) + 1; await this.ctSelect(target, this.ctEditor);
            },
            async ctKey(event) {
                if(event.isComposing || event.defaultPrevented || this.showSetting || this.ctUploadVisible || this.versionChooserVisible)return;
                if(this.ctHistoryViewer){
                    if(event.key==='Escape'){event.preventDefault();this.ctCloseHistoryViewer();}
                    else if(event.key==='F2' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase()==='s'))event.preventDefault();
                    return;
                }
                if(event.ctrlKey && event.code===(this.filterShortcutCtrlD?'KeyD':'KeyF')){event.preventDefault();this.$refs.ctSearchInput?.focus();return;}
                if (event.key === 'F2' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's')) { event.preventDefault(); await this.ctSave(event.key === 'F2' && !this.ctEditor); }
                else if (event.ctrlKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); await this.ctNavigate(event.key === 'ArrowUp' ? -1 : 1); }
                else if (event.key === 'Escape' && this.ctEditor) { event.preventDefault(); if (await this.ctFlushDraft()) this.ctEditor = false; }
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
            ctApplyMemory(match) {const field=this.ctCurrentUnit?.fields.find(field=>field.id===this.ctFocusedField) || this.ctCurrentUnit?.fields.find(field=>field.kind!=='gender');if(!field || this.ctBusy)return;this.ctValues[field.id]=match.target;this.ctEdited(field);},
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
                else this.ctPolicy = { clientTextRoles: { default: ['normal'], French: ['normal', 'gender'] } };
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
                            if (this.gameVersion === 'poe2' && !/_PoE2\./i.test(candidate.file.name) || this.gameVersion === 'poe1' && /_PoE2\./i.test(candidate.file.name)) throw new Error('The workbook filename does not match the selected game: ' + candidate.file.name);
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
                await this._ctStore.putRequest(this.ctRequestScope(),this._ctPublicationRequest,{kind:'publication',name:this.ctUploadName,deadline:this.ctUploadDeadline,version:this.ctUploadVersion ? copy(this.ctUploadVersion) : null,releaseRequest:this._ctReleaseRequest,releaseCommand:this._ctReleaseCommand,duplicateChoices:copy(this.ctDuplicateChoices),groups});
            },
            async ctResumePublication(request) {
                const key=this.managedCatalogScope,payload=(root.Vue?.toRaw ? root.Vue.toRaw(request) : request).payload;await this.ctOpenUpload(payload.version || null,false);if(key!==this.managedCatalogScope)return;this.ctUploadName=payload.name;this.ctUploadDeadline=payload.deadline;this._ctPublicationRequest=request.requestId;this._ctReleaseRequest=payload.releaseRequest || (payload.kind==='metadata'?request.requestId:null);this._ctReleaseCommand=payload.releaseCommand || payload.command || null;
                this.ctDuplicateChoices=payload.duplicateChoices || {};const prepared=[];
                for(const group of payload.groups || []){
                    if(group.cacheScope){
                        const units=await this._ctStore.getUnits(group.cacheScope),metadata=await this._ctStore.getMetadata(group.cacheScope),assets=[];
                        for(const descriptor of metadata.descriptors)assets.push(await this._ctStore.getAsset(group.cacheScope,descriptor.role));
                        const manifest={format:root.ClientTextState.FORMAT,units:units.map(unit=>root.ClientTextState.compactUnit(unit)),descriptors:assets.map(asset=>asset.descriptor),trees:Object.fromEntries(assets.map(asset=>[asset.role,asset.tree]))};
                        prepared.push({...group,units,assets,manifest,candidates:assets.map(asset=>({file:new File([assetBytes(asset)],asset.name),role:asset.role,language:group.language}))});
                    }else prepared.push(group);
                }
                if(key===this.managedCatalogScope)this.ctPrepared=raw(prepared);
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
                const key=this.managedCatalogScope,scope=this.ctScope(previousVersion.id,previousGroup.id,prepared.language);
                let metadata=await this._ctStore.getMetadata(scope);
                if(metadata?.state!=='ready'){
                    const group=(await this._cloud.request('/v1/content-groups/'+encodeURIComponent(previousGroup.id))).group;
                    const units=[],assets=[];
                    for(const asset of group.assets){
                        const blob=await this._cloud.request('/v1/content-groups/'+encodeURIComponent(group.id)+'/assets/'+encodeURIComponent(asset.role)+'/original',{responseType:'blob',timeout:180000});
                        const parsed=await this._ctWorker.parseWorkbook(await blob.arrayBuffer(),{filename:asset.filename,role:asset.role,language:prepared.language,signal:this._ctAbort.signal,onProgress:progress=>this.ctReport({...progress,workbook:'Previous '+asset.filename})});
                        if(parsed.artifactHash!==asset.artifactHash)throw new Error('The previous original hash differs from its accepted manifest.');
                        for(const unit of parsed.units)units.push(unit);assets.push({role:asset.role,blob,name:asset.filename,hash:parsed.artifactHash,parsed:{...parsed,units:undefined}});
                    }
                    const manifest=await this._ctWorker.buildManifest(units,assets,{signal:this._ctAbort.signal,onProgress:progress=>this.ctReport(progress)});
                    for(const asset of group.assets)if(manifest.descriptors.find(item=>item.role===asset.role)?.baselineId!==asset.descriptor.baselineId)throw new Error('The previous workbook parser does not reproduce the accepted manifest.');
                    metadata={version:previousVersion,group};await this._ctStore.import(scope,{units,assets,manifest,metadata},{guard:()=>key===this.managedCatalogScope});
                }
                const previousUnits=new Map((await this._ctStore.getUnits(scope)).map(unit=>[unit.id,unit])),accepted={};let after=0;
                for(const asset of prepared.assets){const previous=await this._ctStore.getAsset(scope,asset.role),before=new Map((previous?.parsed.sheets || []).map(sheet=>[sheet.name,sheet]));for(const sheet of asset.parsed.sheets){const old=before.get(sheet.name);before.delete(sheet.name);if(!old){prepared.warnings.push({message:asset.role+' / '+sheet.name+': added sheet.'});continue;}const oldHeaders=new Map(old.headers.map(header=>[header.name,header.column])),changes=[];for(const header of sheet.headers){const column=oldHeaders.get(header.name);oldHeaders.delete(header.name);if(column===undefined)changes.push('added '+header.name);else if(column!==header.column)changes.push(header.name+' moved from column '+column+' to '+header.column);}for(const heading of oldHeaders.keys())changes.push('removed '+heading);if(changes.length)prepared.warnings.push({message:asset.role+' / '+sheet.name+': '+changes.join('; ')+'. Recognized fields retain their identity.'});}for(const sheet of before.keys())prepared.warnings.push({message:asset.role+' / '+sheet+': removed sheet; previous work remains in history.'});}
                do{
                    const result=await this._cloud.request('/v1/content-groups/'+encodeURIComponent(previousGroup.id)+'/events?language='+encodeURIComponent(prepared.language)+'&after='+after+'&limit=100');
                    for(const event of result.events){accepted[event.unitId]=event.unit;after=event.sequence;}
                    if(!result.hasMore)break;
                    if(key!==this.managedCatalogScope || this._ctAbort.signal.aborted)return;
                }while(true);
                const carry=[];
                for(let index=0;index<prepared.units.length;index++){
                    const next=prepared.units[index],old=previousUnits.get(next.id);if(!old)continue;
                    const before=accepted[next.id],state=root.ClientTextState.carryForward(old,next,before);
                    const markerReview=next.fields.some(field=>{const previous=old.fields.find(item=>item.id===field.id);return previous && previous.source!==field.source && root.ClientTextState.canonicalSource(previous.source)===root.ClientTextState.canonicalSource(field.source) && field.outdated;});
                    if(before || state.outdated.length || markerReview){
                        const previousProof=await this._ctStore.getProof(scope,next.id);
                        carry.push({id:next.id,role:next.role,language:prepared.language,values:state.values,reviewed:state.reviewed,baseline:next,proof:root.ClientTextState.proofFor(prepared.manifest,next.id),previousBaseline:old,previousProof:previousProof.proof,sourceOnly:!before || before.saved===false,provenance:{groupId:previousGroup.id,unitId:next.id,revision:before?.revision||0}});
                    }
                    if(index%256===255){this.ctReport({phase:'Comparing verified source',completed:index,total:prepared.units.length,sheet:next.sheet});await new Promise(resolve=>setTimeout(resolve,0));if(key!==this.managedCatalogScope || this._ctAbort.signal.aborted)return;}
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
                                await this._cloud.request('/v1/content-uploads/' + encodeURIComponent(upload.id) + '/manifests/' + encodeURIComponent(descriptor.role) + '/chunks', { method: 'POST', body: { index, units: units.slice(start, end) },signal:this._ctAbort.signal });start=end;
                                if (key !== this.managedCatalogScope || this._ctAbort.signal.aborted) return;
                            }
                        }
                        for(let start=0,index=0;start<(prepared.carry?.length||0);index++){
                            let end=start,bytes=0;while(end<prepared.carry.length && end-start<2000){const size=new TextEncoder().encode(JSON.stringify(prepared.carry[end])).length+1;if(bytes+size>1800000 && end>start)break;bytes+=size;end++;}
                            await this._cloud.request('/v1/content-uploads/'+encodeURIComponent(upload.id)+'/carry/chunks',{method:'POST',body:{index,units:prepared.carry.slice(start,end)},signal:this._ctAbort.signal});start=end;
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
    const fieldsComponent = { props: ['host'], template: `
        <div class="ctFields" :inert="host.ctBusy">
            <section v-for="(choice,index) in host.ctChoices" :key="index" class="ctDeveloperNotes"><strong>Translation choice · {{ host.ctCurrentUnit.fields.find(field=>field.id===choice.fieldId)?.name }}</strong><p>Incoming translation remains active. Choose the text to keep.</p><pre>{{ choice.upstream ?? choice.remote }}</pre><button @click="host.ctChooseAlternative(choice,'remote')">Keep incoming</button><pre>{{ choice.local }}</pre><button @click="host.ctChooseAlternative(choice,'local')">Use previous saved text</button></section>
            <section v-if="host.ctNotes().length" class="ctDeveloperNotes"><strong>Developer notes</strong><pre v-for="(note,index) in host.ctNotes()" :key="index">{{ note }}</pre></section>
            <details v-if="host.ctCurrentUnit?.metadata" class="ctMetadata"><summary>Workbook metadata</summary><pre>{{ host.ctCurrentUnit.metadata }}</pre></details>
            <section v-for="group in host.ctFieldGroups" :key="group.key" class="ctBlock">
                <h3>{{ group.name }}</h3><pre v-if="group.source" class="ctEnglish">{{ group.source }}</pre>
                <table v-if="group.forms" class="ctFormGrid"><thead><tr><th>Form</th><th>Singular</th><th v-if="group.fields.some(field => ['MP','FP','NP'].includes(field.form))">Plural</th></tr></thead><tbody>
                    <tr v-for="row in ['M','F','N'].filter(row => group.fields.some(field => field.form.startsWith(row)))" :key="row"><th>{{ row }}</th>
                    <td v-for="number in (group.fields.some(field => ['MP','FP','NP'].includes(field.form)) ? ['S','P'] : ['S'])" :key="number">
                        <template v-if="host.ctForm(group,row+number)"><ct-target :host="host" :field="host.ctForm(group,row+number)"></ct-target></template><span v-else class="versionMuted">Unavailable</span>
                    </td></tr></tbody></table>
                <template v-else><ct-target v-for="field in group.fields" :key="field.id" :host="host" :field="field"></ct-target></template>
            </section>
        </div>` };
    const targetComponent = { props: ['host', 'field'], template: `
        <div class="ctTarget" :class="{missing:host.ctFieldStatus(field).missing,outdated:host.ctFieldStatus(field).outdated}">
            <label :for="'ctfield-'+field.targetCell">{{ field.form || field.name }} <small>{{ field.required ? '' : 'Optional' }}</small></label>
            <select v-if="field.kind === 'gender'" :id="'ctfield-'+field.targetCell" v-model="host.ctValues[field.id]" @change="host.ctEdited(field)" aria-label="Gender"><option value="">Blank</option><option v-for="gender in ['M','F','N','MP','FP','NP']" :key="gender">{{ gender }}</option></select>
            <textarea v-else :id="'ctfield-'+field.targetCell" v-model="host.ctValues[field.id]" @focus="host.ctFocusedField=field.id" @input="host.ctEdited(field);host.ctSuggest(field,$event)" @keydown="host.ctCompleteForm(field,$event)" :aria-label="field.name + (field.form ? ' '+field.form : '')" spellcheck="false" rows="3"></textarea>
            <div v-if="host.ctCompletion?.fieldId===field.id" class="ctCompletion" role="listbox" aria-label="Source token completions"><button v-for="item in host.ctCompletion.items" :key="item.value" @mousedown.prevent @click="host.ctApplyCompletion(field,item)">{{ item.label }}</button></div>
            <div class="ctFieldFacts"><span v-if="host.ctFieldStatus(field).missing">Missing</span><span v-if="host.ctFieldStatus(field).outdated">Outdated</span><span v-if="host.ctReviewed[field.id] === host.ctReviewHash(field) && host.ctFieldStatus(field).outdated">Reviewed in this draft</span><button v-if="host.ctFieldStatus(field).outdated && host.ctReviewed[field.id] !== host.ctReviewHash(field)" @click="host.ctMarkReviewed(field)">Mark reviewed</button><small v-if="field.kind === 'form'">NONEXISTENT: type a prefix and press Tab</small></div>
            <p v-for="(issue,index) in (host.ctDiagnostics[host.ctSelection] || []).filter(item=>item.fieldId === field.id)" :key="index" :class="'ctDiagnostic '+issue.severity">{{ issue.message }}</p>
        </div>` };
    const toolsComponent = { props: ['host'], template: `
        <aside class="ctTools" aria-label="File tools"><nav><button v-for="tab in ['lookup','dictionary','history','comments']" :key="tab" :class="{active:host.ctTool === tab}" @click="host.ctTool=tab">{{ tab }}</button></nav>
            <section v-if="host.ctTool === 'lookup'"><h3>Translation memory</h3><p class="versionMuted">Accepted text from this language, matched by field kind and grammatical form.</p><article v-for="match in host.ctMemoryResults" :key="match.id"><strong>{{ match.kind }} · {{ Math.min(100,match.score) }}%</strong><pre>{{ match.source }}</pre><pre>{{ match.target }}</pre><button @click="host.ctApplyMemory(match)" :disabled="host.ctBusy">Use translation</button><p v-for="(warning,index) in match.warnings" :key="index">{{ warning.message }}</p></article><p v-if="!host.ctMemoryResults.length">No memory matches.</p><h3>Lookup</h3><input v-model="host.ctLookup" placeholder="Exact text lookup" aria-label="Lookup text"><article v-for="(match,index) in host.ctLookupResults" :key="index"><button @click="host.ctSelect(host._ctUnitIndex.get(match.unitId),host.ctEditor)">{{ match.sheet }} · {{ match.recordId }} · {{ match.name }} {{ match.form }}</button><pre>{{ match.source }}</pre><pre>{{ match.target }}</pre></article><p v-if="!host.ctLookupResults.length">No matches.</p></section>
            <section v-if="host.ctTool === 'dictionary'"><h3>Dictionary</h3><article v-for="(entry,index) in host.ctDictionaryMatches" :key="entry.id || index"><strong>{{ entry.find }}</strong><pre>{{ entry.replace }}</pre><p v-if="entry.note">{{ entry.note }}</p></article><p v-if="!host.ctDictionaryMatches.length">No matching Dictionary entries.</p></section>
            <section v-if="host.ctTool === 'history'" class="ctHistoryPanel"><h3>History</h3>
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
                            <details v-if="host.ctHistoryComparison.before.unit.metadata || host.ctHistoryComparison.after.unit.metadata"><summary>Workbook metadata</summary><div class="ctHistoryColumns"><pre>{{ host.ctHistoryComparison.before.unit.metadata }}</pre><pre>{{ host.ctHistoryComparison.after.unit.metadata }}</pre></div></details>
                        </div>
                    </section>
                </div>
            </section>
            <section v-if="host.ctTool === 'comments'"><h3>Comments</h3><article v-for="comment in host.ctComments" :key="comment.id"><strong>{{ comment.actor?.name || comment.authorName || comment.actor?.id || comment.authorId }}</strong><small>{{ comment.audience }}</small><pre>{{ comment.text }}</pre></article><textarea v-model="host.ctCommentText" @input="host.ctQueueCommentDraft()" aria-label="Comment" placeholder="Write a comment" rows="3"></textarea><label><input type="checkbox" v-model="host.ctCommentGlobal" @change="host.ctQueueCommentDraft()"> All language teams</label><button @click="host.ctPostComment" :disabled="!host.managedOnlineAvailable || host.ctBusy || !host.ctCommentText.trim()">Post comment</button></section>
        </aside>` };
    return { mixin, teams, detect, groupFields, mode, fieldsComponent, targetComponent, toolsComponent };
});

