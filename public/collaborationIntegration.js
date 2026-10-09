/* Collaboration lifecycle and durable editor commands. UI and transport stay separate. */
(() => {
  const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const initializationTask = (app, label, callback, session) => typeof app.runWorkspaceInitializationTask === 'function'
    ? app.runWorkspaceInitializationTask(label, callback, session) : callback();
  const mixin = {
    data() { return { editorSaving: false, navigationBusy: false, collaborationNotice: '', sourceIdentity: '', importBaseline: null, importBaselineHashing: false, pendingLocalSaves: 0, localSaveError: '' }; },
    watch: {
      cloudSignedIn() { this.scheduleCollaboration(); },
      'cloudUser.id'() { this.scheduleCollaboration(); },
      'cloudUser.language'() { this.scheduleCollaboration(); },
      'cloudUser.assignmentVersion'() { this.scheduleCollaboration(); },
      'cloudUser.role'() { this.scheduleCollaboration(); },
      cloudCanAccessAllLanguages() { this.scheduleCollaboration(); },
      lang() { this.scheduleCollaboration(); },
      gameVersion() { this.scheduleCollaboration(); },
      branchId() { this.scheduleCollaboration(); },
      sourceLoaded() { this.scheduleCollaboration(); },
      sourceIdentity() { this.scheduleCollaboration(); },
      versionChooserVisible: { flush: 'sync', handler(visible) { this._collaboration?.updatePresence?.(); if (!visible) this.queueReconciledImportReload(); } },
      selectedFilepath(path) { this._collaboration?.select(path); },
      editorVisible(visible) { if (!visible && !(this.editorSessionActive ?? this.editorVisible)) { this._collaboration?.leaveEdit(); this.queueReconciledImportReload(); } this.updateLeaveProtection(); },
      editorSessionActive(active) { if (!active) { this._collaboration?.leaveEdit(); this.queueReconciledImportReload(); } this.updateLeaveProtection(); },
      pendingLocalSaves() { this.updateLeaveProtection(); },
      draftWritePending() { this.updateLeaveProtection(); },
    },
    mounted() {
      this.initializePendingSaves(); this.updateLeaveProtection();
      this._collabOnline = () => this.collabRetry().catch(() => {});
      window.addEventListener('online', this._collabOnline);
      this._collabActivityAt = Date.now();
      this._collabActivity = () => this.markCollaborationActivity();
      this._collabVisibility = () => {
        if (!document.hidden) this._collabActivityAt = Date.now();
        this.updateCollaborationActivity();
        if (!document.hidden) this.collabRetry().catch(() => {});
      };
      this._collabFocus = () => this.collabRetry().catch(() => {});
      for (const event of ['keydown', 'pointerdown', 'pointermove', 'wheel', 'focus']) window.addEventListener(event, this._collabActivity, { passive: true });
      document.addEventListener('visibilitychange', this._collabVisibility);
      window.addEventListener('focus', this._collabFocus);
      this.updateCollaborationActivity();
      this._collabPoll = setInterval(() => { this.updateCollaborationActivity(); if (!document.hidden) this.collabRetry({ background: true }).catch(() => {}); }, 15000);
    },
    beforeUnmount() {
      this._collaborationDisposed = true;
      clearTimeout(this._reconciledImportReloadTimer); this._reconciledImportReload = null;
      clearTimeout(this._collabStartTimer); clearInterval(this._collabPoll);
      window.removeEventListener('online', this._collabOnline);
      for (const event of ['keydown', 'pointerdown', 'pointermove', 'wheel', 'focus']) window.removeEventListener(event, this._collabActivity);
      document.removeEventListener('visibilitychange', this._collabVisibility);
      window.removeEventListener('focus', this._collabFocus);
      this._collaboration?.destroy?.();
      this._collaboration?.disconnect();
      window.removeEventListener('beforeunload', this._pendingSaveBeforeUnload);
      this._saveWorker?.dispose?.(); this._pendingSaves?.dispose?.();
      this._collabFileIndexes = null;
      this.clearBrowserWork?.('collaboration');
    },
    methods: {
      workspaceSource() {
        return this.importBaseline?.source || this._workspaceSourceBaseline || this.descs || [];
      },
      workspaceSourceFile(filepath) {
        const source = this.workspaceSource();
        if (!this._workspaceBaselineIndex || this._workspaceBaselineIndex.source !== source) {
          this._workspaceBaselineIndex = { source, files: new Map(source.map(desc => [desc.filepath, desc])) };
        }
        return this._workspaceBaselineIndex.files.get(filepath);
      },
      droppedCandidateMatches(candidate, current) {
        if (!candidate || !current || candidate.originSourceHash !== current.originSourceHash
          || (candidate.originSourceAvailable !== false) !== (current.originSourceAvailable !== false)) return false;
        return ['english', 'variables', 'remarks', 'stats', 'name', 'translations'].every(field =>
          JSON.stringify(candidate.snapshot?.[field]) === JSON.stringify(current.snapshot?.[field]));
      },
      capturedDroppedPromotion(filepath, candidate = this.editorDroppedCandidate) {
        if (!candidate) return null;
        if (this.localDescs.droppedConflicts?.[this.lang]?.[filepath]) throw new Error('Resolve the competing dropped copies before saving this file.');
        const current = window.WorkspaceState.droppedForFile(this.localDescs, filepath, this.lang);
        if (!this.droppedCandidateMatches(candidate, current)) throw new Error('The dropped translation changed. Reopen this file to review the current copy.');
        return { id: current.id, revision: current.revision || 0, targetSourceHash: this.sourceIdentity };
      },
      async applyRemoteDropped(records, lang = this.lang, snapshot) {
        if (lang !== this.lang) return;
        const context = this.captureCollaborationContext(), workspace = this.localDescs;
        const affected = new Set([...(records || []).map(record => record.filepath),
          ...Object.keys(workspace.dropped?.[lang] || {}), ...Object.keys(snapshot?.dropped?.[lang] || {})].filter(Boolean));
        if (snapshot) for (const field of ['dropped', 'droppedArchive', 'droppedOutbox', 'droppedAliases', 'droppedConflicts']) {
          // The client transfers a detached callback snapshot, independent of
          // its cached recovery state. Avoid copying that entire payload twice.
          if (snapshot[field] !== undefined) this.localDescs[field] = snapshot[field];
        }
        else window.WorkspaceState.acceptDropped(this.localDescs, records, { game: this.gameVersion, language: lang, acknowledge: true });
        const descriptions = this.collaborationFileIndexes().descriptions;
        const paths = [...affected].filter(path => descriptions.has(path));
        let sliceStart = Date.now();
        for (let index = 0; index < paths.length; index += 32) {
          if (this.localDescs !== workspace || !this.collaborationContextCurrent(context)) return;
          this.applyWorkspaceOverlay({ filepaths: paths.slice(index, index + 32) });
          if (Date.now() - sliceStart >= 4) { await new Promise(resolve => setTimeout(resolve, 0)); sliceStart = Date.now(); }
        }
        if (this.localDescs === workspace && this.collaborationContextCurrent(context) && paths.length) this.filterDesc({ changedFilepaths: paths });
      },
      async readImportZipIdentity(file, zip) {
        if (typeof file?.arrayBuffer !== 'function' || !window.CollaborationProtocol?.zipHash) return null;
        this._importZipIdentities ||= new WeakMap();
        let pending = this._importZipIdentities.get(file);
        if (!pending) {
          pending = window.CollaborationProtocol.zipHash(file).then(zipHash => ({ zipHash, zipSize: file.size })).catch(error => {
            if (this._importZipIdentities.get(file) === pending) this._importZipIdentities.delete(file);
            throw error;
          });
          this._importZipIdentities.set(file, pending);
        }
        const identity = await initializationTask(this, 'Verifying original ZIP identity', () => pending);
        if (zip) identity.fileCount = Object.values(zip.files || {}).filter(entry => !entry.dir).length;
        return { ...identity };
      },
      async lookupImportArchive(identity, game = this.gameVersion) {
        if (!identity || !this.cloudSignedIn || (!this.cloudCanAccessAllLanguages && this.cloudUser?.language !== this.lang) || !this._cloud?.request) return null;
        try {
          const result = await initializationTask(this, 'Checking agreed import configuration', () =>
            this._cloud.request('/v1/collaboration/archives/' + game + '/' + identity.zipHash));
          return result?.archive || result;
        } catch (error) {
          if (error.stale || (error.status && ![404, 408, 429].includes(error.status) && error.status < 500)) throw error;
          // An offline import retains its decisions; the room accepts or reconciles them on reconnect.
          return null;
        }
      },
      async importDecisionRecords(groups) {
        const protocol = window.CollaborationProtocol;
        const records = [];
        for (const group of groups || []) {
          const selected = group.options.find(option => option.id === group.selectedOptionId);
          if (!selected) throw new Error('Resolve every duplicate language block before importing.');
          records.push({ filepath: group.filepath, language: group.lang, occurrence: selected.occurrence,
            blockHash: await protocol.blockHash(selected) });
        }
        return protocol.normalizeDecisions(records);
      },
      async sourceWithImportDecisions(rawSource, decisions) {
        const source = copy(rawSource);
        const groups = this.collectDuplicateLangGroups(source);
        const records = window.CollaborationProtocol.normalizeDecisions(decisions || []);
        if (records.length !== groups.length) throw new Error('The shared import decisions do not match this ZIP.');
        for (const group of groups) {
          const record = records.find(item => item.filepath === group.filepath && item.language === group.lang);
          if (!record) throw new Error('A shared duplicate language choice is missing.');
          const selected = group.options.find(option => option.occurrence === record.occurrence);
          if (!selected || await window.CollaborationProtocol.blockHash(selected) !== record.blockHash) {
            throw new Error('A shared duplicate language choice does not match the original ZIP.');
          }
          group.selectedOptionId = selected.id;
        }
        this.applyDuplicateLangSelections(source, groups);
        return source.filter(Boolean);
      },
      async buildImportedBaseline(identity, rawSource, decisions = [], acceptedArchive) {
        if (!identity) return null;
        if (acceptedArchive && acceptedArchive.parserVersion !== 1) throw new Error('This shared import requires a different importer version.');
        const initializationSession = { run: this._workspaceInitializationRun };
        const selectedDecisions = acceptedArchive?.decisions || decisions;
        const source = await initializationTask(this, 'Applying agreed language choices', () =>
          this.sourceWithImportDecisions(rawSource, selectedDecisions), initializationSession);
        const tree = await initializationTask(this, 'Building original source baseline proofs', () =>
          window.CollaborationProtocol.buildBaselineTree(source), initializationSession);
        const archive = await initializationTask(this, 'Verifying accepted source baseline identity', async () => {
          const descriptor = await window.CollaborationProtocol.finalizeArchive({ version: 1, zipHash: identity.zipHash,
            zipSize: identity.zipSize, fileCount: identity.fileCount,
            descriptionCount: source.length, parserVersion: 1, decisions: selectedDecisions, treeRoot: tree.root });
          if (acceptedArchive && JSON.stringify(descriptor) !== JSON.stringify(await window.CollaborationProtocol.finalizeArchive(acceptedArchive))) {
            throw new Error('The local ZIP does not reproduce the shared import baseline.');
          }
          return descriptor;
        }, initializationSession);
        return { archive, source, rawSource: copy(rawSource), tree };
      },
      async reconcileImportArchive(archive) {
        if (this._reconcilingImport || this._importingSource || this.versionStorageLoading || this.editorSaving || this.navigationBusy
          || this._translationWrites || this._collabDiagnosticBatch || (this.loadingProgress > 0 && this.loadingProgress < 100)) return false;
        if (!this.importBaseline?.rawSource) throw new Error('Reimport the original upstream ZIP to apply the shared import decisions.');
        if (this.editorSessionActive ?? this.editorVisible) {
          this._collaboration?.disconnect(); this._collaboration = null; this._collabKey = '';
          this.collaborationNotice = 'Close the editor to apply the shared import decisions. Your local draft is preserved.';
          return false;
        }
        this._reconcilingImport = true;
        let finishTransition, reloadStorage = false;
        this._importReconciliationDone = new Promise(resolve => { finishTransition = resolve; });
        try {
          if (this._pendingSaves?.snapshot().jobs.length && !await this.waitForPendingSaves()) return false;
          const ctx = this.captureCollaborationContext();
          const profile = this.cloudProfileId;
          const oldBaseline = this.importBaseline, oldWorkspace = this.localDescs, oldSource = this.descs;
          const baseline = await this.buildImportedBaseline(oldBaseline.archive, oldBaseline.rawSource, [], archive);
          if ((this.editorSessionActive ?? this.editorVisible) || profile !== this.cloudProfileId
            || !this.collaborationContextCurrent(ctx) || this.importBaseline !== oldBaseline || this.localDescs !== oldWorkspace || this.descs !== oldSource) return false;
          const workspace = copy(oldWorkspace);
          window.WorkspaceState.upgradeSource(workspace, { previousSource: this.workspaceSource(), source: baseline.source,
            previousSourceHash: ctx.source, sourceHash: baseline.archive.baselineId, game: ctx.game });
          workspace.importArchive = baseline.archive;
          workspace.importRecovery ||= [];
          workspace.importRecovery.push({ sourceHash: ctx.source, at: Date.now(), reason: 'Shared import decisions', descs: copy(workspace.descs), status: copy(workspace.status) });
          const originals = new Map(oldSource.map(desc => [desc.filepath, desc]));
          const locals = new Map(workspace.descs.map(desc => [desc.filepath, desc]));
          const revisions = [];
          for (const desc of baseline.source) {
            const local = locals.get(desc.filepath), previous = originals.get(desc.filepath);
            const state = window.WorkspaceState.workspaceFile(workspace, desc, ctx.language);
            const lines = state.translations;
            const tracked = state.hasChanges;
            const status = workspace.status[desc.filepath] ||= {};
            window.WorkspaceState.setFileMetadata(status, ctx.language, {}, local);
            const replacement = makeLocalDesc(desc, ctx.language, lines, { derivedStatus: true });
            if (local) {
              replacement.translations = { ...local.translations, ...replacement.translations };
              replacement.languageStatus = { ...local.languageStatus, ...replacement.languageStatus };
              Object.assign(local, replacement);
            } else workspace.descs.push(replacement);
          }
          await window.OfflineStore.saveSourceWorkspaceWithRevisions(copy(baseline.source), workspace, revisions, ctx.game, baseline);
          if (this.editorSessionActive ?? this.editorVisible) {
            if (profile === this.cloudProfileId && this.collaborationContextCurrent({ ...ctx, client: this._collaboration })
              && this.localDescs === oldWorkspace && this.descs === oldSource) {
              this._reconciledImportReload = { context: ctx, sourceHash: baseline.archive.baselineId,
                profile, workspace: oldWorkspace, source: oldSource };
              this.collaborationNotice = 'Close the editor to apply the shared import decisions. Your local draft is preserved.';
            }
            return false;
          }
          if (profile !== this.cloudProfileId || !this.collaborationContextCurrent(ctx) || this.localDescs !== oldWorkspace || this.descs !== oldSource) {
            reloadStorage = profile === this.cloudProfileId && this.collaborationContextCurrent({ ...ctx, language: this.lang, client: this._collaboration })
              && this.localDescs === oldWorkspace && this.descs === oldSource;
            return false;
          }
          this._collaboration?.disconnect(); this._collaboration = null; this._collabKey = '';
          this.importBaseline = baseline; this.localDescs = workspace; this.sourceIdentity = baseline.archive.baselineId;
          this._workspaceSourceBaseline = baseline.source; this._workspaceBaselineIndex = null;
          this.descs = copy(baseline.source); this.applyWorkspaceOverlay(); this.clearDiagnosticScanResults(); this.filterDesc();
          this.scheduleCollaboration();
          return true;
        } finally {
          this._reconcilingImport = false;
          this._importReconciliationDone = null;
          finishTransition();
          if (reloadStorage && !this.versionChooserVisible) this.loadVersionedStorage().catch(error => this.collaborationFailure(error));
        }
      },
      reconciledImportReloadCurrent(request) {
        return !!request && !this._collaborationDisposed && this._reconciledImportReload === request
          && request.profile === this.cloudProfileId && this.localDescs === request.workspace && this.descs === request.source
          && this.collaborationContextCurrent({ ...request.context, client: this._collaboration });
      },
      queueReconciledImportReload() {
        if (!this._reconciledImportReload || this._reconciledImportReloadTimer || this._collaborationDisposed
          || (this.editorSessionActive ?? this.editorVisible) || this.versionChooserVisible) return;
        this._reconciledImportReloadTimer = setTimeout(() => {
          this._reconciledImportReloadTimer = null;
          this.resumeReconciledImportReload().catch(() => {});
        }, 0);
      },
      resumeReconciledImportReload() {
        const request = this._reconciledImportReload;
        if (request && this._reconciledImportReloadPending?.request === request) return this._reconciledImportReloadPending.promise;
        const pending = { request, promise: null };
        this._reconciledImportReloadPending = pending;
        pending.promise = this.resumeReconciledImportReloadRequest(request).catch(error => {
          if (this.reconciledImportReloadCurrent(request) && !error.stale) {
            request.failure = error.message || String(error);
            this.collaborationFailure(error);
          }
          throw error;
        }).finally(() => {
          if (this._reconciledImportReloadPending === pending) this._reconciledImportReloadPending = null;
        });
        return pending.promise;
      },
      async resumeReconciledImportReloadRequest(request) {
        const current = () => this.reconciledImportReloadCurrent(request);
        if (!current()) {
          if (this._reconciledImportReload === request) this._reconciledImportReload = null;
          return false;
        }
        if ((this.editorSessionActive ?? this.editorVisible) || this.versionChooserVisible || this.inlineTransitionBusy
          || this.editorSaving || this.navigationBusy || this._reconcilingImport || this._importingSource) return false;
        if (this.flushEditorDraft && !await this.flushEditorDraft()) return false;
        if (!current() || (this.editorSessionActive ?? this.editorVisible)) return false;
        if (this._pendingSaves?.snapshot().jobs.length && !await this.waitForPendingSaves()) return false;
        if (!current() || (this.editorSessionActive ?? this.editorVisible)) return false;
        if (window.OfflineStore.activateVersion) await window.OfflineStore.activateVersion({ accountId: request.context.account
          || request.profile || 'guest', game: request.context.game, branchId: request.context.branchId || 'default', sourceHash: request.sourceHash });
        if (!current() || (this.editorSessionActive ?? this.editorVisible)) return false;
        await this.loadVersionedStorage();
        if (this._reconciledImportReload !== request) return false;
        this._reconciledImportReload = null;
        if (this.sourceIdentity === request.sourceHash
          && (this.collaborationNotice === 'Close the editor to apply the shared import decisions. Your local draft is preserved.'
            || this.collaborationNotice === request.failure)) this.collaborationNotice = '';
        return this.sourceIdentity === request.sourceHash;
      },
      initializePendingSaves() {
        if (this._pendingSaves || !window.PendingSaves || !window.SaveWorkerClient) return this._pendingSaves;
        this._saveWorker = window.SaveWorkerClient.create({ store: window.OfflineStore });
        this._pendingSaves = window.PendingSaves.create({
          save: (batch, job) => {
            const client = job.context?.client;
            const write = async () => {
              const ack = await this._saveWorker.save(batch);
              client?.acceptLocalSave(batch, ack);
              return ack;
            };
            return client ? client.withLocalWrite(write) : write();
          },
          onChange: state => { this.pendingLocalSaves = state.pending; this.localSaveError = state.error || ''; this.updateLeaveProtection(); },
          onCommit: async (job, ack) => {
            if (this.collaborationContextCurrent(job.context)) {
              if (job.batch.deferDisplay) {
                const statuses = ack.duplicate ? ack.statuses || {} : job.batch.statuses || {};
                for (const [filepath, status] of Object.entries(statuses)) {
                  this.localDescs.status[filepath] = window.WorkspaceState.setFileMetadata(
                    this.localDescs.status[filepath] || {}, job.batch.language, status);
                }
              }
              const files = (ack.files || job.batch.files).map(file => this._pendingSaves.overlay(this.pendingSaveScope(), file.filepath) || file);
              const changed = files.some(file => {
                const desc = this.getDescByFilepath(file.filepath);
                return desc && (!arrayEquals(desc.translations[job.batch.language] || [], file.translations)
                  || !!desc.needsReview !== !!file.needsReview || !!desc.hasChanges !== !!file.trackedForExport);
              });
              if (changed) this.applyCollaborationFiles(files, job.batch.language);
              if (job.batch.resetStaging) for (const file of job.batch.files) this.inlineDraftFindings = { ...this.inlineDraftFindings,
                [file.filepath]: (this.inlineDraftFindings?.[file.filepath] || []).filter(finding => !finding.submissionReset) };
            }
            await job.onCommitted?.(ack);
            // Synchronization starts only after workspace, history and outbox commit.
            if (this.collaborationContextCurrent(job.context) && this.cloudSignedIn && this.cloudUser?.id
              && (this.cloudCanAccessAllLanguages || this.cloudUser.language === job.batch.language)
              && job.context.client && job.context.client.key === job.batch.collaboration?.key) {
              job.context.client.retry().catch(error => this.collaborationFailure(error));
            }
          },
          onError: async (job, error) => {
            if (job.durable || !window.PendingSaves.requiresReview(error)) return;
            // Retain a reviewable checkpoint even when Save went directly to
            // its submission journal without creating a recovery draft first.
            await window.OfflineStore.updateSaveSubmission(job.batch, { state: 'review',
              error: { code: error.code, message: error.message } });
            try {
              if (this.collaborationContextCurrent(job.context)) this.showSaveSubmissionReview({ batch: job.batch, error });
              await job.onRejected?.(error);
              if (!job.batch.resetStaging && this.collaborationContextCurrent(job.context)) await this.loadEditorDrafts?.();
            } finally {
              // Durable review evidence permits a fresh decision even if an
              // editor callback or draft listing could not finish.
              this._pendingSaves.discardRejectedSubmission(job.id);
            }
          },
        });
        return this._pendingSaves;
      },
      editorDraftNeedsLeaveProtection() {
        const active = this.editorSessionActive ?? this.editorVisible;
        // Older consumers keep the original in-memory draft protection. The
        // shared draft runtime can distinguish retained local text from typing
        // that has not reached its IndexedDB record yet.
        if (typeof this.flushEditorDraft !== 'function') return !!active && this.editorHaveChanges();
        const session = this._draftSession;
        if (this.draftWritePending || this._draftTimer != null || session?.pendingRecord || session?.writeError) return true;
        for (const retained of this._retainedDraftSessions?.values() || []) {
          if (retained.pendingRecord || retained.writeError) return true;
        }
        if (!active || !session || this.editorLoading || this.editorLoadError || this.editorCompareActive) return false;
        if (!session.record) return this.editorHaveChanges();
        if (typeof this.serializeEditorTranslations !== 'function') return this.editorHaveChanges();
        const current = JSON.stringify(this.serializeEditorTranslations());
        return ![session.record, ...(session.record.conflicts || [])]
          .some(record => JSON.stringify(record.translations) === current);
      },
      updateLeaveProtection() {
        if (!window.addEventListener) return;
        this._pendingSaveBeforeUnload ||= event => {
          if (!this.pendingLocalSaves && !this.editorDraftNeedsLeaveProtection()) return;
          event.preventDefault(); event.returnValue = 'Unsaved translations';
        };
        window.removeEventListener('beforeunload', this._pendingSaveBeforeUnload);
        if (this.pendingLocalSaves || (this.editorSessionActive ?? this.editorVisible) || this.editorDraftNeedsLeaveProtection()) {
          window.addEventListener('beforeunload', this._pendingSaveBeforeUnload);
        }
      },
      async retryPendingSaves() {
        try { await this._pendingSaves?.retry(); }
        catch (_) { /* The retained queue displays the actionable failure. */ }
      },
      downloadPendingSaves() {
        const jobs = this._pendingSaves?.snapshot().jobs || [];
        const recovery = { format: 'sdeditor-pending-edits-v1', savedAt: new Date().toISOString(), saves: jobs.map(job => job.batch) };
        saveAs(new Blob([JSON.stringify(recovery, null, 2)], { type: 'application/json' }), 'SDEditor_pending_edits.json');
      },
      async waitForPendingSaves() {
        try { await this._pendingSaves?.drain(); return true; }
        catch (_) { return false; }
      },
      pendingSaveScope() {
        return { game: this.gameVersion, branchId: this.branchId || 'default', language: this.lang, sourceHash: this.sourceIdentity, accountId: this.cloudUser?.id || '' };
      },
      async journalPendingSave(batch, context) {
        // Capture the workspace before the journal write yields; a later
        // account/version switch must never retarget the submitted command.
        const captured = window.OfflineStore.captureWorkspaceScope?.(batch);
        if (captured) { batch.workspaceScope = copy(captured); batch.branchId = captured.branchId; }
        const record = await window.OfflineStore.putSaveSubmission(copy(batch));
        const job = this._pendingSaves.enqueue(record.batch, { context });
        job.journaled = true;
        return job;
      },
      async recoverPendingSaves() {
        if (this.testMode || !this.offlineStoreReady || this.versionStorageLoading || this._importingSource
          || this._reconcilingImport || !this.sourceLoaded || !this.sourceIdentity || !window.OfflineStore?.listSaveSubmissions) return;
        const context = this.captureCollaborationContext(), scope = this.pendingSaveScope();
        const key = window.PendingSaves?.scopeKey(scope);
        if (!key || this._recoveredSaveScope === key) return;
        if (this._saveRecovery?.key === key) return this._saveRecovery.promise;
        const queue = this.initializePendingSaves();
        if (!queue) return;
        const release = queue.hold(), recovery = { key };
        recovery.promise = (async () => {
          try {
            const records = await window.OfflineStore.listSaveSubmissions(scope);
            if (!this.collaborationContextCurrent(context)) return;
            for (const record of records) {
              if (window.PendingSaves.scopeKey(record.batch) !== key) continue;
              if (record.state === 'review') {
                this.showSaveSubmissionReview(record);
                continue;
              }
              const job = queue.enqueue(record.batch, { context }); job.journaled = true; job.recovered = true;
            }
            this._recoveredSaveScope = key;
          } catch (error) {
            if (this.collaborationContextCurrent(context)) {
              this.cloudStorageError = 'Could not recover pending local saves. ' + error.message;
              this.collaborationNotice = this.cloudStorageError;
            }
            throw error;
          } finally { release(); if (this._saveRecovery === recovery) this._saveRecovery = null; }
        })();
        this._saveRecovery = recovery;
        return recovery.promise;
      },
      showSaveSubmissionReview(record) {
        const advice = record.batch.resetStaging
          ? 'Review the current saved translation and confirm deletion again.'
          : record.error?.code === 'DROPPED_PROMOTION_CHANGED'
          ? 'Open the full editor to review the current Dropped translation before saving again.'
          : 'Open Local drafts to review this submitted translation.';
        for (const file of record.batch.files) this.inlineDraftFindings = { ...this.inlineDraftFindings,
          [file.filepath]: [{ level: 'error', deferredSave: true, ...(record.batch.resetStaging ? { submissionReset: true } : {}),
            message: file.filepath + ': ' + [record.error?.message, advice].filter(Boolean).join(' ') }] };
      },
      pendingDraftSaveFor(filepath) {
        if (!this._pendingSaves || !window.PendingSaves) return null;
        const scope = window.PendingSaves.scopeKey(this.pendingSaveScope());
        return this._pendingSaves.snapshot().jobs.find(job => job.batch.deferDisplay
          && window.PendingSaves.scopeKey(job.batch) === scope && job.batch.files.some(file => file.filepath === filepath)) || null;
      },
      markCollaborationActivity(now = Date.now()) {
        this._collabActivityAt = now;
        if (this._collabAway) this.updateCollaborationActivity(now);
      },
      updateCollaborationActivity(now = Date.now()) {
        this._collabAway = !!document.hidden || now - (this._collabActivityAt ?? now) >= 120000;
        this._collaboration?.setAway?.(this._collabAway);
      },
      rebaseEditorAfterCommit(accepted, { draftBefore, submittedTranslations, savedIndexes, baseBefore, originalsBefore, refresh = true } = {}) {
        const indexes = savedIndexes == null ? null : new Set(savedIndexes);
        const base = copy(accepted);
        const originals = [];
        let typedDuringSave = false;
        this.editorBlocks.forEach((block, index) => {
          if (block.isTable) this.syncEditorBlockFromTableColumns(block);
          const draft = block.translation ?? '';
          const changedDuringSave = draft !== (draftBefore[index] ?? '');
          const submitted = indexes === null || indexes.has(index);
          const wasDirty = (draftBefore[index] ?? '') !== (originalsBefore?.[index] ?? this.editorOriginalTranslations[index] ?? '');
          const retainDraft = changedDuringSave || (!submitted && wasDirty);
          typedDuringSave ||= changedDuringSave;
          const raw = accepted.translations[index] ?? '';
          const acceptedTable = this.isTableText(block.english) || this.isTableText(raw);
          const acceptedMultiline = this.isMultilineText(block.english) || this.isMultilineText(raw);
          const display = acceptedTable || acceptedMultiline ? this.decodeEscapedNewlines(raw) : raw;
          originals.push(display);
          if (retainDraft) {
            // A newly typed value was authored against the submitted value, not
            // an unseen remote merge. Unsubmitted drafts keep their older base.
            base.translations[index] = submitted ? submittedTranslations[index]
              : (baseBefore?.translations?.[index] ?? this.encodeNewlines(originalsBefore?.[index] ?? this.editorOriginalTranslations[index] ?? ''));
          } else {
            block.translation = display;
            block.isTable = acceptedTable; block.isMultiline = acceptedMultiline;
            if (block.isTable) this.rebuildEditorTableColumnsFromStrings(block);
            else block.tableColumns = [];
            block.translationReplace = ''; block.words = [];
          }
        });
        this.editorOriginalTranslations = originals;
        this._editorCollabBase = this._collaboration ? base : undefined;
        // A closing editor needs its saved baseline, but not another dictionary
        // lookup and preview render. A newly typed draft still needs both.
        if (refresh || typedDuringSave) {
          this.editorBlocks.forEach((block, index) => this.refreshEditorBlockMeta(block, index));
          this.refreshEditorHLter(); this.refreshGamePreview();
        }
        return { typedDuringSave };
      },
      collaborationFile(desc, lang = this.lang) {
        const modern = this.localDescs?.stagedVersion >= 1;
        const baseline = modern ? this.workspaceSourceFile(desc.filepath) : null;
        const state = baseline ? window.WorkspaceState.workspaceFile(this.localDescs, baseline, lang) : desc;
        return { filepath: desc.filepath, translations: [...(baseline ? state.translations : desc.translations?.[lang] || [])],
          // Older servers use these wire fields; current workspace status comes
          // exclusively from staged records, never from persisted booleans.
          needsReview: modern ? false : !!desc.needsReview, trackedForExport: !!state.hasChanges };
      },
      captureCollaborationContext() {
        return { game: this.gameVersion, branchId: this.branchId || 'default', language: this.lang, source: this.sourceIdentity, account: this.cloudUser?.id || '',
          assignmentVersion: this.cloudUser?.assignmentVersion, assignedLanguage: this.cloudUser?.language, role: this.cloudUser?.role,
          allLanguagesAccess: this.cloudCanAccessAllLanguages, client: this._collaboration };
      },
      collaborationContextCurrent(ctx) {
        return ctx.game === this.gameVersion && ctx.language === this.lang && ctx.source === this.sourceIdentity
          && (ctx.branchId || 'default') === (this.branchId || 'default')
          && ctx.account === (this.cloudUser?.id || '') && ctx.assignmentVersion === this.cloudUser?.assignmentVersion
          && ctx.assignedLanguage === this.cloudUser?.language
          && ctx.role === this.cloudUser?.role && ctx.allLanguagesAccess === this.cloudCanAccessAllLanguages && ctx.client === this._collaboration;
      },
      scheduleCollaboration() {
        // Invalidate an old room immediately, before the debounce or any network await.
        const eligible = this.cloudSignedIn && !!this.cloudUser?.id && !!this.lang
          && (this.cloudCanAccessAllLanguages || this.cloudUser?.language === this.lang) && this.sourceLoaded;
        const key = eligible ? [this.cloudUser.id, this.cloudUser.assignmentVersion, this.cloudUser.role, this.cloudCanAccessAllLanguages, this.gameVersion, this.branchId || 'default', this.lang, this.sourceIdentity].join('|') : '';
        if (this._collabKey && this._collabKey !== key) {
          this._collaboration?.disconnect(); this._collaboration = null; this._collabKey = '';
          this._collabFileIndexes = null;
          this.clearBrowserWork?.('collaboration');
          this.collabReceiveState?.({ status: 'Local workspace', peers: [], conflicts: [], pending: 0, connected: false });
        }
        clearTimeout(this._collabStartTimer);
        this._collabStartTimer = setTimeout(() => this.recoverPendingSaves()
          .then(() => this.initializeCollaboration()).catch(error => this.collaborationFailure(error)), 30);
      },
      collaborationFailure(error) {
        if (error?.stale) return;
        this.collaborationNotice = error?.message || String(error);
        this.collabReceiveState?.({ ...(this._collaboration?.snapshot({ includeFiles: false }) || {}), status: 'Saved locally · collaboration unavailable', error: this.collaborationNotice });
      },
      collaborationInitializationKey() {
        return [this.cloudUser?.id, this.cloudUser?.assignmentVersion, this.cloudUser?.role, this.cloudCanAccessAllLanguages,
          this.gameVersion, this.branchId || 'default', this.lang, this.sourceIdentity].join('|');
      },
      initializeCollaboration() {
        const key = this.collaborationInitializationKey();
        // Source watchers and an explicit initialization gate must await the
        // same first connection. A newer scope starts independently; only its
        // own completion can clear the active promise.
        const previous = this._collabInitialization;
        if (previous?.key === key && previous.source === this.descs && previous.workspace === this.localDescs
          && previous.client === this._collaboration) return previous.promise;
        const request = { key, source: this.descs, workspace: this.localDescs, client: this._collaboration };
        const pending = this.initializeCollaborationForScope(request);
        const tracked = pending.finally(() => {
          if (this._collabInitialization?.promise === tracked) this._collabInitialization = null;
        });
        request.promise = tracked;
        this._collabInitialization = request;
        return tracked;
      },
      async initializeCollaborationForScope(request) {
        const current = () => request.key === this.collaborationInitializationKey() && request.source === this.descs
          && request.workspace === this.localDescs && request.client === this._collaboration;
        if (window.OfflineStore?.listSaveSubmissions) await initializationTask(this, 'Recovering queued local saves', () => this.recoverPendingSaves());
        if (!current()) return;
        if (this.testMode || !this.offlineStoreReady || this.versionStorageLoading || this._importingSource || this._reconcilingImport || !this.sourceLoaded || !this.sourceIdentity || !this._cloud
          || this.pendingDuplicateLangImport?.mode === 'update' || !this.cloudSignedIn || !this.lang || (!this.cloudCanAccessAllLanguages && this.cloudUser?.language !== this.lang) || !window.CollaborationSync) return;
        if (this._pendingSaves?.snapshot().jobs.length && !await this.waitForPendingSaves()) return;
        if (!current()) return;
        if (this._importingSource || this._reconcilingImport || this.pendingDuplicateLangImport?.mode === 'update') return;
        const key = [this.cloudUser.id, this.cloudUser.assignmentVersion, this.cloudUser.role, this.cloudCanAccessAllLanguages, this.gameVersion, this.branchId || 'default', this.lang, this.sourceIdentity].join('|');
        if (this._collabKey === key && this._collaboration) return;
        this._collaboration?.disconnect();
        const ctx = { accountId: this.cloudUser.id, game: this.gameVersion, branchId: this.branchId || 'default', language: this.lang };
        const cloud = this._cloud;
        const openFile = (this.editorSessionActive ?? this.editorVisible) ? this.collaborationFile(this.editorCurrentEditingDesc) : null;
        const originalBase = copy(this._editorCollabBase);
        let client, managedContext;
        client = new window.CollaborationSync.Client({ store: window.OfflineStore, apiBase: cloud.apiBase, allowLegacySeed: false,
          presenceEnabled: () => !this.versionChooserVisible,
          context: () => cloud.context(), request: (path, options, captured) => cloud.request(path, options, captured),
          onChange: state => {
            if (this._collaboration !== client) return;
            this.collabReceiveState?.(state);
            if (state.connected && state.pending === 0 && !state.conflicts?.length) {
              if (['Saved locally · Pending sync', 'Resolution saved locally · Pending sync'].includes(this.collaborationNotice)) this.collaborationNotice = '';
              else if (/^Imported \d+ translated files · Pending sync$/.test(this.collaborationNotice)) this.collaborationNotice = this.collaborationNotice.replace(' · Pending sync', '.');
            }
          },
          onStatus: status => { if (this._collaboration === client) this.collabReceiveState?.({ ...client.snapshot({ includeFiles: false }), status: status?.message ?? status, error: status?.error ? status.message : '' }); },
          onWork: work => { if (this._collaboration === client) this.setBrowserWork?.('collaboration', work); },
          onManagedVersionChanged: () => { if (this._collaboration === client && managedContext && this.collaborationContextCurrent(managedContext)) this.refreshManagedVersions?.(); },
          onRemote: files => { if (this._collaboration === client) return this.receiveCollaborationFiles(files, ctx.language); },
          onRemoteDropped: (records, snapshot) => { if (this._collaboration === client) return this.applyRemoteDropped(records, ctx.language, snapshot); },
          onEditingConflict: ({ filepath }) => {
            const isCurrent = () => this._collaboration === client && (this.editorSessionActive ?? this.editorVisible) && this.editorCurrentEditingDesc?.filepath === filepath;
            if (isCurrent()) return this.claimCollaborationFile(filepath, false, isCurrent);
          },
        });
        request.client = client;
        this._collaboration = client; this._collabKey = key;
        managedContext = this.captureCollaborationContext();
        this.updateCollaborationActivity();
        const initializationTaskToken = this.beginWorkspaceInitializationTask?.('Preparing cached shared translations');
        try {
          const activeSource = this.descs, activeWorkspace = this.localDescs;
          const source = Vue.toRaw ? Vue.toRaw(activeSource) : activeSource;
          const workspace = Vue.toRaw ? Vue.toRaw(activeWorkspace) : activeWorkspace, files = [];
          const context = this.captureCollaborationContext();
          const selectedSource = this.importBaseline && workspace.stagedVersion >= 1
            ? Object.keys(workspace.staged?.[ctx.language] || {}).map(path => this.collaborationFileIndexes().descriptions.get(path)).filter(Boolean)
            : source;
          let sliceStart = Date.now();
          this.setBrowserWork?.('collaboration', { key: 'source', label: 'Preparing collaboration data', active: true });
          try {
            for (let index = 0; index < selectedSource.length; index++) {
              files.push(this.collaborationFile(selectedSource[index]));
              if (index % 64 === 63 && Date.now() - sliceStart >= 8) {
                await new Promise(resolve => setTimeout(resolve, 0)); sliceStart = Date.now();
                if (!this.collaborationContextCurrent(context) || this.descs !== activeSource || this.localDescs !== activeWorkspace) throw Object.assign(new Error('Collaboration workspace changed.'), { stale: true });
              }
            }
          } finally { if (this._collaboration === client) this.setBrowserWork?.('collaboration', { key: 'source', active: false }); }
          if (!this.collaborationContextCurrent(context) || this.descs !== activeSource || this.localDescs !== activeWorkspace) throw Object.assign(new Error('Collaboration workspace changed.'), { stale: true });
          await client.connect({ ...ctx, source, deferRemote: typeof client.startRemote === 'function',
            ...(this.importBaseline ? { archive: this.importBaseline.archive, baselineSource: this.importBaseline.source, baselineTree: this.importBaseline.tree } : {}),
            files, workspace });
          this.finishWorkspaceInitializationTask?.(initializationTaskToken, {
            error: client.lastError,
            cancelled: this._collaboration !== client,
          });
        } catch (error) {
          this.finishWorkspaceInitializationTask?.(initializationTaskToken, { error, cancelled: !!error.stale || this._collaboration !== client });
          if (await this.handleCollaborationInitializationError(client, error)) return;
          throw error;
        }
        if (this._collaboration !== client) return;
        client.select(this.selectedFilepath);
        if (this.editorSessionActive ?? this.editorVisible) {
          const filepath = this.editorCurrentEditingDesc.filepath;
          // The editor may have opened or changed files while preparation was
          // yielding. Keep the ancestor paired with its visible draft.
          this._editorCollabBase = this._editorCollabBase
            || (openFile?.filepath === filepath ? originalBase || openFile : null)
            || client.fileBase(filepath);
          await this.claimCollaborationFile(filepath, false,
            () => this._collaboration === client && (this.editorSessionActive ?? this.editorVisible) && this.editorCurrentEditingDesc?.filepath === filepath);
        }
        if (typeof client.startRemote === 'function') {
          const context = this.captureCollaborationContext();
          const start = async () => {
            if (!this.collaborationContextCurrent(context) || this._workspaceBackgroundDisposed) return;
            try { await client.startRemote(); }
            catch (error) {
              if (!this.collaborationContextCurrent(context) || error.stale) return;
              if (!await this.handleCollaborationInitializationError(client, error)) this.collaborationFailure(error);
            }
          };
          if (!this.queueWorkspaceBackground?.('shared-translations', start, error => this.collaborationFailure(error))) {
            setTimeout(start, 0);
          }
        }
      },
      async handleCollaborationInitializationError(client, error) {
        if (this._collaboration !== client || error.stale) return true;
        if (error.code === 'ARCHIVE_CONFIG_MISMATCH' && error.archive) {
          if (!await this.reconcileImportArchive(error.archive) && this._collaboration === client) {
            client.disconnect(); this._collaboration = null; this._collabKey = '';
          }
          return true;
        }
        // A failed remote connection retains its prepared local room/outbox.
        // Disconnect only a client that never completed local preparation.
        if (!client.room?.()) {
          client.disconnect(); this._collaboration = null; this._collabKey = '';
        }
        return false;
      },
      async collabRetry(options) {
        if (this._importingSource || this.pendingDuplicateLangImport?.mode === 'update') return;
        // The accepted baseline is already durable. Keep the old editor scope
        // until it closes, and never reconnect it while its reload is pending.
        if (this._reconciledImportReload) return this.resumeReconciledImportReload();
        if (!this._collaboration) return this.initializeCollaboration();
        return this._collaboration.sync(options);
      },
      collaborationFileIndexes() {
        let index = this._collabFileIndexes;
        if (!index || index.source !== this.descs || index.local !== this.localDescs.descs
          || index.sourceLength !== this.descs.length || index.localLength !== this.localDescs.descs.length) {
          index = this._collabFileIndexes = { source: this.descs, local: this.localDescs.descs,
            sourceLength: this.descs.length, localLength: this.localDescs.descs.length,
            descriptions: new Map(this.descs.map(desc => [desc.filepath, desc])),
            locals: new Map(this.localDescs.descs.map(desc => [desc.filepath, desc])) };
        }
        return index;
      },
      async receiveCollaborationFiles(files, lang = this.lang) {
        if (lang !== this.lang || !files?.length) return;
        if (files.length < 100) return this.applyCollaborationFiles(files, lang);
        const context = this.captureCollaborationContext();
        const batchState = { changedFilepaths: [], displayChanged: false };
        this.setBrowserWork?.('collaboration', { key: 'remote', label: 'Applying shared translations', active: true });
        try {
          await new Promise(resolve => {
            if (typeof requestAnimationFrame === 'function' && !document.hidden) requestAnimationFrame(() => setTimeout(resolve, 0));
            else setTimeout(resolve, 0);
          });
          let sliceStart = Date.now();
          for (let index = 0; index < files.length; index += 32) {
            if (!this.collaborationContextCurrent(context)) return;
            this.applyCollaborationFiles(files.slice(index, index + 32), lang, batchState);
            if (Date.now() - sliceStart >= 4) { await new Promise(resolve => setTimeout(resolve, 0)); sliceStart = Date.now(); }
          }
          if (!this.collaborationContextCurrent(context)) return;
          const diagnostics = batchState.changedFilepaths.length ? this.updateScannedDescDiagnostics?.(batchState.changedFilepaths) : [];
          if (batchState.displayChanged) this.filterDesc({ changedFilepaths: Array.isArray(diagnostics)
            ? [...files.map(file => file.filepath), ...diagnostics] : null });
        } finally {
          if (this._collaboration === context.client) this.setBrowserWork?.('collaboration', { key: 'remote', active: false });
        }
      },
      applyCollaborationFiles(files, lang = this.lang, batchState = null) {
        if (lang !== this.lang || !files?.length) return;
        this.ensureLocalDescsReady();
        if ((this.editorSessionActive ?? this.editorVisible) && !this._editorCollabBase && this.editorCurrentEditingDesc?.filepath) {
          const desc = this.editorCurrentEditingDesc;
          const known = this._collaboration?.fileBase?.(desc.filepath);
          this._editorCollabBase = { ...this.collaborationFile(desc, lang), revision: known?.revision || 0 };
        }
        const changedFilepaths = batchState?.changedFilepaths || [];
        let displayChanged = false;
        const batch = this._collabDiagnosticBatch;
        const indexes = this.collaborationFileIndexes(), { descriptions, locals } = indexes;
        window.WorkspaceState.initializeWorkspace(this.localDescs, { source: this.workspaceSource(),
          sourceHash: this.sourceIdentity, game: this.gameVersion, language: lang });
        for (let file of files || []) {
          // A remote acknowledgement or an older local save cannot hide a newer
          // edit that is still waiting for its local transaction.
          file = this._pendingSaves?.overlay(this.pendingSaveScope(), file.filepath) || file;
          const desc = descriptions.get(file.filepath);
          if (!desc) continue;
          const original = this.workspaceSourceFile(file.filepath) || desc;
          if (file.needsReview) {
            if (!window.WorkspaceState.droppedForFile(this.localDescs, file.filepath, lang)
              && (file.translations || []).some(text => String(text).trim())) {
              window.WorkspaceState.dropTranslation(this.localDescs, original, lang, {
                game: this.gameVersion, translations: file.translations, originSourceHash: '', originSourceAvailable: false,
                targetSourceHash: this.sourceIdentity, reason: 'Recovered dropped translation',
              });
            }
          } else if (file.stagingReset && !file.trackedForExport) {
            if (this.localDescs.staged?.[lang]) delete this.localDescs.staged[lang][file.filepath];
          } else if (file.trackedForExport || file.revision > 0) {
            const staged = this.localDescs.staged?.[lang]?.[file.filepath];
            window.WorkspaceState.stageTranslation(this.localDescs, file, lang,
              { source: original, sourceHash: this.sourceIdentity, game: this.gameVersion,
                savedAt: staged && arrayEquals(staged.translations, file.translations) ? staged.savedAt : undefined });
          }
          const state = window.WorkspaceState.workspaceFile(this.localDescs, original, lang);
          const translationChanged = !arrayEquals(desc.translations[lang] || [], state.translations);
          const needsReview = state.needsReview, hasChanges = state.hasChanges, isMissing = state.isMissing;
          const metadataChanged = desc.needsReview !== needsReview || desc.hasChanges !== hasChanges
            || desc.isMissing !== isMissing || desc.isRevised !== state.isRevised || desc.isDropped !== state.isDropped;
          const local = locals.get(file.filepath);
          const localChanged = !local || !arrayEquals(local.translations?.[lang] || [], state.translations)
            || !arrayEquals(local.translations?.English || [], desc.translations.English);
          if (!translationChanged && !metadataChanged && !localChanged) continue;
          displayChanged ||= translationChanged || metadataChanged;
          if (translationChanged) {
            const expected = batch?.expected.get(file.filepath);
            if (expected && this.collaborationContextCurrent(batch.context)
              && JSON.stringify(expected) === JSON.stringify(state.translations)) batch.touched = true;
            else changedFilepaths.push(file.filepath);
          }
          if (translationChanged) desc.translations[lang] = [...state.translations];
          if (metadataChanged) { desc.needsReview = needsReview; desc.hasChanges = hasChanges; desc.isMissing = isMissing; desc.isRevised = state.isRevised; desc.isDropped = state.isDropped; }
          if (local && localChanged) updateLocalDesc(local, desc, lang, state.translations, { derivedStatus: true });
          else if (!local) {
            const added = makeLocalDesc(desc, lang, state.translations, { derivedStatus: true });
            this.localDescs.descs.push(added); locals.set(file.filepath, added);
          }
        }
        indexes.localLength = this.localDescs.descs.length;
        if (batchState) { batchState.displayChanged ||= displayChanged; return; }
        const refreshedDiagnostics = changedFilepaths.length ? this.updateScannedDescDiagnostics?.(changedFilepaths) : [];
        // editorBlocks and its captured base remain untouched until explicit save/reopen.
        if (displayChanged) this.filterDesc({ changedFilepaths: Array.isArray(refreshedDiagnostics)
          ? [...(files || []).map(file => file.filepath), ...refreshedDiagnostics] : null });
      },
      async claimCollaborationFile(filepath, automatic = false, isCurrent = () => true) {
        const context = this.captureCollaborationContext();
        const client = this._collaboration;
        if (!client) return true;
        // Reconnection and late collaboration initialization also claim files.
        // Serialize them with row/editor claims so obsolete responses release
        // their own claim before the next session acquires one.
        const previous = this._collaborationClaimPending;
        let release;
        const pending = this._collaborationClaimPending = new Promise(resolve => { release = resolve; });
        try {
          if (previous) await previous;
          if (!this.collaborationContextCurrent(context) || !isCurrent()) return false;
          if (automatic && client.isEditing(filepath)) return false;
          const result = await client.claim(filepath, { force: false });
          if (!this.collaborationContextCurrent(context)) return false;
          if (result.stale) return false;
          if (!isCurrent()) { client.leaveEdit(); return false; }
          if (result.granted) return true;
          if (automatic) return false;
          const names = (result.peers || []).map(peer => peer.name).join(', ') || 'Another translator';
          const confirmed = await this.appConfirm(`${names} is editing this file. Edit anyway?`, {
            title: 'File already being edited', confirmLabel: 'Edit anyway', danger: true,
          });
          if (!this.collaborationContextCurrent(context)) return false;
          if (!isCurrent()) { client.leaveEdit(); return false; }
          if (!confirmed) return false;
          const forced = await client.claim(filepath, { force: true });
          if (!this.collaborationContextCurrent(context)) return false;
          if (forced.stale) return false;
          if (!isCurrent()) { client.leaveEdit(); return false; }
          return !!forced.granted;
        } finally {
          release();
          if (this._collaborationClaimPending === pending) this._collaborationClaimPending = null;
        }
      },
      async persistStagedDeletion(desc, base, ctx = this.captureCollaborationContext(), onCommitted) {
        if (this._reconcilingImport || this._importingSource || !this.collaborationContextCurrent(ctx)) return { stale: true };
        this._translationWrites = (this._translationWrites || 0) + 1;
        try {
          if (!await this.waitForPendingSaves()) throw new Error('Retry the pending local saves before deleting this staged translation.');
          if (!this.collaborationContextCurrent(ctx)) return { stale: true };
          const source = this.workspaceSourceFile(desc.filepath);
          if (!source) throw new Error('The original ZIP translation is unavailable. Reimport the original ZIP before deleting this staged translation.');
          const translations = [...(source.translations?.[ctx.language] || [])];
          while (translations.length < source.translations.English.length) translations.push('');
          const file = { filepath: desc.filepath, translations, needsReview: false, trackedForExport: false, stagingReset: true, revision: Number(base.revision) || 0 };
          const now = Date.now();
          const metadata = { filepath: desc.filepath, filename: desc.filename, filedir: desc.filedir, lang: ctx.language, sourceHash: ctx.source };
          const bases = { [desc.filepath]: copy(base) };
          const batch = { jobId: crypto.randomUUID(), game: ctx.game, branchId: ctx.branchId || 'default', language: ctx.language, sourceHash: ctx.source, accountId: ctx.account,
            resetStaging: true, origin: 'delete_staged', deferDisplay: true, bases, files: [file],
            descriptions: [makeLocalDesc(source, ctx.language, translations, { derivedStatus: true })],
            statuses: { [desc.filepath]: window.WorkspaceState.setFileMetadata(copy(this.localDescs.status?.[desc.filepath] || {}), ctx.language, { lastEditedAt: now }) },
            revisions: [
              { ...metadata, savedAt: now - 1, note: 'Before delete staged translation', translations: [...base.translations], isMissing: computeIsMissing(source.translations.English.length, base.translations) },
              { ...metadata, savedAt: now, note: 'Delete staged translation', translations, isMissing: computeIsMissing(source.translations.English.length, translations) },
            ],
            ...(ctx.client?.room() ? { collaboration: { key: ctx.client.key, identity: copy(ctx.client.room().identity), bases, origin: 'delete_staged' } } : {}),
          };
          if (this.testMode) {
            const current = this.collaborationFile(desc, ctx.language);
            if (!current.trackedForExport || !arrayEquals(current.translations, base.translations)) {
              throw Object.assign(new Error('The staged translation changed. Review it before deleting again.'), { code: 'DELETE_STAGED_BASE_CHANGED' });
            }
            delete this.localDescs.staged[ctx.language][desc.filepath];
            this.applyCollaborationFiles([file], ctx.language);
            return { status: 'local', durable: true };
          }
          const queue = this.initializePendingSaves();
          if (queue) {
            const job = await this.journalPendingSave(batch, ctx);
            job.onCommitted = onCommitted;
            try { await queue.drain(); }
            catch (error) {
              if (!job.durable && window.PendingSaves.requiresReview(error)) {
                await window.OfflineStore.updateSaveSubmission(job.batch, { state: 'review', error: { code: error.code, message: error.message } });
                if (this.collaborationContextCurrent(ctx)) this.showSaveSubmissionReview({ batch: job.batch, error });
                queue.discardRejectedSubmission?.(job.id);
              }
              throw error;
            }
            return { status: 'local', durable: job.durable, ...(!this.collaborationContextCurrent(ctx) ? { stale: true } : {}) };
          }
          const write = () => window.OfflineStore.saveTranslationBatch(batch);
          const ack = ctx.client ? await ctx.client.withLocalWrite(write) : await write();
          ctx.client?.acceptLocalSave(batch, ack);
          if (!this.collaborationContextCurrent(ctx)) return { stale: true };
          this.applyCollaborationFiles(ack.files || [file], ctx.language);
          ctx.client?.retry().catch(error => this.collaborationFailure(error));
          return { status: 'local', durable: true };
        } finally { this._translationWrites--; }
      },
      async persistTranslationBatch(updates, origin, options = {}) {
        if (this._reconcilingImport) return { stale: true };
        this._translationWrites = (this._translationWrites || 0) + 1;
        try {
          const ctx = options.context || this.captureCollaborationContext();
          if (!this.collaborationContextCurrent(ctx)) return { stale: true };
          const capturedBases = copy(Object.fromEntries(updates.map(({ desc }) => [desc.filepath,
            options.bases?.[desc.filepath] || this.collaborationFile(desc, ctx.language)])));
          if (Number(this.localDescs.stagedVersion || 0) < 1) window.WorkspaceState.initializeWorkspace(this.localDescs, { source: this.workspaceSource(),
            sourceHash: ctx.source, game: ctx.game, language: ctx.language });
          if (options.draft) for (const { desc } of updates) {
            const conflicts = ctx.client?.snapshot?.({ includeFiles: false })?.conflicts || this.collaborationConflicts || [];
            if (conflicts.some(conflict => conflict.filepath === desc.filepath)) {
              throw Object.assign(new Error('Open the full editor to review the shared translation conflict before staging this draft.'),
                { code: 'DRAFT_CONFLICT', draftReview: 'shared', filepath: desc.filepath });
            }
            const current = ctx.client?.fileBase?.(desc.filepath) || this.collaborationFile(desc, ctx.language);
            if (Array.isArray(options.draft.base?.translations)
              && JSON.stringify(options.draft.base.translations) !== JSON.stringify(current.translations)) {
              throw Object.assign(new Error('Open the full editor and review this Local draft against the changed committed translation before staging it.'),
                { code: 'DRAFT_BASE_CHANGED', draftReview: 'base', filepath: desc.filepath, currentTranslations: [...current.translations] });
            }
          }
          const promotions = { ...(options.promoteDroppedByPath || {}) };
          for (const { desc } of updates) {
            const candidate = window.WorkspaceState.droppedForFile(this.localDescs, desc.filepath, ctx.language);
            if (options.inline && (candidate || this.localDescs.droppedConflicts?.[ctx.language]?.[desc.filepath])) {
              throw new Error('Open the full editor to review the dropped translation before saving this file.');
            }
            if (candidate) promotions[desc.filepath] ||= this.capturedDroppedPromotion(desc.filepath, candidate);
          }
          if (options.promoteDropped && updates.length === 1) promotions[updates[0].desc.filepath] = options.promoteDropped;
          const promotion = updates.length === 1 ? promotions[updates[0].desc.filepath] : null;
          const hasPromotions = Object.keys(promotions).length > 0;
          if (origin === 'save' && !this.testMode && this.initializePendingSaves()) {
            if (!this.collaborationContextCurrent(ctx)) return { stale: true };
            window.WorkspaceState.scopeWorkspace(this.localDescs, ctx.language);
            const now = Date.now();
            const files = updates.map(({ desc, lines }) => ({ filepath: desc.filepath, translations: [...lines], needsReview: false,
              trackedForExport: true, beforeTranslations: [...(desc.translations?.[ctx.language] || [])] }));
            const statuses = Object.fromEntries(updates.map(({ desc }, index) => [desc.filepath,
              window.WorkspaceState.setFileMetadata(copy(this.localDescs.status?.[desc.filepath] || {}), ctx.language,
                { lastEditedAt: now, lastTranslatedAt: now })]));
            const batch = { jobId: crypto.randomUUID(), game: ctx.game, branchId: ctx.branchId || 'default', language: ctx.language, sourceHash: ctx.source, accountId: ctx.account,
              files, statuses, ...(hasPromotions ? { promoteDroppedByPath: promotions } : {}), ...(promotion ? { promoteDropped: promotion } : {}),
              ...(options.draft ? { draft: copy(options.draft) } : {}),
              ...(options.checkpoint ? { checkpoint: copy(options.checkpoint) } : {}),
              bases: capturedBases,
              deferDisplay: true,
              descriptions: updates.map(({ desc }, index) => makeLocalDesc(desc, ctx.language, files[index].translations,
                { derivedStatus: true })),
              revisions: updates.map(({ desc }, index) => ({ filepath: desc.filepath, filename: desc.filename, filedir: desc.filedir,
                lang: ctx.language, savedAt: now, note: origin, translations: files[index].translations,
                isMissing: computeIsMissing(desc.translations.English.length, files[index].translations), sourceHash: ctx.source })),
              ...(ctx.client?.room() ? { collaboration: { key: ctx.client.key, identity: copy(ctx.client.room().identity),
                bases: copy(Object.fromEntries(files.map(file => [file.filepath,
                  Object.hasOwn(options.bases || {}, file.filepath) ? options.bases[file.filepath] : ctx.client.fileBase(file.filepath)]))), origin,
                ...(hasPromotions ? { promoteDroppedByPath: promotions } : {}), ...(promotion ? { promoteDropped: promotion } : {}) } } : {}),
            };
            const job = await this.journalPendingSave(batch, ctx);
            if (options.deferCommit) {
              job.onCommitted = options.onCommitted;
              job.onRejected = options.onRejected;
              // The captured submission is durable. Navigation may continue,
              // while committed text and checkpoint consumption wait for this job.
              return { status: 'queued', jobId: batch.jobId };
            }
            // Committed UI waits for staging, history, outbox, receipt and exact
            // checkpoint consumption to acknowledge together.
            await this._pendingSaves.drain();
            return { status: 'local', jobId: batch.jobId, durable: job.durable,
              draftConsumed: job.ack?.draftConsumed === true, ...(!this.collaborationContextCurrent(ctx) ? { stale: true } : {}) };
          }
          if (this._pendingSaves && !await this.waitForPendingSaves()) throw new Error('Retry the pending local saves before continuing.');
          if (!this.collaborationContextCurrent(ctx)) return { stale: true };
          const recordScope = window.OfflineStore.captureWorkspaceScope?.({ accountId: ctx.account || 'guest', game: ctx.game,
            branchId: ctx.branchId || 'default', sourceHash: ctx.source }) || { accountId: ctx.account || 'guest', game: ctx.game,
            branchId: ctx.branchId || 'default', sourceHash: ctx.source };
          const localRecords = !this.testMode && !ctx.client && !!window.OfflineStore.getWorkspaceRecords && !!window.OfflineStore.updateWorkspace;
          // Collaboration projects saved files onto the latest durable workspace.
          // Ordinary saves only need to stage their metadata, not clone the archive.
          const incremental = !!ctx.client && origin === 'save' && !options.workspace && !hasPromotions;
          const workspace = localRecords ? { descs: [], status: {} }
            : options.workspace || (incremental ? { descs: [], status: {} } : this.toPlainForStorage(this.localDescs));
          workspace.descs ||= []; workspace.status ||= {};
          window.WorkspaceState.scopeWorkspace(workspace, ctx.language);
          const now = Date.now();
          const revisions = options.revisions || [];
          const files = updates.map(update => {
            const desc = update.desc;
            const lines = [...update.lines];
            const needsReview = false;
            const isMissing = computeIsMissing(desc.translations.English.length, lines);
            const local = workspace.descs.find(d => d.filepath === desc.filepath);
            if (local) updateLocalDesc(local, desc, ctx.language, lines, { derivedStatus: true });
            else workspace.descs.push(makeLocalDesc(desc, ctx.language, lines, { derivedStatus: true }));
            workspace.status[desc.filepath] = window.WorkspaceState.setFileMetadata(
              copy((incremental || localRecords ? this.localDescs.status?.[desc.filepath] : workspace.status[desc.filepath]) || {}), ctx.language,
              { lastEditedAt: now, lastTranslatedAt: now });
            if (!options.revisions) revisions.push({ filepath: desc.filepath, filename: desc.filename, filedir: desc.filedir,
              lang: ctx.language, savedAt: now, note: origin, translations: lines, isMissing,
              ...(ctx.source ? { sourceHash: ctx.source } : {}) });
            const file = { filepath: desc.filepath, translations: lines, needsReview, trackedForExport: true };
            if (!localRecords) window.WorkspaceState.stageTranslation(workspace, file, ctx.language,
              { source: this.workspaceSourceFile(desc.filepath), sourceHash: ctx.source, game: ctx.game, promoteDropped: promotions[desc.filepath] });
            return file;
          });
          const filepaths = files.map(file => file.filepath);
          const originals = localRecords ? new Map(filepaths.map(filepath => [filepath, this.toPlainForStorage(this.workspaceSourceFile(filepath))])) : null;
          let localCommitted;
          let result = { status: 'local' };
          const previousBatch = this._collabDiagnosticBatch;
          const batch = origin === 'consistency' ? { context: ctx, expected: new Map(files.map(file => [file.filepath, [...file.translations]])), touched: false } : null;
          this._collabDiagnosticBatch = batch;
          try {
            if (!this.testMode) {
              if (ctx.client) result = await ctx.client.save({ workspace, revisions, files, origin, bases: options.bases, restore: options.restore,
                waitForSync: origin !== 'save', promoteDropped: promotion, promoteDroppedByPath: promotions });
              else if (localRecords) localCommitted = await window.OfflineStore.updateWorkspace(latest => {
                if (!this.collaborationContextCurrent(ctx) || latest?.sourceHash && latest.sourceHash !== ctx.source)
                  throw Object.assign(new Error('The workspace changed before the translation could be saved.'), { stale: true, code: 'SAVE_SCOPE_CHANGED' });
                for (const file of files) {
                  const source = originals.get(file.filepath);
                  if (!source) throw new Error('The original source is unavailable: ' + file.filepath);
                  const current = window.WorkspaceState.workspaceFile(latest, source, ctx.language).translations;
                  if (!arrayEquals(current, capturedBases[file.filepath]?.translations))
                    throw Object.assign(new Error('The committed translation changed before this save. Review both versions before saving again.'),
                      { code: 'DRAFT_BASE_CHANGED', filepath: file.filepath, currentTranslations: [...current] });
                }
                latest ||= { ...recordScope, sourceHash: ctx.source, stagedVersion: 1, descs: [], status: {} };
                latest.descs ||= []; latest.status ||= {};
                window.WorkspaceState.scopeWorkspace(latest, ctx.language);
                const localFiles = new Map(latest.descs.map(desc => [desc.filepath, desc]));
                for (const file of files) {
                  const source = originals.get(file.filepath);
                  if (!source) throw new Error('The original source is unavailable: ' + file.filepath);
                  const local = localFiles.get(file.filepath);
                  if (local) updateLocalDesc(local, source, ctx.language, file.translations, { derivedStatus: true });
                  else { const created = makeLocalDesc(source, ctx.language, file.translations, { derivedStatus: true }); latest.descs.push(created); localFiles.set(file.filepath, created); }
                  latest.status[file.filepath] = window.WorkspaceState.setFileMetadata(latest.status[file.filepath] || {}, ctx.language,
                    { lastEditedAt: now, lastTranslatedAt: now });
                  window.WorkspaceState.stageTranslation(latest, file, ctx.language,
                    { source, sourceHash: ctx.source, game: ctx.game, promoteDropped: promotions[file.filepath] });
                }
                return latest;
              }, ctx.game, { scope: recordScope, filepaths, revisions });
              else await window.OfflineStore.saveWorkspaceWithRevisions(workspace, revisions, ctx.game);
            }
            if (!this.collaborationContextCurrent(ctx)) return { ...result, stale: true };
            if (localRecords) {
              this.localDescs = window.OfflineStore.mergeWorkspaceRecords?.(this.localDescs, localCommitted) || localCommitted;
            } else if (incremental) {
              // Keep unrelated remote updates that arrived while the transaction
              // committed instead of replacing them with an older workspace copy.
              for (const file of files) this.localDescs.status[file.filepath] = window.WorkspaceState.setFileMetadata(
                this.localDescs.status[file.filepath] || {}, ctx.language, workspace.status[file.filepath]);
            } else {
              const committed = ctx.client && !this.testMode
                ? window.OfflineStore.getWorkspaceRecords
                  ? await window.OfflineStore.getWorkspaceRecords(recordScope, { filepaths })
                  : window.OfflineStore.getWorkspace ? await window.OfflineStore.getWorkspace(ctx.game, ctx.language) : null
                : null;
              if (!this.collaborationContextCurrent(ctx)) return { ...result, stale: true };
              this.localDescs = committed?._storageSelection
                ? window.OfflineStore.mergeWorkspaceRecords(this.localDescs, committed) : committed || workspace;
            }
            // Each submitted file may include independent remote changes. Remote
            // callbacks already apply other files; avoid rewriting the whole list.
            const effective = incremental ? files.map(file => ctx.client.fileBase(file.filepath) || file) : ctx.client?.snapshot()?.files;
            this.applyCollaborationFiles(effective?.length ? effective : files, ctx.language);
            if (result.status === 'conflict') {
              if (batch?.touched) this.clearDiagnosticScanResults();
              this.collaborationNotice = 'Saved locally. Resolve the shared changes before continuing.';
              this.collaborationOpenConflicts?.();
            } else this.collaborationNotice = result.status === 'pending' ? 'Saved locally · Pending sync' : '';
            return result;
          } catch (error) {
            if (batch?.touched && this.collaborationContextCurrent(ctx)) this.clearDiagnosticScanResults();
            throw error;
          } finally {
            if (this._collabDiagnosticBatch === batch) this._collabDiagnosticBatch = previousBatch;
          }
        } finally { this._translationWrites--; }
      },
      async collabResolve(id, translations, options) {
        if (this._pendingSaves?.snapshot().jobs.length && !await this.waitForPendingSaves()) throw new Error('Retry the pending local saves before resolving shared changes.');
        const context = this.captureCollaborationContext();
        const client = this._collaboration;
        const conflict = client.snapshot().conflicts.find(item => item.id === id);
        const lines = Array.isArray(translations) ? translations : translations?.translations;
        const desc = conflict && this.getDescByFilepath(conflict.filepath);
        const resetChoice = conflict?.kind === 'delete_staged' && !Array.isArray(translations) && translations?.trackedForExport === false
          && arrayEquals(lines, conflict.yours.translations);
        const sharedChoice = conflict?.kind === 'delete_staged' && !Array.isArray(translations)
          && !!translations?.trackedForExport === !!conflict.shared.trackedForExport && arrayEquals(lines, conflict.shared.translations);
        const retainedChoice = resetChoice || sharedChoice;
        if (!desc || !Array.isArray(lines) || (!retainedChoice && lines.length !== desc.translations.English.length)) throw new Error('The comparison no longer matches the current source.');
        const diagnostics = [];
        for (let index = 0; !retainedChoice && index < lines.length; index++) {
          const english = this.decodeEscapedNewlines(desc.translations.English[index]);
          const value = this.decodeEscapedNewlines(lines[index]);
          const sourceColumns = this.splitTableColumns(english), translatedColumns = this.splitTableColumns(value);
          if (sourceColumns.length !== translatedColumns.length) throw new Error('Match the English table column count in entry ' + (index + 1) + ' before saving the result.');
          for (let column = 0; column < Math.max(sourceColumns.length, translatedColumns.length); column++) {
            diagnostics.push(...this.analyzeTranslationDiagnostics(translatedColumns[column] || '', sourceColumns[column] || '').diagnostics);
          }
        }
        const errors = diagnostics.filter(item => item.level === 'error');
        if (errors.length) throw new Error('Fix the translation errors before saving the result: ' + errors.map(item => item.message).join(' '));
        const warnings = diagnostics.filter(item => item.level === 'warning');
        const blocksAtResolution = this.editorBlocks;
        const draftAtResolution = this._draftSession;
        if (resetChoice) {
          const confirmed = await this.appConfirm('Delete the staged translation despite the newer shared changes? The committed translation will return to the original ZIP text. History and local drafts will be kept.', {
            title: 'Delete staged translation?', confirmLabel: 'Delete staged translation', danger: true,
          });
          if (!this.collaborationContextCurrent(context)) return { status: 'conflict', stale: true };
          if (!confirmed) return { status: 'conflict' };
        }
        if (warnings.length) {
          const confirmed = await this.appConfirm('Translation warnings: ' + warnings.map(item => item.message).join('\n') + '\nSave the result anyway?', {
            title: 'Save with translation warnings?', confirmLabel: 'Save anyway', danger: true,
          });
          if (!this.collaborationContextCurrent(context)) return { status: 'conflict', stale: true };
          if (!confirmed) return { status: 'conflict' };
        }
        const result = await client.resolve(id, translations, options);
        if (!this.collaborationContextCurrent(context)) return { ...result, stale: true };
        if (result.status !== 'conflict') this.collaborationNotice = result.status === 'pending' ? 'Resolution saved locally · Pending sync' : 'Translation conflict resolved.';
        if (result.status !== 'conflict' && conflict && (this.editorSessionActive ?? this.editorVisible) && this.editorBlocks === blocksAtResolution
          && this.editorCurrentEditingDesc.filepath === conflict.filepath) {
          const saved = client.fileBase(conflict.filepath);
          this.rebaseEditorAfterCommit(saved, {
            draftBefore: conflict.yours.translations.map(value => this.getEditorDisplayText(value)),
            submittedTranslations: conflict.yours.translations,
          });
          if (draftAtResolution && this._draftSession === draftAtResolution) {
            draftAtResolution.base = copy(this._editorCollabBase || saved);
            await this.flushEditorDraft?.();
          }
        }
        return result;
      },
      async collabLoadHistory(filepath, options) {
        if (this._pendingSaves?.snapshot().jobs.length && !await this.waitForPendingSaves()) throw new Error('Retry the pending local saves before opening history.');
        return this._collaboration.history(filepath, options);
      },
      async restoreReviewCandidate(desc, lines, context = this.captureCollaborationContext()) {
        if (this._reconcilingImport) return { stale: true };
        this._translationWrites = (this._translationWrites || 0) + 1;
        try {
          if (this._pendingSaves?.snapshot().jobs.length && !await this.waitForPendingSaves()) throw new Error('Finish pending local saves before recovering a translation.');
          if (!this.collaborationContextCurrent(context)) return { stale: true };
          const now = Date.now();
          const source = copy(this.workspaceSourceFile(desc.filepath) || desc);
          const id = crypto.randomUUID();
          const candidate = { id, recoveryId: id, game: context.game, language: context.language, filepath: desc.filepath,
            originSourceHash: context.source, targetSourceHash: context.source, originSourceAvailable: true,
            reason: 'Recovered translation', snapshot: { name: source.name || '', english: [...source.translations.English],
              variables: copy(source.variables || []), remarks: copy(source.remarks || []), stats: copy(source.stats || []), translations: [...lines] } };
          const revisions = [{ filepath: desc.filepath, filename: desc.filename, filedir: desc.filedir, lang: context.language,
            savedAt: now, note: 'Recovered dropped translation', needsReview: true, translations: [...lines], sourceHash: context.source }];
          let result;
          if (context.client?.registerDroppedCandidate) result = await context.client.registerDroppedCandidate(candidate, { revisions });
          else {
            const recover = workspace => {
              if (!this.collaborationContextCurrent(context) || workspace.sourceHash !== context.source) throw new Error('The workspace changed before recovery.');
              if (Number(workspace.stagedVersion || 0) < 1) window.WorkspaceState.initializeWorkspace(workspace, { source: [source], sourceHash: context.source,
                game: context.game, language: context.language });
              window.WorkspaceState.dropTranslation(workspace, source, context.language, { ...candidate, snapshot: candidate.snapshot });
              return workspace;
            };
            const workspace = this.testMode ? recover(copy(this.localDescs))
              : await window.OfflineStore.updateWorkspace(recover, context.game, { revisions, filepaths: [desc.filepath] });
            result = { status: 'local' };
            if (!this.collaborationContextCurrent(context)) return { stale: true };
            this.localDescs = window.OfflineStore.mergeWorkspaceRecords?.(this.localDescs, workspace) || workspace;
          }
          if (!this.collaborationContextCurrent(context)) return { stale: true };
          this.applyWorkspaceOverlay(); this.filterDesc();
          this._editorCollabBase = this._collaboration?.fileBase(desc.filepath);
          return result;
        } finally { this._translationWrites--; }
      },
      collabLoadHistoryEntry(id) { return this._collaboration.historyEntry(id); },
      async collabRestoreHistory(id, version, baseRevision) {
        if (this._pendingSaves?.snapshot().jobs.length && !await this.waitForPendingSaves()) throw new Error('Retry the pending local saves before restoring history.');
        const context = this.captureCollaborationContext();
        const client = this._collaboration;
        const event = await client.historyEntry(id);
        if (!this.collaborationContextCurrent(context)) throw new Error('The workspace changed. Open history again in the intended workspace.');
        const file = event[version];
        if (!file) throw new Error('This history version has no translation to restore.');
        const filepath = event.filepath || file.filepath;
        const base = client.fileBase(filepath);
        if (base.revision !== baseRevision) throw new Error('The shared file changed. Refresh the restore preview.');
        const desc = this.getDescByFilepath(filepath);
        if (!desc || file.translations.length !== desc.translations.English.length) throw new Error('This history version does not match the current source.');
        const result = await this.persistTranslationBatch([{ desc, lines: file.translations, needsReview: !!file.needsReview }], 'restore', { context, bases: { [filepath]: base }, restore: { eventId: id, version } });
        if (result.stale) return result;
        if (result.status === 'conflict') throw new Error('The shared file changed. Review the conflict before restoring.');
        if ((this.editorSessionActive ?? this.editorVisible) && this.editorCurrentEditingDesc.filepath === filepath && !this.editorHaveChanges()) {
          this._editorCollabBase = client.fileBase(filepath);
          if (this.inlineActive) await this.reloadInlineSession?.(filepath);
          else this.openEditorFile(filepath);
        }
        return result;
      },
    },
  };
  window.CollaborationIntegration = { mixin };
})();
