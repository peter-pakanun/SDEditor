/* TM assistance changes drafts; confirmed translation writes own automatic learning. */
(() => {
  'use strict';
  const TM = () => window.TranslationMemory;
  const clone = value => JSON.parse(JSON.stringify(value));
  const mark = value => typeof Vue !== 'undefined' && Vue.markRaw ? Vue.markRaw(value) : value;
  const readable = value => String(value ?? '').replace(/\\n/g, '\n');
  const uuid = () => 'tm_' + crypto.randomUUID();
  const mixin = {
    data() { return {
      tmUnits: [], tmTombstones: [], tmConflicts: [], tmMatches: [], tmSelectedIndex: 0, tmThreshold: 60,
      tmIssue: '', tmLocalIssue: '', tmGeneration: 0, tmLastMatchKey: '', tmManagerVisible: false,
      tmManageQuery: '', tmManageAppliedQuery: '', tmManageGame: 'current', tmManagePage: 1,
      tmDeletedPage: 1,
      tmEditing: null, tmEditingBase: null, tmBusy: false, tmSeedVisible: false, tmSeedIncludeZip: false,
      tmSeedRows: [], tmSeedPage: 1, tmSeedSkipped: 0, tmSeedKey: '', tmHistoryVisible: false,
      tmHistoryEvents: [], tmHistoryUnit: null, tmHistoryRemote: false, tmHistoryCursor: null, tmHistoryLoading: false,
      tmPrefillRows: [], tmPrefillVisible: false, tmPrefillKey: '',
    }; },
    computed: {
      tmScopeKey() { return JSON.stringify([this.cloudProfileId || 'guest', this.lang || '', this.gameVersion,
        this.cloudSignedIn, this.cloudUser?.role, this.cloudUser?.assignmentVersion, this.cloudUser?.language]); },
      tmEditorKey() {
        const desc = this.editorCurrentEditingDesc;
        if (!this.editorSessionActive || !desc || !this.editorReady) return '';
        const index = this.editorFocusedIndex || 0;
        return JSON.stringify([this.tmScopeKey, this.sourceIdentity, this.branchId, desc.filepath, index,
          desc.translations?.English?.[index], desc.stats, desc.variables?.[index], desc.remarks?.[index]]);
      },
      tmSelectedMatch() { return this.tmMatches[this.tmSelectedIndex] || null; },
      tmManagerRows() {
        return this.tmUnits.filter(unit => this.tmManagerIncludes(unit));
      },
      tmManagerPageCount() { return Math.max(1, Math.ceil(this.tmManagerRows.length / 40)); },
      tmVisibleManagerRows() { const page = Math.min(this.tmManagePage, this.tmManagerPageCount); return this.tmManagerRows.slice((page - 1) * 40, page * 40); },
      tmDeletedRows() { return this.tmTombstones.filter(unit => this.tmManagerIncludes(unit)); },
      tmDeletedPageCount() { return Math.max(1, Math.ceil(this.tmDeletedRows.length / 40)); },
      tmVisibleDeletedRows() { const page = Math.min(this.tmDeletedPage, this.tmDeletedPageCount); return this.tmDeletedRows.slice((page - 1) * 40, page * 40); },
      tmVisibleSeedRows() { return this.tmSeedRows.slice((this.tmSeedPage - 1) * 40, this.tmSeedPage * 40); },
      tmSeedSelectedCount() { return this.tmSeedRows.reduce((count, row) => count + Number(row.selected), 0); },
      tmCloudAvailable() { return this.cloudSignedIn && (this.cloudCanAccessAllLanguages || this.cloudUser?.language === this.lang); },
    },
    watch: {
      tmScopeKey() {
        ++this._tmLoadEpoch; ++this._tmQueryEpoch;
        this.tmUnits = []; this.tmTombstones = []; this.tmMatches = []; this.tmConflicts = [];
        this.tmLastMatchKey = ''; this.tmIssue = ''; this.tmLocalIssue = '';
        this._tmLocalIssues = {}; this._tmActiveQuery?.cancel(); this._tmReloadNeeded = false;
        this.tmManagerVisible = false; this.tmSeedVisible = false; this.tmPrefillVisible = false; this.tmHistoryVisible = false;
        this.tmBusy = false; this.tmHistoryLoading = false;
        this.tmEditing = null; this._tmWorker?.setScope(this.tmScopeKey);
        this.loadTranslationMemory();
      },
      tmEditorKey() { this.queryTranslationMemory(); },
      tmThreshold() { this.queryTranslationMemory(); },
      sideTab(tab) { if (tab === 'tm') this.queryTranslationMemory(); },
      tmManageQuery(value) {
        clearTimeout(this._tmFilterTimer);
        if (!value.trim()) { this.tmManageAppliedQuery = ''; this.tmManagePage = 1; this.tmDeletedPage = 1; return; }
        this._tmFilterTimer = setTimeout(() => { this.tmManageAppliedQuery = value; this.tmManagePage = 1; this.tmDeletedPage = 1; }, 250);
      },
      tmManageGame() { this.tmManagePage = 1; this.tmDeletedPage = 1; },
    },
    mounted() {
      this._tmLoadEpoch = 0; this._tmQueryEpoch = 0;
      this._tmUnsubscribe = window.OfflineStore?.onTranslationMemoryChange?.(scope => {
        if (scope && (scope.profile || scope.accountId) !== (this.cloudProfileId || 'guest')) return;
        if (scope?.language && scope.language !== this.lang) return;
        if (this.tmBusy || this._tmSync?.running) { this._tmReloadNeeded = true; return; }
        clearTimeout(this._tmReloadTimer);
        this._tmReloadTimer = setTimeout(() => { this.loadTranslationMemory(); this._cloud?.schedule(0); }, 40);
      });
      this.loadTranslationMemory();
    },
    beforeUnmount() {
      ++this._tmLoadEpoch; ++this._tmQueryEpoch;
      this._tmUnsubscribe?.(); this._tmActiveQuery?.cancel(); this._tmWorker?.dispose(); this._tmSync?.destroy();
      clearTimeout(this._tmFilterTimer); clearTimeout(this._tmReloadTimer);
    },
    methods: {
      tmScope() { return { profile: this.cloudProfileId || 'guest', language: this.lang }; },
      tmCurrent(key) { return key === this.tmScopeKey; },
      tmImportId(unit, previous, deleted, usedIds) {
        const id = previous?.id || deleted?.id || unit.id || uuid(), owner = usedIds.get(id);
        const chosen = owner && TM().identityFor(owner) !== TM().identityFor(unit) ? uuid() : id;
        usedIds.set(chosen, unit); return chosen;
      },
      tmManagerIncludes(unit) {
        const needle = this.tmManageAppliedQuery.trim().normalize('NFC').toLowerCase(), game = this.tmManageGame;
        return (game === 'any' || (game === 'current' ? unit.gameScope === this.gameVersion || unit.gameScope === 'all' : unit.gameScope === game))
          && (!needle || this.tmSearchText(unit).includes(needle));
      },
      tmSetIssue(operation, message = '') {
        this._tmLocalIssues ||= {};
        if (message) this._tmLocalIssues[operation] = message; else delete this._tmLocalIssues[operation];
        this.tmLocalIssue = Object.values(this._tmLocalIssues).join(' ');
      },
      tmFileKey() { return JSON.stringify([this.tmScopeKey, this.sourceIdentity, this.branchId, this.editorCurrentEditingDesc?.filepath]); },
      tmCaptureEditor() { return { key: this.tmFileKey(), desc: this.editorCurrentEditingDesc, blocks: this.editorBlocks,
        run: this._editorOpenRun, session: this._draftSession }; },
      tmEditorCurrent(capture) {
        return capture.key === this.tmFileKey() && capture.desc === this.editorCurrentEditingDesc && capture.blocks === this.editorBlocks
          && capture.run === this._editorOpenRun && capture.session === this._draftSession && this.editorSessionActive && this.editorReady;
      },
      tmMatchCurrent(match) {
        const unit = this.tmUnits.find(row => row.id === match.id);
        return !!unit && unit.localRevision === match.unit?.localRevision && unit.revision === match.unit?.revision
          && unit.target === match.unit?.target && TM().identityFor(unit) === TM().identityFor(match.unit);
      },
      async tmFinishWork(key) {
        if (!this.tmCurrent(key)) return;
        this.tmBusy = false;
        if (this._tmReloadNeeded) { this._tmReloadNeeded = false; await this.loadTranslationMemory(); this._cloud?.schedule(0); }
      },
      tmSearchText(unit) {
        this._tmSearchCache ||= new WeakMap();
        if (!this._tmSearchCache.has(unit)) this._tmSearchCache.set(unit, [unit.source, unit.target, unit.note, unit.context?.filepath].join('\n').normalize('NFC').toLowerCase());
        return this._tmSearchCache.get(unit);
      },
      tmText: readable,
      tmMatchLabel(match) { return ({ context: 'Context match', exact: 'Exact match', adapted: 'Variables adapted', fuzzy: 'Fuzzy match' })[match?.kind] || 'Match'; },
      tmGameLabel(game) { return ({ poe1: 'PoE1', poe2: 'PoE2', all: 'All' })[game] || game; },
      tmMatchContext(unit) {
        const context = unit?.context;
        return context?.filepath ? `${context.filepath} · Entry ${context.entryIndex + 1}${context.condition ? ' · ' + context.condition : ''}` : 'No file context';
      },
      async loadTranslationMemory() {
        if (!this.lang || !TM()) return;
        const key = this.tmScopeKey, epoch = ++this._tmLoadEpoch;
        try {
          const state = this.testMode ? { units: this.tmUnits, tombstones: this.tmTombstones, conflicts: this.tmConflicts }
            : await window.OfflineStore.getTranslationMemory(this.tmScope());
          if (!this.tmCurrent(key) || epoch !== this._tmLoadEpoch) return;
          this.acceptTranslationMemory(state); this.tmSetIssue('load');
        } catch (error) { if (this.tmCurrent(key)) this.tmSetIssue('load', 'Could not load local TM: ' + error.message); }
      },
      acceptTranslationMemory(state) {
        this._tmSnapshotVersion = state.localVersion;
        const sameRows = (left, right) => left.length === right.length && left.every((unit, index) => unit.id === right[index]?.id
          && unit.revision === right[index]?.revision && unit.localRevision === right[index]?.localRevision);
        if (this._tmAcceptedScope === this.tmScopeKey && sameRows(this.tmUnits, state.units || [])
          && sameRows(this.tmTombstones, state.tombstones || []) && JSON.stringify(this.tmConflicts) === JSON.stringify(state.conflicts || [])) return;
        this._tmAcceptedScope = this.tmScopeKey;
        this.tmUnits = mark(state.units || []); this.tmTombstones = mark(state.tombstones || []); this.tmConflicts = mark(state.conflicts || []);
        this.tmGeneration++;
        const worker = this.ensureTMWorker();
        worker.submitSnapshot({ generation: this.tmGeneration, game: this.gameVersion, units: this.tmUnits });
        this.queryTranslationMemory();
      },
      ensureTMWorker() {
        if (!this._tmWorker) this._tmWorker = window.TranslationMemoryWorkerClient.create();
        this._tmWorker.setScope(this.tmScopeKey); return this._tmWorker;
      },
      async syncTranslationMemory(ctx, hints) {
        if (!this._cloud || this.testMode) return;
        if (!this._tmSync || this._tmSync.cloud !== this._cloud) {
          this._tmSync?.destroy();
          this._tmSync = new window.TMCloudSync.Client({ cloud: this._cloud, store: window.OfflineStore,
            onChange: (scope, state) => {
              if (scope.profile !== (this.cloudProfileId || 'guest') || scope.language !== this.lang) return;
              if (this.tmBusy) { this._tmReloadNeeded = true; return; }
              this.acceptTranslationMemory(state);
            },
            onIssue: message => { this.tmIssue = message; }, onWork: work => this.setBrowserWork?.('tm', work) });
        }
        try { return await this._tmSync.sync(ctx, hints); }
        finally {
          if (this._tmReloadNeeded && !this.tmBusy && !this._tmSync.running) {
            this._tmReloadNeeded = false;
            const key = this.tmScopeKey;
            try {
              const state = await window.OfflineStore.getTranslationMemoryState(this.tmScope());
              if (this.tmCurrent(key) && state.localVersion !== this._tmSnapshotVersion) await this.loadTranslationMemory();
            } catch (error) { if (this.tmCurrent(key)) this.tmSetIssue('load', 'Could not load local TM: ' + error.message); }
          }
        }
      },
      tmQuery(index = this.editorFocusedIndex || 0) {
        const desc = this.editorCurrentEditingDesc;
        return { source: String(desc?.translations?.English?.[index] ?? ''), context: TM().contextFor(desc || {}, index, desc?.filepath), game: this.gameVersion };
      },
      async queryTranslationMemory() {
        const key = this.tmEditorKey, epoch = ++this._tmQueryEpoch;
        this._tmActiveQuery?.cancel();
        if (!key) { this.tmMatches = []; this.tmLastMatchKey = ''; return; }
        try {
          const worker = this.ensureTMWorker();
          await worker.waitReady({ generation: this.tmGeneration });
          if (epoch !== this._tmQueryEpoch || key !== this.tmEditorKey) return;
          const query = worker.query(this.tmQuery(), { threshold: Math.max(1, Math.min(99, Number(this.tmThreshold) || 60)), limit: 5 });
          this._tmActiveQuery = query;
          const result = await query;
          if (epoch !== this._tmQueryEpoch || key !== this.tmEditorKey) return;
          const selected = this.tmSelectedMatch?.id;
          this.tmMatches = mark(result.matches || result || []);
          this.tmSelectedIndex = Math.max(0, this.tmMatches.findIndex(match => match.id === selected));
          this.tmLastMatchKey = key;
          this.tmSetIssue('query');
        } catch (error) { if (!error.stale && error.name !== 'AbortError' && epoch === this._tmQueryEpoch && key === this.tmEditorKey) this.tmSetIssue('query', 'Could not prepare TM matches: ' + error.message); }
      },
      openEditorTM(index = this.editorFocusedIndex || 0) { this.setEditorFocus(index); this.sideTab = 'tm'; this.queryTranslationMemory(); },
      tmPanelKeydown(event) {
        if (this.isFilterFocusShortcut?.(event)) { event.preventDefault(); this.openTMManager(); return; }
        if (this.isImeComposingEvent?.(event) || event.target?.matches?.('input,textarea,select')) return;
        if (event.target?.matches?.('button') && event.target.getAttribute?.('role') !== 'option') return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); this.tmSelectedIndex = Math.max(0, Math.min(this.tmMatches.length - 1, this.tmSelectedIndex + (event.key === 'ArrowDown' ? 1 : -1)));
        } else if (event.key === 'Enter') { event.preventDefault(); this.useTMMatch(); }
      },
      async tmApplyTarget(index, target, { refocus = true } = {}) {
        const capture = this.tmCaptureEditor();
        const block = this.editorBlocks?.[index];
        if (!block || this.editorTranslationReadOnly || this.editorCompareActive) return false;
        const prepared = this.makeEditorBlock(this.tmQuery(index).source, target, true);
        Object.assign(block, prepared);
        this.refreshEditorBlockMeta(block, index); this.refreshGamePreview();
        this.queueEditorDraft?.(); this.scheduleEditorDraft?.();
        if (refocus) {
          await this.$nextTick();
          if (!this.tmEditorCurrent(capture)) return true;
          this.getEditorRef('translation', index, block.isTable ? Math.min(this.editorFocusedColumnIndex || 0, block.tableColumns.length - 1) : null)?.focus?.({ preventScroll: true });
        }
        return true;
      },
      async useTMMatch(match = this.tmSelectedMatch) {
        if (!match || this.tmLastMatchKey !== this.tmEditorKey || this.editorTranslationReadOnly) return;
        const key = this.tmEditorKey, index = this.editorFocusedIndex || 0, capture = this.tmCaptureEditor();
        if (!this.tmMatchCurrent(match)) {
          await this.queryTranslationMemory(); return;
        }
        const current = this.serializeEditorTranslations?.()[index] ?? this.editorBlocks[index]?.translation;
        if (String(current || '').trim() && current !== match.target && !await this.appConfirm('Replace this entry’s draft with the selected TM translation?', { title: 'Use TM translation?', confirmLabel: 'Replace draft', danger: false })) return;
        if (key !== this.tmEditorKey || !this.tmEditorCurrent(capture) || !this.tmMatchCurrent(match)
          || current !== (this.serializeEditorTranslations?.()[index] ?? this.editorBlocks[index]?.translation)) return;
        await this.tmApplyTarget(index, match.target);
      },
      async previewTMPrefill() {
        if (this.tmBusy || this.editorTranslationReadOnly || !this.editorCurrentEditingDesc) return;
        this.tmBusy = true;
        const scopeKey = this.tmScopeKey, capture = this.tmCaptureEditor(), key = capture.key, language = this.lang;
        const before = this.serializeEditorTranslations();
        try {
          await this.ensureTMWorker().waitReady({ generation: this.tmGeneration });
          if (!this.tmEditorCurrent(capture)) return;
          const rows = [];
          for (let index = 0; index < before.length; index++) {
            if (!this.tmEditorCurrent(capture)) return;
            if (before[index].trim()) continue;
            const query = this.tmQuery(index), result = await this._tmWorker.query(query, { threshold: 100, limit: 100 });
            if (!this.tmEditorCurrent(capture)) return;
            const exact = (result.matches || result).filter(match => match.score >= 100 && TM().validatePair(query.source, match.target, language).valid);
            if (!exact.length) continue;
            const topScore = Math.max(...exact.map(match => match.score));
            const best = exact.filter(match => match.score === topScore), targets = new Set(best.map(match => match.target));
            if (targets.size !== 1 || best.some(match => match.ambiguous)) continue;
            rows.push({ index, selected: true, before: before[index], match: best[0] });
          }
          if (!this.tmEditorCurrent(capture)) return;
          this.tmPrefillRows = rows; this.tmPrefillKey = key; this._tmPrefillCapture = capture; this.tmPrefillVisible = true; this.tmSetIssue('prefill');
        } catch (error) { if (!error.stale && error.name !== 'AbortError' && this.tmEditorCurrent(capture)) this.tmSetIssue('prefill', 'Could not prepare blank entries: ' + error.message); }
        finally { await this.tmFinishWork(scopeKey); this.queryTranslationMemory(); }
      },
      async applyTMPrefill() {
        const capture = this._tmPrefillCapture;
        if (!capture || !this.tmEditorCurrent(capture) || capture.key !== this.tmPrefillKey || this.editorTranslationReadOnly) return;
        for (const row of this.tmPrefillRows.filter(row => row.selected)) {
          if (!this.tmEditorCurrent(capture) || this.editorTranslationReadOnly || this.editorCompareActive) return;
          if (this.serializeEditorTranslations()[row.index] === row.before && this.tmMatchCurrent(row.match)) await this.tmApplyTarget(row.index, row.match.target, { refocus: false });
        }
        if (this.tmEditorCurrent(capture)) this.tmPrefillVisible = false;
      },
      async openTMManager() {
        const key = this.tmScopeKey;
        this.tmManagerVisible = true; this.tmEditing = null;
        await this.$nextTick();
        if (this.tmCurrent(key) && this.tmManagerVisible) this.$refs?.tmManagerSearch?.focus?.();
        await this.loadTranslationMemory();
      },
      tmEditUnit(unit = null) {
        this.tmEditingBase = unit ? clone(unit) : null;
        this.tmEditing = unit ? clone(unit) : { id: uuid(), source: '', target: '', gameScope: this.gameVersion, context: null, note: '', provenance: { origin: 'manual' } };
      },
      async tmPut(units, options = {}) {
        const key = this.tmScopeKey, scope = this.tmScope();
        if (this.testMode) {
          const map = new Map([...this.tmUnits, ...this.tmTombstones].map(unit => [unit.id, unit]));
          for (const input of units) {
            const unit = TM().normalizeUnit(input), identity = TM().identityFor(unit), previous = map.get(unit.id);
            if (options.expectedUnits && Object.hasOwn(options.expectedUnits, unit.id)) {
              const expected = options.expectedUnits[unit.id];
              if (!!previous !== !!expected || (previous && (previous.revision !== expected.revision || previous.localRevision !== expected.localRevision))) throw new Error('TM entry changed. Review the current translation.');
            }
            if ([...map.values()].some(row => row.id !== unit.id && TM().identityFor(row) === identity)) throw new Error('This source and context already have a TM entry.');
            if (previous?.deleted && !input.deleted && !options.restore && !input.restore) continue;
            map.set(unit.id, { ...unit, id: unit.id || uuid(), deleted: !!input.deleted, revision: previous?.revision || 0, localRevision: (previous?.localRevision || 0) + 1 });
          }
          this.acceptTranslationMemory({ units: [...map.values()].filter(unit => !unit.deleted), tombstones: [...map.values()].filter(unit => unit.deleted), conflicts: [] });
          return;
        }
        await window.OfflineStore.putTranslationMemoryUnits(scope, clone(units), { ...options, guard: () => this.tmCurrent(key) });
        if (this.tmCurrent(key)) { if (options.refresh !== false) await this.loadTranslationMemory(); this._cloud?.schedule(0); }
      },
      async saveTMUnit() {
        if (!this.tmEditing || this.tmBusy) return;
        const key = this.tmScopeKey, unit = clone(this.tmEditing), base = this.tmEditingBase;
        const validation = TM().validatePair(unit.source, unit.target, this.lang);
        if (!validation.valid) { this.tmSetIssue('save', validation.errors.map(error => error.message).join(' ')); return; }
        this.tmBusy = true;
        try {
          await this.tmPut([unit], { origin: 'edit', expectedUnits: { [unit.id]: base }, expectedRevision: base?.revision, expectedLocalRevision: base?.localRevision });
          if (key === this.tmScopeKey) { this.tmEditing = null; this.tmSetIssue('save'); }
        } catch (error) { if (!error.stale && this.tmCurrent(key)) this.tmSetIssue('save', 'Could not save TM entry: ' + error.message); }
        finally { await this.tmFinishWork(key); }
      },
      async removeTMUnit(unit) {
        const key = this.tmScopeKey;
        if (!await this.appConfirm('Delete this TM entry? Automatic learning will not recreate it. You can restore it from history.', { title: 'Delete TM entry?', confirmLabel: 'Delete entry' })) return;
        if (key !== this.tmScopeKey) return;
        try {
          if (this.testMode) {
            this.tmTombstones = [...this.tmTombstones, { ...unit, deleted: true }];
            this.acceptTranslationMemory({ units: this.tmUnits.filter(row => row.id !== unit.id), tombstones: this.tmTombstones });
          } else await window.OfflineStore.deleteTranslationMemoryUnit(this.tmScope(), unit.id, { expectedRevision: unit.revision, expectedLocalRevision: unit.localRevision, guard: () => this.tmCurrent(key) });
          if (this.tmCurrent(key)) { await this.loadTranslationMemory(); this._cloud?.schedule(0); this.tmSetIssue('delete'); }
        } catch (error) { if (!error.stale && this.tmCurrent(key)) this.tmSetIssue('delete', 'Could not delete TM entry: ' + error.message); }
      },
      async previewTMSeed() {
        if (this.tmBusy) return;
        this.tmBusy = true;
        const scopeKey = this.tmScopeKey, key = JSON.stringify([scopeKey, this.sourceIdentity, this.branchId]);
        const epoch = this._tmSeedPreviewEpoch = (this._tmSeedPreviewEpoch || 0) + 1;
        const current = () => epoch === this._tmSeedPreviewEpoch && key === JSON.stringify([this.tmScopeKey, this.sourceIdentity, this.branchId]);
        this.setBrowserWork?.('tm-prepare', { active: true, label: 'Preparing translation memory' });
        try {
          if (await this.waitForPendingSaves?.() === false) return;
          if (!current()) return;
          const rows = [], byIdentity = new Map(this.tmUnits.map(unit => [TM().identityFor(unit), unit]));
          const suppressed = new Map(this.tmTombstones.map(unit => [TM().identityFor(unit), unit]));
          const language = this.lang, game = this.gameVersion, sourceHash = this.sourceIdentity, branchId = this.branchId || 'default';
          const descriptions = this.descs, workspace = this.localDescs, includeZip = this.tmSeedIncludeZip;
          let skipped = 0, sliceStart = Date.now();
          for (const desc of descriptions || []) {
            if (!current()) return;
            const baseline = this.workspaceSourceFile?.(desc.filepath) || desc;
            const state = window.WorkspaceState.workspaceFile(workspace, baseline, language);
            const candidates = state.candidate || (!state.staged && !includeZip) ? [] : TM().unitsFromDescription(baseline, state.translations, language,
              { game, filepath: desc.filepath, sourceHash, branchId, origin: state.staged ? 'saved_seed' : 'zip_seed' });
            if (!state.candidate && (state.staged || includeZip)) skipped += Math.max(0, baseline.translations.English.length - candidates.length);
            for (const unit of candidates) {
              const identity = TM().identityFor(unit), existing = byIdentity.get(identity), deleted = suppressed.get(identity);
              if (existing?.target === unit.target && existing?.note === unit.note) continue;
              rows.push({ unit: { ...unit, id: existing?.id || deleted?.id || unit.id || uuid() }, existing: clone(existing || deleted || null),
              selected: !deleted && !existing, restore: !!deleted, action: deleted ? 'Restore deleted entry' : existing ? 'Replace remembered translation' : 'Add entry' });
            }
            if (Date.now() - sliceStart >= 4) { await new Promise(resolve => setTimeout(resolve, 0)); sliceStart = Date.now(); }
          }
          if (!current()) return;
          this.tmSeedRows = rows; this.tmSeedSkipped = skipped; this.tmSeedKey = key; this.tmSeedPage = 1; this.tmSeedVisible = true; this.tmSetIssue('seed');
        } catch (error) { if (!error.stale && current()) this.tmSetIssue('seed', 'Could not prepare TM import: ' + error.message); }
        finally { if (epoch === this._tmSeedPreviewEpoch) { this.setBrowserWork?.('tm-prepare', { active: false }); await this.tmFinishWork(scopeKey); } }
      },
      async applyTMSeed() {
        if (this.tmBusy || this.tmSeedKey !== JSON.stringify([this.tmScopeKey, this.sourceIdentity, this.branchId])) return;
        this.tmBusy = true;
        const selected = this.tmSeedRows.filter(row => row.selected && !row.imported), key = this.tmSeedKey, scopeKey = this.tmScopeKey;
        try {
          for (let offset = 0; offset < selected.length; offset += 100) {
            if (key !== JSON.stringify([this.tmScopeKey, this.sourceIdentity, this.branchId])) return;
            const rows = selected.slice(offset, offset + 100);
            await this.tmPut(rows.map(row => ({ ...row.unit, restore: !!row.restore, ...(row.deletion ? { deleted: true } : {}) })), { origin: 'seed', refresh: false,
              expectedUnits: Object.fromEntries(rows.map(row => [row.unit.id, row.existing])) });
            for (const row of rows) { row.selected = false; row.imported = true; row.action = 'Imported'; }
          }
          if (key === this.tmSeedKey && this.tmCurrent(scopeKey)) { this.tmSeedVisible = false; this.tmSetIssue('seed'); }
        } catch (error) { if (!error.stale && this.tmCurrent(scopeKey)) this.tmSetIssue('seed', 'TM import stopped; completed batches are retained. Review the remaining entries: ' + error.message); }
        finally { await this.tmFinishWork(scopeKey); if (this.tmCurrent(scopeKey)) await this.loadTranslationMemory(); }
      },
      exportTM() {
        const body = { format: 'sdeditor-tm', version: 1, language: this.lang, units: clone(this.tmUnits), tombstones: clone(this.tmTombstones) };
        saveAs(new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }), `sdeditor_tm_${this.lang}.json`);
      },
      exportLegacyRegex() { saveAs(new Blob([JSON.stringify({ format: 'sdeditor-legacy-regex', editorRegexes: clone(this.editorRegexes || []) }, null, 2)], { type: 'application/json' }), 'sdeditor_legacy_regex.json'); },
      async importTMFile(event) {
        const key = JSON.stringify([this.tmScopeKey, this.sourceIdentity, this.branchId]);
        const scopeKey = this.tmScopeKey;
        if (this.tmBusy || !event.target.files?.[0]) { event.target.value = ''; return; }
        this.tmBusy = true;
        const epoch = this._tmSeedPreviewEpoch = (this._tmSeedPreviewEpoch || 0) + 1;
        const current = () => epoch === this._tmSeedPreviewEpoch && key === JSON.stringify([this.tmScopeKey, this.sourceIdentity, this.branchId]);
        this.setBrowserWork?.('tm-prepare', { active: true, label: 'Preparing TM import' });
        try {
          const file = event.target.files?.[0]; if (!file) return;
          const data = JSON.parse(await file.text());
          if (!current()) return;
          if (data.format !== 'sdeditor-tm' || data.version !== 1 || data.language !== this.lang || !Array.isArray(data.units)) throw new Error('Choose a TM JSON backup for the selected language.');
          const existing = new Map(this.tmUnits.map(unit => [TM().identityFor(unit), unit]));
          const suppressed = new Map(this.tmTombstones.map(unit => [TM().identityFor(unit), unit]));
          const usedIds = new Map([...this.tmUnits, ...this.tmTombstones].map(unit => [unit.id, unit]));
          const identities = new Set(), rows = []; let skipped = 0;
          let sliceStart = Date.now();
          for (const raw of data.units) {
            if (Date.now() - sliceStart >= 4) { await new Promise(resolve => setTimeout(resolve, 0)); sliceStart = Date.now(); if (!current()) return; }
            const unit = TM().normalizeUnit(raw), identity = TM().identityFor(unit);
            if (!TM().validatePair(unit.source, unit.target, this.lang).valid) { skipped++; continue; }
            if (identities.has(identity)) throw new Error('The backup contains duplicate source/context identities.');
            identities.add(identity);
            const previous = existing.get(identity), deleted = suppressed.get(identity);
            if (previous?.target === unit.target && previous?.note === unit.note) continue;
            rows.push({ unit: { ...unit, id: this.tmImportId(unit, previous, deleted, usedIds) }, existing: clone(previous || deleted || null), selected: !previous && !deleted,
              restore: !!deleted, action: deleted ? 'Restore deleted entry' : previous ? 'Replace remembered translation' : 'Add entry' });
          }
          if (data.tombstones != null && !Array.isArray(data.tombstones)) throw new Error('Invalid TM deletion records.');
          for (const raw of data.tombstones || []) {
            if (Date.now() - sliceStart >= 4) { await new Promise(resolve => setTimeout(resolve, 0)); sliceStart = Date.now(); if (!current()) return; }
            const unit = TM().normalizeUnit({ ...raw, target: raw.target?.trim() ? raw.target : '_' }), identity = TM().identityFor(unit);
            if (identities.has(identity)) throw new Error('The backup contains an active and deleted copy of the same source/context.');
            identities.add(identity);
            const previous = existing.get(identity), deleted = suppressed.get(identity);
            if (deleted) continue;
            rows.push({ unit: { ...unit, id: this.tmImportId(unit, previous, deleted, usedIds), deleted: true }, existing: clone(previous || null), deletion: true,
              selected: !previous, restore: false, action: previous ? 'Delete remembered entry' : 'Preserve deleted entry' });
          }
          if (!current()) return;
          this.tmSeedRows = rows; this.tmSeedSkipped = skipped; this.tmSeedKey = key; this.tmSeedPage = 1; this.tmSeedVisible = true;
          this.tmSetIssue('seed');
        } catch (error) { if (current()) this.tmSetIssue('seed', 'Could not import TM: ' + error.message); }
        finally { event.target.value = ''; if (epoch === this._tmSeedPreviewEpoch) { this.setBrowserWork?.('tm-prepare', { active: false }); await this.tmFinishWork(scopeKey); } }
      },
      async resolveTMConflict(conflict, choice) {
        const key = this.tmScopeKey;
        try {
          await window.OfflineStore.resolveTranslationMemoryConflict(this.tmScope(), conflict.id, choice, { expectedRevision: conflict.revision ?? conflict.shared?.revision,
            expectedConflict: clone(conflict), guard: () => this.tmCurrent(key) });
          if (this.tmCurrent(key)) { await this.loadTranslationMemory(); this._cloud?.schedule(0); this.tmSetIssue('conflict'); }
        } catch (error) { if (!error.stale && this.tmCurrent(key)) this.tmSetIssue('conflict', 'Could not resolve TM correction: ' + error.message); }
      },
      async openTMHistory(unit) {
        const key = this.tmScopeKey; this.tmHistoryUnit = unit; this.tmHistoryVisible = true; this.tmHistoryEvents = [];
        this.tmHistoryCursor = null; this.tmHistoryLoading = false;
        const epoch = this._tmHistoryEpoch = (this._tmHistoryEpoch || 0) + 1;
        const current = () => this.tmCurrent(key) && epoch === this._tmHistoryEpoch && this.tmHistoryVisible;
        try {
          this.tmHistoryRemote = this.tmCloudAvailable;
          if (!this.testMode) {
            const local = await window.OfflineStore.listTranslationMemoryHistory(this.tmScope(), unit.id);
            if (!current()) return;
            this.tmHistoryEvents = (local.events || local).map(event => ({ ...event, remote: false }));
          }
          if (this.tmHistoryRemote) {
            const ctx = this._cloud.context(), page = await this._cloud.request('/v1/translation-memories/' + encodeURIComponent(this.lang) + '/history?' + new URLSearchParams({ unitId: unit.id, limit: '50' }), {}, ctx);
            if (!current()) return;
            this.tmHistoryCursor = page.nextCursor;
            this.tmHistoryEvents = [...(page.events || page.items || []).map(event => ({ ...event, remote: true })), ...this.tmHistoryEvents];
          }
          if (current()) this.tmSetIssue('history');
        } catch (error) { if (!error.stale && current()) this.tmSetIssue('history', 'Could not load TM history: ' + error.message); }
      },
      async loadOlderTMHistory() {
        if (!this.tmHistoryCursor || this.tmHistoryLoading) return;
        const key = this.tmScopeKey, epoch = this._tmHistoryEpoch, unitId = this.tmHistoryUnit?.id;
        this.tmHistoryLoading = true;
        try {
          const page = await this._cloud.request('/v1/translation-memories/' + encodeURIComponent(this.lang) + '/history?' + new URLSearchParams({ unitId, cursor: this.tmHistoryCursor, limit: '50' }), {}, this._cloud.context());
          if (!this.tmCurrent(key) || epoch !== this._tmHistoryEpoch || !this.tmHistoryVisible) return;
          this.tmHistoryCursor = page.nextCursor;
          this.tmHistoryEvents.push(...(page.events || page.items || []).map(event => ({ ...event, remote: true })));
          this.tmSetIssue('history');
        } catch (error) { if (!error.stale && this.tmCurrent(key) && epoch === this._tmHistoryEpoch) this.tmSetIssue('history', 'Could not load older TM history: ' + error.message); }
        finally { if (epoch === this._tmHistoryEpoch) this.tmHistoryLoading = false; }
      },
      async restoreTMHistory(event, version = 'before') {
        const key = this.tmScopeKey;
        const epoch = this._tmHistoryEpoch, historyId = this.tmHistoryUnit?.id;
        const currentHistory = () => this.tmCurrent(key) && epoch === this._tmHistoryEpoch && this.tmHistoryVisible && historyId === this.tmHistoryUnit?.id;
        try {
          let unit = event[version];
          if (event.remote && !unit) {
            const detail = await this._cloud.request('/v1/translation-memories/' + encodeURIComponent(this.lang) + '/history/' + encodeURIComponent(event.id), {}, this._cloud.context());
            unit = detail[version] || detail.event?.[version];
          }
          if (!currentHistory()) return;
          if (!unit || unit.deleted) throw new Error('This history version has no translation to restore.');
          const current = clone(this.tmUnits.find(row => row.id === unit.id) || this.tmTombstones.find(row => row.id === unit.id) || null);
          if (!await this.appConfirm(`Restore this remembered translation?\n\n${this.tmGameLabel(unit.gameScope)} · ${this.tmMatchContext(unit)}\n${readable(unit.source)}\n\n${readable(unit.target)}`, { title: 'Restore TM entry?', confirmLabel: 'Restore translation', danger: false })) return;
          if (!currentHistory()) return;
          await this.tmPut([unit], { origin: 'restore', restore: true, expectedUnits: { [unit.id]: current } });
          if (this.tmCurrent(key)) { this.tmHistoryVisible = false; this.tmSetIssue('restore'); }
        } catch (error) { if (!error.stale && currentHistory()) this.tmSetIssue('restore', 'Could not restore TM entry: ' + error.message); }
      },
    },
  };
  window.TranslationMemoryUI = { mixin };
})();
