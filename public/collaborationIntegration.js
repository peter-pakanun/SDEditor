/* Collaboration lifecycle and durable editor commands. UI and transport stay separate. */
(() => {
  const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const mixin = {
    data() { return { editorSaving: false, navigationBusy: false, collaborationNotice: '', sourceIdentity: '' }; },
    watch: {
      cloudSignedIn() { this.scheduleCollaboration(); },
      'cloudUser.id'() { this.scheduleCollaboration(); },
      'cloudUser.language'() { this.scheduleCollaboration(); },
      'cloudUser.assignmentVersion'() { this.scheduleCollaboration(); },
      lang() { this.scheduleCollaboration(); },
      gameVersion() { this.scheduleCollaboration(); },
      sourceLoaded() { this.scheduleCollaboration(); },
      sourceIdentity() { this.scheduleCollaboration(); },
      selectedFilepath(path) { this._collaboration?.select(path); },
      editorVisible(visible) { if (!visible) this._collaboration?.leaveEdit(); },
    },
    mounted() {
      this._collabOnline = () => this.collabRetry().catch(() => {});
      window.addEventListener('online', this._collabOnline);
      this._collabActivityAt = Date.now();
      this._collabActivity = () => this.markCollaborationActivity();
      this._collabVisibility = () => {
        if (!document.hidden) this._collabActivityAt = Date.now();
        this.updateCollaborationActivity();
      };
      for (const event of ['keydown', 'pointerdown', 'pointermove', 'wheel', 'focus']) window.addEventListener(event, this._collabActivity, { passive: true });
      document.addEventListener('visibilitychange', this._collabVisibility);
      this.updateCollaborationActivity();
      this._collabPoll = setInterval(() => { this.updateCollaborationActivity(); if (!document.hidden) this.collabRetry().catch(() => {}); }, 15000);
    },
    beforeUnmount() {
      clearTimeout(this._collabStartTimer); clearInterval(this._collabPoll);
      window.removeEventListener('online', this._collabOnline);
      for (const event of ['keydown', 'pointerdown', 'pointermove', 'wheel', 'focus']) window.removeEventListener(event, this._collabActivity);
      document.removeEventListener('visibilitychange', this._collabVisibility);
      this._collaboration?.destroy?.();
      this._collaboration?.disconnect();
    },
    methods: {
      markCollaborationActivity(now = Date.now()) {
        this._collabActivityAt = now;
        if (this._collabAway) this.updateCollaborationActivity(now);
      },
      updateCollaborationActivity(now = Date.now()) {
        this._collabAway = !!document.hidden || now - (this._collabActivityAt ?? now) >= 120000;
        this._collaboration?.setAway?.(this._collabAway);
      },
      rebaseEditorAfterCommit(accepted, { draftBefore, submittedTranslations, savedIndexes, baseBefore, originalsBefore } = {}) {
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
          this.refreshEditorBlockMeta(block, index);
        });
        this.editorOriginalTranslations = originals;
        this._editorCollabBase = this._collaboration ? base : undefined;
        this.refreshEditorHLter(); this.refreshGamePreview();
        return { typedDuringSave };
      },
      collaborationFile(desc, lang = this.lang) {
        return { filepath: desc.filepath, translations: [...(desc.translations?.[lang] || [])],
          needsReview: !!desc.needsReview, trackedForExport: !!desc.hasChanges };
      },
      captureCollaborationContext() {
        return { game: this.gameVersion, language: this.lang, source: this.sourceIdentity, account: this.cloudUser?.id || '', client: this._collaboration };
      },
      collaborationContextCurrent(ctx) {
        return ctx.game === this.gameVersion && ctx.language === this.lang && ctx.source === this.sourceIdentity
          && ctx.account === (this.cloudUser?.id || '') && ctx.client === this._collaboration;
      },
      scheduleCollaboration() {
        // Invalidate an old room immediately, before the debounce or any network await.
        const eligible = this.cloudSignedIn && this.cloudUser?.language === this.lang && this.sourceLoaded;
        const key = eligible ? [this.cloudUser.id, this.gameVersion, this.lang, this.sourceIdentity].join('|') : '';
        if (this._collabKey && this._collabKey !== key) {
          this._collaboration?.disconnect(); this._collaboration = null; this._collabKey = '';
          this.collabReceiveState?.({ status: 'Local workspace', peers: [], conflicts: [], pending: 0, connected: false });
        }
        clearTimeout(this._collabStartTimer);
        this._collabStartTimer = setTimeout(() => this.initializeCollaboration().catch(error => this.collaborationFailure(error)), 30);
      },
      collaborationFailure(error) {
        if (error?.stale) return;
        this.collaborationNotice = error?.message || String(error);
        this.collabReceiveState?.({ ...(this._collaboration?.snapshot() || {}), status: 'Saved locally · collaboration unavailable', error: this.collaborationNotice });
      },
      async initializeCollaboration() {
        if (this.testMode || !this.offlineStoreReady || this.versionStorageLoading || this._importingSource || !this.sourceLoaded || !this.sourceIdentity || !this._cloud
          || !this.cloudSignedIn || this.cloudUser?.language !== this.lang || !window.CollaborationSync) return;
        const key = [this.cloudUser.id, this.gameVersion, this.lang, this.sourceIdentity].join('|');
        if (this._collabKey === key && this._collaboration) return;
        this._collaboration?.disconnect();
        const ctx = { accountId: this.cloudUser.id, game: this.gameVersion, language: this.lang };
        const cloud = this._cloud;
        const openFile = this.editorVisible ? this.collaborationFile(this.editorCurrentEditingDesc) : null;
        const originalBase = copy(this._editorCollabBase);
        let client;
        client = new window.CollaborationSync.Client({ store: window.OfflineStore, apiBase: cloud.apiBase,
          context: () => cloud.context(), request: (path, options, captured) => cloud.request(path, options, captured),
          onChange: state => {
            if (this._collaboration !== client) return;
            this.collabReceiveState?.(state);
            if (state.connected && state.pending === 0 && !state.conflicts?.length) {
              if (['Saved locally · Pending sync', 'Resolution saved locally · Pending sync'].includes(this.collaborationNotice)) this.collaborationNotice = '';
              else if (/^Imported \d+ translated files · Pending sync$/.test(this.collaborationNotice)) this.collaborationNotice = this.collaborationNotice.replace(' · Pending sync', '.');
            }
          },
          onStatus: status => { if (this._collaboration === client) this.collabReceiveState?.({ ...client.snapshot(), status: status?.message ?? status, error: status?.error ? status.message : '' }); },
          onRemote: files => { if (this._collaboration === client) this.applyCollaborationFiles(files, ctx.language); },
          onEditingConflict: ({ filepath }) => { if (this._collaboration === client && this.editorVisible && this.editorCurrentEditingDesc?.filepath === filepath) return this.claimCollaborationFile(filepath, false); },
        });
        this._collaboration = client; this._collabKey = key;
        this.updateCollaborationActivity();
        await client.connect({ ...ctx, source: this.toPlainForStorage(this.descs),
          files: this.descs.map(desc => this.collaborationFile(desc)), workspace: this.toPlainForStorage(this.localDescs) });
        if (this._collaboration !== client) return;
        client.select(this.selectedFilepath);
        if (this.editorVisible) {
          this._editorCollabBase = originalBase || openFile || client.fileBase(this.editorCurrentEditingDesc.filepath);
          await this.claimCollaborationFile(this.editorCurrentEditingDesc.filepath, false);
        }
      },
      async collabRetry() {
        if (!this._collaboration) return this.initializeCollaboration();
        return this._collaboration.sync();
      },
      applyCollaborationFiles(files, lang = this.lang) {
        if (lang !== this.lang) return;
        this.ensureLocalDescsReady();
        let invalidateDiagnostics = false;
        const batch = this._collabDiagnosticBatch;
        const descriptions = new Map(this.descs.map(desc => [desc.filepath, desc]));
        const locals = new Map(this.localDescs.descs.map(desc => [desc.filepath, desc]));
        for (const file of files || []) {
          const desc = descriptions.get(file.filepath);
          if (!desc) continue;
          if (JSON.stringify(desc.translations[lang] || []) !== JSON.stringify(file.translations)) {
            const expected = batch?.expected.get(file.filepath);
            if (expected && this.collaborationContextCurrent(batch.context)
              && JSON.stringify(expected) === JSON.stringify(file.translations)) batch.touched = true;
            else invalidateDiagnostics = true;
          }
          desc.translations[lang] = [...file.translations];
          desc.needsReview = !!file.needsReview; desc.hasChanges = !!file.trackedForExport;
          desc.isMissing = computeIsMissing(desc.translations.English.length, file.translations);
          const local = locals.get(file.filepath);
          if (local) updateLocalDesc(local, desc, lang, file.translations, { hasChanges: desc.hasChanges, isMissing: desc.isMissing });
          else {
            const added = makeLocalDesc(desc, lang, file.translations, { hasChanges: desc.hasChanges, isMissing: desc.isMissing });
            this.localDescs.descs.push(added); locals.set(file.filepath, added);
          }
          this.localDescs.status[file.filepath] = { ...(this.localDescs.status[file.filepath] || {}), needsReview: desc.needsReview };
        }
        if (invalidateDiagnostics) this.updateScannedDescDiagnostics?.();
        // editorBlocks and its captured base remain untouched until explicit save/reopen.
        this.filterDesc();
      },
      async claimCollaborationFile(filepath, automatic = false) {
        const client = this._collaboration;
        if (!client) return true;
        if (automatic && client.isEditing(filepath)) return false;
        const result = await client.claim(filepath, { force: false });
        if (client !== this._collaboration) return false;
        if (result.granted) return true;
        if (automatic) return false;
        const names = (result.peers || []).map(peer => peer.name).join(', ') || 'Another translator';
        if (!confirm(`${names} is editing this file. Edit anyway?`)) return false;
        return !!(await client.claim(filepath, { force: true })).granted;
      },
      async persistTranslationBatch(updates, origin, options = {}) {
        const ctx = options.context || this.captureCollaborationContext();
        const workspace = options.workspace || this.toPlainForStorage(this.localDescs);
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
          workspace.status[desc.filepath] = { ...(workspace.status[desc.filepath] || {}), needsReview,
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
            if (ctx.client) result = await ctx.client.save({ workspace, revisions, files, origin, bases: options.bases, restore: options.restore });
            else await window.OfflineStore.saveWorkspaceWithRevisions(workspace, revisions, ctx.game);
          }
          if (!this.collaborationContextCurrent(ctx)) return { ...result, stale: true };
          this.localDescs = workspace;
          // The engine may have combined independent remote changes during this save.
          const effective = ctx.client?.snapshot()?.files;
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
      },
      async collabResolve(id, translations, options) {
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
        if (warnings.length && !confirm('Translation warnings: ' + warnings.map(item => item.message).join('\n') + '\nSave the result anyway?')) return { status: 'conflict' };
        const blocksAtResolution = this.editorBlocks;
        const result = await client.resolve(id, translations, options);
        if (client !== this._collaboration) return result;
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
      collabLoadHistory(filepath, options) { return this._collaboration.history(filepath, options); },
      collabLoadHistoryEntry(id) { return this._collaboration.historyEntry(id); },
      async collabRestoreHistory(id, version, baseRevision) {
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
