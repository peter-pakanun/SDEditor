/* Shared dictionary audit history. All displayed content is rendered as text. */
(() => {
  const emptyFilters = () => ({ entryId: '', q: '', actor: '', action: '', origin: '', from: '', to: '' });
  const actionLabels = { add: 'Added', update: 'Changed', delete: 'Deleted', restore: 'Restored', baseline: 'Existing entry' };
  const originLabels = { edit: 'Edit', auto_merge: 'Automatic merge', conflict_resolution: 'Conflict resolved', restore: 'History restore', baseline: 'History baseline' };
  const fieldLabels = { find: 'Find', replace: 'Replace', alts: 'Alternates', tlnote: 'TL note', entry: 'Entry', order: 'Order' };
  const snapshot = entry => entry ? { _id: entry._id, find: entry.find, replace: entry.replace, alts: (entry.alts || []).map(alt => ({ _id: alt._id, find: alt.find, replace: alt.replace })), tlnote: entry.tlnote || '' } : null;
  const mixin = {
    data() { return {
      cloudHistoryVisible: false, cloudHistoryLoading: false, cloudHistoryDetailLoading: false,
      cloudHistoryError: '', cloudHistoryNotice: '', cloudHistoryFilters: emptyFilters(),
      cloudHistoryItems: [], cloudHistoryActors: [], cloudHistoryNextCursor: null,
      cloudHistoryCoverage: null, cloudHistoryRevision: 0, cloudHistoryEvent: null,
      cloudHistoryRestoreVersion: '', cloudHistoryRestoring: false,
    }; },
    computed: {
      cloudHistoryAvailable() { return !this.testMode && this.cloudSignedIn && !!this.cloudUser?.language; },
      cloudEntryHistoryAvailable() { return this.cloudHistoryAvailable && this.lang === this.cloudUser.language; },
      cloudHistoryContext() { return [this.cloudSignedIn, this.cloudUser?.id, this.cloudUser?.language, this.cloudUser?.assignmentVersion, this.lang].join('|'); },
      cloudHistoryUnavailableReason() {
        if (this.testMode) return 'Shared history is disabled in test mode.';
        if (!this.cloudSignedIn) return 'Sign in to view shared dictionary history.';
        if (!this.cloudUser?.language) return 'An admin must assign your language before shared history is available.';
        return '';
      },
      cloudEntryHistoryHint() {
        if (!this.cloudHistoryAvailable) return this.cloudHistoryUnavailableReason;
        if (!this.cloudEntryHistoryAvailable) return 'This dictionary is local only. Select your assigned language to view its shared history.';
        return 'View shared history for this entry';
      },
      cloudHistoryRestoreEntry() {
        if (!this.cloudHistoryEvent || !this.cloudHistoryRestoreVersion) return null;
        return this.cloudHistoryEvent[this.cloudHistoryRestoreVersion];
      },
    },
    watch: { cloudHistoryContext() { this.cloudHistoryAccountChanged(); } },
    methods: {
      cloudHistoryAccountChanged() {
        this._cloudHistoryRequest = (this._cloudHistoryRequest || 0) + 1;
        this._cloudHistoryDetailRequest = (this._cloudHistoryDetailRequest || 0) + 1;
        this.cloudHistoryVisible = false;
        this.cloudHistoryItems = []; this.cloudHistoryActors = []; this.cloudHistoryEvent = null;
        this.cloudHistoryRestoreVersion = ''; this.cloudHistoryError = ''; this.cloudHistoryNotice = '';
        this.cloudHistoryLoading = false; this.cloudHistoryDetailLoading = false; this.cloudHistoryRestoring = false;
        this.cloudHistoryNextCursor = null; this.cloudHistoryCoverage = null; this.cloudHistoryRevision = 0;
      },
      async cloudOpenHistory(entryId = '') {
        if (!this.cloudHistoryAvailable || (entryId && !this.cloudEntryHistoryAvailable)) return;
        this._cloudHistoryReturnFocus = document.activeElement;
        this.cloudHistoryFilters = { ...emptyFilters(), entryId };
        this.cloudHistoryVisible = true;
        this.cloudHistoryItems = []; this.cloudHistoryEvent = null; this.cloudHistoryRestoreVersion = '';
        this.cloudHistoryError = ''; this.cloudHistoryNotice = '';
        await this.$nextTick();
        this.$refs.cloudHistoryClose?.focus();
        await this.cloudLoadHistory();
      },
      cloudCloseHistory() {
        this.cloudHistoryAccountChanged();
        if (this._cloudHistoryReturnFocus?.isConnected) this._cloudHistoryReturnFocus.focus();
      },
      cloudHistoryTrapFocus(event) {
        const dialog = this.$refs.cloudHistoryDialog;
        if (!dialog) return;
        const controls = [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')].filter(el => el.getClientRects().length);
        if (!controls.length) { event.preventDefault(); dialog.focus(); return; }
        if (event.shiftKey && (document.activeElement === controls[0] || document.activeElement === dialog)) { event.preventDefault(); controls[controls.length - 1].focus(); }
        else if (!event.shiftKey && document.activeElement === controls[controls.length - 1]) { event.preventDefault(); controls[0].focus(); }
      },
      async cloudLoadHistory(append = false) {
        if (!this.cloudHistoryAvailable || !this.cloudHistoryVisible || (append && !this.cloudHistoryNextCursor)) return;
        const context = this.cloudHistoryContext;
        const sequence = this._cloudHistoryRequest = (this._cloudHistoryRequest || 0) + 1;
        this.cloudHistoryLoading = true; this.cloudHistoryError = '';
        if (!append) {
          this.cloudHistoryItems = []; this.cloudHistoryNextCursor = null;
          this.cloudHistoryEvent = null; this.cloudHistoryRestoreVersion = '';
          this._cloudHistoryDetailRequest = (this._cloudHistoryDetailRequest || 0) + 1;
          this.cloudHistoryDetailLoading = false;
        }
        try {
          const filters = append ? this._cloudHistoryAppliedFilters : Object.fromEntries(Object.entries(this.cloudHistoryFilters).map(([key, value]) => [key, value.trim()]).filter(([, value]) => value));
          if (filters.from && filters.to && filters.from > filters.to) throw new Error('Choose an end date on or after the start date.');
          if (!append) this._cloudHistoryAppliedFilters = filters;
          const result = await this._cloud.getDictionaryHistory({ ...filters, limit: 30, ...(append ? { cursor: this.cloudHistoryNextCursor } : {}) });
          if (!this.cloudHistoryVisible || context !== this.cloudHistoryContext || sequence !== this._cloudHistoryRequest) return;
          this.cloudHistoryItems = append ? [...this.cloudHistoryItems, ...result.items] : result.items;
          this.cloudHistoryNextCursor = result.nextCursor;
          this.cloudHistoryActors = result.actors;
          this.cloudHistoryCoverage = result.coverage;
          this.cloudHistoryRevision = result.revision;
        } catch (error) {
          if (this.cloudHistoryVisible && context === this.cloudHistoryContext && sequence === this._cloudHistoryRequest) this.cloudHistoryError = error.message;
        } finally {
          if (context === this.cloudHistoryContext && sequence === this._cloudHistoryRequest) this.cloudHistoryLoading = false;
        }
      },
      cloudClearHistoryFilters() { this.cloudHistoryFilters = emptyFilters(); this.cloudLoadHistory(); },
      async cloudSelectHistoryEvent(event) {
        if (!this.cloudHistoryAvailable || this.cloudHistoryRestoring) return;
        const context = this.cloudHistoryContext;
        const sequence = this._cloudHistoryDetailRequest = (this._cloudHistoryDetailRequest || 0) + 1;
        this.cloudHistoryDetailLoading = true; this.cloudHistoryError = ''; this.cloudHistoryNotice = '';
        this.cloudHistoryEvent = null; this.cloudHistoryRestoreVersion = '';
        try {
          const result = await this._cloud.getDictionaryHistoryEvent(event.id);
          if (!this.cloudHistoryVisible || context !== this.cloudHistoryContext || sequence !== this._cloudHistoryDetailRequest) return;
          this.cloudHistoryEvent = result;
          await this.$nextTick();
          this.$refs.cloudHistoryDetail?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } catch (error) {
          if (this.cloudHistoryVisible && context === this.cloudHistoryContext && sequence === this._cloudHistoryDetailRequest) this.cloudHistoryError = error.message;
        } finally {
          if (context === this.cloudHistoryContext && sequence === this._cloudHistoryDetailRequest) this.cloudHistoryDetailLoading = false;
        }
      },
      cloudHistoryDate(value) {
        if (!value) return 'Unknown date';
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? 'Unknown date' : date.toLocaleString();
      },
      cloudHistoryActor(event) { return event.actor?.name || (event.actor ? 'Translator' : 'Earlier shared data'); },
      cloudHistoryAction(event) { return actionLabels[event.action] || event.action; },
      cloudHistoryOrigin(event) { return originLabels[event.origin] || event.origin; },
      cloudHistoryChanges(event) { return (event.changes || []).map(field => fieldLabels[field] || field).join(', ') || 'No content change'; },
      cloudHistorySnapshotText(entry) {
        if (!entry) return 'Entry does not exist';
        return 'Find: ' + entry.find + '\nReplace: ' + entry.replace + '\n\nAlternates:\n' +
          ((entry.alts || []).map(alt => alt.find + ' → ' + alt.replace).join('\n') || 'None') + '\n\nTL note:\n' + (entry.tlnote || 'None');
      },
      cloudHistoryVersionCurrent(version) {
        const event = this.cloudHistoryEvent;
        return !!event && !!event[version === 'before' ? 'canRestoreBefore' : 'canRestoreAfter'] &&
          JSON.stringify(snapshot(event[version])) === JSON.stringify(snapshot(event.current));
      },
      cloudPrepareHistoryRestore(version) {
        const event = this.cloudHistoryEvent;
        if (!event || !['before', 'after'].includes(version) || this.cloudHistoryRestoring || !this.cloudHistoryAvailable || !event[version === 'before' ? 'canRestoreBefore' : 'canRestoreAfter'] || this.cloudHistoryVersionCurrent(version)) return;
        this.cloudHistoryRestoreVersion = version;
        this.cloudHistoryNotice = ''; this.cloudHistoryError = '';
        this.$nextTick(() => this.$refs.cloudHistoryRestorePreview?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
      },
      async cloudConfirmHistoryRestore() {
        const event = this.cloudHistoryEvent;
        const version = this.cloudHistoryRestoreVersion;
        if (!event || !['before', 'after'].includes(version) || !event[version === 'before' ? 'canRestoreBefore' : 'canRestoreAfter'] || !this.cloudHistoryAvailable || this.cloudHistoryRestoring || this.cloudHistoryVersionCurrent(version)) return;
        const context = this.cloudHistoryContext;
        this.cloudHistoryRestoring = true; this.cloudHistoryError = ''; this.cloudHistoryNotice = '';
        try {
          if (!await this.saveSettings()) throw new Error('Save your local changes before restoring a shared version.');
          if (!this.cloudHistoryVisible || context !== this.cloudHistoryContext) return;
          await this._cloud.restoreDictionaryHistory(event.id, version, event.currentRevision);
          if (!this.cloudHistoryVisible || context !== this.cloudHistoryContext) return;
          this.cloudHistoryRestoreVersion = '';
          await this.cloudLoadHistory();
          if (this.cloudHistoryVisible && context === this.cloudHistoryContext) this.cloudHistoryNotice = 'Version restored to the shared dictionary. The restore is recorded as a new history event.';
        } catch (error) {
          if (!this.cloudHistoryVisible || context !== this.cloudHistoryContext) return;
          this.cloudHistoryRestoreVersion = '';
          this.cloudHistoryError = error.message;
          if (error.status === 409) {
            // A new preview is required; never turn a stale confirmation into a blind retry.
            this.cloudHistoryEvent = null;
          }
        } finally { if (context === this.cloudHistoryContext) this.cloudHistoryRestoring = false; }
      },
    },
  };
  window.CloudHistoryUI = { mixin };
})();
