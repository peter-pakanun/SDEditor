/* File discussions include authorized language teams and global posts across source versions. */
(() => {
  const emptyFeed = () => ({ items: [], loadedIds: [], cursor: null, loading: false, loadingMore: false, moreRequested: false, loaded: false, error: '' });
  const ordered = items => [...new Map(items.map(item => [item.id, item])).values()].sort((a, b) => b.id - a.id);
  const mixin = {
    data() { return {
      commentsAllVisible: false, commentsFileFeed: emptyFeed(), commentsAllFeed: emptyFeed(),
      commentsUnreadTotal: 0, commentsUnreadFiles: {}, commentsUnreadFetchError: '', commentsUnreadReadError: '',
      commentsDrafts: {}, commentsDraftScopes: {}, commentsPosts: {}, commentsPostErrors: {},
    }; },
    computed: {
      commentsIdentity() {
        const shared = this.sharedCommentIdentity;
        if (shared) return shared;
        const group = this.activeContentGroup;
        return { mode: 'statdescription', filepath: this.editorCurrentEditingDesc?.filepath || '',
          sourceHash: this.sourceIdentity, groupId: group && !group.legacyVersionId ? group.id : null,
          versionId: group?.versionId || '', branchId: this.branchId || 'default', language: this.lang };
      },
      commentsEligible() {
        return !this.testMode && this.cloudSignedIn && !!this.cloudUser?.id && !!(this.cloudCanAccessAllLanguages || this.cloudUser?.language)
          && ['poe1', 'poe2'].includes(this.gameVersion) && !!this._cloud
          && (this.commentsIdentity.mode !== 'clienttext' || (!!this.commentsIdentity.groupId
            && !/^(?:local|staged):/.test(this.commentsIdentity.groupId)
            && (this.cloudCanAccessAllLanguages || this.commentsIdentity.language === this.cloudUser?.language)));
      },
      commentsLanguage() { return this.cloudCanAccessAllLanguages ? this.commentsIdentity.language || this.lang : this.cloudUser?.language; },
      commentsContextKey() {
        return JSON.stringify([this.testMode, this.cloudSignedIn, this.cloudUser?.id, this.cloudUser?.language,
          this.cloudUser?.assignmentVersion, this.cloudUser?.role, this.cloudCanAccessAllLanguages, this.commentsLanguage, this.gameVersion,
          this.commentsIdentity.mode, this.commentsIdentity.groupId || '', this.commentsIdentity.versionId || '',
          this.branchId || 'default', this.commentsIdentity.branchId || this.branchId || 'default']);
      },
      commentsUnavailableReason() {
        if (this.testMode) return 'Shared comments are unavailable in test mode.';
        if (!this.cloudSignedIn) return 'Sign in to read and share comments with your translation team.';
        if (!this.cloudCanAccessAllLanguages && !this.cloudUser?.language) return 'An admin must assign your team language before comments are available.';
        if (!['poe1', 'poe2'].includes(this.gameVersion)) return 'Choose a game to view its comments.';
        if (this.commentsIdentity.mode === 'clienttext' && !this.commentsEligible) return 'Select a published ClientText group with language access to use shared comments.';
        return '';
      },
      commentsFilepath() { return this.commentsIdentity.filepath || ''; },
      commentsFileLabel() { return this.commentsIdentity.label || this.commentsFilepath; },
      commentsDraftKey() {
        const identity = this.commentsIdentity;
        return JSON.stringify([this.cloudUser?.id, this.commentsLanguage, this.gameVersion, this.commentsFilepath, identity.sourceHash,
          ...(identity.groupId ? [identity.versionId, identity.groupId] : [])]);
      },
      commentsFileDraft: {
        get() { return this.commentsIdentity.mode === 'clienttext' ? this.ctCommentText || '' : this.commentsDrafts[this.commentsDraftKey] || ''; },
        set(value) {
          if (this.commentsIdentity.mode === 'clienttext') { this.ctCommentText = String(value); this.ctQueueCommentDraft?.(); }
          else this.commentsDrafts[this.commentsDraftKey] = String(value);
          this.commentsPostErrors[this.commentsDraftKey] = '';
        },
      },
      commentsFileAllLanguages: {
        get() { return this.commentsIdentity.mode === 'clienttext' ? this.ctCommentGlobal === true : this.commentsDraftScopes[this.commentsDraftKey] === true; },
        set(value) {
          if (this.commentsIdentity.mode === 'clienttext') { this.ctCommentGlobal = value === true; this.ctQueueCommentDraft?.(); }
          else this.commentsDraftScopes[this.commentsDraftKey] = value === true;
        },
      },
      commentsCanPost() { return this.commentsCanPostTo(this.commentsFilepath); },
      commentsPosting() { return !!this.commentsPosts[this.commentsDraftKey]?.pending || this.commentsIdentity.mode === 'clienttext' && !!this.ctBusy; },
      commentsPostError() { return this.commentsPostErrors[this.commentsDraftKey] || ''; },
      commentsFileItems() { return this.commentsFileFeed.items; },
      commentsFileLoading() { return this.commentsFileFeed.loading; },
      commentsFileBusy() { return (!this.commentsFileFeed.loaded && this.commentsFileLoading) || this.commentsFileFeed.loadingMore; },
      commentsFileError() { return this.commentsFileFeed.error; },
      commentsFileHasMore() { return this.commentsFileFeed.cursor != null; },
      commentsAllItems() { return this.commentsAllFeed.items; },
      commentsAllGroups() {
        const groups = new Map();
        // The flat feed is newest first, so its first occurrence orders files by
        // latest activity. Reverse only each group's new array for conversation order.
        for (const item of this.commentsAllItems) {
          const key = JSON.stringify([item.groupId || '', item.filepath]);
          if (!groups.has(key)) groups.set(key, { key, filepath: item.filepath, groupId: item.groupId || null, items: [] });
          groups.get(key).items.push(item);
        }
        return [...groups.values()].map(group => ({ ...group, items: group.items.reverse() }));
      },
      commentsAllLoading() { return this.commentsAllFeed.loading; },
      commentsAllBusy() { return (!this.commentsAllFeed.loaded && this.commentsAllLoading) || this.commentsAllFeed.loadingMore; },
      commentsAllError() { return this.commentsAllFeed.error; },
      commentsAllHasMore() { return this.commentsAllFeed.cursor != null; },
      commentsFileUnread() { return this.commentsUnreadFiles[this.commentsFilepath] || 0; },
      commentsUnreadError() { return [this.commentsUnreadFetchError, this.commentsUnreadReadError].filter(Boolean).join(' '); },
      commentsUiBlocked() {
        return !!(this.showMultiInstanceGate || this.showSetting || this.settingsDialogVisible || this.importDialogVisible
          || this.consistencyResolver || this.cloudResolverVisible || this.cloudHistoryVisible || this.duplicateLangImportWarning
          || this.settingsImportDraft || this.pendingSingleVersionMigration || this.collaborationConflictVisible || this.collaborationHistoryVisible);
      },
    },
    watch: {
      commentsContextKey() { this.commentsResetContext(); },
      commentsFilepath() { this.commentsResetFile(); },
      sideTab() { this.commentsSurfaceChanged(); },
      editorVisible() { this.commentsSurfaceChanged(); },
      editorToolsVisible() { this.commentsSurfaceChanged(); },
      sharedEditorToolsVisible() { this.commentsSurfaceChanged(); },
      sharedEditorTool() { this.commentsSurfaceChanged(); },
      ctTool() { this.commentsSurfaceChanged(); },
      ctEditor() { this.commentsSurfaceChanged(); },
      commentsAllVisible() { this.commentsSurfaceChanged(); },
      commentsUiBlocked() { this.commentsSurfaceChanged(); },
    },
    mounted() {
      this._commentsDestroyed = false;
      this._commentsVisibility = () => {
        this.commentsObserveVisible();
        if (!document.hidden) this.commentsPoll();
      };
      document.addEventListener('visibilitychange', this._commentsVisibility);
      window.addEventListener('online', this._commentsVisibility);
      const dialog = this.getEditorComponentRef?.('diagnosticScanDialog') || this.$refs.diagnosticScanDialog;
      if (dialog && typeof MutationObserver !== 'undefined') {
        this._commentsDialogObserver = new MutationObserver(() => this.commentsSurfaceChanged());
        this._commentsDialogObserver.observe(dialog, { attributes: true, attributeFilter: ['open'] });
      }
      this._commentsPollTimer = setInterval(() => this.commentsPoll(), 20000);
      this.commentsResetContext();
    },
    beforeUnmount() {
      this._commentsDestroyed = true;
      this._commentsGeneration = (this._commentsGeneration || 0) + 1;
      clearInterval(this._commentsPollTimer); clearTimeout(this._commentsReadTimer);
      this._commentsObserver?.disconnect();
      this._commentsDialogObserver?.disconnect();
      document.removeEventListener('visibilitychange', this._commentsVisibility);
      window.removeEventListener('online', this._commentsVisibility);
    },
    methods: {
      commentsCapture() {
        return { key: this.commentsContextKey, generation: this._commentsGeneration || 0,
          game: this.gameVersion, language: this.commentsLanguage, allLanguagesAccess: !!this.cloudCanAccessAllLanguages,
          groupId: this.commentsIdentity.groupId || null,
          client: this._cloud, auth: this._cloud?.context() };
      },
      commentsCurrent(ctx) {
        return !this._commentsDestroyed && this.commentsEligible && ctx.key === this.commentsContextKey
          && ctx.generation === (this._commentsGeneration || 0) && ctx.client === this._cloud;
      },
      commentsResetContext() {
        this._commentsGeneration = (this._commentsGeneration || 0) + 1;
        this._commentsUnreadTask = null; this._commentsReadTask = null; this._commentsPollRun = null;
        this._commentsReadDone = new Set(); this._commentsVisible = new Map(); this._commentsReplyLoaded = new Set();
        clearTimeout(this._commentsReadTimer); this._commentsReadTimer = null; this._commentsObserver?.disconnect();
        this.commentsUnreadTotal = 0; this.commentsUnreadFiles = {}; this.commentsUnreadFetchError = ''; this.commentsUnreadReadError = '';
        this.commentsAllVisible = false; this.commentsAllFeed = emptyFeed();
        this.commentsResetFile();
        this.commentsPoll();
      },
      commentsResetFile() {
        this.commentsFileFeed = emptyFeed();
        this.commentsSurfaceChanged();
      },
      commentsSurfaceVisible(surface) {
        if (document.hidden || this.commentsUiBlocked || (this.getEditorComponentRef?.('diagnosticScanDialog') || this.$refs.diagnosticScanDialog)?.open || !this.commentsEligible) return false;
        const fullEditor = this.sharedEditorController?.editorVisible ?? this.editorVisible;
        const tool = this.sharedEditorController?.sideTab ?? this.sideTab;
        return surface === 'file' ? !!(this.sharedEditorToolsVisible ?? this.editorToolsVisible ?? this.editorSessionActive ?? this.editorVisible) && tool === 'comments' && !!this.commentsFilepath
          : this.commentsAllVisible && !fullEditor;
      },
      commentsSurfaceChanged() {
        this.commentsObserveVisible();
        if (this.commentsSurfaceVisible('file')) this.commentsRefreshFile();
        if (this.commentsSurfaceVisible('all')) this.commentsRefreshAll();
      },
      async commentsToggleAll() {
        if (this.commentsAllVisible) { this.commentsCloseAll(); return; }
        this._commentsReturnFocus = document.activeElement;
        this.commentsAllVisible = true;
        await this.$nextTick();
        this.$refs.commentsAllClose?.focus();
        this.commentsSurfaceChanged();
      },
      commentsCloseAll() {
        this.commentsAllVisible = false;
        this.commentsObserveVisible();
        if (this._commentsReturnFocus?.isConnected) this._commentsReturnFocus.focus();
      },
      async commentsPoll() {
        if (!this.commentsEligible || document.hidden || this.showMultiInstanceGate || this._commentsDestroyed || this._commentsPollRun) return;
        const run = {}; this._commentsPollRun = run;
        try {
          await Promise.allSettled([
            this.commentsRefreshUnread(),
            this.commentsSurfaceVisible('file') ? this.commentsRefreshFile() : Promise.resolve(),
            this.commentsSurfaceVisible('all') ? this.commentsRefreshAll() : Promise.resolve(),
          ]);
          if (this._commentsPollRun === run) this.commentsObserveVisible();
        } finally { if (this._commentsPollRun === run) this._commentsPollRun = null; }
      },
      commentsApplyUnread(result) {
        this.commentsUnreadTotal = Number(result?.total) || 0;
        this.commentsUnreadFiles = Object.fromEntries((result?.files || []).map(item => [item.filepath, Number(item.count) || 0]));
      },
      commentsCaptureReplyFocus() {
        const input = document.activeElement, root = this.$refs.commentsAllList;
        if (!this.commentsSurfaceVisible('all') || !input?.matches?.('.commentsQuickReply input') || !root?.contains(input)) return null;
        return { input, root, context: this.commentsCapture(), sourceHash: this.commentsIdentity.sourceHash,
          top: input.getBoundingClientRect().top, start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection };
      },
      async commentsRestoreReplyFocus(saved) {
        if (!saved) return;
        await this.$nextTick();
        const { input, root } = saved;
        if (!this.commentsCurrent(saved.context) || saved.sourceHash !== this.commentsIdentity.sourceHash || !this.commentsSurfaceVisible('all')
          || !input.isConnected || root !== this.$refs.commentsAllList || !root.contains(input)
          || (document.activeElement !== input && document.activeElement !== document.body)) return;
        // Moving a keyed card can blur its input. Keep a reply in progress at the
        // same viewport position, without taking focus from another control.
        input.focus({ preventScroll: true });
        if (saved.start != null && saved.end != null) input.setSelectionRange(saved.start, saved.end, saved.direction || 'none');
        root.scrollTop += input.getBoundingClientRect().top - saved.top;
      },
      async commentsRefreshUnread() {
        if (!this.commentsEligible || this._commentsUnreadTask || this._commentsReadTask) return;
        const ctx = this.commentsCapture(), task = {};
        this._commentsUnreadTask = task;
        const revision = this._commentsReadRevision || 0;
        try {
          const result = await ctx.client.request('/v1/comments/unread?game=' + encodeURIComponent(ctx.game) + (ctx.groupId ? '&groupId='+encodeURIComponent(ctx.groupId) : ''), {}, ctx.auth);
          if (!this.commentsCurrent(ctx) || revision !== (this._commentsReadRevision || 0)) return;
          this.commentsApplyUnread(result); this.commentsUnreadFetchError = '';
        } catch (error) {
          if (this.commentsCurrent(ctx) && revision === (this._commentsReadRevision || 0) && !error.stale) {
            this.commentsUnreadFetchError = 'Could not refresh unread comments. ' + error.message;
          }
        } finally { if (this._commentsUnreadTask === task) this._commentsUnreadTask = null; }
      },
      commentsRefreshFile() { return this.commentsLoadFeed('file'); },
      commentsLoadMoreFile() { return this.commentsLoadFeed('file', true); },
      commentsRefreshAll() { return this.commentsLoadFeed('all'); },
      commentsLoadMoreAll() { return this.commentsLoadFeed('all', true); },
      async commentsLoadFeed(surface, append = false) {
        if (!this.commentsSurfaceVisible(surface)) return;
        const feed = surface === 'file' ? this.commentsFileFeed : this.commentsAllFeed;
        if (append && feed.cursor == null) return;
        if (feed.loading) {
          // A background refresh must not swallow a click on Load older comments.
          if (append) { feed.moreRequested = true; feed.loadingMore = true; }
          return;
        }
        const ctx = this.commentsCapture(), filepath = surface === 'file' ? this.commentsFilepath : '';
        const current = () => this.commentsCurrent(ctx) && feed === (surface === 'file' ? this.commentsFileFeed : this.commentsAllFeed)
          && (surface !== 'file' || filepath === this.commentsFilepath);
        const params = new URLSearchParams({ game: ctx.game, limit: '50' });
        if (ctx.groupId) params.set('groupId',ctx.groupId);
        if (filepath) params.set('filepath', filepath);
        if (append) params.set('before', feed.cursor);
        feed.loading = true; feed.loadingMore = append;
        try {
          const result = await ctx.client.request('/v1/comments?' + params, {}, ctx.auth);
          if (!current()) return;
          const incoming = (result.items || []).map(item => ({ ...item, unread: item.unread && !this._commentsReadDone?.has(item.id) }));
          const replyFocus = surface === 'all' ? this.commentsCaptureReplyFocus() : null;
          // Only a server-loaded row establishes continuity. A newly posted row
          // can overlap the head even when many unseen pages arrived in between.
          const overlaps = incoming.some(item => feed.loadedIds.includes(item.id));
          if (append) {
            feed.items = ordered([...feed.items, ...incoming]); feed.cursor = result.nextCursor;
            feed.loadedIds = [...new Set([...feed.loadedIds, ...incoming.map(item => item.id)])];
          } else if (feed.loaded && overlaps) {
            // Preserve already loaded older pages while adding a contiguous new head.
            feed.items = ordered([...feed.items, ...incoming]);
            feed.loadedIds = [...new Set([...feed.loadedIds, ...incoming.map(item => item.id)])];
          } else {
            // More than a page may arrive between polls. Reset the cursor as well,
            // so older pages remain reachable without silently skipping the gap.
            feed.items = ordered(incoming); feed.cursor = result.nextCursor;
            feed.loadedIds = incoming.map(item => item.id);
          }
          feed.loaded = true; feed.error = '';
          if (surface === 'all') await this.commentsRestoreReplyDrafts(incoming, ctx);
          await this.commentsRestoreReplyFocus(replyFocus);
          await this.commentsObserveVisible();
        } catch (error) {
          if (current() && !error.stale) feed.error = 'Could not load comments. ' + error.message;
        } finally {
          if (current()) {
            feed.loading = false; feed.loadingMore = false;
            if (feed.moreRequested) {
              feed.moreRequested = false;
              await this.commentsLoadFeed(surface, true);
            }
          }
        }
      },
      commentsCanPostTo(filepath) {
        const identity = this.commentsIdentityFor(filepath);
        return this.commentsEligible && typeof filepath === 'string' && !!filepath && /^[a-f0-9]{64}$/.test(identity.sourceHash || '')
          && (identity.mode !== 'clienttext' || !!this._ctUnitIndex?.has(filepath))
          && !this.versionStorageLoading && !this._importingSource && !this._commentsDestroyed;
      },
      commentsIdentityFor(filepath) {
        return this.sharedCommentIdentityFor?.(filepath) || this.commentsIdentity;
      },
      commentsFileAvailable(filepath) {
        return this.commentsIdentity.mode === 'clienttext' ? !!this._ctUnitIndex?.has(filepath) : !!this.getDescByFilepath?.(filepath);
      },
      commentsFileDisplayLabel(filepath) { return this.commentsIdentityFor(filepath).label || filepath; },
      commentsReplyKey(filepath) {
        const identity = this.commentsIdentityFor(filepath);
        return JSON.stringify(['reply', this.cloudUser?.id, this.commentsLanguage, this.gameVersion, filepath, identity.sourceHash,
          ...(identity.groupId ? [identity.versionId, identity.groupId] : [])]);
      },
      commentsReplyDraft(filepath) { return this.commentsDrafts[this.commentsReplyKey(filepath)] || ''; },
      commentsSetReplyDraft(filepath, value) {
        this.commentsDrafts[this.commentsReplyKey(filepath)] = String(value);
        this.commentsQueueReplyDraft(filepath);
      },
      commentsReplyAllLanguages(filepath) { return this.commentsDraftScopes[this.commentsReplyKey(filepath)] === true; },
      commentsSetReplyAllLanguages(filepath, value) {
        this.commentsDraftScopes[this.commentsReplyKey(filepath)] = value === true;
        this.commentsQueueReplyDraft(filepath);
      },
      commentsQueueReplyDraft(filepath) {
        if (this.commentsIdentity.mode === 'clienttext') this.ctQueueReplyCommentDraft?.(filepath,
          { body: this.commentsReplyDraft(filepath), allLanguages: this.commentsReplyAllLanguages(filepath) });
      },
      async commentsRestoreReplyDrafts(items, ctx) {
        if (this.commentsIdentity.mode !== 'clienttext' || !this.ctLoadReplyCommentDraft) return;
        const loaded = this._commentsReplyLoaded ||= new Set();
        for (const filepath of new Set(items.map(item => item.filepath))) {
          if (!this.commentsFileAvailable(filepath)) continue;
          const key = this.commentsReplyKey(filepath);
          if (loaded.has(key)) continue;
          loaded.add(key);
          try {
            const draft = await this.ctLoadReplyCommentDraft(filepath);
            if (!this.commentsCurrent(ctx) || key !== this.commentsReplyKey(filepath)) return;
            // Loading or polling must never overwrite a reply typed meanwhile.
            if (!Object.hasOwn(this.commentsDrafts, key) && draft) {
              this.commentsDrafts[key] = String(draft.body || '');
              if (!Object.hasOwn(this.commentsDraftScopes, key)) this.commentsDraftScopes[key] = draft.allLanguages === true;
            }
          } catch (error) {
            loaded.delete(key);
            if (this.commentsCurrent(ctx)) this.commentsPostErrors[key] = 'Could not restore the local reply draft. ' + error.message;
          }
        }
      },
      commentsReplyPosting(filepath) { return !!this.commentsPosts[this.commentsReplyKey(filepath)]?.pending; },
      commentsReplyError(filepath) { return this.commentsPostErrors[this.commentsReplyKey(filepath)] || ''; },
      commentsCanReply(filepath) { return this.commentsCanPostTo(filepath); },
      commentsSubmitReply(filepath) {
        return this.commentsIdentity.mode === 'clienttext' ? this.commentsSendClientReply(filepath)
          : this.commentsSendDraft(this.commentsReplyKey(filepath), filepath);
      },
      async commentsSendClientReply(filepath) {
        if (!this.commentsCanReply(filepath) || this.commentsReplyPosting(filepath) || !this.ctPostReplyComment) return false;
        const key = this.commentsReplyKey(filepath), ctx = this.commentsCapture(), body = this.commentsReplyDraft(filepath),
          allLanguages = this.commentsReplyAllLanguages(filepath);
        if (!body.trim() || body.trim().length > 10000) {
          this.commentsPostErrors[key] = body.trim() ? 'Keep your comment within 10,000 characters.' : 'Write a comment first.';
          return false;
        }
        this.commentsPosts[key] = { pending: true };
        try {
          const result = await this.ctPostReplyComment(filepath, { body, allLanguages });
          if (result === false) throw new Error(this.ctCommentPostError || '');
          if (this.commentsDrafts[key] === body && (this.commentsDraftScopes[key] === true) === allLanguages) {
            this.commentsDrafts[key] = ''; delete this.commentsDraftScopes[key];
          }
          delete this.commentsPostErrors[key];
          if (this.commentsCurrent(ctx)) await this.commentsRefreshAll();
          return true;
        } catch (error) {
          this.commentsPostErrors[key] = 'Could not post your reply. Your draft is kept; retry to send it. ' + error.message;
          return false;
        } finally { if (this.commentsPosts[key]) this.commentsPosts[key].pending = false; }
      },
      commentsSubmit() {
        return this.commentsIdentity.mode === 'clienttext' ? this.commentsSendClientDraft()
          : this.commentsSendDraft(this.commentsDraftKey, this.commentsFilepath);
      },
      async commentsSendClientDraft() {
        if (!this.commentsCanPost || this.commentsPosting || !this.ctPostComment) return false;
        const key = this.commentsDraftKey, ctx = this.commentsCapture(), draft = this.commentsFileDraft;
        if (!draft.trim() || draft.trim().length > 10000) {
          this.commentsPostErrors[key] = draft.trim() ? 'Keep your comment within 10,000 characters.' : 'Write a comment first.';
          return false;
        }
        // ClientText owns its durable, exact-text journal and idempotency key.
        // The common UI must not create a second POST command for this draft.
        let result;
        try { result = await this.ctPostComment(); }
        catch (error) {
          this.commentsPostErrors[key] = 'Could not post your comment. Your draft is kept; retry to send it. ' + error.message;
          return false;
        }
        if (result === false) {
          this.commentsPostErrors[key] = 'Could not post your comment. Your draft is kept; retry to send it. ' + (this.ctCommentPostError || this.ctError || '');
          return false;
        }
        delete this.commentsPostErrors[key];
        if (this.commentsCurrent(ctx) && key === this.commentsDraftKey) await this.commentsRefreshFile();
        return true;
      },
      async commentsSendDraft(key, filepath) {
        if (!this.commentsCanPostTo(filepath) || this.commentsPosts[key]?.pending) return false;
        const draft = this.commentsDrafts[key] || '', body = draft.trim(), allLanguages = this.commentsDraftScopes[key] === true;
        if (!body || body.length > 10000) {
          this.commentsPostErrors[key] = body ? 'Keep your comment within 10,000 characters.' : 'Write a comment first.';
          return false;
        }
        const ctx = this.commentsCapture(), sourceHash = this.commentsIdentityFor(filepath).sourceHash;
        const previous = this.commentsPosts[key];
        const task = { body, allLanguages,
          mutationId: previous?.body === body && previous.allLanguages === allLanguages ? previous.mutationId : crypto.randomUUID(), pending: true };
        this.commentsPosts[key] = task;
        try {
          const result = await ctx.client.request('/v1/comments', { method: 'POST', body: { game: ctx.game, filepath, sourceHash, body, allLanguages,
            ...(ctx.groupId ? { groupId:ctx.groupId } : {}),
            ...(ctx.allLanguagesAccess && ctx.language ? { language: ctx.language } : {}), mutationId: task.mutationId } }, ctx.auth);
          if (this.commentsDrafts[key] === draft && (this.commentsDraftScopes[key] === true) === allLanguages) {
            this.commentsDrafts[key] = '';
            delete this.commentsDraftScopes[key];
          }
          delete this.commentsPosts[key]; delete this.commentsPostErrors[key];
          if (!this.commentsCurrent(ctx)) return true;
          const replyFocus = this.commentsCaptureReplyFocus();
          if (result?.item) {
            if (this.commentsFilepath === filepath) this.commentsFileFeed.items = ordered([...this.commentsFileFeed.items, result.item]);
            if (this.commentsAllFeed.items.length || this.commentsAllVisible) this.commentsAllFeed.items = ordered([...this.commentsAllFeed.items, result.item]);
          }
          await this.commentsRestoreReplyFocus(replyFocus);
          await this.commentsObserveVisible();
          return true;
        } catch (error) {
          this.commentsPostErrors[key] = 'Could not post your comment. Your draft is kept; retry to send it. ' + error.message;
          return false;
        } finally {
          if (this.commentsPosts[key]?.mutationId === task.mutationId) this.commentsPosts[key].pending = false;
        }
      },
      async commentsObserveVisible() {
        await this.$nextTick();
        this._commentsObserver?.disconnect();
        this._commentsVisible = new Map();
        if (this._commentsDestroyed || document.hidden || !this.commentsEligible || typeof IntersectionObserver === 'undefined') return;
        const ctx = this.commentsCapture();
        const observed = new Map();
        const observer = new IntersectionObserver(entries => {
          if (!this.commentsCurrent(ctx) || this._commentsObserver !== observer) return;
          for (const entry of entries) {
            const surface = observed.get(entry.target), id = Number(entry.target.dataset.commentId);
            if (entry.isIntersecting && entry.intersectionRatio > 0 && this.commentsSurfaceVisible(surface)) {
              this._commentsVisible.set(entry.target, { id, surface });
            } else this._commentsVisible.delete(entry.target);
          }
          this.commentsScheduleRead();
        }, { threshold: 0 });
        this._commentsObserver = observer;
        for (const surface of ['file', 'all']) {
          if (!this.commentsSurfaceVisible(surface)) continue;
          const name = surface === 'file' ? 'commentsFileList' : 'commentsAllList';
          const root = this.getEditorComponentRef?.(name) || this.$refs[name];
          for (const element of root?.querySelectorAll('[data-comment-id]') || []) {
            if (element.dataset.commentsSurface !== surface) continue;
            observed.set(element, surface); observer.observe(element);
          }
        }
      },
      commentsScheduleRead() {
        if (this._commentsReadTask || this._commentsReadTimer || this._commentsDestroyed) return;
        this._commentsReadTimer = setTimeout(() => {
          this._commentsReadTimer = null;
          this.commentsMarkVisibleRead();
        }, 500);
      },
      async commentsMarkVisibleRead() {
        if (!this.commentsEligible || this._commentsReadTask || document.hidden || this._commentsDestroyed) return;
        const ids = new Set();
        for (const [element, { id, surface }] of this._commentsVisible || []) {
          if (!element.isConnected || !this.commentsSurfaceVisible(surface) || this._commentsReadDone?.has(id)) continue;
          const items = surface === 'file' ? this.commentsFileItems : this.commentsAllItems;
          if (items.some(item => item.id === id && item.unread)) ids.add(id);
          if (ids.size === 100) break;
        }
        if (!ids.size) return;
        const ctx = this.commentsCapture(), task = {};
        this._commentsReadTask = task;
        this._commentsReadRevision = (this._commentsReadRevision || 0) + 1;
        let succeeded = false;
        try {
          const result = await ctx.client.request('/v1/comments/read', { method: 'POST', body: { game: ctx.game, ids: [...ids], ...(ctx.groupId ? { groupId:ctx.groupId } : {}) } }, ctx.auth);
          if (!this.commentsCurrent(ctx)) return;
          this._commentsReadDone ||= new Set();
          for (const id of ids) this._commentsReadDone.add(id);
          for (const feed of [this.commentsFileFeed, this.commentsAllFeed]) {
            for (const item of feed.items) if (ids.has(item.id)) item.unread = false;
          }
          this.commentsApplyUnread(result); this.commentsUnreadFetchError = ''; this.commentsUnreadReadError = ''; succeeded = true;
        } catch (error) {
          if (this.commentsCurrent(ctx) && !error.stale) this.commentsUnreadReadError = 'Could not update unread comments. ' + error.message;
        } finally {
          if (this._commentsReadTask === task) {
            this._commentsReadTask = null;
            if (succeeded) this.commentsScheduleRead();
          }
        }
      },
      commentsDifferentHash(comment) {
        const identity = this.commentsIdentityFor(comment.filepath || this.commentsFilepath);
        return !!identity.sourceHash && !!comment.sourceHash && comment.sourceHash !== identity.sourceHash;
      },
      commentsIsGlobal(comment) { return comment?.allLanguages === true || (comment?.allLanguages !== false && comment?.scopeLanguage == null); },
      commentsTime(comment) {
        const date = new Date(comment?.createdAt || comment);
        return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
      },
      commentsBadge(count) { return count > 99 ? '99+' : String(count || 0); },
    },
  };
  window.CommentsUI = { mixin };
})();
