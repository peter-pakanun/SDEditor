/* Collaboration lifecycle and durable editor commands. UI and transport stay separate. */
(() => {
  const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
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
      sourceLoaded() { this.scheduleCollaboration(); },
      sourceIdentity() { this.scheduleCollaboration(); },
      selectedFilepath(path) { this._collaboration?.select(path); },
      editorVisible(visible) { if (!visible) this._collaboration?.leaveEdit(); this.updateLeaveProtection(); },
      pendingLocalSaves() { this.updateLeaveProtection(); },
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
        const identity = await pending;
        if (zip) identity.fileCount = Object.values(zip.files || {}).filter(entry => !entry.dir).length;
        return { ...identity };
      },
      async lookupImportArchive(identity, game = this.gameVersion) {
        if (!identity || !this.cloudSignedIn || (!this.cloudCanAccessAllLanguages && this.cloudUser?.language !== this.lang) || !this._cloud?.request) return null;
        try {
          const result = await this._cloud.request('/v1/collaboration/archives/' + game + '/' + identity.zipHash);
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
        const selectedDecisions = acceptedArchive?.decisions || decisions;
        const source = await this.sourceWithImportDecisions(rawSource, selectedDecisions);
        const tree = await window.CollaborationProtocol.buildBaselineTree(source);
        const archive = await window.CollaborationProtocol.finalizeArchive({ version: 1, zipHash: identity.zipHash,
          zipSize: identity.zipSize, fileCount: identity.fileCount,
          descriptionCount: source.length, parserVersion: 1, decisions: selectedDecisions, treeRoot: tree.root });
        if (acceptedArchive && JSON.stringify(archive) !== JSON.stringify(await window.CollaborationProtocol.finalizeArchive(acceptedArchive))) {
          throw new Error('The local ZIP does not reproduce the shared import baseline.');
        }
        return { archive, source, rawSource: copy(rawSource), tree };
      },
      async reconcileImportArchive(archive) {
        if (this._reconcilingImport || this._importingSource || this.versionStorageLoading || this.editorSaving || this.navigationBusy
          || this._translationWrites || this._collabDiagnosticBatch || (this.loadingProgress > 0 && this.loadingProgress < 100)) return false;
        if (!this.importBaseline?.rawSource) throw new Error('Reimport the original upstream ZIP to apply the shared import decisions.');
        if (this.editorVisible) {
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
          const oldBaseline = this.importBaseline, oldWorkspace = this.localDescs, oldSource = this.descs;
          const baseline = await this.buildImportedBaseline(oldBaseline.archive, oldBaseline.rawSource, [], archive);
          if (this.editorVisible || !this.collaborationContextCurrent(ctx) || this.importBaseline !== oldBaseline || this.localDescs !== oldWorkspace || this.descs !== oldSource) return false;
          const workspace = copy(oldWorkspace);
          workspace.importArchive = baseline.archive; workspace.sourceHash = baseline.archive.baselineId;
          workspace.importRecovery ||= [];
          workspace.importRecovery.push({ sourceHash: ctx.source, at: Date.now(), reason: 'Shared import decisions', descs: copy(workspace.descs), status: copy(workspace.status) });
          const originals = new Map(oldSource.map(desc => [desc.filepath, desc]));
          const locals = new Map(workspace.descs.map(desc => [desc.filepath, desc]));
          const revisions = [];
          for (const desc of baseline.source) {
            const local = locals.get(desc.filepath), previous = originals.get(desc.filepath);
            const candidate = !!local?.hasChanges || !!previous?.needsReview;
            const previousLines = [...(local?.translations?.[ctx.language] || [])];
            const sameLayout = JSON.stringify([previous?.translations?.English, previous?.stats, previous?.variables, previous?.remarks])
              === JSON.stringify([desc.translations.English, desc.stats, desc.variables, desc.remarks]);
            const lines = candidate ? Array.from({ length: desc.translations.English.length }, (_, index) => local?.translations?.[ctx.language]?.[index] || '')
              : [...(desc.translations[ctx.language] || [])];
            const tracked = candidate && !!local?.hasChanges && sameLayout;
            const status = workspace.status[desc.filepath] ||= {};
            status.needsReview = candidate && !tracked;
            if (status.needsReview) {
              status.reviewCandidates ||= {};
              status.reviewCandidates[ctx.language] = { sourceHash: ctx.source, translations: previousLines, savedAt: Date.now() };
            }
            const replacement = makeLocalDesc(desc, ctx.language, lines, { hasChanges: tracked,
              isMissing: computeIsMissing(desc.translations.English.length, lines) });
            if (local) {
              replacement.translations = { ...local.translations, ...replacement.translations };
              Object.assign(local, replacement);
            } else workspace.descs.push(replacement);
            if (candidate) revisions.push({ filepath: desc.filepath, filename: desc.filename, filedir: desc.filedir, lang: ctx.language,
              savedAt: Date.now(), note: 'Preserved before shared import decisions', translations: previousLines, sourceHash: ctx.source });
          }
          await window.OfflineStore.saveSourceWorkspaceWithRevisions(copy(baseline.source), workspace, revisions, ctx.game, baseline);
          if (!this.collaborationContextCurrent(ctx) || this.localDescs !== oldWorkspace || this.descs !== oldSource) {
            reloadStorage = this.gameVersion === ctx.game;
            return false;
          }
          this._collaboration?.disconnect(); this._collaboration = null; this._collabKey = '';
          this.importBaseline = baseline; this.localDescs = workspace; this.sourceIdentity = baseline.archive.baselineId;
          this.descs = copy(baseline.source); this.applyWorkspaceOverlay(); this.clearDiagnosticScanResults(); this.filterDesc();
          this.scheduleCollaboration();
          return true;
        } finally {
          this._reconcilingImport = false;
          this._importReconciliationDone = null;
          finishTransition();
          if (reloadStorage) this.loadVersionedStorage().catch(error => this.collaborationFailure(error));
        }
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
          onCommit: (job, ack) => {
            if (this.collaborationContextCurrent(job.context)) {
              const files = (ack.files || job.batch.files).map(file => this._pendingSaves.overlay(this.pendingSaveScope(), file.filepath) || file);
              const changed = files.some(file => {
                const desc = this.getDescByFilepath(file.filepath);
                return desc && (!arrayEquals(desc.translations[job.batch.language] || [], file.translations)
                  || !!desc.needsReview !== !!file.needsReview || !!desc.hasChanges !== !!file.trackedForExport);
              });
              if (changed) this.applyCollaborationFiles(files, job.batch.language);
            }
            // Synchronization starts only after workspace, history and outbox commit.
            if (job.context.client && job.context.client === this._collaboration && job.context.client.key === job.batch.collaboration?.key) {
              job.context.client.retry().catch(error => this.collaborationFailure(error));
            }
          },
        });
        return this._pendingSaves;
      },
      updateLeaveProtection() {
        if (!window.addEventListener) return;
        this._pendingSaveBeforeUnload ||= event => {
          if (!this.pendingLocalSaves && !(this.editorVisible && this.editorHaveChanges())) return;
          event.preventDefault(); event.returnValue = 'Unsaved translations';
        };
        window.removeEventListener('beforeunload', this._pendingSaveBeforeUnload);
        if (this.pendingLocalSaves || this.editorVisible) window.addEventListener('beforeunload', this._pendingSaveBeforeUnload);
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
        return { game: this.gameVersion, language: this.lang, sourceHash: this.sourceIdentity, accountId: this.cloudUser?.id || '' };
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
        return { filepath: desc.filepath, translations: [...(desc.translations?.[lang] || [])],
          needsReview: !!desc.needsReview, trackedForExport: !!desc.hasChanges };
      },
      captureCollaborationContext() {
        return { game: this.gameVersion, language: this.lang, source: this.sourceIdentity, account: this.cloudUser?.id || '',
          assignmentVersion: this.cloudUser?.assignmentVersion, role: this.cloudUser?.role,
          allLanguagesAccess: this.cloudCanAccessAllLanguages, client: this._collaboration };
      },
      collaborationContextCurrent(ctx) {
        return ctx.game === this.gameVersion && ctx.language === this.lang && ctx.source === this.sourceIdentity
          && ctx.account === (this.cloudUser?.id || '') && ctx.assignmentVersion === this.cloudUser?.assignmentVersion
          && ctx.role === this.cloudUser?.role && ctx.allLanguagesAccess === this.cloudCanAccessAllLanguages && ctx.client === this._collaboration;
      },
      scheduleCollaboration() {
        // Invalidate an old room immediately, before the debounce or any network await.
        const eligible = this.cloudSignedIn && !!this.cloudUser?.id && !!this.lang
          && (this.cloudCanAccessAllLanguages || this.cloudUser?.language === this.lang) && this.sourceLoaded;
        const key = eligible ? [this.cloudUser.id, this.cloudUser.assignmentVersion, this.cloudUser.role, this.cloudCanAccessAllLanguages, this.gameVersion, this.lang, this.sourceIdentity].join('|') : '';
        if (this._collabKey && this._collabKey !== key) {
          this._collaboration?.disconnect(); this._collaboration = null; this._collabKey = '';
          this._collabFileIndexes = null;
          this.clearBrowserWork?.('collaboration');
          this.collabReceiveState?.({ status: 'Local workspace', peers: [], conflicts: [], pending: 0, connected: false });
        }
        clearTimeout(this._collabStartTimer);
        this._collabStartTimer = setTimeout(() => this.initializeCollaboration().catch(error => this.collaborationFailure(error)), 30);
      },
      collaborationFailure(error) {
        if (error?.stale) return;
        this.collaborationNotice = error?.message || String(error);
        this.collabReceiveState?.({ ...(this._collaboration?.snapshot({ includeFiles: false }) || {}), status: 'Saved locally · collaboration unavailable', error: this.collaborationNotice });
      },
      async initializeCollaboration() {
        if (this.testMode || !this.offlineStoreReady || this.versionStorageLoading || this._importingSource || this._reconcilingImport || !this.sourceLoaded || !this.sourceIdentity || !this._cloud
          || !this.cloudSignedIn || !this.lang || (!this.cloudCanAccessAllLanguages && this.cloudUser?.language !== this.lang) || !window.CollaborationSync) return;
        if (this._pendingSaves?.snapshot().jobs.length && !await this.waitForPendingSaves()) return;
        const key = [this.cloudUser.id, this.cloudUser.assignmentVersion, this.cloudUser.role, this.cloudCanAccessAllLanguages, this.gameVersion, this.lang, this.sourceIdentity].join('|');
        if (this._collabKey === key && this._collaboration) return;
        this._collaboration?.disconnect();
        const ctx = { accountId: this.cloudUser.id, game: this.gameVersion, language: this.lang };
        const cloud = this._cloud;
        const openFile = this.editorVisible ? this.collaborationFile(this.editorCurrentEditingDesc) : null;
        const originalBase = copy(this._editorCollabBase);
        let client;
        client = new window.CollaborationSync.Client({ store: window.OfflineStore, apiBase: cloud.apiBase, allowLegacySeed: false,
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
          onRemote: files => { if (this._collaboration === client) return this.receiveCollaborationFiles(files, ctx.language); },
          onEditingConflict: ({ filepath }) => {
            const isCurrent = () => this._collaboration === client && this.editorVisible && this.editorCurrentEditingDesc?.filepath === filepath;
            if (isCurrent()) return this.claimCollaborationFile(filepath, false, isCurrent);
          },
        });
        this._collaboration = client; this._collabKey = key;
        this.updateCollaborationActivity();
        try {
          const activeSource = this.descs, activeWorkspace = this.localDescs;
          const source = Vue.toRaw ? Vue.toRaw(activeSource) : activeSource;
          const workspace = Vue.toRaw ? Vue.toRaw(activeWorkspace) : activeWorkspace, files = [];
          const context = this.captureCollaborationContext();
          let sliceStart = Date.now();
          this.setBrowserWork?.('collaboration', { key: 'source', label: 'Preparing collaboration data', active: true });
          try {
            for (let index = 0; index < source.length; index++) {
              files.push(this.collaborationFile(source[index]));
              if (index % 64 === 63 && Date.now() - sliceStart >= 8) {
                await new Promise(resolve => setTimeout(resolve, 0)); sliceStart = Date.now();
                if (!this.collaborationContextCurrent(context) || this.descs !== activeSource || this.localDescs !== activeWorkspace) throw Object.assign(new Error('Collaboration workspace changed.'), { stale: true });
              }
            }
          } finally { this.setBrowserWork?.('collaboration', { key: 'source', active: false }); }
          if (!this.collaborationContextCurrent(context) || this.descs !== activeSource || this.localDescs !== activeWorkspace) throw Object.assign(new Error('Collaboration workspace changed.'), { stale: true });
          await client.connect({ ...ctx, source,
            ...(this.importBaseline ? { archive: this.importBaseline.archive, baselineSource: this.importBaseline.source, baselineTree: this.importBaseline.tree } : {}),
            files, workspace });
        } catch (error) {
          if (error.code === 'ARCHIVE_CONFIG_MISMATCH' && this._collaboration === client && error.archive) {
            if (!await this.reconcileImportArchive(error.archive) && this._collaboration === client) {
              client.disconnect(); this._collaboration = null; this._collabKey = '';
            }
            return;
          }
          if (this._collaboration === client && !client.room?.()?.roomId) {
            client.disconnect(); this._collaboration = null; this._collabKey = '';
          }
          throw error;
        }
        if (this._collaboration !== client) return;
        client.select(this.selectedFilepath);
        if (this.editorVisible) {
          const filepath = this.editorCurrentEditingDesc.filepath;
          // The editor may have opened or changed files while preparation was
          // yielding. Keep the ancestor paired with its visible draft.
          this._editorCollabBase = this._editorCollabBase
            || (openFile?.filepath === filepath ? originalBase || openFile : null)
            || client.fileBase(filepath);
          await this.claimCollaborationFile(filepath, false,
            () => this._collaboration === client && this.editorVisible && this.editorCurrentEditingDesc?.filepath === filepath);
        }
      },
      async collabRetry(options) {
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
          for (let index = 0; index < files.length; index += 64) {
            if (!this.collaborationContextCurrent(context)) return;
            this.applyCollaborationFiles(files.slice(index, index + 64), lang, batchState);
            if (Date.now() - sliceStart >= 8) { await new Promise(resolve => setTimeout(resolve, 0)); sliceStart = Date.now(); }
          }
          if (!this.collaborationContextCurrent(context)) return;
          if (batchState.changedFilepaths.length) this.updateScannedDescDiagnostics?.(batchState.changedFilepaths);
          if (batchState.displayChanged) this.filterDesc();
        } finally {
          if (this._collaboration === context.client) this.setBrowserWork?.('collaboration', { key: 'remote', active: false });
        }
      },
      applyCollaborationFiles(files, lang = this.lang, batchState = null) {
        if (lang !== this.lang || !files?.length) return;
        this.ensureLocalDescsReady();
        if (this.editorVisible && !this._editorCollabBase && this.editorCurrentEditingDesc?.filepath) {
          const desc = this.editorCurrentEditingDesc;
          const known = this._collaboration?.fileBase?.(desc.filepath);
          this._editorCollabBase = { ...this.collaborationFile(desc, lang), revision: known?.revision || 0 };
        }
        const changedFilepaths = batchState?.changedFilepaths || [];
        let displayChanged = false;
        const batch = this._collabDiagnosticBatch;
        const indexes = this.collaborationFileIndexes(), { descriptions, locals } = indexes;
        for (let file of files || []) {
          // A remote acknowledgement or an older local save cannot hide a newer
          // edit that is still waiting for its local transaction.
          file = this._pendingSaves?.overlay(this.pendingSaveScope(), file.filepath) || file;
          const desc = descriptions.get(file.filepath);
          if (!desc) continue;
          const translationChanged = !arrayEquals(desc.translations[lang] || [], file.translations);
          const needsReview = !!file.needsReview, hasChanges = !!file.trackedForExport;
          const isMissing = computeIsMissing(desc.translations.English.length, file.translations);
          const metadataChanged = desc.needsReview !== needsReview || desc.hasChanges !== hasChanges || desc.isMissing !== isMissing;
          const local = locals.get(file.filepath);
          const localChanged = !local || !arrayEquals(local.translations?.[lang] || [], file.translations)
            || !arrayEquals(local.translations?.English || [], desc.translations.English)
            || local.hasChanges !== hasChanges || local.isMissing !== isMissing;
          const statusChanged = this.localDescs.status[file.filepath]?.needsReview !== needsReview;
          if (!translationChanged && !metadataChanged && !localChanged && !statusChanged) continue;
          displayChanged ||= translationChanged || metadataChanged;
          if (translationChanged) {
            const expected = batch?.expected.get(file.filepath);
            if (expected && this.collaborationContextCurrent(batch.context)
              && JSON.stringify(expected) === JSON.stringify(file.translations)) batch.touched = true;
            else changedFilepaths.push(file.filepath);
          }
          if (translationChanged) desc.translations[lang] = [...file.translations];
          if (metadataChanged) { desc.needsReview = needsReview; desc.hasChanges = hasChanges; desc.isMissing = isMissing; }
          if (local && localChanged) updateLocalDesc(local, desc, lang, file.translations, { hasChanges, isMissing });
          else if (!local) {
            const added = makeLocalDesc(desc, lang, file.translations, { hasChanges: desc.hasChanges, isMissing: desc.isMissing });
            this.localDescs.descs.push(added); locals.set(file.filepath, added);
          }
          if (statusChanged) this.localDescs.status[file.filepath] = { ...(this.localDescs.status[file.filepath] || {}), needsReview };
        }
        indexes.localLength = this.localDescs.descs.length;
        if (batchState) { batchState.displayChanged ||= displayChanged; return; }
        if (changedFilepaths.length) this.updateScannedDescDiagnostics?.(changedFilepaths);
        // editorBlocks and its captured base remain untouched until explicit save/reopen.
        if (displayChanged) this.filterDesc();
      },
      async claimCollaborationFile(filepath, automatic = false, isCurrent = () => true) {
        const context = this.captureCollaborationContext();
        const client = this._collaboration;
        if (!client) return true;
        if (automatic && client.isEditing(filepath)) return false;
        const result = await client.claim(filepath, { force: false });
        if (!this.collaborationContextCurrent(context)) return false;
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
        if (!isCurrent()) { client.leaveEdit(); return false; }
        return !!forced.granted;
      },
      async persistTranslationBatch(updates, origin, options = {}) {
        if (this._reconcilingImport) return { stale: true };
        this._translationWrites = (this._translationWrites || 0) + 1;
        try {
          const ctx = options.context || this.captureCollaborationContext();
          if (origin === 'save' && !this.testMode && this.initializePendingSaves()) {
            if (!this.collaborationContextCurrent(ctx)) return { stale: true };
            const now = Date.now();
            const files = updates.map(({ desc, lines, needsReview }) => ({ filepath: desc.filepath, translations: [...lines], needsReview: needsReview ?? false, trackedForExport: true }));
            const statuses = Object.fromEntries(updates.map(({ desc }, index) => [desc.filepath, {
              ...(this.localDescs.status?.[desc.filepath] || {}), needsReview: files[index].needsReview, lastEditedAt: now, lastTranslatedAt: now,
            }]));
            const batch = { jobId: crypto.randomUUID(), game: ctx.game, language: ctx.language, sourceHash: ctx.source, accountId: ctx.account,
              files, statuses, descriptions: updates.map(({ desc }, index) => makeLocalDesc(desc, ctx.language, files[index].translations,
                { hasChanges: true, isMissing: computeIsMissing(desc.translations.English.length, files[index].translations) })),
              revisions: updates.map(({ desc }, index) => ({ filepath: desc.filepath, filename: desc.filename, filedir: desc.filedir,
                lang: ctx.language, savedAt: now, note: origin, translations: files[index].translations,
                isMissing: computeIsMissing(desc.translations.English.length, files[index].translations), sourceHash: ctx.source })),
              ...(ctx.client?.room() ? { collaboration: { key: ctx.client.key, identity: copy(ctx.client.room().identity),
                bases: copy(Object.fromEntries(files.map(file => [file.filepath,
                  Object.hasOwn(options.bases || {}, file.filepath) ? options.bases[file.filepath] : ctx.client.fileBase(file.filepath)]))), origin } } : {}),
            };
            this._pendingSaves.enqueue(batch, { context: ctx });
            ctx.client?.stageLocalSave(batch);
            for (const file of files) this.localDescs.status[file.filepath] = statuses[file.filepath];
            this.applyCollaborationFiles(files, ctx.language);
            // Close in the same turn as the optimistic update so Vue paints the
            // file list without first rendering the outgoing editor again.
            if (options.close) this.editorVisible = false;
            return { status: 'queued', jobId: batch.jobId };
          }
          if (this._pendingSaves && !await this.waitForPendingSaves()) throw new Error('Retry the pending local saves before continuing.');
          // Collaboration projects saved files onto the latest durable workspace.
          // Ordinary saves only need to stage their metadata, not clone the archive.
          const incremental = !!ctx.client && origin === 'save' && !options.workspace;
          const workspace = options.workspace || (incremental ? { descs: [], status: {} } : this.toPlainForStorage(this.localDescs));
          workspace.descs ||= []; workspace.status ||= {};
          const now = Date.now();
          const revisions = options.revisions || [];
          const files = updates.map(update => {
            const desc = update.desc;
            const lines = [...update.lines];
            const needsReview = update.needsReview ?? desc.needsReview ?? false;
            const isMissing = computeIsMissing(desc.translations.English.length, lines);
            const local = workspace.descs.find(d => d.filepath === desc.filepath);
            if (local) updateLocalDesc(local, desc, ctx.language, lines, { hasChanges: true, isMissing });
            else workspace.descs.push(makeLocalDesc(desc, ctx.language, lines, { hasChanges: true, isMissing }));
            workspace.status[desc.filepath] = { ...(incremental ? this.localDescs.status?.[desc.filepath] : workspace.status[desc.filepath]), needsReview,
              lastEditedAt: now, lastTranslatedAt: now };
            if (!options.revisions) revisions.push({ filepath: desc.filepath, filename: desc.filename, filedir: desc.filedir,
              lang: ctx.language, savedAt: now, note: origin, translations: lines, isMissing,
              ...(ctx.source ? { sourceHash: ctx.source } : {}) });
            return { filepath: desc.filepath, translations: lines, needsReview, trackedForExport: true };
          });
          let result = { status: 'local' };
          const previousBatch = this._collabDiagnosticBatch;
          const batch = origin === 'consistency' ? { context: ctx, expected: new Map(files.map(file => [file.filepath, [...file.translations]])), touched: false } : null;
          this._collabDiagnosticBatch = batch;
          try {
            if (!this.testMode) {
              if (ctx.client) result = await ctx.client.save({ workspace, revisions, files, origin, bases: options.bases, restore: options.restore,
                waitForSync: origin !== 'save' });
              else await window.OfflineStore.saveWorkspaceWithRevisions(workspace, revisions, ctx.game);
            }
            if (!this.collaborationContextCurrent(ctx)) return { ...result, stale: true };
            if (incremental) {
              // Keep unrelated remote updates that arrived while the transaction
              // committed instead of replacing them with an older workspace copy.
              for (const file of files) this.localDescs.status[file.filepath] = {
                ...(this.localDescs.status[file.filepath] || {}), ...workspace.status[file.filepath],
              };
            } else this.localDescs = workspace;
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
        if (!desc || !Array.isArray(lines) || lines.length !== desc.translations.English.length) throw new Error('The comparison no longer matches the current source.');
        const diagnostics = [];
        for (let index = 0; index < lines.length; index++) {
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
        if (result.status !== 'conflict' && conflict && this.editorVisible && this.editorBlocks === blocksAtResolution
          && this.editorCurrentEditingDesc.filepath === conflict.filepath) {
          const saved = client.fileBase(conflict.filepath);
          this.rebaseEditorAfterCommit(saved, {
            draftBefore: conflict.yours.translations.map(value => this.getEditorDisplayText(value)),
            submittedTranslations: conflict.yours.translations,
          });
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
          const file = { filepath: desc.filepath, translations: [...lines], needsReview: true, trackedForExport: false };
          const now = Date.now();
          const status = { ...(this.localDescs.status?.[desc.filepath] || {}), needsReview: true,
            reviewCandidates: { ...(this.localDescs.status?.[desc.filepath]?.reviewCandidates || {}),
              [context.language]: { sourceHash: context.source, savedAt: now, translations: [...lines] } } };
          const revisions = [{ filepath: desc.filepath, filename: desc.filename, filedir: desc.filedir, lang: context.language,
            savedAt: now, note: 'Recovered translation · Needs Review', needsReview: true, translations: [...lines], sourceHash: context.source }];
          const result = context.client?.registerLocalCandidate
            ? await context.client.registerLocalCandidate(file, { revisions, status })
            : await window.OfflineStore.saveTranslationBatch({ jobId: crypto.randomUUID(), game: context.game,
            language: context.language, sourceHash: context.source, accountId: context.account, files: [file],
            statuses: { [desc.filepath]: status }, descriptions: [makeLocalDesc(desc, context.language, lines,
              { hasChanges: false, isMissing: computeIsMissing(desc.translations.English.length, lines) })],
            revisions });
          if (!this.collaborationContextCurrent(context)) return { stale: true };
          this.localDescs.status[desc.filepath] = status;
          this.applyCollaborationFiles([file], context.language);
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
        if (this.editorVisible && this.editorCurrentEditingDesc.filepath === filepath && !this.editorHaveChanges()) {
          this._editorCollabBase = client.fileBase(filepath);
          this.openEditorFile(filepath);
        }
        return result;
      },
    },
  };
  window.CollaborationIntegration = { mixin };
})();
