/* Source hydration belongs to the requested comparison, never to recovery state. */
(() => {
  const root = window, copy = value => JSON.parse(JSON.stringify(value));
  const candidateKey = candidate => candidate ? JSON.stringify([candidate.id || '', Number(candidate.revision) || 0,
    candidate.originSourceHash || '', candidate.originSourceAvailable !== false,
    candidate.filepath || '', candidate.game || '', candidate.language || '', candidate.status || 'dropped']) : '';
  function validateSnapshot(file, snapshot) {
    if (!snapshot?.english?.length) return;
    const expected = { english: snapshot.english, variables: snapshot.variables, remarks: snapshot.remarks, stats: snapshot.stats, name: snapshot.name };
    const actual = { english: file.translations.English, variables: file.variables, remarks: file.remarks, stats: file.stats, name: file.name };
    if (Object.keys(expected).some(field => expected[field] !== undefined && JSON.stringify(actual[field]) !== JSON.stringify(expected[field]))) {
      throw new Error('The retained ZIP source or entry metadata differs from this frozen recovery record. Import its original ZIP to compare the exact source.');
    }
  }
  const mixin = {
    data() { return { sdDroppedSource: null, sdDroppedSourceLoading: false, sdDroppedSourceError: '', sdHistorySourceError: '' }; },
    computed: {
      sdBaselineViewScope() { return JSON.stringify([this.editorToolsScope, this.editorContentGroupScopeKey || '',
        this.collaborationContext, this.cloudUser?.role, this.cloudUser?.assignmentVersion, this.cloudCanAccessAllLanguages,
        this.editorCurrentEditingDesc?.filepath, this._editorOpenRun]); },
    },
    watch: {
      editorDroppedCandidate() { this.loadSDDroppedSource({ background: true }); },
      editorVisible() { this.loadSDDroppedSource(); },
      sdBaselineViewScope() { this.loadSDDroppedSource({ background: true }); this.sdHistorySourceError = ''; },
    },
    methods: {
      sdDroppedCandidateIdentity: candidateKey,
      sdSourceReference(record) {
        if (this.testMode) return null;
        const value = record?.sourceRef || record?.snapshot?.sourceRef
          || (record?.snapshot && record.originSourceAvailable !== false && record.originSourceHash
            ? { baselineId: record.originSourceHash, filepath: record.filepath, candidateId: record.id } : null)
          || (record?.lang === 'English' && record.sourceHash ? { baselineId: record.sourceHash, filepath: record.filepath } : null);
        if (!value) return null;
        return { ...copy(value), game: value.game || this.gameVersion,
          filepath: value.filepath || record.filepath || this.editorCurrentEditingDesc?.filepath };
      },
      async resolveSDSource(reference, { current, snapshot } = {}) {
        const ref = { ...copy(reference) }, roomId = ref.roomId || this.collaborationState?.roomId;
        const versionId = ref.versionId || (ref.baselineId === this.sourceIdentity || ref.sourceHash === this.sourceIdentity
          ? this.localDescs?.catalogVersionId : '');
        const cloud = this._cloud, cloudContext = cloud?.context?.(), online = this.cloudSignedIn;
        const sourceBaselineId = this.importBaseline?.archive?.baselineId;
        const memoryFile = (ref.baselineId || ref.sourceHash) === sourceBaselineId && !ref.roomId ? this.workspaceSourceFile?.(ref.filepath) : null;
        const readScope = JSON.stringify([cloudContext?.profile || this.cloudProfileId || this.cloudUser?.id || 'guest', cloudContext?.epoch,
          cloudContext?.language || this.lang, cloudContext?.assignedLanguage || this.cloudUser?.language,
          cloudContext?.assignmentVersion ?? this.cloudUser?.assignmentVersion, cloudContext?.role || this.cloudUser?.role,
          cloudContext?.allLanguages ?? this.cloudCanAccessAllLanguages, this.gameVersion, this.branchId || 'default',
          this.activeContentGroup?.versionId || this.localDescs?.catalogVersionId || '', this.activeContentGroup?.id || '', roomId || '', versionId || '']);
        return root.SDBaselineFiles.resolveBaselineFile(ref, { current,
          readScope,
          validateFile: snapshot?.english?.length ? file => validateSnapshot(file, snapshot) : undefined,
          readFile: async source => {
            if (memoryFile) return memoryFile;
            return root.OfflineStore?.getBaselineFile?.(source);
          },
          fetchFile: online && cloud?.request && (roomId || versionId) ? source => {
            const path = roomId ? '/v1/collaboration/rooms/' + encodeURIComponent(roomId) + '/baseline-file'
              : '/v1/versions/' + encodeURIComponent(versionId) + '/baseline-file';
            return cloud.request(path + '?filepath=' + encodeURIComponent(source.filepath)
              + '&sourceHash=' + encodeURIComponent(source.baselineId || source.sourceHash)
              + (source.candidateId ? '&candidateId=' + encodeURIComponent(source.candidateId) : ''), {}, cloudContext);
          } : undefined });
      },
      async loadSDDroppedSource({ background = false } = {}) {
        const candidate = this.editorDroppedCandidate;
        const scope = this.sdBaselineViewScope, session = this._editorOpenRun, identity = candidateKey(candidate), binding = JSON.stringify([identity, scope]);
        if (background && this.editorVisible && this._sdDroppedSourceFailure === binding) return null;
        if (background && this.editorVisible && this._sdDroppedSourceBinding === binding && this.sdDroppedSource && !this.sdDroppedSourceError) {
          try { validateSnapshot(this.sdDroppedSource, candidate?.snapshot); return this.sdDroppedSource; } catch (_) {}
        }
        const generation = this._sdDroppedSourceRun = (this._sdDroppedSourceRun || 0) + 1;
        const current = () => generation === this._sdDroppedSourceRun && identity === candidateKey(this.editorDroppedCandidate) && scope === this.sdBaselineViewScope && session === this._editorOpenRun;
        this._sdDroppedSourceBinding = binding;
        this.sdDroppedSource = null; this.sdDroppedSourceLoading = false;
        if (this._sdDroppedSourceFailure !== binding) this.sdDroppedSourceError = candidate?.sourceUnavailable
          ? candidate.sourceError || 'The original ZIP source is unavailable. Reconnect or import the original ZIP to compare this file. Your translation can still be reviewed and saved.' : '';
        if (!candidate || !this.editorVisible || this.ctActive) return null;
        const ref = this.sdSourceReference(candidate);
        // Resolve immutable provenance even when a compatibility response has
        // inline English. Keep that recovery snapshot and its signature exact.
        if (!ref) return null;
        this.sdDroppedSourceLoading = true;
        try {
          const file = await this.resolveSDSource(ref, { current, snapshot: candidate.snapshot });
          if (!current()) return null;
          this.sdDroppedSource = file; this.sdDroppedSourceError = ''; this._sdDroppedSourceFailure = null;
          if (this.editorShowEnglishDiff) this.prepareEditorEnglishDiff();
          this.offerEntryAlignment?.();
          return file;
        } catch (error) {
          if (current() && !error.stale) {
            this._sdDroppedSourceFailure = binding;
            this.sdDroppedSourceError = (error.message || 'Reconnect or import the original ZIP to compare this source. Your dropped translation is preserved.')
              + (candidate.snapshot?.english?.length ? ' The frozen source in this recovery record is shown below.' : '');
          }
          return null;
        } finally { if (current()) this.sdDroppedSourceLoading = false; }
      },
      async hydrateSDHistorySource(record, { current, sourceMode = false } = {}) {
        const ref = this.sdSourceReference(record);
        if (!ref) return record;
        const file = await this.resolveSDSource(ref, { current });
        return { ...record, english: [...file.translations.English], variables: [...file.variables], remarks: [...file.remarks],
          stats: [...file.stats], name: file.name,
          ...(sourceMode ? { translations: [...file.translations.English] } : {}) };
      },
    },
  };
  root.SDBaselineUI = { mixin };
})();
