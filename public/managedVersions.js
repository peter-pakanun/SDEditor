/* Named source versions are catalog metadata over the existing immutable workspace. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ManagedVersions = api;
})(typeof window === 'object' ? window : globalThis, function (root) {
  'use strict';
  const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const DEFAULT_BRANCH = 'default';
  const NZ = 'Pacific/Auckland';
  const id = () => root.crypto?.randomUUID?.() || 'version-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  const parts = instant => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: NZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  function nzInstant(date, hour = 9, minute = 0) {
    const desired = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour, minute);
    let instant = desired;
    for (let i = 0; i < 3; i++) {
      const p = parts(new Date(instant));
      const actual = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
      instant += desired - actual;
    }
    return new Date(instant).toISOString();
  }
  function defaults(game, now = new Date()) {
    const p = parts(now), date = new Date(Date.UTC(+p.year, +p.month - 1, +p.day));
    const days = (8 - date.getUTCDay()) % 7 || 7;
    date.setUTCDate(date.getUTCDate() + days);
    return { name: `${p.year}-${p.month}-${p.day}_${game === 'poe2' ? 'POE2' : 'POE1'}`, deadlineAt: nzInstant(date) };
  }
  function deadlineInput(instant) { const p = parts(new Date(instant)); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`; }
  function deadlineWeekday(value) {
    const date = new Date(`${String(value || '').split('T')[0]}T00:00:00Z`);
    return Number.isFinite(date.getTime()) ? (date.getUTCDay() + 6) % 7 : '';
  }
  function nextWeekDeadline(value, weekday, now = new Date()) {
    const day = Number(weekday);
    if (weekday === '' || !Number.isInteger(day) || day < 0 || day > 6) return value;
    const p = parts(now), date = new Date(Date.UTC(+p.year, +p.month - 1, +p.day));
    // The next calendar week starts on Monday, even when today is Monday.
    date.setUTCDate(date.getUTCDate() + 7 - (date.getUTCDay() + 6) % 7 + day);
    return date.toISOString().slice(0, 10) + 'T' + (String(value || '').split('T')[1] || '09:00');
  }
  function parseDeadline(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value || '');
    if (!match) throw new Error('Choose the import deadline in New Zealand time.');
    const date = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
    if (date.getUTCFullYear() !== +match[1] || date.getUTCMonth() !== +match[2] - 1 || date.getUTCDate() !== +match[3]
      || +match[4] > 23 || +match[5] > 59) throw new Error('Choose a valid import deadline.');
    const instant = nzInstant(date, +match[4], +match[5]);
    if (deadlineInput(instant) !== value) throw new Error('That local time does not exist in New Zealand. Choose another deadline.');
    return instant;
  }
  function reminder(instant, now = Date.now()) {
    const remaining = new Date(instant).getTime() - now;
    if (!Number.isFinite(remaining)) return '';
    if (remaining <= 0) return 'Import deadline passed — awaiting collection';
    if (remaining >= 86400000) { const days = Math.ceil(remaining / 86400000); return `${days} ${days === 1 ? 'day' : 'days'} until import deadline`; }
    const hours = Math.ceil(remaining / 3600000);
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} until import deadline`;
  }
  const filename = value => String(value || 'StatDescriptions').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '') || 'StatDescriptions';
  const mixin = {
    data() { return { branchId: DEFAULT_BRANCH, versionChooserVisible: false, managedVersions: [], managedBranch: null,
      selectedManagedVersionId: '', managedVersionDetails: null, managedVersionError: '', managedOperationErrors: {}, managedVersionBusy: false,
      managedVersionsUnavailable: false, managedShowWithdrawn: false, localVersions: [], offlineVersionName: '',
      managedCatalogLoading: false, managedCatalogLoaded: false, managedLocalVersionsLoading: false, managedLocalVersionsLoaded: false,
      managedDetailsLoading: false, managedDetailsLoaded: false,
      activeManagedVersionId: '', managedActiveDetails: null, managedNow: Date.now(), managedUploadVisible: false, managedUpload: null,
      managedUploadName: '', managedUploadDeadline: '', managedUploadFile: null, managedUploadBytes: 0,
      managedUploadError: '', managedDuplicateChoices: {}, managedDuplicateVersion: null, managedMetadataVisible: false, managedMetadataVersion: null, managedMetadataName: '', managedMetadataDeadline: '',
      managedRecoveryVisible: false, managedRecoveryTeam: null }; },
    computed: {
      managedDeadlineWeekdays() { return ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']; },
      managedOnlineAvailable() { return !this.testMode && this.cloudSignedIn && !!this._cloud && !!(this.cloudCanAccessAllLanguages || this.cloudUser?.language); },
      managedSingleLanguage() {
        return !this.cloudCanAccessAllLanguages && !['manager', 'admin'].includes(this.cloudUser?.role) ? this.cloudUser?.language || '' : '';
      },
      managedSingleLanguageAccess() { return !!this.managedSingleLanguage; },
      managedCatalogScope() { return JSON.stringify([this.cloudProfileId || 'guest', this.cloudSignedIn, this.cloudUser?.assignmentVersion, this.cloudUser?.role, this.cloudUser?.language, this.gameVersion, this.branchId]); },
      managedVisibleVersions() { return this.managedVersions.filter(v => this.managedShowWithdrawn || v.status !== 'withdrawn').slice().sort((a, b) => Number(b.isHead) - Number(a.isHead) || String(b.createdAt).localeCompare(String(a.createdAt))); },
      managedSelectedVersion() { return (this.managedVersionDetails?.version?.id === this.selectedManagedVersionId ? this.managedVersionDetails.version : null) || this.managedVersions.find(v => v.id === this.selectedManagedVersionId) || null; },
      managedActiveVersion() {
        const matches = v => v?.sourceHash === this.sourceIdentity && v.branchId === this.branchId;
        return this.managedVersions.find(matches) || (matches(this.managedActiveDetails?.version) ? this.managedActiveDetails.version : null)
          || (() => { const local = this.localVersions.find(v => matches(v) && v.catalogVersionId); return local?.catalogVersion || local?.details?.version; })() || null;
      },
      managedActiveTeam() {
        if (!this.cloudCanAccessAllLanguages && this.lang !== this.cloudUser?.language) return null;
        const version = this.managedActiveVersion;
        if (!version) return null;
        const details = this.managedActiveDetails?.version?.id === version.id ? this.managedActiveDetails
          : this.managedVersionDetails?.version?.id === version.id ? this.managedVersionDetails
          : this.localVersions.find(v => v.sourceHash === version.sourceHash && v.branchId === version.branchId)?.details;
        return details?.teams?.find(team => team.language === this.lang) || null;
      },
      managedStatusLocalVersion() {
        if (!this.sourceIdentity) return null;
        const accountId = this.cloudProfileId || 'guest';
        return this.localVersions.find(version => version.sourceHash === this.sourceIdentity
          && (version.branchId || DEFAULT_BRANCH) === this.branchId && (!version.game || version.game === this.gameVersion)
          && (!version.accountId || version.accountId === accountId)) || null;
      },
      managedImportZipDisabled() {
        return !!(this.managedActiveVersion || this.managedStatusLocalVersion?.catalogVersionId);
      },
      managedStatusName() {
        const currentLocalName = this.localDescs?.sourceHash === this.sourceIdentity ? this.localDescs.versionName : '';
        return this.managedActiveVersion?.name || this.managedStatusLocalVersion?.name || currentLocalName
          || this.collaborationShortVersion || (this.sourceIdentity || '').slice(0, 12);
      },
      managedStatusReminder() {
        if (this.managedActiveVersion?.status === 'withdrawn') return 'Withdrawn · shared saves paused; local work retained for recovery.';
        if (this.managedActiveTeam?.ended) return 'Ended · further saves are outside the last collection.';
        return '';
      },
      managedStatusDeadlineTooltip() {
        return [this.managedFormatDeadline(this.managedActiveVersion?.deadlineAt), this.managedStatusReminder].filter(Boolean).join('\n');
      },
      managedStatusTooltip() {
        const version = this.managedActiveVersion, local = this.managedStatusLocalVersion;
        const lines = [this.managedStatusName, `${this.gameVersionLabel || this.gameVersion} · ${this.lang} · ${this.branchId || DEFAULT_BRANCH} branch`];
        if (version && local?.name && local.name !== version.name) lines.push('Local alias: ' + local.name);
        const zipHash = this.collaborationExportHash || this.importBaseline?.archive?.zipHash;
        if (zipHash) lines.push('ZIP SHA-256: ' + zipHash);
        if (this.sourceIdentity && this.sourceIdentity !== zipHash) lines.push('Source baseline: ' + this.sourceIdentity);
        if (version?.deadlineAt) lines.push('Import deadline: ' + this.managedFormatDeadline(version.deadlineAt));
        if (this.managedStatusReminder) lines.push(this.managedStatusReminder);
        lines.push('Open source versions.');
        return lines.filter(Boolean).join('\n');
      },
      managedOfflineVersion() { return this.localVersions.filter(v => !v.catalogVersionId && !this.managedVersions.some(m => m.sourceHash === v.sourceHash)).sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))[0] || null; },
      managedUploadGroups() { return this.managedUpload?.duplicateGroups || []; },
      managedVisibleError() { return [this.managedVersionError, ...Object.values(this.managedOperationErrors)].filter(Boolean).join('\n'); },
    },
    watch: {
      managedCatalogScope() { this.managedScopeChanged(); },
      sourceIdentity() {
        this.syncManagedWorkspaceScope();
        const key = this.managedCatalogScope;
        this.managedAssociateActive().catch(error => { if (key === this.managedCatalogScope) this.managedSetOperationError('association', error); });
      },
      branchId() { this.scheduleCollaboration?.(); this.draftScopeChanged?.(); },
      lang() { this.managedRefreshActive(); },
      managedUploadVisible(visible) { this.managedModalVisibility(visible, 'managerUploadName'); },
      managedMetadataVisible(visible) { this.managedModalVisibility(visible, 'versionMetadataName'); },
      managedRecoveryVisible(visible) { this.managedModalVisibility(visible, 'versionRecoveryClose'); },
    },
    mounted() {
      this._managedVisibility = () => { if (!document.hidden) this.refreshManagedVersions(); };
      this._managedOnline = () => this.refreshManagedVersions();
      root.addEventListener('online', this._managedOnline); document.addEventListener('visibilitychange', this._managedVisibility);
      this._managedMenuClick = event => {
        const menu = event.target?.closest?.('.versionActionMenu');
        const action = menu && event.target?.closest?.('button, a');
        this.managedCloseVersionMenus(action ? null : menu, action ? menu : null);
      };
      this._managedMenuMove = event => {
        if (!event.target?.closest?.('.versionActionMenuItems')) this.managedCloseVersionMenus();
      };
      document.addEventListener('click', this._managedMenuClick, true);
      document.addEventListener('scroll', this._managedMenuMove, true); root.addEventListener('resize', this._managedMenuMove);
      this._managedTimer = setInterval(() => { this.managedNow = Date.now(); if (!document.hidden) this.refreshManagedVersions(); }, 20000);
    },
    beforeUnmount() {
      clearInterval(this._managedTimer); this._managedScopeRun = (this._managedScopeRun || 0) + 1;
      this.closeManagedPresence(); root.removeEventListener('online', this._managedOnline); document.removeEventListener('visibilitychange', this._managedVisibility);
      document.removeEventListener('click', this._managedMenuClick, true);
      document.removeEventListener('scroll', this._managedMenuMove, true); root.removeEventListener('resize', this._managedMenuMove);
    },
    methods: {
      managedDeadlineWeekday: deadlineWeekday,
      managedNextWeekDeadline: nextWeekDeadline,
      managedCloseVersionMenus(except, returnFocus) {
        for (const menu of document.querySelectorAll('.versionActionMenu[open]')) {
          if (menu === except) continue;
          menu.open = false;
          if (menu === returnFocus) menu.querySelector('summary')?.focus();
        }
      },
      managedVersionMenuToggle(event) {
        const menu = event.currentTarget;
        if (!menu.open) return;
        this.$nextTick(() => {
          if (!menu.open || !menu.isConnected) return;
          this.managedCloseVersionMenus(menu);
          const summary = menu.querySelector('summary'), items = menu.querySelector('.versionActionMenuItems');
          if (!summary || !items) return;
          const anchor = summary.getBoundingClientRect(), box = items.getBoundingClientRect(), edge = 8;
          const left = Math.max(edge, Math.min(anchor.right - box.width, root.innerWidth - box.width - edge));
          const below = anchor.bottom + 6;
          const top = below + box.height <= root.innerHeight - edge ? below : Math.max(edge, anchor.top - box.height - 6);
          items.style.left = left + 'px'; items.style.top = top + 'px';
        });
      },
      managedModalVisibility(visible, inputId) {
        if (visible) {
          this._managedModalReturnFocus = document.activeElement;
          this.$nextTick(() => {
            const requested = document.getElementById(inputId);
            const target = requested && !requested.disabled ? requested : requested?.closest('.versionModal')
              ?.querySelector('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]');
            target?.focus();
          });
        }
        else if (this._managedModalReturnFocus?.isConnected) this._managedModalReturnFocus.focus();
      },
      managedModalKeydown(event) {
        if (event.key === 'Escape' && !this.managedVersionBusy) { event.preventDefault(); this.managedUploadVisible = false; this.managedMetadataVisible = false; this.managedRecoveryVisible = false; return; }
        if (event.key !== 'Tab') return;
        const items = [...event.currentTarget.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')].filter(el => el.getClientRects().length);
        if (!items.length) { event.preventDefault(); return; }
        const first = items[0], last = items.at(-1);
        if (event.shiftKey && (document.activeElement === first || !items.includes(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      },
      managedSetOperationError(operation, error) { this.managedOperationErrors = { ...this.managedOperationErrors, [operation]: error?.message || error || '' }; },
      managedBeginOperation(work) {
        const operation = this._managedOperation = {};
        this.managedVersionBusy = true;
        if (work) this.setBrowserWork?.('versions', { ...work, active: true, immediate: true });
        return operation;
      },
      managedFinishOperation(operation) {
        if (this._managedOperation !== operation) return;
        this._managedOperation = null; this._managedActivation = null; this.managedVersionBusy = false; this.clearBrowserWork?.('versions');
      },
      managedScopedDetails(details) {
        if (!details) return details;
        return { ...details, teams: (details.teams || []).filter(team => this.cloudCanAccessAllLanguages || team.language === this.cloudUser?.language) };
      },
      managedWorkspaceScope(sourceHash = this.sourceIdentity) { return { accountId: this.cloudProfileId || this.cloudUser?.id || 'guest', game: this.gameVersion, branchId: this.branchId || DEFAULT_BRANCH, sourceHash: sourceHash || '' }; },
      syncManagedWorkspaceScope() { if (this.gameVersion) root.OfflineStore?.setWorkspaceContext?.(this.managedWorkspaceScope()); },
      managedScopeChanged({ deferWorkspace = this.versionChooserVisible } = {}) {
        if (this.testMode || !this.gameVersionSelected || !this.offlineStoreReady) return Promise.resolve();
        const key = this.managedCatalogScope, pending = this._managedScopePending;
        if (pending?.key === key && pending.deferWorkspace === deferWorkspace) return pending.promise;
        const request = this._managedScopePending = { key, deferWorkspace };
        request.promise = this.managedLoadScope({ deferWorkspace }).finally(() => {
          if (this._managedScopePending === request) this._managedScopePending = null;
        });
        return request.promise;
      },
      async managedLoadScope({ deferWorkspace }) {
        if (this.testMode || !this.gameVersionSelected || !this.offlineStoreReady) return;
        const key = this.managedCatalogScope, run = this._managedScopeRun = (this._managedScopeRun || 0) + 1;
        const owner = JSON.stringify([this.cloudProfileId || 'guest', this.gameVersion, this.branchId]);
        const previousOwner = this._managedWorkspaceOwner;
        const previousCatalogOwner = this._managedCatalogOwner || previousOwner;
        if (previousCatalogOwner && JSON.parse(previousCatalogOwner)[0] === 'guest' && this.cloudSignedIn
          && JSON.parse(previousCatalogOwner)[1] === this.gameVersion && JSON.parse(previousCatalogOwner)[2] === this.branchId) this._managedGuestAdoptionScope = owner;
        else if (this._managedGuestAdoptionScope !== owner) this._managedGuestAdoptionScope = null;
        this._managedOperation = null; this._managedActivation = null; this.managedVersionBusy = false; this.clearBrowserWork?.('versions');
        this._managedCreateId = null; this._managedPublishId = null; this._managedCollectionIds = new Map();
        this.localVersions = []; this.offlineVersionName = ''; this.managedBranch = null; this.managedDuplicateVersion = null;
        this.managedCatalogLoaded = false; this.managedCatalogLoading = false;
        this.managedLocalVersionsLoaded = false; this.managedLocalVersionsLoading = false;
        this.managedDetailsLoaded = false; this.managedDetailsLoading = false; this._managedDetailRun = (this._managedDetailRun || 0) + 1;
        this.managedDuplicateChoices = {}; this.managedUploadError = ''; this.managedShowWithdrawn = false;
        this.closeManagedPresence(); this.managedVersionDetails = null; this.managedVersions = []; this.selectedManagedVersionId = ''; this.activeManagedVersionId = '';
        this.managedVersionError = ''; this.managedOperationErrors = {}; this.managedActiveDetails = null; this.managedUpload = null; this.managedUploadFile = null; this.managedUploadVisible = false; this.managedMetadataVisible = false; this.managedMetadataVersion = null; this.managedRecoveryVisible = false; this.managedRecoveryTeam = null;
        if (previousOwner && owner !== previousOwner && JSON.parse(previousOwner)[1] === this.gameVersion) {
          if (this.flushEditorDraft && !await this.flushEditorDraft()) return;
          if (key !== this.managedCatalogScope || run !== this._managedScopeRun) return;
          if (this._pendingSaves?.snapshot().jobs.length && !await this.waitForPendingSaves()) return;
          if (key !== this.managedCatalogScope || run !== this._managedScopeRun) return;
          const nextScope = this.managedWorkspaceScope(''); root.OfflineStore.setWorkspaceContext(nextScope);
          if (deferWorkspace) this.resetVersionedState?.();
          else {
            if (JSON.parse(previousOwner)[0] === 'guest' && this.cloudSignedIn) await root.OfflineStore.adoptGuestVersion?.(nextScope);
            if (key !== this.managedCatalogScope || run !== this._managedScopeRun) return;
            await this.loadVersionedStorage();
          }
        } else if (previousOwner && JSON.parse(previousOwner)[1] !== this.gameVersion) root.OfflineStore.setWorkspaceContext(this.managedWorkspaceScope(''));
        else if (deferWorkspace) root.OfflineStore.setWorkspaceContext(this.managedWorkspaceScope(''));
        else this.syncManagedWorkspaceScope();
        if (key !== this.managedCatalogScope || run !== this._managedScopeRun) return;
        if (!deferWorkspace) this._managedWorkspaceOwner = owner;
        this._managedCatalogOwner = owner;
        const revision = this._managedCatalogRevision || 0;
        const cache = (async () => {
          try {
            const cached = await root.OfflineStore.getVersionCatalog(this.managedWorkspaceScope(''));
            if (run === this._managedScopeRun && key === this.managedCatalogScope && revision === (this._managedCatalogRevision || 0) && cached?.length) {
              this.managedVersions = cached; this.managedCatalogLoaded = true; this.managedCatalogLoading = false;
            }
          } catch (_) { /* A missing cache does not prevent local editing. */ }
        })();
        const upload = (async () => {
          const savedUpload = await root.OfflineStore.getVersionUpload?.(this.managedWorkspaceScope(''));
          if (run !== this._managedScopeRun || key !== this.managedCatalogScope || !savedUpload || !this.cloudCanAccessAllLanguages) return;
          this._managedCreateId = savedUpload.createRequestId; this._managedPublishId = savedUpload.publishRequestId;
          this.managedUpload = savedUpload.id ? savedUpload : null; this.managedUploadName = savedUpload.name; this.managedUploadDeadline = deadlineInput(savedUpload.deadlineAt);
        })();
        await Promise.allSettled([this.managedLoadLocal(), cache, upload, this.refreshManagedVersions()]);
      },
      async managedLoadLocal() {
        const scope = this.managedWorkspaceScope(''), key = this.managedCatalogScope;
        if (!scope.game || !root.OfflineStore?.listLocalVersions) return;
        const request = this._managedLocalLoad = {};
        this.managedLocalVersionsLoading = !this.managedLocalVersionsLoaded;
        try {
          let versions = await root.OfflineStore.listLocalVersions(scope, { metadataOnly: true });
          if (key !== this.managedCatalogScope || request !== this._managedLocalLoad) return;
          if (this._managedGuestAdoptionScope === JSON.stringify([scope.accountId, scope.game, scope.branchId])) {
            const guest = await root.OfflineStore.listLocalVersions({ ...scope, accountId: 'guest' }, { metadataOnly: true });
            if (key !== this.managedCatalogScope || request !== this._managedLocalLoad) return;
            const known = new Set((versions || []).map(v => v.sourceHash));
            versions = [...versions || [], ...(guest || []).filter(v => !known.has(v.sourceHash)).map(v => ({ ...v, accountId: scope.accountId, adoptableFrom: 'guest' }))];
          }
          this.localVersions = versions || []; this.managedLocalVersionsLoaded = true;
          this.offlineVersionName = this.managedOfflineVersion?.name || this.localDescs?.versionName || '';
        } catch (error) { if (key === this.managedCatalogScope && request === this._managedLocalLoad) { this.managedLocalVersionsLoaded = true; this.managedSetOperationError('local-versions', error); } }
        finally { if (key === this.managedCatalogScope && request === this._managedLocalLoad) this.managedLocalVersionsLoading = false; }
      },
      async refreshManagedVersions() {
        if (!this.managedOnlineAvailable || !this.gameVersionSelected
          || this._managedRefreshPending && this._managedRefreshScope === this.managedCatalogScope) return;
        const key = this.managedCatalogScope, cloud = this._cloud;
        const refresh = this._managedRefreshPending = {}; this._managedRefreshScope = key;
        this.managedCatalogLoading = !this.managedCatalogLoaded;
        try {
          const result = await cloud.request('/v1/versions?' + new URLSearchParams({ game: this.gameVersion, branchId: this.branchId, ...(this.cloudCanAccessAllLanguages ? { includeWithdrawn: '1' } : {}) }));
          if (key !== this.managedCatalogScope || cloud !== this._cloud) return;
          this.managedBranch = result.branch; this.managedVersions = result.versions || []; this.managedVersionsUnavailable = false;
          this._managedCatalogRevision = (this._managedCatalogRevision || 0) + 1;
          this.managedCatalogLoaded = true; this.managedCatalogLoading = false;
          await root.OfflineStore?.setVersionCatalog?.(this.managedWorkspaceScope(''), copy(this.managedVersions));
          if (key !== this.managedCatalogScope) return;
          this.managedVersionError = '';
          if (this.versionChooserVisible && this.selectedManagedVersionId) this.managedReadDetails(this.selectedManagedVersionId, false);
          else if (this.sourceLoaded && !this.versionChooserVisible) {
            this.managedAssociateActive().then(() => { if (key === this.managedCatalogScope) this.managedSetOperationError('association', ''); })
              .catch(error => { if (key === this.managedCatalogScope) this.managedSetOperationError('association', error); });
            this.managedRefreshActive();
          }
        } catch (error) {
          if (!error.stale && key === this.managedCatalogScope) {
            this.managedVersionsUnavailable = true;
            this.managedCatalogLoaded = true;
            this.managedVersionError = error.status === 404 ? 'Online versions are unavailable on this API. You can continue your offline workspace.' : error.message;
          }
        } finally { if (this._managedRefreshPending === refresh) { this._managedRefreshPending = null; if (key === this.managedCatalogScope) this.managedCatalogLoading = false; } }
      },
      async managedAssociateActive() {
        if (this.versionChooserVisible || !this.sourceIdentity || !this.gameVersion || !root.OfflineStore?.setVersionMetadata) return;
        const version = this.managedActiveVersion;
        if (!version) { this.activeManagedVersionId = ''; this.managedActiveDetails = null; return; }
        const scope = this.managedWorkspaceScope(), key = this.managedCatalogScope;
        await root.OfflineStore.setVersionMetadata(scope, { catalogVersionId: version.id, officialName: version.name });
        if (key === this.managedCatalogScope && scope.sourceHash === this.sourceIdentity) this.activeManagedVersionId = version.id;
      },
      async managedReadDetails(versionId, explicit = true) {
        const key = this.managedCatalogScope;
        if (!explicit && this._managedDetailPending?.key === key && this._managedDetailPending.id === versionId) return;
        const generation = this._managedDetailRun = (this._managedDetailRun || 0) + 1;
        if (explicit) this.selectedManagedVersionId = versionId;
        if (this.selectedManagedVersionId !== versionId) return;
        const request = this._managedDetailPending = { key, id: versionId };
        const current = () => key === this.managedCatalogScope && generation === this._managedDetailRun
          && this.selectedManagedVersionId === versionId && request === this._managedDetailPending;
        if (this.managedVersionDetails?.version?.id !== versionId) {
          const scope = this.managedWorkspaceScope('');
          const cached = this.localVersions.find(v => v.catalogVersionId === versionId
            && (!v.accountId || v.accountId === scope.accountId) && (!v.game || v.game === scope.game)
            && (v.branchId || DEFAULT_BRANCH) === scope.branchId);
          const details = cached?.details;
          this.managedVersionDetails = details?.version?.id === versionId && details.version.sourceHash === cached.sourceHash
            && details.version.game === scope.game && (details.version.branchId || DEFAULT_BRANCH) === scope.branchId
            ? this.managedScopedDetails(details) : null;
        }
        this.managedDetailsLoaded = !!this.managedVersionDetails;
        this.managedDetailsLoading = !this.managedDetailsLoaded;
        try {
          const version = this.managedSelectedVersion;
          if (!this.managedVersionDetails && version?.sourceHash && root.OfflineStore?.getVersionMetadata) {
            const metadata = await root.OfflineStore.getVersionMetadata(this.managedWorkspaceScope(version.sourceHash));
            if (!current()) return;
            if (this.managedDetailsMatchVersion(metadata?.details, version)) {
              this.managedVersionDetails = this.managedScopedDetails(metadata.details);
              this.managedDetailsLoaded = true; this.managedDetailsLoading = false;
            }
          }
          if (!current() || !this.managedOnlineAvailable) return;
          const result = await this._cloud.request('/v1/versions/' + encodeURIComponent(versionId));
          if (!current()) return;
          if (result.version?.id !== versionId || result.version.game !== this.gameVersion
            || (result.version.branchId || DEFAULT_BRANCH) !== this.branchId) throw new Error('The selected version details do not match this game and branch.');
          this.managedVersionDetails = this.managedScopedDetails(result); this.managedVersionError = '';
          this.managedDetailsLoaded = true; this.managedDetailsLoading = false;
          if (this.sourceLoaded && result.version.sourceHash === this.sourceIdentity) this.managedActiveDetails = this.managedVersionDetails;
          await root.OfflineStore?.setVersionMetadata?.(this.managedWorkspaceScope(result.version.sourceHash), { details: copy(result), catalogVersionId: versionId, officialName: result.version.name });
          if (current()) this.openManagedPresence(versionId);
        } catch (error) { if (!error.stale && current()) this.managedVersionError = error.message; }
        finally { if (current()) { this.managedDetailsLoaded = true; this.managedDetailsLoading = false; this._managedDetailPending = null; } }
      },
      async managedRefreshActive() {
        const version = this.managedActiveVersion, key = this.managedCatalogScope, language = this.lang;
        if (this.versionChooserVisible || !this.sourceLoaded || !version || !this.managedOnlineAvailable) return;
        const scope = this.managedWorkspaceScope(version.sourceHash);
        try {
          const result = await this._cloud.request('/v1/versions/' + encodeURIComponent(version.id));
          if (key !== this.managedCatalogScope || language !== this.lang || this.managedActiveVersion?.id !== version.id) return;
          this.managedActiveDetails = this.managedScopedDetails(result);
          await root.OfflineStore.setVersionMetadata?.(scope, { details: copy(result), catalogVersionId: version.id, officialName: version.name });
        }
        catch (_) { /* A background detail failure does not interrupt the editor. */ }
      },
      async showVersionChooser() {
        if (this.flushEditorDraft && !await this.flushEditorDraft()) return false;
        if (this._pendingSaves?.snapshot().jobs.length && !await this.waitForPendingSaves()) return false;
        if (this.editorSessionActive && this.editorExit) { await this.editorExit(); if (this.editorSessionActive) return false; }
        this.versionChooserVisible = true; await this.managedLoadLocal(); await this.refreshManagedVersions(); return true;
      },
      managedCached(version) { return this.localVersions.some(v => v.hasSource && v.sourceHash === version.sourceHash && v.branchId === version.branchId); },
      managedRowActionTarget(event) { return !!event?.target?.closest?.('a, button, input, select, textarea, summary, details, [role="button"]'); },
      managedSelectVersionRow(version, event) {
        if (this.managedVersionBusy || this.managedRowActionTarget(event)) return;
        return this.managedReadDetails(version.id);
      },
      managedOpenVersionRow(version, event) {
        if (this.managedRowActionTarget(event)) return false;
        return this.managedOpenVersion(version);
      },
      managedOpenVersion(version) {
        if (!this.managedSingleLanguageAccess) return false;
        return this.continueManagedVersion(version, this.managedSingleLanguage);
      },
      managedOpenTeam(version, team, event) {
        if (!team || this.managedRowActionTarget(event)) return false;
        return this.continueManagedVersion(version, team.language);
      },
      managedDetailsForVersion(version) {
        const matches = details => this.managedDetailsMatchVersion(details, version);
        if (matches(this.managedVersionDetails)) return this.managedScopedDetails(this.managedVersionDetails);
        if (matches(this.managedActiveDetails)) return this.managedScopedDetails(this.managedActiveDetails);
        const scope = this.managedWorkspaceScope(version.sourceHash);
        const cached = this.localVersions.find(v => v.catalogVersionId === version.id && v.sourceHash === scope.sourceHash
          && (!v.accountId || v.accountId === scope.accountId) && (!v.game || v.game === scope.game)
          && (v.branchId || DEFAULT_BRANCH) === scope.branchId);
        return matches(cached?.details) ? this.managedScopedDetails(cached.details) : null;
      },
      managedDetailsMatchVersion(details, version) {
        return !!version && details?.version?.id === version.id && details.version.sourceHash === version.sourceHash
          && details.version.game === version.game && (details.version.branchId || DEFAULT_BRANCH) === (version.branchId || DEFAULT_BRANCH);
      },
      async managedAdoptGuestOnOpen(scope) {
        const owner = JSON.stringify([scope.accountId, scope.game, scope.branchId]);
        const candidate = this.localVersions.find(v => v.sourceHash === scope.sourceHash && v.adoptableFrom === 'guest');
        if (this._managedGuestAdoptionScope !== owner || (scope.sourceHash && !candidate)) return null;
        return root.OfflineStore.adoptGuestVersion?.(scope);
      },
      async continueOfflineVersion() {
        const version = this.managedOfflineVersion, key = this.managedCatalogScope, run = this._managedScopeRun;
        const request = this._managedOfflineEntry = {};
        const current = () => key === this.managedCatalogScope && run === this._managedScopeRun && request === this._managedOfflineEntry;
        try {
          if (version && !await this.managedActivateWorkspace(version.sourceHash)) return false;
          if (!current()) return false;
          if (!version) { this.activeManagedVersionId = ''; this.versionChooserVisible = false; if (!this.sourceLoaded) this.showImportUpdateZipDialog(); }
          this.managedSetOperationError('offline-entry', ''); return true;
        } catch (error) { if (!error.stale && current()) this.managedSetOperationError('offline-entry', error); return false; }
      },
      async managedImportOffline(translated = false) {
        const version = this.managedOfflineVersion, key = this.managedCatalogScope, run = this._managedScopeRun;
        const request = this._managedOfflineEntry = {};
        const current = () => key === this.managedCatalogScope && run === this._managedScopeRun && request === this._managedOfflineEntry;
        try {
          if (version && !await this.managedActivateWorkspace(version.sourceHash)) return false;
          if (!current()) return false;
          this.versionChooserVisible = false;
          if (translated) this.importTranslatedZipClicked(); else this.showImportUpdateZipDialog();
          this.managedSetOperationError('offline-entry', ''); return true;
        } catch (error) { if (!error.stale && current()) this.managedSetOperationError('offline-entry', error); return false; }
      },
      async managedActivateWorkspace(sourceHash, language) {
        const key = this.managedCatalogScope; let scope = this.managedWorkspaceScope(sourceHash);
        const activation = this._managedActivation = {};
        const current = () => key === this.managedCatalogScope && this._managedActivation === activation;
        if (this.flushEditorDraft && !await this.flushEditorDraft()) return false;
        if (!current()) return false;
        if (this._pendingSaves?.snapshot().jobs.length && !await this.waitForPendingSaves()) return false;
        if (!current()) return false;
        const adopted = await this.managedAdoptGuestOnOpen(scope);
        if (!current()) return false;
        if (adopted) scope = adopted;
        if (root.OfflineStore.resolveVersionScope) scope = await root.OfflineStore.resolveVersionScope(scope);
        if (!current()) return false;
        if (!scope.sourceHash && !scope.legacyWorkspacePending) throw new Error('This stored workspace is not available for the current account. Switch to the account or local profile that created it. Its stored work has been preserved.');
        const activated = scope.sourceHash ? await root.OfflineStore.activateVersion(scope) : null;
        if (!current()) return false;
        if (activated?.metadata?.details) this.managedActiveDetails = this.managedScopedDetails(activated.metadata.details);
        if (this.editorSessionActive) { this.editorVisible = false; this.inlineActive = false; }
        this._managedEditAcknowledged = '';
        if (language) this.lang = language;
        root.OfflineStore.setWorkspaceContext(scope); this.versionChooserVisible = false;
        await this.loadVersionedStorage();
        if (!current()) return false;
        this._managedWorkspaceOwner = JSON.stringify([scope.accountId, scope.game, scope.branchId]);
        if (!this.sourceLoaded || this.sourceIdentity !== scope.sourceHash) return false;
        await this.managedAssociateActive(); await this.managedRefreshActive(); return true;
      },
      async continueManagedVersion(version = this.managedSelectedVersion, language) {
        if (!version || this.managedVersionBusy) return;
        if (version.game !== this.gameVersion || (version.branchId || DEFAULT_BRANCH) !== this.branchId) {
          this.managedSetOperationError('open', 'Select a source version in the current game and branch.'); return false;
        }
        const targetLanguage = language || (this.cloudCanAccessAllLanguages ? this.lang : this.managedSingleLanguage);
        if (!targetLanguage || (!this.cloudCanAccessAllLanguages && targetLanguage !== this.managedSingleLanguage)) {
          this.managedSetOperationError('open', 'Select a language you have access to.'); return false;
        }
        const scope = this.managedWorkspaceScope(version.sourceHash), key = this.managedCatalogScope;
        const operation = this.managedBeginOperation({ key: 'open', label: 'Preparing selected source version' });
        const current = () => key === this.managedCatalogScope && operation === this._managedOperation;
        try {
          if (this.flushEditorDraft && !await this.flushEditorDraft()) return;
          if (!current()) return;
          if (this._pendingSaves?.snapshot().jobs.length && !await this.waitForPendingSaves()) return;
          if (!current()) return;
          await this.managedAdoptGuestOnOpen(scope);
          if (!current()) return;
          const source = await root.OfflineStore.getVersionSource(scope);
          if (!current()) return;
          let details = this.managedDetailsForVersion(version);
          if (!details && root.OfflineStore.getVersionMetadata) {
            const metadata = await root.OfflineStore.getVersionMetadata(scope);
            if (!current()) return;
            if (this.managedDetailsMatchVersion(metadata?.details, version)) details = this.managedScopedDetails(metadata.details);
          }
          if (this.managedOnlineAvailable) {
            try {
              const result = await this._cloud.request('/v1/versions/' + encodeURIComponent(version.id));
              if (!current()) return;
              if (result.version?.id !== version.id || result.version.sourceHash !== scope.sourceHash
                || result.version.game !== scope.game || (result.version.branchId || DEFAULT_BRANCH) !== scope.branchId) {
                const error = new Error('The selected source version changed. Select it again before opening.');
                error.code = 'VERSION_IDENTITY_CHANGED'; throw error;
              }
              details = this.managedScopedDetails(result); version = details.version;
            } catch (error) {
              if (!current()) return;
              if (!source?.length || error.code === 'VERSION_IDENTITY_CHANGED' || error.status === 401 || error.status === 403 || error.status === 404) throw error;
              // Retained source and version facts remain usable during a connection failure.
            }
          }
          const targetTeam = details?.teams?.find(team => team.language === targetLanguage)
            || (version.assignedTeam?.language === targetLanguage ? version.assignedTeam : null);
          const warning = this.managedVersionOpenWarning(version, targetTeam, targetLanguage);
          const acknowledgedWindow = targetTeam?.ended || version.status === 'withdrawn'
            ? this.managedEditWarningKey(version, targetLanguage, targetTeam) : '';
          if (warning && !await this.appConfirm(warning, { title: 'Open source version?', confirmLabel: 'Open editor', danger: false })) return false;
          if (!current()) return;
          if (!source?.length) {
            if (!this.managedOnlineAvailable) throw new Error('Download this source version once while connected before working offline.');
            const blob = await this._cloud.request('/v1/versions/' + encodeURIComponent(version.id) + '/original', { responseType: 'blob', timeout: 120000 });
            if (!current()) return;
            const zip = await root.JSZip.loadAsync(blob), rawSource = [];
            if (!current()) return;
            const archive = (await this._cloud.request('/v1/collaboration/archives/' + version.game + '/' + version.zipHash)).archive;
            if (!current()) return;
            for (const entry of Object.values(zip.files).filter(e => !e.dir && e.name.toLowerCase().endsWith('.txt'))) {
              const desc = await root.parseFile(entry.name, entry, targetLanguage, { strict: true });
              if (desc) rawSource.push(desc);
              if (!current()) return;
            }
            const identity = await this.readImportZipIdentity(blob, zip);
            if (!current()) return;
            if (identity.zipHash !== version.zipHash) throw new Error('The downloaded ZIP does not match this published version. Existing work has been preserved.');
            const baseline = await this.buildImportedBaseline(identity, rawSource, [], archive);
            if (!current()) return;
            const workspace = { descs: [], status: {}, branchId: scope.branchId, sourceHash: version.sourceHash, importArchive: baseline.archive, catalogVersionId: version.id };
            root.WorkspaceState.initializeWorkspace(workspace, { game: version.game, branchId: scope.branchId, sourceHash: version.sourceHash, source: baseline.source, language: targetLanguage });
            await root.OfflineStore.saveSourceWorkspaceWithRevisions(copy(baseline.source), workspace, [], scope, baseline);
          }
          if (!current()) return;
          await root.OfflineStore.setVersionMetadata(scope, { catalogVersionId: version.id, officialName: version.name, ...(details ? { details: copy(details) } : {}) });
          if (!current()) return;
          const opened = await this.managedActivateWorkspace(version.sourceHash, targetLanguage);
          if (opened && current()) {
            this.managedSetOperationError('open', '');
            if (acknowledgedWindow && this.managedActiveVersion?.id === version.id
              && acknowledgedWindow === this.managedEditWarningKey(this.managedActiveVersion, this.lang, this.managedActiveTeam)) {
              this._managedEditAcknowledged = acknowledgedWindow;
            }
          }
          return opened;
        } catch (error) { if (!error.stale && current()) this.managedSetOperationError('open', error); return false; }
        finally { this.managedFinishOperation(operation); }
      },
      async managedOpenDropped(team) {
        const version = this.managedSelectedVersion, key = this.managedCatalogScope;
        if (await this.continueManagedVersion(version, team.language) && key === this.managedCatalogScope
          && this.sourceIdentity === version.sourceHash && this.lang === team.language) {
          this.selectedFileFilters = ['dropped']; this.searchText = ''; this.applyFileSearch();
        }
      },
      managedShowRecoveries(team) { this.managedRecoveryTeam = team; this.managedRecoveryVisible = true; },
      async managedOpenRecoveryFile(reference) {
        const key = this.managedCatalogScope, version = this.managedSelectedVersion, team = this.managedRecoveryTeam;
        if (!version || !team || !await this.continueManagedVersion(version, team.language)) return;
        if (key !== this.managedCatalogScope || this.sourceIdentity !== version.sourceHash || this.lang !== team.language) return;
        const desc = this.getDescByFilepath(reference.filepath);
        if (!desc) { await this.appAlert('This file is absent from the selected source version. Its preserved text remains available in the inherited copies view.'); return; }
        this.managedRecoveryVisible = false;
        await this.editFile(reference.filepath);
        if (key === this.managedCatalogScope && this.sourceIdentity === version.sourceHash && this.editorCurrentEditingDesc?.filepath === reference.filepath) {
          this.sideTab = 'history'; await this.refreshHistory();
        }
      },
      async saveOfflineVersionName() {
        const version = this.managedOfflineVersion, sourceHash = version?.sourceHash || this.sourceIdentity;
        const key = this.managedCatalogScope, workspace = this.localDescs, scope = this.managedWorkspaceScope(sourceHash);
        if (!sourceHash) return;
        const name = this.offlineVersionName.trim();
        if (!name) { this.managedVersionError = 'Enter a name for this offline version.'; return; }
        await root.OfflineStore.setVersionMetadata(scope, { name });
        if (key !== this.managedCatalogScope) return;
        if (sourceHash === this.sourceIdentity && workspace === this.localDescs) this.localDescs.versionName = name;
        await this.managedLoadLocal();
      },
      managedFormatDeadline(instant) {
        if (!instant) return '';
        const date = new Date(instant);
        return new Intl.DateTimeFormat(undefined, { timeZone: NZ, dateStyle: 'medium', timeStyle: 'short' }).format(date) + ' New Zealand · ' + new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date) + ' local';
      },
      managedFormatDate(instant) { return new Date(instant).toLocaleString(); },
      managedDeadlineTooltip(instant) { return this.managedFormatDeadline(instant); },
      managedTimestampTooltip(instant) { return instant ? this.managedFormatDate(instant) + ' local' : ''; },
      managedReminder(instant) { return reminder(instant, this.managedNow); },
      managedVersionEnded(version) {
        if (!this.cloudCanAccessAllLanguages) return !!version.assignedTeam?.ended;
        const teamCount = version.teamCount || 12;
        return teamCount > 0 && version.endedTeamCount >= teamCount;
      },
      managedProgress(team) {
        const count = value => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
        const missing = count(team.counts?.missing), saved = count(team.counts?.saved);
        const revised = Math.min(saved, count(team.counts?.revised)), total = missing + saved;
        const ordinarySaved = saved - revised, width = value => total ? `${100 * value / total}%` : '0%';
        return { missing, saved, revised, ordinarySaved, total, percent: total ? Math.round(100 * saved / total) : 0,
          missingWidth: width(missing), savedWidth: width(ordinarySaved), revisedWidth: width(revised) };
      },
      managedProgressTooltip(team) {
        const progress = this.managedProgress(team);
        return `${team.language} progress\nSaved: ${progress.saved} / ${progress.total} (${progress.percent}%)\nMissing: ${progress.missing}\nRevised: ${progress.revised} (included in Saved)\nWorkload denominator: Missing + Saved. Status counts can overlap.\nOnly server-accepted work is counted; unsaved drafts and pending offline saves are excluded.`;
      },
      managedExistingTeamTooltip(team) {
        const online = (team.presence || []).map(peer => peer.name || peer.displayName || peer.userName || 'Translator');
        return `${team.language} · ${team.isManaged ? 'Published room' : 'Standalone / Offline import'}\nSaved: ${team.counts?.saved ?? team.savedFileCount ?? 0} · Missing: ${team.counts?.missing || 0} · Revised: ${team.counts?.revised || 0}\nDropped: ${team.counts?.dropped || 0} · Shared history: ${team.historyCount || 0} changes\n${online.length ? 'Online: ' + online.join(', ') : 'No translators currently online.'}\nThis existing room and its work will be reused. Unuploaded offline work and local drafts are not visible here.`;
      },
      managedVersionOpenWarning(version, team, language) {
        const warnings = [];
        if (!version.isHead) warnings.push('“' + version.name + '” is not HEAD. You are opening an older source version.');
        if (team?.ended) warnings.push('The ' + language + ' team’s translation window has ended. Further saves are allowed, but they will not change the ZIP already collected by the manager.');
        if (version.status === 'withdrawn') warnings.push('This source version was withdrawn. Shared saves are paused; local work remains available for recovery.');
        return warnings.join('\n\n');
      },
      managedEditWarningKey(version, language, team) {
        return JSON.stringify([this.managedCatalogScope, version?.id, language, team?.latestCollection?.id || team?.latestCollectionId || null, version?.status]);
      },
      async managedWarnBeforeEdit() {
        const version = this.managedActiveVersion, team = this.managedActiveTeam;
        if (!version || (!team?.ended && version.status !== 'withdrawn')) return true;
        const key = this.managedEditWarningKey(version, this.lang, team);
        if (this._managedEditAcknowledged === key) return true;
        if (this._managedWarnPending) return this._managedWarnPending;
        this._managedWarnPending = (async () => {
          const accepted = await this.appConfirm(version.status === 'withdrawn' ? 'This source version was withdrawn. Shared saves are paused; local drafts and existing work remain available for recovery. Continue editing only if you intend to work on this withdrawn version.' : 'This team’s version has been collected and marked ended. Further saves are allowed, but they will not change the ZIP already collected by the manager.', { title: version.status === 'withdrawn' ? 'Withdrawn source version' : 'Translation window ended', confirmLabel: 'Continue editing', danger: false });
          if (accepted && key === this.managedEditWarningKey(this.managedActiveVersion, this.lang, this.managedActiveTeam)) this._managedEditAcknowledged = key;
          return accepted;
        })().finally(() => { this._managedWarnPending = null; });
        return this._managedWarnPending;
      },
      async managedDownload(path, name) {
        const key = this.managedCatalogScope;
        try { const blob = await this._cloud.request(path, { responseType: 'blob', timeout: 120000 }); if (key === this.managedCatalogScope) { root.saveAs(blob, name); this.managedSetOperationError(path, ''); return true; } }
        catch (error) { if (!error.stale && key === this.managedCatalogScope) this.managedSetOperationError(path, error); }
        return false;
      },
      managedDownloadOriginal(version = this.managedSelectedVersion) { if (version) return this.managedDownload('/v1/versions/' + encodeURIComponent(version.id) + '/original', filename(version.name) + '_StatDescriptions.zip'); },
      async managedCollect(team, endWindow = true) {
        const version = this.managedSelectedVersion, key = this.managedCatalogScope;
        if (!version || this.managedVersionBusy || !this.cloudCanAccessAllLanguages) return;
        const action = endWindow ? (team.counts.saved ? 'Download and mark ended' : 'Mark ended — no saved files') : 'Download only';
        const errorKey = endWindow ? 'collect' : 'downloadOnly';
        const operation = this.managedBeginOperation();
        const current = () => key === this.managedCatalogScope && operation === this._managedOperation;
        try {
          if (endWindow && !await this.appConfirm(`Collect ${team.language} for ${version.name}? Only server-accepted Saved work is included. Unsaved drafts and pending offline uploads are outside this snapshot.${team.presence?.length ? '\n\nTranslators are currently online in this version.' : ''}`, { title: action, confirmLabel: action, danger: false })) return;
          if (!current()) return;
          this.setBrowserWork?.('versions', { key: 'collection', label: 'Preparing translated ZIP', active: true, immediate: true });
          this._managedCollectionIds ||= new Map();
          const requestScope = this.managedWorkspaceScope('');
          const requestKey = JSON.stringify([requestScope.accountId, requestScope.game, requestScope.branchId, version.id, team.language, endWindow]);
          const requestId = this._managedCollectionIds.get(requestKey) || await root.OfflineStore.getVersionCollectionRequest?.(requestScope, version.id, team.language, endWindow) || id();
          if (!current()) return;
          this._managedCollectionIds.set(requestKey, requestId);
          await root.OfflineStore.setVersionCollectionRequest?.(requestScope, version.id, team.language, requestId, endWindow);
          if (!current()) return;
          let result = await this._cloud.request('/v1/versions/' + encodeURIComponent(version.id) + '/teams/' + encodeURIComponent(team.language) + (endWindow ? '/collections' : '/downloads'), { method: 'POST', body: { idempotencyKey: requestId, ...(!endWindow ? { endWindow: false } : {}) }, timeout: 120000 });
          if (!current()) return;
          let collection = result.collection || result;
          while (['preparing', 'pending', 'building'].includes(collection.status)) {
            await new Promise(resolve => setTimeout(resolve, 500)); if (!current()) return;
            result = await this._cloud.request('/v1/collections/' + encodeURIComponent(collection.id)); collection = result.collection || result;
            if (!current()) return;
          }
          if (collection.status === 'failed') throw new Error(collection.error?.message || 'Could not prepare the collection. Retry the same request.');
          if (!current()) return;
          if (collection.downloadReady !== false && (collection.fileCount ?? team.counts.saved) > 0) {
            const downloaded = await this.managedDownload('/v1/collections/' + encodeURIComponent(collection.id) + '/archive', filename(version.name) + '_Translated_' + filename(team.language) + '.zip');
            if (downloaded === false) return;
          }
          if (!current()) return;
          this._managedCollectionIds.delete(requestKey);
          await root.OfflineStore.setVersionCollectionRequest?.(requestScope, version.id, team.language, null, endWindow);
          if (!current()) return;
          this.managedSetOperationError(errorKey, '');
          await this.managedReadDetails(version.id, false); await this.refreshManagedVersions();
        } catch (error) { if (!error.stale && current()) this.managedSetOperationError(errorKey, error); }
        finally { this.managedFinishOperation(operation); }
      },
      managedDownloadCollection(team) { if (team.latestCollection?.id) return this.managedDownload('/v1/collections/' + encodeURIComponent(team.latestCollection.id) + '/archive', filename(this.managedSelectedVersion.name) + '_Translated_' + filename(team.language) + '.zip'); },
      managedDownloadPrevious(team, event) {
        const collection = team.collections?.find(c => c.id === event.target.value);
        event.target.value = '';
        if (collection?.downloadReady) return this.managedDownload('/v1/collections/' + encodeURIComponent(collection.id) + '/archive', filename(this.managedSelectedVersion.name) + '_Translated_' + filename(team.language) + '.zip');
      },
      async managedReopen(team) { await this.managedAction('/v1/versions/' + encodeURIComponent(this.managedSelectedVersion.id) + '/teams/' + encodeURIComponent(team.language) + '/reopen', {}); },
      async managedAction(path, body) {
        if (this.managedVersionBusy || !this.cloudCanAccessAllLanguages) return;
        const key = this.managedCatalogScope, operation = this.managedBeginOperation();
        const current = () => key === this.managedCatalogScope && operation === this._managedOperation;
        try { await this._cloud.request(path, { method: 'POST', body: { ...body, idempotencyKey: id() } }); if (current()) { this.managedSetOperationError(path, ''); await this.refreshManagedVersions(); } }
        catch (error) { if (!error.stale && current()) this.managedSetOperationError(path, error); }
        finally { this.managedFinishOperation(operation); }
      },
      async managedWithdraw(version = this.managedSelectedVersion) {
        if (!version || this.managedVersionBusy || !this.cloudCanAccessAllLanguages) return;
        const key = this.managedCatalogScope, requestId = id(), path = '/v1/versions/' + encodeURIComponent(version.id) + '/withdraw';
        const operation = this.managedBeginOperation(), current = () => key === this.managedCatalogScope && operation === this._managedOperation;
        try {
          try { await this._cloud.request(path, { method: 'POST', body: { expectedRevision: version.revision, idempotencyKey: requestId } }); }
          catch (error) {
            if (!current()) return;
            if (error.code !== 'VERSION_IN_USE') throw error;
            if (!await this.appConfirm('This version has team work, a collection, or active editors. Withdraw it from ordinary selection while preserving all rooms, translations, history, and recovery access?', { title: 'Withdraw worked-on version?', confirmLabel: 'Withdraw and preserve work', danger: true })) return;
            if (!current()) return;
            await this._cloud.request(path, { method: 'POST', body: { expectedRevision: version.revision, confirmed: true, idempotencyKey: requestId } });
          }
          if (current()) { this.managedSetOperationError(path, ''); await this.refreshManagedVersions(); }
        } catch (error) { if (!error.stale && current()) this.managedSetOperationError(path, error); }
        finally { this.managedFinishOperation(operation); }
      },
      managedRestore(version) {
        const head = this.managedBranch?.headVersionId ?? null;
        return this.managedAction('/v1/versions/' + encodeURIComponent(version.id) + '/restore', { setHead: head === null, expectedHeadId: head });
      },
      openManagedMetadata(version = this.managedSelectedVersion) {
        if (!version || this.managedVersionBusy || !this.cloudCanAccessAllLanguages) return;
        this.managedMetadataVersion = copy(version); this.managedMetadataName = version.name;
        this.managedMetadataDeadline = deadlineInput(version.deadlineAt); this.managedMetadataVisible = true;
      },
      async saveManagedMetadata() {
        const version = this.managedMetadataVersion || this.managedSelectedVersion, key = this.managedCatalogScope; if (!version || this.managedVersionBusy || !this.cloudCanAccessAllLanguages) return;
        const operation = this.managedBeginOperation(), current = () => key === this.managedCatalogScope && operation === this._managedOperation;
        try { await this._cloud.request('/v1/versions/' + encodeURIComponent(version.id), { method: 'PATCH', body: { name: this.managedMetadataName.trim(), deadlineAt: parseDeadline(this.managedMetadataDeadline), expectedRevision: version.revision, idempotencyKey: id() } }); if (current()) { this.managedSetOperationError('metadata', ''); this.managedMetadataVisible = false; await this.refreshManagedVersions(); } }
        catch (error) { if (!error.stale && current()) this.managedSetOperationError('metadata', error); }
        finally { this.managedFinishOperation(operation); }
      },
      async openManagedUpload() {
        if (this.managedVersionBusy || !this.cloudCanAccessAllLanguages) return;
        if (!this.managedUpload && !this._managedCreateId) { const d = defaults(this.gameVersion); this.managedUploadName = d.name; this.managedUploadDeadline = deadlineInput(d.deadlineAt); this.managedUploadFile = null; this.managedUploadBytes = 0; this.managedDuplicateChoices = {}; }
        this.managedUploadVisible = true; this.managedUploadError = ''; this.managedDuplicateVersion = null;
        if (!this.managedUpload?.id || !this.managedOnlineAvailable) return;
        const key = this.managedCatalogScope, scope = this.managedWorkspaceScope('');
        const operation = this.managedBeginOperation({ key: 'resume-upload', label: 'Loading prepared upload details' });
        const current = () => key === this.managedCatalogScope && operation === this._managedOperation;
        try {
          const result = await this._cloud.request('/v1/version-uploads/' + encodeURIComponent(this.managedUpload.id));
          if (!current()) return;
          this.managedUpload = result.upload;
          if (result.upload?.status === 'published') {
            if (await this.managedCompletePublication(scope, result, key, current)) await this.refreshManagedVersions();
          }
        } catch (error) { if (!error.stale && current()) this.managedUploadError = error.message; }
        finally { this.managedFinishOperation(operation); }
      },
      async managedCompletePublication(scope, result, key = this.managedCatalogScope, stillCurrent = () => true) {
        const versionId = result.version?.id || result.upload?.publishedVersionId;
        if (!versionId) throw new Error('The published version acknowledgement is incomplete. Retry the same upload.');
        await root.OfflineStore.setVersionUpload?.(scope, null);
        if (key !== this.managedCatalogScope || !stillCurrent()) return false;
        this.managedUpload = null; this.managedUploadFile = null; this.managedUploadVisible = false;
        this._managedPublishId = null; this._managedCreateId = null; this.managedUploadError = ''; this.managedDuplicateVersion = null;
        this.selectedManagedVersionId = versionId;
        return true;
      },
      async managedOpenDuplicateVersion() {
        const version = this.managedDuplicateVersion;
        if (!version) return;
        this.managedUploadVisible = false; this.versionChooserVisible = true;
        this.managedShowWithdrawn = version.status === 'withdrawn';
        await this.managedReadDetails(version.id);
      },
      managedRememberUpload(scope = this.managedWorkspaceScope('')) {
        const upload = this.managedUpload;
        return root.OfflineStore.setVersionUpload?.(scope, { id: upload?.id || null, game: scope.game, branchId: scope.branchId,
          name: upload?.name || this.managedUploadName, deadlineAt: upload?.deadlineAt || parseDeadline(this.managedUploadDeadline),
          status: upload?.status || 'awaiting_archive', parentVersionId: upload?.parentVersionId || null,
          createRequestId: this._managedCreateId, publishRequestId: this._managedPublishId });
      },
      async discardManagedUpload() {
        if (this.managedVersionBusy) return;
        const key = this.managedCatalogScope;
        await root.OfflineStore.setVersionUpload?.(this.managedWorkspaceScope(''), null);
        if (key !== this.managedCatalogScope) return;
        this.managedUpload = null; this.managedUploadFile = null; this._managedCreateId = null; this._managedPublishId = null; this.managedUploadBytes = 0; this.managedDuplicateVersion = null;
        this.openManagedUpload();
      },
      managedChooseUpload(event) { this.managedUploadFile = event.target.files?.[0] || null; },
      async prepareManagedUpload() {
        if (this.managedVersionBusy || !this.cloudCanAccessAllLanguages) return;
        const key = this.managedCatalogScope, scope = this.managedWorkspaceScope('');
        const operation = this.managedBeginOperation({ key: 'upload', label: 'Preparing manager upload' });
        const current = () => key === this.managedCatalogScope && operation === this._managedOperation;
        try {
          if (!this.managedUpload) {
            if (!this.managedUploadFile) throw new Error('Select StatDescriptions.zip.');
            this._managedCreateId ||= id(); await this.managedRememberUpload(scope);
            if (!current()) return;
            const result = await this._cloud.request('/v1/version-uploads', { method: 'POST', body: { game: scope.game, branchId: scope.branchId, name: this.managedUploadName.trim(), deadlineAt: parseDeadline(this.managedUploadDeadline), idempotencyKey: this._managedCreateId } });
            if (!current()) return; this.managedUpload = result.upload;
            await this.managedRememberUpload(scope);
            if (!current()) return;
          }
          const uploadId = this.managedUpload.id;
          if (this.managedUpload.status === 'published') {
            if (await this.managedCompletePublication(scope, { upload: this.managedUpload }, key, current)) await this.refreshManagedVersions();
            return;
          }
          if (this.managedUpload.status === 'awaiting_archive') {
            if (!this.managedUploadFile) throw new Error('Select the original ZIP again to resume this upload.');
            const result = await this._cloud.request('/v1/version-uploads/' + encodeURIComponent(uploadId) + '/archive', { method: 'PUT', rawBody: this.managedUploadFile, timeout: 180000, onUploadProgress: (loaded, total) => { if (current()) { this.managedUploadBytes = loaded; this.setBrowserWork?.('versions', { key: 'upload', label: total ? `Uploading original ZIP · ${Math.round(loaded * 100 / total)}%` : 'Uploading original ZIP', active: true, immediate: true }); } } });
            if (!current()) return; this.managedUpload = result.upload;
            await this.managedRememberUpload(scope);
            if (!current()) return;
          }
          const decisions = [];
          for (const group of this.managedUploadGroups) {
            const option = group.options.find(o => String(o.occurrence) === String(this.managedDuplicateChoices[group.filepath + '|' + (group.language || group.lang)]));
            if (!option) throw new Error('Select one language block for each duplicate before preparing.');
            decisions.push({ filepath: group.filepath, language: group.language || group.lang, occurrence: option.occurrence, blockHash: option.blockHash || await root.CollaborationProtocol.blockHash(option) });
            if (!current()) return;
          }
          this.setBrowserWork?.('versions', { key: 'upload', label: 'Parsing source and preparing all teams', active: true, immediate: true });
          let result = await this._cloud.request('/v1/version-uploads/' + encodeURIComponent(uploadId) + '/prepare', { method: 'POST', body: { decisions }, timeout: 120000 });
          if (!current()) return; this.managedUpload = result.upload;
          while (['preparing', 'uploaded'].includes(this.managedUpload.status)) {
            await new Promise(resolve => setTimeout(resolve, 500)); if (!current()) return;
            result = await this._cloud.request('/v1/version-uploads/' + encodeURIComponent(uploadId));
            if (!current()) return; this.managedUpload = result.upload;
            const progress = Number(this.managedUpload.progress);
            this.setBrowserWork?.('versions', { key: 'upload', label: progress < 60 ? 'Parsing source'
              : `Preparing teams${this.managedUpload.completedTeams != null ? ' · ' + this.managedUpload.completedTeams + '/12' : ''}`, active: true, immediate: true });
          }
          if (this.managedUpload.status === 'published') {
            if (await this.managedCompletePublication(scope, result, key, current)) await this.refreshManagedVersions();
            return;
          }
          if (result.duplicateVersion) { this.managedDuplicateVersion = copy(result.duplicateVersion); throw new Error('This ZIP already has a published entry. Open that entry to manage it.'); }
          if (this.managedUpload.status === 'failed') throw new Error(this.managedUpload.error?.message || 'Upload preparation failed.');
          await this.managedRememberUpload(scope);
          if (!current()) return;
          this.managedUploadError = '';
        } catch (error) { if (!error.stale && current()) { this.managedUploadError = error.message; this.managedDuplicateVersion = copy(error.details?.version || this.managedDuplicateVersion); } }
        finally { this.managedFinishOperation(operation); }
      },
      async publishManagedUpload() {
        if (this.managedVersionBusy || !this.cloudCanAccessAllLanguages || !['prepared', 'published'].includes(this.managedUpload?.status)) return;
        const key = this.managedCatalogScope, scope = this.managedWorkspaceScope(''), requestId = this._managedPublishId ||= id();
        const operation = this.managedBeginOperation({ key: 'publish', label: 'Publishing source version and team rooms' });
        const current = () => key === this.managedCatalogScope && operation === this._managedOperation;
        try {
          if (this.managedUpload.status === 'published') {
            if (await this.managedCompletePublication(scope, { upload: this.managedUpload }, key, current)) await this.refreshManagedVersions();
            return;
          }
          await this.managedRememberUpload(scope); if (!current()) return;
          const path = '/v1/version-uploads/' + encodeURIComponent(this.managedUpload.id) + '/publish';
          const body = { expectedHeadId: this.managedUpload.parentVersionId || null, idempotencyKey: requestId };
          let result;
          try { result = await this._cloud.request(path, { method: 'POST', body }); }
          catch (error) {
            if (!current()) return;
            if (!['UNFINISHED_TEAMS', 'VERSION_UNFINISHED_TEAMS', 'VERSION_TEAMS_UNFINISHED'].includes(error.code)) throw error;
            const teams = error.details?.unfinishedTeams || error.details?.error?.unfinishedTeams || [];
            if (!await this.appConfirm(`The previous HEAD still has open teams${teams.length ? ': ' + teams.join(', ') : ''}. Collect and end them first, or explicitly publish using their captured shared work.`, { title: 'Previous version is still open', confirmLabel: 'Publish anyway', danger: false })) return;
            if (!current()) return;
            result = await this._cloud.request(path, { method: 'POST', body: { ...body, overrideUnfinished: true } });
          }
          if (!current()) return;
          if (await this.managedCompletePublication(scope, result, key, current)) { await this.refreshManagedVersions(); if (current()) await this.managedLoadLocal(); }
        } catch (error) { if (!error.stale && current()) { this.managedUploadError = error.message; this.managedDuplicateVersion = copy(error.details?.version || this.managedDuplicateVersion); } }
        finally { this.managedFinishOperation(operation); }
      },
      closeManagedPresence() { this._managedPresenceSocket?.close(); this._managedPresenceSocket = null; this._managedPresenceId = ''; },
      async openManagedPresence(versionId) {
        if (!this.managedOnlineAvailable || !root.WebSocket || this._managedPresenceId === versionId) return;
        this.closeManagedPresence(); this._managedPresenceId = versionId;
        const key = this.managedCatalogScope;
        try {
          const result = await this._cloud.request('/v1/versions/' + encodeURIComponent(versionId) + '/ticket', { method: 'POST' });
          if (key !== this.managedCatalogScope || this._managedPresenceId !== versionId) return;
          const url = new URL(result.url || result.websocketUrl, this._cloud.apiBase); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
          const socket = new root.WebSocket(url.href); this._managedPresenceSocket = socket;
          socket.onmessage = event => {
            if (this._managedPresenceSocket !== socket || key !== this.managedCatalogScope || this.selectedManagedVersionId !== versionId) return;
            try { const data = JSON.parse(event.data); if (data.type === 'version_changed' || data.type === 'versions_changed') this.refreshManagedVersions(); if (data.teams && this.managedVersionDetails?.version?.id === versionId) this.managedVersionDetails = { ...this.managedVersionDetails, teams: this.managedVersionDetails.teams.map(team => ({ ...team, presence: data.teams.find(t => t.language === team.language)?.presence || [] })) }; }
            catch (_) { /* Ignore malformed ephemeral presence messages. */ }
          };
          socket.onclose = () => { if (this._managedPresenceSocket === socket) { this._managedPresenceSocket = null; this._managedPresenceId = ''; } };
        } catch (_) { this._managedPresenceId = ''; /* Polling retains status without joining team rooms. */ }
      },
    },
  };
  return { mixin, defaults, deadlineInput, deadlineWeekday, nextWeekDeadline, parseDeadline, reminder, filename, DEFAULT_BRANCH };
});
