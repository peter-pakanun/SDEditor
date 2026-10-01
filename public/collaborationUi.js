/* Translation collaboration views. Mutations and session lifecycle live in the integration mixin. */
(() => {
  const emptyState = () => ({ status: 'local', error: '', roomId: '', sourceHash: '', peers: [], conflicts: [], pendingCount: 0, connected: false, disconnected: false });
  const colors = ['#17743b', '#3458b3', '#96408c', '#996015', '#087782', '#ac3f42'];
  const text = value => String(value ?? '');
  const decode = value => text(value).replaceAll('\\n', '\n');
  const encode = value => text(value).replace(/\r\n?/g, '\n').replaceAll('\n', '\\n');
  const lines = state => Array.isArray(state?.translations) ? state.translations : [];
  const fingerprint = conflict => conflict ? JSON.stringify([conflict.id, conflict.base, conflict.yours, conflict.shared, conflict.indexes, conflict.metadata]) : '';
  function peerColor(peer) {
    if (/^#[0-9a-f]{6}$/i.test(peer?.color || '')) return peer.color;
    const id = text(peer?.userId || peer?.name || peer?.sessionId);
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
    return colors[hash % colors.length];
  }
  function conflictDraft(conflict) {
    const base = lines(conflict?.base), yours = lines(conflict?.yours), shared = lines(conflict?.shared);
    const indexes = Array.isArray(conflict?.indexes) ? conflict.indexes : [];
    return Array.from({ length: Math.max(yours.length, shared.length) }, (_, index) => {
      if (indexes.includes(index)) return decode(yours[index]);
      if (yours[index] === shared[index] || shared[index] === base[index]) return decode(yours[index]);
      return decode(shared[index]);
    });
  }
  const originLabels = { save: 'Save', edit: 'Save', seed: 'Initial shared workspace', baseline: 'Initial shared workspace', merge: 'Automatic merge', auto_merge: 'Automatic merge', conflict_resolution: 'Conflict resolved', history_restore: 'History restore', restore: 'History restore', import: 'Import translated', import_translated: 'Import translated', review: 'Confirmed unchanged', confirm: 'Confirmed unchanged', confirm_unchanged: 'Confirmed unchanged', consistency: 'Compare & resolve', consistency_resolution: 'Compare & resolve' };
  const mixin = {
    data() { return {
      collaborationState: emptyState(), collaborationNotice: '',
      collaborationConflictVisible: false, collaborationConflictId: '', collaborationConflictDraft: [],
      collaborationConflictChoices: {}, collaborationConflictEdited: {}, collaborationConflictMetadataDraft: {}, collaborationConflictMetadataChoices: {}, collaborationConflictBusy: false, collaborationConflictError: '', collaborationConflictNotice: '',
      collaborationHistoryVisible: false, collaborationHistoryFilepath: '', collaborationHistoryItems: [],
      collaborationHistoryCursor: null, collaborationHistoryLoading: false, collaborationHistoryDetailLoading: false,
      collaborationHistoryError: '', collaborationHistoryNotice: '', collaborationHistoryEvent: null,
      collaborationHistoryRestoreVersion: '', collaborationHistoryRestoring: false,
    }; },
    computed: {
      collaborationConflicts() { return this.collaborationState.conflicts || []; },
      collaborationConflict() { return this.collaborationConflicts.find(item => item.id === this.collaborationConflictId) || null; },
      collaborationConflictIndexes() { return [...new Set([...(this.collaborationConflict?.indexes || []), ...Object.keys(this.collaborationConflictEdited).filter(key => this.collaborationConflictEdited[key]).map(Number)])].sort((a, b) => a - b); },
      collaborationConflictMetadata() { return this.collaborationConflict?.metadata || []; },
      collaborationConflictReady() { return !!this.collaborationConflict && this.collaborationConflictIndexes.every(index => !!this.collaborationConflictChoices[index]) && this.collaborationConflictMetadata.every(key => !!this.collaborationConflictMetadataChoices[key]); },
      collaborationPendingCount() { return Number(this.collaborationState.pendingCount ?? this.collaborationState.pending) || 0; },
      collaborationAvailable() { return !!this.collaborationState.roomId; },
      collaborationStatusLabel() {
        const state = this.collaborationState;
        if (this.collaborationConflicts.length) return `${this.collaborationConflicts.length} translation conflict${this.collaborationConflicts.length === 1 ? '' : 's'} to review`;
        if (state.error) return 'Collaboration needs attention';
        if (state.disconnected) return 'Collaboration disconnected · reconnecting automatically';
        return '';
      },
      collaborationNeedsAttention() {
        return !!(this.collaborationState.error || this.collaborationState.disconnected || this.collaborationConflicts.length);
      },
      collaborationConnectionTone() {
        return this.collaborationState.error ? 'error' : this.collaborationNeedsAttention ? 'warning'
          : this.collaborationState.connected ? 'connected' : '';
      },
      collaborationUserNotice() {
        const notice = this.collaborationNotice || '';
        if (['Translation conflict resolved.', 'Marked as reviewed (unchanged).', 'Saved locally · Pending sync', 'Resolution saved locally · Pending sync'].includes(notice)
          || /^Imported \d+ translated files(?:\.| · Pending sync)$/.test(notice)) return '';
        return notice === this.collaborationState.error ? '' : notice;
      },
      collaborationEditorNotice() { return this.collaborationUserNotice; },
      collaborationContext() {
        const state = this.collaborationState, identity = state.identity || {};
        return [identity.accountId || this.cloudUser?.id || '', state.roomId, identity.game || this.gameVersion, identity.sourceHash || state.sourceHash, identity.language || this.lang].join('|');
      },
      collaborationShortVersion() { return text(this.collaborationState.identity?.sourceHash || this.collaborationState.sourceHash).slice(0, 12); },
      collaborationEditorPeers() { return this.collaborationPeersFor(this.editorCurrentEditingDesc?.filepath).filter(peer => peer.editing === this.editorCurrentEditingDesc?.filepath); },
      collaborationParticipants() {
        if (!this.collaborationState.connected) return [];
        const participants = new Map();
        for (const peer of this.collaborationState.peers || []) {
          const key = peer.userId ? 'user:' + peer.userId : 'session:' + peer.sessionId;
          const isSelf = peer.sessionId === this.collaborationState.sessionId || (!!peer.userId && peer.userId === this.collaborationState.identity?.accountId);
          const existing = participants.get(key);
          if (existing) { existing.away = existing.away && !!peer.away; existing.isSelf ||= isSelf; existing.sessionCount++; }
          else participants.set(key, { ...peer, key, away: !!peer.away, isSelf, sessionCount: 1 });
        }
        return [...participants.values()].sort((a, b) => Number(b.isSelf) - Number(a.isSelf)
          || this.collaborationPeerName(a).localeCompare(this.collaborationPeerName(b)) || a.key.localeCompare(b.key));
      },
      collaborationCanRetry() { return (this.collaborationAvailable || !!this.collaborationState.identity) && !!(this.collaborationState.disconnected || this.collaborationState.error); },
    },
    watch: {
      collaborationContext() { this.collaborationResetViews(); },
      collaborationConflicts: { deep: true, handler() { this.collaborationRefreshConflict(); } },
    },
    methods: {
      collabReceiveState(state) {
        const previous = this.collaborationState;
        const next = { ...emptyState(), ...state, pendingCount: state?.pendingCount ?? state?.pending ?? 0 };
        const sameScope = (previous.roomId === next.roomId || !previous.roomId || !next.roomId)
          && ['accountId', 'game', 'sourceHash', 'language'].every(key => previous.identity?.[key] === next.identity?.[key]);
        if (sameScope) for (const key of ['status', 'error']) if (!Object.prototype.hasOwnProperty.call(state, key)) next[key] = previous[key];
        if (sameScope && previous.error && Object.prototype.hasOwnProperty.call(state, 'error') && !next.error
          && this.collaborationNotice === previous.error) this.collaborationNotice = '';
        this.collaborationState = next;
      },
      collaborationPeersFor(filepath) {
        if (!filepath || !this.collaborationState.connected) return [];
        return (this.collaborationState.peers || []).filter(peer => peer.sessionId !== this.collaborationState.sessionId && (peer.selected === filepath || peer.editing === filepath));
      },
      collaborationPeerColor(peer) { return peerColor(peer); },
      collaborationPeerName(peer) { return text(peer?.name) || 'Translator'; },
      collaborationParticipantLabel(participant) { return [this.collaborationPeerName(participant), participant.isSelf ? 'You' : '', participant.away ? 'Away' : 'Active'].filter(Boolean).join(' · '); },
      collaborationParticipantInitials(participant) {
        const words = this.collaborationPeerName(participant).trim().split(/\s+/).filter(Boolean);
        const first = word => typeof Intl.Segmenter === 'function' ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(word)][0]?.segment || '' : Array.from(word)[0] || '';
        return [first(words[0] || 'T'), words.length > 1 ? first(words[words.length - 1]) : ''].join('').toLocaleUpperCase();
      },
      collaborationPeerLabel(peer, filepath) { return this.collaborationPeerName(peer) + (peer.editing === filepath ? ' · Editing' : ''); },
      collaborationEditingPeersFor(filepath) { return this.collaborationPeersFor(filepath).filter(peer => peer.editing === filepath); },
      collaborationSelectionLabel(filepath) { return this.collaborationPeersFor(filepath).filter(peer => peer.editing !== filepath).map(peer => this.collaborationPeerName(peer)).join(', '); },
      collaborationEditing(filepath) { return this.collaborationPeersFor(filepath).some(peer => peer.editing === filepath); },
      collaborationCellStyle(filepath) { const peer = this.collaborationPeersFor(filepath)[0]; return peer ? { '--collaboration-color': peerColor(peer) } : {}; },
      collaborationResetViews() {
        this._collaborationConflictRequest = (this._collaborationConflictRequest || 0) + 1;
        this._collaborationRestoreRequest = (this._collaborationRestoreRequest || 0) + 1;
        this.collaborationCloseConflicts(); this.collaborationCloseHistory();
        this.collaborationConflictBusy = false; this.collaborationHistoryRestoring = false;
        this.collaborationNotice = ''; this.collaborationConflictId = ''; this.collaborationConflictDraft = []; this.collaborationConflictChoices = {};
        this.collaborationConflictEdited = {}; this.collaborationConflictMetadataChoices = {}; this.collaborationConflictMetadataDraft = {};
        this._collaborationConflictDrafts = new Map();
      },
      async collaborationOpenConflicts() {
        if (!this.collaborationConflicts.length) return;
        this._collaborationConflictFocus = document.activeElement;
        const context = this.collaborationContext;
        this.collaborationConflictVisible = true;
        this.collaborationSelectConflict(this.collaborationConflict?.id || this.collaborationConflicts[0].id);
        await this.$nextTick();
        if (!this.collaborationConflictVisible || context !== this.collaborationContext) return;
        const dialog = this.$refs.collaborationConflictDialog;
        if (dialog && !dialog.open) dialog.showModal();
        this.$refs.collaborationConflictClose?.focus();
      },
      collaborationCloseConflicts() {
        this.collaborationRememberDraft();
        this.collaborationConflictVisible = false;
        this.$refs.collaborationConflictDialog?.close();
        if (this._collaborationConflictFocus?.isConnected) this._collaborationConflictFocus.focus();
      },
      collaborationRememberDraft() {
        if (!this.collaborationConflict || !this._collaborationConflictFingerprint) return;
        (this._collaborationConflictDrafts ||= new Map()).set(this.collaborationConflictId, {
          fingerprint: this._collaborationConflictFingerprint,
          draft: this.collaborationConflictDraft.slice(), choices: { ...this.collaborationConflictChoices }, edited: { ...this.collaborationConflictEdited },
          metadata: { ...this.collaborationConflictMetadataDraft }, metadataChoices: { ...this.collaborationConflictMetadataChoices },
        });
      },
      collaborationSelectConflict(id) {
        if (this.collaborationConflictBusy) return;
        this.collaborationRememberDraft();
        const conflict = this.collaborationConflicts.find(item => item.id === id);
        const cached = this._collaborationConflictDrafts?.get(conflict?.id);
        this.collaborationConflictId = conflict?.id || '';
        this.collaborationConflictDraft = conflictDraft(conflict);
        this.collaborationConflictChoices = {}; this.collaborationConflictEdited = {};
        this.collaborationConflictMetadataChoices = {};
        this.collaborationConflictMetadataDraft = {};
        for (const key of ['needsReview', 'trackedForExport']) {
          const local = !!conflict?.yours?.[key], remote = !!conflict?.shared?.[key], base = !!conflict?.base?.[key];
          this.collaborationConflictMetadataDraft[key] = local === remote || (conflict?.base && remote === base) ? local : remote;
        }
        this.collaborationConflictError = ''; this.collaborationConflictNotice = '';
        this._collaborationConflictFingerprint = fingerprint(conflict);
        this._collaborationConflictSharedRevision = conflict?.shared?.revision;
        if (cached?.fingerprint === this._collaborationConflictFingerprint) {
          this.collaborationConflictDraft = cached.draft.slice(); this.collaborationConflictChoices = { ...cached.choices };
          this.collaborationConflictEdited = { ...cached.edited }; this.collaborationConflictMetadataDraft = { ...cached.metadata };
          this.collaborationConflictMetadataChoices = { ...cached.metadataChoices };
        } else if (cached) {
          // Keep authored proposals, including entries that now merge on the server,
          // but require a fresh confirmation against the newly displayed versions.
          for (let index = 0; index < this.collaborationConflictDraft.length; index++) {
            if (!cached.edited[index] || typeof cached.draft[index] !== 'string') continue;
            this.collaborationConflictDraft[index] = cached.draft[index]; this.collaborationConflictEdited[index] = true;
          }
          this.collaborationConflictNotice = 'The shared version changed. Review these entries again before saving. Your custom result text is retained.';
        }
      },
      collaborationRefreshConflict() {
        const active = new Set(this.collaborationConflicts.map(conflict => conflict.id));
        for (const id of this._collaborationConflictDrafts?.keys() || []) if (!active.has(id)) this._collaborationConflictDrafts.delete(id);
        if (!this.collaborationConflictVisible || this.collaborationConflictBusy) return;
        if (!this.collaborationConflict) {
          if (this.collaborationConflicts.length) this.collaborationSelectConflict(this.collaborationConflicts[0].id);
          else this.collaborationCloseConflicts();
        } else if (fingerprint(this.collaborationConflict) !== this._collaborationConflictFingerprint) {
          this.collaborationSelectConflict(this.collaborationConflictId);
        }
      },
      collaborationConflictText(index, side) {
        if (side === 'base' && !this.collaborationConflict?.base) return 'No shared base yet';
        const value = lines(this.collaborationConflict?.[side])[index];
        return value === '' ? '(Empty translation)' : decode(value);
      },
      collaborationConflictEnglish(index) {
        const desc = (this.descs || []).find(item => item.filepath === this.collaborationConflict?.filepath);
        return decode(desc?.translations?.English?.[index]);
      },
      collaborationChooseConflict(index, side) {
        if (this.collaborationConflictBusy || !['yours', 'shared'].includes(side)) return;
        this.collaborationConflictDraft[index] = decode(lines(this.collaborationConflict?.[side])[index]);
        this.collaborationConflictChoices[index] = side;
        this.collaborationConflictEdited[index] = false;
      },
      collaborationEditConflict(index) { this.collaborationConflictChoices[index] = 'edited'; this.collaborationConflictEdited[index] = true; },
      collaborationMetadataLabel(key) { return key === 'needsReview' ? 'Review required' : 'Tracked for export'; },
      collaborationChooseMetadata(key, side) {
        if (this.collaborationConflictBusy || !this.collaborationConflictMetadata.includes(key) || !['yours', 'shared'].includes(side)) return;
        this.collaborationConflictMetadataDraft[key] = !!this.collaborationConflict[side][key];
        this.collaborationConflictMetadataChoices[key] = side;
      },
      async collaborationSubmitConflict() {
        if (!this.collaborationConflictReady || this.collaborationConflictBusy) return;
        const context = this.collaborationContext, conflict = this.collaborationConflict;
        const sequence = this._collaborationConflictRequest = (this._collaborationConflictRequest || 0) + 1;
        this.collaborationConflictBusy = true; this.collaborationConflictError = '';
        try {
          const translations = this.collaborationConflictDraft.map(encode);
          const resolution = { ...conflict.shared, ...this.collaborationConflictMetadataDraft, translations };
          const result = await this.collabResolve(conflict.id, resolution, { sharedRevision: this._collaborationConflictSharedRevision });
          if (context !== this.collaborationContext || sequence !== this._collaborationConflictRequest) return;
          if (result?.status === 'conflict') this.collaborationConflictNotice = 'The shared version changed. Review the refreshed entries before saving again.';
        } catch (error) {
          if (context === this.collaborationContext && sequence === this._collaborationConflictRequest) this.collaborationConflictError = error.message || 'Could not save this resolution.';
        } finally {
          if (sequence === this._collaborationConflictRequest) {
            this.collaborationConflictBusy = false;
            if (context === this.collaborationContext) this.collaborationRefreshConflict();
          }
        }
      },
      async collaborationRetry() {
        const context = this.collaborationContext;
        try { await this.collabRetry(); }
        catch (error) { if (context === this.collaborationContext && !error?.stale) this.collaborationState = { ...this.collaborationState, error: error.message || 'Could not reconnect.' }; }
      },
      async collaborationOpenHistory(filepath) {
        if (!this.collaborationAvailable || !filepath) return;
        this._collaborationHistoryFocus = document.activeElement;
        const context = this.collaborationContext;
        this.collaborationHistoryVisible = true; this.collaborationHistoryFilepath = filepath;
        this.collaborationHistoryNotice = ''; this.collaborationHistoryError = '';
        await this.$nextTick();
        if (!this.collaborationHistoryVisible || context !== this.collaborationContext) return;
        const dialog = this.$refs.collaborationHistoryDialog;
        if (dialog && !dialog.open) dialog.showModal();
        this.$refs.collaborationHistoryClose?.focus();
        await this.collaborationRefreshHistory();
      },
      collaborationCloseHistory() {
        this._collaborationHistoryRequest = (this._collaborationHistoryRequest || 0) + 1;
        this._collaborationHistoryDetailRequest = (this._collaborationHistoryDetailRequest || 0) + 1;
        this.collaborationHistoryVisible = false; this.collaborationHistoryItems = []; this.collaborationHistoryEvent = null;
        this.collaborationHistoryCursor = null; this.collaborationHistoryRestoreVersion = '';
        this.collaborationHistoryLoading = false; this.collaborationHistoryDetailLoading = false;
        this.collaborationHistoryError = ''; this.collaborationHistoryNotice = '';
        this.$refs.collaborationHistoryDialog?.close();
        if (this._collaborationHistoryFocus?.isConnected) this._collaborationHistoryFocus.focus();
      },
      async collaborationRefreshHistory(append = false) {
        if (!this.collaborationHistoryVisible || !this.collaborationAvailable || (append && !this.collaborationHistoryCursor)) return;
        const context = this.collaborationContext;
        const sequence = this._collaborationHistoryRequest = (this._collaborationHistoryRequest || 0) + 1;
        this.collaborationHistoryLoading = true; this.collaborationHistoryError = '';
        if (!append) {
          this.collaborationHistoryItems = []; this.collaborationHistoryCursor = null; this.collaborationHistoryEvent = null;
          this.collaborationHistoryRestoreVersion = ''; this.collaborationHistoryDetailLoading = false;
          this._collaborationHistoryDetailRequest = (this._collaborationHistoryDetailRequest || 0) + 1;
        }
        try {
          const result = await this.collabLoadHistory(this.collaborationHistoryFilepath, append ? { cursor: this.collaborationHistoryCursor } : {});
          if (!this.collaborationHistoryVisible || context !== this.collaborationContext || sequence !== this._collaborationHistoryRequest) return;
          const items = Array.isArray(result) ? result : result.items || [];
          this.collaborationHistoryItems = append ? [...this.collaborationHistoryItems, ...items] : items;
          this.collaborationHistoryCursor = result.nextCursor ?? result.nextBefore ?? null;
        } catch (error) {
          if (context === this.collaborationContext && sequence === this._collaborationHistoryRequest) this.collaborationHistoryError = error.message || 'Could not load history.';
        } finally {
          if (context === this.collaborationContext && sequence === this._collaborationHistoryRequest) this.collaborationHistoryLoading = false;
        }
      },
      async collaborationSelectHistoryEvent(event) {
        if (this.collaborationHistoryRestoring) return;
        const context = this.collaborationContext;
        const sequence = this._collaborationHistoryDetailRequest = (this._collaborationHistoryDetailRequest || 0) + 1;
        this.collaborationHistoryDetailLoading = true; this.collaborationHistoryError = ''; this.collaborationHistoryNotice = '';
        this.collaborationHistoryEvent = null; this.collaborationHistoryRestoreVersion = '';
        try {
          const result = await this.collabLoadHistoryEntry(event.id);
          if (!this.collaborationHistoryVisible || context !== this.collaborationContext || sequence !== this._collaborationHistoryDetailRequest) return;
          this.collaborationHistoryEvent = result;
          await this.$nextTick();
          this.$refs.collaborationHistoryDetail?.scrollIntoView({ block: 'nearest' });
        } catch (error) {
          if (context === this.collaborationContext && sequence === this._collaborationHistoryDetailRequest) this.collaborationHistoryError = error.message || 'Could not load this change.';
        } finally {
          if (context === this.collaborationContext && sequence === this._collaborationHistoryDetailRequest) this.collaborationHistoryDetailLoading = false;
        }
      },
      collaborationHistoryActor(event) { return text(event?.actor?.name || event?.actorName) || 'Translator'; },
      collaborationHistoryDate(event) {
        const value = event?.createdAt ?? event?.savedAt ?? event?.timestamp;
        if (!value) return 'Unknown date';
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? 'Unknown date' : date.toLocaleString();
      },
      collaborationHistoryOrigin(event) { return originLabels[event?.origin] || text(event?.origin) || 'Translation change'; },
      collaborationHistoryText(state) {
        if (!state) return 'No earlier shared version is available.';
        return lines(state).map((line, index) => `Entry ${index + 1}\n${line === '' ? '(Empty translation)' : decode(line)}`).join('\n\n');
      },
      collaborationHistoryCanRestore(version) {
        const event = this.collaborationHistoryEvent;
        if (!event || !event[version] || this.collaborationHistoryRestoring) return false;
        return event[version === 'before' ? 'canRestoreBefore' : 'canRestoreAfter'] !== false;
      },
      collaborationPrepareRestore(version) {
        if (!this.collaborationHistoryCanRestore(version)) return;
        this.collaborationHistoryRestoreVersion = version;
        this.collaborationHistoryError = ''; this.collaborationHistoryNotice = '';
        this.$nextTick(() => this.$refs.collaborationRestorePreview?.scrollIntoView({ block: 'nearest' }));
      },
      async collaborationConfirmRestore() {
        const version = this.collaborationHistoryRestoreVersion, event = this.collaborationHistoryEvent;
        if (!this.collaborationHistoryCanRestore(version)) return;
        const context = this.collaborationContext;
        const sequence = this._collaborationRestoreRequest = (this._collaborationRestoreRequest || 0) + 1;
        this.collaborationHistoryRestoring = true; this.collaborationHistoryError = '';
        try {
          const result = await this.collabRestoreHistory(event.id, version, event.currentRevision ?? event.revision);
          if (context !== this.collaborationContext || sequence !== this._collaborationRestoreRequest || !this.collaborationHistoryVisible) return;
          this.collaborationHistoryRestoreVersion = '';
          await this.collaborationRefreshHistory();
          this.collaborationHistoryNotice = result?.status === 'conflict' ? 'Your restore is preserved. Resolve the translation conflict before sharing it.' : result?.status === 'pending' ? 'Restore saved in this browser and queued for sync.' : 'Restored as a new shared history event. Earlier history is unchanged.';
        } catch (error) {
          if (context !== this.collaborationContext || sequence !== this._collaborationRestoreRequest) return;
          this.collaborationHistoryError = error.message || 'Could not restore this version.';
          this.collaborationHistoryRestoreVersion = '';
          if (error.status === 409) this.collaborationHistoryEvent = null;
        } finally { if (sequence === this._collaborationRestoreRequest) this.collaborationHistoryRestoring = false; }
      },
    },
  };
  window.CollaborationUI = { mixin };
})();
