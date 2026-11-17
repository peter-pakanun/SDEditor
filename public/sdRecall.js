/* Historical SD text is recalled on demand. Viewing never replaces the editor draft. */
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const api = factory(root, node ? require('./statDescCodec.js') : root.StatDescCodec);
  if (node) module.exports = api; else root.SDRecall = api;
})(typeof window === 'object' ? window : globalThis, function (root, codec) {
  'use strict';
  const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const identity = choice => JSON.stringify([choice.version.id, choice.group.id]);
  const candidateKey = candidate => candidate ? JSON.stringify([root.WorkspaceState?.droppedOwnership(candidate) || candidate.ownership || 'local', candidate.id, candidate.revision || 0]) : '';
  function referenceChoices(versions, current, group, language) {
    if (!current?.id) return [];
    const byId = new Map(versions.map(version => [version.id, version])); byId.set(current.id, current);
    const ancestors = [], seen = new Set([current.id]);
    let parent = current.parentVersionId;
    while (parent && !seen.has(parent)) {
      seen.add(parent); const version = byId.get(parent); if (!version) break;
      if (version.game !== current.game || (version.branchId || 'default') !== (current.branchId || 'default')) break;
      ancestors.push(version); parent = version.parentVersionId;
    }
    return ancestors.flatMap(version => (version.contentGroups || []).filter(candidate => candidate.contentMode === 'statdescription'
      && (candidate.logicalKey || 'statdescription') === (group?.logicalKey || 'statdescription')
      && (candidate.teams || []).some(team => (typeof team === 'string' ? team : team.language) === language))
      .map(candidate => ({ id: identity({ version, group: candidate }), version, group: candidate,
        label: version.name || version.id, archive: candidate.assets?.find(asset => asset.role === 'source')?.descriptor || null })));
  }
  function matchingCandidates(candidates, choice, choices) {
    const baselineId = choice?.archive?.baselineId;
    if (!baselineId) return [];
    return candidates.filter(candidate => {
      const ref = candidate.sourceRef || candidate.snapshot?.sourceRef || {}, origin = candidate.origin || {};
      if ((candidate.originSourceHash || ref.baselineId) !== baselineId || !candidate.snapshot?.translations) return false;
      const versionId = ref.versionId || candidate.originVersionId || origin.versionId || origin.scope?.versionId;
      const groupId = ref.groupId || candidate.originGroupId || origin.groupId || origin.scope?.groupId;
      if (versionId && versionId !== choice.version.id || groupId && groupId !== choice.group.id) return false;
      return !!(versionId || groupId) || choices.filter(item => item.archive?.baselineId === baselineId).length === 1;
    });
  }
  function completeReview(review) {
    return !!review && codec.translationIssues(review.values, review.currentEnglish.length).valid
      && review.values.every((value, index) => value !== review.retained[index] || review.confirmed[index]);
  }
  const mixin = {
    data() { return { sdRecallVisible: false, sdRecallLoading: false, sdRecallSaving: false, sdRecallError: '',
      sdRecallNotice: '', sdRecallReferences: [], sdRecallReferenceId: '', sdRecallCandidateId: '', sdRecallReview: null,
      sdRecallWhitespace: false, sdRecallCharacters: false }; },
    computed: {
      sdRecallScope() { return JSON.stringify([this.editorToolsScope, this.editorContentGroupScopeKey,
        this.editorCurrentEditingDesc?.filepath, this._editorOpenRun, this.cloudUser?.id, this.cloudUser?.role,
        this.cloudUser?.assignmentVersion, this.cloudCanAccessAllLanguages, !!this.ctActive]); },
      sdRecallReference() { return this.sdRecallReferences.find(choice => choice.id === this.sdRecallReferenceId) || null; },
      sdRecallCandidates() { return matchingCandidates(this.editorDroppedChoices || [], this.sdRecallReference, this.sdRecallReferences); },
      sdRecallCanSave() { return !this.sdRecallLoading && !this.sdRecallSaving && !this.editorSaving && !this.editorTranslationReadOnly
        && this.sdRecallReview?.scope === this.sdRecallScope && completeReview(this.sdRecallReview); },
    },
    watch: {
      sdRecallScope() { this.sdRecallClose(true); this._sdRecallReviews = new Map(); },
      editorSessionActive(value) { if (!value) this.sdRecallClose(true); },
    },
    methods: {
      sdRecallCurrent(owner = this._sdRecallOwner) { return !!owner && owner === this._sdRecallOwner && this.sdRecallVisible
        && owner.scope === this.sdRecallScope && owner.desc === this.editorCurrentEditingDesc
        && this.collaborationContextCurrent(owner.context); },
      sdRecallRemember() {
        if (!this.sdRecallReview || !this.sdRecallCurrent()) return;
        this._sdRecallReviews ||= new Map();
        this._sdRecallReviews.set(this.sdRecallReview.key, copy(this.sdRecallReview));
        while (this._sdRecallReviews.size > 8) this._sdRecallReviews.delete(this._sdRecallReviews.keys().next().value);
      },
      async sdRecallOpen() {
        if (this.ctActive || !this.editorReady || this.editorSaving || this.entryAlignment || this.editorCompareActive) return;
        const desc = this.editorCurrentEditingDesc, context = this.captureCollaborationContext(), scope = this.sdRecallScope;
        if (!desc || this.flushEditorDraft && !await this.flushEditorDraft()) return;
        if (scope !== this.sdRecallScope || desc !== this.editorCurrentEditingDesc || !this.collaborationContextCurrent(context)) return;
        const owner = this._sdRecallOwner = { desc, context, scope, blocks: this.editorBlocks,
          cloud: this._cloud, cloudContext: this._cloud?.context?.(),
          base: copy(this._editorCollabBase || this.collaborationFile(desc)), request: 0 };
        this.sdRecallVisible = true; this.sdRecallReview = null; this.sdRecallError = ''; this.sdRecallNotice = '';
        this.sdRecallReferenceId = ''; this.sdRecallCandidateId = ''; this.sdRecallLoading = true;
        await this.$nextTick(); if (!this.sdRecallCurrent(owner)) return;
        this.$refs.sdRecallDialog?.showModal?.();
        try {
          const known = this.managedVersions || [], current = this.managedActiveVersion
            || known.find(version => version.id === (this.activeContentGroup?.versionId || this.localDescs?.catalogVersionId));
          this.sdRecallReferences = referenceChoices(known, current, this.activeContentGroup, context.language);
          if (!this.sdRecallReferences.length && this.cloudSignedIn && this.refreshManagedVersions) {
            await this.refreshManagedVersions(); if (!this.sdRecallCurrent(owner)) return;
            const refreshed = (this.managedVersions || []).find(version => version.id === current?.id) || current;
            this.sdRecallReferences = referenceChoices(this.managedVersions || [], refreshed, this.activeContentGroup, context.language);
          }
          if (!this.sdRecallReferences.length) {
            this.sdRecallNotice = 'No earlier assigned StatDescription source is available in this version’s ancestry.'; return;
          }
          await this.sdRecallSelect(this.sdRecallReferences[0].id);
        } catch (error) { if (this.sdRecallCurrent(owner) && !error.stale) this.sdRecallError = error.message; }
        finally { if (this.sdRecallCurrent(owner)) this.sdRecallLoading = false; }
      },
      sdRecallClose(force = false) {
        if (this.sdRecallSaving && !force) return;
        this.sdRecallRemember(); this._sdRecallOwner = null;
        this.sdRecallVisible = false; this.sdRecallLoading = false; this.sdRecallSaving = false;
        this.sdRecallReview = null; this.sdRecallError = ''; this.sdRecallNotice = '';
        this.$refs.sdRecallDialog?.close?.();
      },
      async sdRecallSelect(id, selectedCandidate = '') {
        const owner = this._sdRecallOwner; if (!this.sdRecallCurrent(owner) || this.sdRecallSaving) return;
        const changedReference = id !== this.sdRecallReferenceId || selectedCandidate !== this.sdRecallCandidateId;
        this.sdRecallRemember(); this.sdRecallReferenceId = id; this.sdRecallCandidateId = selectedCandidate;
        const choice = this.sdRecallReference; if (!choice) return;
        const request = ++owner.request, current = () => this.sdRecallCurrent(owner) && owner.request === request;
        this.sdRecallReview = null; this.sdRecallLoading = true; if (changedReference) this.sdRecallError = ''; this.sdRecallNotice = '';
        try {
          let live = null, savedUnavailable = false;
          if (this.cloudSignedIn && owner.cloud?.request) {
            try {
              live = await owner.cloud.request('/v1/content-groups/' + encodeURIComponent(choice.group.id) + '/teams/'
                + encodeURIComponent(owner.context.language) + '/recall?filepath=' + encodeURIComponent(owner.desc.filepath), {}, owner.cloudContext);
              if (!current()) return;
              if (live.group?.id !== choice.group.id || live.group?.versionId !== choice.version.id || live.version?.id !== choice.version.id
                || live.version.game !== owner.context.game || (live.version.branchId || 'default') !== owner.context.branchId
                || live.language !== owner.context.language || live.group.contentMode !== 'statdescription'
                || (live.group.logicalKey || 'statdescription') !== (choice.group.logicalKey || 'statdescription')
                || choice.archive?.baselineId && live.archive?.baselineId !== choice.archive.baselineId
                || live.file && live.file.filepath !== owner.desc.filepath)
                throw Object.assign(new Error('The historical translation belongs to another source context.'), { stale: true });
              choice.archive = live.archive;
            } catch (error) {
              if (!current() || error.stale) throw error;
              if ([401, 403].includes(error.status)) throw error;
              savedUnavailable = true;
            }
          } else savedUnavailable = true;
          if (!current()) return;
          const sourceHash = choice.archive?.baselineId || choice.version.sourceHash;
          let archive = choice.archive || (sourceHash ? await root.OfflineStore?.getBaselineArchive?.({ game: owner.context.game,
            baselineId: sourceHash }) : null);
          if (!current()) return;
          if (archive) choice.archive = archive;
          const candidates = matchingCandidates(this.editorDroppedChoices || [], choice, this.sdRecallReferences);
          let candidate = candidates.find(item => candidateKey(item) === selectedCandidate) || (candidates.length === 1 ? candidates[0] : null);
          if (candidates.length > 1 && !candidate) {
            this.sdRecallNotice = 'Several preserved copies match this source. Choose the exact recovery copy before reviewing.'; return;
          }
          this.sdRecallCandidateId = candidateKey(candidate);
          let values = candidate?.snapshot?.translations ? [...candidate.snapshot.translations] : null,
            kind = candidate ? (this.droppedOwnershipLabel?.(candidate) || 'Preserved recovery') : '';
          if (!values && live?.file?.trackedForExport) { values = copy(live.file.translations); kind = 'Accepted Saved translation'; }
          let file = null, sourceError = '';
          if (archive) {
            try {
              file = await root.SDBaselineFiles.resolveBaselineFile({ game: owner.context.game, baselineId: archive.baselineId,
                archive, filepath: owner.desc.filepath, language: owner.context.language }, {
                archive, current, readScope: JSON.stringify([owner.scope, choice.id, owner.context.account]),
                fetchZip: this.cloudSignedIn && owner.cloud?.request ? () => owner.cloud.request('/v1/content-groups/'
                  + encodeURIComponent(choice.group.id) + '/assets/source/original', { responseType: 'blob', timeout: 180000 }, owner.cloudContext) : undefined,
              });
            } catch (error) { if (error.stale) throw error; sourceError = error.message || 'The earlier original ZIP is unavailable.'; }
          } else sourceError = 'The earlier original ZIP descriptor is unavailable.';
          if (!current()) return;
          if (!values) {
            values = file?.translations?.[owner.context.language] ? [...file.translations[owner.context.language]] : null;
            kind = savedUnavailable ? 'Original ZIP translation · latest historical Saved work could not be checked' : 'Original ZIP translation';
            if (values && !codec.translationIssues(values, file.translations.English.length).valid) values = null;
          }
          if (!Array.isArray(values) || !values.length || values.some(value => typeof value !== 'string' || codec.isBlankTranslation(value))) {
            this.sdRecallNotice = sourceError || 'This historical version has no complete translation for this file and language.'; return;
          }
          const currentEnglish = [...(this.workspaceSourceFile?.(owner.desc.filepath) || owner.desc).translations.English],
            oldEnglish = file?.translations?.English || (candidate?.originSourceAvailable !== false ? candidate?.snapshot?.english : null) || null,
            key = JSON.stringify([owner.scope, choice.id, candidateKey(candidate), values]);
          const cached = this._sdRecallReviews?.get(key);
          this.sdRecallReview = cached ? copy(cached) : { scope: owner.scope, key, label: choice.label, kind,
            archive: copy(archive), candidate: copy(candidate), retained: [...values], currentEnglish, oldEnglish: copy(oldEnglish),
            values: values.length === currentEnglish.length ? [...values] : currentEnglish.map(() => ''), confirmed: currentEnglish.map(() => false) };
          this.sdRecallError = '';
          this.sdRecallNotice = [sourceError && (oldEnglish ? 'The verified original could not be loaded; this recovery’s frozen English is shown.'
            : 'The earlier English source is unavailable. The retained translation remains available for review.'),
            savedUnavailable && candidate && 'Latest historical Saved work could not be checked; this exact frozen recovery is used.',
            values.length !== currentEnglish.length && 'The entry counts differ. The complete retained text is shown below; align it manually into every current entry.'].filter(Boolean).join(' ');
        } catch (error) { if (current() && !error.stale) this.sdRecallError = error.message; }
        finally { if (current()) this.sdRecallLoading = false; }
      },
      sdRecallCandidateKey: candidateKey,
      sdRecallDiffLimited(index) {
        const review = this.sdRecallReview;
        return String(review?.oldEnglish?.[index] || '').length + String(review?.currentEnglish?.[index] || '').length > 240000;
      },
      sdRecallDiff(index) {
        const review = this.sdRecallReview; if (!review?.oldEnglish || this.sdRecallDiffLimited(index)) return '';
        return this.renderInlineDiffHtml(this.decodeEscapedNewlines(review.oldEnglish[index] || ''),
          this.decodeEscapedNewlines(review.currentEnglish[index] || ''),
          { showWhitespace: this.sdRecallWhitespace, characters: this.sdRecallCharacters });
      },
      sdRecallSetValue(index, value) {
        if (!this.sdRecallCurrent() || this.sdRecallSaving || !this.sdRecallReview) return;
        this.sdRecallReview.values[index] = this.encodeNewlines(value); this.sdRecallReview.confirmed[index] = false;
      },
      sdRecallConfirm(index) {
        if (!this.sdRecallCurrent() || this.sdRecallSaving || !this.sdRecallReview) return;
        this.sdRecallReview.confirmed[index] = !this.sdRecallReview.confirmed[index];
      },
      async sdRecallSave() {
        const owner = this._sdRecallOwner, review = this.sdRecallReview;
        if (!this.sdRecallCurrent(owner) || !this.sdRecallCanSave || !review) return false;
        const values = [...review.values], normal = this.editorBlocks.map(block => block.translation ?? ''), originals = [...this.editorOriginalTranslations];
        const current = () => this.sdRecallCurrent(owner) && review === this.sdRecallReview && same(values, review.values);
        const saveToken = this._editorSaveToken = {};
        this.sdRecallSaving = true; this.editorSaving = true;
        try {
          if (!same(owner.base, this._editorCollabBase || this.collaborationFile(owner.desc)))
            throw new Error('The current translation changed while this reference was open. Reopen the recall viewer before saving.');
          codec.assertCompleteTranslation(values, review.currentEnglish.length, owner.desc.filepath);
          const diagnosis = this.analyzeDescDiagnostics?.({ ...owner.desc, translations: { ...owner.desc.translations,
            [owner.context.language]: values } }, owner.context.language, null,
            { whitespace: true, dash: true, tagSyntax: true, variables: true, keywords: true, decorations: true,
              consistency: false, terminology: false }, { translationCandidate: true });
          if (diagnosis?.errorCount) throw new Error('The recalled translation has errors against the current source. Correct them before saving. '
            + (this.formatDiagnosticsForDisplay?.((diagnosis.diagnostics || []).filter(item => item.level === 'error'), 6) || ''));
          if (diagnosis?.warningCount && !await this.appConfirm('This translation has ' + diagnosis.warningCount + ' diagnostic warning(s). Save the complete reviewed file?\n\n'
            + (this.formatDiagnosticsForDisplay?.(diagnosis.diagnostics || [], 6) || ''))) return false;
          if (!current()) return false;
          const promotion = review.candidate ? this.capturedDroppedPromotion(owner.desc.filepath, review.candidate) : null;
          const result = await this.persistTranslationBatch([{ desc: owner.desc, lines: values, needsReview: false }], 'save', {
            context: owner.context, bases: { [owner.desc.filepath]: copy(owner.base) }, awaitDurable: true,
            preserveDropped: !promotion, ...(promotion ? { promoteDropped: promotion } : {}) });
          if (!current() || result?.stale || result?.status === 'conflict' || result?.durable === false) return false;
          const accepted = owner.context.client?.fileBase?.(owner.desc.filepath) || this.collaborationFile(owner.desc);
          this.rebaseEditorAfterCommit?.(accepted, { draftBefore: normal, submittedTranslations: values, savedIndexes: [],
            baseBefore: owner.base, originalsBefore: originals });
          // A separate authored normal draft is deliberately retained. It must
          // still pass its existing base/revision review before a later Save.
          await this.flushEditorDraft?.();
          if (!this.sdRecallCurrent(owner)) return true;
          this._sdRecallReviews?.delete(review.key); this.sdRecallSaving = false; this.sdRecallClose(true);
          return true;
        } catch (error) { if (this.sdRecallCurrent(owner)) this.sdRecallError = error.message; return false; }
        finally { if (this._sdRecallOwner === owner) this.sdRecallSaving = false; if (this._editorSaveToken === saveToken) this.editorSaving = false; }
      },
    },
  };
  return { mixin, referenceChoices, matchingCandidates, completeReview, candidateKey };
});
