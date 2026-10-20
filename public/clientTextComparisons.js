/* Field comparisons use verified originals; formatting edits only the current draft. */
(function (root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.ClientTextComparisons = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
    'use strict';
    const copy = value => JSON.parse(JSON.stringify(value));
    const raw = value => root.Vue?.markRaw ? root.Vue.markRaw(value) : value;
    const key = (side, field) => side + ':' + field.id;
    const snapshot = unit => ({ unit: copy(unit), values: root.ClientTextState.valuesFor(unit), reviewed: {}, available: true });
    const stale = () => Object.assign(new Error('Comparison context changed.'), { stale: true, name: 'AbortError' });
    const mixin = {
        data() { return { ctFieldComparisons: {}, ctComparisonVersions: raw([]), ctComparisonBusy: false,
            ctComparisonError: '', ctComparisonMore: true, ctComparisonMenuKey: '', ctComparisonDetailsKey: '', ctStyleSelection: null }; },
        methods: {
            ctResetComparisons() {
                this._ctComparisonAbort?.abort(); this._ctComparisonAbort = null; this._ctComparisonRun = {}; this._ctComparisonPending = null;
                this._ctComparisonAncestors = new Set(); this._ctComparisonCursor = undefined; this._ctComparisonCandidate = null; this._ctToolbarSelection = null;
                this.ctClearFormattingSelection();
                this.ctFieldComparisons = {}; this.ctComparisonVersions = raw([]); this.ctComparisonBusy = false;
                this.ctComparisonError = ''; this.ctComparisonMore = true; this.ctComparisonMenuKey = ''; this.ctComparisonDetailsKey = '';
            },
            ctComparisonState(field, side) { return this.ctFieldComparisons[key(side, field)] || { open: false, reference: '', manual: false }; },
            ctSetComparisonState(field, side, update) {
                this.ctFieldComparisons = { ...this.ctFieldComparisons, [key(side, field)]: { ...this.ctComparisonState(field, side), ...update } };
            },
            ctComparisonSnapshot(reference) {
                return this.ctComparisonVersions.find(version => version.key === reference)?.snapshot || this.ctHistorySnapshotFor(reference);
            },
            ctComparisonVersionLabel(version) { return version?.name || version?.id || 'Current version'; },
            ctComparisonChoices(field, side) {
                const current = this.ctComparisonVersionLabel(this.ctWorkspace?.metadata?.version), choices = [];
                if (side === 'translation') choices.push({ key: 'original', group: current, label: current+' · Original workbook', available: true });
                for (const version of this.ctComparisonVersions) choices.push({ key: version.key,
                    group: this.ctComparisonVersionLabel(version.version), label: this.ctComparisonVersionLabel(version.version)+' · '+(version.localTest ? 'Offline sample · Original workbook' : 'Original workbook'), available: true });
                if (side === 'translation') for (const entry of this.ctHistory.filter(entry=>!this.ctComparisonVersions.some(version=>version.key===entry.key))) for (const part of ['after', 'before']) {
                    if (!entry[part]?.available || !Object.prototype.hasOwnProperty.call(entry[part].values, field.id)) continue;
                    const version = entry.previousScope && this.ctComparisonVersions.find(value => value.scope.groupId === entry.previousScope.groupId)?.version;
                    const revision = entry[part].revision ?? (part === 'after' ? entry.revision : null),
                        actor = entry.actor?.name || entry.actor?.id || (entry.origin === 'shared' ? 'Unknown collaborator' : ''),
                        origin = entry.origin === 'shared' ? 'Shared' : this.ctOfflineTest && entry.action === 'version_import' ? 'Offline sample' : 'Local save';
                    choices.push({ key: entry.key + ':' + part, group: this.ctComparisonVersionLabel(version || this.ctWorkspace?.metadata?.version),
                        label: this.ctComparisonVersionLabel(version || this.ctWorkspace?.metadata?.version)+' · '+origin + (actor ? ' · '+actor : '') + (revision != null ? ' · r' + revision : '') + ' · ' + part + (entry.createdAt ? ' · ' + new Date(entry.createdAt).toLocaleString() : ''), available: true });
                }
                return choices;
            },
            ctComparisonReference(field, side) {
                const state = this.ctComparisonState(field, side);
                return state.reference || (side === 'source' ? this.ctComparisonVersions[0]?.key : 'original') || '';
            },
            ctComparisonParts(field, side) {
                const before = this.ctComparisonSnapshot(this.ctComparisonReference(field, side)); if (!before?.available) return null;
                const previous = before.unit.fields.find(value => value.id === field.id),
                    a = side === 'source' ? previous?.source ?? '' : before.values[field.id] ?? '',
                    b = side === 'source' ? field.source : this.ctValues[field.id];
                return this.ctHistoryDiffParts(a, b);
            },
            ctAutoOpenComparisons() {
                const previous = this.ctComparisonVersions[0]; if (!previous) return;
                for (const field of this.ctCurrentUnit?.fields || []) {
                    const state = this.ctComparisonState(field, 'source'), old = previous.snapshot.unit.fields.find(value => value.id === field.id);
                    if (!state.manual && old && this.ctFieldStatus(field).outdated && this.ctReviewed[field.id] !== this.ctReviewHash(field)
                        && root.ClientTextState.canonicalSource(old.source) !== root.ClientTextState.canonicalSource(field.source))
                        this.ctSetComparisonState(field, 'source', { open: true, reference: previous.key });
                }
            },
            async ctPrepareComparisons(ctx = this.ctContext(), unitId = this.ctSelection, force = false) {
                if (!this.ctCurrent(ctx) || this.ctSelection !== unitId) return false;
                if (this.ctComparisonVersions.length) { this.ctAutoOpenComparisons(); return true; }
                const provenance = this.ctSaved[unitId]?.provenance || this.ctHistory.find(entry => entry.provenance?.groupId)?.provenance;
                if (!force && !provenance && !this.ctCurrentUnit?.fields.some(field => this.ctFieldStatus(field).outdated)) return false;
                return this.ctLoadOlderComparisonVersion();
            },
            async ctLoadOlderComparisonVersion() {
                if (this._ctComparisonPending) return this._ctComparisonPending;
                if (!this.ctCurrentUnit || !this.ctComparisonMore) return false;
                const ctx = this.ctContext(), unit = this.ctCurrentUnit, client = this._cloud, store = this.ctStorage(ctx.scope),
                    run = this._ctComparisonRun ||= {}, abort = this._ctComparisonAbort ||= new AbortController(), signal = abort.signal,workKey=JSON.stringify([ctx.scope.groupId,ctx.epoch,unit.id]),
                    current = () => this._ctComparisonRun === run && this.ctCurrent(ctx) && this.ctCurrentUnit === unit && this._cloud === client && !signal.aborted,
                    check = () => { if (!current()) throw stale(); };
                const work = (async () => {
                    this.ctComparisonBusy = true;
                    try {
                        const rows = await store.listWorkspaces({ accountId: ctx.scope.accountId, game: ctx.scope.game }); check();
                        let candidate=this._ctComparisonCandidate;
                        if (this._ctComparisonCursor === undefined) {
                            const metadata = await store.getMetadata(ctx.scope); check();
                            const provenance = this.ctSaved[unit.id]?.provenance || this.ctHistory.find(entry => entry.provenance?.groupId)?.provenance;
                            const version = this.ctWorkspace?.metadata?.version || metadata?.version,
                                ancestryKnown = !this.ctOfflineTest && version && Object.prototype.hasOwnProperty.call(version, 'parentVersionId'),
                                previousGroupId = this.ctOfflineTest ? metadata?.previousScope?.groupId : ancestryKnown ? null : provenance?.groupId;
                            const cached = previousGroupId && rows.find(row => row.groupId === previousGroupId
                                && row.language === ctx.scope.language && row.branchId === ctx.scope.branchId && row.state === 'ready');
                            if (cached) candidate = { version: cached.version || { id: cached.versionId, game: ctx.scope.game, branchId: ctx.scope.branchId, name: cached.name },
                                group: cached.group || { id: cached.groupId, versionId: cached.versionId, language: cached.language, contentMode: 'clienttext' }, scope: { ...ctx.scope, versionId: cached.versionId, groupId: cached.groupId } };
                            else if (previousGroupId && !this.ctOfflineTest && this.managedOnlineAvailable && client?.request) {
                                const result = await client.request('/v1/content-groups/' + encodeURIComponent(previousGroupId), { signal }); check();
                                candidate = { group: result.group, version: result.version || result.group?.version };
                            }
                            this._ctComparisonCursor = ancestryKnown ? version.parentVersionId || null : candidate?.version.parentVersionId || null;
                        }
                        const seen = this._ctComparisonAncestors ||= new Set();
                        while (!candidate && this._ctComparisonCursor) {
                            const id = this._ctComparisonCursor;
                            if (seen.has(id)) throw new Error('Source-version ancestry repeated.');
                            const cached = rows.find(row => row.versionId === id && row.language === ctx.scope.language && row.branchId === ctx.scope.branchId
                                && row.state === 'ready' && (!this.ctWorkspace.metadata.group?.logicalKey || row.group?.logicalKey === this.ctWorkspace.metadata.group.logicalKey));
                            if(cached){candidate={version:cached.version || {id,game:ctx.scope.game,branchId:ctx.scope.branchId,name:cached.name},
                                group:cached.group || {id:cached.groupId,versionId:id,contentMode:'clienttext',language:cached.language}};seen.add(id);break;}
                            if (this.ctOfflineTest || !this.managedOnlineAvailable || !client?.request) throw new Error('Connect once to load the earlier original workbook.');
                            const result = await client.request('/v1/versions/' + encodeURIComponent(id) + '/content-groups', { signal }); check();
                            if (result.version?.id !== id || result.version.game !== ctx.scope.game || (result.version.branchId || 'default') !== ctx.scope.branchId)
                                throw new Error('The earlier version does not match this game and branch.');
                            seen.add(id); this._ctComparisonCursor = result.version.parentVersionId || null;
                            const group = (result.contentGroups || []).find(value => value.contentMode === 'clienttext' && value.language === ctx.scope.language
                                && (!this.ctWorkspace.metadata.group?.logicalKey || value.logicalKey === this.ctWorkspace.metadata.group.logicalKey));
                            if (group) candidate = { version: result.version, group };
                        }
                        if (!candidate) { this.ctComparisonMore = false; return false; }
                        const { version, group } = candidate;
                        if (!version || !group || group.versionId !== version.id || group.contentMode !== 'clienttext' || group.language !== ctx.scope.language
                            || version.game !== ctx.scope.game || (version.branchId || 'default') !== ctx.scope.branchId || group.id === ctx.scope.groupId)
                            throw new Error('The earlier workbook does not match this game, branch and language.');
                        const scope = candidate.scope || { ...ctx.scope, versionId: version.id, groupId: group.id };
                        this._ctComparisonCandidate=candidate;
                        let metadata = await store.getMetadata(scope); check();
                        if (metadata?.state !== 'ready') {
                            if (this.ctOfflineTest || !this.managedOnlineAvailable || !client?.request) throw new Error('The earlier original workbook is unavailable offline.');
                            await this.ctRequireTrustedProtocol(signal); check();
                            const result = await client.request('/v1/content-groups/' + encodeURIComponent(group.id), { signal }); check();
                            if (result.group?.id !== group.id || result.group.versionId !== version.id || result.group.language !== ctx.scope.language || result.group.contentMode !== 'clienttext')
                                throw new Error('The earlier content group changed scope.');
                            this.setBrowserWork?.('clienttext-compare',{key:workKey,label:'Preparing earlier workbook',active:true});
                            metadata = await this.ctCacheGroup(version, result.group, scope, { signal, current,comparison:true }); check();
                        }
                        const original = await store.getUnit(scope, unit.id); check();
                        const originalSnapshot = original ? snapshot(original) : { unit: { ...copy(unit), fields: [], developerNotes: [] }, values: {}, reviewed: {}, available: true, absent: true };
                        const item = { key: 'version:' + group.id, version: copy(version), group: copy(group), scope: copy(scope), snapshot: originalSnapshot, localTest: this.ctOfflineTest,
                            historyRemotePending:!!(!this.ctOfflineTest && this.managedOnlineAvailable && client?.request) };
                        this.ctComparisonVersions = raw([...this.ctComparisonVersions, item]);
                        this._ctComparisonCandidate=null;
                        this._ctComparisonCursor = version.parentVersionId || null; this.ctComparisonMore = !this.ctOfflineTest && !!this._ctComparisonCursor;
                        if (original) {
                            const originalReference={key:item.key,unitId:unit.id,origin:'reference',action:'Original workbook reference',createdAt:0,
                                actor:{name:this.ctComparisonVersionLabel(version)},before:originalSnapshot,after:originalSnapshot,context:copy(ctx),previousScope:copy(scope),provenance:{}};
                            this._ctHistoryReferences=[...this._ctHistoryReferences || [],originalReference];this.ctMergeHistory();
                            try{
                            const local = await store.listHistory(scope, unit.id, { limit: 101 }); check();item.localHistoryLimit=100;item.localHistoryMore=local.length>100;
                            const references = local.slice(0,100).map((entry, index) => this.ctComparisonHistoryEntry(entry, item, 'local', index));
                            if (!this.ctOfflineTest && this.managedOnlineAvailable && client?.request) {
                                const result = await client.request('/v1/content-groups/' + encodeURIComponent(group.id) + '/units/' + encodeURIComponent(unit.id)
                                    + '/history?language=' + encodeURIComponent(ctx.scope.language) + '&limit=100', { signal }); check();
                                references.push(...(result.history || []).map((entry, index) => this.ctComparisonHistoryEntry(entry, item, 'shared', index)));
                                item.historyCursor = result.nextCursor || null;item.historyRemotePending=false;
                            }
                            this._ctHistoryReferences = [...this._ctHistoryReferences || [], ...references]; this.ctMergeHistory();
                            }catch(error){check();item.historyError=error.message;}
                        }
                        this.ctComparisonError = item.historyError || ''; this.ctAutoOpenComparisons(); return true;
                    } catch (error) { if (current() && !error.stale) this.ctComparisonError = error.message; return false; }
                    finally { this.setBrowserWork?.('clienttext-compare',{key:workKey,active:false});if (current()) { this.ctComparisonBusy = false;this.ctAutoOpenComparisons(); } }
                })();
                this._ctComparisonPending = work;
                try { return await work; } finally { if (this._ctComparisonPending === work) this._ctComparisonPending = null; }
            },
            ctComparisonHistoryEntry(entry, version, origin, index) {
                const convert = record => ({ ...snapshot(version.snapshot.unit), values: record?.values ? copy(record.values) : record === null ? copy(version.snapshot.values) : {},
                    reviewed: copy(record?.reviewed || {}), available: record === null || !!record?.values, revision: record?.revision });
                return { key: 'version-history:' + version.scope.groupId + ':' + origin + ':' + (entry.id ?? index), unitId: this.ctSelection,
                    origin, action: entry.origin || 'save', createdAt: typeof entry.createdAt === 'number' ? entry.createdAt : Date.parse(entry.createdAt) || 0,
                    actor: copy(entry.actor || {}), before: convert(entry.before ?? null), after: convert(entry.after), context: copy(this.ctContext()), previousScope: copy(version.scope), provenance: {} };
            },
            async ctLoadComparisonHistory() {
                if(this.ctHistoryLoading)return false;
                const failed=this.ctComparisonVersions.find(value=>value.historyError);
                if(!failed && (this.ctHistoryCursor || this.ctHistoryLocalMore))return this.ctLoadOlderHistory();
                const version=failed || this.ctComparisonVersions.find(value=>value.historyCursor || value.localHistoryMore);
                if(!version || this.ctComparisonBusy)return false;
                const ctx=this.ctContext(),unit=this.ctCurrentUnit,client=this._cloud,run=this._ctComparisonRun,
                    current=()=>this.ctCurrent(ctx) && this.ctCurrentUnit===unit && this._cloud===client && this._ctComparisonRun===run;
                this.ctComparisonBusy=true;
                try{
                    const references=[];
                    if(version.localHistoryMore || version.historyError){const limit=(version.localHistoryLimit || 100)+100,
                        rows=await this.ctStorage(ctx.scope).listHistory(version.scope,unit.id,{limit:limit+1});if(!current())return false;
                        references.push(...rows.slice(0,limit).map((entry,index)=>this.ctComparisonHistoryEntry(entry,version,'local',index)));
                        version.localHistoryLimit=limit;version.localHistoryMore=rows.length>limit;
                    }
                    if(version.historyCursor || version.historyRemotePending){
                        if(!this.managedOnlineAvailable || !client?.request)throw new Error('Connect once to load earlier shared history.');
                        const cursor=version.historyCursor,result=await client.request('/v1/content-groups/'+encodeURIComponent(version.scope.groupId)+'/units/'+encodeURIComponent(unit.id)
                            +'/history?language='+encodeURIComponent(ctx.scope.language)+'&limit=100'+(cursor?'&cursor='+encodeURIComponent(cursor):''));if(!current())return false;
                        if(result.nextCursor && result.nextCursor===cursor)throw new Error('Earlier history cursor repeated.');
                        references.push(...(result.history || []).map((entry,index)=>this.ctComparisonHistoryEntry(entry,version,'shared',index)));
                        version.historyCursor=result.nextCursor || null;version.historyRemotePending=false;
                    }
                    this._ctHistoryReferences=[...this._ctHistoryReferences || [],...references];version.historyError='';this.ctMergeHistory();this.ctComparisonError='';return true;
                }catch(error){if(current())this.ctComparisonError=error.message;return false;}finally{if(current())this.ctComparisonBusy=false;}
            },
            async ctToggleFieldComparison(field, side, ids = [field.id]) {
                const fields = ids.map(id => this.ctCurrentUnit?.fields.find(value => value.id === id)).filter(Boolean), ctx = this.ctContext(), unit = this.ctCurrentUnit;
                if (!fields.length) return;
                const open = !fields.some(value => this.ctComparisonState(value, side).open);
                fields.forEach(value => this.ctSetComparisonState(value, side, { open, manual: true }));
                if (open && side === 'source' && !this.ctComparisonVersions.length) await this.ctPrepareComparisons(ctx, unit.id, true);
            },
            ctSourceGroups(group) {
                const result = new Map();
                for (const field of group.fields) {
                    const reference = this.ctComparisonReference(field, 'source'), previous = this.ctComparisonSnapshot(reference)?.unit.fields.find(value => value.id === field.id),
                        id = JSON.stringify([field.source, previous?.source, reference]), label = field.form ? this.ctClassVariantLabel(field) : field.name;
                    if (!result.has(id)) result.set(id, { key: field.id, text: String(field.source ?? ''), names: [], fieldIds: [] });
                    const source = result.get(id); source.names.push(label); source.fieldIds.push(field.id);
                }
                return [...result.values()].map(value => ({ ...value, label: result.size > 1 ? value.names.join(' / ') : group.name }));
            },
            ctSourceComparisonField(source) {
                const fields = source.fieldIds.map(id => this.ctCurrentUnit.fields.find(field => field.id === id));
                return fields.find(field => this.ctComparisonState(field, 'source').open) || fields[0];
            },
            ctClearFormattingSelection() { this.ctStyleSelection = null; this._ctStyleSelectionContext = null; this._ctToolbarSelection = null; },
            ctFormattingSelectionChanged(field, event) {
                const input = event?.target || this.ctDictionaryTarget(field.id), unit = this.ctCurrentUnit;
                if (!unit?.fields.includes(field) || field.kind === 'gender' || !input || input.isConnected === false || input.composing
                    || !Number.isInteger(input.selectionStart) || !Number.isInteger(input.selectionEnd)) return false;
                const text = String((this.ctInputValues || this.ctValues)[field.id] ?? ''), shown = text.replace(/\r\n?/g, '\n');
                if (input.dataset?.ctSource || input.dataset?.ctTarget && input.dataset.ctTarget !== field.id
                    || typeof input.value === 'string' && input.value !== shown
                    || input.selectionStart < 0 || input.selectionEnd < input.selectionStart || input.selectionEnd > shown.length) {
                    this.ctClearFormattingSelection(); return false;
                }
                const start = root.EditorSession.rawOffset(text, input.selectionStart), end = root.EditorSession.rawOffset(text, input.selectionEnd),
                    styles = root.ClientTextFormatting?.selection(text, start, end) || {};
                this._ctToolbarSelection = null;
                this._ctStyleSelectionContext = { ctx: this.ctContext(), unit };
                this.ctStyleSelection = { fieldId: field.id, text, start, end, active: Object.fromEntries(['b', 'i', 'u'].map(style => [style, !!styles[style]])) };
                return true;
            },
            ctStyleActive(field, style) {
                const selection = this.ctStyleSelection, context = this._ctStyleSelectionContext;
                return !!(selection && context && this.ctCurrent(context.ctx) && this.ctCurrentUnit === context.unit
                    && this.ctFocusedField === field.id && selection.fieldId === field.id && selection.text === (this.ctInputValues || this.ctValues)[field.id] && selection.active[style]);
            },
            ctCaptureToolbarSelection(field) {
                const input = this.ctDictionaryTarget(field.id);
                this._ctToolbarSelection = null;
                if (!input || input.composing || !Number.isInteger(input.selectionStart) || !Number.isInteger(input.selectionEnd)) return;
                this.ctFocusedField = field.id;
                if (!this.ctFormattingSelectionChanged(field, { target: input })) return;
                this._ctToolbarSelection = { ctx: this.ctContext(), unit: this.ctCurrentUnit, field, input, value: (this.ctInputValues || this.ctValues)[field.id],
                    start: input.selectionStart, end: input.selectionEnd };
            },
            ctFormatSelection(field, style) {
                if (!['b','i','u'].includes(style) || field.kind === 'gender' || this.ctBusy) return false;
                const selected = this._ctToolbarSelection;
                if (!selected || selected.field !== field) this.ctCaptureToolbarSelection(field);
                const selection = this._ctToolbarSelection;
                if (!selection || !this.ctCurrent(selection.ctx) || this.ctCurrentUnit !== selection.unit || selection.value !== (this.ctInputValues || this.ctValues)[field.id]
                    || !selection.unit.fields.includes(field) || selection.input.isConnected === false || selection.input.composing) return false;
                if (!root.ClientTextFormatting) return false;
                const previous = String(selection.value), start = root.EditorSession.rawOffset(previous, selection.start), end = root.EditorSession.rawOffset(previous, selection.end),
                    open = '<' + style + '>{', text = previous.slice(start, end), active = root.ClientTextFormatting.selection(previous, start, end)[style];
                const a = active ? active.start : start, b = active ? active.end : end,
                    replacement = active ? previous.slice(active.contentStart, active.contentEnd) : open + text + '}',
                    offset = active ? 0 : open.length, selectionEnd = active ? replacement.length : offset + text.length;
                this._ctToolbarSelection = null;
                return root.EditorSession.insert(this, field, replacement, { input: selection.input, raw: true, start: a, end: b, caretOffset: offset, selectionEndOffset: selectionEnd, historySelection: true });
            },
            ctFormattingKeydown(event) {
                const style = String(event.key || '').toLowerCase(), id = event.target?.dataset?.ctTarget;
                if (event.defaultPrevented || !event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || !['b','i','u'].includes(style)
                    || event.isComposing || event.keyCode === 229 || event.target.composing) return false;
                if(event.target?.dataset?.ctSource){event.preventDefault();event.stopPropagation?.();return true;}
                if(!id)return false;
                const field = this.ctCurrentUnit?.fields.find(value => value.id === id);
                if (!field || field.kind === 'gender' || this.ctBusy || this.ctKeyboardOverlayOpen()) return false;
                event.preventDefault(); event.stopPropagation?.(); this.ctCaptureToolbarSelection(field); this.ctFormatSelection(field, style); return true;
            },
            ctComparisonDetailRows(reference) {
                const before = this.ctComparisonSnapshot(reference); if (!before) return [];
                const fields = new Map([...before.unit.fields, ...this.ctCurrentUnit.fields].map(field => [field.id, field]));
                return [...fields.values()].map(field => ({ id: field.id, name: this.ctHistoryFieldLabel(field),
                    removed: !this.ctCurrentUnit.fields.some(value => value.id === field.id),
                    source: this.ctHistoryDiffParts(before.unit.fields.find(value => value.id === field.id)?.source || '', this.ctCurrentUnit.fields.find(value => value.id === field.id)?.source || ''),
                    target: this.ctHistoryDiffParts(before.values[field.id] || '', this.ctValues[field.id] || '') }));
            },
            ctFieldToolbar(field, side, ids = [field.id]) {
                const host = this, ctx = this.ctContext(), unit = this.ctCurrentUnit, identity = key(side, field), valid = () => host.ctCurrent(ctx) && host.ctCurrentUnit === unit && unit.fields.includes(field);
                return {
                    get open() { return host.ctComparisonState(field, side).open; }, get side() { return side; },
                    get disabled() { return host.ctBusy || !valid(); }, get formatting() { return field.kind !== 'gender'; },
                    get restoreDisabled() { return this.disabled || !!host.ctHistoryRestoreBlocked?.(unit); },
                    get mtl() { return !!host.ctMtlVisible && side==='translation' && !!root.ClientTextMtlState?.eligible(field); },
                    get mtlBusy() { return !!host.ctMtlBusy?.(field); },
                    get mtlDisabled() { return this.disabled || !host.ctMtlCanGenerate?.(field); },
                    get mtlHint() { return host.ctMtlHint?.(field) || 'MTL'; },
                    get mtlProgress() { return valid() ? host.ctMtlProgressFor?.(field) || null : null; },
                    cancelMtl: () => valid() && host.ctMtlCancel?.(field),
                    get mtlSettings() { return side==='translation' && !!host.ctMtlSettingsAllowed; },
                    get mtlSettingsState() { return valid() ? host.ctMtlSettingsFor?.(field) : null; },
                    toggleMtlSettings() { return valid() && host.ctMtlSettingsToggle?.(field); },
                    get mtlDebug() { return !!host.ctMtlDebugAllowed; },
                    debugMtl(event) { return host.ctMtlDebugOpen?.(field, event); },
                    get mtlShortcut() { return host.mtlShortcut==='f8'?'F8':host.mtlShortcut==='ctrl-alt-f8'?'Control+Alt+F8':undefined; },
                    generate: () => valid() && host.ctMtlGenerate?.(field),
                    get tone() { const status=host.ctFieldStatus(field);return side==='source' ? '' : status.outdated ? 'outdated' : status.missing ? 'missing' : ''; },
                    get formattingDisabled() { return side === 'source' || this.disabled || this.mtlBusy; },
                    get english() { return side==='translation' && typeof host.ctChooseEnglish==='function'; },
                    get englishActive() { return valid() && !!host.ctUsesEnglish?.(field); },
                    get englishHint() { return valid() ? host.ctEnglishHint?.(field) || 'Use English' : 'This field is no longer active. Return to the current record before changing Use English.'; },
                    get englishDisabled() { return this.disabled || !!host.ctEnglishActionReason(field); },
                    englishToggle() { return !this.englishDisabled && valid() && host.ctChooseEnglish(field,host.ctEnglishRemovesDecision(field)); },
                    styleActive: style => side === 'translation' && valid() && host.ctStyleActive(field, style),
                    get reference() { return host.ctComparisonReference(field, side); }, get choices() { return host.ctComparisonChoices(field, side); },
                    get groups() { return [...new Set(this.choices.map(value => value.group))]; },
                    get parts() { return host.ctComparisonParts(field, side); }, get display() { return value => host.ctHistoryDisplay(value); },
                    get busy() { return host.ctComparisonBusy; }, get error() { return host.ctComparisonError || host.ctHistoryError; },
                    get moreVersions() { return host.ctComparisonMore; }, get moreHistory() { return host.ctHistoryCursor || host.ctHistoryLocalMore || host.ctComparisonVersions.some(version=>version.historyError || version.historyCursor || version.localHistoryMore); },
                    get menuOpen() { return host.ctComparisonMenuKey === identity; }, get entries() { return host.ctHistory; },
                    get whitespace() { return host.ctHistoryWhitespace; }, get characters() { return host.ctHistoryCharacters; },
                    get detailRows() { return host.ctComparisonDetailRows(host.ctComparisonDetailsKey); },
                    get detailNotes() { const before = host.ctComparisonSnapshot(host.ctComparisonDetailsKey); return before && host.ctHistoryDiffParts(host.ctNotes(before.unit).join('\n\n'), host.ctNotes().join('\n\n')); },
                    label: entry => host.ctHistoryLabel(entry),
                    toggle: () => valid() && host.ctToggleFieldComparison(field, side, ids),
                    select: value => { if (valid()) ids.forEach(id => host.ctSetComparisonState(unit.fields.find(value => value.id === id), side, { reference: value, manual: true })); },
                    capture: () => side==='translation' && valid() && host.ctCaptureToolbarSelection(field), format: style => side==='translation' && valid() && host.ctFormatSelection(field, style),
                    menu: () => { if (valid()) { host.ctComparisonMenuKey = host.ctComparisonMenuKey === identity ? '' : identity; host.ctComparisonDetailsKey = ''; } },
                    closeMenu: () => { if (valid()) host.ctComparisonMenuKey = ''; },
                    options: (name, value) => { if (valid()) host[name === 'characters' ? 'ctHistoryCharacters' : 'ctHistoryWhitespace'] = value; },
                    olderVersions: () => valid() && host.ctLoadOlderComparisonVersion(), olderHistory: () => valid() && host.ctLoadComparisonHistory(),
                    details: (entry, part) => { if (valid()) host.ctComparisonDetailsKey = entry.key + ':' + part; },
                    restore: (entry, part) => valid() && !host.ctHistoryRestoreBlocked?.(unit) && host.ctRestoreHistory(entry, part)
                };
            }
        }
    };
    return { mixin };
});
