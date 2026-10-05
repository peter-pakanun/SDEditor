/* File discussions include the account's language and global posts across source versions. */
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
      commentsEligible() {
        return !this.testMode && this.cloudSignedIn && !!this.cloudUser?.id && !!this.cloudUser?.language
          && ['poe1', 'poe2'].includes(this.gameVersion) && !!this._cloud;
      },
      commentsContextKey() {
        return JSON.stringify([this.testMode, this.cloudSignedIn, this.cloudUser?.id, this.cloudUser?.language,
          this.cloudUser?.assignmentVersion, this.gameVersion]);
      },
      commentsUnavailableReason() {
        if (this.testMode) return 'Shared comments are unavailable in test mode.';
        if (!this.cloudSignedIn) return 'Sign in to read and share comments with your translation team.';
        if (!this.cloudUser?.language) return 'An admin must assign your team language before comments are available.';
        if (!['poe1', 'poe2'].includes(this.gameVersion)) return 'Choose a game to view its comments.';
        return '';
      },
      commentsFilepath() { return this.editorCurrentEditingDesc?.filepath || ''; },
      commentsDraftKey() {
        return JSON.stringify([this.cloudUser?.id, this.cloudUser?.language, this.gameVersion, this.commentsFilepath, this.sourceIdentity]);
      },
      commentsFileDraft: {
        get() { return this.commentsDrafts[this.commentsDraftKey] || ''; },
        set(value) { this.commentsDrafts[this.commentsDraftKey] = String(value); this.commentsPostErrors[this.commentsDraftKey] = ''; },
      },
      commentsFileAllLanguages: {
        get() { return this.commentsDraftScopes[this.commentsDraftKey] === true; },
        set(value) { this.commentsDraftScopes[this.commentsDraftKey] = value === true; },
      },
      commentsCanPost() { return this.commentsCanPostTo(this.commentsFilepath); },
      commentsPosting() { return !!this.commentsPosts[this.commentsDraftKey]?.pending; },
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
          if (!groups.has(item.filepath)) groups.set(item.filepath, { filepath: item.filepath, items: [] });
          groups.get(item.filepath).items.push(item);
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
      const dialog = this.$refs.diagnosticScanDialog;
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
          game: this.gameVersion, client: this._cloud, auth: this._cloud?.context() };
      },
      commentsCurrent(ctx) {
        return !this._commentsDestroyed && this.commentsEligible && ctx.key === this.commentsContextKey
          && ctx.generation === (this._commentsGeneration || 0) && ctx.client === this._cloud;
      },
      commentsResetContext() {
        this._commentsGeneration = (this._commentsGeneration || 0) + 1;
        this._commentsUnreadTask = null; this._commentsReadTask = null; this._commentsPollRun = null;
        this._commentsReadDone = new Set(); this._commentsVisible = new Map();
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
        if (document.hidden || this.commentsUiBlocked || this.$refs.diagnosticScanDialog?.open || !this.commentsEligible) return false;
        return surface === 'file' ? !!this.editorVisible && this.sideTab === 'comments' && !!this.commentsFilepath
          : this.commentsAllVisible && !this.editorVisible;
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
        return { input, root, context: this.commentsCapture(), sourceHash: this.sourceIdentity,
          top: input.getBoundingClientRect().top, start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection };
      },
      async commentsRestoreReplyFocus(saved) {
        if (!saved) return;
        await this.$nextTick();
        const { input, root } = saved;
        if (!this.commentsCurrent(saved.context) || saved.sourceHash !== this.sourceIdentity || !this.commentsSurfaceVisible('all')
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
          const result = await ctx.client.request('/v1/comments/unread?game=' + encodeURIComponent(ctx.game), {}, ctx.auth);
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
        return this.commentsEligible && typeof filepath === 'string' && !!filepath && /^[a-f0-9]{64}$/.test(this.sourceIdentity || '')
          && !this.versionStorageLoading && !this._importingSource && !this._commentsDestroyed;
      },
      commentsReplyKey(filepath) {
        return JSON.stringify(['reply', this.cloudUser?.id, this.cloudUser?.language, this.gameVersion, filepath, this.sourceIdentity]);
      },
      commentsReplyDraft(filepath) { return this.commentsDrafts[this.commentsReplyKey(filepath)] || ''; },
      commentsSetReplyDraft(filepath, value) { this.commentsDrafts[this.commentsReplyKey(filepath)] = String(value); },
      commentsReplyAllLanguages(filepath) { return this.commentsDraftScopes[this.commentsReplyKey(filepath)] === true; },
      commentsSetReplyAllLanguages(filepath, value) { this.commentsDraftScopes[this.commentsReplyKey(filepath)] = value === true; },
      commentsReplyPosting(filepath) { return !!this.commentsPosts[this.commentsReplyKey(filepath)]?.pending; },
      commentsReplyError(filepath) { return this.commentsPostErrors[this.commentsReplyKey(filepath)] || ''; },
      commentsCanReply(filepath) { return this.commentsCanPostTo(filepath); },
      commentsSubmitReply(filepath) { return this.commentsSendDraft(this.commentsReplyKey(filepath), filepath); },
      commentsSubmit() { return this.commentsSendDraft(this.commentsDraftKey, this.commentsFilepath); },
      async commentsSendDraft(key, filepath) {
        if (!this.commentsCanPostTo(filepath) || this.commentsPosts[key]?.pending) return false;
        const draft = this.commentsDrafts[key] || '', body = draft.trim(), allLanguages = this.commentsDraftScopes[key] === true;
        if (!body || body.length > 10000) {
          this.commentsPostErrors[key] = body ? 'Keep your comment within 10,000 characters.' : 'Write a comment first.';
          return false;
        }
        const ctx = this.commentsCapture(), sourceHash = this.sourceIdentity;
        const previous = this.commentsPosts[key];
        const task = { body, allLanguages,
          mutationId: previous?.body === body && previous.allLanguages === allLanguages ? previous.mutationId : crypto.randomUUID(), pending: true };
        this.commentsPosts[key] = task;
        try {
          const result = await ctx.client.request('/v1/comments', { method: 'POST', body: { game: ctx.game, filepath, sourceHash, body, allLanguages, mutationId: task.mutationId } }, ctx.auth);
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
          const root = this.$refs[surface === 'file' ? 'commentsFileList' : 'commentsAllList'];
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
          const result = await ctx.client.request('/v1/comments/read', { method: 'POST', body: { game: ctx.game, ids: [...ids] } }, ctx.auth);
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
      commentsDifferentHash(comment) { return !!this.sourceIdentity && !!comment.sourceHash && comment.sourceHash !== this.sourceIdentity; },
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
