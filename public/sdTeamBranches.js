/* StatDescription team lineage, verified originals, and offline advancement. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SDTeamBranches = api;
})(typeof window === 'object' ? window : globalThis, function (root) {
  'use strict';

  const LOGICAL_KEY = 'statdescription';
  const BRANCH_POLICY = 'sd-team-branch-v1';
  const ORIGINAL_POLICY = 'sd-originals-v1';
  const copy = value => JSON.parse(JSON.stringify(value));
  const pendingError = delay => Object.assign(new Error('The team’s original ZIP is being uploaded. The advance will retry automatically.'), { retryAfterMs: delay || 1200 });
  const transient = error => error?.retryAfterMs || !error?.status || error.status === 408 || error.status === 429 || error.status >= 500;

  function branchFields(scope) {
    const { game, branchId, language, logicalKey } = scope;
    return { game, branchId, language, logicalKey };
  }

  function branchPath(scope) { return '/v1/sd-team-branch?' + new URLSearchParams(branchFields(scope)); }
  function originalsPath(scope) { return '/v1/sd-originals/' + encodeURIComponent(scope.game); }
  function originalPath(scope, zipHash) { return originalsPath(scope) + '/' + encodeURIComponent(zipHash); }
  const predecessor = branch => branch?.head || branch?.origin || null;

  function matchesOriginal(original, archive) {
    return !!original?.archive && (original.zipHash || original.archive.zipHash) === archive.zipHash
      && original.archive.baselineId === archive.baselineId
      && original.archive.zipSize === archive.zipSize;
  }

  function advanceBody(scope, checkpoint, roomId, state) {
    if (checkpoint.adoptExisting && !state.head) {
      return { ...branchFields(scope), baselineId: checkpoint.baselineId, roomId, expectedHeadId: null,
        expectedOriginVersionId: null, expectedRevision: 0, expectedPredecessorSequence: null,
        idempotencyKey: checkpoint.id, adoptExisting: true };
    }
    const parent = predecessor(state);
    if (checkpoint.adoptExisting || (checkpoint.parentBaselineId || '') !== (parent?.baselineId || '')
      || checkpoint.parentHeadId && checkpoint.parentHeadId !== state.head?.id
      || checkpoint.parentOriginVersionId && (state.head || checkpoint.parentOriginVersionId !== state.origin?.versionId)) {
      throw Object.assign(new Error('The team advanced from a different source. Open the team head to review the current version. This import remains on this device.'), { code: 'SD_TEAM_HEAD_CHANGED', status: 409 });
    }
    if (checkpoint.needsParentReview || Number.isSafeInteger(checkpoint.parentSequence) && checkpoint.parentSequence !== parent?.sequence) {
      throw Object.assign(new Error('Accepted predecessor translations changed. Open the working version to review them before importing again. This import remains on this device.'),
        { code: 'SD_TEAM_PREDECESSOR_CHANGED', status: 409 });
    }
    return { ...branchFields(scope), baselineId: checkpoint.baselineId, roomId, expectedHeadId: state.head?.id || null,
      expectedOriginVersionId: state.head ? null : state.origin?.versionId || null,
      expectedRevision: state.revision, expectedPredecessorSequence: checkpoint.parentSequence ?? parent?.sequence ?? null, idempotencyKey: checkpoint.id };
  }

  function graphRows(branch, checkpoints) {
    const history = [...(branch?.history || []).filter(node => node.id !== branch?.head?.id)];
    if (branch?.head) history.unshift(branch.head);
    const pending = [...checkpoints].reverse().filter(node => node.baselineId !== branch?.head?.baselineId);
    return [...pending.map(node => ({ ...node, type: 'pending' })), ...history.map(node => ({ ...node, type: 'team' })),
      ...(branch?.origin ? [{ ...branch.origin, id: 'origin:' + branch.origin.versionId, type: 'origin' }] : [])];
  }

  const mixin = {
    data: () => ({ sdTeamBranch: null, sdTeamPolicy: null, sdTeamCheckpoints: [], sdTeamOriginals: [], sdTeamOriginalsCursor: null,
      sdTeamOriginalsLoaded: false, sdTeamOriginalsBusy: false, sdTeamBusy: false, sdTeamActionError: '', sdTeamSyncError: '',
      sdTeamCatalogError: '', sdTeamOriginalsError: '', sdTeamReconcileResult: null, sdTeamReconcileError: '',
      sdTeamSyncConflict: false, sdTeamReconcileBusy: false, sdTeamRestoreSource: null }),
    computed: {
      sdTeamScope() {
        const accountId = this.cloudUser?.id, language = this.cloudCanAccessAllLanguages ? this.lang : this.cloudUser?.language;
        if (!this.managedCatalogAccess || !accountId || !this.gameVersion || !language
          || !this.cloudCanAccessAllLanguages && this.lang !== language) return null;
        return { accountId: String(accountId), game: this.gameVersion, branchId: this.branchId || 'default', language, logicalKey: LOGICAL_KEY };
      },
      sdTeamScopeKey() { return JSON.stringify([this.sdTeamScope, this.cloudUser?.role, this.cloudUser?.assignmentVersion]); },
      sdTeamBranchVisible() {
        return !!this.sdTeamScope && (this.sdTeamPolicy?.statDescriptionTeamBranches === BRANCH_POLICY || this.sdTeamCheckpoints.length > 0);
      },
      sdTeamSharedOriginalsVisible() { return !!this.sdTeamScope && this.sdTeamPolicy?.statDescriptionOriginals === ORIGINAL_POLICY; },
      sdTeamGraphRows() { return graphRows(this.sdTeamBranch, this.sdTeamCheckpoints); },
      sdTeamGraphLanes() {
        return [{ title: 'Origin', nodes: this.sdTeamGraphRows.filter(node => node.type === 'origin') },
          { title: 'Team branch', nodes: this.sdTeamGraphRows.filter(node => node.type !== 'origin') }];
      },
      sdTeamWorkingNode() { return this.sdTeamCheckpoints.at(-1) || predecessor(this.sdTeamBranch); },
      sdTeamEarlierLocalVersions() {
        const shown = new Set(this.sdTeamGraphRows.map(node => node.baselineId));
        return (this.localVersions || []).filter(version => version.hasSource && !version.groupId && !shown.has(version.sourceHash));
      },
      sdTeamLinkedSaveKey() {
        const state = this.collaborationState;
        if (!this.sdTeamBranchVisible || !state?.connected || state.pending || state.conflicts?.length || !state.roomId
          || state.identity?.accountId !== this.sdTeamScope.accountId || state.identity?.language !== this.sdTeamScope.language
          || state.identity?.game !== this.sdTeamScope.game || state.identity?.branchId !== this.sdTeamScope.branchId) return '';
        return JSON.stringify([state.roomId, state.sequence]);
      },
      sdTeamCatalogFingerprint() {
        if (!this.sdTeamBranchVisible) return '';
        return JSON.stringify([this.managedBranch?.headVersionId, (this.managedVersions || []).map(version => [version.id, version.status, version.membershipRevision])]);
      },
    },
    watch: {
      sdTeamScopeKey() {
        this.sdTeamCancelRequests();
        this.sdTeamBranch = null;
        this.sdTeamPolicy = null;
        this.sdTeamCheckpoints = [];
        this.sdTeamOriginals = [];
        this.sdTeamOriginalsCursor = null;
        this.sdTeamOriginalsLoaded = false;
        this.sdTeamOriginalsBusy = false;
        this.sdTeamBusy = false;
        this.sdTeamActionError = '';
        this.sdTeamSyncError = '';
        this.sdTeamSyncConflict = false;
        this.sdTeamCatalogError = '';
        this.sdTeamOriginalsError = '';
        this.sdTeamReconcileResult = null;
        this.sdTeamReconcileError = '';
        this.sdTeamReconcileBusy = false;
        this.sdTeamRestoreSource = null;
        this._sdTeamReconcileCommand = null;
        this._sdTeamCheckedSequences = null;
        this.sdTeamRefresh();
      },
      versionChooserVisible(visible) { if (visible) this.sdTeamRefresh(); },
      ctUploadVisible(visible) { if (visible && this.sdTeamSharedOriginalsVisible) this.sdTeamLoadOriginals(); },
      sdTeamLinkedSaveKey(key) { if (key) this.sdTeamMaybeReconcile(key); },
      sdTeamCatalogFingerprint(key) { if (key) this.sdTeamRefresh(); },
    },
    mounted() {
      this._sdTeamOnline = () => this.sdTeamRefresh();
      root.addEventListener?.('online', this._sdTeamOnline);
      this.sdTeamRefresh();
    },
    beforeUnmount() {
      root.removeEventListener?.('online', this._sdTeamOnline);
      this.sdTeamCancelRequests();
    },
    methods: {
      sdTeamCancelRequests() {
        this._sdTeamRequests?.abort();
        this._sdTeamRequests = null;
        this._sdTeamRefresh = null;
        this._sdTeamDrain = null;
        this._sdTeamOriginalsLoad = null;
        clearTimeout(this._sdTeamRetry);
      },
      sdTeamRequestContext() {
        const scope = this.sdTeamScope, key = this.sdTeamScopeKey, client = this._cloud;
        const signal = (this._sdTeamRequests ||= new AbortController()).signal;
        const current = () => key === this.sdTeamScopeKey && client === this._cloud && !signal.aborted;
        return { scope, client, signal, current };
      },
      async sdTeamRefresh() {
        if (!this.sdTeamScope || this._sdTeamRefresh) return;
        const request = this.sdTeamRequestContext();
        const { scope, client, signal, current } = request;
        this._sdTeamRefresh = request;
        try {
          const [checkpoints, cached] = await Promise.all([
            root.OfflineStore?.listSDTeamBranchCheckpoints?.(scope), root.OfflineStore?.getSDTeamBranchView?.(scope),
          ]);
          if (!current()) return;
          this.sdTeamCheckpoints = checkpoints || [];
          if (cached && !this.sdTeamBranch) {
            this.sdTeamBranch = cached.branch;
            this.sdTeamPolicy = cached.policy;
          }
          if (!client || root.navigator?.onLine === false) return;
          const policy = await client.request('/v1/content-policy', { signal });
          if (!current()) return;
          this.sdTeamPolicy = policy;
          if (policy?.statDescriptionTeamBranches !== BRANCH_POLICY) return;
          const branch = await client.request(branchPath(scope), { signal });
          if (!current()) return;
          this.sdTeamBranch = branch;
          this.sdTeamCatalogError = '';
          await root.OfflineStore?.putSDTeamBranchView?.(scope, { branch, policy });
          if (!current()) return;
          this.sdTeamDrain();
          if (this.sdTeamLinkedSaveKey) this.sdTeamMaybeReconcile(this.sdTeamLinkedSaveKey);
        } catch (error) {
          if (current() && error?.status !== 404 && (this.sdTeamBranchVisible || this.sdTeamCheckpoints.length)) {
            this.sdTeamCatalogError = error.message || String(error);
          }
        } finally { if (this._sdTeamRefresh === request) this._sdTeamRefresh = null; }
      },
      async sdTeamLoadOriginals(more = false) {
        if (!this.sdTeamSharedOriginalsVisible || this._sdTeamOriginalsLoad || !more && this.sdTeamOriginalsLoaded) return;
        const request = this.sdTeamRequestContext();
        const { scope, client, signal, current } = request;
        if (!client || root.navigator?.onLine === false) return;
        const query = more && this.sdTeamOriginalsCursor != null ? '?' + new URLSearchParams({ cursor: this.sdTeamOriginalsCursor }) : '';
        this._sdTeamOriginalsLoad = request;
        this.sdTeamOriginalsBusy = true;
        try {
          const result = await client.request(originalsPath(scope) + query, { signal });
          if (!current()) return;
          this.sdTeamOriginals = [...new Map([...(more ? this.sdTeamOriginals : []), ...(result.originals || [])]
            .map(original => [original.zipHash || original.archive.zipHash, original])).values()];
          this.sdTeamOriginalsCursor = result.nextCursor ?? null;
          this.sdTeamOriginalsLoaded = true;
          this.sdTeamOriginalsError = '';
        } catch (error) { if (current()) this.sdTeamOriginalsError = error.message || String(error); }
        finally {
          if (this._sdTeamOriginalsLoad === request) { this._sdTeamOriginalsLoad = null; this.sdTeamOriginalsBusy = false; }
        }
      },
      async sdTeamGetOriginal(original, request = this.sdTeamRequestContext()) {
        if (original?.archive) return original;
        const { scope, client, signal, current } = request;
        if (!original?.zipHash || !scope || !client) throw new Error('Connect once to retrieve the shared original ZIP.');
        const result = await client.request(originalPath(scope, original.zipHash), { signal });
        if (!current()) return null;
        if (!result.original?.archive || result.original.archive.zipHash !== original.zipHash) throw new Error('The shared source descriptor differs from the selected ZIP.');
        return result.original;
      },
      async sdTeamGetOriginalZip(original, request = this.sdTeamRequestContext()) {
        original = await this.sdTeamGetOriginal(original, request);
        if (!original) return null;
        const { archive } = original, { scope, client, signal, current } = request;
        if (!archive || !scope) throw new Error('This original ZIP has no accepted source descriptor.');
        const cached = await root.OfflineStore.getStatDescriptionZip(archive.zipHash);
        if (!current()) return null;
        if (cached) {
          try {
            await root.SDBaselineFiles.cacheOriginalZip(cached, archive, { current, signal });
            return current() ? cached : null;
          } catch (error) {
            if (!current()) return null;
            if (!client || root.navigator?.onLine === false) throw error;
          }
        }
        if (!client || root.navigator?.onLine === false) throw new Error('Connect once to download this original ZIP.');
        const blob = await client.request(originalPath(scope, archive.zipHash) + '/original', { signal, responseType: 'blob', timeout: 120000 });
        if (!current()) return null;
        await root.SDBaselineFiles.cacheOriginalZip(blob, archive, { current, signal });
        if (!current()) return null;
        return blob;
      },
      async sdTeamEnsureOriginal(archive, request) {
        const { client, scope, signal, current } = request;
        const claim = await client.request(originalsPath(scope) + '/claim', { method: 'POST', body: {
          zipHash: archive.zipHash, zipSize: archive.zipSize, archive,
        }, signal });
        if (!current()) return null;
        if (claim.status === 'pending') throw pendingError(claim.retryAfterMs);
        if (claim.status === 'ready') {
          if (!matchesOriginal(claim.original, archive)) throw Object.assign(new Error('The shared original uses different parser decisions. Keep this workspace on this device, then open the shared ZIP and review the preserved work.'), { status: 409 });
          return claim.original;
        }
        if (claim.status !== 'upload' || !claim.uploadId) throw new Error('The server could not reserve this original ZIP for upload.');
        const blob = await root.OfflineStore.getStatDescriptionZip(archive.zipHash);
        if (!current()) return null;
        if (!blob) throw Object.assign(new Error('The queued original ZIP is unavailable on this device. Import the matching ZIP again to share it.'), { status: 409 });
        const result = await client.request(originalPath(scope, archive.zipHash) + '?' + new URLSearchParams({ uploadId: claim.uploadId }), {
          method: 'PUT', rawBody: blob, signal, timeout: 180000,
        });
        if (!current()) return null;
        if (!matchesOriginal(result.original, archive)) throw Object.assign(new Error('The retained shared original differs from this workspace.'), { status: 409 });
        this.sdTeamOriginalsLoaded = false;
        return result.original;
      },
      sdTeamCheckpointForImport(archive, file, context) {
        if (!context || context.key !== this.sdTeamScopeKey || !archive || !this.sdTeamScope) return null;
        const { parentBaselineId, parentHeadId, parentOriginVersionId, parentSequence, parentCheckpointId, name } = context;
        if ((this.sourceIdentity || '') !== parentBaselineId || archive.baselineId === parentBaselineId) return null;
        return { ...this.sdTeamScope, id: root.crypto.randomUUID(), parentBaselineId,
          ...(parentHeadId ? { parentHeadId } : {}), ...(parentOriginVersionId ? { parentOriginVersionId } : {}),
          ...(Number.isSafeInteger(parentSequence) ? { parentSequence } : {}), ...(parentCheckpointId ? { parentCheckpointId } : {}),
          baselineId: archive.baselineId, zipHash: archive.zipHash, zipSize: archive.zipSize, archive: copy(archive),
          originalZip: file, name: name || file?.name || 'StatDescriptions.zip', createdAt: Date.now() };
      },
      async sdTeamDrain() {
        if (!this.sdTeamBranchVisible || this._sdTeamDrain || !this._cloud || root.navigator?.onLine === false) return;
        const request = this.sdTeamRequestContext();
        const { scope, client, signal, current } = request;
        this._sdTeamDrain = request;
        clearTimeout(this._sdTeamRetry);
        let completed = false;
        try {
          let checkpoints = await root.OfflineStore.listSDTeamBranchCheckpoints(scope);
          if (!current()) return;
          this.sdTeamCheckpoints = checkpoints;
          if (!checkpoints.length) { this.sdTeamSyncError = ''; this.sdTeamSyncConflict = false; return; }
          let state = await client.request(branchPath(scope), { signal });
          for (const checkpoint of checkpoints) {
            if (!current()) return;
            let body = checkpoint.advanceBody, remoteChanged = false;
            if (!checkpoint.advanceBody && state.head?.baselineId !== checkpoint.baselineId) {
              // Reject a changed parent before uploading a potentially large ZIP.
              advanceBody(scope, checkpoint, '', state);
            }
            if (!body) {
              if (state.head?.baselineId !== checkpoint.baselineId
                && (!await this.sdTeamEnsureOriginal(checkpoint.archive, request) || !current())) return;
              const room = await this.sdTeamSyncCheckpointRoom(checkpoint, request);
              if (!room || !current()) return;
              remoteChanged = room.remoteChanged;
              state = await client.request(branchPath(scope), { signal });
              if (!current()) return;
              if (state.head?.baselineId !== checkpoint.baselineId) {
                body = advanceBody(scope, checkpoint, room.id, state);
                await root.OfflineStore.updateSDTeamBranchCheckpoint(scope, checkpoint.id, { advanceBody: body, remoteChanged });
              }
            }
            if (!current()) return;
            if (body) state = await client.request('/v1/sd-team-branch/advance', { method: 'POST', body, signal });
            if (!current()) return;
            if (state.head?.baselineId === checkpoint.baselineId) {
              const descendants = (await root.OfflineStore.listSDTeamBranchCheckpoints(scope)).filter(item => item.parentCheckpointId === checkpoint.id && !item.advanceBody);
              for (const child of descendants) {
                if (!current()) return;
                const parent = { ...(child.parentHeadId == null ? { parentHeadId: state.head.id } : {}),
                  ...(child.parentSequence == null ? { parentSequence: state.head.sequence } : {}),
                  ...(child.needsParentReview == null ? { needsParentReview: !!(remoteChanged || checkpoint.remoteChanged) } : {}) };
                if (Object.keys(parent).length) await root.OfflineStore.updateSDTeamBranchCheckpoint(scope, child.id, parent);
                const loadedChild = checkpoints.find(item => item.id === child.id);
                if (loadedChild) Object.assign(loadedChild, parent);
              }
            }
            if (!current()) return;
            await root.OfflineStore.putSDTeamBranchView(scope, { branch: state, policy: copy(this.sdTeamPolicy) });
            if (!current()) return;
            await root.OfflineStore.ackSDTeamBranchCheckpoint(scope, checkpoint.id);
            if (!current()) return;
            this.sdTeamBranch = state;
            this.sdTeamCheckpoints = this.sdTeamCheckpoints.filter(item => item.id !== checkpoint.id);
          }
          this.sdTeamSyncError = '';
          this.sdTeamSyncConflict = false;
          completed = true;
        } catch (error) {
          if (!current()) return;
          if (!error?.retryAfterMs) this.sdTeamSyncError = error.message || String(error);
          this.sdTeamSyncConflict = error.status === 409 && !transient(error);
          if (transient(error)) this._sdTeamRetry = setTimeout(() => this.sdTeamDrain(), Math.max(1000, error.retryAfterMs || 10000));
        } finally {
          if (this._sdTeamDrain === request) {
            this._sdTeamDrain = null;
            if (completed && this.sdTeamCheckpoints.length) queueMicrotask(() => this.sdTeamDrain());
          }
        }
      },
      async sdTeamKeepLocal() {
        if (!this.sdTeamSyncConflict || this.sdTeamBusy || this._sdTeamDrain) return;
        const { scope, current } = this.sdTeamRequestContext();
        this.sdTeamBusy = true;
        try {
          if (!await this.appConfirm('Keep the queued versions on this device and stop their team advances? You can reopen their Saved work and original ZIPs under Earlier workspace versions.',
            { title: 'Keep versions on this device?', confirmLabel: 'Keep on this device' }) || !current()) return;
          for (const checkpoint of this.sdTeamCheckpoints) await root.OfflineStore.ackSDTeamBranchCheckpoint(scope, checkpoint.id);
          if (!current()) return;
          this.sdTeamCheckpoints = [];
          this.sdTeamSyncError = '';
          this.sdTeamSyncConflict = false;
          await this.managedLoadLocal();
          this.sdTeamRefresh();
        } catch (error) { if (current()) this.sdTeamActionError = error.message || String(error); }
        finally { if (current()) this.sdTeamBusy = false; }
      },
      async sdTeamSyncCheckpointRoom(checkpoint, request) {
        const { scope, client, signal, current } = request;
        const localScope = { accountId: scope.accountId, game: scope.game, branchId: scope.branchId, sourceHash: checkpoint.baselineId };
        // Copy the exact saved workspace into the existing scoped room protocol.
        // Intermediate checkpoints may no longer be the current browser editor.
        const [workspace, baseline] = await Promise.all([
          root.OfflineStore.getVersionWorkspace(localScope, scope.language),
          root.OfflineStore.getImportedBaseline(checkpoint.baselineId, localScope),
        ]);
        if (!current()) return null;
        if (!workspace || baseline?.archive?.baselineId !== checkpoint.baselineId) {
          throw Object.assign(new Error('The queued team workspace is unavailable. Open its original version to recover it.'), { status: 409 });
        }
        const files = baseline.source.filter(file => workspace.staged?.[scope.language]?.[file.filepath]).map(file => {
          const staged = workspace.staged[scope.language][file.filepath];
          return { filepath: file.filepath, translations: staged.translations, trackedForExport: true,
            ...(staged.englishIntent ? { englishIntent: staged.englishIntent } : {}),
            ...(staged.sourceCarry ? { sourceCarry: staged.sourceCarry } : {}) };
        });
        const originalTargets = new Map(baseline.source.map(file => [file.filepath,
          workspace.staged?.[scope.language]?.[file.filepath]?.translations || file.translations[scope.language] || []]));
        let remoteChanged = false;
        const roomClient = new root.CollaborationSync.Client({ store: root.OfflineStore, apiBase: client.apiBase, allowLegacySeed: false,
          context: () => client.context(), presenceEnabled: () => false,
          request: (path, options, captured) => client.request(path, { ...options, signal }, captured),
          contentPolicy: () => client.request('/v1/content-policy', { signal }),
          onRemote: incoming => {
            for (const file of incoming || []) if (JSON.stringify(file.translations) !== JSON.stringify(originalTargets.get(file.filepath))) remoteChanged = true;
          } });
        try {
          await roomClient.connect({ ...scope, source: baseline.source, baselineSource: baseline.source,
            archive: checkpoint.archive, files, workspace });
          if (!current()) return null;
          const state = roomClient.snapshot({ includeFiles: false });
          if (state.conflicts?.length) throw Object.assign(new Error('Resolve the translation conflicts in this team version before advancing it.'), { status: 409 });
          const id = roomClient.room()?.roomId;
          if (!id || roomClient.needsRemoteJoin || state.pending || roomClient.lastError) throw roomClient.lastError || pendingError();
          return { id, remoteChanged };
        } finally { roomClient.disconnect(); }
      },
      sdTeamNodeName(node) {
        return node?.name || this.localVersions.find(version => version.sourceHash === node?.baselineId)?.name
          || this.sdTeamOriginals.find(original => original.zipHash === node?.zipHash)?.releaseName
          || 'ZIP ' + String(node?.zipHash || node?.baselineId || '').slice(0, 12);
      },
      sdTeamNodeActive(node) {
        return this.sourceIdentity === node.baselineId && (node.groupId || '') === (this.activeContentGroup?.id || '');
      },
      sdTeamNodeParent(node) {
        const parent = this.sdTeamGraphRows.find(row => row.id !== node.id && (node.parentId && row.id === node.parentId
          || node.parentBaselineId && row.baselineId === node.parentBaselineId || node.parentRoomId && row.roomId === node.parentRoomId));
        return parent && this.sdTeamNodeName(parent);
      },
      sdTeamEntryLink(node) { return node?.link || (node?.id === this.sdTeamBranch?.head?.id ? this.sdTeamBranch.link : null); },
      sdTeamOriginalDetails(original) {
        const size = original.zipSize ?? original.size, date = original.createdAt && this.managedFormatDate(original.createdAt);
        return [Number.isFinite(size) && (size >= 1024 * 1024 ? (size / (1024 * 1024)).toFixed(1) + ' MiB' : Math.ceil(size / 1024) + ' KiB'), date].filter(Boolean).join(' · ');
      },
      async sdTeamOpenNode(node) {
        if (!node || !this.sdTeamScope) return false;
        const request = this.sdTeamRequestContext();
        const { scope, current } = request;
        if (node.versionId) {
          let version = this.managedVersions.find(item => item.id === node.versionId);
          let group = version?.contentGroups?.find(item => item.id === node.groupId);
          if (!group && node.groupId && request.client && root.navigator?.onLine !== false) {
            const result = await request.client.request('/v1/content-groups/' + encodeURIComponent(node.groupId), { signal: request.signal });
            if (!current()) return false;
            group = result.group;
            if (group?.id !== node.groupId || group.versionId !== node.versionId) throw new Error('The selected Origin assignment changed.');
            version ||= group.version;
          }
          if (version && group) return this.ctOpenGroup(version, group, scope.language);
          if (version && !node.groupId) return this.continueManagedVersion(version, scope.language);
          throw new Error('Connect once to open this exact Origin assignment.');
        }
        const localScope = { accountId: scope.accountId, game: scope.game, branchId: scope.branchId, sourceHash: node.baselineId };
        const store = root.OfflineStore;
        if (!await store.hasVersionWorkspace(localScope)) {
          if (!current()) return false;
          const blob = await this.sdTeamGetOriginalZip(node, request);
          if (!blob || !current()) return false;
          const options = { game: scope.game, language: scope.language, JSZip: root.JSZip, current, signal: request.signal };
          const parsed = await root.SDClientPublication.parse(blob, options);
          const prepared = await root.SDClientPublication.prepare(parsed, [], { ...options, canonicalArchive: node.archive });
          if (!current()) return false;
          const source = [...prepared.files.values()];
          const workspace = { descs: [], status: {}, sourceHash: node.baselineId, workspaceOrigin: 'local', importArchive: prepared.archive };
          root.WorkspaceState.initializeWorkspace(workspace, { ...localScope, source, language: scope.language });
          await store.saveSourceWorkspaceWithRevisions(source, workspace, [], localScope, { archive: prepared.archive, source, rawSource: parsed.rawSource });
        }
        if (!current()) return false;
        return this.managedContinueLocalVersion({ sourceHash: node.baselineId });
      },
      async sdTeamOpenVersion(node, filepath) {
        if (this.sdTeamBusy) return;
        const { current } = this.sdTeamRequestContext();
        this.sdTeamBusy = true;
        try {
          if (!await this.sdTeamOpenNode(node) || !current()) return;
          if (filepath && this.sdTeamNodeActive(node) && this.getDescByFilepath(filepath)) await this.editFile(filepath, true);
          if (!current()) return;
          this.sdTeamActionError = '';
        } catch (error) { if (current()) this.sdTeamActionError = error.message || String(error); }
        finally { if (current()) this.sdTeamBusy = false; }
      },
      async sdTeamImportSelected(event) {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (file) return this.sdTeamImportNext(file);
      },
      async sdTeamUseLocalVersion(version, selectedZip) {
        if (!this.sdTeamScope || this.sdTeamBusy) return;
        const request = this.sdTeamRequestContext();
        const { scope, current } = request;
        const localScope = { accountId: scope.accountId, game: scope.game, branchId: scope.branchId, sourceHash: version.sourceHash };
        const node = this.sdTeamWorkingNode, store = root.OfflineStore;
        const hasTeamStart = !!(this.sdTeamBranch?.head || this.sdTeamCheckpoints.length);
        this.sdTeamBusy = true;
        let nextOriginal;
        try {
          const baseline = await store.getImportedBaseline(version.sourceHash, localScope);
          if (!current()) return;
          if (!baseline?.archive || baseline.archive.baselineId !== version.sourceHash) throw new Error('This version has no verified original source descriptor.');
          let originalZip = selectedZip || await store.getStatDescriptionZip(baseline.archive.zipHash);
          if (!originalZip && request.client && root.navigator?.onLine !== false) {
            try { originalZip = await this.sdTeamGetOriginalZip({ archive: baseline.archive }, request); }
            catch (error) { if (error.status !== 404 && !transient(error)) throw error; }
          }
          if (!current()) return;
          if (!originalZip) {
            this.sdTeamRestoreSource = { version, key: this.sdTeamScopeKey };
            return;
          }
          if (selectedZip) await root.SDBaselineFiles.cacheOriginalZip(originalZip, baseline.archive, { current, signal: request.signal });
          if (!current()) return;
          if (!await this.appConfirm(hasTeamStart ? 'Review this retained ZIP as the next source from ' + this.sdTeamNodeName(node) + '? Existing Saved work in the retained version is preserved.'
            : 'Start the team branch from this exact retained ZIP and its Saved work? Its starting point will be recorded separately from Origin.',
            { title: 'Use retained source ZIP?', confirmLabel: hasTeamStart ? 'Use as next source' : 'Start from this source' }) || !current()) return;
          this.sdTeamRestoreSource = null;
          if (hasTeamStart) nextOriginal = { name: version.name, filename: version.name || 'StatDescriptions.zip', archive: baseline.archive };
          else {
            const workspace = await store.getVersionWorkspace(localScope, scope.language);
            if (!current()) return;
            if (!workspace) throw new Error('This retained workspace is unavailable on this device.');
            const { archive } = baseline;
            const checkpoint = { ...scope, id: root.crypto.randomUUID(), parentBaselineId: '', adoptExisting: true, name: version.name || 'StatDescriptions.zip',
              baselineId: archive.baselineId, zipHash: archive.zipHash, zipSize: archive.zipSize, archive, originalZip, createdAt: Date.now() };
            await store.saveSourceWorkspaceWithRevisions(baseline.source, workspace, [], localScope, baseline, checkpoint);
            if (!current()) return;
            await this.sdTeamOpenNode(checkpoint);
            this.sdTeamCheckpointCommitted(checkpoint);
            this.sdTeamActionError = '';
          }
        } catch (error) { if (current()) this.sdTeamActionError = error.message || String(error); }
        finally { if (current()) this.sdTeamBusy = false; }
        if (nextOriginal && current()) return this.sdTeamImportNext(null, nextOriginal);
      },
      sdTeamRestoreOriginalSelected(event) {
        const file = event.target.files?.[0], pending = this.sdTeamRestoreSource;
        event.target.value = '';
        if (file && pending?.key === this.sdTeamScopeKey) return this.sdTeamUseLocalVersion(pending.version, file);
      },
      async sdTeamImportNext(file, original) {
        if (!this.sdTeamBranchVisible || this.sdTeamBusy) return;
        const request = this.sdTeamRequestContext();
        const { current, client, scope, signal } = request;
        const node = this.sdTeamWorkingNode;
        this.sdTeamBusy = true;
        try {
          if (original) {
            original = await this.sdTeamGetOriginal(original, request);
            if (!original || !current()) return;
            const blob = await this.sdTeamGetOriginalZip(original, request);
            if (!blob || !current()) return;
            file = new root.File([blob], original.filename || 'StatDescriptions.zip', { type: 'application/zip' });
          }
          if (!file || !current()) return;
          if (node?.baselineId && (!this.sourceLoaded || !this.sdTeamNodeActive(node)) && !await this.sdTeamOpenNode(node)) return;
          if (!current()) return;
          const parentBaselineId = this.sourceIdentity || '';
          if (!node && parentBaselineId) throw new Error('Open the team’s working version before importing its next source.');
          if (node?.baselineId && node.baselineId !== parentBaselineId) throw new Error('The working source changed before the import.');
          const parentCheckpoint = this.sdTeamCheckpoints.find(item => item.id === node?.id);
          let branch = this.sdTeamBranch;
          let checkedOnline = false;
          if (client && root.navigator?.onLine !== false && !parentCheckpoint) {
            try {
              if (node?.roomId) {
                await this.initializeCollaboration?.();
                if (!current()) return;
                await this._collaboration?.startRemote?.();
                if (!current()) return;
                if (this._collaboration?.lastError) throw this._collaboration.lastError;
              }
              branch = await client.request(branchPath(scope), { signal });
              checkedOnline = true;
            } catch (error) { if (!transient(error)) throw error; }
          }
          if (!current()) return;
          const knownParent = predecessor(branch);
          if (!parentCheckpoint && knownParent?.baselineId && knownParent.baselineId !== parentBaselineId) {
            this.sdTeamBranch = branch;
            throw new Error('The team head changed. Open the working version and choose its next source.');
          }
          const parentRoom = this._collaboration?.room?.();
          if (checkedOnline && knownParent?.roomId && (parentRoom?.roomId !== knownParent.roomId || parentRoom.sequence !== knownParent.sequence)) {
            throw new Error('The accepted team work changed while opening this source. Open the working version again before importing its next ZIP.');
          }
          const parentSequence = !parentCheckpoint && (parentRoom?.identity?.sourceHash === parentBaselineId && parentRoom?.roomId === knownParent?.roomId
            ? parentRoom.sequence : knownParent?.sequence);
          const teamImport = { key: this.sdTeamScopeKey, parentBaselineId, parentCheckpointId: parentCheckpoint?.id,
            parentHeadId: !parentCheckpoint && branch?.head?.id || undefined,
            parentOriginVersionId: !parentCheckpoint && !branch?.head && branch?.origin?.versionId || undefined,
            parentSequence: Number.isSafeInteger(parentSequence) ? parentSequence : undefined, name: original?.releaseName || original?.filename || file.name };
          await this.importUpdateZipFile(file, null, { teamImport, ...(original?.archive ? { acceptedArchive: original.archive } : {}) });
          if (current()) this.sdTeamActionError = '';
        } catch (error) { if (current()) this.sdTeamActionError = error.message || String(error); }
        finally { if (current()) this.sdTeamBusy = false; }
      },
      async sdTeamCheckpointCommitted(checkpoint) {
        if (!this.sdTeamScope || checkpoint.accountId !== this.sdTeamScope.accountId || checkpoint.language !== this.sdTeamScope.language
          || checkpoint.game !== this.sdTeamScope.game || checkpoint.branchId !== this.sdTeamScope.branchId) return;
        this.versionChooserVisible = false;
        this.managedWorkspaceMode = 'offline';
        const { current } = this.sdTeamRequestContext();
        try {
          const checkpoints = await root.OfflineStore.listSDTeamBranchCheckpoints(this.sdTeamScope);
          if (!current()) return;
          this.sdTeamCheckpoints = checkpoints;
          this.sdTeamDrain();
        } catch (error) { if (current()) this.sdTeamSyncError = error.message || String(error); }
      },
      sdTeamMaybeReconcile(key) {
        if (this.sdTeamReconcileBusy || this.sdTeamBusy || !this.sdTeamBranch || root.navigator?.onLine === false) return;
        const [roomId, sequence] = JSON.parse(key);
        if ((this._sdTeamCheckedSequences?.get(roomId) ?? -1) >= sequence) return;
        const entry = this.sdTeamGraphRows.find(node => {
          const link = this.sdTeamEntryLink(node)?.linked;
          return node.type === 'team' && link && !link.sharedRoom && !link.ended && (node.roomId === roomId || link.roomId === roomId);
        });
        if (entry) this.sdTeamReconcile(undefined, true, entry.id);
      },
      async sdTeamLinkAction(entry, action, groupId) {
        if (!this.sdTeamScope || this.sdTeamBusy || !this._cloud) return;
        const request = this.sdTeamRequestContext();
        const { scope, client, signal, current } = request;
        const link = this.sdTeamEntryLink(entry);
        if (!link) return;
        this.sdTeamBusy = true;
        try {
          const body = { ...branchFields(scope), entryId: entry.id, action, ...(groupId ? { groupId } : {}),
            expectedLinkRevision: link.revision, idempotencyKey: root.crypto.randomUUID() };
          const branch = await client.request('/v1/sd-team-branch/link', { method: 'POST', body, signal });
          if (!current()) return;
          this.sdTeamBranch = branch;
          this.sdTeamReconcileResult = null;
          this.sdTeamActionError = '';
          this._sdTeamCheckedSequences = null;
          await root.OfflineStore.putSDTeamBranchView(scope, { branch, policy: copy(this.sdTeamPolicy) });
        } catch (error) { if (current()) this.sdTeamActionError = error.message || String(error); }
        finally {
          if (current()) {
            this.sdTeamBusy = false;
            if (this.sdTeamLinkedSaveKey) this.sdTeamMaybeReconcile(this.sdTeamLinkedSaveKey);
          }
        }
      },
      async sdTeamReconcile(cursor, background = false, entryId = this.sdTeamBranch?.head?.id) {
        if (!this.sdTeamScope || this.sdTeamBusy || this.sdTeamReconcileBusy || !this._cloud) return;
        const request = this.sdTeamRequestContext();
        const { scope, client, signal, current } = request;
        this.sdTeamReconcileBusy = true;
        let follow;
        try {
          let body = this._sdTeamReconcileCommand;
          if (body?.entryId) entryId = body.entryId;
          let entry = this.sdTeamGraphRows.find(node => node.id === entryId), link = this.sdTeamEntryLink(entry);
          let linked = link?.linked;
          if (!body) {
            const branch = await client.request(branchPath(scope), { signal });
            if (!current()) return;
            this.sdTeamBranch = branch;
            entry = [branch.head, ...(branch.history || [])].find(node => node?.id === entryId);
            link = entry?.link || (entry?.id === branch.head?.id ? branch.link : null);
            linked = link?.linked || (entry?.id === branch.head?.id ? branch.linked : null);
            if (!entry || !linked || linked.sharedRoom || linked.ended) return;
            body = { ...branchFields(scope), expectedHeadId: branch.head.id, entryId: entry.id,
              ...(link ? { expectedLinkRevision: link.revision } : {}), expectedGroupId: linked.groupId,
              expectedSourceSequence: entry.sequence, expectedTargetSequence: linked.sequence, idempotencyKey: root.crypto.randomUUID(), ...(cursor ? { cursor } : {}) };
            this._sdTeamReconcileCommand = body;
          }
          const result = await client.request('/v1/sd-team-branch/reconcile', { method: 'POST', body, signal });
          if (!current()) return;
          this._sdTeamReconcileCommand = null;
          const previous = body.cursor && this.sdTeamReconcileResult?.entry?.id === entry?.id ? this.sdTeamReconcileResult : null;
          const conflicts = [...(previous?.conflicts || []), ...(result.conflicts || [])];
          if (!background || conflicts.length || previous) {
            this.sdTeamReconcileResult = { ...result, entry, linked, copied: (previous?.copied || 0) + (result.copied || 0), conflicts };
          } else if (result.nextCursor == null && this.sdTeamReconcileResult?.entry?.id === entry?.id) {
            this.sdTeamReconcileResult = null;
          }
          const checked = (this._sdTeamCheckedSequences ||= new Map());
          if (entry?.roomId) checked.set(entry.roomId, result.sourceSequence);
          if (linked?.roomId) checked.set(linked.roomId, result.targetSequence);
          if (background && result.nextCursor != null) follow = result.nextCursor;
          this.sdTeamReconcileError = '';
        } catch (error) {
          if (!current()) return;
          if (!transient(error)) this._sdTeamReconcileCommand = null;
          this.sdTeamReconcileError = error.message || String(error);
        } finally {
          if (current()) {
            this.sdTeamReconcileBusy = false;
            if (follow != null) queueMicrotask(() => this.sdTeamReconcile(follow, true, entryId));
          }
        }
      },
    },
  };
  return { mixin, advanceBody, graphRows, matchesOriginal, branchPath, originalPath };
});
