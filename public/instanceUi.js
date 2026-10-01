/* Tab-local views over the shared durable coordinator. */
(() => {
  const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const mixin = {
    data() { return {
      instanceReady: false, instanceConnecting: false, instanceFailureReason: '',
      instanceMode: '', sourceGeneration: 0, workspaceRevision: 0,
      instanceWorkerFailed: false,
      instanceSourceChanged: false, instanceDraftRecovery: null,
    }; },
    beforeUnmount() { this._instances?.destroy(); },
    methods: {
      async connectInstances() {
        if (this.testMode) return true;
        this.instanceConnecting = true;
        try {
          const legacy = {};
          // localStorage is unavailable in workers. Never mark the migration as
          // complete unless the tab has successfully read its legacy values.
          for (const [key, name] of [['settings', 'settings'], ['localDescs', 'workspace']]) {
            const value = localStorage.getItem(key);
            if (value) legacy[name] = JSON.parse(value);
          }
          const bridge = await window.InstanceClient.connect({
            apiBase: window.CloudUI.apiBase(), legacy,
            onState: state => this.instanceReceiveState(state),
            onError: error => this.instanceFailure(error),
          });
          this._instances = bridge;
          window.OfflineStore = bridge.store;
          bridge.onWorkspaceChange(event => this.instanceWorkspaceChanged(event));
          this.instanceMode = bridge.mode;
          this.instanceReady = true;
          this.showMultiInstanceGate = false;
          this.instanceFailureReason = '';
          try { this.instanceDraftRecovery = JSON.parse(sessionStorage.getItem('sdeditor-tab-recovery') || 'null'); } catch (_) {}
          return true;
        } catch (error) {
          this.instanceFailure(error);
          return false;
        } finally { this.instanceConnecting = false; }
      },
      instanceReceiveState(state) {
        if (state?.type === 'disconnected') this.instanceFailure(new Error(state.error?.message || state.message || 'The shared coordinator stopped. Reconnecting automatically; your draft is still open.'));
        if (state?.type === 'ready') {
          this.instanceReady = true;
          this.showMultiInstanceGate = false;
          this.instanceFailureReason = '';
        }
      },
      instanceFailure(error) {
        this.instanceReady = false;
        this.instanceWorkerFailed = !!error?.workerAvailable || this.instanceMode === 'shared';
        this.instanceFailureReason = [error?.workerStartupFailure, error?.message || String(error)].filter((value, index, list) => value && list.indexOf(value) === index).join(' ');
        this.showMultiInstanceGate = true;
      },
      async retryInstanceConnection() {
        if (this.instanceConnecting) return;
        this.rememberInstanceDraft('Before reconnecting');
        if (this._instanceRecoveryFailed) return;
        // A reload attaches to the existing worker, or competes for the single
        // fallback lease. It never grants a bypass to a second writer.
        location.reload();
      },
      rememberInstanceDraft(reason) {
        if (!this.editorVisible || !this.editorHaveChanges()) return;
        const recovery = {
          ...(this.instanceDraftRecovery || {}),
          reason, savedAt: Date.now(), game: this.gameVersion, language: this.lang,
          sourceHash: this.sourceIdentity, generation: this.sourceGeneration,
          filepath: this.editorCurrentEditingDesc?.filepath,
          translations: (this.editorBlocks || []).map(block => block.translation ?? ''),
          base: copy(this._editorCollabBase),
        };
        this.instanceDraftRecovery = recovery;
        try { sessionStorage.setItem('sdeditor-tab-recovery', JSON.stringify(recovery)); this._instanceRecoveryFailed = false; }
        catch (_) { this._instanceRecoveryFailed = true; this.collaborationNotice = 'Keep this tab open or download your draft before reloading; the recovery copy could not be stored.'; }
        return recovery;
      },
      downloadInstanceDraft() {
        const recovery = this.rememberInstanceDraft('Downloaded draft') || this.instanceDraftRecovery;
        if (recovery) saveAs(new Blob([JSON.stringify(recovery, null, 2)], { type: 'application/json' }), 'sdeditor_tab_draft.json');
      },
      rememberInstanceSettings(settings, profile) {
        const recovery = this.rememberInstanceDraft('Signed-in profile changed') || this.instanceDraftRecovery || { savedAt: Date.now() };
        recovery.settings = copy(settings); recovery.profile = profile;
        this.instanceDraftRecovery = recovery;
        try { sessionStorage.setItem('sdeditor-tab-recovery', JSON.stringify(recovery)); }
        catch (_) { this.collaborationNotice = 'Download your draft before closing this tab; the recovery copy could not be stored.'; }
      },
      async reloadSharedWorkspace() {
        const recovery = this.rememberInstanceDraft('Source replaced in another tab');
        if (this._instanceRecoveryFailed) return;
        if (recovery && !confirm('Your draft has been kept as a recovery copy. Reload the shared workspace? You can download the recovery copy afterwards.')) return;
        this.instanceSourceChanged = false;
        await this.loadVersionedStorage();
      },
      instanceWorkspaceChanged(event) {
        if (!event || event.game !== this.gameVersion) return;
        if (this.versionStorageLoading || this._importingSource) {
          if (!this._instanceDeferredWorkspace || Number(event.revision) >= Number(this._instanceDeferredWorkspace.revision)) this._instanceDeferredWorkspace = event;
          return;
        }
        const revision = Number(event.revision) || 0;
        if (revision < this.workspaceRevision) return;
        if (Number(event.generation) !== this.sourceGeneration) {
          this.rememberInstanceDraft('Source replaced in another tab');
          this.instanceSourceChanged = true;
          this._collaboration?.disconnect(); this._collaboration = null; this._collabKey = '';
          this.collaborationNotice = 'The source or workspace changed in another tab. Reload the shared workspace before saving. Your draft is still available.';
          return;
        }
        this.workspaceRevision = revision;
        if (!event.workspace || !this.sourceLoaded) return;
        const filesBefore = new Map((this.descs || []).map(desc => [desc.filepath, JSON.stringify(desc.translations?.[this.lang])]));
        this.localDescs = copy(event.workspace);
        this.ensureLocalDescsReady();
        this.applyWorkspaceOverlay();
        let invalidate = false;
        for (const desc of this.descs || []) {
          const lines = desc.translations?.[this.lang];
          if (filesBefore.get(desc.filepath) === JSON.stringify(lines)) continue;
          const batch = this._collabDiagnosticBatch;
          if (batch && this.collaborationContextCurrent(batch.context)
            && JSON.stringify(batch.expected.get(desc.filepath)) === JSON.stringify(lines)) batch.touched = true;
          else invalidate = true;
        }
        if (invalidate) this.updateScannedDescDiagnostics?.();
        this.filterDesc();
        // editorBlocks and their authored bases remain local until save/reopen.
      },
      applyDeferredInstanceWorkspace() {
        const event = this._instanceDeferredWorkspace;
        this._instanceDeferredWorkspace = null;
        if (event) this.instanceWorkspaceChanged(event);
      },
    },
  };
  window.InstanceUI = { mixin };
})();
