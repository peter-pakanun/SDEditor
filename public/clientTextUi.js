(function (root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.ClientTextUI = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
    'use strict';
    const exportProgress = root.ClientTextExportProgress || (typeof require === 'function' ? require('./clientTextExportProgress.js') : null);
    const statDescCodec = root.StatDescCodec || (typeof require === 'function' ? require('./statDescCodec.js') : null);
    const teams = ['French', 'German', 'Spanish', 'Portuguese', 'Russian', 'Thai', 'Korean', 'Japanese', 'Simplified Chinese', 'Traditional Chinese', 'Turkish', 'Polish'];
    const copy = value => JSON.parse(JSON.stringify(value));
    const raw = value => root.Vue?.markRaw ? root.Vue.markRaw(value) : value;
    // Explicit actions post a fresh occurrence even when their wording repeats.
    // Background sync continues to update message fields without revealing an
    // unchanged, manually dismissed status on every poll.
    const postNotice = (host, key, message) => { host[key] = message; root.EditorComponents?.revealNotice(host, key); };
    const fileDrag = event => Array.from(event.dataTransfer?.types || []).includes('Files')
        || Array.from(event.dataTransfer?.files || []).length > 0;
    const unproxy = value => root.Vue?.toRaw ? root.Vue.toRaw(value) : value;
    const uuid = () => root.crypto.randomUUID();
    const mode = group => String(group?.contentMode || group?.mode || '').toLowerCase();
    const trustedProtocol = 'clienttext-trusted-v1';
    const statusFilters = [
        {key:'missing',label:'Missing translation',tone:'missing'}, {key:'saved',label:'Saved changes',tone:'saved'},
        {key:'revised',label:'Revised translations',tone:'revised'}, {key:'outdated',label:'Outdated translation',tone:'outdated'},
        {key:'error',label:'Diagnostic errors',tone:'error'}, {key:'warning',label:'Diagnostic warnings',tone:'warning'},
        {key:'unchanged',label:'Unchanged',tone:'unchanged'}
    ];
    // Start with workload and saved changes; complete originals remain
    // available through the Unchanged filter.
    const defaultFilters = () => [...statusFilters.filter(item=>item.key!=='unchanged').map(item=>item.key),'mtl'];
    const scanTypes = [
        {key:'whitespace',label:'Whitespace',description:'Leading, trailing, and repeated spaces.'},
        {key:'dash',label:'Dash spacing',description:'Dashes at line boundaries or next to spaces.'},
        {key:'tagSyntax',label:'Tag syntax',description:'Missing, extra, nested, or malformed tags.'},
        {key:'variables',label:'Variable tags',description:'Variable identities and counts compared with English.'},
        {key:'keywords',label:'Keyword popup tags',description:'Keyword identities and counts compared with English.'},
        {key:'decorations',label:'Text decoration tags',description:'Decoration names and counts compared with English.'},
        {key:'consistency',label:'Inconsistent translations',description:'Different translations of identical English fields and grammatical forms.'},
        {key:'terminology',label:'Dictionary terminology',description:'Terms that do not use an approved dictionary translation.'},
        {key:'substitutions',label:'ClientText substitutions',description:'Icon and substitution identities and counts compared with English.'},
        {key:'controls',label:'ClientText controls',description:'Control identities and counts compared with English.'}
    ];
    const defaultScanChecks = () => Object.fromEntries(scanTypes.map(type=>[type.key,type.key!=='terminology']));
    const rowControl = event => !!event?.target?.closest?.('textarea,input,select,button,label,a,audio,[contenteditable="true"],.HLter,.ctReferenceContext,.ctDialogueAudio,.fieldEnglishTarget');
    const genderSuggestions = ['M', 'F', 'N', 'MP', 'FP', 'NP'];
    const russianGenderSuggestions = ['MS', 'FS', 'NS', 'MP', 'FP', 'NP', 'M'];
    const pairedLanguages = ['French', 'German', 'Polish', 'Portuguese', 'Russian', 'Spanish'];
    const classForms = new Set(['StrFour','IntFour','DexFour','StrDexFour','DexIntFour','StrIntFour',
        'StrFourb','IntFourb','DexFourb','StrDexFourb','DexIntFourb','StrIntFourb']);
    const isClassField = field => field.kind === 'form' && classForms.has(field.form);
    const previewAffixExamples = [
        {key:'sword',label:'Dayanıklı / Alev',prefix:'Dayanıklı',suffix:'Alev'},
        {key:'emerald',label:'Korkusuz / Ölümsüzlük',prefix:'Korkusuz',suffix:'Ölümsüzlük'}
    ];
    const previewAffixesFor = unit => {
        const example=previewAffixExamples[/\bEmerald\b/i.test(unit?.fields?.[0]?.source || '') ? 1 : 0];
        return {example:example.key,prefix:example.prefix,suffix:example.suffix};
    };
    function genderRawOffset(value,offset) {
        let raw=0,shown=0;while(raw<value.length && shown<offset){raw+=value[raw]==='\r' && value[raw+1]==='\n'?2:1;shown++;}return raw;
    }
    function detect(filename) {
        const stem=String(filename).replace(/\.[^.]+$/,''),name=stem.replace(/[_.\s-]+/g,' ').trim().toLowerCase();
        const language=teams.find(team=>name===team.toLowerCase() || name.startsWith(team.toLowerCase()+' ')) || '';
        return { language, role: /(?:^|[_.\s-])Gender(?=$|[_.\s-])/i.test(stem) ? 'gender' : 'normal' };
    }
    function translatedFilename(filename) {
        const name = String(filename), match = /^(.*)(\.[^.]+)$/.exec(name), extension = match ? match[2] : '', stem = match ? match[1] : name;
        if (/_Translated$/i.test(stem)) return name;
        // Keep browser duplicate counters while moving only the reserved export
        // marker to the end. Other occurrences of "Translated" are filename text.
        const duplicate = /^(.*)(_Translated)((?: ?\(\d+\))+)$/i.exec(stem);
        return duplicate ? duplicate[1] + (duplicate[3].startsWith(' ') ? '' : ' ') + duplicate[3] + duplicate[2] + extension : stem + '_Translated' + extension;
    }
    function workbookExportNames(outputs) {
        const names = new Array(outputs.length), used = new Set(), priority = role => role === 'normal' ? 0 : role === 'gender' ? 1 : 2;
        const order = outputs.map((output, index) => ({ ...output, index })).sort((a, b) => priority(a.role) - priority(b.role) || a.index - b.index);
        for (const output of order) {
            const name = translatedFilename(output.name); let selected = name, attempt = 0;
            const match = /^(.*)(_Translated)(\.[^.]+)?$/i.exec(name), label = output.role === 'gender' ? 'Gender' : 'Normal';
            while (used.has(selected.toLowerCase())) {
                attempt++;
                selected = match[1] + '_' + label + (attempt > 1 ? '_' + attempt : '') + match[2] + (match[3] || '');
            }
            names[output.index] = selected; used.add(selected.toLowerCase());
        }
        return names;
    }
    function groupFields(unit) {
        const groups = [], fields = unit?.fields || [], classSources = new Set(fields.filter(isClassField)
            .map(field => JSON.stringify([field.group || field.name, field.sourceCell])));
        for (const field of fields) {
            // Regular and class-specific targets can share one worksheet source.
            // Keep the form group's key and all original field identities intact.
            const key = field.kind === 'form' ? field.group || field.name : field.kind === 'text'
                && classSources.has(JSON.stringify([field.name, field.sourceCell])) ? field.name : field.id;
            let group = groups.find(item => item.key === key);
            if (!group) groups.push(group = { key, name: field.name, source: field.source, fields: [], forms: field.kind === 'form' });
            group.fields.push(field);if (field.kind === 'form') group.forms = true;
        }
        return groups;
    }
    function isDNTSource(source) {
        return statDescCodec.computeIsDNT([String(source ?? '')]);
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
            originalContext: context === unit, provenance: copy(record?.provenance || {}), revision: record?.revision };
    }
    function normalizeHistory(entry, origin, unit, ctx) {
        const record = entry.after || entry.saved || entry.value || entry;
        const unitId = entry.unitId || record.unitId || (record !== entry ? record.id : '') || unit.id;
        if (unitId !== unit.id) return null;
        const createdAt = entry.createdAt || entry.at || record.savedAt || 0;
        const time = typeof createdAt === 'number' ? createdAt : Date.parse(createdAt) || 0;
        const key = origin + ':' + String(entry.id ?? entry.jobId ?? root.ClientTextState.hash([unitId, time, entry.before, record]));
        return { key, id: entry.id, unitId, origin, action: Object.keys(entry.intentChanges || record.intentChanges || entry.after?.intentChanges || {}).length ? 'Use English decision / translation change' : entry.origin || record.origin || 'save', createdAt: time,
            actor: copy(entry.actor || {}), intentChanges:Object.fromEntries(Object.entries(entry.intentChanges || record.intentChanges || {}).map(([id,change])=>[id,{...copy(change),label:unit.fields.find(field=>field.id===id)?.name || 'this field'}])), before: historySnapshot(unit, entry.before || null), after: historySnapshot(unit, record),
            ...(entry.syncRecovery?{syncRecovery:copy(entry.syncRecovery),syncRecoveryText:JSON.stringify(entry.syncRecovery,null,2)}:{}),
            context: copy(ctx), provenance: copy(record.provenance || {}), sequence: entry.sequence };
    }
    const mixin = {
        data() { return {
            ...exportProgress?.mixin.data(),
            ctActive: false, ctWorkspace: null, ctUnits: raw([]), ctSaved: raw({}), ctRevision: 0,
            ctSheet: '', ctSheetFilter: '', ctSearch: '', ctAppliedSearch: '', ctSearchCaseSensitive: false, ctFilter: '', ctPage: 1, ctPageSize: 20,
            ctBrowseMode: 'sheets', ctNpcSelection: 'all', ctNpcKind: '', ctNpcFilter: '', ctBrowseBusy: false,
            ctConvoSelection: 'all', ctConvoFilter: '', ctConvoExpanded: [], ctConvoFocusKey: '',
            ctSort: 'row', ctSortDir: 'asc', ctSelectedFilters: defaultFilters(), ctFiltersVisible: false,
            ctSelection: '', ctEditor: false, ctInlineClosed: false, ctAudioController:null, ctValues: {}, ctReviewed: {}, ctDraftDirty: false, ctDraftStageFailure: null, ctCompletion: null,
            ctVariantSelections: {},
            ctBusy: false, ctNavigationBusy: false, ctInitializing:false, ctProgress: null, ctError: '', ctNotice: '', ctDiagnostics: raw({}), ctScanDone: false,
            ctScanTypes:scanTypes,ctScanChecks:defaultScanChecks(),ctScanAppliedChecks:null,ctScanRunning:false,ctScanStopped:false,
            ctScanProcessed:0,ctScanTotal:0,ctScanRunId:0,ctScanError:'',ctScanPhase:'',ctScanErrorFileCount:0,ctScanWarningFileCount:0,
            ctScanResultsPage:1,ctScanResultsPageSize:20,
            ctHistory: [], ctHistoryLoading: false, ctHistoryPreviousLoading: false, ctHistoryError: '', ctHistoryCursor: null, ctHistoryLocalMore: false,
            ctHistoryCompareA: 'original', ctHistoryCompareB: 'current', ctHistoryWhitespace: false, ctHistoryCharacters: false, ctHistoryViewer: false,
            ctTool: 'dictionary', ctLookup: '', ctFocusedField: '', ctMemory: raw([]), ctComments: [], ctCommentText: '', ctCommentGlobal: false, ctChoices: [], ctRecoveryBusy:false,
            ctDictionaryFilter:'',ctDictionaryPage:1,ctDictionaryEditingId:'',ctDictionaryEditOrder:[],
            ctPreviewGggVars: {}, ctPreviewAffixes:previewAffixesFor(null), ctPreviewAffixExamples:previewAffixExamples,
            ctDictionaryPack:null, ctDraftSummaries:[], ctCommentPostError:'',
            ctCheckpointWarning: null, ctLocalEmergencyDrafts: [], ctLocalIssue: '', ctLocalDraftState: '', ctLocalBackupBusy: false, ctPeers: [], ctLocalWorkspaces: [], ctRequests: [], ctUploadVisible: false, ctUploadLocal: false, ctUploadTest: false,
            ctUploadVersion: null, ctUploadPredecessor: null, ctUploadName: '', ctUploadDeadline: '', ctUploadFiles: raw([]), ctPrepared: raw([]),
            ctUploadHistory: false, ctUploadHistoryFiles: raw([]), ctUploadEnglishPrevious:'', ctWorkbookDragDepth: 0,
            ctUploadAssignments: teams.slice(), ctPolicy: null, ctPolicyText: '', ctUploadError: '', ctUploading: false, ctDuplicateChoices: {},
            activeContentGroup: null, ctTeamOptions: teams
        }; },
        computed: {
            ...exportProgress?.mixin.computed,
            ctPrivateLocalWorkspaces() {
                return this.ctLocalWorkspaces.filter(row => row.groupId?.startsWith('local:test:'))
                    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0) || a.groupId.localeCompare(b.groupId));
            },
            ctVersionWorkbookDropEnabled() {
                return this.versionChooserVisible && !this.testMode && this.gameVersionSelected && !this.needsInitialSettings
                    && !this.workspaceInitializationActive && !this.showSetting && !this.settingsDialogVisible
                    && !this.ctUploadVisible && !this.managedVersionBusy && !this.ctBusy && !this.ctUploading;
            },
            ctOfflineTest() { return String(this.ctWorkspace?.scope.groupId || '').startsWith('local:test:'); },
            ctGroups() {
                const version=this.managedSelectedVersion;
                if(!version)return [];
                const matches=candidate=>candidate?.id===version.id && (!candidate.game || candidate.game===this.gameVersion)
                    && (candidate.branchId || 'default')===(this.branchId || 'default');
                const details=this.managedSelectedDetails;
                const detailGroups=!details?.version?.id || matches(details.version) ? details?.contentGroups : null;
                const catalog=this.managedVersions?.find(matches);
                const catalogGroups=catalog?.contentGroups || version.contentGroups;
                if(!Array.isArray(detailGroups))return catalogGroups || [];
                if(!Array.isArray(catalogGroups))return detailGroups;
                const detailRevision=details?.version?.membershipRevision,catalogRevision=(catalog || version).membershipRevision;
                const hasDetailRevision=Number.isSafeInteger(detailRevision),hasCatalogRevision=Number.isSafeInteger(catalogRevision);
                if(hasCatalogRevision && (!hasDetailRevision || catalogRevision>detailRevision))return catalogGroups;
                if(!hasCatalogRevision || detailRevision>catalogRevision)return detailGroups;
                // A cached translator snapshot can contain only the assigned
                // team. Equal membership revisions describe the same groups;
                // retain the full Manager catalog and enrich its visible teams.
                // A newer membership revision is authoritative, even if empty.
                const groups=new Map(catalogGroups.map(group=>[group.id,group]));
                for(const group of detailGroups){
                    const existing=groups.get(group.id);
                    if(!existing || existing===group){groups.set(group.id,group);continue;}
                    const teams=new Map((existing.teams || []).map(team=>[team.language,team]));
                    for(const team of group.teams || [])teams.set(team.language,team);
                    groups.set(group.id,{...existing,...group,teams:[...teams.values()]});
                }
                return [...groups.values()];
            },
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
                const hasGroupCatalog=Array.isArray(details?.contentGroups) || Array.isArray(version.contentGroups)
                    || this.managedVersions?.some(candidate=>candidate.id===version.id && candidate.game===this.gameVersion
                        && (candidate.branchId || 'default')===(this.branchId || 'default') && Array.isArray(candidate.contentGroups));
                const legacyFallback=!hasGroupCatalog || eligibleGroups.some(group=>group.legacyVersionId && mode(group)==='statdescription');
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
            ctPossessivePreviewForms() {
                if(!this.ctActive || this.ctWorkspace?.scope.language!=='Turkish')return null;
                const field=this.ctPreviewField;
                if(!field)return null;
                if(root.ClientTextState.isNamedForm(field)){
                    const fields=this.ctFieldsFor().filter(candidate=>root.ClientTextState.isNamedForm(candidate)
                        && (candidate.group || candidate.name)===(field.group || field.name));
                    const normal=fields.find(candidate=>candidate.form==='Normal Translation');
                    if(normal)return {normal,possessive:fields.find(candidate=>candidate.form==='Possessive Translation')};
                }
                if(/<if:possessive>/.test(this.ctPreviewValue(field)))return {normal:field,possessive:null};
                return null;
            },
            ctGamePreview() {
                const empty={segments:[],keysOrder:[]};
                if(!this.ctActive)return {source:empty,target:empty};
                const field=this.ctPossessivePreviewForms?.normal || this.ctPreviewField;
                if(!field)return {source:empty,target:empty};
                return {source:this.buildGamePreviewSegments(field.source,{contentMode:'clienttext'}),
                    target:this.buildGamePreviewSegments(this.ctPreviewValue(field),{contentMode:'clienttext',
                        ...(this.ctPossessivePreviewForms ? {possessive:false} : {})})};
            },
            ctGamePreviewVariants() {
                const fallback=this.ctClassFallback(this.ctPreviewField);
                if(fallback?.defaults.length>1 && fallback.kind!=='english')return fallback.defaults.map(item=>({key:item.field.id,
                    label:(item.field.form || 'Generic')+(item.english?' · English':' · Generic'),
                    ...this.buildGamePreviewSegments(item.value,{contentMode:'clienttext'})}));
                const forms=this.ctPossessivePreviewForms;
                if(!forms)return [];
                const normal=this.ctGamePreview.target;
                const prefix=this.buildGamePreviewSegments(this.ctPreviewAffixes.prefix.trim(),{contentMode:'clienttext',possessive:false});
                const suffix=this.buildGamePreviewSegments(this.ctPreviewAffixes.suffix.trim(),{contentMode:'clienttext',possessive:true});
                const dedicated=forms.possessive ? this.ctPreviewValue(forms.possessive) : '';
                const possessive=suffix.segments.length ? this.buildGamePreviewSegments(dedicated.trim() ? dedicated : this.ctPreviewValue(forms.normal),
                    {contentMode:'clienttext',possessive:true}) : normal;
                const compose=(...parts)=>{
                    const active=parts.filter(part=>part.segments.length),segments=[];
                    for(const part of active){if(segments.length)segments.push({type:'text',text:' '});segments.push(...part.segments);}
                    return {segments,keysOrder:[...new Set(active.flatMap(part=>part.keysOrder))]};
                };
                return [
                    {key:'normal',label:'Normal',...normal},
                    {key:'prefix',label:'With prefix',...compose(prefix,normal)},
                    {key:'both',label:'With prefix + suffix',...compose(suffix,prefix,possessive)}
                ];
            },
            ctPreviewKeys() { return [...new Set([...this.ctGamePreview.source.keysOrder,...this.ctGamePreview.target.keysOrder,
                ...this.ctGamePreviewVariants.flatMap(variant=>variant.keysOrder), ...(this.ctSkillVariableKeys || []), ...(this.keywordSheetPreviewKeys || [])])]; },
            ctFieldGroups() { return groupFields({fields:this.ctFieldsFor()}); },
            ctHistoryChoices() {
                return [{ key: 'original', label: 'Original workbook' }, { key: 'current', label: 'Current translation' },
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
            ctSheets() { this.ctUnits; this.hideDNT; return this._ctSheets || []; },
            ctSheetSeverities() {
                this.ctRevision;
                const severities=new Map(),priority=root.ClientTextState.SHEET_COLORS.map(color=>color==='missing'?'error':color==='outdated'?'warning':color);
                for(const unit of this.ctUnits){
                    const key=JSON.stringify([unit.role,unit.sheet]);
                    if(severities.get(key)==='error')continue;
                    const status=this.ctStatus(unit),issues=this.ctDiagnostics[unit.id] || [];
                    const severity=status.missing || issues.some(issue=>issue.severity==='error') ? 'error'
                        : status.outdated || issues.some(issue=>issue.severity==='warning') ? 'warning'
                        : root.ClientTextState.unitColorFor(unit,this.ctSaved[unit.id],status);
                    if(!severities.has(key) || priority.indexOf(severity)<priority.indexOf(severities.get(key)))severities.set(key,severity);
                }
                return severities;
            },
            ctNpcGroups() { this.ctUnits; this.ctRevision; return this._ctNpcIndex?.groups || []; },
            ctNpcSeverities() {
                this.ctRevision;
                const severities=new Map(),diagnostics=this.ctDiagnostics;
                for(const group of this.ctNpcGroups){
                    let severity='';
                    for(const unit of group.units){
                        const status=this.ctStatus(unit),issues=diagnostics[unit.id] || [];
                        if(status.missing || issues.some(issue=>issue.severity==='error')){severity='error';break;}
                        if(status.outdated || issues.some(issue=>issue.severity==='warning'))severity='warning';
                    }
                    severities.set(group.key,severity);
                }
                return severities;
            },
            ctNpcFilteredGroups() {
                this.ctRevision;
                const query=this.ctNpcFilter.trim().toLocaleLowerCase();
                return query ? this.ctNpcGroups.filter(group=>[group.label,...group.paths,...group.npcUnits.flatMap(unit=>{
                    const values=this.ctValuesFor(unit);return unit.fields.filter(field=>/^(?:short )?name$/i.test(field.name)).map(field=>values[field.id]);
                })].some(value=>String(value ?? '').toLocaleLowerCase().includes(query))) : this.ctNpcGroups;
            },
            ctNpcBrowseTitle() {
                this.ctRevision;
                return this.ctNpcSelection==='all' ? 'All NPC text' : this.ctNpcSelection==='unassigned' ? 'Unassigned dialogue'
                    : this._ctNpcIndex?.groupByKey.get(this.ctNpcSelection)?.label || 'NPC text';
            },
            ctNpcTotal() { this.ctUnits; this.ctRevision; return this.ctNpcCandidates().length; },
            ctNpcKindOptions() {
                const counts={names:0,topics:0,dialogue:0,conversations:0};
                for(const unit of this.ctNpcCandidates()) {const kind=root.ClientTextNpcIndex?.kindFor(unit);if(kind in counts)counts[kind]++;}
                return [{key:'',label:'All text',count:this.ctNpcTotal},...Object.entries(counts).map(([key,count])=>({key,label:this.ctNpcKindName(key),count}))];
            },
            ctConvoParents() {this.ctUnits;this.ctRevision;return this._ctConvoIndex?.parents || [];},
            ctConvoTree() {
                this.ctRevision;
                if(!this._ctConvoIndex?.units.length)return [];
                const query=this.ctConvoFilter.trim().toLocaleLowerCase(),expanded=new Set(this.ctConvoExpanded),rows=[];
                for(const parent of this.ctConvoParents){
                    const parentMatches=!!query && [parent.label,...parent.paths,...parent.npcUnits.flatMap(unit=>{
                        const values=this.ctValuesFor(unit);return unit.fields.filter(field=>/^(?:short )?name$/i.test(field.name)).map(field=>values[field.id]);
                    })].some(value=>String(value ?? '').toLocaleLowerCase().includes(query));
                    const families=query && !parentMatches ? parent.families.filter(family=>[family.stem,...family.units.map(unit=>unit.recordId)]
                        .some(value=>String(value).toLocaleLowerCase().includes(query))) : parent.families;
                    if(query && !parentMatches && !families.length)continue;
                    const key=this.ctConvoNodeKey('parent',parent.key),open=!!families.length && (!!query || expanded.has(parent.key));
                    rows.push({key,type:'parent',node:parent,level:1,expanded:open,selected:this.ctConvoSelection===key});
                    if(open)for(const family of families){const key=this.ctConvoNodeKey('family',family.key);
                        rows.push({key,type:'family',node:family,level:2,expanded:false,selected:this.ctConvoSelection===key});}
                }
                const focus=rows.some(row=>row.key===this.ctConvoFocusKey)?this.ctConvoFocusKey
                    : rows.find(row=>row.selected)?.key || rows[0]?.key;
                return rows.map(row=>({...row,focused:row.key===focus}));
            },
            ctConvoBrowseTitle() {
                this.ctRevision;const selected=this.ctConvoSelectedNode();
                if(!selected)return 'All conversations';
                if(selected.type==='parent')return selected.node.label;
                const parent=this._ctConvoIndex.parentByKey.get(selected.node.parentKey);
                return [parent?.label,`${selected.node.label} (${selected.node.anchor})`].filter(Boolean).join(' / ');
            },
            ctConvoTotal() {this.ctUnits;this.ctRevision;return this.ctConvoCandidates().length;},
            ctConvoSeverities() {
                this.ctRevision;const severityFor=units=>{let severity='';for(const unit of units){
                    const status=this.ctStatus(unit),issues=this.ctDiagnostics[unit.id] || [];
                    if(status.missing || issues.some(issue=>issue.severity==='error'))return 'error';
                    if(status.outdated || issues.some(issue=>issue.severity==='warning'))severity='warning';
                }return severity;},severities=new Map();
                for(const parent of this.ctConvoParents){
                    severities.set(this.ctConvoNodeKey('parent',parent.key),severityFor(parent.units));
                    for(const family of parent.families)severities.set(this.ctConvoNodeKey('family',family.key),severityFor(family.units));
                }return severities;
            },
            ctFilteredSheets() {
                const query = this.ctSheetFilter.trim().toLowerCase();
                return query ? this.ctSheets.filter(sheet=>sheet.name.toLowerCase().includes(query)) : this.ctSheets;
            },
            ctDiagnosticCounts() {
                if(this.ctScanRunning)return {error:this.ctScanErrorFileCount,warning:this.ctScanWarningFileCount};
                const counts={error:0,warning:0};
                for(const issues of Object.values(this.ctDiagnostics))for(const severity of ['error','warning'])if(issues.some(issue=>issue.severity===severity))counts[severity]++;
                return counts;
            },
            ctHasScanSelection() {return this.ctScanTypes.some(type=>this.ctScanChecks[type.key]);},
            ctScanScopeKey() {return JSON.stringify([this.ctActive,this.ctContext(),this.cloudProfileId || this.cloudUser?.id || 'guest',this.gameVersion,this.branchId || 'default',this.lang]);},
            ctScanPercent() {return this.ctScanTotal ? Math.round(this.ctScanProcessed/this.ctScanTotal*100) : this.ctScanDone ? 100 : 0;},
            ctScanResultFiles() {
                return Object.entries(this.ctDiagnostics).filter(([,issues])=>issues.length).map(([filepath,issues])=>{
                    const unit=this._ctUnitIndex?.get(filepath),errors=issues.filter(issue=>issue.severity==='error'),warnings=issues.filter(issue=>issue.severity==='warning');
                    // Keep exact counts, with the same bounded card output as SD.
                    const diagnostics=[...errors,...warnings].slice(0,40).map(issue=>({...issue,level:issue.severity || issue.level}));
                    return {filepath,label:unit ? [unit.role,unit.sheet,unit.recordId].filter(Boolean).join(' / ') : filepath,
                        result:{errorCount:errors.length,warningCount:warnings.length,hasDiagnosticError:!!errors.length,hasDiagnosticWarning:!!warnings.length,
                            diagnostics,diagnosticsTruncated:issues.length-diagnostics.length}};
                }).sort((a,b)=>Number(b.result.hasDiagnosticError)-Number(a.result.hasDiagnosticError) || a.label.localeCompare(b.label,undefined,{numeric:true}) || a.filepath.localeCompare(b.filepath));
            },
            ctScanResultPageCount() {return Math.max(1,Math.ceil(this.ctScanResultFiles.length/this.ctScanResultsPageSize));},
            ctScanResultRangeLabel() {
                const total=this.ctScanResultFiles.length,page=Math.min(this.ctScanResultsPage,this.ctScanResultPageCount),size=this.ctScanResultsPageSize;
                const start=total ? (page-1)*size+1 : 0,end=Math.min(page*size,total);
                return `${start.toLocaleString('en-US')}–${end.toLocaleString('en-US')} of ${total.toLocaleString('en-US')}`;
            },
            ctScanVisibleResults() {const page=Math.min(this.ctScanResultsPage,this.ctScanResultPageCount);return this.ctScanResultFiles.slice((page-1)*this.ctScanResultsPageSize,page*this.ctScanResultsPageSize);},
            ctScanIssueCounts() {return Object.values(this.ctDiagnostics).reduce((counts,issues)=>{for(const issue of issues)if(issue.severity==='error')counts.errors++;else if(issue.severity==='warning')counts.warnings++;return counts;},{errors:0,warnings:0});},
            ctDiagnosticScanController() {
                if(this._ctDiagnosticScanController)return this._ctDiagnosticScanController;
                const host=this,aliases={diagnosticScanTypes:'ctScanTypes',diagnosticScanChecks:'ctScanChecks',diagnosticScanAppliedChecks:'ctScanAppliedChecks',
                    diagnosticScanRunning:'ctScanRunning',diagnosticScanCompleted:'ctScanDone',diagnosticScanStopped:'ctScanStopped',diagnosticScanProcessed:'ctScanProcessed',
                    diagnosticScanTotal:'ctScanTotal',diagnosticScanRunId:'ctScanRunId',diagnosticScanError:'ctScanError',diagnosticScanPhase:'ctScanPhase',
                    diagnosticScanErrorFileCount:'ctScanErrorFileCount',diagnosticScanWarningFileCount:'ctScanWarningFileCount',diagnosticScanResultsPage:'ctScanResultsPage',
                    diagnosticScanResultsPageSize:'ctScanResultsPageSize',hasDiagnosticScanSelection:'ctHasScanSelection',diagnosticScanPercent:'ctScanPercent',
                    diagnosticScanResultFiles:'ctScanResultFiles',diagnosticScanResultPageCount:'ctScanResultPageCount',diagnosticScanResultRangeLabel:'ctScanResultRangeLabel',
                    diagnosticScanVisibleResults:'ctScanVisibleResults',diagnosticScanIssueCounts:'ctScanIssueCounts',openDiagnosticScanDialog:'ctOpenScanDialog',
                    closeDiagnosticScanDialog:'ctCloseScanDialog',diagnosticScanDialogClosed:'ctScanDialogClosed',diagnosticScanDialogKeydown:'ctScanDialogKeydown',
                    startDiagnosticScan:'ctStartScan',stopDiagnosticScan:'ctStopScan',scanAllDiagnostics:'ctScan',openDiagnosticResult:'ctOpenDiagnosticResult',
                    diagnosticScanIssueLocation:'ctScanIssueLocation',diagnosticScanUnitLabel:'ctScanUnitLabel'};
                this._ctDiagnosticScanController=raw(new Proxy({}, {
                    get(_target,key) {
                        if(key==='registerRefs' || key==='unregisterRefs')return host.sharedEditorController?.[key];
                        if(key==='diagnosticScanDescription')return `Run selected checks for ${host.ctWorkspace?.scope.language || host.lang || 'the selected language'} across all loaded records, including records hidden by worklist filters. Local drafts are excluded.`;
                        if(key==='diagnosticScanCheckHint')return 'Inconsistent translations and Dictionary terminology run only when you start a scan. Audio-only fields, Gender metadata, and NONEXISTENT forms are excluded.';
                        if(key==='diagnosticScanResultsTitle')return 'Records with findings';
                        if(key==='diagnosticScanProgressLabel')return 'Records scanned';
                        if(key==='diagnosticScanTruncatedHint')return 'Open the record to inspect every affected field.';
                        if(key==='openDiagnosticResultLabel')return 'Open record';
                        if(key==='diagnosticScanResults')return Object.fromEntries(host.ctScanResultFiles.map(entry=>[entry.filepath,entry.result]));
                        const value=host[aliases[key] || key];return typeof value==='function' ? value.bind(host) : value;
                    },
                    set(_target,key,value) {host[aliases[key] || key]=value;return true;},
                    has(_target,key) {return key in aliases || key in host || ['registerRefs','unregisterRefs','diagnosticScanDescription','diagnosticScanCheckHint','diagnosticScanResultsTitle','diagnosticScanProgressLabel','diagnosticScanTruncatedHint','openDiagnosticResultLabel','diagnosticScanResults'].includes(key);}
                }));return this._ctDiagnosticScanController;
            },
            ctStatusFilterOptions() {
                const counts={...this.ctCounts,error:0,warning:0,draft:this.ctDraftCount,mtl:this.ctMtlCount || 0};
                for(const issues of Object.values(this.ctDiagnostics))for(const severity of ['error','warning'])if(issues.some(issue=>issue.severity===severity))counts[severity]++;
                return [...statusFilters,...(this.ctMtlVisible && counts.mtl ? [{key:'mtl',label:'MTL',tone:'mtl'}] : [])].map(item=>({...item,count:counts[item.key] || 0}));
            },
            ctEffectivePageSize() { return Math.max(1,Math.floor(Number(this.pageSize || this.ctPageSize) || 20)); },
            ctRows() {
                this.ctRevision;
                const caseSensitive = this.ctSearchCaseSensitive;
                const query = caseSensitive ? this.ctAppliedSearch : this.ctAppliedSearch.toLocaleLowerCase();
                return this.ctBrowseOrderedUnits().filter(unit => {
                    const fields=this.ctFieldsFor(unit);if(!fields.length)return false;
                    if (this.ctBrowseMode==='sheets' && this.ctSheet && JSON.stringify([unit.role, unit.sheet]) !== this.ctSheet) return false;
                    const status = this.ctStatus(unit);
                    if (this.ctFilter === 'error' || this.ctFilter === 'warning') {
                        if (!(this.ctDiagnostics[unit.id] || []).some(item => item.severity === this.ctFilter)) return false;
                    } else if (this.ctFilter === 'mtl' ? !this.ctMtlUnitIds?.has(unit.id) : this.ctFilter === 'draft' ? !this.ctDraftUnitIds.has(unit.id) : this.ctFilter && !status[this.ctFilter]) return false;
                    if(!this.ctFilter && !this.ctSelectedFilters.some(key=>key==='error'||key==='warning'
                        ? (this.ctDiagnostics[unit.id] || []).some(issue=>issue.severity===key) : key==='draft'
                            ? this.ctDraftUnitIds.has(unit.id) : key==='mtl' ? this.ctMtlUnitIds?.has(unit.id) : status[key]))return false;
                    if (!query) return true;
                    const values = root.ClientTextState.valuesFor(unit, this.ctSaved[unit.id]);
                    return [unit.recordId, unit.sheet, ...fields.flatMap(field => [field.source, values[field.id]]), ...this.ctNotes(unit)].some(text => {
                        const value = String(text);
                        return (caseSensitive ? value : value.toLocaleLowerCase()).includes(query);
                    });
                });
            },
            ctPageRows() { return this.ctRows.slice((this.ctPage - 1) * this.ctEffectivePageSize, this.ctPage * this.ctEffectivePageSize); },
            ctPageCount() { return Math.max(1, Math.ceil(this.ctRows.length / this.ctEffectivePageSize)); },
            ctDraftUnitIds() {const ids=new Set(this.ctDraftSummaries.map(draft=>draft.unitId));if(this.ctDraftDirty && this.ctSelection)ids.add(this.ctSelection);return ids;},
            ctDraftCount() {return this.ctDraftUnitIds.size;},
            ctDraftBlocked() {
                if(!this.ctActive || !this.ctWorkspace || !this.ctCurrentUnit || !this.ctDraftDirty)return false;
                if(this.ctChoices.length)return true;
                const failure=this.ctDraftStageFailure;
                return !!failure && this.ctCurrent(failure.context) && failure.unitId===this.ctSelection
                    && failure.signature===JSON.stringify([this.ctValues,this.ctReviewed]);
            },
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
                    for (const field of unit.fields) if (!root.ClientTextState.audioOnly(field.source) && (field.originalMissing || field.outdated || this.ctSaved[unit.id]?.outdated?.includes(field.id))) {
                        const current = status.fields[field.id];
                        total++; if (current && !current.missing && !current.outdated) resolved++;
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
                        if (field.kind === 'gender' || !target?.trim() || !root.ClientTextState.isNamedForm(field) && target.trim() === 'NONEXISTENT' || !kinds.has(JSON.stringify([field.kind, field.form || null]))) continue;
                        if (field.source.toLocaleLowerCase().includes(query)) output.push({ unitId: unit.id, sheet: unit.sheet, recordId: unit.recordId, name: field.name, form: field.form, source: field.source, target });
                        if (output.length >= 40) return output;
                    }
                }
                return output;
            },
            ctMemoryResults() {const unit=this.ctCurrentUnit,field=this.ctPreviewField;return field ? root.ContentAdapters.clienttext.findMemory(this.ctEditorMemory || this.ctMemory,unit,field,{game:this.gameVersion,limit:20,threshold:this.tmThreshold || 75}) : [];},
            ctDictionaryMatches() {
                return (this.dictionary || []).filter(entry=>this.ctDictionaryMatchedDefinitions.has(String(entry?._id || '')));
            },
            ctDictionaryReady() {
                return !!(this.ctActive && this.ctWorkspace && !this.ctBusy && !this.ctHistoryViewer
                    && !this.versionChooserVisible && !this.settingsDialogVisible && !this.showSetting
                    && (!this.lang || this.lang===this.ctWorkspace.scope.language)
                    && this.gameVersion===this.ctWorkspace.scope.game && (this.branchId || 'default')===(this.ctWorkspace.scope.branchId || 'default'));
            },
            ctDictionaryScopeKey() {return JSON.stringify([this.ctContext(),this.ctSelection]);},
            ctDictionaryMatchedDefinitions() {
                const map=new Map(),fields=this.ctFieldsFor().filter(field=>field.kind!=='gender'),texts=fields.map(field=>String(field.source || ''));
                if(this.ensureDictionaryWorker){
                    for(const unit of this.ctDictionaryPack?.units || []){
                        if(!fields.some(field=>field.id===unit.key && field.source===unit.english))continue;
                        for(const hl of unit.HLs || []){
                            if(!hl.dictId)continue;const id=String(hl.dictId);if(!map.has(id))map.set(id,new Set());
                            const word=this.ctDictionaryPack.entriesById?.[id];map.get(id).add(String(hl.dictDefFind || word?.find || '').trim().toLowerCase());
                        }
                    }
                    return map;
                }
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
                const useTranslation=(word,alt,event)=>{
                    if(event){if(event.isComposing || event.keyCode===229)return false;event.preventDefault();event.stopPropagation?.();}
                    return member(word) && (!alt || word.alts?.includes(alt)) && host.ctDictionaryUse(word,alt,ctx,unitId,dictionary);
                };
                return {
                    get editorReady(){return current() && host.ctDictionaryReady;},get visibleDictionary(){return current() ? host.ctDictionaryVisible : [];},
                    get dictionaryTemporary(){return host.ctOfflineTest && !host.ctResourceSyncEnabled;},
                    get dictionaryFlashId(){return host.dictionaryFlashId;},get translationEditorBcp47(){return host.translationEditorBcp47;},
                    get dictionaryCanUse(){return current() && host.ctDictionaryReady && host.ctCurrentUnit?.fields.some(field=>field.id===host.ctFocusedField && field.kind!=='gender');},
                    get cloudEntryHistoryAvailable(){return current() && host.cloudEntryHistoryAvailable;},get cloudEntryHistoryHint(){return host.cloudEntryHistoryHint;},
                    isDictionaryEntryFound:word=>host.ctDictionaryMatchedDefinitions.has(String(word._id)),
                    isDictionaryEntryFindMatched:word=>host.ctDictionaryMatchedDefinitions.get(String(word._id))?.has(String(word.find || '').trim().toLowerCase()) || false,
                    isDictionaryAltFindMatched:(word,alt)=>host.ctDictionaryMatchedDefinitions.get(String(word._id))?.has(String(alt.find || '').trim().toLowerCase()) || false,
                    isDictionaryPopupSelected:(word,alt)=>{
                        const completion=host.ctCompletion,item=completion?.items?.[completion.selectedIndex],field=host.ctCurrentUnit?.fields.find(field=>field.id===completion?.fieldId);
                        return current() && host.ctCompletionValid(field) && String(item?.dictEntryId || '')===String(word._id)
                            && String(item?.dictAltId || '')===String(alt?._id || '');
                    },
                    dictionaryEntryScope:word=>host.dictionaryEntryScope?.(word) || root.DictionaryScope?.normalize(word) || 'all',
                    dictionaryEntryScopeWarning:word=>host.dictionaryEntryScopeWarning?.(word) || '',
                    dictionaryEntryInput:word=>{if(member(word))host.dictionaryEntryInput?.(word);},
                    setDictionaryEntryScope:(word,scope)=>{if(member(word)){host.ctDictionaryBeginEdit(word._id);host.setDictionaryEntryScope?.(word,scope);}},
                    addDictionaryAltRow:word=>{if(member(word)){host.ctDictionaryBeginEdit(word._id);host.addDictionaryAltRow?.(word);}},
                    removeDictionaryAltRow:(word,alt)=>member(word) && host.removeDictionaryAltRow?.(word,alt,{isCurrent:()=>member(word)}),
                    removeVocab:word=>member(word) && host.removeVocab?.(word,{isCurrent:()=>member(word)}),
                    cloudOpenHistory:id=>{if(current() && host.cloudEntryHistoryAvailable && dictionary.some(word=>String(word._id)===String(id)))return host.cloudOpenHistory?.(id);},
                    useDictionaryTranslation:useTranslation,
                    dictionaryEntryFocusIn:event=>{if(current())host.ctDictionaryFocusIn(event);},
                    dictionaryEntryFocusOut:event=>{if(current())host.ctDictionaryFocusOut(event,ctx,unitId,dictionary);},
                    onDictionaryReplaceEnter:(event,word,alt)=>{
                        const info=host._ctDictionaryReturn;
                        if(info && String(info.dictId)===String(word?._id) && String(info.altId || '')===String(alt?._id || ''))return current() && host.ctDictionaryReturnEnter(event,word,alt);
                        if(event.ctrlKey || event.metaKey){
                            if(event.isComposing || event.keyCode===229)return false;
                            host._ctDictionaryReturn=null;return useTranslation(word,alt,event);
                        }
                    },
                };
            },
        },
        watch: {
            ctVersionWorkbookDropEnabled(enabled) { if(!enabled)this.ctWorkbookDragDepth=0; },
            ctDictionaryFilter() {this.ctDictionaryPage=1;},
            ctDictionaryPageCount(value) {this.ctDictionaryPage=Math.min(this.ctDictionaryPage,value);},
            ctDictionaryScopeKey() {this.ctDictionaryEndEdit();this.ctDictionaryPage=1;},
            ctPreviewKeys: {flush:'sync',handler(keys) {
                const next={};for(const key of keys)next[key]=this.ctPreviewGggVars[key] ?? this.defaultPreviewVarValue(key);
                this.ctPreviewGggVars=next;
            }},
            ctSearch() { clearTimeout(this._ctSearchTimer); if(!this._ctBrowseRestoring && this.ctSearch!==this.ctAppliedSearch)this._ctSearchTimer = setTimeout(() => { this.ctAppliedSearch = this.ctSearch; this.ctPage = 1; }, 250); },
            ctFilter() { if(!this._ctBrowseRestoring)this.ctPage = 1; }, ctSheet() { if(!this._ctBrowseRestoring)this.ctPage = 1; },
            ctSelectedFilters: {deep:true,handler() {if(!this._ctBrowseRestoring)this.ctPage=1;}},
            ctConvoFilter() {this._ctConvoFocusRun=null;},
            inlineEditor() { this.ctFlushDraft().catch(()=>{});this.$nextTick?.(()=>this.ctRefreshLayout()); },
            ctFiltersVisible() { this.$nextTick?.(()=>this.ctRefreshLayout()); },
            ctPageCount(value) { this.ctPage = Math.min(this.ctPage, value); },
            ctScanResultPageCount(value) {this.ctScanResultsPage=Math.min(this.ctScanResultsPage,value);},
            ctScanScopeKey() {this.ctCloseScanDialog(false);this.ctClearScanResults();},
            editorDictionaryRevision() {if(this.ctActive)this.ctClearScanResults();},
            hideDNT: {flush:'sync',handler() {
                if(!this.ctActive)return;
                this.ctRebuildSheets();this.ctClearScanResults();this.ctPage=1;
                // Keep the entire draft and selection, including an all-DNT
                // record. Navigation still checkpoints it before switching.
                // Fence callbacks which were targeting a now-hidden field.
                this._ctFieldFocusRun=null;this._ctDictionaryFocusRun=null;this._ctInlineReturn=null;
                this.ctCloseCompletion();this.ctInitializeVariants();
                const displayed=this.ctDisplayedFields();
                if(!displayed.some(field=>field.id===this.ctFocusedField))
                    this.ctFocusedField=this.ctTabFields().find(field=>displayed.includes(field))?.id || '';
                this.scheduleClientTextDictionaryMatches();
                this.$nextTick?.(()=>this.ctRefreshLayout());
            }},
            managedCatalogScope() { this.ctFence(); this.ctRefreshLocal(); },
            lang() { if (this.ctActive && (this.ctOfflineTest || this.ctWorkspace?.scope.language !== this.lang)) this.ctFence(); },
            gameVersion() { if (this.ctActive && this.ctWorkspace?.scope.game !== this.gameVersion) this.ctFence(); },
            versionChooserVisible(value) {
                if(value)this.ctRefreshLocal();
                else if(this.ctActive)this.$nextTick?.(()=>{if(this.ctActive && !this.versionChooserVisible)this.ctRefreshLayout();});
            }
        },
        mounted() {
            this._ctStore = root.ClientTextStore.create(); this._ctLocalStore = root.ClientTextLocalStore.create(); this._ctWorker = root.ClientTextWorkerClient.create();
            this._ctLocalVisibility = () => { if(root.document.hidden && this.ctOfflineTest)this.ctFlushDraft().catch(()=>{}); };
            this._ctLocalUnload = event => {if(this.ctLocalEmergencyDrafts.length || this.ctOfflineTest && (this.ctLocalDraftState==='pending' || this.ctDraftBlocked)){event.preventDefault();event.returnValue='';}};
            root.document.addEventListener('visibilitychange',this._ctLocalVisibility);root.addEventListener('beforeunload',this._ctLocalUnload);
        },
        beforeUnmount() { root.document.removeEventListener('visibilitychange',this._ctLocalVisibility);root.removeEventListener('beforeunload',this._ctLocalUnload);this.ctFence(); this._ctWorker?.dispose(); clearTimeout(this._ctSearchTimer); },
        methods: {
            ...exportProgress?.mixin.methods,
            ctFieldController(field) {return root.EditorSession.fieldController(this,field);},
            ctSourceFieldController(group,source) {
                const displayed=this.ctDisplayedFields(),field=group.fields.find(field=>field.id===this.ctFocusedField && field.source===source.text && displayed.includes(field))
                    || group.fields.find(field=>field.id===source.key) || group.fields[0];
                const controller=root.EditorSession.fieldController(this,field,source.text),focus=controller.focus;
                controller.focus=event=>{this.ctFocusSource(group,source);focus(event);};return controller;
            },
            async scheduleClientTextDictionaryMatches() {
                if(!this.ctActive || !this.ctWorkspace || !this.ensureDictionaryWorker)return;
                const ctx=this.ctContext(),unit=this.ctCurrentUnit,run=this._ctDictionaryRun={},fields=this.ctFieldsFor().filter(field=>field.kind!=='gender');
                this._ctDictionaryRequest?.cancel?.();
                const current=()=>this._ctDictionaryRun===run && this.ctCurrent(ctx) && this.ctCurrentUnit===unit;
                try {
                    await this.ensureDictionarySnapshot();if(!current())return;
                    const request=this._ctDictionaryRequest=this.ensureDictionaryWorker().match(fields.map(field=>({key:field.id,english:field.source,tokens:root.ClientTextState.tokenize(field.source)})),
                        {contentMode:'clienttext',highlightDict:!!this.highlightDict});
                    const pack=await request;if(!current())return;
                    if(this.ctCompletion)this._ctPendingDictionaryPack=raw(pack);else this.ctDictionaryPack=raw(pack);
                } catch(error) {if(current() && error.name!=='AbortError')this.ctError='Could not prepare Dictionary matches: '+error.message;}
            },
            async ctRefreshDraftSummaries(ctx=this.ctContext()) {
                if(!this.ctCurrent(ctx) || !this.ctWorkspace)return;
                try {const summaries=await this.ctStorage(ctx.scope).getDraftSummaries?.(ctx.scope);if(this.ctCurrent(ctx))this.ctDraftSummaries=raw(summaries || []);}
                catch(error){if(this.ctCurrent(ctx))this.ctError='Could not load local drafts: '+error.message;}
            },
            ctOpenHighlightDictionary(field,range) {
                if(!this.ctDictionaryReady || !this.ctCurrentUnit?.fields.includes(field))return false;
                this._ctDictionaryReturn=null;
                if(range.kind==='keyword' && this.ensureDictionaryKeywordTag){
                    const token=/^\[([^\]|]+)(?:\|([^\]]*))?\]$/.exec(range.value);
                    const dynamic=token?.[2] || '';
                    return this.ensureDictionaryKeywordTag(range.identity,dynamic.includes('<') ? '' : dynamic, '',this.ctDictionaryPresentation());
                }
                const word=(this.dictionary || []).find(word=>String(word._id)===String(range.dictId) && (!this.isDictionaryEntryActive || this.isDictionaryEntryActive(word)));
                if(!word)return false;this.ctTool='dictionary';this.ctDictionaryFilter='';
                this.ctFocusDictionaryReplace(word._id);return true;
            },
            ctDictionaryPresentation(returnInfo=null) {
                const host=this;
                return {
                    set sideTab(value){host.ctTool=value;},set dictionaryFilter(value){host.ctDictionaryFilter=value;},
                    beginDictionaryEdit:(id,options)=>host.ctDictionaryBeginEdit(id,options),
                    syncEditorHlterWithDictionaryNow:id=>{
                        const word=(host.dictionary || []).find(word=>String(word._id)===String(id));if(word)host.dictionaryEntryInput?.(word);
                        host.scheduleClientTextDictionaryMatches();
                    },
                    focusDictionaryEntryReplaceInput:(id,options={})=>{
                        if(returnInfo){returnInfo.dictId=id;returnInfo.altId=options.altId || '';}
                        host.ctFocusDictionaryReplace(id,options);
                    },
                };
            },
            ctRevealDictionaryEntry(id) {
                const index=this.ctDictionaryFiltered.findIndex(word=>String(word._id)===String(id));
                if(index<0)return false;this.ctDictionaryPage=Math.floor(index/this.ctDictionaryPageSize)+1;return true;
            },
            ctFocusDictionaryReplace(id,options={}) {
                if(!this.ctDictionaryReady)return;
                this.ctDictionaryBeginEdit(id);if(!this.ctRevealDictionaryEntry(id))return;
                const ctx=this.ctContext(),unit=this.ctCurrentUnit,dictionary=this.dictionary,focusedField=this.ctFocusedField,returnInfo=this._ctDictionaryReturn,run=this._ctDictionaryFocusRun={};
                const word=dictionary.find(word=>String(word._id)===String(id)),alt=options.altId ? word?.alts?.find(alt=>String(alt._id)===String(options.altId)) : null;
                const entryScope=this.dictionaryEntryScope?.(word),disabled=!!word?.disabled;
                this.$nextTick?.(()=>{
                    if(this._ctDictionaryFocusRun!==run || !this.ctDictionaryContextCurrent(ctx,unit.id,dictionary) || this.ctCurrentUnit!==unit || !this.ctDictionaryReady || this.ctTool!=='dictionary')return;
                    if(this.ctFocusedField!==focusedField || !word || !dictionary.includes(word) || this.dictionaryEntryScope?.(word)!==entryScope || !!word.disabled!==disabled
                        || options.altId && (!alt || !word.alts?.includes(alt)) || returnInfo && (this._ctDictionaryReturn!==returnInfo || !this.ctDictionaryReturnCurrent(returnInfo)))return;
                    const rows=root.document?.querySelectorAll?.('.ctTools .dictRow[data-dict-id],.ctTools .dictAltRow[data-dict-id]') || [];
                    const row=[...rows].find(row=>row.getAttribute('data-dict-id')===String(id) && String(row.getAttribute('data-dict-alt-id') || '')===String(options.altId || ''));
                    const input=row?.querySelector?.('input[placeholder="Replace"],textarea[placeholder="Replace"]');
                    this.scrollDictionaryEntryIntoView?.(row);input?.focus();input?.select?.();
                });
            },
            ctCompletionEnter(field,item,input) {
                return item?.mustCreate ? this.ctEditCompletionDictionary(field,item,input) : this.ctApplyCompletion(field,item,input);
            },
            ctEditCompletionDictionary(field,item,input=this._ctCompletionInput) {
                const completion=this.ctCompletion;
                if(!this.ctCompletionValid(field,input) || !completion.items.includes(item)){this.ctCloseCompletion();return false;}
                if(!item.kwTagName || !this.ctDictionaryReady){this.ctCloseCompletion();return false;}
                const dictionary=this.dictionary,word=dictionary.find(word=>String(word._id)===String(item.dictEntryId));
                if(item.dictEntryId && (!word || this.isDictionaryEntryActive && !this.isDictionaryEntryActive(word))
                    || item.dictAltId && !word?.alts?.some(alt=>String(alt._id)===String(item.dictAltId))){this.ctCloseCompletion();return false;}
                const info={...completion,field,unit:this.ctCurrentUnit,input,dictionary,kwTagName:item.kwTagName,dictId:'',altId:''};
                const selected=completion.text.slice(root.EditorSession.rawOffset(completion.text,completion.selectionStart),root.EditorSession.rawOffset(completion.text,completion.selectionEnd));
                this.ctCloseCompletion();this._ctDictionaryReturn=info;
                const create=item.mustCreate || (this.canCreateDictionaryEntryFromHlPopupItem?.(item) ?? (item.kwDynamicContent && !this.ctDictionaryPairs(word || {}).some(pair=>String(pair.find).trim().toLowerCase()===item.kwDynamicContent.trim().toLowerCase())));
                if(create){
                    const result=this.ensureDictionaryKeywordTag?.(item.kwTagName,item.kwDynamicContent || '',selected,this.ctDictionaryPresentation(info));
                    if(!result?.dictId){this._ctDictionaryReturn=null;return false;}return true;
                }
                info.dictId=word._id;info.altId=item.dictAltId || '';
                if(selected){const pair=info.altId ? word.alts.find(alt=>String(alt._id)===String(info.altId)) : word;pair.replace=selected;this.dictionaryEntryInput?.(word);}
                this.ctTool='dictionary';this.ctDictionaryFilter='';this.ctFocusDictionaryReplace(word._id,{altId:info.altId});return true;
            },
            ctDictionaryReturnCurrent(info) {
                const input=info?.input,field=info?.field;
                return !!(info && this.ctDictionaryReady && this.ctDictionaryContextCurrent(info.context,info.unitId,info.dictionary) && this.ctCurrentUnit===info.unit
                    && this.ctCurrentUnit.fields.includes(field) && field.source===info.source && this.ctFocusedField===field.id && this.ctValues[field.id]===info.text
                    && input && input.isConnected!==false && !input.composing && !input.readOnly && (!input.dataset?.ctTarget || input.dataset.ctTarget===field.id)
                    && input.value===info.text.replace(/\r\n?/g,'\n') && input.selectionStart===info.selectionStart && input.selectionEnd===info.selectionEnd);
            },
            ctDictionaryReturnEnter(event,word,alt) {
                if(event.isComposing || event.keyCode===229)return false;
                const info=this._ctDictionaryReturn,input=info?.input,field=info?.field;
                if(!info || String(info.dictId)!==String(word?._id) || String(info.altId || '')!==String(alt?._id || ''))return false;
                this._ctDictionaryReturn=null;
                if(!this.ctDictionaryReturnCurrent(info) || !info.dictionary.includes(word) || this.isDictionaryEntryActive && !this.isDictionaryEntryActive(word) || alt && !word.alts?.includes(alt))return false;
                const replacement=event.target?.value;
                if(typeof replacement!=='string')return false;
                event.preventDefault();event.stopPropagation?.();
                return root.EditorSession.insert(this,field,'['+info.kwTagName+'|'+replacement+']',{input,start:info.start,end:info.end,raw:true});
            },
            ctSyncCompletionSelection() {
                const completion=this.ctCompletion,item=completion?.items?.[completion.selectedIndex],unit=this.ctCurrentUnit,field=unit?.fields.find(field=>field.id===completion?.fieldId);
                if(!this.ctCompletionValid(field))return;
                if(this.ctTool==='dictionary' && item?.dictEntryId)this.ctRevealDictionaryEntry(item.dictEntryId);
                this.$nextTick?.(()=>{
                    if(this.ctCompletion!==completion || this.ctCurrentUnit!==unit || completion.items[completion.selectedIndex]!==item || !this.ctCompletionValid(field))return;
                    this.scrollHlPopupSelectionIntoView?.();
                    if(this.ctTool==='dictionary')this.scrollDictionaryEntryIntoView?.(this.getHlPopupDictionaryRow?.(item));
                });
            },
            clientTextPopupController() {
                if(this._clientTextPopupController)return this._clientTextPopupController;
                const host=this,base=root.EditorSession.create(this),names=['hlPopup','hlPopupTlnote','closeHlPopup','applyHlPopupFilter','hlPopupFilterKeydown','insertHlPopupItem','hlPopupCtrlEnterPillText'];
                const field=()=>host.ctCurrentUnit?.fields.find(field=>field.id===host.ctCompletion?.fieldId);
                const popup=()=>{
                    const completion=host.ctCompletion,rect=host._ctCompletionInput?.getBoundingClientRect?.() || {left:0,bottom:0,width:320};
                    return {get visible(){return !!host.ctCompletion;},x:Math.min(rect.left,Math.max(0,(root.innerWidth || 1280)-Math.max(320,rect.width))),
                        y:Math.min(rect.bottom,(root.innerHeight || 900)-220),width:Math.max(320,Math.min(rect.width,520)),maxHeight:220,
                        noteX:Math.max(0,rect.left-300),noteY:rect.bottom,noteWidth:280,noteMaxHeight:220,
                        get filter(){return host.ctCompletion?.filter || '';},set filter(value){if(host.ctCompletion)host.ctCompletion.filter=value;},
                        get items(){return host.ctCompletion?.allItems || host.ctCompletion?.items || [];},get filtered(){return host.ctCompletion?.items || [];},
                        get selectedIndex(){return host.ctCompletion?.selectedIndex || 0;},set selectedIndex(value){if(host.ctCompletion){host.ctCompletion.selectedIndex=value;host.ctSyncCompletionSelection();}}};
                };
                const actions={
                    closeHlPopup:options=>{const input=host._ctCompletionInput;host.ctCloseCompletion();if(options?.refocus)input?.focus?.();},
                    applyHlPopupFilter:()=>{const completion=host.ctCompletion;if(!completion)return;const query=(completion.filter || '').toLowerCase();
                        completion.items=(completion.allItems || completion.items).filter(item=>!query || (item.label+' '+item.value).toLowerCase().includes(query));completion.selectedIndex=0;host.ctSyncCompletionSelection();},
                    insertHlPopupItem:item=>field() && host.ctApplyCompletion(field(),item),
                    hlPopupFilterKeydown:event=>{
                        if(event.isComposing || event.keyCode===229)return;
                        if(event.key==='Escape'){event.preventDefault();event.stopPropagation?.();actions.closeHlPopup({refocus:true});return;}
                        const completion=host.ctCompletion;if(!completion)return;
                        if(['ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();const count=completion.items.length;if(count)completion.selectedIndex=(completion.selectedIndex+(event.key==='ArrowDown'?1:-1)+count)%count;host.ctSyncCompletionSelection();}
                        else if(event.key==='Enter'){event.preventDefault();const item=completion.items[completion.selectedIndex];
                            if(event.ctrlKey)host.ctEditCompletionDictionary(field(),item);
                            else if(item)host.ctCompletionEnter(field(),item);}
                    },hlPopupCtrlEnterPillText:item=>host.hlPopupCtrlEnterPillText?.(item) ?? (!item?.kwTagName ? '' : item.mustCreate ? item.dictEntryId?'Ctrl+Enter Add alt':'Ctrl+Enter Add':'Ctrl+Enter Edit'),
                };
                this._clientTextPopupController=new Proxy(base,{get(target,name){if(name==='hlPopup')return popup();if(name==='hlPopupTlnote')return host.ctCompletion?.items[host.ctCompletion.selectedIndex]?.tlnote || '';
                    return name in actions ? actions[name]:target[name];},ownKeys:()=>[...new Set([...Reflect.ownKeys(base),...names])],getOwnPropertyDescriptor:()=>({enumerable:true,configurable:true})});
                return this._clientTextPopupController;
            },
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
                if(!field || field.kind==='gender' || this.ctMtlBusy?.(field) || !input || input.isConnected===false || typeof replacement!=='string')return false;
                if(root.EditorSession)return root.EditorSession.insert(this,field,replacement,{input});
                const text=(this.ctInputValues || this.ctValues)[field.id],start=input.selectionStart,end=input.selectionEnd;
                if(typeof text!=='string' || input.value!==text || !Number.isInteger(start) || !Number.isInteger(end) || start<0 || end<start || end>text.length)return false;
                const next=text.slice(0,start)+replacement+text.slice(end);(this.ctInputValues || this.ctValues)[field.id]=next;this.ctCloseCompletion();this.ctEdited(field);
                this.$nextTick?.(()=>{
                    if(!this.ctDictionaryContextCurrent(ctx,unitId,dictionary) || this.ctFocusedField!==field.id || (this.ctInputValues || this.ctValues)[field.id]!==next || input.isConnected===false)return;
                    input.focus();input.setSelectionRange?.(start+replacement.length,start+replacement.length);this.ctResizeField(input);
                });return true;
            },
            ctNpcKindName(kind) {return {names:'Names',topics:'Menu topics',dialogue:'Dialogue',conversations:'Conversations'}[kind] || '';},
            ctNpcKindLabel(unit) {return {names:'Name',topics:'Menu topic',dialogue:'Dialogue',conversations:'Conversation turn'}[root.ClientTextNpcIndex?.kindFor(unit)] || '';},
            ctNpcCandidates() {
                const index=this._ctNpcIndex;
                if(!index)return [];
                return this.ctNpcSelection==='all' ? index.units : this.ctNpcSelection==='unassigned' ? index.unassigned
                    : index.groupByKey.get(this.ctNpcSelection)?.units || [];
            },
            ctBrowseOrderedUnits() {
                const ordered=this.ctOrderedUnits();if(this.ctBrowseMode==='sheets')return ordered;
                const convo=this.ctBrowseMode==='convo',candidates=convo?this.ctConvoCandidates():this.ctNpcCandidates(),
                    index=convo?this._ctConvoIndex:this._ctNpcIndex,kind=convo?'':this.ctNpcKind;
                let cache=this._ctBrowseCandidateCache;
                if(!cache || cache.index!==index || cache.candidates!==candidates || cache.kind!==kind){
                    const ids=new Set(candidates.filter(unit=>!kind || root.ClientTextNpcIndex?.kindFor(unit)===kind).map(unit=>unit.id));
                    cache=this._ctBrowseCandidateCache={index,candidates,kind,ids};
                }
                return ordered.filter(unit=>cache.ids.has(unit.id));
            },
            ctRowPortraits(unit) {
                const npc=this._ctNpcIndex,convo=this._ctConvoIndex,game=this.ctWorkspace?.scope.game || this.gameVersion;
                let cache=this._ctPortraitResolver;
                if(!cache || cache.npc!==npc || cache.convo!==convo || cache.game!==game)
                    cache=this._ctPortraitResolver={npc,convo,game,resolve:root.ClientTextPortraits?.createResolver({npcIndex:npc,convoIndex:convo,game}),rows:new WeakMap()};
                if(!cache.resolve || !unit)return [];
                if(!cache.rows.has(unit))cache.rows.set(unit,cache.resolve(unit));
                return cache.rows.get(unit);
            },
            ctNpcRelation(unit) {
                const memberships=this._ctNpcIndex?.memberships.get(unit?.id),evidence=this._ctNpcIndex?.referenceEvidence?.get(unit?.id),
                    details=evidence?[evidence.unresolved.length?`Unresolved NPC references: ${evidence.unresolved.join(', ')}`:'',
                        evidence.ambiguous.length?`Ambiguous NPC references: ${evidence.ambiguous.join(', ')}`:''].filter(Boolean):[];
                if(!memberships?.size)return {label:'Unassigned',tooltip:evidence
                    ? [evidence.references.length?'No unique NPC reference could be resolved from the active workbooks.':'The workbook NPC reference is blank.',...details].join('\n')
                    : 'No NPC relationship was found in the workbook paths or text IDs.'};
                const matching=this.ctNpcSelection==='all' ? [...memberships.entries()] : [...memberships.entries()].filter(([key])=>key===this.ctNpcSelection),
                    selected=matching.length?matching:[...memberships.entries()];
                const inferred=selected.some(([,relation])=>relation.aliases?.length),labels=selected.map(([key])=>this._ctNpcIndex.groupByKey.get(key)?.label || key),
                    references=[...new Set(selected.flatMap(([,relation])=>relation.references || []))];
                if(references.length)return {label:'NPC reference',tooltip:[`Linked to ${labels.join(', ')} by NPC reference: ${references.join(', ')}.`,...details].join('\n')};
                return {label:inferred?'ID match':'Exact link',tooltip:inferred
                    ? `Related to ${labels.join(', ')} by text ID: ${[...new Set(selected.flatMap(([,relation])=>relation.aliases || []))].join(', ')}. This does not identify the speaker or conversation order.`
                    : `Linked to ${labels.join(', ')} by an exact NPC record or menu-topic path. This does not identify the dialogue speaker.`};
            },
            ctNpcSeverityLabel(group) {return {error:'Missing or Error in related text',warning:'Outdated or Warning in related text'}[this.ctNpcSeverities.get(group.key)] || '';},
            ctNpcGroupTooltip(group) {return [group.label,this.ctNpcSeverityLabel(group),`${group.units.length.toLocaleString('en-US')} related records`,...group.paths].filter(Boolean).join('\n');},
            ctSheetSeverityLabel(sheet) {return {error:'Missing or Error in this sheet',warning:'Outdated or Warning in this sheet',
                revised:'Revised translation in this sheet',reviewed:'Reviewed source in this sheet',filled:'Completed Missing translation in this sheet'}[this.ctSheetSeverities.get(sheet.key)] || '';},
            ctSheetTooltip(sheet) {return [sheet.name,(sheet.role==='gender'?'Gender':'Normal')+' workbook',this.ctSheetSeverityLabel(sheet)].filter(Boolean).join('\n');},
            ctConvoNodeKey(type,key) {return JSON.stringify([type,key]);},
            ctConvoSelectedNode() {
                if(this.ctConvoSelection==='all' || !this._ctConvoIndex)return null;
                try {const [type,key]=JSON.parse(this.ctConvoSelection),node=(type==='parent'?this._ctConvoIndex.parentByKey:type==='family'?this._ctConvoIndex.familyByKey:null)?.get(key);
                    return node?{type,node}:null;}catch(_error){return null;}
            },
            ctConvoCandidates() {
                if(!this._ctConvoIndex)return [];
                return this.ctConvoSelection==='all'?this._ctConvoIndex.units:this.ctConvoSelectedNode()?.node.units || [];
            },
            ctConvoSeverityLabel(node) {return {error:'Missing or Error in related text',warning:'Outdated or Warning in related text'}[
                this.ctConvoSeverities.get(this.ctConvoNodeKey(node.stem===undefined?'parent':'family',node.key))] || '';},
            ctConvoTooltip(node) {return [node.label,this.ctConvoSeverityLabel(node),node.stem?`ID stem: ${node.stem}`:'',
                node.npcEvidence?`Family NPCs: ${node.npcEvidence.participants.map(participant=>participant.label).join(', ') || 'None resolved'}`:'',
                `${node.units.length.toLocaleString('en-US')} related records`,...(node.paths || [])].filter(Boolean).join('\n');},
            ctConvoRelation(unit) {
                const relation=this._ctConvoIndex?.memberships.get(unit?.id);if(!relation)return {label:'',tooltip:''};
                const mapped=relation.parentKey!=='unassigned',evidence=relation.npcEvidence;
                if(evidence){
                    const reason={npc:'The family references one NPC.', 'npc-anchor':'The ID anchor uniquely matches one of the NPCs referenced by this family.',
                        'multiple-npcs':'The family references several NPCs without a unique participating ID anchor.',
                        'no-npc':'The family has no explicit NPC references.',
                        'unresolved-references':'Some family NPC references could not be resolved uniquely across the active workbooks.'}[evidence.reason];
                    return {label:mapped?(evidence.reason==='npc-anchor'?'NPC + ID match':'NPC reference'):'ID family',tooltip:[
                        `Parent: ${this._ctConvoIndex.parentByKey.get(relation.parentKey)?.label || 'Unassigned NPC'}`,reason,
                        `Family NPCs: ${evidence.participants.map(participant=>participant.label).join(', ') || 'None resolved'}`,
                        evidence.references.length?`NPC references: ${evidence.references.join(', ')}`:'',
                        evidence.reason==='npc-anchor'?`Matched NPC aliases: ${relation.aliases.join(', ')}`:'',
                        `ID anchor: ${relation.anchor}`,`ID stem: ${relation.familyKey}`,
                        evidence.unresolved.length?`Unresolved NPC references: ${evidence.unresolved.join(', ')}`:'',
                        evidence.ambiguous.length?`Ambiguous NPC references: ${evidence.ambiguous.join(', ')}`:'',
                        'The parent applies to the complete family, including other NPC and player turns. It does not establish playback order.'
                    ].filter(Boolean).join('\n')};
                }
                return {label:mapped?'ID match':'ID family',tooltip:[`ID anchor: ${relation.anchor}`,`ID stem: ${relation.familyKey}`,
                    mapped?`Matched NPC aliases: ${(relation.aliases || []).join(', ')}`:relation.ambiguous?'Several NPC aliases match this anchor.':'No unique NPC alias matches this anchor.',
                    'Related records are grouped by their text IDs. The anchor does not identify the speaker or conversation order.'].join('\n')};
            },
            ctSetConvo(type,key) {
                if(type!=='all' && !(type==='parent'?this._ctConvoIndex?.parentByKey:type==='family'?this._ctConvoIndex?.familyByKey:null)?.has(key))return Promise.resolve(false);
                return this.ctChangeBrowse(()=>{this.ctConvoSelection=type==='all'?'all':this.ctConvoNodeKey(type,key);this.ctPage=1;return this.ctCaptureBrowseScroll(true);});
            },
            ctConvoToggle(parentKey) {
                if(this.ctBrowseBusy || this.ctBusy || this.ctEditor || this.ctConvoFilter.trim() || this.ctKeyboardOverlayOpen() || !this._ctConvoIndex?.parentByKey.has(parentKey))return false;
                this.ctConvoExpanded=this.ctConvoExpanded.includes(parentKey)?this.ctConvoExpanded.filter(key=>key!==parentKey):[...this.ctConvoExpanded,parentKey];
                const parent=this.ctConvoTree.find(row=>row.type==='parent' && row.node.key===parentKey);if(parent)this.ctConvoFocus(parent);
                return true;
            },
            ctConvoFocus(row) {
                if(!row || !this.ctActive || this.ctEditor || this.ctBrowseMode!=='convo' || this.ctBrowseBusy || this.ctBusy || this.ctHistoryViewer || this.ctKeyboardOverlayOpen())return false;
                const ctx=this.ctContext(),generation=this._ctBrowseGeneration || 0,selection=this._ctSelectRun,run=this._ctConvoFocusRun={},active=root.document?.activeElement;
                this.ctConvoFocusKey=row.key;
                const focus=()=>{if(this._ctConvoFocusRun!==run || !this.ctCurrent(ctx) || generation!==(this._ctBrowseGeneration || 0)
                    || this._ctSelectRun!==selection || !this.ctActive || this.ctEditor || this.ctBrowseMode!=='convo' || this.ctBrowseBusy || this.ctBusy || this.ctHistoryViewer
                    || this.ctKeyboardOverlayOpen() || !this.ctConvoTree.some(candidate=>candidate.key===row.key))return false;
                    const element=[...(this.$refs?.ctConvoTree?.querySelectorAll?.('[data-convo-key]') || [])].find(element=>element.dataset.convoKey===row.key);
                    if(!element || element.isConnected===false)return false;element.focus?.({preventScroll:true});element.scrollIntoView?.({block:'nearest'});return true;};
                if(focus())return true;
                this.$nextTick?.(()=>{const next=root.document?.activeElement;
                    if(next && next!==active && next!==root.document?.body && next!==root.document?.documentElement)return;
                    focus();});return true;
            },
            ctConvoTreeKeydown(event) {
                if(event.defaultPrevented || event.isComposing || event.keyCode===229 || event.altKey || event.ctrlKey || event.metaKey || this.ctBrowseBusy || this.ctBusy
                    || !this.ctActive || this.ctEditor || this.ctHistoryViewer || this.ctKeyboardOverlayOpen() || this.ctBrowseMode!=='convo')return false;
                const rows=this.ctConvoTree,target=event.target?.closest?.('[data-convo-key]'),index=rows.findIndex(row=>row.key===(target?.dataset.convoKey || this.ctConvoFocusKey)),
                    row=rows[index<0?rows.findIndex(row=>row.focused):index];if(!row)return false;
                let next=null;
                if(event.key==='Enter' || event.key===' '){if(event.target?.closest?.('button'))return false;event.preventDefault();return this.ctSetConvo(row.type,row.node.key);}
                if(event.key==='ArrowDown')next=rows[Math.min(rows.length-1,rows.indexOf(row)+1)];
                else if(event.key==='ArrowUp')next=rows[Math.max(0,rows.indexOf(row)-1)];
                else if(event.key==='Home')next=rows[0];else if(event.key==='End')next=rows[rows.length-1];
                else if(event.key==='ArrowRight'){
                    if(row.type==='parent' && row.node.families.length){if(!row.expanded)this.ctConvoToggle(row.node.key);else next=rows[rows.indexOf(row)+1];}
                } else if(event.key==='ArrowLeft'){
                    if(row.type==='parent' && row.expanded){if(!this.ctConvoFilter.trim())this.ctConvoToggle(row.node.key);}
                    else if(row.type==='family')next=rows.find(candidate=>candidate.type==='parent' && candidate.node.key===row.node.parentKey);
                } else if(event.key.length===1 && event.key.trim()){
                    const now=Date.now(),previous=this._ctConvoTypeAhead,character=event.key.toLocaleLowerCase(),text=previous && now-previous.time<700?previous.text+character:character;
                    this._ctConvoTypeAhead={text,time:now};const start=rows.indexOf(row),find=needle=>Array.from({length:rows.length},(_,offset)=>rows[(start+offset+1)%rows.length])
                        .find(candidate=>candidate.node.label.toLocaleLowerCase().startsWith(needle));
                    next=find(text) || find(character);
                }else return false;
                event.preventDefault();if(next)this.ctConvoFocus(next);return true;
            },
            ctBrowseSnapshot() {
                return Object.fromEntries(['ctSheet','ctSheetFilter','ctSearch','ctAppliedSearch','ctFilter','ctSelectedFilters','ctSort','ctSortDir','ctPage',
                    'ctNpcSelection','ctNpcKind','ctNpcFilter','ctConvoSelection','ctConvoFilter','ctConvoExpanded','ctConvoFocusKey']
                    .map(key=>[key,['ctSelectedFilters','ctConvoExpanded'].includes(key)?this[key].slice():this[key]]));
            },
            ctCaptureBrowseScroll(resetTop=false) {
                const region=this.$refs?.ctFileTableRegion,scroll={top:resetTop?0:Number(region?.scrollTop) || 0,left:Number(region?.scrollLeft) || 0};
                const navigation=this.ctBrowseNavigation();if(navigation)scroll.navigation={top:Number(navigation.scrollTop) || 0,left:Number(navigation.scrollLeft) || 0};
                // The table has horizontal overflow without a fixed height;
                // ordinary vertical scrolling belongs to the page.
                if(!(region?.scrollHeight>region?.clientHeight+1))scroll.windowTop=resetTop?0:Number(root.scrollY) || 0;
                return scroll;
            },
            ctBrowseViewSnapshot() {return {state:this.ctBrowseSnapshot(),scroll:this.ctCaptureBrowseScroll()};},
            ctBrowseNavigation() {return this.$refs?.[{sheets:'ctSheetList',npcs:'ctNpcList',convo:'ctConvoList'}[this.ctBrowseMode]];},
            ctRestoreBrowseScroll(scroll) {
                if(!scroll)return;
                const region=this.$refs?.ctFileTableRegion;
                if(region){region.scrollTop=scroll.top;region.scrollLeft=scroll.left;}
                const navigation=this.ctBrowseNavigation();if(navigation && scroll.navigation){navigation.scrollTop=scroll.navigation.top;navigation.scrollLeft=scroll.navigation.left;}
                if(Number.isFinite(scroll.windowTop))root.scrollTo?.(Number(root.scrollX) || 0,scroll.windowTop);
            },
            ctDefaultNpcView() {return {ctSearch:'',ctAppliedSearch:'',ctFilter:'',ctSelectedFilters:statusFilters.map(item=>item.key),ctSort:'row',ctSortDir:'asc',ctPage:1,
                ctNpcSelection:'all',ctNpcKind:'',ctNpcFilter:''};},
            ctDefaultConvoView() {return {ctSearch:'',ctAppliedSearch:'',ctFilter:'',ctSelectedFilters:statusFilters.map(item=>item.key),ctSort:'row',ctSortDir:'asc',ctPage:1,
                ctConvoSelection:'all',ctConvoFilter:'',ctConvoExpanded:[],ctConvoFocusKey:''};},
            async ctChangeBrowse(change) {
                if(this.ctBusy || this.ctBrowseBusy || !this.ctActive || this.ctKeyboardOverlayOpen() || this.ctHistoryViewer)return false;
                const ctx=this.ctContext(),generation=this._ctBrowseGeneration || 0,unit=this.ctCurrentUnit,selection=this._ctSelectRun,
                    run=this._ctBrowseTransitionRun={},current=()=>this._ctBrowseTransitionRun===run && this.ctCurrent(ctx)
                        && generation===(this._ctBrowseGeneration || 0) && this.ctCurrentUnit===unit && this._ctSelectRun===selection
                        && !this.ctKeyboardOverlayOpen() && !this.ctHistoryViewer;
                this.ctBrowseBusy=true;
                try {
                    if(!await this.ctFlushDraft() || !current())return false;
                    if(await this.ctFlushCommentDraft()===false || !current())return false;
                    clearTimeout(this._ctSearchTimer);this._ctBrowseRestoring=true;
                    const scroll=change();this._ctBrowseGeneration=generation+1;this.ctCloseCompletion();this._ctInlineReturn=null;
                    await this.$nextTick?.();
                    if(!this.ctCurrent(ctx) || this._ctBrowseTransitionRun!==run || (this._ctBrowseGeneration || 0)!==generation+1
                        || this.ctCurrentUnit!==unit || this._ctSelectRun!==selection || this.ctKeyboardOverlayOpen() || this.ctHistoryViewer)return false;
                    this.ctRefreshLayout();this.ctRestoreBrowseScroll(scroll);return true;
                } catch(error) {if(this.ctCurrent(ctx))this.ctError='Draft was not stored before changing navigation: '+error.message;return false;}
                finally {if(this._ctBrowseTransitionRun===run){
                    this._ctBrowseTransitionRun=null;this._ctBrowseRestoring=false;this.ctBrowseBusy=false;
                    if(this.ctCurrent(ctx) && this.ctSearch!==this.ctAppliedSearch){
                        const resumedGeneration=this._ctBrowseGeneration || 0;
                        this._ctSearchTimer=setTimeout(()=>{if(this.ctCurrent(ctx) && resumedGeneration===(this._ctBrowseGeneration || 0))this.ctApplySearch();},250);
                    }
                }}
            },
            ctSetBrowseMode(mode) {
                if(!['sheets','npcs','convo'].includes(mode))return Promise.resolve(false);
                if(mode===this.ctBrowseMode)return Promise.resolve(true);
                return this.ctChangeBrowse(()=>{
                    const views=this._ctBrowseViews ||= {};views[this.ctBrowseMode]=this.ctBrowseViewSnapshot();
                    const view=views[mode] || {state:mode==='npcs'?this.ctDefaultNpcView():mode==='convo'?this.ctDefaultConvoView():{},scroll:{top:0,left:0,windowTop:0,navigation:{top:0,left:0}}};
                    this.ctBrowseMode=mode;Object.assign(this,view.state);return view.scroll;
                });
            },
            ctSetSheet(key) {return this.ctChangeBrowse(()=>{this.ctSheet=key;this.ctPage=1;});},
            ctSetNpc(key) {
                if(!['all','unassigned'].includes(key) && !this._ctNpcIndex?.groupByKey.has(key))return Promise.resolve(false);
                return this.ctChangeBrowse(()=>{this.ctNpcSelection=key;this.ctPage=1;return this.ctCaptureBrowseScroll(true);});
            },
            ctSetNpcKind(kind) {
                if(!['','names','topics','dialogue','conversations'].includes(kind))return Promise.resolve(false);
                return this.ctChangeBrowse(()=>{this.ctNpcKind=kind;this.ctPage=1;});
            },
            ctBrowseTabKeydown(event) {
                if(event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || this.ctBrowseBusy || this.ctBusy)return false;
                if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return false;
                event.preventDefault();const tabs=[...(this.$refs?.ctBrowseTabs?.querySelectorAll?.('[role="tab"]') || [])];
                const index=tabs.indexOf(event.target),next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
                const tab=tabs[next];if(!tab)return false;
                tab.focus?.();return true;
            },
            ctOrderedUnits() {
                const key=this.ctSort,units=this.ctUnits,saved=key==='translation'?this.ctSaved:null;
                let cache=this._ctOrderCache;
                if(!cache || cache.units!==units || cache.key!==key || cache.saved!==saved || cache.hideDNT!==!!this.hideDNT){
                    const collator=this._ctCollator ||= new Intl.Collator(undefined,{numeric:true,sensitivity:'base'});
                    const ascending=units.slice().sort((a,b)=>(key==='row'
                        ? this.ctSortValue(a,key)-this.ctSortValue(b,key) || collator.compare(a.role,b.role) || collator.compare(a.sheet,b.sheet)
                        : collator.compare(this.ctSortValue(a,key),this.ctSortValue(b,key)))
                        || collator.compare(a.recordId,b.recordId) || a.id.localeCompare(b.id));
                    cache=this._ctOrderCache={units,key,saved,hideDNT:!!this.hideDNT,ascending,descending:null};
                }
                return this.ctSortDir==='desc'?(cache.descending ||= cache.ascending.slice().reverse()):cache.ascending;
            },
            ctSortValue(unit,key) {
                const cache=this._ctSortCache ||= new WeakMap(),saved=this.ctSaved[unit.id];let item=cache.get(unit);
                if(!item || item.hideDNT!==!!this.hideDNT){
                    // Use the immutable worksheet position, independent of filtering and pagination.
                    const cell=unit.fields[0]?.targetCell || unit.fields[0]?.sourceCell || '';
                    item={filename:String(unit.recordId),row:Number(/\d+$/.exec(cell)?.[0] || 0),hideDNT:!!this.hideDNT};cache.set(unit,item);
                }
                if(key==='english' && item.english===undefined)item.english=this.ctListText(unit,'source');
                if(key==='translation' && (item.saved!==saved || item.translation===undefined)){
                    item.saved=saved;item.translation=this.ctListText(unit,'target');
                }
                return item[key] ?? item.filename;
            },
            ctSortBy(key) {
                if(!['row','filename','english','translation'].includes(key) || this.ctBusy || this.ctBrowseBusy)return;
                this.ctSortDir=this.ctSort===key && this.ctSortDir==='asc'?'desc':'asc';this.ctSort=key;this.ctPage=1;
            },
            ctApplySearch() {clearTimeout(this._ctSearchTimer);this.ctAppliedSearch=this.ctSearch;this.ctPage=1;},
            ctToggleSearchCaseSensitive() {this.ctSearchCaseSensitive=!this.ctSearchCaseSensitive;this.ctPage=1;},
            ctSearchKeydown(event) {
                if(event?.currentTarget!==this.$refs?.ctSearchInput || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
                    || event.code!=='KeyC' || event.isComposing || event.keyCode===229)return false;
                event.preventDefault();event.stopPropagation?.();this.ctToggleSearchCaseSensitive();return true;
            },
            ctClearSearch() {this.ctSearch='';this.ctApplySearch();this.$refs?.ctSearchInput?.focus();},
            ctResetFilters() {this.ctFilter='';this.ctSelectedFilters=this.ctBrowseMode!=='sheets'?statusFilters.map(item=>item.key):defaultFilters();this.ctSearch='';this.ctApplySearch();},
            ctFilterByStatus(status,event) {
                const current=this.ctFilter ? [this.ctFilter] : this.ctSelectedFilters;
                this.ctFilter='';
                this.ctSelectedFilters=event?.ctrlKey ? [...new Set([...current,status])] : [status];
                this.ctPage=1;
            },
            ctShowAllLoaded() {
                return this.ctChangeBrowse(()=>{
                    const views=this._ctBrowseViews ||= {};views[this.ctBrowseMode]=this.ctBrowseViewSnapshot();this.ctBrowseMode='sheets';
                    this.ctFilter='';this.ctSheet='';this.ctSheetFilter='';this.ctSelectedFilters=[...statusFilters.map(item=>item.key),'mtl'];
                    this.ctSearch='';this.ctAppliedSearch='';this.ctPage=1;
                });
            },
            ctDiagnosticDialog() {return this.getEditorComponentRef?.('diagnosticScanDialog') || this.$refs?.ctDiagnosticDialog;},
            ctOpenScanDialog() {
                if(!this.ctActive || this.ctBusy)return false;
                const dialog=this.ctDiagnosticDialog();if(!dialog || dialog.open)return false;
                this.ctCloseCompletion();this.hideTooltip?.();this._ctScanReturnFocus=root.document?.activeElement;
                const scopeKey=this._ctScanReturnScope=this.ctScanScopeKey,unitId=this._ctScanReturnUnitId=this.ctSelection;
                dialog.showModal();this.$nextTick?.(()=>{
                    if(this.ctActive && this.ctScanScopeKey===scopeKey && this.ctSelection===unitId && this.ctDiagnosticDialog()===dialog && dialog.open)
                        (this.getEditorComponentRef?.('diagnosticScanHeading') || this.$refs?.ctDiagnosticScanHeading)?.focus();
                });return true;
            },
            ctCloseScanDialog(restoreFocus=true) {if(restoreFocus===false){this._ctScanReturnFocus=null;this._ctScanReturnScope=null;}this.ctDiagnosticDialog()?.close();},
            ctScanDialogClosed() {
                const element=this._ctScanReturnFocus,scopeKey=this._ctScanReturnScope,unitId=this._ctScanReturnUnitId;
                this._ctScanReturnFocus=null;this._ctScanReturnScope=null;
                if(element?.isConnected && this.ctActive && scopeKey===this.ctScanScopeKey && this.ctSelection===unitId)element.focus({preventScroll:true});
            },
            ctScanDialogKeydown(event) {if((event.ctrlKey || event.metaKey) && event.code==='KeyS')event.preventDefault();},
            ctStartScan() {if(!this.ctHasScanSelection || this.ctScanRunning)return;return this.ctScan();},
            async ctShowVersionChooser() {
                if(!this.ctActive || this.ctBusy)return false;
                const ctx=this.ctContext(),unitId=this.ctSelection,current=()=>this.ctActive && !this.ctBusy && this.ctCurrent(ctx) && this.ctSelection===unitId;
                try {
                    if(!await this.ctFlushDraft() || !current())return false;
                    await this.ctFlushCommentDraft();if(!current())return false;
                    if(this.ctOfflineTest)this.ctFence();
                    this.managedOfflineContentMode='clienttext';
                    this.versionChooserVisible=true;return true;
                } catch(error){if(current())this.ctError='Draft was not stored before opening Versions: '+error.message;return false;}
            },
            async ctSetPage(value) {
                if(this.ctBusy || this.ctBrowseBusy)return false;const ctx=this.ctContext(),generation=this._ctBrowseGeneration || 0;
                const previous=this.ctPage,region=this.$refs?.ctFileTableRegion,active=root.document?.activeElement,
                    listHadFocus=!!region && (active===region || region.contains?.(active));
                if(!await this.ctFlushDraft() || !this.ctCurrent(ctx) || generation!==(this._ctBrowseGeneration || 0))return false;
                const next=Math.max(1,Math.min(this.ctPageCount,Math.floor(Number(value)||1)));
                if(next===this.ctPage)return true;
                this.ctPage=next;
                const rows=this.ctPageRows,unitId=(next>previous?rows[0]:rows[rows.length-1])?.id;
                await this.$nextTick?.();
                if(!this.ctCurrent(ctx) || generation!==(this._ctBrowseGeneration || 0) || this.ctPage!==next || this.ctKeyboardOverlayOpen())return false;
                this.ctFocusRow(unitId,listHadFocus,next>previous?'start':'end');return true;
            },
            ctFocusRow(unitId=this.ctSelection,moveFocus=true,block='nearest') {
                const region=this.$refs?.ctFileTableRegion;
                const row=[...(region?.querySelectorAll?.('[data-unit-id]') || [])].find(item=>item.dataset.unitId===unitId);
                if(moveFocus)(row || region)?.focus?.({preventScroll:true});
                this.scrollWorkspaceFileRow?.(row,block);
            },
            ctRefreshLayout() {this.observeInlineBlocks?.();this.measureWorkspaceChrome?.();},
            ctRowClick(unit,event) {
                if(this.ctBusy || rowControl(event))return false;
                return this.ctSelect(unit,!this.inlineEditor,{saveInline:true});
            },
            ctRowDoubleClick(unit,event) {
                if(this.ctBrowseBusy || rowControl(event))return false;
                const pending=this._ctSelectRun;
                if(pending?.pending && pending.unitId===unit?.id && pending.generation===(this._ctBrowseGeneration || 0) && this.ctCurrent(pending.ctx)){pending.full=true;if(this.ctSelection===unit.id)this.ctEditor=true;return true;}
                if(this.ctBusy)return false;
                return this.ctSelect(unit,true,{saveInline:true});
            },
            ctInlineFocusContains(target) {
                return target?.closest?.('tr[data-unit-id]')?.dataset.unitId===this.ctSelection
                    || !!target?.closest?.('[data-inline-focus-surface], .appDialogOverlay, .appDialog');
            },
            ctInlineFocusOut(event) {
                if(!this.ctInlineUnitVisible() || this.ctKeyboardBlocked() || this._ctCloseRun || this.ctInlineFocusContains(event.relatedTarget))return;
                const ctx=this.ctContext(),unit=this.ctCurrentUnit,selection=this._ctSelectRun;
                setTimeout(async()=>{
                    await this.waitForInlineRowPointer?.();
                    if(!this.ctCurrent(ctx) || this.ctCurrentUnit!==unit || this._ctSelectRun!==selection || !this.ctInlineUnitVisible()
                        || this.ctKeyboardBlocked() || root.document?.hidden || root.document?.hasFocus?.()===false
                        || event.target?.composing || this.ctInlineFocusContains(root.document?.activeElement))return;
                    if(this.ctHasEditorChanges() && !await this.ctSave())return;
                    if(!this.ctCurrent(ctx) || this.ctCurrentUnit!==unit || this._ctSelectRun!==selection || this.ctEditor
                        || this.ctKeyboardBlocked() || this.ctInlineFocusContains(root.document?.activeElement))return;
                    if(!await this.ctFlushDraft() || !this.ctCurrent(ctx) || this.ctCurrentUnit!==unit || this._ctSelectRun!==selection)return;
                    this.ctInlineClosed=true;this.ctCloseCompletion();this.ctDictionaryEndEdit();this.ctRefreshLayout();
                },0);
            },
            async ctRowKeydown(unit,event) {
                if(!event || event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
                    || this.ctBusy || this.ctBrowseBusy || this.ctEditor || this.ctHistoryViewer || this.ctDiagnosticDialog()?.open || rowControl(event))return false;
                const keys=['ArrowUp','ArrowDown','Home','End','PageUp','PageDown','ArrowLeft','ArrowRight','Enter'];
                if(!keys.includes(event.key))return false;
                unit ||= this.ctCurrentUnit || this.ctPageRows[0];if(!unit)return false;
                event.preventDefault();const ctx=this.ctContext(),generation=this._ctBrowseGeneration || 0;
                if(event.key==='Enter')return this.ctSelect(unit,true);
                const rows=this.ctRows,size=this.ctEffectivePageSize,index=rows.findIndex(item=>item.id===unit.id);
                let targetIndex=index<0?Math.min(rows.length-1,(this.ctPage-1)*size):index;
                if(event.key==='Home')targetIndex=0;else if(event.key==='End')targetIndex=rows.length-1;
                else if(event.key==='ArrowUp')targetIndex=index<0?rows.length-1:index-1;
                else if(event.key==='ArrowDown')targetIndex=index<0?0:index+1;
                else targetIndex+=(event.key==='PageUp'||event.key==='ArrowLeft'?-size:size);
                targetIndex=Math.max(0,Math.min(rows.length-1,targetIndex));const target=rows[targetIndex];if(!target)return false;
                if(!await this.ctSelect(target,false,{focus:false}) || !this.ctCurrent(ctx) || generation!==(this._ctBrowseGeneration || 0))return false;
                this.ctPage=Math.floor(targetIndex/size)+1;await this.$nextTick?.();
                if(this.ctCurrent(ctx) && generation===(this._ctBrowseGeneration || 0) && this.ctSelection===target.id)this.ctFocusRow(target.id);return true;
            },
            async ctCloseEditor() {
                if(this.ctBusy || this.ctBrowseBusy || this._ctCloseRun)return false;
                const ctx=this.ctContext(),unit=this.ctCurrentUnit,unitId=this.ctSelection,selectionRun=this._ctSelectRun,
                    generation=this._ctBrowseGeneration || 0,returning=this._ctInlineReturn,run=this._ctCloseRun={};
                const current=()=>this._ctCloseRun===run && this.ctCurrent(ctx) && this.ctSelection===unitId
                    && generation===(this._ctBrowseGeneration || 0)
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
                const ctx=this.ctContext(),unit=this.ctCurrentUnit,run=this._ctCloseRun={},selectionRun=this._ctSelectRun,generation=this._ctBrowseGeneration || 0;
                const current=()=>this._ctCloseRun===run && this.ctCurrent(ctx) && this.ctCurrentUnit===unit
                    && generation===(this._ctBrowseGeneration || 0)
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
                if(this.ctOfflineTest && !await this.appConfirm('Discard the unsaved draft for this ID? Committed text and other drafts will be kept.',{title:'Discard this draft?',confirmLabel:'Discard draft'}))return false;
                const ctx=this.ctContext(),unitId=this.ctSelection,signature=JSON.stringify([this.ctValues,this.ctReviewed]);
                if(!await this.ctFlushDraft() || !this.ctCurrent(ctx) || this.ctSelection!==unitId)return false;
                const revision=this._ctDraftRevision;this.ctBusy=true;
                try {
                    await this.ctStorage(ctx.scope).discardDraft(ctx.scope,unitId,{expectedRevision:revision});
                    if(!this.ctCurrent(ctx) || this.ctSelection!==unitId)return false;
                    if(this._ctDraftRevision===revision){this._ctDraftRevision=null;const head=this._ctDraftHeads?.get(JSON.stringify([root.ClientTextStore.scopeKey(ctx.scope),unitId]));if(head&&!head.pending){head.revision=null;head.signature=null;}}
                    if(signature!==JSON.stringify([this.ctValues,this.ctReviewed])){this.ctQueueDraft();return false;}
                    this.ctValues=this.ctValuesFor(this.ctCurrentUnit);this.ctReviewed={...(this.ctSaved[unitId]?.reviewed || {})};
                    this.ctMtlRestoreAcceptances?.(null);
                    this.ctChoices=copy(this.ctSaved[unitId]?.conflicts || []);this.ctDraftDirty=false;this.ctDraftStageFailure=null;this.ctCloseCompletion();await this.ctRefreshDraftSummaries(ctx);return true;
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
                const initial=count(counts.workloadFields),saved=Math.min(initial,count(counts.resolvedFields));
                // Explicit English decisions resolve work. Unmarked blanks
                // remain in the fixed initial workload denominator.
                const total=initial,unresolved=initial-saved,outdated=Math.min(unresolved,count(counts.outdatedFields)),missing=unresolved-outdated;
                const excludedMissing=0;
                const width=value=>total?100*value/total+'%':'0%';
                return {saved,total,percent:total?Math.round(100*saved/total):0,ordinarySaved:saved,revised:0,missing,outdated,unresolved,excludedMissing,
                    savedWidth:width(saved),revisedWidth:'0%',missingWidth:width(missing),outdatedWidth:width(outdated),empty:!total,known,
                    loaded:count(counts.loaded),savedIds:count(counts.saved),revisedIds:count(counts.revised),missingIds:count(counts.missing),outdatedIds:count(counts.outdated),
                    fields:count(counts.fields),savedFields:count(counts.savedFields),revisedFields:count(counts.revisedFields),
                    missingFields:count(counts.missingFields),outdatedFields:count(counts.outdatedFields)};
            },
            ctAssignmentProgressTooltip(row) {
                if(row.contentMode!=='clienttext')return this.managedProgressTooltip(row.team);
                const progress=this.ctAssignmentProgress(row),lines=[row.label+' progress',
                    progress.known?`Resolved workload fields: ${progress.saved} / ${progress.total} (${progress.percent}%)`:'Initial field workload counts are unavailable.',
                    'Workload denominator: all initial Missing/Outdated fields, including carried source changes. Each field is counted once.'];
                if(progress.known && !progress.total)lines.push('No counted workload fields; the bar is neutral.');
                lines.push(`Remaining Missing-only fields: ${progress.missing} · Remaining Outdated fields: ${progress.outdated}`,
                    'A valid active Use English decision resolves its field. Unmarked blanks and unreviewed source changes remain work.',
                    `IDs: ${progress.loaded} loaded · Saved: ${progress.savedIds} · Revised: ${progress.revisedIds} · Missing: ${progress.missingIds} · Outdated: ${progress.outdatedIds}`,
                    `Field statuses: ${progress.fields} fields · Saved: ${progress.savedFields} · Revised corrections: ${progress.revisedFields} · Missing: ${progress.missingFields} · Outdated: ${progress.outdatedFields}`,
                    'Saved and Revised counts describe explicit accepted saves; status counts can overlap. They do not define this progress denominator.',
                    'Revised field corrections are outside the initial workload and are excluded from the progress bar.',
                    'Only server-accepted work is counted; unsaved drafts and pending offline saves are excluded.');
                return lines.join('\n');
            },
            ctScope(versionId, groupId, language = this.lang) { return { accountId: this.cloudProfileId || this.cloudUser?.id || 'guest', game: this.gameVersion, branchId: this.branchId || 'default', versionId, groupId, language }; },
            ctStorage(scope) {
                if(String(scope?.groupId || '').startsWith('local:test:'))return this._ctLocalStore;
                return this._ctStore;
            },
            async ctBackupLocal() {
                if(!this.ctOfflineTest || this.ctLocalBackupBusy)return false;
                const ctx=this.ctContext();this.ctLocalBackupBusy=true;
                try {
                    const checkpointed=await this.ctFlushDraft();
                    // Even a failed checkpoint can export durable work and a
                    // detached current editor recovery file in the same ZIP.
                    const blob=await this._ctLocalStore.backup(ctx.scope);
                    if(!this.ctCurrent(ctx))return false;
                    let output=blob;
                    if(!checkpointed){const zip=await root.JSZip.loadAsync(blob);zip.file('uncheckpointed-editor.json',JSON.stringify({scope:ctx.scope,unitId:this.ctSelection,values:copy(this.ctValues),reviewed:copy(this.ctReviewed)}));output=await zip.generateAsync({type:'blob'});}
                    root.saveAs(output,'SDEditor-local-workbook-'+ctx.scope.groupId.slice(-8)+'.zip');
                    postNotice(this,'ctNotice',checkpointed?'Local recovery backup downloaded. It includes originals, history and drafts.':'Recovery backup downloaded with uncheckpointed-editor.json. Keep the tab open; those newest values need manual recovery.');return true;
                } catch(error){postNotice(this,'ctError','Backup failed: '+error.message);return false;}
                finally{this.ctLocalBackupBusy=false;}
            },
            ctDownloadDraftRecovery() {
                if(!this.ctOfflineTest || !this.ctSelection)return;
                root.saveAs(new Blob([JSON.stringify({format:'clienttext-editor-recovery-v1',scope:copy(this.ctWorkspace.scope),unitId:this.ctSelection,values:copy(this.ctValues),reviewed:copy(this.ctReviewed)},null,2)],{type:'application/json'}),'SDEditor-unsaved-editor.json');
            },
            ctDownloadEmergencyDraft(draft) {
                root.saveAs(new Blob([JSON.stringify({format:'clienttext-editor-recovery-v1',...draft},null,2)],{type:'application/json'}),'SDEditor-unstored-'+draft.scope.groupId.slice(-8)+'.json');
            },
            async ctRestoreLocalBackup(event) {
                const file=event.target.files?.[0];event.target.value='';if(!file)return;
                if(this.ctActive && !await this.ctFlushDraft())return false;
                this.ctLocalBackupBusy=true;this.ctLocalIssue='';const key=this.managedCatalogScope;
                try {
                    const scope=await this._ctLocalStore.restore(file,this.ctRequestScope(),this._ctWorker,{guard:()=>key===this.managedCatalogScope});
                    if(key!==this.managedCatalogScope)return false;
                    await this.ctRefreshLocal();return await this.ctOpenCached(await this._ctStore.getMetadata(scope));
                } catch(error){this.ctLocalIssue='Backup was not restored: '+error.message;return false;}
                finally{this.ctLocalBackupBusy=false;this._ctLocalStore.releaseExcept(this.ctWorkspace?.scope.groupId?.startsWith('local:test:')?this.ctWorkspace.scope:null);}
            },
            ctPersistentDictionary() { return this._ctTestDictionary?.base || this.dictionary; },
            ctBeginTestDictionary(scope) {
                // The editor/worker integrations all consume dictionary. Give
                // them detached rows; CloudSync continues to own the real store.
                this._ctTestDictionary = { accountId: scope.accountId, language: scope.language, base: this.dictionary || [] };
                this.dictionary = copy(this.dictionary || []);
                this.tmManagerVisible = false; this.tmEditing = null; this.tmSeedVisible = false; this.tmHistoryVisible = false;
            },
            ctEndTestDictionary() {
                const session = this._ctTestDictionary;
                if (!session) return;
                const snapshot = this._cloud?.snapshot?.();
                this.dictionary = snapshot?.profileId === session.accountId && snapshot.settings?.lang === session.language
                    ? snapshot.dictionary : session.base;
                this._ctTestRestoredDictionary = this.dictionary;
                this._ctTestDictionary = null;
                this.ctDictionaryFilter = ''; this.ctDictionaryEndEdit(); this.ctCloseCompletion();
            },
            ctContext() { return { key: this.managedCatalogScope, scope: copy(this.ctWorkspace?.scope || {}), epoch: this._ctEpoch || 0 }; },
            ctCurrent(ctx) { return ctx.key === this.managedCatalogScope && ctx.epoch === (this._ctEpoch || 0) && JSON.stringify(ctx.scope) === JSON.stringify(this.ctWorkspace?.scope || {}); },
            ctFence(keepTestGroupId = null) {
                this.ctAbortExport?.();
                const exitingTest=this.ctOfflineTest;
                this.ctCloseScanDialog(false);this.ctClearScanResults();
                const emergency=exitingTest && this.ctDraftDirty && this.ctSelection ? raw({id:uuid(),scope:copy(this.ctWorkspace.scope),unitId:this.ctSelection,values:copy(this.ctValues),reviewed:copy(this.ctReviewed),pending:true}) : null;
                if(emergency)this.ctLocalEmergencyDrafts.push(emergency);
                const localFlush=this.ctFlushDraft();localFlush.catch(()=>{});
                if(emergency)localFlush.then(stored=>{
                    if(stored)this.ctLocalEmergencyDrafts=this.ctLocalEmergencyDrafts.filter(draft=>draft.id!==emergency.id);
                    else{emergency.pending=false;this.ctLocalIssue='A draft from the previous local workbook could not be stored. Keep this tab open and download its recovery copy.';}
                },error=>{emergency.pending=false;this.ctLocalIssue='A draft from the previous local workbook could not be stored: '+error.message;});
                const keepLocal=this._ctLocalKeepScope?.groupId===keepTestGroupId?this._ctLocalKeepScope:null;
                const releaseLocal=this._ctLocalStore?.releaseCapturedExcept(keepLocal);
                localFlush.finally(()=>releaseLocal?.()).catch(()=>{});
                this.ctFlushCommentDraft().catch(()=>{});
                this.ctFlushReplyCommentDrafts().catch(()=>{});
                this.ctMtlReset?.();
                this.ctClearResourceSync?.();
                this.ctEndTestDictionary();
                this._ctEpoch = (this._ctEpoch || 0) + 1; this._ctAbort?.abort(); clearInterval(this._ctSyncTimer); clearTimeout(this._ctDraftTimer);clearTimeout(this._ctSearchTimer);
                this._ctDictionaryRequest?.cancel?.();this._ctDictionaryRun=null;this.ctDictionaryPack=null;this._ctPendingDictionaryPack=null;this.ctDraftSummaries=[];
                this._ctSync?.stop?.(); this._ctSync = null;
                this._ctSaveJob = null; this._ctRecoveryJob=null;this._ctRecoveryRun=null;this.ctRecoveryBusy=false; this._ctDraftRevision = null; this._ctEditRevision = 0; this._ctSyncError = '';this.ctCheckpointWarning=null;this._ctNavigationRun=null;this.ctNavigationBusy=false;
                this._ctInlineReturn=null;this._ctCloseRun=null;this._ctGenderInsertRun=null;this._ctFieldFocusRun=null;this._ctDictionaryReturn=null;this._ctDictionaryFocusRun=null;this.ctInlineClosed=false;
                this.ctVariantSelections={};this._ctClassNameCache=null;this._ctReferenceIndexCache=null;
                this._ctStatusCache = new WeakMap(); this._ctSortCache=new WeakMap();this._ctOrderCache=null;this._ctSelectRun={}; this.ctDraftDirty = false; this.ctDraftStageFailure=null; this.ctBusy = false;
                this._ctConsistencyIndex=null;this._ctConsistencyByUnit=null;this.ctMemory=raw([]);
                this._ctNpcIndex=null;this._ctPortraitResolver=null;this._ctBrowseCandidateCache=null;this._ctBrowseViews=null;this._ctBrowseGeneration=(this._ctBrowseGeneration || 0)+1;
                this._ctConvoIndex=null;this._ctConvoFocusRun=null;this._ctConvoTypeAhead=null;
                this._ctBrowseTransitionRun=null;this._ctBrowseRestoring=false;this.ctBrowseBusy=false;
                this.ctBrowseMode='sheets';this.ctNpcSelection='all';this.ctNpcKind='';this.ctNpcFilter='';
                this.ctConvoSelection='all';this.ctConvoFilter='';this.ctConvoExpanded=[];this.ctConvoFocusKey='';
                this.ctActive = false; this.ctEditor = false; this.ctSelection = ''; this.ctComments = []; this.ctPeers = []; this.ctProgress = null;
                this.ctPreviewGggVars={};this.ctPreviewAffixes=previewAffixesFor(null);this.ctFocusedField='';
                this.ctLocalDraftState='';this.ctWorkspace=null;this.ctUnits=raw([]);this.ctSaved=raw({});this.activeContentGroup=null;
                this._ctUnitIndex=raw(new Map());this._ctWorkUnits=raw(new Map());this._ctSheets=raw([]);this.ctSheetFilter='';
                this.ctResetHistory();
                this.ctUploadVisible=false;this.ctUploading=false;this.ctUploadPredecessor=null;this._ctUploadOpenRun=null;this.ctRequests=[];this.ctWorkbookDragDepth=0;
                for(const [id,store] of this._ctTestStores || [])if(id!==keepTestGroupId){store.dispose();this._ctTestStores.delete(id);}
                if(this.ctUploadTest){this.ctUploadFiles=raw([]);this.ctUploadHistoryFiles=raw([]);this.ctUploadHistory=false;this.ctPrepared=raw([]);}
                if(exitingTest){
                    this.ctValues={};this.ctReviewed={};
                    if(this._ctTestFilters)this.ctSelectedFilters=this._ctTestFilters;
                    if(this._ctTestTool)this.ctTool=this._ctTestTool;
                    this._ctTestFilters=null;this._ctTestTool=null;
                    for(const key of this._ctDraftHeads?.keys() || [])if(JSON.parse(JSON.parse(key)[0])[4]?.startsWith('local:test:'))this._ctDraftHeads.delete(key);
                }
            },
            ctStatus(unit = this.ctCurrentUnit) {
                if(!unit)return {fields:{}};
                const cache=this._ctStatusCache ||= new WeakMap(),saved=this.ctSaved[unit.id],previous=cache.get(unit);
                if(previous && previous.saved===saved && previous.game===this.gameVersion)return previous.status;
                const status=root.ClientTextState.statusFor(unit,saved,{game:this.gameVersion});cache.set(unit,{saved,game:this.gameVersion,status});return status;
            },
            ctFieldStatus(field) { return this.ctStatus().fields[field.id] || {}; },
            ctRowStatusClasses(unit) {
                const status=this.ctStatus(unit);
                // Saved records can contain intentional blanks or unreviewed
                // sources. Keep durable Saved separate from row completion.
                return {isMissing:status.missing,isOutdated:status.outdated,isRevised:status.revised,
                    hasChanges:status.saved && !status.missing && !status.outdated};
            },
            ctReviewHash(field) { return root.ClientTextState.sourceHash(field.source); },
            ctBlankSourceReview(field,unit=this.ctCurrentUnit) {
                const saved=this.ctSaved[unit?.id];
                return field?.kind!=='gender' && !String(field?.source ?? '').trim() && (!!field?.outdated
                    || (saved?.outdated || []).includes(field?.id)
                    || Object.prototype.hasOwnProperty.call(saved?.provenance?.requiredReview || {},field?.id));
            },
            ctValuesFor(unit) { return root.ClientTextState.valuesFor(unit, this.ctSaved[unit.id]); },
            ctRebuildSheets(units=this.ctUnits) {
                const keys=new Set();
                for(const unit of units)if(this.ctFieldsFor(unit).length)keys.add(JSON.stringify([unit.role,unit.sheet]));
                this._ctSheets=raw([...keys].map(key=>{const [role,name]=JSON.parse(key);return {key,role,name};}));
            },
            ctFieldsFor(unit=this.ctCurrentUnit) {
                if(!unit)return [];
                // Only unused fields are hidden. Retained translations remain
                // accessible even after upstream removes English or its orange
                // fill. Original, staged and draft values keep their identity.
                const saved=this.ctSaved[unit.id],cache=this._ctVisibleFields ||= new WeakMap();let item=cache.get(unit);
                if(!item || item.fields!==unit.fields || item.saved!==saved){
                    const hasEnglish=field=>field.kind!=='gender' && String(field.source ?? '').trim().length>0;
                    const content=field=>hasEnglish(field) || field.kind!=='gender' && (String(field.target ?? '').trim()
                        || String(saved?.values?.[field.id] ?? '').trim() || this.ctBlankSourceReview(field,unit));
                    const fields=unit.fields || [],text=fields.filter(content);
                    const visible=text.length ? fields.filter(field=>field.kind==='gender' || content(field)) : [];
                    item={fields:unit.fields,saved,visible};cache.set(unit,item);
                }
                let visible=item.visible;
                if(unit.id===this.ctSelection && this.ctDraftDirty){
                    const draft=field=>field.kind!=='gender' && (String(this.ctValues[field.id] ?? '').trim() || field.id===this.ctFocusedField);
                    if(unit.fields.some(field=>draft(field) && !visible.includes(field)))
                        visible=unit.fields.filter(field=>field.kind==='gender' || visible.includes(field) || draft(field));
                }
                // A retained draft must be discoverable before its values are
                // hydrated, including an otherwise entirely empty record.
                if(!visible.length && this.ctDraftUnitIds?.has(unit.id))visible=unit.fields;
                if(!this.hideDNT)return visible;
                if(visible!==item.visible || !item.withoutDNT){
                    const ordinary=visible.filter(field=>field.kind!=='gender' && !isDNTSource(field.source));
                    // Gender has no English source of its own. Retain it as
                    // metadata only while the record has visible text/work.
                    const filtered=ordinary.length ? visible.filter(field=>field.kind==='gender' || ordinary.includes(field)) : [];
                    if(visible!==item.visible)return filtered;
                    item.withoutDNT=filtered;
                }
                return item.withoutDNT;
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
            // Display only: search, saved targets and exports keep ctListText/valuesFor.
            ctListTargetParts(unit) {
                const values=this.ctValuesFor(unit),fallbackGroups=new Map(),parts=[];
                for(const field of this.ctFieldsFor(unit).filter(field=>field.kind!=='gender')){
                    const fallback=this.ctClassFallback(field,unit,values);
                    if(fallback){
                        const key=JSON.stringify([field.group || field.name,field.sourceCell,fallback.kind]),existing=fallbackGroups.get(key);
                        if(existing)existing.count++;else {const part={id:field.id,text:'',english:true,count:1,label:fallback.label};fallbackGroups.set(key,part);parts.push(part);}
                        continue;
                    }
                    const english=this.ctUsesEnglish(field,unit),text=english?'-- Use English --':String(values[field.id] ?? '');
                    if(text.trim())parts.push({id:field.id,text,english});
                }
                for(const part of fallbackGroups.values())part.text='-- '+part.label+' -- ('+part.count+' class variant'+(part.count===1?'':'s')+')';
                return parts;
            },
            ctPreviewValue(field) {
                const value=String(this.ctValues[field.id] ?? '');
                const fallback=this.ctClassFallback(field);
                if(fallback?.kind!=='english' && fallback?.defaults.length===1)return fallback.defaults[0].value;
                if(fallback?.kind!=='english' && fallback?.defaults.length>1)return '';
                return !value.trim() && (this.ctUsesEnglish(field) || this.ctClassUsesEnglish(field)) ? field.source : value;
            },
            ctDiagnose(unit) { const values = this.ctValuesFor(unit); return unit.fields.flatMap(field => this.ctUsesEnglish(field,unit)?[]:root.ClientTextState.diagnose(field, values[field.id]).map(issue => ({ ...issue, severity: issue.level || issue.severity, fieldId: field.id }))); },
            ctTone(unit) { const s = this.ctStatus(unit); return s.missing ? 'missing' : s.outdated ? 'outdated' : s.revised ? 'revised' : s.saved ? 'saved' : ''; },
            ctStatusLabel(unit) { const s = this.ctStatus(unit); return ['Missing', 'Outdated', 'Revised', 'Saved'].filter(label => s[label.toLowerCase()]).join(' · ') || 'Unchanged'; },
            ctForm(group, form) { return group.fields.find(field => field.form === form); },
            ctClassFields(group) { return group.fields.filter(isClassField); },
            ctClassEnglishField(field,unit=this.ctCurrentUnit) {
                return this.gameVersion==='poe2' && ['NPCTextAudio','NPCTalkDialogueTextAudio'].includes(String(unit?.sheet || '').replace(/_Gender$/,'')) && unit.fields.includes(field)
                    && isClassField(field) && !!String(field.source ?? '').trim() && !root.ClientTextState.audioOnly(field.source) && !isDNTSource(field.source);
            },
            ctClassUsesEnglish(field,unit=this.ctCurrentUnit,value=this.ctValues[field.id]) {
                return this.ctClassEnglishField(field,unit) && !String(value ?? '').trim()
                    && this.ctClassFallback(field,unit,{...(unit===this.ctCurrentUnit?this.ctValues:this.ctValuesFor(unit)),[field.id]:value})?.kind!=='generic';
            },
            ctClassFallback(field,unit=this.ctCurrentUnit,values=unit===this.ctCurrentUnit?this.ctValues:this.ctValuesFor(unit)) {
                if(!field || !this.ctClassEnglishField(field,unit) || String(values[field.id] ?? '').trim())return null;
                const defaults=root.ClientTextState.dialogueGenericFields(unit,field,{game:this.gameVersion})
                    .filter(candidate=>!(root.ClientTextState.allowsNonexistent(candidate) && String(values[candidate.id] ?? '').trim()==='NONEXISTENT'))
                    .map(candidate=>({field:candidate,english:!String(values[candidate.id] ?? '').trim(),value:String(values[candidate.id] ?? '').trim()?values[candidate.id]:candidate.source}));
                const translated=defaults.filter(item=>!item.english).length,kind=!translated?'english':translated===defaults.length?'generic':'mixed';
                return {kind,label:kind==='generic'?'Use generic':kind==='mixed'?'Use generic / English':'Use English',defaults};
            },
            ctClassFallbackCue(field,value) {
                const fallback=this.ctClassFallback(field,this.ctCurrentUnit,{...(this.ctInputValues || this.ctValues),[field.id]:value});
                return fallback?'-- '+fallback.label+' --':'';
            },
            ctGenericVariantsToSave(group) {
                return this.ctClassFields(group).filter(field=>this.ctClassFallback(field)?.kind==='generic' && this.ctFieldStatus(field).outdated && !field.required);
            },
            ctBlankEnglishVariants(group) { return this.ctClassFields(group).filter(field=>this.ctClassUsesEnglish(field)); },
            ctClassVariantCounts(group) {
                const fields=this.ctClassFields(group),fallbacks=fields.map(field=>this.ctClassFallback(field)),blank=fallbacks.filter(item=>item?.kind==='english').length,
                    generic=fallbacks.filter(item=>item?.kind==='generic').length,mixed=fallbacks.filter(item=>item?.kind==='mixed').length;
                return fields.some(field=>this.ctClassEnglishField(field))
                    ? [this.ctPopulatedVariants(group).length+' translated',...(generic?[generic+' use generic']:[]),...(mixed?[mixed+' use generic / English']:[]),...(blank?[blank+' use English']:[])].join(' · ')
                    : this.ctPopulatedVariants(group).length+' populated / '+fields.length+' available';
            },
            ctBlankVariantsToReview(group) {
                return this.ctBlankEnglishVariants(group).filter(field=>this.ctFieldStatus(field).outdated && this.ctReviewed[field.id]!==this.ctReviewHash(field));
            },
            ctStagedBlankVariantReviews(group) {
                return this.ctBlankEnglishVariants(group).filter(field=>this.ctFieldStatus(field).outdated && this.ctReviewed[field.id]===this.ctReviewHash(field));
            },
            ctBlankVariantReviewBlocked(group) {
                return !this.ctVariantGroupCurrent(group) || !!this._ctSaveJob || !!this.ctRecoveryBusy || !!this.ctPendingSharedRecovery()
                    || !!this.ctChoices.length || this.ctBlankVariantsToReview(group).some(field=>this.ctMtlBusy?.(field) || this.ctMtlCandidate?.(field));
            },
            ctReviewBlankVariants(group,event) {
                if(this.ctBlankVariantReviewBlocked(group))return false;
                const fields=this.ctBlankVariantsToReview(group);if(!fields.length)return false;
                // Removing the focused action must not blur the inline row and
                // trigger its ordinary leave-row save before explicit Save.
                if(event?.currentTarget && event.currentTarget===root.document?.activeElement){
                    const selected=this.ctSelectedVariant(group);
                    this.ctTargetInputs().find(input=>input.dataset?.ctTarget===selected?.id)?.focus?.({preventScroll:true});
                }
                for(const field of fields)this.ctReviewed[field.id]=this.ctReviewHash(field);
                this.ctDraftStageFailure=null;this.ctDraftDirty=true;this.ctQueueDraft();return true;
            },
            ctNamedForms(group) { return group.fields.filter(root.ClientTextState.isNamedForm); },
            ctNamedFormLabel(field) { return root.ClientTextState.isNamedForm(field) ? field.form.replace(/ Translation$/, '') : field.form; },
            ctSetPreviewAffixExample(key) {
                const example=previewAffixExamples.find(example=>example.key===key);
                if(example)this.ctPreviewAffixes={example:key,prefix:example.prefix,suffix:example.suffix};
            },
            ctDefaultForms(group) { return group.fields.filter(field=>field.kind==='form' && !isClassField(field) && !root.ClientTextState.isNamedForm(field)); },
            ctClassVariantName(field) {
                if(this.mapClientTextClassNames===false || !isClassField(field))return field.form || '';
                const units=this.ctUnits,workspace=this.ctWorkspace;
                let cache=this._ctClassNameCache;
                if(!cache || cache.units!==units || cache.workspace!==workspace){
                    const candidates=new Map();
                    for(const unit of units){
                        if(unit.sheet!=='Characters' || !['normal','gender'].includes(unit.role))continue;
                        const path=/^Metadata\/Characters\/([^/]+)\/([^/]+)$/.exec(unit.recordId || '');
                        if(!path || !classForms.has(path[2]) || path[1]!==path[2].replace(/Fourb?$/,''))continue;
                        const fields=unit.fields.filter(value=>value.name==='Name' && (unit.role==='normal'
                            ? value.kind==='text' : value.kind==='form' && value.form==='MS'));
                        let item=candidates.get(path[2]);
                        if(!item)candidates.set(path[2],item={normal:[],gender:[]});
                        // Only immutable English names supply labels. Drafts and
                        // saved translations never rewrite identities or this view.
                        item[unit.role].push(fields.length===1 ? String(fields[0].source ?? '').trim() : '');
                    }
                    const names=new Map();
                    for(const [form,item] of candidates){
                        const values=item.normal.length ? item.normal : item.gender;
                        if(values.length===1 && values[0] && values[0]!=='NONEXISTENT')names.set(form,values[0]);
                    }
                    cache=this._ctClassNameCache={units,workspace,names};
                }
                return cache.names.get(field.form)
                    || root.ClientTextIdentities?.characterForm?.(field.form,workspace?.scope?.game || this.gameVersion)?.label || field.form;
            },
            ctClassVariantLabel(field) {
                const name=this.ctClassVariantName(field);
                return name!==(field.form || '') ? name+' ('+field.form+')' : name;
            },
            ctVariantKey(group,unit=this.ctCurrentUnit) { return JSON.stringify([unit?.id,group.key]); },
            ctSelectedVariant(group,unit=this.ctCurrentUnit) {
                const fields=this.ctClassFields(group),selected=this.ctVariantSelections[this.ctVariantKey(group,unit)],
                    values=unit===this.ctCurrentUnit ? this.ctValues : this.ctValuesFor(unit);
                return fields.find(field=>field.id===selected) || fields.find(field=>String(values[field.id] ?? '').trim()) || fields[0] || null;
            },
            ctPopulatedVariants(group) { return this.ctClassFields(group).filter(field=>String(this.ctValues[field.id] ?? '').trim()); },
            ctInitializeVariants(unit=this.ctCurrentUnit) {
                for(const group of groupFields({fields:this.ctFieldsFor(unit)})){
                    const fields=this.ctClassFields(group),key=this.ctVariantKey(group,unit);if(!fields.length)continue;
                    if(!fields.some(field=>field.id===this.ctVariantSelections[key]))
                        this.ctVariantSelections[key]=this.ctSelectedVariant(group,unit).id;
                }
            },
            ctDisplayedFields(unit=this.ctCurrentUnit) {
                return groupFields({fields:this.ctFieldsFor(unit)}).flatMap(group=>{
                    if(!this.ctClassFields(group).length)return group.fields;
                    const selected=this.ctSelectedVariant(group,unit);
                    return group.fields.filter(field=>!isClassField(field) || field===selected);
                });
            },
            ctVariantGroupCurrent(group) {
                return !this.ctKeyboardBlocked() && group.fields.length && group.fields.every(field=>this.ctFieldsFor().includes(field));
            },
            ctSelectVariant(group,fieldId,{focus=true}={}) {
                if(!this.ctVariantGroupCurrent(group) || !this.ctClassFields(group).some(field=>field.id===fieldId))return false;
                this.ctVariantSelections[this.ctVariantKey(group)]=fieldId;this.ctCloseCompletion();
                if(focus)return this.ctFocusTarget(false,fieldId);
                this.ctFocusedField=fieldId;return true;
            },
            ctVariantTabKeydown(group,field,event) {
                if(event.defaultPrevented || event.isComposing || event.keyCode===229 || event.ctrlKey || event.altKey || event.metaKey
                    || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key) || !this.ctVariantGroupCurrent(group))return false;
                const fields=this.ctPopulatedVariants(group),index=fields.indexOf(field);if(index<0)return false;
                const next=event.key==='Home'?0:event.key==='End'?fields.length-1:(index+(event.key==='ArrowRight'?1:-1)+fields.length)%fields.length;
                event.preventDefault();event.stopPropagation?.();return this.ctSelectVariant(group,fields[next].id);
            },
            ctVariantFacts(field) {
                const status=this.ctFieldStatus(field),issues=(this.ctDiagnostics[this.ctSelection] || []).filter(issue=>issue.fieldId===field.id);
                return {missing:!!status.missing,outdated:!!status.outdated,error:issues.some(issue=>issue.severity==='error'),
                    warning:issues.some(issue=>issue.severity==='warning'),workload:!!field.originalMissing || !!field.outdated
                        || (this.ctSaved[this.ctSelection]?.outdated || []).includes(field.id)};
            },
            ctVariantLabel(field) {
                const facts=this.ctVariantFacts(field),labels=['Missing','Outdated','Error','Warning'].filter(name=>facts[name.toLowerCase()]);
                const fallback=this.ctClassFallback(field);
                return this.ctClassVariantLabel(field)+(String(this.ctValues[field.id] ?? '').trim()?'':fallback?' ('+fallback.label+')':' (blank)')+(labels.length?' · '+labels.join(' · '):'');
            },
            ctVariantSummary(fields) {
                const facts=fields.map(field=>this.ctVariantFacts(field)),labels=[];
                for(const name of ['Workload','Missing','Outdated','Error','Warning']){
                    const count=facts.filter(fact=>fact[name.toLowerCase()]).length;if(count)labels.push(count+' '+name);
                }
                return labels.join(' · ');
            },
            ctRevealTarget(field) {
                if(!isClassField(field))return false;
                const group=groupFields({fields:this.ctFieldsFor()}).find(group=>group.fields.includes(field));
                if(!group)return false;
                const changed=this.ctSelectedVariant(group)!==field;this.ctVariantSelections[this.ctVariantKey(group)]=field.id;return changed;
            },
            ctGroupSources(group) {
                if(this.ctSourceGroups)return this.ctSourceGroups(group);
                const sources=new Map();for(const field of group.fields){const text=String(field.source ?? ''),item=sources.get(text);
                    const label=field.form ? this.ctClassVariantLabel(field) : field.name;
                    if(item)item.names.push(label);else sources.set(text,{key:field.id,text,names:[label]});}
                return [...sources.values()].map(item=>({...item,label:sources.size>1?item.names.join(' / '):group.name}));
            },
            ctFocusSource(group,source) {
                const displayed=this.ctDisplayedFields(),matches=field=>field.source===source.text && displayed.includes(field),
                    current=group.fields.find(field=>field.id===this.ctFocusedField && matches(field)),
                    selected=this.ctSelectedVariant(group);
                this.ctFocusedField=(current || (selected && matches(selected) ? selected : group.fields.find(matches)))?.id || source.key;
            },
            ctNotes(unit = this.ctCurrentUnit) { return (Array.isArray(unit?.developerNotes) ? unit.developerNotes : unit?.developerNotes ? [unit.developerNotes] : []).map(note => typeof note === 'string' ? note : note.text || note.value || '').filter(Boolean); },
            ctReferenceMetadata(unit = this.ctCurrentUnit) {
                const units=this.ctUnits,workspace=this.ctWorkspace,adapter=root.ContentAdapters.clienttext;
                let cache=this._ctReferenceIndexCache;
                if(!cache || cache.units!==units || cache.workspace!==workspace || !cache.index){
                    cache=this._ctReferenceIndexCache={units,workspace,index:adapter.cachedContextReferenceIndex(units)};
                }
                return adapter.referenceMetadata(unit,cache.index,{game:workspace?.scope?.game || this.gameVersion});
            },
            ctReport(progress) { this.ctProgress = { ...this.ctProgress, ...progress, completed: progress.completed ?? progress.processed ?? this.ctProgress?.completed ?? 0 }; },
            ctBeginInitialization(label,session,plan=[]) {
                const owner=this.beginWorkspaceInitialization?.({label,session,plan});
                if(owner){(this._ctInitializationOwners ||= new Set()).add(owner);this.ctInitializing=true;}
                return owner;
            },
            ctFinishInitialization(owner) {
                this.finishWorkspaceInitialization?.(owner);this._ctInitializationOwners?.delete(owner);
                this.ctInitializing=!!this._ctInitializationOwners?.size;
            },
            ctInitializationStep(label,callback,owner) {
                return owner && this.runWorkspaceInitializationTask ? this.runWorkspaceInitializationTask(label,callback,owner) : callback(()=>{});
            },
            async ctRequireTrustedProtocol(signal,parserVersions=[]) {
                const key=this.managedCatalogScope,client=this._cloud;
                const policy=await client.request('/v1/content-policy',{signal});
                if(key!==this.managedCatalogScope || client!==this._cloud || signal?.aborted)throw Object.assign(new Error('ClientText context changed.'),{stale:true});
                if(!policy.clientTextStorageProtocols?.includes(trustedProtocol))throw new Error('This server needs the trusted ClientText API update before workbook publication or synchronization. Cached local work remains available.');
                this.ctCheckParserCapability(policy,parserVersions);
                this.ctPolicy=policy;return policy;
            },
            ctCheckParserCapability(policy,parserVersions) {
                const unsupported=[...new Set(parserVersions)].filter(version=>!['clienttext-v1','clienttext-v2'].includes(version) && !policy?.clientTextParserVersions?.includes(version));
                if(unsupported.length){
                    const required=unsupported.includes(root.ClientTextState.PARSER_VERSION)?root.ClientTextState.PARSER_VERSION:unsupported[0];
                    throw new Error('This server needs the ClientText '+String(required).replace(/^clienttext-/,'')+' API update before preparing or publishing these workbooks. Update the API first, then retry. Cached local work and supported publications remain available.');
                }
            },
            async ctOriginalHash(bytes) {
                if(root.crypto?.subtle){const digest=await root.crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');}
                return root.ClientTextState.sha256(bytes);
            },
            ctDescribeOriginals(units,assets,options) {
                return this._ctWorker?.buildDescriptors ? this._ctWorker.buildDescriptors(units,assets,options) : root.ClientTextState.buildDescriptors(units,assets,options);
            },
            async ctCacheGroup(version,full,scope,{signal,current,initialization,comparison=false,worker=this._ctWorker}={}) {
                const guard=current || (()=>!signal?.aborted),check=()=>{if(!guard())throw Object.assign(new Error('ClientText opening was cancelled or superseded.'),{stale:true,name:'AbortError'});},
                    units=[],assets=[],descriptors=(full.assets || []).map(asset=>({...asset,...asset.descriptor})),cached=[],reportProgress=progress=>{if(!comparison)this.ctReport(progress);};
                if(!descriptors.length)throw new Error('This content group has no original workbook descriptors.');
                await this.ctInitializationStep('Checking reusable workbook cache',async report=>{
                    for(let index=0;index<descriptors.length;index++){const descriptor=descriptors[index],hash=descriptor.assetHash || descriptor.artifactHash || descriptor.hash;
                        cached[index]=await this._ctStore.getCachedOriginal?.(hash,descriptor.parserVersion || 'clienttext-v1',descriptor.role,{schemaHash:descriptor.schemaHash,importOptionsHash:descriptor.importOptionsHash,guard});check();
                        report({completed:index+1,total:descriptors.length,unit:'files',workbook:descriptor.filename || descriptor.name || descriptor.role,detail:cached[index]?'Reusable original found':'Original needs preparation'});
                    }
                },initialization);
                if(initialization?.ownsPlan)this.setWorkspaceInitializationPlan?.(initialization,[
                    'Preserving unsaved edits','Checking selected workspace','Checking reusable workbook cache',
                    ...descriptors.flatMap((descriptor,index)=>cached[index]?[]:[{label:'Downloading original: '+(descriptor.filename || descriptor.name || descriptor.role),weight:2},{label:'Parsing original: '+(descriptor.filename || descriptor.name || descriptor.role),weight:4}]),
                    {label:'Caching selected workspace',weight:3},'Loading cached translations','Preparing context references','Preparing Dictionary matches','Opening ClientText workspace']);
                for(let index=0;index<descriptors.length;index++){
                    const descriptor=descriptors[index],name=descriptor.filename || descriptor.name || descriptor.role,hash=descriptor.assetHash || descriptor.artifactHash || descriptor.hash;
                    let asset,originals;
                    if(cached[index]){asset={...cached[index].asset,descriptor:descriptor.descriptor || full.assets[index]?.descriptor || descriptor,role:descriptor.role,name};originals=cached[index].units;}
                    else{
                        const blob=await this.ctInitializationStep('Downloading original: '+name,async report=>{
                            const result=await this._cloud.request('/v1/content-groups/'+encodeURIComponent(full.id)+'/assets/'+encodeURIComponent(descriptor.role)+'/original',
                                {responseType:'blob',timeout:180000,signal,onDownloadProgress:(completed,total)=>{if(!guard())return;report({completed,total,unit:'bytes',workbook:name});reportProgress({phase:'Downloading original',completed,total,workbook:name,sheet:''});}});check();return result;
                        },initialization);
                        const parsed=await this.ctInitializationStep('Parsing original: '+name,async report=>{
                            const result=await worker.parseWorkbook(await blob.arrayBuffer(),{filename:name,role:descriptor.role,language:scope.language,game:scope.game,parserVersion:descriptor.parserVersion || 'clienttext-v1',signal,
                                onProgress:progress=>{if(!guard())return;const detail={...progress,completed:progress.completed ?? progress.processed,workbook:name};report(detail);reportProgress(detail);}});check();return result;
                        },initialization);
                        if(hash && parsed.artifactHash!==hash)throw new Error('The original workbook hash differs from its published descriptor.');
                        originals=parsed.units;asset={role:descriptor.role,blob,hash:parsed.artifactHash,name:parsed.filename,parserVersion:parsed.parserVersion,parsed:{...parsed,units:undefined},descriptor:full.assets[index]?.descriptor || descriptor};
                    }
                    root.ClientTextCodec?.assertGame({sheets:asset.parsed?.sheets,units:originals},scope.game);
                    if(Number.isSafeInteger(descriptor.unitCount) && originals.length!==descriptor.unitCount)throw new Error('Workbook record count differs from the accepted descriptor.');
                    for(const unit of originals)units.push(unit);assets.push(asset);check();
                }
                const metadata={version,group:full,storageProtocol:trustedProtocol};
                await this.ctInitializationStep('Caching selected workspace',async report=>{
                    await this._ctStore.import(scope,{units,assets,descriptors:descriptors.map((descriptor,index)=>full.assets[index]?.descriptor || descriptor),metadata},
                        {guard,onProgress:progress=>{if(!guard())return;report({...progress,completed:progress.completed ?? progress.processed});reportProgress(progress);}});check();
                },initialization);
                return metadata;
            },
            ctCancel() { this._ctAbort?.abort(); postNotice(this, 'ctNotice', 'Cancelled. Saved work is retained.'); },
            async ctRefreshLocal() {
                if (!this._ctStore) return;
                const key = this.managedCatalogScope;
                try { const [rows,requests] = await Promise.all([this._ctStore.listWorkspaces({ accountId: this.cloudProfileId || this.cloudUser?.id || 'guest', game: this.gameVersion,branchId:this.branchId || 'default' }),this._ctStore.listRequests(this.ctRequestScope())]); if (key === this.managedCatalogScope) {this.ctLocalWorkspaces = raw(rows.filter(row => row?.state === 'ready' && typeof row.groupId==='string' && !row.localRestorePending && !row.localComparisonOnly && !row.groupId.startsWith('staged:')));this.ctRequests=raw(requests);} this.ctLocalIssue='';} catch (error) { this.ctLocalIssue='Local workbooks could not be read. Browser data was retained. '+error.message; }
            },
            async ctActivate(scope, metadata, initializationSession) {
                const owner=this.ctRequestScope();if(scope.accountId!==owner.accountId || scope.game!==owner.game || scope.branchId!==owner.branchId)return false;
                const test=String(scope.groupId).startsWith('local:test:');
                if(!String(scope.groupId).startsWith('local:') && this.cloudSignedIn && !this.cloudCanAccessAllLanguages && scope.language!==this.cloudUser?.language)return false;
                const store=this.ctStorage(scope);
                const openingKey=this.managedCatalogScope,openingEpoch=this._ctEpoch || 0;
                const initialization=this.ctBeginInitialization('Opening cached ClientText workspace',initializationSession,
                    ['Preserving unsaved edits','Selecting workbook language','Loading cached translations','Preparing context references','Preparing Dictionary matches','Opening ClientText workspace']);
                let ctx,openingOwns,openingCurrent;
                try{
                if(!await this.ctInitializationStep('Preserving unsaved edits',async()=>{if(!await this.ctFlushDraft())return false;await this.ctFlushCommentDraft();return true;},initialization)
                    || openingKey!==this.managedCatalogScope || openingEpoch!==(this._ctEpoch || 0))return false;
                if(test){
                    const lease=await store.acquire(scope);
                    if(openingKey!==this.managedCatalogScope || openingEpoch!==(this._ctEpoch || 0)){store.releaseLease(lease);return false;}
                    this._ctLocalKeepScope=scope;
                }
                this.ctFence(test ? scope.groupId : null);const controller=this._ctAbort=new AbortController(),signal=controller.signal;
                const selectedEpoch=this._ctEpoch || 0;
                openingOwns=()=>openingKey===this.managedCatalogScope && selectedEpoch===(this._ctEpoch || 0) && this._ctAbort===controller;
                openingCurrent=()=>openingOwns() && !signal.aborted;
                // Identify an incoming private local workspace before language watchers
                // run, so they do not list/migrate unrelated durable SD drafts.
                // Its contents and editor remain unloaded until selection settles.
                this.ctWorkspace = { scope: copy(scope), metadata: metadata || {} };
                this.ctBusy=true;this.ctError='';
                await this.ctInitializationStep('Selecting workbook language',async()=>{
                    const changed=this.lang!==scope.language;
                    if(changed)this.lang=scope.language;
                    // Flush language watchers while the outgoing workspace is
                    // closed, then settle its personal Dictionary/settings scope
                    // before any incoming workspace reads or activation.
                    await this.$nextTick?.();const switched=await this._cloudLanguageSwitch;
                    if(!openingCurrent())throw Object.assign(new Error('ClientText opening was cancelled or superseded.'),{stale:true,name:'AbortError'});
                    if(this.lang!==scope.language || changed && switched===false)throw new Error('Could not select the workbook language. Check Settings, then open the workbook again.');
                },initialization);
                if(!openingCurrent())return false;
                ctx = this.ctContext();const current=()=>openingCurrent() && this.ctCurrent(ctx) && this.lang===scope.language,check=()=>{if(!current())throw Object.assign(new Error('ClientText opening was cancelled or superseded.'),{stale:true,name:'AbortError'});};
                this.ctBusy = true; this.ctError = '';
                this._collaboration?.disconnect(); this._collaboration = null; this._collabKey = '';
                this.clearEditorToolsFile?.();
                    const [units, saved, drafts] = await this.ctInitializationStep('Loading cached translations',async report=>{
                        const result=await Promise.all([store.getUnits(scope,{guard:current,onProgress:progress=>report({...progress,completed:progress.completed ?? progress.processed})}), store.getSaved(scope,{guard:current}),store.getDraftSummaries?.(scope,{guard:current})]);check();return result;
                    },initialization);
                    check();
                    root.ClientTextCodec?.assertGame({units},scope.game);
                    this.ctLocalDraftState=test?'stored':'';this.ctUnits = raw(units); this._ctUnitIndex = raw(new Map(units.map(unit => [unit.id, unit]))); this.ctSaved = raw(saved);this.ctDraftSummaries=raw(drafts || []); this.ctRevision++;
                    const visibleUnits=units.filter(unit=>this.ctFieldsFor(unit).length);
                    this.ctRebuildSheets(visibleUnits);
                    this._ctWorkUnits=raw(new Map(units.filter(unit=>unit.fields.some(field=>field.originalMissing || field.outdated) || saved[unit.id]?.outdated?.length).map(unit=>[unit.id,unit])));
                    this.ctSheet = visibleUnits.length ? JSON.stringify([visibleUnits[0].role, visibleUnits[0].sheet]) : ''; this.ctPage = 1;
                    this.ctDiagnostics = raw({}); this.ctScanDone = false; this.ctSearch = ''; this.ctAppliedSearch = '';
                    await this.ctInitializationStep('Preparing context references',async()=>{
                        const index=await root.ContentAdapters.clienttext.contextReferenceIndex(units,{guard:current});check();
                        this._ctReferenceIndexCache={units:this.ctUnits,workspace:this.ctWorkspace,index};
                        const npcIndex=await root.ClientTextNpcIndex.buildNpcIndex(units,{guard:current,signal});check();
                        const convoIndex=await root.ClientTextConvoIndex.buildConvoIndex(units,npcIndex,{guard:current,signal});check();
                        this._ctNpcIndex=raw(npcIndex);this._ctConvoIndex=raw(convoIndex);this.ctRevision++;
                    },initialization);
                    await this.ctInitializationStep('Preparing Dictionary matches',async()=>{
                        await this.$nextTick?.();check();await this._cloudLanguageSwitch;check();
                        if(test){
                            if(await this.flushScheduledSettingsSave?.()===false)throw new Error('Save pending settings before opening a test sheet.');
                            check();if(!this.ctResourceSyncEnabled)this.ctBeginTestDictionary(scope);
                            const memory=this.testMode ? {units:[]} : await this._ctStore.getMemory({accountId:scope.accountId,game:scope.game,language:scope.language},{guard:current});check();
                            await store.seedMemory(scope,memory.units,{guard:current});check();
                            if(this.ctResourceSyncEnabled){await this.loadTranslationMemory?.();check();this._cloud?.schedule(0);}
                        }
                        await this.ensureDictionarySnapshot?.();check();
                    },initialization);
                    await this.ctInitializationStep('Opening ClientText workspace',async()=>{
                    check();this.ctActive = true; this.versionChooserVisible = false; this.editorVisible = false;
                    if(test){this._ctTestTool=this.ctTool;this._ctTestFilters=this.ctSelectedFilters.slice();this.ctSelectedFilters=[...statusFilters.map(item=>item.key),'mtl'];}
                    const memory=()=>{if(this.ctCurrent(ctx) && this.ctActive)return this.ctLoadMemory(ctx);};
                    if(this.queueWorkspaceBackground)this.queueWorkspaceBackground('clienttext-memory',memory);else setTimeout(memory,0);
                    this.activeContentGroup = metadata?.group || { id: scope.groupId, contentMode: 'clienttext' };
                    const mtl=()=>{if(this.ctCurrent(ctx) && this.ctActive)return this.ctMtlActivate?.(ctx);};
                    if(this.queueWorkspaceBackground)this.queueWorkspaceBackground('clienttext-mtl',mtl);else mtl();
                    if (this.managedOnlineAvailable && (this.cloudCanAccessAllLanguages || scope.language===this.cloudUser?.language) && !String(scope.groupId).startsWith('local:')) {
                        const request = (path, options) => this._cloud.request(path, options);
                        this._ctSync = root.ClientTextSync.create({ scope, store: this._ctStore, request, isCurrent: () => this.ctCurrent(ctx) && this.ctActive });
                        const background=()=>{if(this.ctCurrent(ctx) && this.ctActive)this.ctSync(ctx);};
                        if(this.queueWorkspaceBackground)this.queueWorkspaceBackground('clienttext-sync',background);else background();
                        this._ctSyncTimer = setInterval(() => { if (!root.document.hidden) this.ctSync(ctx); }, 20000);
                    }
                    await this.$nextTick?.();check();this.ctRefreshLayout();return true;
                    },initialization);return true;
                } catch (error) {
                    if ((!ctx && (openingCurrent ? openingCurrent() : openingKey===this.managedCatalogScope) || ctx && this.ctCurrent(ctx)) && !error.stale && error.name!=='AbortError') this.ctError = error.message;
                    // Keep the pending identity for the importer to recover its
                    // exact originals after a failed language selection.
                    return false;
                }
                finally {
                    if (openingOwns?.() && (!ctx || this.ctCurrent(ctx))) {
                        this.ctBusy = false;
                        if(test && !this.ctActive)this.ctEndTestDictionary();
                    }
                    this.ctFinishInitialization(initialization);
                }
            },
            async ctOpenCached(row) { const scope = this._ctStore.normalizeScope(row.scope || row); return this.ctActivate(scope, row.metadata || row); },
            async ctRefreshSharedSaved(ctx,sync=this._ctSync) {
                const saved = await this._ctStore.getSaved(ctx.scope);
                if (!this.ctCurrent(ctx)||this._ctSync!==sync) return;
                const affected = [...new Set([...Object.keys(saved),...Object.keys(this.ctSaved)])].filter(id => JSON.stringify(saved[id]) !== JSON.stringify(this.ctSaved[id]));
                if(affected.length){
                    const next={...this.ctSaved};for(const id of affected){if(saved[id])next[id]=saved[id];else delete next[id];
                        if(saved[id]?.outdated?.length){const unit=this._ctUnitIndex.get(id);if(unit)this._ctWorkUnits.set(id,unit);}}
                    this.ctSaved=raw(next);this.ctRevision++;this.ctRefreshDiagnostics(affected);this.ctLoadMemory(ctx);
                    if(affected.includes(this.ctSelection) && this.ctCurrentUnit && !this.ctDraftDirty){this.ctValues=root.ClientTextState.valuesFor(this.ctCurrentUnit,saved[this.ctSelection]);this.ctReviewed={...saved[this.ctSelection]?.reviewed};this.ctChoices=copy(saved[this.ctSelection]?.conflicts||[]);this._ctEditRevision=saved[this.ctSelection]?.revision||0;}
                }
                return true;
            },
            async ctSync(ctx = this.ctContext()) {
                if (!this._ctSync || !this.ctCurrent(ctx)) return;
                const sync=this._ctSync;if(this._ctSyncRun?.sync===sync)return this._ctSyncRun.promise;
                const operation=(async()=>{
                    try {
                        if(!this.ctPolicy?.clientTextStorageProtocols?.includes(trustedProtocol))await this.ctRequireTrustedProtocol();
                        if(!this.ctCurrent(ctx)||this._ctSync!==sync)return;
                        const flushed=await sync.flush();if(!this.ctCurrent(ctx)||this._ctSync!==sync)return;
                        await sync.pull();if(!this.ctCurrent(ctx)||this._ctSync!==sync)return;
                        if(!await this.ctRefreshSharedSaved(ctx,sync))return;
                        const issue=sync.snapshot?.().error || (flushed?.conflicts?'Shared translation conflicts require a reviewed choice.':'');
                        if(issue){this._ctSyncError=issue;this.ctError=issue;}
                        else {if(this.ctError===this._ctSyncError)this.ctError='';this._ctSyncError='';}
                        await this.ctPresence(ctx);
                        await this.ctMtlSync?.(ctx);
                    } catch (error) { if (this.ctCurrent(ctx) && !error.stale){
                        let message=error.message;
                        try{await this.ctRefreshSharedSaved(ctx,sync);}catch(readError){message+=' Local saved state could not be refreshed: '+readError.message;}
                        if(this.ctCurrent(ctx) && this._ctSync===sync){this._ctSyncError=message;this.ctError=message;}
                    } }
                })();
                const run={sync,promise:operation};this._ctSyncRun=run;
                try{return await operation;}finally{if(this._ctSyncRun===run)this._ctSyncRun=null;}
            },
            async ctSelect(unit, full = false, options = {}) {
                if (!unit || this.ctBusy || this.ctBrowseBusy || this._ctUnitIndex?.get(unit.id)!==unit || this.hideDNT && !this.ctFieldsFor(unit).length) return false;
                const ctx = this.ctContext(),generation=this._ctBrowseGeneration || 0,run=this._ctSelectRun={unitId:unit.id,ctx,generation,full,pending:true};
                const current=()=>{
                    const valid=this.ctCurrent(ctx) && this._ctSelectRun===run && this._ctUnitIndex?.get(unit.id)===unit
                        && generation===(this._ctBrowseGeneration || 0) && (!this.hideDNT || this.ctFieldsFor(unit).length>0)
                        && (!options.guard || options.guard());
                    if(!valid && this._ctSelectRun===run)run.pending=false;
                    return valid;
                };
                if(this.ctSelection===unit.id){
                    this.ctEditor=run.full;this.ctInlineClosed=false;if(run.full && this.ctTool==='preview')this.ctTool='dictionary';await this.$nextTick?.();if(!current())return false;
                    run.pending=false;this.ctRefreshLayout();if(options.focus!==false && (run.full || this.inlineEditor))this.ctFocusTarget(false,null);return true;
                }
                // A pointer row switch owns the outgoing automatic save. Blur
                // waits for the click, so it cannot close the row or swallow
                // that click behind ctBusy while the pointer is still down.
                if(options.saveInline && this.ctInlineUnitVisible() && this.ctHasEditorChanges()){
                    if(!await this.ctSave() || !current()){run.pending=false;return false;}
                }
                if (!await this.ctFlushDraft()) {run.pending=false;return false;}
                if(!current())return false;
                await this.ctFlushCommentDraft();
                if(!current())return false;
                this.ctBusy=true;let draft;
                try{draft=await this.ctStorage(ctx.scope).getDraft(ctx.scope,unit.id);}catch(error){run.pending=false;if(current())this.ctError=error.message;return false;}finally{if(this.ctCurrent(ctx) && this._ctSelectRun===run)this.ctBusy=false;}
                if(!current())return false;
                this.ctSelection = unit.id; this.ctEditor = run.full;this.ctInlineClosed=false;this._ctInlineReturn=null; this.ctLookup = ''; this.ctCompletion=null;this.ctCommentText='';this.ctCommentGlobal=false;
                if(run.full && this.ctTool==='preview')this.ctTool='dictionary';
                this.ctPreviewGggVars={};this.ctPreviewAffixes=previewAffixesFor(unit);
                this.ctValues = root.ClientTextState.valuesFor(unit, this.ctSaved[unit.id]); this.ctReviewed = { ...(this.ctSaved[unit.id]?.reviewed || {}) }; this.ctDraftDirty = false;this.ctDraftStageFailure=null;
                this.ctChoices = copy(this.ctSaved[unit.id]?.conflicts || []); this._ctEditRevision = this.ctSaved[unit.id]?.revision || 0;
                this._ctDraftRevision = draft?.revision || null;
                if (draft?.values) { this.ctValues = { ...this.ctValues, ...draft.values }; this.ctReviewed = { ...this.ctReviewed, ...draft.reviewed }; this.ctDraftDirty = true;this.ctLocalDraftState='checkpointed'; }
                await this.ctMtlLoadReviews?.(unit);if(!current())return false;
                this.ctMtlRestoreAcceptances?.(draft);
                this.ctInitializeVariants(unit);const displayed=this.ctDisplayedFields(unit);
                this.ctFocusedField=this.ctTabFields(unit).find(field=>displayed.includes(field))?.id || '';
                this.ctResetHistory(); this.ctComments = [];
                this.ctLoadHistory(ctx, unit.id); this.ctPresence(ctx);
                this.scheduleClientTextDictionaryMatches();this.ctRefreshDraftSummaries(ctx);
                this.ctLoadCommentDraft(ctx,unit.id);
                await this.$nextTick?.();if(!current() || this.ctSelection!==unit.id)return false;
                // Opening starts at the first worksheet cell through the same
                // focus path used by Tab navigation.
                run.pending=false;this.ctRefreshLayout();if(options.focus!==false && (run.full || this.inlineEditor))this.ctFocusTarget(false,null);return true;
            },
            ctEditorElement() {
                const refs=this.$refs?.ctEditorRegion,ref=Array.isArray(refs)?refs[0]:refs,region=ref?.$el || ref;
                return region;
            },
            ctTargetInputs() {
                const inputs=[...(this.ctEditorElement()?.querySelectorAll?.('[data-ct-target]') || [])],displayed=this.ctDisplayedFields();
                return this.ctTabFields().map(field=>inputs.find(input=>input.dataset.ctTarget===field.id))
                    .filter(input=>input && displayed.some(field=>field.id===input.dataset.ctTarget) && input.isConnected!==false
                        && !input.disabled && !input.closest?.('[inert]') && (!input.getClientRects || input.getClientRects().length));
            },
            ctCaptureCaret(input) {
                return Number.isInteger(input?.selectionStart) ? {start:input.selectionStart,end:input.selectionEnd,direction:input.selectionDirection} : null;
            },
            ctFocusTarget(last=false,fieldId=last?null:this.ctFocusedField,caret=null) {
                const fields=this.ctTabFields(),field=fields.find(field=>field.id===fieldId) || fields[last?fields.length-1:0];
                if(!field || this.ctKeyboardBlocked())return false;
                const ctx=this.ctContext(),unit=this.ctCurrentUnit,selectionRun=this._ctSelectRun,full=this.ctEditor,generation=this._ctBrowseGeneration || 0,
                    run=this._ctFieldFocusRun={},changed=this.ctRevealTarget(field),active=root.document?.activeElement;
                this.ctFocusedField=field.id;
                const focus=()=>{
                    if(this._ctFieldFocusRun!==run || !this.ctCurrent(ctx) || generation!==(this._ctBrowseGeneration || 0) || this.ctCurrentUnit!==unit || this._ctSelectRun!==selectionRun
                        || this.ctEditor!==full || this.ctFocusedField!==field.id || this.ctKeyboardBlocked())return false;
                    const input=this.ctTargetInputs().find(input=>input.dataset.ctTarget===field.id);if(!input)return false;
                    input.focus?.();
                    if(caret && input.setSelectionRange){const length=String(input.value ?? '').length;
                        input.setSelectionRange(Math.min(caret.start,length),Math.min(caret.end,length),caret.direction || 'none');}
                    return true;
                };
                if(!changed && focus())return true;
                if(this.$nextTick){this.$nextTick(()=>{
                    const nextActive=root.document?.activeElement;
                    if(nextActive && nextActive!==active && nextActive!==root.document?.body && nextActive!==root.document?.documentElement)return;
                    if(focus())this.ctRefreshLayout();
                });return true;}
                return false;
            },
            ctKeyboardOverlayOpen() {
                return !!(root.AppDialogs?.isOpen
                    || this.ctToneWindow || this.versionChooserVisible || this.settingsDialogVisible || this.showSetting || this.ctUploadVisible
                    || this.$refs?.ctExportDialog?.open || this.ctDiagnosticDialog()?.open || this.workspaceInitializationActive || this._importingSource
                    || this.cloudResolverVisible || this.cloudHistoryVisible || this.settingsImportDraft || this.draftRecoveryVisible);
            },
            ctKeyboardBlocked() {
                return !this.ctActive || this.ctBusy || this.ctBrowseBusy || this._ctSelectRun?.pending || this.ctHistoryViewer || this.ctKeyboardOverlayOpen();
            },
            ctKeyboardTarget(field,input) {
                const current=this.ctCurrentUnit?.fields.find(item=>item.id===field?.id),region=this.ctEditorElement();
                if(!current || !this.ctTabFields().includes(current) || !this.ctDisplayedFields().includes(current) || current.source!==field.source || current.kind!==field.kind
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
                const region=this.ctEditorElement(),targets=this.ctTabFields(),stops=[...targets,...this.ctFullTabControls()],
                    index=input.dataset?.ctTarget ? targets.findIndex(field=>field.id===input.dataset.ctTarget) : stops.indexOf(input);
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
                if(targets.includes(next))return this.ctFocusTarget(false,next.id);
                next.focus?.();return true;
            },
            ctFieldsKeydown(event) {
                if(this.ctFormattingKeydown?.(event))return;
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
                const fields=[...(area?.querySelectorAll?.('textarea') || []),...(area?.querySelectorAll?.('.ctSourceDiff') || [])],scrolls=new Map(fields.map(field=>[field,field.scrollTop]));
                for(const field of fields)field.style.height='auto';
                const heights=new Map(fields.map(field=>[field,field.scrollHeight+2])),groups=new Map();
                for(const block of area?.querySelectorAll?.('.ctBlock:not(.ctFormBlock)') || []){
                    const key=block.dataset.fieldGroup;
                    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(block);
                }
                for(const blocks of groups.values()){
                    const sources=blocks.flatMap(block=>[...block.querySelectorAll('textarea[data-ct-source]'),...block.querySelectorAll('.ctSourceDiff')]);
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
                if(this.ctMtlCandidate?.(field))return;
                this.ctMtlUnderlyingEdited?.(field);
                this.ctReviewed[field.id] = this.ctReviewHash(field);
                this.ctDraftStageFailure=null;this.ctDraftDirty = true; this.ctQueueDraft();
            },
            ctGenderSuggestions(field) {
                const original=field.target,suggestions=this.ctGenderDefaults();
                return typeof original==='string' && original!=='' && !/[\r\n]/.test(original) && !suggestions.includes(original)
                    ? [...suggestions,original] : suggestions.slice();
            },
            ctGenderDefaults() { return (this.ctWorkspace?.scope.language || this.lang)==='Russian' ? russianGenderSuggestions : genderSuggestions; },
            ctGenderSuggestionLabel(value,field) {
                if(this.ctGenderDefaults().includes(value))return value;
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
            ctEnglishEligible(field) {
                return this.gameVersion==='poe2' && root.ClientTextState.englishEligible(field) && !isDNTSource(field.source)
                    && (this.ctOfflineTest || this.ctPolicy?.clientTextEnglishIntent===root.ClientTextState.ENGLISH_INTENT_PROTOCOL && this.ctPolicy?.clientTextEnglishEligibility===root.ClientTextState.ENGLISH_ELIGIBILITY_PROTOCOL);
            },
            ctEnglishUnavailableReason(field) {
                if(this.gameVersion!=='poe2')return 'Use English is unavailable for PoE1. Ordinary translations and blank saves remain allowed.';
                if(field.kind==='gender')return 'Use English is unavailable for Gender metadata.';
                if(this.ctClassEnglishField(field))return 'Blank dialogue class variants use the generic defaults where available, otherwise English. Review the defaults and populated variants, then Save. Incomplete defaults retain blank-variant review.';
                if(field.kind==='form')return 'Use English is unavailable for grammatical and class forms until their fallback behavior is verified.';
                if(isDNTSource(field.source))return 'Use English is unavailable for DNT fields.';
                if(!root.ClientTextState.englishEligible(field))return 'Use English requires an ordinary field with active English source text.';
                if(!this.ctEnglishEligible(field))return 'Use English requires a compatible shared-service update.';
                return '';
            },
            ctPendingSharedRecovery() { return this.ctSaved[this.ctSelection]?.syncRecovery || null; },
            ctEnglishWitness(actions) {return {protocol:root.ClientTextState.ENGLISH_ELIGIBILITY_PROTOCOL,fields:Object.fromEntries(Object.keys(actions).map(id=>{const field=this.ctCurrentUnit.fields.find(field=>field.id===id);return [id,{sourceHash:this.ctReviewHash(field),eligible:root.ClientTextState.englishEligible(field) && !isDNTSource(field.source)}];}))};},
            ctEnglishDecision(field) { return this.ctSaved[this.ctSelection]?.englishIntent?.[field.id] || this.ctSaved[this.ctSelection]?.provenance?.englishIntent?.[field.id]; },
            ctUsesEnglish(field,unit=this.ctCurrentUnit) { return root.ClientTextState.englishIntentFor(field,this.ctSaved[unit?.id],{game:this.gameVersion}); },
            ctEnglishDraftEligible(field) {
                const value=String(this.ctValues[field.id] ?? '');
                return !value.trim() || value===field.source;
            },
            ctEnglishRemovesDecision(field) {
                const decision=this.ctEnglishDecision(field);
                return this.ctUsesEnglish(field) || !this.ctEnglishEligible(field) && !!decision && decision.state!=='revoked';
            },
            ctEnglishActionReason(field,revoke=this.ctEnglishRemovesDecision(field)) {
                if(!this.ctActive || !this.ctCurrentUnit?.fields.includes(field))return 'This field is no longer active. Return to the current record before changing Use English.';
                if(this.ctPendingSharedRecovery())return 'Resolve the shared conflict or rejected save before changing Use English.';
                if(this.ctChoices?.length)return 'Resolve the translation alternatives before changing Use English.';
                if(this._ctSaveJob)return 'Finish or resolve the pending save before changing Use English.';
                if(this.ctBusy || this.ctBrowseBusy)return 'Wait for the current ClientText operation to finish before changing Use English.';
                if(this.ctRecoveryBusy)return 'Wait for recovery to finish before changing Use English.';
                if(this.ctHistoryViewer)return 'Close the history viewer before changing Use English.';
                if(this.ctMtlBusy?.(field))return 'Wait for machine translation to finish or stop it before changing Use English.';
                if(this.ctMtlCandidate?.(field))return 'Accept or dismiss the machine-translation candidate before changing Use English.';
                if(revoke)return this.ctEnglishDecision(field) && this.ctEnglishDecision(field).state!=='revoked' ? '' : 'There is no Use English decision to remove.';
                return this.ctEnglishUnavailableReason(field) || (this.ctEnglishDraftEligible(field) ? '' : 'Use English is available only when the current translation is blank or exactly matches English. A different translation cannot be replaced by Eng.');
            },
            ctEnglishHint(field) {
                const blocked=this.ctEnglishActionReason(field);if(blocked)return blocked;
                if(this.ctUsesEnglish(field))return 'Use English is active. This field is resolved and exports blank. Activate to require translation and save this ID. Previous text remains in history.';
                const unavailable=this.ctEnglishUnavailableReason(field);
                if(unavailable)return unavailable+(this.ctEnglishDecision(field) && this.ctEnglishDecision(field).state!=='revoked'?' Activate to remove the previous decision and save this ID.':'');
                return 'Use English: intentionally resolve this field using its current English source and export it blank. Saves this ID; previous text remains in history.'+(this.ctEnglishDecision(field)?.state==='needs_review'?' The previous decision needs review; activate to approve this source.':'');
            },
            ctEnglishOffer(field) { return this.ctEnglishEligible(field) && !this.ctUsesEnglish(field) && this.ctValues[field.id]===field.source; },
            async ctChooseEnglish(field,revoke=false) {
                if(this.ctEnglishActionReason(field,revoke))return false;
                const action={action:revoke?'revoke':'set',sourceHash:this.ctReviewHash(field),previousValue:String(this.ctValues[field.id] ?? '')};
                return this.ctSave(false,{englishActions:{[field.id]:action},englishValues:{...this.ctValues,...(!revoke?{[field.id]:''}:{})},englishReviewed:{...this.ctReviewed,...(!revoke?{[field.id]:this.ctReviewHash(field)}:{})}});
            },
            async ctResolveSharedPending(mode) {
                if(this.ctRecoveryBusy)return false;const run=this._ctRecoveryRun={};this.ctRecoveryBusy=true;
                try{return await this.ctResolveSharedPendingAction(mode);}finally{if(this._ctRecoveryRun===run){this._ctRecoveryRun=null;this.ctRecoveryBusy=false;}}
            },
            async ctResolveSharedPendingAction(mode) {
                if(this.ctBusy || this.ctHistoryViewer || !['accept-peer','reapply'].includes(mode))return false;
                if(this._ctSaveJob){this.ctError='Retry Save to confirm its receipt before resolving shared work.';return false;}
                const ctx=this.ctContext(),unitId=this.ctSelection,store=this.ctStorage(ctx.scope),scopeKey=root.ClientTextStore.scopeKey(ctx.scope);
                const retry=this._ctRecoveryJob?.unitId===unitId && this._ctRecoveryJob.scopeKey===scopeKey?this._ctRecoveryJob:null;let pending;
                if(retry && mode!=='accept-peer'){this.ctError='Retry accepting the shared version first to confirm its receipt.';return false;}
                try{if(!retry)pending=await store.getPendingRecovery(ctx.scope,unitId);}catch(error){if(this.ctCurrent(ctx))this.ctError=error.message;return false;}
                if(!this.ctCurrent(ctx) || this.ctSelection!==unitId || !pending && !retry)return false;
                if(mode==='reapply'){
                    const actions=copy(pending.englishActions || pending.requestBody?.englishActions || {}),values=copy(pending.requestBody?.values || pending.values),reviewed=copy(pending.reviewed || {});
                    for(const [id,action]of Object.entries(actions)){const field=this.ctCurrentUnit.fields.find(field=>field.id===id);action.sourceHash=this.ctReviewHash(field);if(action.action==='set'){values[id]='';reviewed[id]=action.sourceHash;}}
                    return this.ctSave(false,{englishValues:values,englishReviewed:reviewed,...(Object.keys(actions).length?{englishActions:actions}:{}),pendingResolution:{mode:'reapply',mutationId:pending.mutationId,editorBeforeValues:copy(this.ctValues)}});
                }
                if(this.ctDraftDirty && !await this.ctFlushDraft())return false;
                const job=this._ctRecoveryJob=retry || {jobId:uuid(),unitId,scopeKey,mutationId:pending.mutationId,expectedRevision:this.ctSaved[unitId]?.revision || this._ctEditRevision};this.ctBusy=true;
                try{
                    const result=await store.acceptPendingPeer(ctx.scope,unitId,job);
                    const latest=await store.getSaved(ctx.scope);if(latest[unitId]?.revision>=result.saved.revision)result.saved=latest[unitId];
                    if(!this.ctCurrent(ctx)||this.ctSelection!==unitId)return false;
                    this.ctSaved=raw({...this.ctSaved,[unitId]:result.saved});this._ctEditRevision=result.saved.revision;this.ctChoices=copy(result.saved.conflicts || []);this.ctRevision++;
                    if(!this.ctDraftDirty){this.ctValues=copy(result.saved.values);this.ctReviewed=copy(result.saved.reviewed);}
                    this._ctRecoveryJob=null;this.ctError='';this.ctLoadHistory(ctx,unitId);this.ctSync(ctx);return true;
                }catch(error){if(this.ctCurrent(ctx)){this.ctError=error.message;if(error.code==='CLIENTTEXT_PENDING_RESOLUTION_REQUIRED')this._ctRecoveryJob=null;}return false;}
                finally{if(this.ctCurrent(ctx))this.ctBusy=false;}
            },
            ctMarkReviewed(field,event) {
                if(this.ctBusy || this.ctHistoryViewer || this.ctMtlBusy?.(field) || this.ctMtlCandidate?.(field))return false;
                // The action disappears after review. Retain focus in the
                // editor so its removal cannot trigger a leave-row save.
                if(event?.currentTarget && event.currentTarget===root.document?.activeElement)
                    this.ctTargetInputs().find(input=>input.dataset?.ctTarget===field.id)?.focus?.({preventScroll:true});
                this.ctReviewed[field.id] = this.ctReviewHash(field); this.ctDraftStageFailure=null;this.ctDraftDirty = true; this.ctQueueDraft();
            },
            ctChoiceDisabled(choice) {
                const field=this.ctCurrentUnit?.fields.find(field=>field.id===choice?.fieldId);
                return !this.ctActive || this.ctBusy || this.ctHistoryViewer || !field || !!this.ctMtlBusy?.(field);
            },
            ctChooseAlternative(choice, side) {
                if(this.ctChoiceDisabled(choice) || !this.ctChoices.includes(choice) || !['local','remote'].includes(side))return false;
                const field=this.ctCurrentUnit.fields.find(field=>field.id===choice.fieldId);
                this.ctValues[field.id]=side==='local'?choice.local:choice.upstream??choice.remote;
                this.ctChoices=this.ctChoices.filter(item=>item!==choice);this.ctEdited(field);return true;
            },
            ctCompleteForm(field, event) {
                if(this.ctMtlBusy?.(field) || event.isComposing || event.keyCode===229)return;
                if(event.key==='Escape'){if(this.ctCompletion){event.preventDefault();event.stopPropagation?.();}this.ctCloseCompletion();return;}
                const plain=!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
                if(this.ctCompletion && !this.ctCompletionValid(field,event.target))this.ctCloseCompletion();
                if(this.ctCompletion && plain && ['ArrowDown','ArrowUp'].includes(event.key)){
                    event.preventDefault();event.stopPropagation?.();
                    const completion=this.ctCompletion,count=completion.items.length;
                    completion.selectedIndex=(completion.selectedIndex+(event.key==='ArrowDown'?1:-1)+count)%count;
                    this.ctSyncCompletionSelection();return;
                }
                if(this.ctCompletion && event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.key==='Enter'){
                    event.preventDefault();event.stopPropagation?.();this.ctEditCompletionDictionary(field,this.ctCompletion.items[this.ctCompletion.selectedIndex],event.target);return;
                }
                if(this.ctCompletion && plain && ['Tab','Enter'].includes(event.key)){
                    event.preventDefault();event.stopPropagation?.();const item=this.ctCompletion.items[this.ctCompletion.selectedIndex];
                    if(event.key==='Enter')this.ctCompletionEnter(field,item,event.target);else this.ctApplyCompletion(field,item,event.target);return;
                }
                if(this.ctCompletion && (event.key==='Tab' || event.key==='Enter' || ['ArrowLeft','ArrowRight','Home','End','PageUp','PageDown'].includes(event.key)))this.ctCloseCompletion();
                const current=this.ctCurrentUnit?.fields.find(item=>item.id===field.id);
                if (!root.ClientTextState.allowsNonexistent(field) || event.key !== 'Tab' || !plain || !this.ctActive || this.ctBusy
                    || this.ctHistoryViewer || this.versionChooserVisible || this.settingsDialogVisible || this.showSetting || this.ctDiagnosticDialog()?.open
                    || !current || current.source!==field.source || current.kind!==field.kind) return;
                const value = (this.ctInputValues || this.ctValues)[field.id];
                const caret=event.target?.selectionStart,end=event.target?.selectionEnd;
                if (value && 'NONEXISTENT'.startsWith(value.toUpperCase()) && value !== 'NONEXISTENT'
                    && (!Number.isInteger(caret) || caret===value.length && end===caret)) { event.preventDefault(); (this.ctInputValues || this.ctValues)[field.id] = 'NONEXISTENT'; this.ctEdited(field); }
            },
            ctTargetKeydown(field,event) {
                if(event.defaultPrevented || event.isComposing || event.keyCode===229 || this.ctKeyboardBlocked()
                    || !this.ctKeyboardTarget(field,event.target))return;
                if(this.ctFormattingKeydown?.(event))return;
                const shortcut=this.autocompleteShortcut==='ctrl-i'
                    ? event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && (event.code==='Space' || event.key===' ')
                    : this.isAutocompleteShortcut ? this.isAutocompleteShortcut(event)
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
                const fields=this.ctTabFields(),index=fields.findIndex(field=>field.id===event.target.dataset.ctTarget),direction=event.shiftKey?-1:1;
                if(index<0)return;
                if(this.ctEditor){
                    if(this.ctMoveFullTab(event.target,direction)){event.preventDefault();event.stopPropagation?.();}return;
                }
                event.preventDefault();event.stopPropagation?.();this.ctCloseCompletion();
                const next=fields[index+direction];
                if(next)return this.ctFocusTarget(false,next.id);
                return this.ctSaveAndNavigate(direction<0,{inline:true,focusEnd:direction<0});
            },
            ctCloseCompletion() {this.ctCompletion=null;this._ctCompletionInput=null;if(this._ctPendingDictionaryPack){this.ctDictionaryPack=this._ctPendingDictionaryPack;this._ctPendingDictionaryPack=null;}},
            ctCompletionValid(field,input=this._ctCompletionInput) {
                const completion=this.ctCompletion,current=this.ctCurrentUnit?.fields.find(item=>item.id===field?.id);
                return !!(completion && completion.items?.length && this.ctActive && !this.ctBusy && !this.ctHistoryViewer
                    && !this.versionChooserVisible && !this.settingsDialogVisible && !this.showSetting && !this.ctDiagnosticDialog()?.open
                    && completion.fieldId===field?.id && completion.unitId===this.ctSelection && this.ctCurrent(completion.context)
                    && unproxy(completion.unit)===unproxy(this.ctCurrentUnit) && unproxy(completion.field)===unproxy(current)
                    && current && this.ctFieldsFor().includes(current) && current.kind!=='gender' && current.source===completion.source
                    && (!this.ctFocusedField || this.ctFocusedField===field.id) && (this.ctInputValues || this.ctValues)[field.id]===completion.text
                    && input && input.isConnected!==false && !input.composing && input.selectionStart===completion.selectionStart && input.selectionEnd===completion.selectionEnd
                    && (typeof input.value!=='string' || input.value===completion.text.replace(/\r\n?/g,'\n')));
            },
            ctCompletionSelectionChanged(field,event) {
                if(this.ctCompletion && !this.ctCompletionValid(field,event.target))this.ctCloseCompletion();
            },
            ctCompletionItems(field,openedByChar='',prefix='') {
                const tokens=root.ClientTextState.suggestions(field,{openedByChar}),sourceTokens=root.ClientTextState.tokenize(field.source),items=[],seen=new Map();
                const add=item=>{const identity=item.dictionaryKey ? item.dictionaryKey+':'+item.value : item.value,existing=seen.get(identity);if(existing){
                    for(const range of item.sourceRanges || [])if(!existing.sourceRanges.some(value=>value.start===range.start && value.end===range.end))existing.sourceRanges.push(range);
                    if(item.exactFromContext && !existing.exactFromContext)Object.assign(existing,{exact:true,exactMatch:true,exactFromContext:true,isAlt:false,kwDynamicContent:item.kwDynamicContent});
                }else{seen.set(identity,item);items.push(item);}};
                const entries=this.getActiveDictionaryEntries?.() || this.dictionary || [];
                for(const token of tokens){
                    const sourceRanges=sourceTokens.filter(source=>root.ClientTextState.tokenInsertion(source,field.source).value===token.value || source.kind==='variable' && openedByChar==='{' && source.full.slice(source.prefix.length)===token.value)
                        .map(source=>({start:source.start,end:source.end}));
                    const base={...token,sourceRanges};
                    const keyword=/^\[([^\]|]+)(?:\|([^\]]*))?\]$/.exec(token.value);
                    if(keyword){
                        const identity=keyword[1],name=this.ctDictionaryKeywordName(identity),lookup=name.toLocaleLowerCase(),dynamic=keyword[2] || '',sourceFind=(dynamic || name).trim().toLocaleLowerCase();
                        const candidates=[];let associated;
                        for(const entry of entries){
                            if(String(entry?.find ?? '').trim().toLocaleLowerCase()!==lookup || this.isDictionaryEntryActive && !this.isDictionaryEntryActive(entry))continue;
                            associated ||= entry;const pairs=this.ctDictionaryPairs(entry);
                            for(const pair of pairs){
                                const display=pair.replace;if(typeof display!=='string' || !display.trim() || /[\[\]]/.test(display))continue;
                                const exact=String(pair.find ?? '').trim().toLocaleLowerCase()===sourceFind;
                                candidates.push({value:'['+identity+'|'+display+']',label:'['+identity+'|'+String(pair.find ?? '')+'] → ['+identity+'|'+display+']',dictEntryId:entry._id,tlnote:entry.tlnote || '',
                                    dictionaryKey:JSON.stringify([entry._id || entry.id || entry.find,pair._id || '',pair.find,display]),dictAltId:pair._id || '',
                                    exact,exactMatch:exact,exactFromContext:exact,isAlt:!exact,kwTagName:identity,kwDynamicContent:dynamic.includes('<')?'':dynamic,sourceRanges:sourceRanges.map(range=>({...range}))});
                            }
                        }
                        if(!candidates.some(item=>item.exactFromContext))add({...base,mustCreate:true,exactMatch:true,exactFromContext:true,
                            kwTagName:identity,kwDynamicContent:dynamic.includes('<')?'':dynamic,dictEntryId:associated?._id || '',
                            label:token.value+' → '+(associated?'create a new alternative...':'create a new dictionary entry...')});
                        candidates.sort((a,b)=>Number(b.exact)-Number(a.exact));for(const item of candidates)add(item);
                        continue;
                    }
                    add(base);
                }
                const query=prefix.toLocaleLowerCase();
                return items.filter(item=>!query || item.value.toLocaleLowerCase().startsWith(query) || item.label.toLocaleLowerCase().startsWith(query)).slice(0,100);
            },
            ctSuggest(field,event,options={}) {
                this.ctCloseCompletion();this._ctDictionaryReturn=null;
                if(!this.ctActive || this.ctBusy || this.ctHistoryViewer || this.ctMtlBusy?.(field) || event.isComposing || event.keyCode===229 || field.kind==='gender')return false;
                const current=this.ctCurrentUnit?.fields.find(item=>item.id===field.id),input=event.target,text=(this.ctInputValues || this.ctValues)[field.id];
                const caret=input?.selectionStart,selectionEnd=input?.selectionEnd;
                if(!current || !this.ctFieldsFor().includes(current) || current.source!==field.source || current.kind!==field.kind || typeof text!=='string'
                    || !Number.isInteger(caret) || !Number.isInteger(selectionEnd) || !options.manual && selectionEnd!==caret)return false;
                const rawCaret=root.EditorSession?.rawOffset(text,caret) ?? caret,rawEnd=root.EditorSession?.rawOffset(text,selectionEnd) ?? selectionEnd;
                const before=text.slice(0,rawCaret),match=selectionEnd===caret ? /([\[<{])([^\]\}>\r\n]*)$/.exec(before) : null;
                const wholeForm=root.ClientTextState.allowsNonexistent(field) && caret===text.length && selectionEnd===caret && 'NONEXISTENT'.startsWith(text.toUpperCase());
                let start=rawCaret,end=rawEnd,items;
                if(match){start=rawCaret-match[0].length;items=this.ctCompletionItems(field,match[1],match[0]);}
                else if(wholeForm && (text || options.manual)){start=0;end=text.length;items=options.manual && !text ? this.ctCompletionItems(field) : root.ClientTextState.suggestions(field).filter(item=>item.replaceWholeField);}
                else if(options.manual)items=this.ctCompletionItems(field).filter(item=>!item.replaceWholeField);
                else return false;
                if(!items.length)return false;
                this._ctCompletionInput=input;
                this.ctCompletion={fieldId:field.id,unitId:this.ctSelection,unit:this.ctCurrentUnit,field:current,context:this.ctContext(),source:current.source,text,
                    selectionStart:caret,selectionEnd,start,end,items,allItems:items.slice(),filter:'',selectedIndex:0};this.ctSyncCompletionSelection();return true;
            },
            ctApplyCompletion(field,item,input) {
                if(this.ctMtlBusy?.(field)){this.ctCloseCompletion();return false;}
                const completion=this.ctCompletion,target=input || this._ctCompletionInput;
                const entry=item?.dictEntryId ? (this.getDictionaryEntryById ? this.getDictionaryEntryById(item.dictEntryId)
                    : (this.dictionary || []).find(word=>String(word._id)===String(item.dictEntryId))) : null;
                if(!this.ctCompletionValid(field,target) || !completion.items.includes(item)
                    || item.dictEntryId && (!entry || this.isDictionaryEntryActive && !this.isDictionaryEntryActive(entry))
                    || item.replaceWholeField && (!root.ClientTextState.allowsNonexistent(field) || completion.start!==0 || completion.end!==completion.text.length)
                    || item.dictionaryKey && !(completion.allItems || completion.items).some(current=>current.value===item.value && current.dictionaryKey===item.dictionaryKey)){
                    this.ctCloseCompletion();return false;
                }
                if(root.EditorSession)return root.EditorSession.insert(this,field,item.value,{input:target,start:completion.start,end:completion.end,raw:true,caretOffset:item.caretOffset});
                const text=completion.text.slice(0,completion.start)+item.value+completion.text.slice(completion.end);
                (this.ctInputValues || this.ctValues)[field.id]=text;this.ctCloseCompletion();this.ctEdited(field);
                this.$nextTick?.(()=>{
                    if(!this.ctCurrent(completion.context) || this.ctSelection!==completion.unitId || (this.ctInputValues || this.ctValues)[field.id]!==text
                        || this.ctFocusedField && this.ctFocusedField!==field.id || target?.isConnected===false)return;
                    const caret=text.slice(0,completion.start+(item.caretOffset ?? item.value.length)).replace(/\r\n?/g,'\n').length;
                    target?.focus();target?.setSelectionRange(caret,caret);this.ctResizeField(target);
                });return true;
            },
            ctRememberDraftStageFailure(ctx,unitId,signature,operation) {
                if(!this.ctCurrent(ctx) || this.ctSelection!==unitId || !this.ctDraftDirty
                    || signature!==JSON.stringify([this.ctValues,this.ctReviewed]))return;
                this.ctDraftStageFailure=raw({context:copy(ctx),unitId,signature,operation});
            },
            ctClearDraftStageFailure(ctx,unitId,signature,operation) {
                const failure=this.ctDraftStageFailure;
                if(failure && this.ctCurrent(ctx) && this.ctCurrent(failure.context) && failure.unitId===unitId
                    && failure.signature===signature && (!operation || failure.operation===operation))this.ctDraftStageFailure=null;
            },
            ctQueueDraft() { if(this.ctOfflineTest)this.ctLocalDraftState='pending';clearTimeout(this._ctDraftTimer); this._ctDraftTimer = setTimeout(() => this.ctFlushDraft(), this.ctOfflineTest?0:250); },
            async ctFlushDraft() {
                clearTimeout(this._ctDraftTimer);
                if (!this.ctDraftDirty || !this.ctCurrentUnit || !this.ctWorkspace) return true;
                const ctx = this.ctContext(), unitId = this.ctSelection, values = copy(this.ctValues), reviewed = copy(this.ctReviewed);
                const mtlAcceptances=this.ctMtlCheckpointAcceptances ? this.ctMtlCheckpointAcceptances(unitId,values) : this.ctMtlAcceptances?.(unitId,values) || [];
                const store=this.ctStorage(ctx.scope);
                const localLease=store.captureLease?.(ctx.scope);
                const id=JSON.stringify([root.ClientTextStore.scopeKey(ctx.scope),unitId]),heads=this._ctDraftHeads ||= new Map();
                let head=heads.get(id);
                if(!head){head={revision:this._ctDraftRevision||null,pending:0,queue:Promise.resolve(),signature:null};heads.set(id,head);}
                else if(!head.pending && head.revision!==(this._ctDraftRevision||null)){head.revision=this._ctDraftRevision||null;head.signature=null;}
                const signature=JSON.stringify([values,reviewed,...(mtlAcceptances.length?[mtlAcceptances]:[])]);head.pending++;
                const attempt=head.attempts=(head.attempts || 0)+1;
                try {
                    const pending = head.queue.catch(()=>{}).then(async()=>{
                        if(head.signature===signature)return;
                        const saved = await store.putDraft(ctx.scope, unitId, { values, reviewed,...(mtlAcceptances.length?{mtlAcceptances}: {}) }, { expectedRevision: head.revision,...(localLease?{localLease}:{}) });
                        head.revision=saved.revision;head.signature=signature;
                        if(this.ctCurrent(ctx) && this.ctSelection===unitId){this._ctDraftRevision=saved.revision;this.ctRefreshDraftSummaries(ctx);}
                    });head.queue=pending;
                    this._ctDraftQueue=Promise.all([...heads.values()].map(value=>value.queue));this._ctDraftQueue.catch(()=>{});
                    await pending;
                    if(this.ctCurrent(ctx) && this.ctSelection===unitId && JSON.stringify([values,reviewed])===JSON.stringify([this.ctValues,this.ctReviewed])){
                        this.ctLocalDraftState='checkpointed';
                        const warning=this.ctCheckpointWarning;
                        if(warning && warning.head===head && warning.attempt<=attempt && warning.unitId===unitId && this.ctCurrent(warning.context)){
                            if(this.ctError===warning.message)this.ctError='';
                            this.ctCheckpointWarning=null;
                        }
                    }
                    this.ctClearDraftStageFailure(ctx,unitId,signature,'checkpoint'); return true;
                }
                catch (error) { if (this.ctCurrent(ctx)) {
                    this.ctLocalDraftState='failed';
                    const message=(this.ctOfflineTest?'Draft was not stored. Keep this tab open and download a recovery backup: ':'Draft was not stored: ') + error.message;
                    this.ctCheckpointWarning=raw({context:copy(ctx),unitId,head,attempt,message});postNotice(this,'ctError',message);
                }this.ctRememberDraftStageFailure(ctx,unitId,signature,'checkpoint'); return false; }
                finally{head.pending--;}
            },
            async ctSave(close = false, options = {}) {
                if(this.ctRecoveryBusy && !options.pendingResolution)return false;
                if (this.ctBusy || this.ctBrowseBusy || !this.ctCurrentUnit) return false;
                const receiptRetry=this._ctSaveJob?.unitId===this.ctSelection && !!this._ctSaveJob.command && this._ctSaveJob.scopeKey===root.ClientTextStore.scopeKey(this.ctWorkspace.scope);
                if(this.ctPendingSharedRecovery() && !options.pendingResolution && !receiptRetry){postNotice(this,'ctError','Accept the shared version or explicitly reapply the retained work before saving this ID.');return false;}
                if(this.ctChoices.length && !options.pendingResolution && !receiptRetry){postNotice(this,'ctError','Choose between the retained alternatives before saving this ID.');return false;}
                const ctx=this.ctContext(),unitId=this.ctSelection,scopeKey=root.ClientTextStore.scopeKey(ctx.scope),generation=this._ctBrowseGeneration || 0;
                const store=this.ctStorage(ctx.scope);
                const existing=this._ctSaveJob, retry=existing?.unitId===unitId && existing.scopeKey===scopeKey && existing.command;
                // An uncertain commit must find its receipt with the exact old
                // command before checkpointing any newer editor text.
                const englishEditorSignature=!retry && options.englishActions ? JSON.stringify([this.ctValues,this.ctReviewed]) : null;
                if(!retry && !await this.ctFlushDraft()){
                    if(this.ctCurrent(ctx) && this.ctSelection===unitId && this.ctError)postNotice(this,'ctError',this.ctError);
                    return false;
                }
                if(!this.ctCurrent(ctx)||this.ctSelection!==unitId)return false;
                if(englishEditorSignature && englishEditorSignature!==JSON.stringify([this.ctValues,this.ctReviewed])){postNotice(this,'ctError','The draft changed before Use English could be saved. Review the current translation and activate Eng again if appropriate.');return false;}
                const job=existing?.unitId===unitId && existing.scopeKey===scopeKey ? existing : {unitId,scopeKey,id:uuid()};
                this._ctSaveJob=job;this.ctBusy = true;let submittedSignature;
                try {
                    job.editorSignature ||= JSON.stringify([this.ctValues,this.ctReviewed]);
                    const command=job.command ||= { jobId:job.id, intentProtocol:root.ClientTextState.ENGLISH_INTENT_PROTOCOL, values: copy(options.englishValues || this.ctValues), reviewed: copy(options.englishReviewed || this.ctReviewed), baseRevision: this.ctSaved[unitId]?.serverRevision || 0, expectedRevision: (options.pendingResolution?this.ctSaved[unitId]?.revision:this._ctEditRevision) || 0, expectedDraftRevision:this._ctDraftRevision || null,
                        ...(options.englishActions?{englishActions:copy(options.englishActions)}:{}),
                        ...(options.englishActions?{englishEligibility:this.ctEnglishWitness(options.englishActions)}:{}),
                        ...(options.pendingResolution?{pendingResolution:{...copy(options.pendingResolution),editorBeforeValues:copy(this.ctValues)}}:{}),
                        ...(this.ctMtlAcceptances?.(unitId)?.length ? {mtlAcceptances:copy(this.ctMtlAcceptances(unitId))} : {}),
                        ...(options.origin ? {origin:options.origin}: {}) };
                    submittedSignature=JSON.stringify([command.values,command.reviewed]);
                    let result = await store.save(ctx.scope, unitId, command),receiptAdvanced=false;
                    if(result.replayed){const latest=await store.getSaved(ctx.scope);if(latest[unitId]?.revision>result.saved.revision){result={...result,saved:latest[unitId]};receiptAdvanced=true;}}
                    if (!this.ctCurrent(ctx)) return false;
                    const sameEditor=JSON.stringify([this.ctValues,this.ctReviewed])===job.editorSignature;
                    if(sameEditor && (command.englishActions || command.pendingResolution || receiptAdvanced)){this.ctValues=copy(result.saved.values);this.ctReviewed=copy(result.saved.reviewed);}
                    if(command.pendingResolution)this.ctChoices=copy(result.saved.conflicts || []);
                    this.ctLocalDraftState=sameEditor?'stored':'pending';this.ctSaved = raw({ ...this.ctSaved, [unitId]: result.saved }); this.ctRevision++; this.ctDraftDirty = !sameEditor;if(!sameEditor)this.ctQueueDraft();this.ctClearDraftStageFailure(ctx,unitId,submittedSignature); if(this._ctSaveJob===job)this._ctSaveJob = null;
                    this._ctEditRevision=result.saved.revision;
                    try{await this.ctMtlSaved?.(ctx,unitId);}catch(error){if(this.ctCurrent(ctx))this.ctMtlError='Saved, but MTL review state could not be refreshed: '+error.message;}
                    if(!this.ctCurrent(ctx))return false;
                    const head=this._ctDraftHeads?.get(JSON.stringify([scopeKey,unitId]));
                    if(this._ctDraftRevision===command.expectedDraftRevision){this._ctDraftRevision=null;if(head&&!head.pending){head.revision=null;head.signature=null;}}
                    this.ctRefreshDiagnostics([unitId]); this.ctError = ''; this.ctLoadHistory(ctx, unitId);this.ctLoadMemory(ctx);this.ctRefreshDraftSummaries(ctx);
                    await this.ctQueueResourceMemory?.(ctx,this._ctUnitIndex.get(unitId),result.saved);
                    if(!this.ctCurrent(ctx))return false;
                    if (close && sameEditor && generation===(this._ctBrowseGeneration || 0)) {
                        this.ctEditor = false;this.ctInlineClosed=false;this._ctInlineReturn=null;this.ctCompletion=null;await this.$nextTick?.();
                        if(!this.ctCurrent(ctx) || generation!==(this._ctBrowseGeneration || 0) || this.ctSelection!==unitId)return false;
                        this.ctRefreshLayout();this.ctFocusRow(unitId);
                    }
                    this.ctSync(ctx); return sameEditor;
                } catch (error) {
                    this.ctRememberDraftStageFailure(ctx,unitId,submittedSignature,'save');
                    if (this.ctCurrent(ctx)) {
                        postNotice(this, 'ctError', error.message);
                        if(['DRAFT_CHANGED','CLIENTTEXT_PENDING_RESOLUTION_REQUIRED'].includes(error.code))this._ctSaveJob=null;
                        if(error.code==='UNIT_CHANGED'){
                            this._ctSaveJob=null; const latest=await store.getSaved(ctx.scope);
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
                return !!this._ctMtlAcceptanceClaims?.[unit.id]?.length || unit.fields.some(field=>this.ctValues[field.id]!==committed[field.id]
                    || status.fields[field.id]?.outdated && this.ctReviewed[field.id]===this.ctReviewHash(field) && saved?.reviewed?.[field.id]!==this.ctReviewed[field.id])
                    || !this.ctChoices.length && !!saved?.conflicts?.length;
            },
            ctInlineUnitVisible() {return !this.ctEditor && !this.ctInlineClosed && this.inlineEditor && !!this.ctCurrentUnit && this.ctPageRows.some(unit=>unit.id===this.ctSelection);},
            ctUnitOccupied(unitId) {
                return this.ctPeers.some(peer=>peer.unitId===unitId && peer.sessionId!==this.instanceTabId && !peer.away);
            },
            ctNeedsAttention(unit) {
                const status=this.ctStatus(unit);
                return !!(status.missing || status.outdated || this.ctSaved[unit.id]?.conflicts?.length || this.ctSaved[unit.id]?.syncRecovery
                    || this.ctMtlUnitIds?.has(unit.id) || (this.ctDiagnostics[unit.id] || []).some(issue=>['error','warning'].includes(issue.severity)));
            },
            async ctSaveAndNavigate(reverse=false,options={}) {
                if(this.ctKeyboardBlocked() || this._ctNavigationRun)return false;
                const ctx=this.ctContext(),unitId=this.ctSelection,original=this.ctCurrentUnit,selectionRun=this._ctSelectRun,generation=this._ctBrowseGeneration || 0,
                    hadEditor=this.ctEditor || this.ctInlineUnitVisible(),direction=reverse?-1:1;
                if(!hadEditor)this.ctApplySearch();
                let rows=this.ctRows.slice();
                if(hadEditor && original && !rows.some(unit=>unit.id===unitId)){
                    const visible=new Set(rows.map(unit=>unit.id));
                    rows=this.ctBrowseOrderedUnits().filter(unit=>unit.id===unitId || visible.has(unit.id));
                }
                const anchor=hadEditor?rows.findIndex(unit=>unit.id===unitId)
                    :(this.ctPage-1)*this.ctEffectivePageSize+(reverse?this.ctPageRows.length-1:0);
                const candidates=options.attentionOnly ? root.EditorSession.attentionCandidates(this,direction).map(unit=>unit.id) : [];
                if(!options.attentionOnly)for(let index=hadEditor?anchor+direction:anchor;index>=0&&index<rows.length;index+=direction)candidates.push(rows[index].id);
                if(options.attentionOnly && !candidates.length)return false;
                if(options.inline && !candidates.some(id=>this._ctUnitIndex.has(id) && !this.ctUnitOccupied(id))){
                    postNotice(this,'ctNotice','No available files in this direction.');return false;
                }
                const run=this._ctNavigationRun={},current=()=>this._ctNavigationRun===run && this.ctCurrent(ctx) && this.ctSelection===unitId
                    && generation===(this._ctBrowseGeneration || 0)
                    && this.ctCurrentUnit===original && this._ctSelectRun===selectionRun && !this.ctKeyboardOverlayOpen() && !this.ctHistoryViewer;
                this.ctNavigationBusy=true;
                try {
                    const pending=this._ctSaveJob,retry=pending?.unitId===unitId && pending.scopeKey===root.ClientTextStore.scopeKey(ctx.scope) && pending.command;
                    if(hadEditor && (retry || options.saveUnchanged || this.ctHasEditorChanges()) && !await this.ctSave())return false;
                    if(!current())return false;
                    for(const id of candidates){
                        const ordered=this.ctRows,index=ordered.findIndex(unit=>unit.id===id);if(index<0)continue;
                        const unit=this._ctUnitIndex.get(id);if(!unit || this.ctUnitOccupied(id))continue;
                        if(options.attentionOnly && !this.ctNeedsAttention(unit))continue;
                        if(!current() || !await this.ctSelect(unit,!options.inline,{focus:false,guard:()=>this._ctNavigationRun===run
                            && !this.ctKeyboardOverlayOpen() && !this.ctHistoryViewer}))return false;
                        const opened=this._ctSelectRun;
                        if(this._ctNavigationRun!==run || !this.ctCurrent(ctx) || generation!==(this._ctBrowseGeneration || 0) || this.ctCurrentUnit!==unit || this.ctSelection!==id
                            || this.ctKeyboardOverlayOpen() || this.ctHistoryViewer)return false;
                        this.ctPage=Math.floor(index/this.ctEffectivePageSize)+1;await this.$nextTick?.();
                        if(this._ctNavigationRun!==run || !this.ctCurrent(ctx) || generation!==(this._ctBrowseGeneration || 0) || this.ctCurrentUnit!==unit || this._ctSelectRun!==opened
                            || this.ctKeyboardOverlayOpen() || this.ctHistoryViewer)return false;
                        const fields=this.ctTabFields(unit),field=fields[options.focusEnd?fields.length-1:0];
                        this.ctFocusedField=field?.id || '';this.ctFocusTarget(!!options.focusEnd,this.ctFocusedField);
                        if(options.attentionOnly){
                            if(this.ctEditor)root.document?.querySelector?.('.editor')?.scrollIntoView({block:'start',behavior:'instant'});
                            else this.ctFocusRow(id,false,'start');
                        }
                        return true;
                    }
                    postNotice(this,'ctNotice','No available files in this direction.');return false;
                } finally {if(this._ctNavigationRun===run){this._ctNavigationRun=null;this.ctNavigationBusy=false;}}
            },
            async ctKey(event) {
                if(this.ctMtlKey?.(event))return;
                if(event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && ['Comma','Period'].includes(event.code)){
                    if(event.defaultPrevented || event.isComposing || event.keyCode===229 || event.target?.composing)return;
                    event.preventDefault();
                    if(!this.ctKeyboardBlocked() && !event.target?.closest?.('.ctTools, .commentsSidebar, [role="menu"], [role="listbox"]'))
                        await this.navigateAttention(event.code==='Comma'?-1:1);
                    return;
                }
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
                if(event.ctrlKey && event.code===(this.filterShortcutCtrlD?'KeyD':'KeyF')){
                    event.preventDefault();if(this.ctEditor || event.target?.closest?.('.ctTools'))this.focusSidebarFilterInput?.();else this.$refs.ctSearchInput?.focus();return;
                }
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
                this.ctResetComparisons?.();
                this._ctHistoryRun = {}; this._ctHistoryPreviousRun = {}; this._ctHistoryLocal = []; this._ctHistoryShared = []; this._ctHistoryReferences = []; this._ctHistoryLocalLimit = 100;
                this.ctHistory = []; this.ctHistoryCursor = null; this.ctHistoryLocalMore = false;
                this.ctHistoryLoading = false; this.ctHistoryPreviousLoading = false; this.ctHistoryError = ''; this.ctHistoryViewer = false;
                this.ctHistoryCompareA = 'original'; this.ctHistoryCompareB = 'current';
            },
            ctMergeHistory() {
                this.ctHistory = raw([...new Map([...(this._ctHistoryLocal || []), ...(this._ctHistoryShared || []), ...(this._ctHistoryReferences || [])]
                    .map(entry => [entry.key, entry])).values()].sort((a, b) => b.createdAt - a.createdAt || b.key.localeCompare(a.key)));
                this.ctAutoOpenComparisons?.();
                for (const name of ['ctHistoryCompareA', 'ctHistoryCompareB']) if (!this.ctHistorySnapshotFor(this[name])) this[name] = name.endsWith('A') ? 'original' : 'current';
            },
            async ctLoadHistory(ctx = this.ctContext(), unitId = this.ctSelection, options = {}) {
                const unit = this._ctUnitIndex?.get(unitId);
                if (!unit || !this.ctCurrent(ctx) || this.ctSelection !== unitId || options.older && this.ctHistoryLoading) return false;
                const run = this._ctHistoryRun = {}, client = this._cloud;
                const current = () => this._ctHistoryRun === run && this.ctCurrent(ctx) && this.ctSelection === unitId && this.ctCurrentUnit === unit;
                this.ctHistoryLoading = true;
                const localLimit = options.older ? (this._ctHistoryLocalLimit || 100) + 100 : 100;
                const sharedAllowed = this.managedOnlineAvailable && client?.request && !/^(?:local|staged):/.test(ctx.scope.groupId)
                    && (this.cloudCanAccessAllLanguages || this.cloudUser?.language === ctx.scope.language);
                const tasks = [async () => {
                    const rows = await this.ctStorage(ctx.scope).listHistory(ctx.scope, unitId, { limit: localLimit + 1 });
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
                    this.ctPrepareComparisons?.(ctx,unitId).catch(()=>{});
                    return !this.ctHistoryError;
                } finally { if (current()) this.ctHistoryLoading = false; }
            },
            ctLoadOlderHistory() { return this.ctLoadHistory(this.ctContext(), this.ctSelection, { older: true }); },
            async ctLoadPreviousHistory() {
                const provenance = this.ctHistoryPreviousProvenance, unit = this.ctCurrentUnit;
                if (!provenance || !unit || this.ctBusy || this.ctHistoryPreviousLoading) return false;
                const ctx = this.ctContext(), client = this._cloud, store = this.ctStorage(ctx.scope), run = this._ctHistoryPreviousRun = {}, originalUnitId = provenance.unitId || unit.id;
                const current = () => this._ctHistoryPreviousRun === run && this.ctCurrent(ctx) && this.ctCurrentUnit === unit && this._cloud === client;
                const revision = Number(provenance.revision ?? 0);
                if (!Number.isSafeInteger(revision) || revision < 0) return false;
                this.ctHistoryPreviousLoading = true; this.ctHistoryError = '';
                try {
                    const rows = await store.listWorkspaces({ accountId: ctx.scope.accountId, game: ctx.scope.game });
                    if (!current()) return false;
                    const cached = rows.find(row => row.groupId === provenance.groupId && row.language === ctx.scope.language
                        && row.branchId === ctx.scope.branchId && row.state === 'ready');
                    let previousScope = cached && this.ctScope(cached.versionId, cached.groupId, ctx.scope.language);
                    if (!previousScope) {
                        if (this.ctOfflineTest) throw new Error('The previous workbook is unavailable in this test session.');
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
                    const previous = await store.getUnit(previousScope, originalUnitId);
                    if (!current()) return false;
                    if (!previous) throw new Error('This record is unavailable in the verified previous version.');
                    let record = revision === 0 ? null : undefined;
                    if (revision) {
                        const local = await store.listHistory(previousScope, originalUnitId, { limit: 5000 });
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
                return field.name + (field.form ? ' · ' + (forms[field.form] ? forms[field.form] + ' (' + field.form + ')' : this.ctClassVariantLabel(field)) : field.kind === 'gender' ? ' · Gender' : '');
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
            async ctLoadMemory(ctx=this.ctContext()) {if(!this.ctCurrent(ctx) || !this.ctWorkspace)return;try{const memory=await this.ctStorage(ctx.scope).getMemory?.(ctx.scope);if(this.ctCurrent(ctx))this.ctMemory=raw(memory?.units || []);}catch(error){if(this.ctCurrent(ctx))this.ctError=error.message;}},
            async ctApplyMemory(match) {
                const field=this.ctPreviewField;if(!field || !match || typeof match.target!=='string' || this.ctBusy || this.ctHistoryViewer || this.ctMtlBusy?.(field))return false;
                const ctx=this.ctContext(),unit=this.ctCurrentUnit,value=(this.ctInputValues || this.ctValues)[field.id],selection=this._ctSelectRun,target=match.target,
                    current=()=>!match.id || this.ctMemoryResults?.some(candidate=>candidate.id===match.id && candidate.target===target);
                if(!current())return false;
                if(String(value || '').trim() && value!==target && !await this.appConfirm('Replace this entry’s draft with the selected TM translation?',{title:'Use TM translation?',confirmLabel:'Replace translation',danger:false}))return false;
                if(!this.ctCurrent(ctx) || this.ctCurrentUnit!==unit || this._ctSelectRun!==selection || this.ctPreviewField!==field || (this.ctInputValues || this.ctValues)[field.id]!==value
                    || this.ctBusy || this.ctHistoryViewer || this.ctMtlBusy?.(field) || match.target!==target || !current())return false;
                const input=this.ctDictionaryTarget(field.id);
                if(input && root.EditorSession)return root.EditorSession.insert(this,field,target,{input,whole:true});
                (this.ctInputValues || this.ctValues)[field.id]=target;this.ctEdited(field);this.ctFocusTarget(false,field.id);return true;
            },
            ctHistoryRestoreBlocked(unit=this.ctCurrentUnit) {
                return !this.ctActive || this.ctBusy || !unit || unit.fields.some(field=>!!this.ctMtlBusy?.(field));
            },
            async ctRestoreHistory(entry, side = 'after') {
                if (this.ctHistoryRestoreBlocked() || !['before', 'after'].includes(side) || !this.ctHistoryEntryCurrent(entry) || !entry[side].available) return false;
                const ctx = this.ctContext(), unit = this.ctCurrentUnit, snapshot = entry[side];
                const editor = JSON.stringify([this.ctValues, this.ctReviewed]),requestVersion=this.ctMtlUnitRequestVersion?.(unit)||0,
                    current=()=>this.ctCurrent(ctx)&&this.ctCurrentUnit===unit&&!this.ctHistoryRestoreBlocked(unit)
                        &&(this.ctMtlUnitRequestVersion?.(unit)||0)===requestVersion&&this.ctHistoryEntryCurrent(entry)
                        &&JSON.stringify([this.ctValues,this.ctReviewed])===editor;
                if(!String(ctx.scope.groupId).startsWith('local:') && !this.ctPolicy?.clientTextSaveOrigins?.includes('restore')){
                    this.ctHistoryError='The API must support ClientText restores before restoring this revision.';return false;
                }
                if(!await this.appConfirm('Restore this revision? A new saved revision will be created.',{title:'Restore saved revision?',confirmLabel:'Restore revision'}))return false;
                if(!current())return false;
                if (!await this.ctFlushDraft() || !current()) return false;
                await this.ctMtlUnderlyingReplaced?.(unit);if(!current())return false;
                this.ctValues = Object.fromEntries(unit.fields.map(field => [field.id,
                    typeof snapshot.values[field.id] === 'string' ? snapshot.values[field.id] : String(this.ctValues[field.id] ?? field.target ?? '')]));
                this.ctReviewed = Object.fromEntries(Object.entries(snapshot.reviewed).filter(([id, hash]) => unit.fields.some(field => field.id === id && this.ctReviewHash(field) === hash)));
                this.ctDraftDirty = true;
                return await this.ctSave(false,{origin:'restore'});
            },
            ctRefreshDiagnostics(ids) {
                if(this.ctScanRunning){this.ctClearScanResults();return;}
                if (!this.ctScanDone) return;
                if(!this._ctScanCache || !this.ctScanEnvironmentCurrent(this._ctScanCache.environment,false)){this.ctClearScanResults();return;}
                const next = { ...this.ctDiagnostics };
                const affected=new Set(ids),keys=new Set(ids.flatMap(id=>[...(this._ctConsistencyByUnit?.get(id) || [])]));
                for(const key of keys)for(const entry of this._ctConsistencyIndex.get(key))affected.add(entry.unitId);
                for (const id of affected) { const unit = this._ctScanCache.units.get(id); if (unit) next[id] = this.ctAnalyzeScanUnit(unit,this.ctScanAppliedChecks,this._ctScanCache.terminology); }
                if(this._ctConsistencyIndex){const allKeys=new Set([...affected].flatMap(id=>[...(this._ctConsistencyByUnit.get(id) || [])]));for(const key of allKeys)this.ctAddConsistency(next,key,affected);}
                this.ctDiagnostics = raw(next);this.ctUpdateScanCounts(next);
            },
            ctConsistencyKey(field) {return JSON.stringify([field.kind,field.form || null,root.ClientTextState.canonicalSource(field.source)]);},
            ctAddConsistency(results,key,allowed,index=this._ctConsistencyIndex,units=this._ctUnitIndex) {
                const peers=index?.get(key)||[];if(peers.length<2)return;
                const entries=peers.map(entry=>({...entry,field:units.get(entry.unitId).fields.find(field=>field.id===entry.fieldId),target:this.ctValuesFor(units.get(entry.unitId))[entry.fieldId]}))
                    .filter(entry=>entry.target?.trim() && !(!root.ClientTextState.isNamedForm(entry.field) && entry.target.trim()==='NONEXISTENT'));
                if(new Set(entries.map(entry=>entry.target)).size<2)return;
                for(const entry of entries)if(!allowed || allowed.has(entry.unitId)){
                    const field=units.get(entry.unitId).fields.find(field=>field.id===entry.fieldId);
                    results[entry.unitId].push({code:'clienttext-consistency',severity:'warning',level:'warning',fieldId:entry.fieldId,
                        fieldName:field?.name,form:field?.form || '',message:'Same English and grammatical form have different saved translations.'});
                }
                return entries;
            },
            ctClearScanResults() {
                this.ctScanRunId++;this.ctDiagnostics=raw({});this.ctScanDone=false;this.ctScanAppliedChecks=null;this.ctScanRunning=false;
                this.ctScanStopped=false;this.ctScanProcessed=0;this.ctScanTotal=0;this.ctScanErrorFileCount=0;this.ctScanWarningFileCount=0;
                this.ctScanError='';this.ctScanPhase='';this.ctScanResultsPage=1;this._ctScanCache=null;this._ctConsistencyIndex=null;this._ctConsistencyByUnit=null;
            },
            ctStopScan() {
                if(!this.ctScanRunning)return false;
                const processed=this.ctScanProcessed,total=this.ctScanTotal;this.ctClearScanResults();
                this.ctScanStopped=true;this.ctScanProcessed=processed;this.ctScanTotal=total;return true;
            },
            ctScanEnvironment() {
                return {ctx:this.ctContext(),units:unproxy(this.ctUnits),saved:unproxy(this.ctSaved),dictionary:unproxy(this.dictionary),dictionaryRevision:this.editorDictionaryRevision,
                    language:this.lang,game:this.gameVersion,branch:this.branchId || 'default',account:this.cloudProfileId || this.cloudUser?.id || 'guest',hideDNT:this.hideDNT};
            },
            ctScanEnvironmentCurrent(environment,includeSaved=true) {
                return this.ctActive && this.ctCurrent(environment.ctx) && unproxy(this.ctUnits)===environment.units
                    && (!includeSaved || unproxy(this.ctSaved)===environment.saved) && unproxy(this.dictionary)===environment.dictionary
                    && this.editorDictionaryRevision===environment.dictionaryRevision && this.lang===environment.language && this.gameVersion===environment.game
                    && (this.branchId || 'default')===environment.branch && (this.cloudProfileId || this.cloudUser?.id || 'guest')===environment.account && this.hideDNT===environment.hideDNT;
            },
            ctAnalyzeScanUnit(unit,checks,terminology) {
                const values=this.ctValuesFor(unit),state=root.ClientTextState,lang=this.ctWorkspace?.scope.language || this.lang;
                return this.ctFieldsFor(unit).flatMap(field=>{
                    const text=String(values[field.id] ?? '');
                    if(this.ctUsesEnglish(field,unit) || field.kind==='gender' || state.audioOnly(field.source) || state.allowsNonexistent(field) && text.trim()==='NONEXISTENT')return [];
                    const issues=state.diagnose(field,text,{tagSyntax:!!checks.tagSyntax,variables:!!checks.variables,keywords:!!checks.keywords,
                        decorations:!!checks.decorations,substitutions:!!checks.substitutions,controls:!!checks.controls});
                    if(checks.whitespace || checks.dash){
                        if(!root.TranslationDiagnostics?.analyze)throw new Error('Translation diagnostic checks are unavailable.');
                        issues.push(...root.TranslationDiagnostics.analyze(text,{lang,contentMode:'clienttext',checks:{whitespace:!!checks.whitespace,dash:!!checks.dash,tagSyntax:false}}).diagnostics);
                    }
                    if(checks.terminology)issues.push(...root.TerminologyDiagnostics.analyze(state.maskAudioMarkers(state.canonicalSource(field.source)),state.maskAudioMarkers(text),terminology,{lang}));
                    return issues.map(issue=>({...issue,level:issue.level || issue.severity,severity:issue.level || issue.severity,fieldId:field.id,fieldName:field.name,form:field.form || ''}));
                });
            },
            ctUpdateScanCounts(results) {
                this.ctScanErrorFileCount=Object.values(results).filter(issues=>issues.some(issue=>issue.severity==='error')).length;
                this.ctScanWarningFileCount=Object.values(results).filter(issues=>issues.some(issue=>issue.severity==='warning')).length;
            },
            ctScanIssueLocation(issue) {return (issue.fieldName || 'Field')+(issue.form ? ' · '+this.ctClassVariantLabel({kind:'form',form:issue.form}) : '')+(Number.isInteger(issue.line) ? ' · line '+(issue.line+1) : '');},
            ctScanUnitLabel(count) {return count===1 ? 'record' : 'records';},
            async ctOpenDiagnosticResult(id) {
                const cache=this._ctScanCache,unit=cache?.units.get(id);if(!unit || !this.ctScanDone || !this.ctScanEnvironmentCurrent(cache.environment,false))return false;
                const ctx=this.ctContext();this.ctCloseScanDialog(false);
                if(!this.ctCurrent(ctx) || this._ctUnitIndex?.get(id)!==unit)return false;
                return this.ctSelect(unit,true);
            },
            async ctScan(options) {
                if(!this.ctActive || this.ctScanRunning)return false;
                const checks={...this.ctScanChecks,...(typeof options==='boolean' ? {consistency:options} : options || {})};
                if(!this.ctScanTypes.some(type=>checks[type.key]))return false;
                const environment=this.ctScanEnvironment(),units=this.ctUnits.filter(unit=>this.ctFieldsFor(unit).length),
                    unitMap=new Map(units.map(unit=>[unit.id,unit])),results={},consistencyMap=new Map(),byUnit=new Map(),warningUnits=new Set();
                this.ctClearScanResults();const runId=this.ctScanRunId;
                const current=()=>runId===this.ctScanRunId && this.ctScanEnvironmentCurrent(environment);
                const check=()=>{if(current())return true;if(runId===this.ctScanRunId)this.ctClearScanResults();return false;};
                this.ctScanRunning=true;this.ctScanTotal=units.length;this.ctScanPhase='Preparing checks…';
                try {
                    await this.$nextTick?.();await new Promise(resolve=>setTimeout(resolve,0));if(!check())return false;
                    let terminology=null;
                    if(checks.terminology){
                        if(!root.TerminologyDiagnostics?.analyze || !root.TerminologyDiagnostics?.compileDictionary)throw new Error('Dictionary terminology checks are unavailable.');
                        terminology=this.terminologyDictionary || root.TerminologyDiagnostics.compileDictionary(this.getActiveDictionaryEntries?.() || []);
                    }
                    this.ctScanPhase='Checking records…';await new Promise(resolve=>setTimeout(resolve,0));if(!check())return false;
                    for (let i = 0; i < units.length; i++) {
                        if(!check())return false;
                        const unit=units[i];results[unit.id]=this.ctAnalyzeScanUnit(unit,checks,terminology);if(!check())return false;
                        if (checks.consistency) {
                            for (const field of this.ctFieldsFor(unit)) {
                                // Keep immutable peer membership when a current
                                // target uses English: later saves/shared edits
                                // can replace the blank without a full rescan.
                                if (field.kind==='gender' || !field.source.trim() || root.ClientTextState.audioOnly(field.source))continue;
                                const key = this.ctConsistencyKey(field),entries=consistencyMap.get(key) || [];entries.push({unitId:unit.id,fieldId:field.id});consistencyMap.set(key,entries);
                                const keys=byUnit.get(unit.id)||new Set();keys.add(key);byUnit.set(unit.id,keys);
                            }
                        }
                        this.ctScanProcessed=i+1;
                        if(results[unit.id].some(issue=>issue.severity==='error'))this.ctScanErrorFileCount++;
                        if(results[unit.id].some(issue=>issue.severity==='warning')){warningUnits.add(unit.id);this.ctScanWarningFileCount=warningUnits.size;}
                        if((i+1)%25===0){await new Promise(resolve=>setTimeout(resolve,0));if(!check())return false;}
                    }
                    if(!check())return false;
                    if(checks.consistency){
                        this.ctScanPhase='Checking consistency…';await new Promise(resolve=>setTimeout(resolve,0));if(!check())return false;
                        let checked=0;
                        for(const [key,peers] of consistencyMap){
                            // A singleton cannot have divergent translations. Only
                            // matching peers need the more expensive value pass.
                            if(peers.length<2)continue;
                            const mismatched=this.ctAddConsistency(results,key,null,consistencyMap,unitMap);if(!check())return false;
                            for(const entry of mismatched || [])warningUnits.add(entry.unitId);
                            this.ctScanWarningFileCount=warningUnits.size;
                            if(++checked%25===0){await new Promise(resolve=>setTimeout(resolve,0));if(!check())return false;}
                        }
                    }
                    if(!check())return false;
                    this._ctConsistencyIndex=checks.consistency ? raw(consistencyMap) : null;this._ctConsistencyByUnit=checks.consistency ? raw(byUnit) : null;
                    this._ctScanCache=raw({environment,units:unitMap,terminology});this.ctScanAppliedChecks=raw({...checks});
                    this.ctDiagnostics=raw(results);this.ctUpdateScanCounts(results);this.ctScanDone=true;this.ctScanRunning=false;this.ctScanPhase='';return true;
                } catch(error) {
                    if(check()){this.ctClearScanResults();this.ctScanError=error.message || 'The diagnostic scan failed.';}return false;
                }
            },
            async ctOpenGroup(version, group, language = this.lang, activate = true) {
                if (!group || this.ctBusy || this.managedVersionBusy) return;
                const openingKey=this.managedCatalogScope,openingEpoch=this._ctEpoch || 0;
                if(version.game!==this.gameVersion || (version.branchId || 'default')!==(this.branchId || 'default')){this.ctError='Select a version in the current game and branch.';return;}
                if(group.teams?.length && !group.teams.some(team=>team.language===language) || mode(group)==='clienttext' && group.language && group.language!==language){this.ctError='This content group is not assigned to '+language+'.';return;}
                if (mode(group) !== 'clienttext') { if(!await this.ctFlushDraft() || openingKey!==this.managedCatalogScope || openingEpoch!==(this._ctEpoch || 0))return;const previousGroup=this.activeContentGroup?.contentMode==='statdescription'?this.activeContentGroup:null;this.ctFence(); return this.managedOpenStatGroup(version, group, language,previousGroup); }
                if (!this.cloudCanAccessAllLanguages && language !== this.cloudUser?.language) return;
                version={...version,contentGroups:this.managedSelectedVersion?.id===version.id?this.ctGroups:version.contentGroups || []};
                const scope = this.ctScope(version.id, group.id, language), key = this.managedCatalogScope;
                const opening=this._ctOpenRun={};
                const initialization=activate ? this.ctBeginInitialization('Opening '+(version.name || 'selected version')+' · '+language+' ClientText',null,
                    ['Preserving unsaved edits','Checking selected workspace','Checking reusable workbook cache','Caching selected workspace','Loading cached translations','Preparing context references','Preparing Dictionary matches','Opening ClientText workspace']) : null;
                this.ctBusy = true; this.ctError = ''; this._ctAbort = new AbortController();
                const signal=this._ctAbort.signal,current=()=>this._ctOpenRun===opening && key===this.managedCatalogScope && openingEpoch===(this._ctEpoch || 0) && !signal.aborted,
                    check=()=>{if(!current())throw Object.assign(new Error('ClientText opening was cancelled or superseded.'),{stale:true,name:'AbortError'});};
                try {
                    if(activate && !await this.ctInitializationStep('Preserving unsaved edits',async()=>{if(!await this.ctFlushDraft())return false;await this.ctFlushCommentDraft();check();return true;},initialization))return false;
                    const cached=await this.ctInitializationStep('Checking selected workspace',async report=>{
                        const result=await this._ctStore.getMetadata(scope,{guard:current});check();report({detail:result?.state==='ready'?'Selected workspace is cached':'Preparing selected originals'});return result;
                    },initialization);
                    if(cached?.state==='ready'){
                        if(initialization?.ownsPlan)this.setWorkspaceInitializationPlan?.(initialization,['Preserving unsaved edits','Checking selected workspace','Loading cached translations','Preparing context references','Preparing Dictionary matches','Opening ClientText workspace']);
                        return activate ? await this.ctActivate(scope,{...cached,version},initialization) : cached;
                    }
                    await this.ctRequireTrustedProtocol(signal);check();
                    const response=await this._cloud.request('/v1/content-groups/'+encodeURIComponent(group.id),{signal}),full=response.group || response.contentGroup || response;check();
                    if(full.id!==group.id || full.versionId!==version.id || full.contentMode!=='clienttext' || full.language!==language || full.game && full.game!==scope.game || full.branchId && full.branchId!==scope.branchId)throw new Error('The returned content group differs from the selected version, team, game or branch.');
                    const metadata=await this.ctCacheGroup(version,full,scope,{signal,current,initialization});check();
                    return activate ? await this.ctActivate(scope,metadata,initialization) : metadata;
                } catch(error){if(key===this.managedCatalogScope && !error.stale && error.name!=='AbortError')this.ctError=error.message;return false;}
                finally{this.ctFinishInitialization(initialization);if(this._ctOpenRun===opening && key===this.managedCatalogScope){this.ctBusy=false;this.ctProgress=null;this._ctOpenRun=null;}}
            },
            async ctDownload(collection, group = this.ctWorkspace?.metadata.group, language = this.ctWorkspace?.scope.language || this.lang, version = this.ctWorkspace?.metadata.version, operation) {
                if (!group || !version || !operation && (this.ctBusy || this._ctExportRun)) return false;
                const run = operation || this.ctBeginExport(collection ? 'Download collection' : 'Export saved ClientText');
                if (!run) return false;
                const signal = run.signal;
                const lookupLabel = 'Indexed original lookup';
                let scope, store;
                const current = () => !signal.aborted && run.current() && this._ctExportRun === run;
                const worker = () => {
                    if (!run.worker) run.worker = root.ClientTextWorkerClient?.create ? root.ClientTextWorkerClient.create() : this._ctWorker;
                    return run.worker;
                };
                let completed = false;
                try {
                    scope = this.ctScope(version.id, group.id, language); store = this.ctStorage(scope);
                    if (collection && !operation) run.accepted();
                    await run.step('Checkpoint / preparation', async () => {
                        if (!await this.ctFlushDraft()) throw new Error('The draft could not be checkpointed.');
                        run.check();
                        if (this.ctOfflineTest && collection) throw new Error('Online collections are unavailable in this offline test.');
                    });
                    let metadata = await run.step(lookupLabel, () => store.getMetadata(scope, { guard: current }), 'workspace-metadata');
                    if (metadata?.state !== 'ready') {
                        // Cold preparation uses the same verified cache path without switching workspace or taking over the screen.
                        await run.step('Checkpoint / preparation', async () => {
                            if (!this.cloudCanAccessAllLanguages && language !== this.cloudUser?.language) throw new Error('This team is not accessible.');
                            await this.ctRequireTrustedProtocol(signal); run.check();
                            const response = await this._cloud.request('/v1/content-groups/' + encodeURIComponent(group.id), { signal }); run.check();
                            const full = response.group || response.contentGroup || response;
                            if (full.id !== group.id || full.versionId !== version.id || full.contentMode !== 'clienttext' || full.language !== language
                                || full.game && full.game !== scope.game || full.branchId && full.branchId !== scope.branchId) throw new Error('The returned content group differs from the selected scope.');
                            await this.ctCacheGroup(version, full, scope, { signal, current, worker: worker(), comparison: true }); run.check();
                        }, 'original-preparation');
                        metadata = await run.step(lookupLabel, () => store.getMetadata(scope, { guard: current }), 'workspace-metadata');
                    }
                    let saved = collection ? {} : await run.step('Checkpoint / preparation', () => store.getSaved(scope), 'saved-records'), collectionAssets = null, collectionAssetSignature = '';
                    if (collection) {
                        run.phase('Manifest retrieval (network + server)');
                        let cursor = '';
                        do {
                            const response = await this._cloud.request('/v1/content-collections/' + encodeURIComponent(collection.id) + '/manifest' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''),{signal});
                            run.check();
                            if (response.collection?.id !== collection.id) throw new Error('Collection identity changed.');
                            if(response.manifest?.groupId!==group.id || response.manifest?.versionId!==version.id || response.manifest?.language!==language)throw new Error('Collection scope differs from selected content group.');
                            const assets = response.manifest.assets;
                            if (!Array.isArray(assets) || !assets.length || assets.some(asset => !['normal','gender'].includes(asset.role)
                                || !/^[a-f0-9]{64}$/.test(asset.artifactHash) || !asset.descriptor
                                || asset.descriptor.assetHash !== asset.artifactHash || asset.descriptor.role !== asset.role)
                                || new Set(assets.map(asset => asset.role)).size !== assets.length) throw new Error('Collection original identities are invalid.');
                            const signature = JSON.stringify(assets.map(asset => [asset.role,asset.artifactHash,asset.descriptor.parserVersion || 'clienttext-v1']).sort((a,b)=>a[0].localeCompare(b[0])));
                            if (collectionAssets && signature !== collectionAssetSignature) throw new Error('Collection original identities changed between pages.');
                            collectionAssets = assets; collectionAssetSignature = signature;
                            for (const unit of response.manifest?.units || []) saved[unit.unitId || unit.id] = typeof unit.saved==='object' ? unit.saved : unit;
                            for (const unit of response.manifest?.sourceReviews || []) saved[unit.unitId || unit.id] = { ...unit,saved:false,values:unit.values || {} };
                            cursor = response.nextCursor || '';
                        } while (cursor);
                    }
                    run.phase(lookupLabel, 'saved-originals');
                    const units = await run.wait(store.getUnitsByIds(scope,Object.keys(saved),{guard:current})),
                        roles = (metadata.descriptors || []).map(descriptor => descriptor.role), outputs = [];
                    if (collectionAssets && (collectionAssets.length !== roles.length || roles.some(role => !collectionAssets.some(asset => asset.role === role)))) throw new Error('Cached workbook roles differ from the collection originals.');
                    for (const role of roles) {
                        run.phase(lookupLabel, 'workbook-original');
                        const asset = await run.wait(store.getAsset(scope, role)); run.check(); if (!asset) throw new Error('Open this content group once to verify and cache its originals before downloading.');
                        const expected = collectionAssets?.find(item => item.role === role);
                        if (expected && (asset.parsed?.artifactHash !== expected.artifactHash
                            || (asset.parsed?.parserVersion || asset.descriptor?.parserVersion || 'clienttext-v1') !== (expected.descriptor.parserVersion || 'clienttext-v1'))) throw new Error('Cached workbook original or parser differs from the collection snapshot.');
                        run.phase('Original workbook byte read', 'workbook-bytes');
                        const bytes = assetBytes(asset); let buffer;
                        try { buffer = bytes instanceof Blob ? await bytes.arrayBuffer() : bytes; }
                        catch (error) {
                            if (!['NotFoundError','NotReadableError'].includes(error.name)) throw error;
                            throw Object.assign(new Error('The selected original workbook is no longer readable from its disk location. Keep this tab open and make a local recovery copy before reloading or changing workbooks.'),
                                {name:error.name,code:'CLIENTTEXT_ORIGINAL_FILE_UNAVAILABLE'});
                        }
                        run.check();
                        // The immutable package and its sheet workload summaries
                        // supply untouched cells/statuses; send only affected units.
                        const parsed = { ...asset.parsed, units: units.filter(unit => unit.role === role && saved[unit.id]) };
                        const roleSaved=Object.fromEntries(parsed.units.filter(unit=>saved[unit.id]).map(unit=>[unit.id,saved[unit.id]]));
                        run.phase('Worker verification');
                        const output = await run.wait(worker().exportWorkbook(buffer, parsed, roleSaved, { signal, onProgress: progress => {
                            if (!current() || this._ctExportRun !== run) return;
                            if (progress.phase === 'patching' || progress.phase === 'exporting') run.phase('Worker patching');
                            else if (progress.phase === 'packing') run.phase('Worker compression');
                        } }));
                        outputs.push({ role, name: asset.name || parsed.filename, bytes: output });
                        run.check();
                    }
                    if (!outputs.length) throw new Error('This workbook group is not cached. Open its editor before downloading.');
                    run.phase('Packaging');
                    const names = workbookExportNames(outputs);
                    let blob, name;
                    if (outputs.length === 1) { blob = new Blob([outputs[0].bytes]); name = names[0]; }
                    else {
                        // Terminating this dedicated packaging worker interrupts compression too.
                        const packaged = await run.wait(worker().packageWorkbooks(outputs.map((output, index) => ({ name: names[index], bytes: output.bytes })), { signal }));
                        blob = new Blob([packaged], { type: 'application/zip' }); name = translatedFilename(`${version.name}_${language}_ClientText.zip`);
                    }
                    run.check(); run.phase('Download initiation');
                    root.saveAs(blob, name); run.state.downloadStarted = true; completed = true;
                    return true;
                } catch (error) {
                    if (run.current() && !signal.aborted && error.name !== 'AbortError') { run.fail(error); this.ctError = error.message; }
                    return false;
                } finally {
                    if (!operation) this.ctFinishExport(run, signal.aborted || !run.current() ? 'aborted' : completed ? 'done' : 'failed');
                }
            },
            async ctCollectClientText(version, group, team, end) {
                const run = this.ctBeginExport(end ? 'Download and end' : 'Download accepted Saved work');
                if (!run) return false;
                const client = this._cloud, store = this._ctStore;
                const requestKey = 'collection:' + JSON.stringify([group.id, team.language, end]);
                let completed = false;
                try {
                    const requestScope = this.ctRequestScope();
                    run.phase('Checkpoint / preparation');
                    let journal = await run.wait(store.getRequest(requestScope, requestKey)); run.check();
                    if (!journal) {
                        await store.putRequest(requestScope, requestKey, { kind: 'collection', groupId: group.id, language: team.language, endWindow: end, idempotencyKey: uuid() });
                        run.check(); journal = await run.wait(store.getRequest(requestScope, requestKey)); run.check();
                    }
                    let collection = journal.payload.collection;
                    if (!collection) {
                        run.phase('Collection request (network + server)'); run.state.collection = 'uncertain'; run.tick();
                        const response = await client.request('/v1/content-groups/' + encodeURIComponent(group.id) + '/teams/' + encodeURIComponent(team.language) + '/collections',
                            { method: 'POST', body: { idempotencyKey: journal.payload.idempotencyKey, endWindow: end }, signal: run.signal });
                        collection = response.collection;
                        if (!collection?.id) throw new Error('The collection response has no identity. Retry the retained request.');
                        run.accepted();
                        // Persist an observed receipt even if Abort arrives after the response. Never invent a new end operation.
                        if (!run.signal.aborted && run.current()) run.phase('Collection receipt checkpoint');
                        await store.putRequest(requestScope, requestKey, { ...journal.payload, collection });
                    } else run.accepted();
                    run.check();
                    completed = await this.ctDownload(collection, group, team.language, version, run);
                    run.check();
                    if (completed) { run.phase('Collection receipt cleanup'); await store.deleteRequest(requestScope, requestKey); }
                    return completed;
                } catch (error) {
                    completed = false;
                    if (run.current() && !run.signal.aborted && error.name !== 'AbortError') { run.fail(error); this.ctError = error.message; }
                    return false;
                } finally {
                    this.ctFinishExport(run, run.signal.aborted || !run.current() ? 'aborted' : completed ? 'done' : 'failed');
                    // Ordinary catalog polling reconciles accepted/uncertain operations after cancellation as well.
                    if (run.current()) this.managedReadDetails?.(version.id, false).catch(() => {});
                }
            },
            async ctCollect(version, group, team, end = true) {
                if (this.ctBusy || this._ctExportRun) return false;
                if (mode(group) === 'clienttext') return this.ctCollectClientText(version, group, team, end);
                return this.managedCollectStatGroup(version, group, team, end);
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
                if(this.ctOfflineTest)return;
                const ctx=this.ctContext(),unitId=this.ctSelection,scope={accountId:ctx.scope.accountId,game:ctx.scope.game,branchId:ctx.scope.branchId},key=this.ctCommentKey(ctx,unitId),text=this.ctCommentText,audience=this.ctCommentGlobal?'global':'language';
                const pending=(this._ctCommentQueue || Promise.resolve()).catch(()=>{}).then(async()=>{
                    const previous=await this._ctStore.getRequest(scope,key);if(!text.trim()&&!previous)return;const old=previous?.payload;
                    const command={kind:'comment',groupId:ctx.scope.groupId,language:ctx.scope.language,unitId,text,audience,idempotencyKey:old?.text===text && old?.audience===audience?old.idempotencyKey:uuid()};
                    await this._ctStore.putRequest(scope,key,command);return command;
                });this._ctCommentQueue=pending;return await pending;
            },
            async ctLoadCommentDraft(ctx,unitId) {if(String(ctx.scope.groupId).startsWith('local:test:'))return;const before=JSON.stringify([this.ctCommentText,this.ctCommentGlobal]);try{const request=await this._ctStore.getRequest({accountId:ctx.scope.accountId,game:ctx.scope.game,branchId:ctx.scope.branchId},this.ctCommentKey(ctx,unitId));if(this.ctCurrent(ctx)&&this.ctSelection===unitId && before===JSON.stringify([this.ctCommentText,this.ctCommentGlobal])){this.ctCommentText=request?.payload.text || '';this.ctCommentGlobal=request?.payload.audience==='global';}}catch(error){if(this.ctCurrent(ctx))this.ctError='Comment draft was not restored: '+error.message;}},
            ctReplyCommentKey(ctx,unitId) {return 'comment-reply:'+root.ClientTextState.hash([root.ClientTextStore.scopeKey(ctx.scope),unitId]);},
            ctQueueReplyCommentDraft(unitId,draft) {
                if(this.ctOfflineTest)return;
                const ctx=this.ctContext(),key=this.ctReplyCommentKey(ctx,unitId);
                this._ctReplyDraftPending ||= new Map();const previous=this._ctReplyDraftPending.get(key);clearTimeout(previous?.timer);
                const pending={ctx,unitId,draft:{body:String(draft.body ?? ''),allLanguages:draft.allLanguages===true}};
                pending.timer=setTimeout(()=>{this._ctReplyDraftPending.delete(key);this.ctFlushReplyCommentDraft(pending).catch(error=>{if(this.ctCurrent(ctx))this.ctCommentPostError='Comment draft was not stored: '+error.message;});},200);
                this._ctReplyDraftPending.set(key,pending);
            },
            async ctFlushReplyCommentDraft(pending) {
                if(String(pending.ctx.scope.groupId).startsWith('local:test:'))return;
                const {ctx,unitId,draft}=pending,key=this.ctReplyCommentKey(ctx,unitId),scope={accountId:ctx.scope.accountId,game:ctx.scope.game,branchId:ctx.scope.branchId};
                const operation=(this._ctReplyQueue || Promise.resolve()).catch(()=>{}).then(async()=>{
                    const previous=await this._ctStore.getRequest(scope,key),old=previous?.payload;if(!draft.body && !old)return;
                    await this._ctStore.putRequest(scope,key,{kind:'comment-reply',groupId:ctx.scope.groupId,language:ctx.scope.language,unitId,
                        text:draft.body,audience:draft.allLanguages?'global':'language',...(old?.post?{post:old.post}:{})});
                });this._ctReplyQueue=operation;return operation;
            },
            async ctFlushReplyCommentDrafts() {
                const pending=[...(this._ctReplyDraftPending?.values() || [])];this._ctReplyDraftPending?.clear();
                for(const item of pending){clearTimeout(item.timer);await this.ctFlushReplyCommentDraft(item);}await this._ctReplyQueue;
            },
            async ctLoadReplyCommentDraft(unitId) {
                if(this.ctOfflineTest)return null;
                const ctx=this.ctContext(),scope={accountId:ctx.scope.accountId,game:ctx.scope.game,branchId:ctx.scope.branchId};
                const request=await this._ctStore.getRequest(scope,this.ctReplyCommentKey(ctx,unitId));
                return this.ctCurrent(ctx) && request ? {body:request.payload.text,allLanguages:request.payload.audience==='global'}:null;
            },
            async ctPostReplyComment(unitId,draft) {
                const ctx=this.ctContext(),client=this._cloud,key=this.ctReplyCommentKey(ctx,unitId),scope={accountId:ctx.scope.accountId,game:ctx.scope.game,branchId:ctx.scope.branchId},
                    submitted={body:String(draft.body ?? ''),allLanguages:draft.allLanguages===true};
                if(!this.ctActive || !this.managedOnlineAvailable || !this._ctUnitIndex?.has(unitId) || /^(?:local|staged):/.test(ctx.scope.groupId)
                    || !this.cloudCanAccessAllLanguages && ctx.scope.language!==this.cloudUser?.language)return false;
                this.ctQueueReplyCommentDraft(unitId,submitted);
                try {
                    await this.ctFlushReplyCommentDrafts();if(!this.ctCurrent(ctx) || this._cloud!==client)return false;
                    let command;
                    const freeze=(this._ctReplyQueue || Promise.resolve()).catch(()=>{}).then(async()=>{
                        const journal=(await this._ctStore.getRequest(scope,key))?.payload;if(!journal || !journal.post && !submitted.body.trim())return;
                        command=journal.post || {text:submitted.body,language:ctx.scope.language,audience:submitted.allLanguages?'global':'language',idempotencyKey:uuid()};
                        if(!journal.post)await this._ctStore.putRequest(scope,key,{...journal,post:command});
                    });this._ctReplyQueue=freeze;await freeze;if(!command)return false;
                    if(!this.ctCurrent(ctx) || this._cloud!==client)return false;
                    await client.request('/v1/content-groups/'+encodeURIComponent(ctx.scope.groupId)+'/units/'+encodeURIComponent(unitId)+'/comments',{method:'POST',body:copy(command)});
                    // Serialize acknowledgement with newer typing. The frozen POST
                    // survives an uncertain response while the authored draft can grow.
                    const acknowledge=(this._ctReplyQueue || Promise.resolve()).catch(()=>{}).then(async()=>{
                        const latest=(await this._ctStore.getRequest(scope,key))?.payload;if(!latest || latest.post?.idempotencyKey!==command.idempotencyKey)return;
                        if(latest.text===command.text && latest.audience===command.audience)await this._ctStore.deleteRequest(scope,key);
                        else{const {post,...newer}=latest;await this._ctStore.putRequest(scope,key,newer);}
                    });this._ctReplyQueue=acknowledge;await acknowledge;
                    if(!this.ctCurrent(ctx))return false;
                    const sentRequested=command.text===submitted.body && command.audience===(submitted.allLanguages?'global':'language');
                    this.ctCommentPostError=sentRequested?'':'The earlier comment was confirmed. Your newer draft is kept; post it to send it.';
                    return sentRequested;
                }catch(error){if(this.ctCurrent(ctx))this.ctCommentPostError=error.message;return false;}
            },
            async ctPostComment() {
                if (this.ctOfflineTest || !this.ctCommentText.trim() || this.ctBusy) return false;
                const ctx = this.ctContext(), unitId = this.ctSelection,scope=this.ctRequestScope(),key=this.ctCommentKey(ctx,unitId),client=this._cloud; this.ctBusy = true;
                try {
                    const command=await this.ctFlushCommentDraft();
                    if(!command || !this.ctCurrent(ctx) || unitId!==this.ctSelection)return false;
                    await client.request('/v1/content-groups/' + encodeURIComponent(ctx.scope.groupId) + '/units/' + encodeURIComponent(unitId) + '/comments', {
                        method:'POST',body:{text:command.text,language:ctx.scope.language,audience:command.audience,idempotencyKey:command.idempotencyKey}});
                    await this._ctStore.deleteRequest(scope,key,{expectedIdempotencyKey:command.idempotencyKey});
                    if(this.ctCurrent(ctx) && this.ctSelection===unitId){
                        if(this.ctCommentText===command.text && (this.ctCommentGlobal?'global':'language')===command.audience){this.ctCommentText='';this.ctCommentGlobal=false;}
                        this.ctCommentPostError='';
                    }
                    return true;
                } catch(error){if(this.ctCurrent(ctx) && this.ctSelection===unitId)this.ctCommentPostError=error.message;return false;}
                finally{if(this.ctCurrent(ctx))this.ctBusy=false;}
            },
            async ctPresence(ctx = this.ctContext()) {
                if (!this.managedOnlineAvailable || (!this.cloudCanAccessAllLanguages && ctx.scope.language!==this.cloudUser?.language) || String(ctx.scope.groupId).startsWith('local:')) return;
                try { await this._cloud.request('/v1/content-groups/' + encodeURIComponent(ctx.scope.groupId) + '/presence', { method: 'POST', body: { unitId: this.ctSelection || null, sessionId: this.instanceTabId, language: ctx.scope.language } }); const response=await this._cloud.request('/v1/content-groups/'+encodeURIComponent(ctx.scope.groupId)+'/presence'); if (this.ctCurrent(ctx)) this.ctPeers = response.presence || []; } catch (_) { /* Translation requests retain their own failures. */ }
            },
            ctVersionWorkbookDrag(event) {
                if(!fileDrag(event))return;
                event.preventDefault();
                event.dataTransfer.dropEffect=this.ctVersionWorkbookDropEnabled ? 'copy' : 'none';
                if(!this.ctVersionWorkbookDropEnabled){this.ctWorkbookDragDepth=0;return;}
                if(event.type==='dragenter')this.ctWorkbookDragDepth++;
            },
            ctVersionWorkbookDragLeave() { this.ctWorkbookDragDepth=Math.max(0,this.ctWorkbookDragDepth-1); },
            async ctDropVersionWorkbooks(event) {
                this.ctWorkbookDragDepth=0;
                if(!fileDrag(event))return false;
                event.preventDefault();
                const files=Array.from(event.dataTransfer.files || []).filter(file=>/\.(xlsx|xlsm)$/i.test(file.name));
                if(!this.ctVersionWorkbookDropEnabled || !files.length)return false;
                const key=this.managedCatalogScope,opening=this.ctOpenOfflineTest(),run=this._ctUploadOpenRun;
                if(!await opening || key!==this.managedCatalogScope || this._ctUploadOpenRun!==run
                    || !this.ctUploadVisible || !this.ctUploadTest || this.ctUploading)return false;
                return this.ctAddUploadFiles(files);
            },
            ctOpenOfflineTest() { return this.ctOpenUpload(null, true, true); },
            async ctOpenTestSheet() {
                if(!this.ctUploadTest || !this.ctUploadVisible || this.ctUploading || this.ctBusy || this._ctTestOpenRun || !this.ctUploadFiles.length)return false;
                const run=this._ctTestOpenRun={},key=this.managedCatalogScope,epoch=this._ctEpoch || 0;
                try{
                    const preparation=this.ctPrepareUpload(),signal=this._ctAbort?.signal;
                    await preparation;
                    if(this._ctTestOpenRun!==run || key!==this.managedCatalogScope || epoch!==(this._ctEpoch || 0)
                        || !this.ctUploadTest || !this.ctUploadVisible || signal?.aborted
                        || this.ctUploadError || !this.ctPrepared.length)return false;
                    return await this.ctPublishPrepared();
                }finally{if(this._ctTestOpenRun===run)this._ctTestOpenRun=null;}
            },
            ctCloseUpload() {
                if(this.ctUploading)return false;
                this.ctUploadVisible=false;this._ctUploadOpenRun=null;
                if(this.ctUploadTest){this.ctUploadFiles=raw([]);this.ctUploadHistoryFiles=raw([]);this.ctUploadHistory=false;this.ctPrepared=raw([]);}
                return true;
            },
            async ctOpenUpload(version = null, local = false, test = false, options = {}) {
                if ((!test && !local && !this.managedManagerAccess) || this.ctUploading || this.ctBusy) return false;
                if(test){local=true;version=null;this.managedOfflineContentMode='clienttext';}
                const key=this.managedCatalogScope;
                const run=this._ctUploadOpenRun={},current=()=>key===this.managedCatalogScope && this._ctUploadOpenRun===run;
                if(!version && !local && !options.resume){
                    await this.refreshManagedVersions();if(!current())return false;
                    if(this.managedNextVersionBlockedReason){this.managedSetOperationError('next-version',this.managedNextVersionBlockedReason);return false;}
                    this.managedSetOperationError('next-version','');
                }
                this._ctPublicationRequest=null;this._ctReleaseRequest=null;this._ctReleaseCommand=null;this.ctDuplicateChoices={};
                this.ctUploadSyncResources=false;this.ctUploadEnglishPrevious='';
                this.ctUploadVisible = true; this.ctUploadVersion = version; this.ctUploadLocal = local; this.ctUploadTest = test; this.ctUploadFiles = raw([]); this.ctPrepared = raw([]); this.ctUploadError = ''; this.ctUploadAssignments = teams.slice();
                const predecessorId=version ? version.parentVersionId : options.predecessor?.id || (!options.resume ? this.managedHeadVersion?.id : null);
                this.ctUploadPredecessor=local ? null : copy(options.predecessor || this.managedVersions?.find(candidate=>candidate.id===predecessorId) || (predecessorId ? {id:predecessorId,name:predecessorId} : null));
                this.ctUploadHistory=false;this.ctUploadHistoryFiles=raw([]);
                const defaults = root.ManagedVersions.defaults(this.gameVersion); this.ctUploadName = test ? '' : version?.name || defaults.name; this.ctUploadDeadline = root.ManagedVersions.deadlineInput(version?.deadlineAt || defaults.deadlineAt);
                if (!local) {
                    try { await this.ctRequireTrustedProtocol();if(!current())return false;this.ctPolicyText = JSON.stringify(this.ctPolicy.clientTextRoles, null, 2); }
                    catch (error) { if(current())this.ctUploadError = error.message; }
                    if(!current())return false;
                    if(this.ctUploadPredecessor && (!this.ctUploadPredecessor.name || this.ctUploadPredecessor.name===predecessorId))try{const result=await this._cloud.request('/v1/versions/'+encodeURIComponent(predecessorId));if(!current())return false;this.ctUploadPredecessor=copy(result.version);}catch(error){if(current())this.ctUploadError=error.message;}
                } else this.ctPolicy = { clientTextRoles: { default: ['normal'], ...Object.fromEntries(pairedLanguages.map(language=>[language,['normal','gender']])) } };
                return true;
            },
            ctSetHistoryComparison(enabled) {
                if(!this.ctUploadTest || this.ctUploading)return;
                this.ctUploadHistory=!!enabled;this.ctPrepared=raw([]);this.ctUploadError='';
            },
            ctChooseFiles(event, history = false) {
                if(this.ctAddUploadFiles(event.target.files,history) && this.ctUploadTest)event.target.value='';
            },
            ctAddUploadFiles(files, history = false) {
                if(this.ctUploading || history && (!this.ctUploadTest || !this.ctUploadHistory))return false;
                this.ctPrepared = raw([]); this.ctUploadError = '';
                const selected = Array.from(files || []).filter(file => (this.ctUploadTest ? /\.(xlsx|xlsm)$/i : /\.(xlsx|xlsm|zip)$/i).test(file.name)).map(file => ({ file, ...detect(file.name), ...(this.ctUploadTest ? { testVersion: history ? 'previous' : 'current' } : {}) }));
                const list=history ? 'ctUploadHistoryFiles' : 'ctUploadFiles';
                this[list] = raw(this.ctUploadTest ? [...this[list], ...selected] : selected);
                return true;
            },
            ctRemoveTestFile(index, history = false) {
                if(!this.ctUploadTest || this.ctUploading)return;
                const list=history ? 'ctUploadHistoryFiles' : 'ctUploadFiles';
                this[list]=raw(this[list].filter((_,position)=>position!==index));this.ctPrepared=raw([]);this.ctUploadError='';
            },
            async ctPrepareUpload() {
                if (this.ctUploading) return; this.ctUploading = true; this.ctUploadError = ''; this._ctAbort = new AbortController();
                const key = this.managedCatalogScope, prepared = [];
                try {
                    if (!this.ctUploadFiles.length) throw new Error(this.ctUploadTest ? 'Select at least one Current workbook to open.' : 'Select original workbook files or StatDescriptions.zip.');
                    if(this.ctUploadTest && this.ctUploadHistory && !this.ctUploadHistoryFiles.length)throw new Error('Select a Previous workbook for comparison or turn off Add history workbook for comparison.');
                    const selectedFiles=this.ctUploadTest ? [
                        ...this.ctUploadFiles.map(candidate=>({...candidate,testVersion:'current'})),
                        ...(this.ctUploadHistory ? this.ctUploadHistoryFiles.map(candidate=>({...candidate,testVersion:'previous'})) : [])
                    ] : this.ctUploadFiles;
                    const groups = new Map();
                    for (const candidate of selectedFiles) {
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
                        if (this.ctUploadTest && !['previous','current'].includes(candidate.testVersion || 'current')) throw new Error('Choose Previous or Current for ' + candidate.file.name + '.');
                        const groupKey = this.ctUploadTest ? JSON.stringify([candidate.language, candidate.testVersion || 'current']) : candidate.language;
                        const candidates = groups.get(groupKey) || []; if (candidates.some(item => item.role === candidate.role)) throw new Error('Duplicate ' + candidate.role + ' workbook for ' + candidate.language + (this.ctUploadTest ? ' in ' + (candidate.testVersion==='previous' ? 'Previous' : 'Current') + ' workbooks. Keep one workbook per role in each list.' : '.')); candidates.push(candidate); groups.set(groupKey, candidates);
                    }
                    if(this.ctUploadTest){
                        if(new Set(selectedFiles.map(candidate=>candidate.language)).size!==1)throw new Error('Test one language at a time. Select its normal workbook, Gender workbook, or both.');
                        const current=selectedFiles.filter(candidate=>candidate.testVersion==='current');
                        if(!current.length)throw new Error('Select at least one Current workbook to open.');
                        if(selectedFiles.some(candidate=>candidate.testVersion==='previous' && !current.some(next=>next.role===candidate.role)))throw new Error('Each Previous workbook needs a Current workbook with the same role.');
                    }
                    let testPrevious = null;
                    for (const candidates of groups.values()) {
                        const language = candidates[0].language;
                        if(!this.ctUploadLocal)await this.ctRequireTrustedProtocol(this._ctAbort.signal,[root.ClientTextState.PARSER_VERSION]);
                        const required = this.ctUploadTest ? ['normal','gender'].filter(role=>candidates.some(candidate=>candidate.role===role)) : this.ctPolicy.clientTextRoles[language] || this.ctPolicy.clientTextRoles.default || ['normal'];
                        if (required.some(role => !candidates.some(item => item.role === role)) || candidates.some(item => !required.includes(item.role))) throw new Error(language + ' requires exactly these workbook roles: ' + required.join(', ') + '.');
                        candidates.sort((a,b)=>required.indexOf(a.role)-required.indexOf(b.role));
                        const units = [], assets = [];
                        for (const candidate of candidates) {
                            // Internal workbook markers must agree with the selected game.
                            const bytes = await candidate.file.arrayBuffer();
                            // A browser File can retain a path-backed reference.
                            // Own the verified bytes before the user moves or
                            // removes the selected disk file during this session.
                            const originalBlob = new Blob([bytes], { type: candidate.file.type });
                            this.ctReport({phase:'Checking reusable original',workbook:candidate.file.name,sheet:'',completed:0,total:null});
                            const hash=await this.ctOriginalHash(bytes),cached=this.ctUploadTest ? null : await this._ctStore.getCachedOriginal?.(hash,root.ClientTextState.PARSER_VERSION,candidate.role,{guard:()=>key===this.managedCatalogScope && !this._ctAbort.signal.aborted});
                            if(cached){root.ClientTextCodec?.assertGame({sheets:cached.asset.parsed?.sheets,units:cached.units},this.gameVersion);for(const unit of cached.units)units.push(unit);assets.push({...cached.asset,role:candidate.role,blob:originalBlob,name:candidate.file.name,hash});}
                            else{
                                const parsed = await this._ctWorker.parseWorkbook(bytes, { filename: candidate.file.name, role: candidate.role, language, game:this.gameVersion, signal: this._ctAbort.signal, onProgress: progress => this.ctReport({...progress,workbook:candidate.file.name}) });
                                root.ClientTextCodec?.assertGame(parsed,this.gameVersion);
                                if(parsed.artifactHash!==hash)throw new Error('Workbook original changed while preparing the selected file.');
                                for(const unit of parsed.units)units.push(unit);
                                assets.push({ role: candidate.role, blob: originalBlob, name: candidate.file.name, hash,parserVersion:parsed.parserVersion, parsed: { ...parsed, units: undefined } });
                            }
                            if (key !== this.managedCatalogScope || this._ctAbort.signal.aborted) return;
                        }
                        this.ctReport({ phase: 'Counting initial workbook workload', workbook: language, sheet: '' });
                        const originals = await this.ctDescribeOriginals(units, assets,{signal:this._ctAbort.signal,onProgress:progress=>this.ctReport(progress)});
                        const preparedGroup={ contentMode: 'clienttext',storageProtocol:trustedProtocol, language, assignments: [language], candidates, units, assets, originals, warnings: assets.flatMap(asset => asset.parsed.warnings || []) };
                        if(!this.ctUploadLocal)await this.ctPrepareCarry(preparedGroup);
                        if(this.ctUploadTest && candidates[0].testVersion==='previous')testPrevious=preparedGroup;
                        else prepared.push(preparedGroup);
                    }
                    if(testPrevious)prepared[0].previous=testPrevious;
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
                    const command=existing?.payload.command || {game:scope.game,branchId:scope.branchId,name:this.ctUploadName.trim(),deadlineAt:root.ManagedVersions.parseDeadline(this.ctUploadDeadline),expectedHeadId:this.ctUploadPredecessor?.id || null,idempotencyKey:this._ctReleaseRequest};
                    await this._ctStore.putRequest(scope,this._ctReleaseRequest,{kind:'metadata',name:command.name,deadline:this.ctUploadDeadline,predecessor:existing?.payload.predecessor || copy(this.ctUploadPredecessor),command});if(key!==this.managedCatalogScope)return;
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
                        await this._ctStore.import(prepared.cacheScope,{units:prepared.units,assets:prepared.assets,descriptors:prepared.originals.descriptors,summaries:prepared.originals.summaries,metadata:{name:this.ctUploadName}},{guard:()=>key===this.managedCatalogScope && !signal.aborted,onProgress:progress=>this.ctReport({...progress,workbook:prepared.language})});
                    }
                }
                const groups=this.ctPrepared.map(prepared=>({contentMode:prepared.contentMode,language:prepared.language,storageProtocol:prepared.storageProtocol,assignments:prepared.assignments,parentGroupId:prepared.parentGroupId,cacheScope:prepared.cacheScope,carry:prepared.carry,
                    requestId:prepared.requestId,uploadId:prepared.uploadId,createBody:prepared.createBody,finalizeBody:prepared.finalizeBody,published:prepared.published,
                    candidates:prepared.contentMode==='statdescription'?prepared.candidates:undefined,warnings:prepared.warnings,duplicateGroups:prepared.duplicateGroups}));
                if(key!==this.managedCatalogScope || signal.aborted)throw Object.assign(new Error('Publication context changed'),{stale:true});
                await this._ctStore.putRequest(this.ctRequestScope(),this._ctPublicationRequest,{kind:'publication',name:this.ctUploadName,deadline:this.ctUploadDeadline,version:this.ctUploadVersion ? copy(this.ctUploadVersion) : null,predecessor:copy(this.ctUploadPredecessor),releaseRequest:this._ctReleaseRequest,releaseCommand:this._ctReleaseCommand,duplicateChoices:copy(this.ctDuplicateChoices),groups},{immutablePublicationData:true,guard:()=>key===this.managedCatalogScope && !signal.aborted});
            },
            async ctResumePublication(request) {
                const key=this.managedCatalogScope,epoch=this._ctEpoch || 0,current=()=>key===this.managedCatalogScope && epoch===(this._ctEpoch || 0);
                try {
                    const requestScope=this.ctRequestScope(),stored=await this._ctStore.getRequest(requestScope,request.requestId,{guard:current});
                    if(!current())return;
                    if(!stored){await this.ctRefreshLocal();return;}
                    const payload=stored.payload,previousId=payload.releaseCommand?.expectedHeadId || payload.command?.expectedHeadId;
                    const opened=await this.ctOpenUpload(payload.version || null,false,false,{resume:true,predecessor:payload.predecessor || (previousId ? {id:previousId} : null)});
                    if(opened===false || !current())return;
                    this.ctUploadName=payload.name;this.ctUploadDeadline=payload.deadline;this._ctPublicationRequest=request.requestId;this._ctReleaseRequest=payload.releaseRequest || (payload.kind==='metadata'?request.requestId:null);this._ctReleaseCommand=payload.releaseCommand || payload.command || null;
                    this.ctDuplicateChoices=payload.duplicateChoices || {};const prepared=[];
                    for(const group of payload.groups || []){
                        if(group.cacheScope){
                            const units=await this._ctStore.getUnits(group.cacheScope,{guard:current}),metadata=await this._ctStore.getMetadata(group.cacheScope,{guard:current}),assets=[];
                            for(const descriptor of metadata.descriptors)assets.push(await this._ctStore.getAsset(group.cacheScope,descriptor.role,{guard:current}));
                            const originals={storageProtocol:trustedProtocol,descriptors:metadata.descriptors,summaries:metadata.summaries};
                            prepared.push({...group,units,assets,originals,candidates:assets.map(asset=>({file:new File([assetBytes(asset)],asset.name),role:asset.role,language:group.language}))});
                        }else prepared.push(group);
                    }
                    if(current())this.ctPrepared=raw(prepared);
                } catch(error) { if(current() && !error.stale && error.name!=='AbortError')this.ctUploadError='Prepared upload could not be restored: '+error.message; }
            },
            async ctFindPreviousGroup(prepared) {
                const key=this.managedCatalogScope,game=this.gameVersion,branchId=this.branchId || 'default',versionId=this.ctUploadVersion?.id || '',signal=this._ctAbort?.signal,client=this._cloud;
                const query={game,branchId,contentMode:prepared.contentMode,...(prepared.contentMode==='clienttext'?{language:prepared.language}:{}),...(versionId?{versionId}:{expectedHeadId:this.ctUploadPredecessor?.id || ''}),...(prepared.logicalKey?{logicalKey:prepared.logicalKey}:{})};
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
                    const group=(await this._cloud.request('/v1/content-groups/'+encodeURIComponent(previousGroup.id),{signal})).group;current();
                    metadata=await this.ctCacheGroup(previousVersion,group,scope,{signal,current:()=>key===this.managedCatalogScope && !signal.aborted});current();
                }
                const previousUnits=new Map((await this._ctStore.getUnits(scope)).map(unit=>[unit.id,unit])),accepted={},previousAssets={};let after=0;
                current();
                for(const asset of prepared.assets){const previous=await this._ctStore.getAsset(scope,asset.role);current();previousAssets[asset.role]=previous;const before=new Map((previous?.parsed?.sheets || []).map(sheet=>[sheet.name,sheet]));for(const sheet of asset.parsed.sheets){const old=before.get(sheet.name);before.delete(sheet.name);if(!old){prepared.warnings.push({message:asset.role+' / '+sheet.name+': added sheet.'});continue;}const oldHeaders=new Map(old.headers.map(header=>[header.name,header.column])),changes=[];for(const header of sheet.headers){const column=oldHeaders.get(header.name);oldHeaders.delete(header.name);if(column===undefined)changes.push('added '+header.name);else if(column!==header.column)changes.push(header.name+' moved from column '+column+' to '+header.column);}for(const heading of oldHeaders.keys())changes.push('removed '+heading);if(changes.length)prepared.warnings.push({message:asset.role+' / '+sheet.name+': '+changes.join('; ')+'. Recognized fields retain their identity.'});}for(const sheet of before.keys())prepared.warnings.push({message:asset.role+' / '+sheet+': removed sheet; previous work remains in history.'});}
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
                    const markerReview=root.ClientTextState.reviewAudioMarkerChanges(old,next,state);
                    if(before || state.outdated.length || markerReview){
                        const asset=prepared.assets.find(asset=>asset.role===next.role),previousAsset=previousAssets[next.role];
                        carry.push({id:next.id,role:next.role,assetHash:asset.hash,parserVersion:asset.parserVersion || asset.parsed?.parserVersion || root.ClientTextState.PARSER_VERSION,
                            clientFacts:root.ClientTextState.clientFacts(next),originalValues:root.ClientTextState.originalValues(next),values:state.values,reviewed:state.reviewed,
                            previousFacts:root.ClientTextState.clientFacts(old),previousOriginalValues:root.ClientTextState.originalValues(old),
                            previousAssetHash:previousAsset.hash,previousParserVersion:previousAsset.parserVersion || previousAsset.parsed?.parserVersion || previousAsset.descriptor?.parserVersion || 'clienttext-v1',
                            provenance:{groupId:previousGroup.id,unitId:next.id,revision:before?.revision||0}});
                    }
                    if(index%256===255){this.ctReport({phase:'Comparing verified source',completed:index,total:prepared.units.length,sheet:next.sheet});await new Promise(resolve=>setTimeout(resolve,0));current();}
                }
                prepared.parentGroupId=previousGroup.id;prepared.carry=carry;prepared.warnings.push({message:'Previous accepted work will carry forward independently: '+carry.length+' affected IDs. Removed IDs remain accessible in the previous version.'});
            },
            async ctConvertLegacyPublication(prepared,version) {
                const key=this.managedCatalogScope,signal=this._ctAbort.signal,current=()=>key===this.managedCatalogScope && !signal.aborted,
                    scope=this.ctRequestScope(),oldRequest=this._ctPublicationRequest;
                const retained=await this._ctStore.getRequest(scope,oldRequest,{guard:current});
                if(!retained)throw new Error('The legacy upload recovery journal is unavailable. Its original request must be retained before conversion.');
                // The old bodies, IDs, assets and witness payloads stay as
                // recovery evidence. Conversion owns new request identities.
                await this._ctStore.putRequest(scope,oldRequest,{...retained.payload,kind:'publication-recovery'},{guard:current,immutablePublicationData:true});
                this._ctPublicationRequest=uuid();prepared.requestId=uuid();prepared.uploadId=null;prepared.finalizeBody=null;prepared.cacheScope=null;
                prepared.storageProtocol=trustedProtocol;prepared.originals=await this.ctDescribeOriginals(prepared.units,prepared.assets,{signal,onProgress:progress=>this.ctReport(progress)});
                prepared.carry=[];await this.ctPrepareCarry(prepared);
                if(!current())throw Object.assign(new Error('Legacy upload conversion was superseded.'),{stale:true});
                prepared.createBody={versionId:version.id,game:this.gameVersion,branchId:this.branchId,contentMode:'clienttext',storageProtocol:trustedProtocol,
                    language:prepared.language,assignments:prepared.assignments,roles:prepared.candidates.map(item=>item.role),parentGroupId:prepared.parentGroupId,
                    expectedMembershipRevision:version.membershipRevision || 0,idempotencyKey:prepared.requestId};
                await this.ctRememberPublication();
            },
            async ctPublishPrepared() {
                if (!this.ctPrepared.length || this.ctUploading) return; this.ctUploading = true; this.ctUploadError = ''; const key = this.managedCatalogScope,client=this._cloud; this._ctAbort = new AbortController();
                try {
                    if(this.ctUploadTest){
                        if(this.ctPrepared.length!==1 || this.ctPrepared[0].contentMode!=='clienttext')throw new Error('Prepare one ClientText language for this test session.');
                        const prepared=this.ctPrepared[0],versionId='local:test:'+uuid(),groupId='local:test:'+uuid(),
                            version={id:versionId,game:this.gameVersion,branchId:this.branchId || 'default',name:this.ctUploadName.trim() || prepared.assets.map(asset=>asset.name).join(' + ') || 'Local workbook'},
                            group={id:groupId,versionId,contentMode:'clienttext',language:prepared.language,roles:prepared.assets.map(asset=>asset.role)},
                            scope=this.ctScope(versionId,groupId,prepared.language),metadata={version,group,localProtocol:root.ClientTextLocalStore.protocol,localWorkspaceId:versionId,descriptors:prepared.originals.descriptors,syncResources:!!this.ctUploadSyncResources};
                        const store=this._ctLocalStore;
                        try{
                            const options={signal:this._ctAbort.signal,guard:()=>key===this.managedCatalogScope,
                                onProgress:progress=>this.ctReport(progress)};
                            let previousScope;
                            if(this.ctUploadEnglishPrevious){
                                if(prepared.previous)throw new Error('Choose either a saved local workbook or previous comparison files.');
                                const previous=this.ctLocalWorkspaces.find(row=>row.groupId===this.ctUploadEnglishPrevious);
                                if(!previous || !String(previous.groupId).startsWith('local:test:') || previous.game!==scope.game || previous.language!==scope.language || previous.branchId!==scope.branchId)throw new Error('Choose a saved local workbook in the same game, branch and language.');
                                previousScope=this.ctScope(previous.versionId,previous.groupId,previous.language);
                            }
                            if(prepared.previous){
                                const previous=prepared.previous,previousVersion={...version,id:'local:test:'+uuid(),name:'Previous workbook sample'},
                                    previousGroup={...group,id:'local:test:'+uuid(),versionId:previousVersion.id,roles:previous.assets.map(asset=>asset.role)},
                                    comparisonScope=this.ctScope(previousVersion.id,previousGroup.id,prepared.language);
                                previousScope=comparisonScope;
                                await store.import(previousScope,{units:previous.units,assets:previous.assets,descriptors:previous.originals.descriptors,
                                    summaries:previous.originals.summaries,metadata:{version:previousVersion,group:previousGroup,localProtocol:root.ClientTextLocalStore.protocol,localComparisonOnly:true}},options);
                            }
                            const retained=await store.import(scope,{units:prepared.units,assets:prepared.assets,descriptors:prepared.originals.descriptors,summaries:prepared.originals.summaries,metadata,...(previousScope?{previousScope}:{})},options);
                            if(key!==this.managedCatalogScope || this._ctAbort.signal.aborted)return false;
                            const opened=await this.ctActivate(scope,retained);
                            if(!opened && key===this.managedCatalogScope && this.ctWorkspace?.scope.groupId===groupId){
                                const message=this.ctError || 'The test sheet could not be opened. Prepare the workbook and try again.';
                                this.ctFence();this.versionChooserVisible=true;this.ctUploadVisible=true;this.ctUploadError=message;
                                this.ctPrepared=raw([prepared]);this.ctUploadFiles=raw(prepared.candidates);
                                this.ctUploadHistory=!!prepared.previous;this.ctUploadHistoryFiles=raw(prepared.previous?.candidates || []);
                            }
                            return opened;
                        }finally{store.releaseExcept(this.ctWorkspace?.scope.groupId?.startsWith('local:test:')?this.ctWorkspace.scope:null);await this.ctRefreshLocal();}
                    }
                    if(!this.ctUploadLocal && this.ctPrepared.some(group=>group.contentMode==='clienttext'))await this.ctRequireTrustedProtocol(this._ctAbort.signal,
                        this.ctPrepared.filter(group=>group.contentMode==='clienttext').flatMap(group=>[
                            ...(group.originals?.descriptors || []).map(descriptor=>descriptor.parserVersion),
                            ...(group.finalizeBody?.descriptors || []).map(descriptor=>descriptor.parserVersion),
                            ...(group.assets || []).map(asset=>asset.parserVersion || asset.parsed?.parserVersion || asset.descriptor?.parserVersion || 'clienttext-v1')
                        ]));
                    if (this.ctUploadLocal) {
                        const versionId = 'local:' + uuid(), metadataVersion = { id: versionId, game: this.gameVersion, branchId: this.branchId, name: this.ctUploadName, contentGroups: this.ctPrepared.map(prepared=>({ id: 'local:' + uuid(), versionId, contentMode: 'clienttext', language: prepared.language, roles: prepared.assets.map(asset=>asset.role) })) };
                        for (let index=0;index<this.ctPrepared.length;index++) {
                            const prepared=this.ctPrepared[index],group=metadataVersion.contentGroups[index];
                            const scope = this.ctScope(versionId, group.id, prepared.language), metadata = { version: metadataVersion, group };
                            await this._ctStore.import(scope, { units: prepared.units, assets: prepared.assets, descriptors: prepared.originals.descriptors,summaries: prepared.originals.summaries, metadata },{guard:()=>key===this.managedCatalogScope && !this._ctAbort.signal.aborted,onProgress:progress=>this.ctReport({...progress,workbook:prepared.language})});
                        }
                        this.ctUploadVisible = false; await this.ctRefreshLocal(); return;
                    }
                    let version = this.ctUploadVersion;
                    this._ctReleaseRequest ||= uuid();if(!version)this._ctReleaseCommand ||= {game:this.gameVersion,branchId:this.branchId,name:this.ctUploadName.trim(),deadlineAt:root.ManagedVersions.parseDeadline(this.ctUploadDeadline),expectedHeadId:this.ctUploadPredecessor?.id || null,idempotencyKey:this._ctReleaseRequest};await this.ctRememberPublication();
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
                        prepared.createBody ||= { versionId: version.id,game:this.gameVersion,branchId:this.branchId, contentMode: prepared.contentMode,...(prepared.contentMode==='clienttext'?{storageProtocol:trustedProtocol}:{}), language: prepared.language, assignments: prepared.assignments, roles: prepared.contentMode==='statdescription'?['source']:prepared.candidates.map(item => item.role),parentGroupId:prepared.parentGroupId, expectedMembershipRevision: version.membershipRevision || 0, idempotencyKey: prepared.requestId };
                        await this.ctRememberPublication();
                        const response = await this._cloud.request('/v1/content-uploads', { method: 'POST', body: prepared.createBody,signal:this._ctAbort.signal });
                        let upload = response.upload; prepared.uploadId = upload.id;
                        // A creation receipt freezes its original response.
                        // Resolve live state before replaying assets/converting
                        // an upload whose finalize may already have succeeded.
                        upload=(await client.request('/v1/content-uploads/'+encodeURIComponent(upload.id),{signal:this._ctAbort.signal})).upload;
                        if(!upload || upload.id!==prepared.uploadId)throw new Error('The upload state identifies another publication.');
                        await this.ctRememberPublication();
                        if(upload.status==='accepted'){
                            prepared.published=true;version=(await this._cloud.request('/v1/content-groups/'+encodeURIComponent(upload.groupId))).group.version;this.ctUploadVersion=version;await this.ctRememberPublication();continue;
                        }
                        if(prepared.contentMode==='clienttext' && (upload.legacyConversionRequired || prepared.createBody.storageProtocol!==trustedProtocol)){
                            await this.ctConvertLegacyPublication(prepared,version);
                            if(key!==this.managedCatalogScope || this._ctAbort.signal.aborted)return;
                            upload=(await client.request('/v1/content-uploads',{method:'POST',body:prepared.createBody,signal:this._ctAbort.signal})).upload;prepared.uploadId=upload.id;await this.ctRememberPublication();
                        }
                        for (const candidate of prepared.candidates) {
                            if(key!==this.managedCatalogScope || this._ctAbort.signal.aborted)return;
                            this.ctReport({ phase: 'Uploading original', workbook: candidate.file.name, sheet: '', completed: 0, total: candidate.file.size });
                            await this._cloud.request('/v1/content-uploads/' + encodeURIComponent(upload.id) + '/assets/' + encodeURIComponent(prepared.contentMode === 'statdescription' ? 'source' : candidate.role) + '?filename='+encodeURIComponent(candidate.file.name), { method: 'PUT', rawBody: candidate.file,signal:this._ctAbort.signal, timeout: 180000, onUploadProgress: (completed, total) => this.ctReport({ completed, total }) });
                        }
                        for(let start=0,index=0;start<(prepared.carry?.length||0);index++){
                            let end=start,bytes=0;while(end<prepared.carry.length && end-start<2000){const size=new TextEncoder().encode(JSON.stringify(prepared.carry[end])).length+1;if(bytes+size>1800000 && end>start)break;bytes+=size;end++;}
                            this.ctReport({phase:'Uploading carry-forward work',workbook:prepared.language,completed:start,total:prepared.carry.length,sheet:''});
                            await this._cloud.request('/v1/content-uploads/'+encodeURIComponent(upload.id)+'/carry/chunks',{method:'POST',body:{storageProtocol:trustedProtocol,index,units:prepared.carry.slice(start,end)},compressJson:this.ctPolicy.uploadEncodings?.includes('gzip'),signal:this._ctAbort.signal,timeout:180000});start=end;
                            if(key!==this.managedCatalogScope || this._ctAbort.signal.aborted)return;
                        }
                        const decisions=[];for(const duplicate of prepared.duplicateGroups || []){const choice=this.ctDuplicateChoices[duplicate.filepath+'|'+(duplicate.language || duplicate.lang)],option=duplicate.options.find(option=>String(option.occurrence)===String(choice));if(!option)throw new Error('Choose one block for '+duplicate.filepath+' · '+(duplicate.language || duplicate.lang));decisions.push({filepath:duplicate.filepath,language:duplicate.language || duplicate.lang,occurrence:option.occurrence,blockHash:option.blockHash || await root.CollaborationProtocol.blockHash(option)});}
                        prepared.finalizeBody ||= { ...(prepared.contentMode==='clienttext'?{storageProtocol:trustedProtocol,descriptors:prepared.originals.descriptors,summaries:prepared.originals.summaries}:{}),decisions, expectedMembershipRevision: version.membershipRevision || 0, idempotencyKey: prepared.requestId };
                        await this.ctRememberPublication();
                        let result;
                        try{result=await this._cloud.request('/v1/content-uploads/' + encodeURIComponent(upload.id) + '/finalize', { method: 'POST', body: prepared.finalizeBody,signal:this._ctAbort.signal, timeout: 180000 });}
                        catch(error){if(error.code==='VERSION_MEMBERSHIP_CHANGED' && key===this.managedCatalogScope){const details=await this._cloud.request('/v1/versions/'+encodeURIComponent(version.id),{signal:this._ctAbort.signal});if(key!==this.managedCatalogScope)return;this.ctUploadVersion=details.version;prepared.finalizeBody.expectedMembershipRevision=details.version.membershipRevision;await this.ctRememberPublication();throw new Error('Another complete group was added to this version. Its membership is refreshed; retry publication to add your prepared group.');}throw error;}
                        if(key!==this.managedCatalogScope || this._ctAbort.signal.aborted)return;
                        prepared.published = true; version = result.version || { ...version, membershipRevision: (version.membershipRevision || 0) + 1 }; this.ctUploadVersion = version;
                        const group = result.group || result.contentGroup;
                        if (prepared.contentMode === 'clienttext' && group) await this._ctStore.import(this.ctScope(version.id, group.id, prepared.language), { units: prepared.units, assets: prepared.assets, descriptors: prepared.originals.descriptors,summaries: prepared.originals.summaries, metadata: { version, group } },{guard:()=>key===this.managedCatalogScope,onProgress:progress=>this.ctReport({...progress,workbook:prepared.language})});
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
    const contextComponent = { name:'ClientTextContext',props:{host:Object,items:{type:Array,default:()=>[]},compact:Boolean,rowBounded:Boolean},
        mounted() { this.scheduleBounds(); },
        updated() { this.scheduleBounds(); },
        beforeUnmount() { this._boundsObserver?.disconnect();root.cancelAnimationFrame?.(this._boundsFrame); },
        methods:{
            showTooltip(event,text) { this.host.showTooltip?.(event,text); },
            hideTooltip() { this.host.hideTooltip?.(); },
            scheduleBounds() {
                if(!this.rowBounded || this._boundsFrame || !root.requestAnimationFrame)return;
                this._boundsFrame=root.requestAnimationFrame(()=>{this._boundsFrame=null;this.measureBounds();});
            },
            measureBounds() {
                const element=this.$refs.context,row=element?.closest('tr'),identity=element?.parentElement;
                if(!row || !element.getClientRects().length)return;
                const cells=[...row.children].filter(cell=>cell.matches('.inlineSourceCell,.inlineTranslationCell')),
                    siblings=[...identity.children].filter(child=>child!==element),
                    observed=[...cells.flatMap(cell=>[...cell.children]),...siblings,element.firstElementChild];
                if(root.ResizeObserver && (!this._boundsNodes || observed.some((node,index)=>node!==this._boundsNodes[index]) || observed.length!==this._boundsNodes.length)){
                    this._boundsObserver ||= new root.ResizeObserver(()=>this.scheduleBounds());
                    this._boundsObserver.disconnect();observed.forEach(node=>this._boundsObserver.observe(node));this._boundsNodes=observed;
                }
                const style=root.getComputedStyle(element),rect=element.getBoundingClientRect(),
                    first=element.querySelector('.ctContextEntry'),number=value=>parseFloat(value)||0,
                    minimum=(first?.getBoundingClientRect().height || 0)+number(style.paddingTop)+number(style.paddingBottom)+number(style.borderTopWidth)+number(style.borderBottomWidth),
                    before=rect.top-identity.getBoundingClientRect().top-number(root.getComputedStyle(identity).paddingTop),
                    after=Math.max(number(style.marginBottom),...siblings.filter(node=>element.compareDocumentPosition(node)&4)
                        .map(node=>node.getBoundingClientRect().bottom-rect.bottom+number(root.getComputedStyle(node).marginBottom)));
                // Measure the contents, never the table cells: their shared row
                // height already includes context and would feed back into itself.
                const contentHeight=Math.max(0,...cells.map(cell=>{
                    const top=cell.getBoundingClientRect().top+number(root.getComputedStyle(cell).paddingTop);
                    return Math.max(top,...[...cell.children].map(child=>child.getBoundingClientRect().bottom+number(root.getComputedStyle(child).marginBottom)))-top;
                })),height=Math.ceil(Math.max(minimum,contentHeight-before-after));
                if(element.style.maxHeight!==height+'px')element.style.maxHeight=height+'px';
            },
        },template:`<section v-if="items.length" ref="context" class="ctReferenceContext" :class="{ctContextCompact:compact,ctContextRowBounded:rowBounded}" :tabindex="rowBounded ? 0 : -1" aria-label="Context" @click.stop @dblclick.stop>
            <dl><div v-for="item in items" :key="item.name" class="ctContextEntry"><dt>{{ item.name }}</dt><dd class="ctContextValue"><span v-for="(part,index) in item.parts" :key="index" class="ctContextPart" :tabindex="part.tooltip ? 0 : undefined" :aria-label="part.tooltip || undefined" v-tooltip="part.tooltip">{{ part.text }}</span></dd></div></dl>
        </section>` };
    const fieldsComponent = { props: {host:Object,side:{type:String,default:'both'}},
        components: {...(root.ClientTextAudio ? {'ct-dialogue-audio':root.ClientTextAudio.controlsComponent} : {}),
            ...(root.ClientTextToneNotesUI ? {'ct-tone-notes-button':root.ClientTextToneNotesUI.Button} : {}),
            ...(root.ClientTextPortraits ? {'ct-portraits':root.ClientTextPortraits.component} : {})},
        methods: {
            showTooltip(event,text) { this.host.showTooltip?.(event,text); },
            hideTooltip() { this.host.hideTooltip?.(); },
            audioSource(group,source) {
                const first=this.host.ctFieldGroups.find(candidate=>this.host.ctGroupSources(candidate).length);
                return group.key===first?.key && source.key===this.host.ctGroupSources(group)[0]?.key;
            },
        },
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
            <section v-if="side !== 'source' && host.ctPendingSharedRecovery()" class="ctDeveloperNotes editBlock" data-inline-focus-surface><strong>Shared work needs an explicit choice</strong><p>The rejected or conflicting command is retained. Accept the shared version, or save the latest retained work again with the current protocol. Both choices keep the old command in recovery history.</p><button type="button" :disabled="host.ctBusy || host.ctRecoveryBusy || host.ctHistoryViewer" @click="host.ctResolveSharedPending('accept-peer')">Accept shared version</button><button type="button" :disabled="host.ctBusy || host.ctRecoveryBusy || host.ctHistoryViewer" @click="host.ctResolveSharedPending('reapply')">Reapply retained work and save ID</button><small>Accepting shared work keeps your private draft. Reapplying preserves the previous editor text in recovery history.</small></section>
            <template v-if="side !== 'source' && !host.ctPendingSharedRecovery()"><section v-for="(choice,index) in host.ctChoices" :key="index" class="ctDeveloperNotes editBlock"><strong>Translation choice · {{ host.ctHistoryFieldLabel(host.ctCurrentUnit.fields.find(field=>field.id===choice.fieldId) || {name:choice.fieldId}) }}</strong><p>Incoming translation remains active. Choose the text to keep.</p><pre>{{ choice.upstream ?? choice.remote }}</pre><button :disabled="host.ctChoiceDisabled(choice)" @click="host.ctChooseAlternative(choice,'remote')">Keep incoming</button><pre>{{ choice.local }}</pre><button :disabled="host.ctChoiceDisabled(choice)" @click="host.ctChooseAlternative(choice,'local')">Use previous saved text</button></section></template>
            </div></div>
            <section v-for="group in host.ctFieldGroups" :key="group.key" class="ctBlock editBlock" :class="{inlineFileBlock:side !== 'both',ctFormBlock:group.forms}" :data-field-group="group.key" :data-inline-block="side !== 'both' ? 'field:'+group.key : undefined" :data-inline-side="side === 'source' ? 'english' : side === 'translation' ? 'translation' : undefined"><div :class="{inlineBlockNatural:side !== 'both'}">
                <h3 v-if="side === 'both'">{{ group.name }}</h3>
                <div class="ctFieldPair" :class="{ctFullFieldPair:side === 'both'}">
                <div v-if="side !== 'translation'" class="editorSourceField ctFieldSource">
                    <template v-if="group.fields.some(field=>field.kind !== 'gender' || field.source)">
                    <div v-for="source in host.ctGroupSources(group)" :key="source.key" :data-source-field="source.key" class="ctSourceBlock inputField">
                        <label v-if="side === 'both' || host.ctGroupSources(group).length > 1" class="ctSourceLabel"><template v-if="side === 'both'">English<span v-if="host.ctGroupSources(group).length > 1"> · </span></template><span v-if="host.ctGroupSources(group).length > 1">{{ source.label }}</span></label>
                        <component :is="host.ctFieldToolbar ? 'editor-field-toolbar' : 'div'" :controller="host.ctFieldToolbar ? host.ctFieldToolbar(host.ctSourceComparisonField(source),'source',source.fieldIds) : undefined">
                        <pre v-if="host.ctFieldToolbar && host.ctComparisonState(host.ctSourceComparisonField(source),'source').open && host.ctComparisonParts(host.ctSourceComparisonField(source),'source')" class="ctInlineDiff ctSourceDiff" aria-label="English source differences"><span v-for="(part,index) in host.ctComparisonParts(host.ctSourceComparisonField(source),'source')" :key="index" :class="{diffInlineAdd:part.added,diffInlineDel:part.removed}">{{ host.ctHistoryDisplay(part.value) }}</span></pre>
                        <editor-native-field v-else :controller="host.ctSourceFieldController(group,source)" kind="english" :compact="side !== 'both'"></editor-native-field>
                        </component>
                        <ct-dialogue-audio v-if="$options.components['ct-dialogue-audio'] && audioSource(group,source)" :host="host" :surface="side"></ct-dialogue-audio>
                        <ct-portraits v-if="$options.components['ct-portraits'] && host.ctRowPortraits && audioSource(group,source)" :items="host.ctRowPortraits(host.ctCurrentUnit)"></ct-portraits>
                        <ct-tone-notes-button v-if="$options.components['ct-tone-notes-button'] && audioSource(group,source)" :host="host"></ct-tone-notes-button>
                    </div>
                    </template>
                </div>
                <div v-if="side !== 'source'" class="ctFieldTranslation">
                <ct-target v-for="field in group.fields.filter(field=>field.kind !== 'form')" :key="field.id" :host="host" :field="field" :compact="side !== 'both'"></ct-target>
                <table v-if="group.forms && host.ctNamedForms(group).length" class="ctFormGrid ctNamedFormGrid"><thead><tr><th>Form</th><th>Translation</th></tr></thead><tbody>
                    <tr v-for="field in host.ctNamedForms(group)" :key="field.id"><th>{{ host.ctNamedFormLabel(field) }}</th><td><ct-target :host="host" :field="field" :compact="side !== 'both'"></ct-target></td></tr>
                </tbody></table>
                <table v-if="group.forms && host.ctDefaultForms(group).length" class="ctFormGrid"><thead><tr><th>Form</th><th>Singular</th><th v-if="host.ctDefaultForms(group).some(field => ['MP','FP','NP'].includes(field.form))">Plural</th></tr></thead><tbody>
                    <tr v-for="row in ['M','F','N'].filter(row => host.ctDefaultForms(group).some(field => field.form.startsWith(row)))" :key="row"><th>{{ row }}</th>
                    <td v-for="number in (host.ctDefaultForms(group).some(field => ['MP','FP','NP'].includes(field.form)) ? ['S','P'] : ['S'])" :key="number">
                        <template v-if="host.ctForm(group,row+number)"><ct-target :host="host" :field="host.ctForm(group,row+number)" :compact="side !== 'both'"></ct-target></template><span v-else class="versionMuted">Unavailable</span>
                    </td></tr></tbody></table>
                <section v-if="host.ctClassFields(group).length" class="ctClassVariants" :data-variant-group="group.key">
                    <div class="ctClassVariantsHeader"><strong>Class variants</strong><small>{{ host.ctClassVariantCounts(group) }}</small></div>
                    <small v-if="host.ctVariantSummary(host.ctClassFields(group))" class="ctVariantSummary">{{ host.ctVariantSummary(host.ctClassFields(group)) }}</small>
                    <small v-if="host.ctGenericVariantsToSave(group).length" class="ctVariantSummary">Save to apply generic fallback for {{ host.ctGenericVariantsToSave(group).length }} blank class variants.</small>
                    <button v-if="host.ctBlankVariantsToReview(group).length" type="button" class="ctReviewBlankVariants" :disabled="host.ctBlankVariantReviewBlocked(group)" v-tooltip="'Blank class variants use generic defaults where available and English for missing defaults. Mark these variants reviewed for the current source; Save applies the review.'" @click.stop="host.ctReviewBlankVariants(group,$event)">Review blank variants ({{ host.ctBlankVariantsToReview(group).length }})</button>
                    <small v-if="host.ctStagedBlankVariantReviews(group).length" class="ctVariantSummary" role="status">{{ host.ctStagedBlankVariantReviews(group).length }} blank variant{{ host.ctStagedBlankVariantReviews(group).length === 1 ? '' : 's' }} reviewed · Save to apply</small>
                    <div class="ctVariantTabs" role="tablist" aria-label="Populated class variants"><button v-for="field in host.ctPopulatedVariants(group)" :key="field.id" type="button" role="tab" :aria-label="host.ctClassVariantLabel(field)" :aria-selected="host.ctSelectedVariant(group)?.id === field.id" :tabindex="host.ctSelectedVariant(group)?.id === field.id ? 0 : -1" :class="{active:host.ctSelectedVariant(group)?.id === field.id,missing:host.ctVariantFacts(field).missing,outdated:host.ctVariantFacts(field).outdated}" :title="host.ctVariantLabel(field)" @click="host.ctSelectVariant(group,field.id)" @keydown="host.ctVariantTabKeydown(group,field,$event)">{{ host.ctClassVariantName(field) }}<span v-if="host.ctVariantFacts(field).missing || host.ctVariantFacts(field).outdated || host.ctVariantFacts(field).error || host.ctVariantFacts(field).warning" class="ctVariantDot" aria-hidden="true">●</span></button></div>
                    <label class="ctVariantPicker">All variants<select :value="host.ctSelectedVariant(group)?.id" aria-label="All worksheet class variants" @change="host.ctSelectVariant(group,$event.target.value)"><option v-for="field in host.ctClassFields(group)" :key="field.id" :value="field.id">{{ host.ctVariantLabel(field) }}</option></select><small>{{ host.ctSelectedVariant(group)?.targetCell }}</small></label>
                    <ct-target v-if="host.ctSelectedVariant(group)" :key="host.ctSelectedVariant(group).id" :host="host" :field="host.ctSelectedVariant(group)" :compact="side !== 'both'"></ct-target>
                </section>
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
            diagnosticPresentation() {return this.host.ctFieldController(this.field).diagnosticPresentation;},
        },
        watch: {
            field: {flush:'sync',handler() {this.genderMultilineLatched=this.genderMultilineRequired;}},
            genderMultilineRequired: {immediate:true,flush:'sync',handler(value) {if(value)this.genderMultilineLatched=true;}},
        }, template: `
        <div class="ctTarget" :class="{missing:host.ctFieldStatus(field).missing,outdated:host.ctFieldStatus(field).outdated,mtl:!!host.ctMtlCandidate?.(field)}">
            <label :for="'ctfield-'+field.targetCell" :class="{srOnly:field.kind === 'form' || (field.kind === 'gender' ? !compact : compact)}">{{ field.kind === 'gender' ? 'Gender' : field.kind === 'form' ? field.name+' '+host.ctClassVariantLabel(field) : (host.ctWorkspace?.scope.language || host.lang)+' translation' }} <small>{{ field.required ? '' : 'Optional' }}</small></label>
            <p v-if="field.kind !== 'gender' && !String(field.source || '').trim()" class="ctBlankSourceReview" role="note"><strong v-if="compact">{{ field.name }} · </strong>English is blank. Review or clear the translation, then Save. A blank translation is allowed.</p>
            <component :is="host.ctFieldToolbar ? 'editor-field-toolbar' : 'div'" :controller="host.ctFieldToolbar ? host.ctFieldToolbar(field,'translation') : undefined">
            <template v-if="field.kind === 'gender'">
                <div v-if="genderMultiline" class="textHL editorTextField multiline"><textarea :id="'ctfield-'+field.targetCell" :data-ct-target="field.id" :value="host.ctValues[field.id]" @focus="host.ctFocusedField=field.id" @input="host.ctGenderEdited(field,$event)" @compositionend="host.ctGenderEdited(field,$event)" @paste="host.ctGenderPaste(field,$event)" @keydown="host.ctGenderKeydown(field,$event)" aria-label="Gender" spellcheck="false" rows="1"></textarea></div>
                <template v-else><input type="text" :id="'ctfield-'+field.targetCell" :data-ct-target="field.id" :list="'ctgender-'+field.targetCell" :value="host.ctValues[field.id]" @focus="host.ctFocusedField=field.id" @input="host.ctGenderEdited(field,$event)" @compositionend="host.ctGenderEdited(field,$event)" @paste="host.ctGenderPaste(field,$event)" @keydown="host.ctGenderKeydown(field,$event)" aria-label="Gender" placeholder="Blank" spellcheck="false" autocomplete="off"><datalist :id="'ctgender-'+field.targetCell"><option v-for="gender in host.ctGenderSuggestions(field)" :key="gender" :value="gender" :label="host.ctGenderSuggestionLabel(gender,field)"></option></datalist></template>
            </template>
            <editor-native-field v-else :controller="host.ctFieldController(field)" kind="translation" :key="host.ctSelection+':'+field.id" :compact="compact"></editor-native-field>
            </component>
            <div v-if="host.ctMtlVisible && host.ctMtlPendingDismissal?.(field)" class="ctMtlReview ctMtlDismissal" data-inline-focus-surface role="status" @click.capture="host.ctMtlReviewFocus(field,$event)"><span>{{ host.ctMtlDismissalText(host.ctMtlPendingDismissal(field)) }}</span><small v-if="String(host.ctWorkspace?.scope?.groupId || '').startsWith('local:')">Keep this tab and workbook session open; closing or reloading loses unsent dismissal requests.</small><button type="button" @click="host.ctMtlRetryDismissals(host.ctMtlPendingDismissal(field))" :disabled="host.ctBusy">Retry dismissal upload</button></div>
            <div v-if="host.ctMtlVisible && (host.ctMtlPendingCandidate?.(field) || host.ctMtlAccepted?.(field))" class="ctMtlReview" data-inline-focus-surface @click.capture="host.ctMtlReviewFocus(field,$event)"><span class="ctMtlDot" aria-hidden="true"></span><span>MTL · {{ host.ctMtlAccepted?.(field) ? 'Accepted draft · Save to apply' : 'Needs review' }}</span><template v-if="host.ctMtlCandidate?.(field)"><button type="button" @click="host.ctMtlAccept(field)" :disabled="host.ctBusy || host.ctMtlBusy?.(field) || host.ctMtlDismissBusyFor?.(field)" title="Use as a reviewed draft. Save applies this text.">Accept</button><button type="button" @click="host.ctMtlDismiss(field)" :disabled="host.ctBusy || host.ctMtlBusy?.(field) || host.ctMtlDismissBusyFor?.(field)">Dismiss</button><small>Save and export use the underlying translation until you accept this text.</small></template><template v-else-if="host.ctMtlAccepted?.(field)"><button type="button" @click="host.ctMtlUndoAccept(field)" :disabled="host.ctBusy || host.ctMtlBusy?.(field)">Undo accept</button></template><template v-else><button type="button" @click="host.ctMtlShow(field)" :disabled="host.ctBusy || host.ctMtlBusy?.(field) || host.ctMtlDismissBusyFor?.(field)">Review MTL</button><button type="button" @click="host.ctMtlDismiss(field)" :disabled="host.ctBusy || host.ctMtlBusy?.(field) || host.ctMtlDismissBusyFor?.(field)">Dismiss</button></template><button v-if="host.ctMtlRecoveryReviews?.(field)?.length" type="button" @click="host.ctMtlRecoverReview(field)" :disabled="host.ctBusy || host.ctMtlBusy?.(field) || host.ctMtlDismissBusyFor?.(field)">Recover my review</button></div>
            <div v-if="host.ctFieldStatus(field).missing || host.ctFieldStatus(field).outdated || diagnosticPresentation.warningCount || diagnosticPresentation.errorCount" class="ctFieldFacts fieldMeta"><span v-if="host.ctFieldStatus(field).missing">Missing</span><span v-if="host.ctFieldStatus(field).outdated">Outdated</span><span v-if="host.ctReviewed[field.id] === host.ctReviewHash(field) && host.ctFieldStatus(field).outdated">Reviewed</span><button v-if="host.ctFieldStatus(field).outdated && host.ctReviewed[field.id] !== host.ctReviewHash(field) && (field.required || host.ctClassFallback(field)?.kind !== 'generic')" :disabled="host.ctBusy || host.ctMtlBusy?.(field) || !!host.ctMtlCandidate?.(field)" @click="host.ctMarkReviewed(field,$event)">Mark reviewed</button><editor-diagnostic-meta :presentation="diagnosticPresentation"></editor-diagnostic-meta></div>
            <div v-for="(issue,index) in diagnosticPresentation.notes" :key="index" :class="issue.kind === 'consistency' ? 'consistencyWarning' : 'terminologyWarning'" role="note">{{ issue.message }}</div>
        </div>` };
    const comparisonMixin=root.ClientTextComparisons?.mixin;
    if(comparisonMixin){const originalData=mixin.data;mixin.data=function(){return {...originalData.call(this),...comparisonMixin.data.call(this)};};Object.assign(mixin.methods,comparisonMixin.methods);}
    const toolsComponent = root.EditorComponents?.Tools;
    return { mixin, teams, detect, translatedFilename, workbookExportNames, groupFields, isDNTSource, mode, contextComponent, fieldsComponent, targetComponent, toolsComponent };
});

