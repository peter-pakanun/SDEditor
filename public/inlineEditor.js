/* A single scoped draft session backs both editor surfaces. Drafts never mutate desc.translations. */
(function (root) {
  'use strict';
  const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const uuid = () => root.crypto?.randomUUID?.() || 'draft-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  const mixin = {
    data() {
      return { inlineEditor: true, inlineActive: false, inlineSidebarVisible: true,
        inlineDraftRows: {}, inlineDraftFindings: {}, inlineDraftError: '', draftRecords: [],
        draftRecoveryVisible: false, draftRecoverySelected: null, draftRecoveryBusy: false, draftRecoveryCandidate: null,
        draftWritePending: 0, inlineTransitionBusy: false };
    },
    computed: {
      inlineDraftCount() { return Object.keys(this.inlineDraftRows).length; },
      deferredDraftSaveError() {
        return Object.values(this.inlineDraftFindings).flat().filter(finding => finding.deferredSave)
          .map(finding => finding.message).join('\n');
      },
      editorHasStagedTranslation() {
        const desc = this.editorCurrentEditingDesc;
        const source = desc && this.workspaceSourceFile?.(desc.filepath);
        return !!source && !!root.WorkspaceState?.workspaceFile(this.localDescs, source, this.lang)?.staged;
      },
      inlineCommittedTranslations() {
        const desc = this.editorCurrentEditingDesc;
        if (!desc?.filepath) return [];
        const source = this.workspaceSourceFile?.(desc.filepath) || desc;
        const committed = root.WorkspaceState?.workspaceFile(this.localDescs, source, this.lang)?.translations || desc.translations?.[this.lang] || [];
        return this.canonicalEditorTranslations(desc, committed);
      },
      inlineDraftHasChanges() {
        const desc = this.editorCurrentEditingDesc, workspace = this.localDescs;
        if (!this.inlineActive || !desc?.filepath || this.editorLoading || this.editorLoadError
          || (workspace?.sourceHash && workspace.sourceHash !== this.sourceIdentity)
          || (this._draftSession && !this.draftScopeCurrent(this._draftSession.scope))) return false;
        return !equal(this.serializeEditorTranslations(), this.inlineCommittedTranslations);
      },
      draftRecoveryItems() {
        return this.draftRecords.flatMap(record => [record, ...(record.conflicts || [])].filter(item => item.state === 'active')
          .map(item => ({ ...item, key: record.key, conflict: item !== record,
            english: item.source?.translations?.English || [], sourceIdentity: item.sourceHash,
            olderSource: item.sourceHash !== this.sourceIdentity })));
      },
    },
    watch: {
      inlineEditor() {
        this.saveSettings();
        if (!this.inlineEditor && this.inlineActive) this.finishInlineSession({ promote: false });
        this.$nextTick(() => this.observeInlineBlocks());
      },
      editorBlocks: { deep: true, handler() { this.scheduleEditorDraft(); } },
      sourceIdentity() { this.draftScopeChanged(); },
      lang() { this.draftScopeChanged(); },
      gameVersion() { this.draftScopeChanged(); },
      branchId() { this.draftScopeChanged(); },
      editorVisible() { this.$nextTick(() => this.observeInlineBlocks()); },
      descsDisplay() { this.$nextTick(() => this.observeInlineBlocks()); },
      inlineSidebarVisible() { this.$nextTick(() => this.observeInlineBlocks()); },
    },
    mounted() {
      this._draftBeforeUnload = event => {
        if (this.draftWritePending || this._draftTimer || this.inlineDraftError
          || [...(this._retainedDraftSessions?.values() || [])].some(session => session.pendingRecord || session.writeError)) {
          this.flushEditorDraft(); event.preventDefault(); event.returnValue = '';
        }
      };
      this._draftWindowBlur = () => { this.flushEditorDraft(); };
      this._draftVisibility = () => { if (document.hidden) this.flushEditorDraft(); };
      this._inlineLayoutResize = () => { this.measureWorkspaceChrome(); this.scheduleInlineAlignment(); };
      this._inlineFocusIn = event => {
        if (!this.inlineActive || this.inlineTransitionBusy || this.editorSaving || document.hidden || root.AppDialogs?.isOpen) return;
        if (!this.inlineFocusContains(event.target)) {
          const path = event.target?.closest?.('tr[data-filepath]')?.dataset.filepath;
          if (path) this.activateInlineRow(path);
          else this.finishInlineSession({ promote: true });
        }
      };
      root.addEventListener('beforeunload', this._draftBeforeUnload);
      root.addEventListener('blur', this._draftWindowBlur);
      root.addEventListener('resize', this._inlineLayoutResize);
      document.addEventListener('visibilitychange', this._draftVisibility);
      document.addEventListener('focusin', this._inlineFocusIn);
      this.loadEditorDrafts();
      this.$nextTick(() => this.observeInlineBlocks());
    },
    beforeUnmount() {
      clearTimeout(this._draftTimer); this._inlineObserver?.disconnect();
      root.removeEventListener('beforeunload', this._draftBeforeUnload);
      root.removeEventListener('blur', this._draftWindowBlur);
      root.removeEventListener('resize', this._inlineLayoutResize);
      document.removeEventListener('visibilitychange', this._draftVisibility);
      document.removeEventListener('focusin', this._inlineFocusIn);
      if (this._inlineAlignmentFrame) cancelAnimationFrame(this._inlineAlignmentFrame);
    },
    methods: {
      editorDraftScope(filepath = this.editorCurrentEditingDesc?.filepath) {
        // Settings can select a language before the cloud profile has finished
        // loading. Its context accessor requires initialized state.
        const cloud = this._cloud;
        const profile = cloud && (!Object.hasOwn(cloud, 'state') || cloud.state) ? cloud.context?.()?.profile : null;
        return { profile: profile || this.cloudProfileId || this.cloudUser?.id || 'guest',
          game: this.gameVersion, branchId: this.branchId || 'default', sourceHash: this.sourceIdentity || (this.testMode ? 'test-source' : ''), language: this.lang, filepath };
      },
      editorDraftKey(scope) {
        return root.OfflineStore?.translationDraftKey?.(scope)
          || 'translation_draft_' + JSON.stringify([scope.profile, scope.game, scope.sourceHash, scope.language, scope.filepath,
            ...(scope.branchId && scope.branchId !== 'default' ? [scope.branchId] : [])]);
      },
      serializeEditorTranslations(blocks = this.editorBlocks || []) {
        return blocks.map(block => {
          const translation = block.isTable ? this.joinTableColumns(this.getSerializableTableColumns(block).map(column => column.translation || '')) : block.translation || '';
          return this.encodeNewlines(block.isMultiline ? this.decodeEscapedNewlines(translation) : translation);
        });
      },
      canonicalEditorTranslations(source, translations = []) {
        const english = source?.translations?.English || [];
        const blocks = Array.from({ length: Math.max(english.length, translations.length) }, (_, index) =>
          this.makeEditorBlock(english[index] || '', translations[index] || ''));
        return this.serializeEditorTranslations(blocks);
      },
      committedEditorDraftTranslations(session) {
        return this._draftSession === session && this.draftScopeCurrent(session.scope)
          && this.editorCurrentEditingDesc?.filepath === session.scope.filepath
          ? this.inlineCommittedTranslations : this.canonicalEditorTranslations(session.source, session.base.translations);
      },
      draftScopeCurrent(scope) {
        const now = this.editorDraftScope(scope.filepath);
        return equal(scope, now);
      },
      async draftScopeChanged() {
        this.inlineDraftFindings = {};
        if (this._draftSession && !this.draftScopeCurrent(this._draftSession.scope)) await this.detachEditorSessionForScopeChange();
        await this.loadEditorDrafts();
      },
      async loadEditorDrafts() {
        const scope = this.editorDraftScope('');
        if (!scope.game || !scope.language) { this.inlineDraftRows = {}; this.draftRecords = []; return; }
        const run = this._draftLoadRun = (this._draftLoadRun || 0) + 1;
        this._draftListingPending = run;
        const inScope = record => record.profile === scope.profile && record.game === scope.game && (record.branchId || 'default') === scope.branchId && record.language === scope.language;
        let records, readError;
        try {
          records = this.testMode || !root.OfflineStore?.listTranslationDrafts
            ? [...(this._draftMemory?.values() || [])].filter(r => inScope(r) && (r.state === 'active' || r.conflicts?.length))
            : await root.OfflineStore.listTranslationDrafts({ profile: scope.profile, game: scope.game, branchId: scope.branchId, language: scope.language });
        } catch (error) {
          readError = error;
          records = this.draftRecords.filter(inScope);
        }
        if (this._draftListingPending === run) this._draftListingPending = null;
        if (run !== this._draftLoadRun || !this.draftScopeCurrent(scope)) return;
        records = records.slice();
        for (const [key, session] of this._retainedDraftSessions || []) {
          const pending = session.pendingRecord;
          if (pending && inScope(session.scope)) {
            const index = records.findIndex(record => record.key === pending.key);
            if (index >= 0) records[index] = copy(pending); else records.push(copy(pending));
          }
          // Durable closed sessions can be read again; keep only sessions whose
          // unfinished writes still need their original queue and merge ancestor.
          if (session !== this._draftSession && !pending && !session.writeError) this._retainedDraftSessions.delete(key);
        }
        this.draftRecords = records;
        const rows = Object.fromEntries(records.filter(r => r.sourceHash === scope.sourceHash && r.state === 'active').map(r => [r.filepath, r]));
        const session = this._draftSession;
        if (session?.pendingRecord && this.draftScopeCurrent(session.scope)) rows[session.scope.filepath] = copy(session.pendingRecord);
        this.inlineDraftRows = rows;
        this._fileSearchSnapshot = null;
        this.filterDesc?.();
        if (readError) this.inlineDraftError = 'Could not load local drafts. ' + readError.message;
      },
      publishEditorDraftRecord(session, record) {
        if (!this.draftScopeCurrent(session.scope)) return;
        // The write/read acknowledgement already contains this key's current
        // record. Listing every draft again duplicates storage and list work.
        const inScope = value => value.profile === session.scope.profile && value.game === session.scope.game
          && (value.branchId || 'default') === session.scope.branchId && value.language === session.scope.language;
        const records = (this.draftRecords || []).filter(value => inScope(value) && value.key !== session.key);
        const visible = session.pendingRecord || record;
        if (visible && (visible.state === 'active' || visible.conflicts?.length)) records.push(copy(visible));
        this.draftRecords = records;
        const rows = { ...this.inlineDraftRows };
        if (visible?.state === 'active' && visible.sourceHash === session.scope.sourceHash) rows[session.scope.filepath] = copy(visible);
        else delete rows[session.scope.filepath];
        this.inlineDraftRows = rows;
        for (const [key, retained] of this._retainedDraftSessions || []) {
          if (retained !== this._draftSession && !retained.pendingRecord && !retained.writeError) this._retainedDraftSessions.delete(key);
        }
        if (this._draftListingPending) {
          // A listing started before this commit may contain its old revision.
          // Read it afresh in the background instead of publishing stale data.
          this.loadEditorDrafts();
        }
        this.filterDesc?.({ changedFilepaths: [session.scope.filepath], draftOnly: true });
      },
      beginEditorDraftSession(request) {
        const scope = this.editorDraftScope(request.desc.filepath);
        const key = this.editorDraftKey(scope);
        const retained = request.retainedDraftSession || this._retainedDraftSessions?.get(key);
        if (retained && equal(retained.scope, scope) && (retained.pendingRecord || retained.writeError)) {
          // Reopening must not drop a failed write or fork its still-running
          // queue. Its expected revision remains the last one it actually saw.
          retained.detached = false;
          this._draftSession = retained;
          request.retainedDraftSession = retained;
          this._editorCollabBase = copy(retained.base);
          return;
        }
        const existing = request.draftLoaded ? request.draftRecord : this.inlineDraftRows[scope.filepath];
        const base = copy(existing?.base || this._editorCollabBase || this.collaborationFile?.(request.desc) || { translations: request.desc.translations[this.lang] || [] });
        this._draftSession = { scope, key, record: existing?.state === 'active' ? copy(existing) : null,
          id: existing?.id || uuid(), expectedRevision: existing?.revision || null, base,
          source: copy(this.workspaceSourceFile?.(scope.filepath) || request.desc), declined: existing?.declined || '',
          original: (request.desc.translations[this.lang] || []).map(String), pendingRecord: null, detached: false };
        this._retainedDraftSessions ||= new Map();
        this._retainedDraftSessions.set(this._draftSession.key, this._draftSession);
        if (existing?.state === 'active') this._editorCollabBase = copy(existing.base);
      },
      async hydrateEditorDraft(request) {
        if (request.draftLoaded) return;
        request.draftLoaded = true;
        const scope = this.editorDraftScope(request.desc.filepath), key = this.editorDraftKey(scope);
        const retained = request.retainedDraftSession || this._retainedDraftSessions?.get(key);
        if (retained && equal(retained.scope, scope) && (retained.pendingRecord || retained.writeError)) {
          if (!request.isCurrent()) return;
          request.retainedDraftSession = retained;
          request.draftRecord = copy(retained.pendingRecord || retained.record);
          request.draftPreviousRevision = retained.expectedRevision;
          this.seedEditorOpenSource(request);
          return;
        }
        const record = this.testMode || !root.OfflineStore?.getTranslationDraft
          ? this._draftMemory?.get(key) || this.inlineDraftRows[scope.filepath]
          : await root.OfflineStore.getTranslationDraft(key);
        if (!request.isCurrent()) return;
        request.draftRecord = record?.state === 'active' ? record : null;
        request.draftPreviousRevision = record?.revision || null;
        this.seedEditorOpenSource(request);
        if (this._draftSession) this._draftSession.expectedRevision = record?.revision || null;
      },
      scheduleEditorDraft() {
        if (!this.editorSessionActive || this.editorLoading || this.editorLoadError || this.editorCompareActive || !this._draftSession || this._draftSession.detached) return;
        const lines = this.serializeEditorTranslations();
        if (equal(lines, this._draftSession.lastObserved)) return;
        this._draftSession.lastObserved = copy(lines);
        clearTimeout(this._draftTimer);
        this._draftTimer = setTimeout(() => { this._draftTimer = null; this.flushEditorDraft(); }, 250);
        this.scheduleInlineAlignment();
      },
      async writeEditorDraft(session, lines, force = false) {
        const unchanged = !force && equal(lines, this.committedEditorDraftTranslations(session));
        if (unchanged && !session.record && !session.pendingRecord && !session.writeError && !session.resolveConflicts) return true;
        const previousRecord = session.pendingRecord || session.record;
        if (!unchanged && equal(lines, previousRecord?.translations) && equal(session.base, previousRecord?.base)
          && (session.declined || '') === (previousRecord?.declined || '') && !session.writeError && !session.resolveConflicts) {
          await session.write; return !session.writeError;
        }
        const submissionJobIds = [...new Set([session.record?.submissionJobId, ...(session.record?.submissionJobIds || []),
          session.acknowledgedRecord?.submissionJobId, ...(session.acknowledgedRecord?.submissionJobIds || [])].filter(Boolean))];
        const record = { ...session.scope, key: session.key, id: session.id ||= session.record?.id || session.pendingRecord?.id || uuid(), revision: uuid(),
          state: 'active', translations: copy(lines), base: copy(session.base), source: copy(session.source),
          declined: session.declined || '', updatedAt: Date.now(), conflicts: [],
          ...(submissionJobIds.length ? { submissionJobIds } : {}) };
        session.pendingRecord = record;
        if (this.draftScopeCurrent(session.scope)) this.inlineDraftRows = { ...this.inlineDraftRows, [record.filepath]: record };
        this.draftWritePending++;
        const previous = session.write || Promise.resolve();
        session.write = previous.catch(() => {}).then(async () => {
          try {
            let result;
            if (unchanged && !session.resolveConflicts) {
              // Use the same queue as writes: an earlier acknowledgement must
              // finish before consuming the reverted draft's revision.
              result = await this.discardUnchangedEditorDraft(session, previousRecord, lines);
              if (result?.status === 'discarded' && !equal(lines, this.committedEditorDraftTranslations(session))) {
                // A peer save during cleanup can make the reverted text a real
                // local edit again. Retain it against the captured merge base.
                session.expectedRevision = result.record?.revision || session.expectedRevision;
                result = null;
              }
            }
            if (!result) {
              if (session.writeError && session.discardAttempt) {
                const stored = await root.OfflineStore.getTranslationDraft(session.key);
                if (stored?.state === 'discarded' && !stored.conflicts?.length
                  && stored.id === session.discardAttempt.id && stored.consumedRevision === session.discardAttempt.revision) {
                  // An uncertain cleanup may already have committed. Fresh
                  // typing continues from that receipt, not its old revision.
                  session.expectedRevision = stored.revision;
                  session.record = null;
                }
              }
              if (this.testMode || !root.OfflineStore?.putTranslationDraft) {
                this._draftMemory ||= new Map(); this._draftMemory.set(record.key, copy(record)); result = { status: 'saved', record };
              } else result = await root.OfflineStore.putTranslationDraft(record, { expectedRevision: session.expectedRevision, resolveConflicts: !!session.resolveConflicts });
            }
            session.expectedRevision = result.record?.revision || session.expectedRevision;
            session.acknowledgedRecord = result.record || null;
            // The primary record can belong to another tab. Keep this session's
            // authored variant paired with its visible text until explicit review.
            session.record = result.status === 'discarded' ? null : copy(result.status === 'conflict' ? result.preserved || record : result.record);
            if (result.status === 'discarded') {
              session.declined = '';
              if (session.pendingRecord?.revision === record.revision && this.draftScopeCurrent(session.scope))
                this.inlineDraftFindings = { ...this.inlineDraftFindings, [record.filepath]: [] };
            }
            if (session.resolveConflicts && result.status === 'saved') { session.conflict = false; session.resolveConflicts = false; }
            if (result.status === 'conflict') {
              session.conflict = true;
              if (this.draftScopeCurrent(session.scope)) this.inlineDraftFindings = { ...this.inlineDraftFindings, [record.filepath]: [{ level: 'error', message: 'Another tab changed this draft. Open the full editor to review both copies.' }] };
            }
            session.writeError = null;
            session.discardAttempt = null;
            if (session.pendingRecord?.revision === record.revision) session.pendingRecord = null;
            if (this._draftSession === session) this.inlineDraftError = '';
            this.publishEditorDraftRecord(session, result.record);
            return true;
          } catch (error) {
            session.writeError = error;
            this.inlineDraftError = 'Could not keep this local draft. Keep this tab open and retry Save. ' + error.message;
            return false;
          } finally { this.draftWritePending--; }
        });
        return session.write;
      },
      async discardUnchangedEditorDraft(session, previousRecord, lines) {
        if (!equal(lines, this.committedEditorDraftTranslations(session))) return null;
        const memory = this.testMode || !root.OfflineStore?.getTranslationDraft;
        const stored = memory ? this._draftMemory?.get(session.key) : await root.OfflineStore.getTranslationDraft(session.key);
        if (!equal(lines, this.committedEditorDraftTranslations(session))) return null;
        // Automatic cleanup cannot resolve another tab's work or its conflicts.
        if (session.conflict || stored?.conflicts?.length || session.record?.conflicts?.length
          || (stored?.state === 'active' && stored.revision !== session.expectedRevision && stored.revision !== previousRecord?.revision))
          return { status: 'conflict', record: stored, preserved: session.record || previousRecord };
        if (stored?.state !== 'active') return { status: 'discarded', record: stored };
        if (!memory) {
          session.discardAttempt = { id: stored.id, revision: stored.revision };
          const result = await root.OfflineStore.discardTranslationDraft(session.key, stored.revision);
          return { ...result, ...(result.status === 'conflict' ? { preserved: session.record || previousRecord } : {}) };
        }
        const record = { ...stored, state: 'discarded', consumedRevision: stored.revision,
          revision: stored.revision + ':discarded', translations: [], base: null, source: null };
        this._draftMemory.set(session.key, record);
        return { status: 'discarded', record };
      },
      async flushEditorDraft({ force = false } = {}) {
        clearTimeout(this._draftTimer); this._draftTimer = null;
        const session = this._draftSession;
        if (!session || session.detached || this.editorLoading || this.editorLoadError || this.editorCompareActive) return true;
        const lines = this.serializeEditorTranslations();
        // A durable submission already protects this exact text. Recovery
        // checkpoints continue for newer typing and for an explicit failed save.
        if (!force && session.submission && equal(lines, session.submission.translations)) {
          await session.write; return !session.writeError;
        }
        return this.writeEditorDraft(session, lines, force);
      },
      detachEditorSessionForScopeChange() {
        const pending = this.flushEditorDraft();
        if (this._draftSession) this._draftSession.detached = true;
        this._draftSession = null; this.inlineActive = false; this.editorVisible = false;
        this.inlineDraftFindings = {}; this.draftRecoveryCandidate = null;
        this._editorOpenRun = (this._editorOpenRun || 0) + 1;
        this.closeHlPopup?.(); this._collaboration?.leaveEdit(); this.editorBlocks = [];
        return pending;
      },
      inlineDraftFor(filepath) { return this.inlineDraftRows[filepath] || null; },
      inlineFindingsFor(filepath) { return this.inlineDraftFindings[filepath] || []; },
      inlineRowBlocks(row) {
        const desc = this.getDescByFilepath(row.filepath), english = desc?.translations?.English || [];
        const lines = this.inlineDraftFor(row.filepath)?.translations || desc?.translations?.[this.lang] || [];
        if (!desc) return [];
        if (!this._inlineRowBlockCache) this._inlineRowBlockCache = new WeakMap();
        const key = root.Vue?.toRaw ? root.Vue.toRaw(desc) : desc;
        const cached = this._inlineRowBlockCache.get(key);
        const count = Math.max(english.length, lines.length);
        // Read only this row's strings to retain reactive updates, including
        // in-place repairs. Popup selection can then reuse both columns' blocks
        // without decoding or allocating them again on every parent render.
        let unchanged = cached?.blocks.length === count;
        for (let index = 0; index < count; index++) {
          const source = english[index] || '', translation = lines[index] || '';
          if (cached?.source[index] !== source || cached?.translation[index] !== translation) unchanged = false;
        }
        if (unchanged) return cached.blocks;
        const source = [], translation = [], blocks = [];
        for (let index = 0; index < count; index++) {
          source.push(english[index] || ''); translation.push(lines[index] || '');
          blocks.push({ index,
            english: cached?.source[index] === source[index] ? cached.blocks[index].english : this.decodeEscapedNewlines(source[index]),
            translation: cached?.translation[index] === translation[index] ? cached.blocks[index].translation : this.decodeEscapedNewlines(translation[index]) });
        }
        this._inlineRowBlockCache.set(key, { source, translation, blocks });
        return blocks;
      },
      inlineFocusContains(target) {
        if (!target?.closest) return false;
        return target.closest('tr[data-filepath]')?.dataset.filepath === this.editorCurrentEditingDesc?.filepath
          || !!target.closest('[data-inline-focus-surface], .appDialogOverlay, .appDialog');
      },
      inlineFocusSurfacePointerDown(event) {
        if (!this.inlineActive || event.button != null && event.button !== 0) return;
        const surface = event.currentTarget;
        const control = event.target?.closest?.('button, a[href], input, textarea, select, [contenteditable="true"], [tabindex]');
        if (control && control !== surface && !control.matches?.(':disabled')) return;
        // A tabindex=-1 surface gives background clicks a real focus target.
        // Keep native selection and pointer behavior while retaining the file.
        surface?.focus?.({ preventScroll: true });
      },
      inlineRowFocusOut(event) {
        if (!this.inlineActive || this.inlineTransitionBusy || this.editorSaving || this.inlineFocusContains(event.relatedTarget)) return;
        setTimeout(() => {
          if (document.hidden || document.hasFocus?.() === false || root.AppDialogs?.isOpen || this.inlineTransitionBusy) return;
          if (!this.inlineFocusContains(document.activeElement)) this.finishInlineSession({ promote: true });
        }, 0);
      },
      inlineRowClick(event, filepath) {
        if (!this.inlineEditor) return this.openFileRow(filepath);
        if (event?.target?.closest?.('button, a, input, textarea, select, .HLter')) {
          if (this.inlineActive && this.editorCurrentEditingDesc?.filepath === filepath) return;
        }
        return this.activateInlineRow(filepath);
      },
      inlineRowDoubleClick(event, filepath) {
        if (event?.target?.closest?.('button, a, input, textarea, select, [contenteditable="true"], .HLter')) return;
        return this.openInlineFullEditor(filepath);
      },
      inlineTranslationKeydown(event) {
        if (!this.inlineActive || this.editorVisible || event.defaultPrevented || this.isImeComposingEvent(event)
          || !event.ctrlKey || event.altKey || event.metaKey || event.shiftKey
          || !['ArrowUp', 'ArrowDown'].includes(event.key)
          || event.target?.closest?.('tr[data-filepath]')?.dataset.filepath !== this.editorCurrentEditingDesc?.filepath) return false;
        event.preventDefault(); event.stopPropagation();
        this.moveInlineFile(event.key === 'ArrowUp' ? -1 : 1);
        return true;
      },
      async moveInlineFile(direction, path = this.inlineActive ? this.editorCurrentEditingDesc?.filepath : this.selectedFilepath) {
        if (!this.inlineEditor || this.inlineTransitionBusy || this.navigationBusy || this.editorSaving
          || (this.inlineActive && this.editorTranslationReadOnly) || this._importingSource || this.versionStorageLoading
          || this.draftRecoveryVisible || this.fileListNavigationBlocked()) return false;
        if (!path || ![-1, 1].includes(direction)) return false;
        const outgoingPath = this.inlineActive ? this.editorCurrentEditingDesc?.filepath : null;
        const scope = this.editorDraftScope(path), context = this.captureCollaborationContext?.();
        const cancelRevision = this._editorOpenCancelRevision || 0;
        const current = () => this.draftScopeCurrent(scope) && (!context || this.collaborationContextCurrent(context))
          && cancelRevision === (this._editorOpenCancelRevision || 0) && !this._importingSource
          && !this.draftRecoveryVisible && !this.fileListNavigationBlocked();
        const originalFocus = { index: this.editorFocusedIndex || 0, column: this.editorFocusedColumnIndex || 0 };
        const focusFile = async (filepath, index = 0, column = 0) => {
          const run = this._editorOpenRun;
          await this.$nextTick();
          if (!current() || !this.inlineActive || this._editorOpenRun !== run
            || this.editorCurrentEditingDesc?.filepath !== filepath || this._inlineRequestedPath !== filepath) return false;
          index = Math.min(index, Math.max(0, this.editorBlocks.length - 1));
          const block = this.editorBlocks[index];
          this.getEditorRef('translation', index, block?.isTable ? Math.min(column, Math.max(0, block.tableColumns.length - 1)) : null)?.focus?.({ preventScroll: true });
          this.focusSelectedFileRow(false);
          return true;
        };
        // Preserve the outgoing anchor before promotion can remove it from a filter.
        const rows = this.filteredDescs.slice();
        if (!rows.some(row => row.filepath === path)) {
          const anchorRow = this.descsDisplay.find(row => row.filepath === path) || this.getDescByFilepath(path);
          if (!anchorRow) return false;
          rows.push(anchorRow);
        }
        const modifier = this.currentSortDir === 'desc' ? -1 : 1;
        rows.sort((a, b) => a[this.currentSort] < b[this.currentSort] ? -modifier : a[this.currentSort] > b[this.currentSort] ? modifier : 0);
        const candidates = [], anchor = rows.findIndex(row => row.filepath === path);
        for (let index = anchor + direction; index >= 0 && index < rows.length; index += direction) candidates.push(rows[index].filepath);
        let lastRequested = path;
        this.navigationBusy = true;
        try {
          for (const filepath of candidates) {
            if (!current()) return false;
            if (this._collaboration?.isEditing(filepath) || !this.filteredDescs.some(row => row.filepath === filepath)) continue;
            lastRequested = filepath;
            const opened = await this.activateInlineRow(filepath, { automatic: true });
            if (!current() || this._inlineRequestedPath !== filepath) return false;
            if (opened === false) {
              if (this.inlineActive || this.editorLoadError || this.inlineDraftError) return false;
              continue;
            }
            return await focusFile(filepath);
          }
          // A claim can lose the occupancy race after the outgoing row was closed.
          if (outgoingPath && !this.inlineActive && current() && this._inlineRequestedPath === lastRequested
            && await this.activateInlineRow(outgoingPath, { automatic: true })) await focusFile(outgoingPath, originalFocus.index, originalFocus.column);
          return false;
        } finally { this.navigationBusy = false; }
      },
      async activateInlineRow(filepath, options = {}) {
        if (!this.inlineEditor || this.editorVisible || !this.getDescByFilepath(filepath) || this._importingSource) return false;
        const scope = this.editorDraftScope(filepath), context = this.captureCollaborationContext?.();
        if (!this.inlineActive && this.managedWarnBeforeEdit && !await this.managedWarnBeforeEdit()) return false;
        if (!this.draftScopeCurrent(scope) || (context && !this.collaborationContextCurrent(context))) return false;
        this._inlineRequestedPath = filepath;
        if (this.inlineTransitionBusy) return false;
        if (this.inlineActive && this.editorCurrentEditingDesc?.filepath === filepath && !this.editorLoadError) return true;
        this.inlineTransitionBusy = true;
        const opening = this.runInlineRowActivation(filepath, scope, context, options);
        this._inlineActivationPromise = opening;
        try { return await opening; }
        finally { if (this._inlineActivationPromise === opening) this._inlineActivationPromise = null; }
      },
      async runInlineRowActivation(filepath, scope, context, options = {}) {
        const cancelRevision = this._editorOpenCancelRevision || 0;
        const current = () => this.draftScopeCurrent(scope) && (!context || this.collaborationContextCurrent(context))
          && cancelRevision === (this._editorOpenCancelRevision || 0);
        const automaticPath = options.automatic ? filepath : null;
        const activation = this._inlineActivationToken = {};
        // The outgoing promotion writes the store used to hydrate the next draft.
        // Prepare and paint the next inline row before starting that queued write.
        const releaseLocalSaves = this.inlineActive
          ? (!this.testMode ? this.initializePendingSaves?.() : this._pendingSaves)?.hold?.() : null;
        try {
          if (this.inlineActive && !await this.finishInlineSession({ promote: true, ownedTransition: true })) return false;
          if (!current() || this.editorVisible) return false;
          filepath = this._inlineRequestedPath;
          if (!this.descsDisplay.some(row => row.filepath === filepath)) {
            if (!this.filteredDescs.some(row => row.filepath === filepath)) {
              this.searchText = ''; this.selectedFileFilters = this.fileFilterOptions.map(option => option.key); this.filterDesc();
            }
            const sorted = this.filteredDescs.slice().sort((a, b) => {
              const direction = this.currentSortDir === 'desc' ? -1 : 1;
              return a[this.currentSort] < b[this.currentSort] ? -direction : a[this.currentSort] > b[this.currentSort] ? direction : 0;
            });
            const position = sorted.findIndex(row => row.filepath === filepath);
            if (position >= 0) this.currentPage = Math.floor(position / this.pageSize) + 1;
          }
          this._inlineHeldRows = this.descsDisplay.slice();
          if (!['dictionary', 'lookup', 'preview', 'comments'].includes(this.sideTab)) this.sideTab = 'dictionary';
          this._nextEditorSurface = 'inline';
          // Reopening a pending draft waits for its save; allow that queue to run.
          if (this.pendingDraftSaveFor?.(filepath)) releaseLocalSaves?.();
          const opened = await this.editFile(filepath, true, { inline: true, automatic: filepath === automaticPath });
          this.$nextTick(() => this.observeInlineBlocks());
          if (opened !== false && releaseLocalSaves) await this.yieldEditorPaint();
          if (!current()) return false;
          return opened;
        } finally {
          releaseLocalSaves?.();
          if (this._inlineActivationToken === activation) {
            this._inlineActivationToken = null;
            this._nextEditorSurface = null; this.inlineTransitionBusy = false;
            if (current() && this._inlineRequestedPath && this._inlineRequestedPath !== filepath) this.activateInlineRow(this._inlineRequestedPath);
          }
        }
      },
      async finishInlineSession({ promote = true, ownedTransition = false } = {}) {
        if (!promote) {
          this._editorOpenCancelRevision = (this._editorOpenCancelRevision || 0) + 1;
          this._inlineRequestedPath = null;
        }
        if (this._inlineFinishing) return this._inlineFinishing;
        if (!this.inlineActive) return true;
        if (!ownedTransition) this.inlineTransitionBusy = true;
        const session = this._draftSession, run = this._editorOpenRun, path = this.editorCurrentEditingDesc?.filepath;
        const current = () => this._draftSession === session && this._editorOpenRun === run && (!session || this.draftScopeCurrent(session.scope));
        this._inlineFinishing = (async () => {
          try {
            if (promote && session && !session.conflict && this.inlineDraftHasChanges) {
              // A valid inline transition goes directly to the durable save
              // journal. Invalid or declined work gets its recovery checkpoint
              // from the shared save guards instead.
              await this.editorSave({ close: false, automatic: true });
            } else if (!await this.flushEditorDraft() || !current()) return false;
            if (!current() || !await this.flushEditorDraft() || !current()) return false;
            if (this.inlineDraftError) return false;
            this.inlineActive = false; this.closeHlPopup(); this._collaboration?.leaveEdit(); this.endDictionaryEdit();
            this._draftSession = null; this._inlineHeldRows = null;
            this.filterDesc({ changedFilepaths: [path], draftOnly: true }); return true;
          } finally { if (!ownedTransition) this.inlineTransitionBusy = false; }
        })();
        try { return await this._inlineFinishing; }
        finally {
          this._inlineFinishing = null;
          if (!ownedTransition && !this.inlineActive && this._inlineRequestedPath && this._inlineRequestedPath !== path
            && (!session || this.draftScopeCurrent(session.scope))) this.activateInlineRow(this._inlineRequestedPath);
        }
      },
      async openInlineFullEditor(filepath = this.editorCurrentEditingDesc?.filepath, action = '') {
        if (!filepath) return false;
        const scope = this.editorDraftScope(filepath);
        const context = this.captureCollaborationContext?.();
        const current = () => this.draftScopeCurrent(scope) && (!context || this.collaborationContextCurrent(context));
        if (this.inlineTransitionBusy && this.editorCurrentEditingDesc?.filepath !== filepath) {
          // Preserve the full-surface intent while serialized row claims finish.
          this._inlineRequestedPath = filepath;
          let pending;
          while (this.inlineTransitionBusy && (pending = this._inlineActivationPromise || this._inlineFinishing)) {
            await pending;
            if (!current() || this._inlineRequestedPath !== filepath) return false;
          }
        }
        if (!await this.flushEditorDraft()) return false;
        if (!current()) return false;
        if (this.inlineActive && this.editorCurrentEditingDesc?.filepath === filepath && !this.editorLoadError) {
          this.inlineActive = false; this.editorVisible = true; this._fileTableReturnFocus = true;
          if (this.sideTab === 'preview') this.sideTab = 'dictionary';
          const candidate = root.WorkspaceState.droppedForFile(this.localDescs, filepath, this.lang);
          this.editorDroppedCandidate = candidate ? copy(candidate) : null;
          this.$nextTick(() => this.getEditorRef('translation', this.editorFocusedIndex || 0, this.editorBlocks[this.editorFocusedIndex || 0]?.isTable ? 0 : null)?.focus());
        } else if (await this.editFile(filepath, true) === false) return false;
        if (!current() || this.editorCurrentEditingDesc?.filepath !== filepath) return false;
        if (action === 'regex' || action === 'history') this.sideTab = action;
        if (action === 'consistency') this.openConsistencyResolver(this.editorFocusedIndex || 0);
        return true;
      },
      async reloadInlineSession(filepath) {
        if (this.editorCurrentEditingDesc?.filepath !== filepath || !this.inlineActive) return;
        this._nextEditorSurface = 'inline';
        try { return await this.openEditorFile(filepath, true); } finally { this._nextEditorSurface = null; }
      },
      saveInlineDraft() { return this.editorSave({ close: false, defer: true }); },
      async deleteEditorStagedTranslation() {
        if (this.editorLoading || this.editorLoadError || this.editorSaving || this.navigationBusy || this.editorTranslationReadOnly
          || this._importingSource || this._resetConfirming || this.versionStorageLoading || !this.editorHasStagedTranslation) return false;
        const desc = this.editorCurrentEditingDesc, session = this._draftSession, blocks = this.editorBlocks;
        const context = this.captureCollaborationContext();
        const scope = this.editorDraftScope(desc.filepath), openRun = this._editorOpenRun;
        const base = copy(context.client?.fileBase(desc.filepath) || this.collaborationFile(desc));
        const current = () => this.editorCurrentEditingDesc === desc && this.editorBlocks === blocks && this._draftSession === session
          && this._editorOpenRun === openRun && this.draftScopeCurrent(scope)
          && this.collaborationContextCurrent(context) && !this.editorTranslationReadOnly && this.editorHasStagedTranslation
          && equal(base, context.client?.fileBase(desc.filepath) || this.collaborationFile(desc));
        const token = this._editorSaveToken = {};
        this.editorSaving = true;
        try {
          if (!await this.flushEditorDraft() || !current()) return false;
          const shared = context.client ? '\n\nThis deletion will also be shared with your language team.' : '';
          if (!await this.appConfirm('Delete the staged ' + context.language + ' translation for ' + desc.filepath
            + '?\n\nThe committed translation will return to the original ZIP text and will no longer be included in staged export. Local drafts and translation history will be kept.' + shared,
            { title: 'Delete staged translation?', confirmLabel: 'Delete staged translation', danger: true })) return false;
          if (!current() || !await this.flushEditorDraft() || !current()) return false;
          const draftBefore = blocks.map(block => block.translation ?? '');
          const hadDraft = !!session?.record || this.editorHaveChanges();
          let finalized = false;
          const finish = async () => {
            if (finalized) return true;
            if (this.editorCurrentEditingDesc !== desc || this.editorBlocks !== blocks || this._draftSession !== session
              || this._editorOpenRun !== openRun || !this.draftScopeCurrent(scope) || !this.collaborationContextCurrent(context)) return false;
            const accepted = context.client?.fileBase(desc.filepath) || this.collaborationFile(desc);
            if (hadDraft || !equal(draftBefore, blocks.map(block => block.translation ?? ''))) {
              // Deleting committed work leaves private typing available for an
              // explicit later save, including typing during the storage write.
              this.editorOriginalTranslations = accepted.translations.map(text => this.decodeEscapedNewlines(text));
              this._editorCollabBase = context.client ? copy(accepted) : undefined;
              if (session && !session.conflict && !session.record?.conflicts?.length) {
                session.base = copy(accepted); session.original = [...accepted.translations]; session.declined = '';
                await this.writeEditorDraft(session, this.serializeEditorTranslations(), true);
              }
            } else {
              const beforePrepare = copy(this.serializeEditorTranslations());
              const stillCurrent = () => this.editorSessionActive && this.editorCurrentEditingDesc === desc
                && this.editorBlocks === blocks && this._draftSession === session && this._editorOpenRun === openRun
                && this.draftScopeCurrent(scope) && this.collaborationContextCurrent(context)
                && equal(accepted, context.client?.fileBase(desc.filepath) || this.collaborationFile(desc));
              const restored = await this.prepareMatchedEditorBlocks(desc.translations.English, accepted.translations, stillCurrent);
              if (!restored || !stillCurrent()) return false;
              if (equal(beforePrepare, this.serializeEditorTranslations())) this.applyPreparedEditorBlocks(restored);
              this.editorOriginalTranslations = accepted.translations.map(text => this.decodeEscapedNewlines(text));
              this._editorCollabBase = context.client ? copy(accepted) : undefined;
              if (session) { session.base = copy(accepted); session.original = [...accepted.translations]; }
              this.refreshGamePreview();
            }
            const failure = this._stagedDeletionFailure;
            if (failure && equal(failure.scope, scope)) {
              if (this.collaborationNotice === failure.message) this.collaborationNotice = '';
              if (this.cloudStorageError === failure.message) this.cloudStorageError = '';
              this.inlineDraftFindings = { ...this.inlineDraftFindings, [desc.filepath]: this.inlineFindingsFor(desc.filepath).filter(item => item.message !== failure.message) };
              this._stagedDeletionFailure = null;
            }
            finalized = true;
            return true;
          };
          // Keep this hook on the queued job so an uncertain worker completion
          // followed by Retry advances the same editor's base exactly once.
          const result = await this.persistStagedDeletion(desc, base, context, finish);
          if (result.stale || !result.durable || !await finish()) return false;
          if (this.sideTab === 'history') await this.refreshHistory();
          return true;
        } catch (error) {
          if (this.collaborationContextCurrent(context) && this._editorSaveToken === token) {
            this.collaborationNotice = 'Could not delete the staged translation. ' + error.message;
            this._stagedDeletionFailure = { scope: copy(scope), message: this.collaborationNotice };
            if (!error.code?.startsWith('DELETE_STAGED_')) this.cloudStorageError = this.collaborationNotice;
            if (this.inlineDraftFindings) this.inlineDraftFindings = { ...this.inlineDraftFindings, [desc.filepath]: [{ level: 'error', message: this.collaborationNotice }] };
          }
          return false;
        } finally { if (this._editorSaveToken === token) this.editorSaving = false; }
      },
      async discardEditorDraft() {
        const session = this._draftSession;
        if (!session || !await this.flushEditorDraft()) return false;
        if (!await this.appConfirm('Discard this local draft and return to the committed translation?', { title: 'Discard draft?', confirmLabel: 'Discard draft', danger: true })) return false;
        if (session !== this._draftSession) return false;
        const record = session.record;
        if (record && !await this.discardDraftRecord(record)) return false;
        const wasInline = this.inlineActive, filepath = session.scope.filepath;
        this._draftSession = null;
        this.inlineDraftFindings = { ...this.inlineDraftFindings, [filepath]: [] };
        this._nextEditorSurface = wasInline ? 'inline' : 'full';
        try { await this.openEditorFile(filepath, true); } finally { this._nextEditorSurface = null; }
        return true;
      },
      async discardDraftRecord(record) {
        try {
          if (this.testMode || !root.OfflineStore?.discardTranslationDraft) this._draftMemory?.delete(record.key);
          else {
            const result = await root.OfflineStore.discardTranslationDraft(record.key, record.revision);
            if (result.status === 'conflict') { await this.loadEditorDrafts(); return false; }
          }
          await this.loadEditorDrafts(); return true;
        } catch (error) { this.inlineDraftError = 'Could not discard the draft. ' + error.message; return false; }
      },
      async editorDraftCommitted(session, submitted, ack, accepted) {
        if (!session) return;
        if (session.submission && equal(session.submission.translations, submitted)) session.submission = null;
        const committedBase = copy(accepted || this._editorCollabBase || { translations: submitted });
        // Drain writes captured during the worker transaction before reading its consumed revision.
        let pending;
        do { pending = session.write; await pending; } while (pending !== session.write);
        session.record = null;
        session.base = committedBase;
        session.base.translations = copy(submitted);
        session.original = copy(submitted);
        let stored = null;
        if (this.testMode) this._draftMemory?.delete(session.key);
        else {
          stored = await root.OfflineStore.getTranslationDraft(session.key);
          session.expectedRevision = stored?.revision || null;
          if (stored?.state === 'active') session.record = copy(stored);
        }
        const current = this._draftSession === session ? this.serializeEditorTranslations() : session.pendingRecord?.translations || session.record?.translations || submitted;
        if (!equal(current, submitted)) {
          if (!await this.writeEditorDraft(session, current, true)) return;
          // A conflict keeps our authored variant in session.record. Publish
          // the acknowledgement's aggregate so both copies remain reviewable.
          stored = session.acknowledgedRecord;
        }
        if (this.draftScopeCurrent(session.scope) && !session.conflict && !session.writeError && !stored?.conflicts?.length) {
          this.inlineDraftFindings = { ...this.inlineDraftFindings, [session.scope.filepath]: [] };
        }
        this.publishEditorDraftRecord(session, stored);
      },
      async openDraftRecovery() {
        if ((this.inlineActive || this._inlineFinishing) && !await this.finishInlineSession({ promote: true })) return;
        if (!await this.flushEditorDraft()) return;
        await this.loadEditorDrafts(); this.draftRecoveryVisible = true; this.draftRecoverySelected = null;
        this.$nextTick(() => this.$refs.draftRecoveryDialog?.showModal?.());
      },
      closeDraftRecovery() { this.$refs.draftRecoveryDialog?.close?.(); this.draftRecoveryVisible = false; this.draftRecoverySelected = null; },
      selectDraftRecovery(record) { this.draftRecoverySelected = record; },
      async discardRecoveryDraft(record) {
        if (record?.conflict) return;
        if (!record || !await this.appConfirm('Discard this preserved local draft?', { confirmLabel: 'Discard draft', danger: true })) return;
        if (await this.discardDraftRecord(record)) this.draftRecoverySelected = null;
      },
      async recoverSelectedDraft() {
        const record = this.draftRecoverySelected, desc = this.getDescByFilepath(record?.filepath);
        if (!record || !desc || this.draftRecoveryBusy) return;
        this.draftRecoveryBusy = true;
        try {
          const scope = this.editorDraftScope(record.filepath);
          if (record.profile !== scope.profile || record.game !== scope.game || record.language !== scope.language) return;
          if (!await this.flushEditorDraft()) return;
          if (!this.draftScopeCurrent(scope)) return;
          const translations = copy(record.translations), oldEnglish = copy(record.english || record.source?.translations?.English || []);
          this.closeDraftRecovery();
          if (!await this.openInlineFullEditor(record.filepath) || !this.draftScopeCurrent(scope) || this.editorCurrentEditingDesc?.filepath !== record.filepath) return;
          this.draftRecoveryCandidate = { translations, english: oldEnglish, scope, sessionRun: this._editorOpenRun,
            expectedRevision: this._draftSession?.expectedRevision, originalBlocks: copy(this.editorBlocks),
            base: copy(this.collaborationFile?.(desc) || { translations: desc.translations[this.lang] || [] }) };
          this.editorCompareActive = true; this.editorCompareMode = 'translation';
          this.editorCompareTitle = 'Local draft recovery — review the preserved translation against this source';
          const english = desc.translations.English;
          const candidate = this.draftRecoveryCandidate;
          const stillCurrent = () => this.draftRecoveryCandidate === candidate && this.draftScopeCurrent(scope)
            && candidate.sessionRun === this._editorOpenRun && this.editorCurrentEditingDesc === desc;
          const prepared = await this.prepareMatchedEditorBlocks(english, translations, stillCurrent, oldEnglish.length);
          if (!prepared || !stillCurrent()) return;
          this.applyPreparedEditorBlocks(prepared);
          this.editorShowEnglishDiff = !equal(oldEnglish, english);
          for (let i = 0; i < this.editorBlocks.length; i++) {
            const block = this.editorBlocks[i], oldText = this.decodeEscapedNewlines(this.draftRecoveryCandidate.base.translations[i] || ''), newText = this.decodeEscapedNewlines(translations[i] || '');
            block.translationDiffHtml = this.renderInlineDiffHtml(oldText, newText);
            block.translationCompareColumns = block.isTable ? this.buildEditorTableTranslationDiffColumns(block, oldText, newText) : [];
            if (this.editorShowEnglishDiff) this.applyEditorEnglishDiff(block, oldEnglish[i] || '', english[i] || '', english[i] || '');
          }
        } finally { this.draftRecoveryBusy = false; }
      },
      async applyRecoveredDraft() {
        const recovery = this.draftRecoveryCandidate;
        if (!recovery || !this.editorSessionActive || !this.draftScopeCurrent(recovery.scope)
          || recovery.sessionRun !== this._editorOpenRun || recovery.expectedRevision !== this._draftSession?.expectedRevision) return;
        const currentBase = this.collaborationFile?.(this.editorCurrentEditingDesc) || { translations: this.editorCurrentEditingDesc.translations[this.lang] || [] };
        if (!equal(recovery.base, currentBase)) {
          this.collaborationNotice = 'The committed translation changed during recovery. Reopen Local drafts and review the current comparison.';
          return;
        }
        const english = this.editorCurrentEditingDesc.translations.English;
        const stillCurrent = () => this.draftRecoveryCandidate === recovery && this.editorSessionActive
          && this.draftScopeCurrent(recovery.scope) && recovery.sessionRun === this._editorOpenRun
          && recovery.expectedRevision === this._draftSession?.expectedRevision;
        const prepared = await this.prepareMatchedEditorBlocks(english, recovery.translations, stillCurrent);
        if (!prepared || !stillCurrent()) return;
        const preparedBase = this.collaborationFile?.(this.editorCurrentEditingDesc)
          || { translations: this.editorCurrentEditingDesc.translations[this.lang] || [] };
        if (!equal(recovery.base, preparedBase)) {
          this.collaborationNotice = 'The committed translation changed during recovery. Reopen Local drafts and review the current comparison.';
          return;
        }
        this.editorCompareActive = false; this.draftRecoveryCandidate = null;
        this.editorShowEnglishDiff = !!this.editorDroppedCandidate;
        this.applyPreparedEditorBlocks(prepared);
        this._draftSession.base = copy(recovery.base); this._editorCollabBase = copy(recovery.base);
        this._draftSession.resolveConflicts = true;
        this._draftSession.writeError = new Error('Reviewed recovery needs a fresh draft revision');
        await this.flushEditorDraft({ force: true }); this.refreshGamePreview();
      },
      measureWorkspaceChrome() {
        const workspace = document.querySelector('.workspace');
        if (!workspace?.style) return;
        for (const [selector, property] of [['.workspaceHeader', '--workspace-header-height'], ['.workspaceFooter', '--workspace-footer-height']]) {
          const height = Math.ceil(document.querySelector(selector)?.getBoundingClientRect().height || 0);
          if (height > 0 && workspace.style.getPropertyValue(property) !== height + 'px') workspace.style.setProperty(property, height + 'px');
        }
      },
      observeInlineBlocks() {
        this.measureWorkspaceChrome();
        if (typeof ResizeObserver !== 'undefined') {
          this._inlineObserver ||= new ResizeObserver(() => { this.measureWorkspaceChrome(); this.scheduleInlineAlignment(); });
          this._inlineObserver.disconnect();
          for (const inner of document.querySelectorAll('.inlineBlockNatural, .workspaceHeader, .workspaceFooter')) this._inlineObserver.observe(inner);
        }
        this.scheduleInlineAlignment();
      },
      scheduleInlineAlignment() {
        if (typeof requestAnimationFrame !== 'function' || this._inlineAlignmentFrame) return;
        this._inlineAlignmentFrame = requestAnimationFrame(() => {
          this._inlineAlignmentFrame = null;
          const writes = [];
          for (const row of document.querySelectorAll('tr[data-filepath]')) {
            const groups = new Map();
            for (const block of row.querySelectorAll('[data-inline-block]')) {
              const key = block.dataset.inlineBlock;
              if (!groups.has(key)) groups.set(key, []); groups.get(key).push(block);
            }
            for (const blocks of groups.values()) {
              const height = Math.ceil(Math.max(0, ...blocks.map(block => block.querySelector('.inlineBlockNatural')?.getBoundingClientRect().height || 0)));
              for (const block of blocks) writes.push([block, height]);
            }
          }
          for (const [block, height] of writes) if (block.style.minHeight !== height + 'px') block.style.minHeight = height + 'px';
        });
      },
    },
  };
  root.InlineEditor = { mixin };
})(window);
