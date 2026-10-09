/* Vue Options API integration; cloudSync.js owns storage and network behavior. */
(() => {
  const API = 'https://sdeditor-api.poemaid.com';
  const clone = value => JSON.parse(JSON.stringify(value));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const initializationTask = (app, label, callback, session) => typeof app.runWorkspaceInitializationTask === 'function'
    ? app.runWorkspaceInitializationTask(label, callback, session) : callback();
  function sameDictionary(left, right) {
    if (same(left, right)) return true;
    // Sync and the editor can serialize identical entries in different field
    // order, with omitted empty fields or an explicit All scope. Replacing
    // those rows triggers the Dictionary watcher and discards completed scans.
    const comparable = entries => window.DictionarySync.normalizeEntries(entries).map(entry => {
      if (entry.gameScope === 'all') delete entry.gameScope;
      return entry;
    });
    return same(comparable(left), comparable(right));
  }
  // Local overrides are deliberately restricted to a loopback editor origin.
  function apiBase() {
    if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
      const value = new URLSearchParams(location.search).get('cloudApi');
      if (value) {
        const url = new URL(value);
        if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && /^https?:$/.test(url.protocol)) return url.origin;
      }
    }
    return API;
  }
  const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const mixin = {
    data() { return {
      cloudUser: null, cloudProfileId: 'guest', cloudSignedIn: false, cloudStatus: '', cloudError: false, cloudWarning: false,
      cloudBusy: false, cloudLanguageSwitching: false, cloudStorageError: '', cloudConflicts: [], cloudRevision: 0,
      cloudResolverVisible: false, cloudConflictIndex: 0, cloudDefinitionsChoice: '', cloudNoteChoice: '',
      cloudAdminVisible: false, cloudAdminUsers: [], cloudNeedsDictionaryLanguage: false, cloudRecoveryCount: 0,
      cloudLoginUrl: '',
      settingsImportDraft: null, settingsImportConfirm: '',
    }; },
    computed: {
      cloudCanAccessAllLanguages() {
        return this.cloudSignedIn && window.CloudSync.canAccessAllLanguages(this.cloudUser);
      },
      cloudSyncIssue() {
        if (this.cloudError || this.cloudWarning) return this.cloudStatus;
        if (this.cloudSignedIn && !this.cloudCanAccessAllLanguages && !this.cloudUser?.language) return 'Not configured — awaiting admin language assignment';
        if (this.cloudConflicts.length) return 'Saved locally · dictionary conflicts need your choice';
        if (this.cloudSignedIn && !this.cloudCanAccessAllLanguages && this.cloudUser?.language && this.lang !== this.cloudUser.language) return 'Selected dictionary language is local only';
        return '';
      },
      cloudConflict() { return this.cloudConflicts[this.cloudConflictIndex] || null; },
      cloudResult() {
        if (!this.cloudConflict) return null;
        return window.DictionarySync.resolve(this.cloudConflict, { definitions: this.cloudDefinitionsChoice || 'local', note: this.cloudNoteChoice || 'local' });
      },
      cloudResolutionReady() {
        const c = this.cloudConflict;
        return !!c && (!c.definitionsConflict || !!this.cloudDefinitionsChoice) && (!this.cloudResult || !c.noteConflict || !!this.cloudNoteChoice);
      },
    },
    beforeUnmount() {
      this._cloud?.destroy();
      this.clearBrowserWork?.('cloud');
      for (const [target, name, handler] of (this._cloudListeners || [])) target.removeEventListener(name, handler);
      clearInterval(this._cloudPoll);
      this._cloudChannel?.close();
    },
    methods: {
      async confirmSettingsImport() {
        if (this.settingsImportConfirm !== 'YES' || !this.settingsImportDraft) return;
        try {
          if (await this.flushEditorDraft?.() === false) return;
          if (this._cloud) { if (!await this.cloudImport(this.settingsImportDraft)) return; }
          else this.importSettings(this.settingsImportDraft);
          this.settingsImportDraft = null;
          this.settingsImportConfirm = '';
          this.$refs.importSettingsFileForm.reset();
        } catch (error) { this.cloudStorageError = error.message; }
      },
      cancelSettingsImport() { this.settingsImportDraft = null; this.settingsImportConfirm = ''; this.$refs.importSettingsFileForm.reset(); },
      cloudPayload() {
        return this.toPlainForStorage({ ...window.CloudSync.preferences(this), dictionary: this.dictionary, editorClipboard: this.editorClipboard });
      },
      async cloudApply(snapshot) {
        if (!snapshot) return;
        const settings = window.CloudSync.completeSettings(snapshot.settings);
        const oldUser = this.cloudUser || {}, nextUser = snapshot.user || {};
        const nextProfile = snapshot.profileId || nextUser.id || 'guest';
        const scopeChanged = this.cloudSignedIn !== snapshot.signedIn || this.lang !== settings.lang
          || (this.cloudProfileId || oldUser.id || 'guest') !== nextProfile
          || ['id', 'language', 'assignmentVersion', 'role', 'isAdmin'].some(key => oldUser[key] !== nextUser[key]);
        if (scopeChanged && (this.editorSessionActive ?? this.editorVisible)) {
          // Capture the outgoing draft before applying new account/access state.
          // Session detachment captures its immutable scope synchronously; an
          // unsolicited account update must not wait for an old storage write.
          const flushing = this.detachEditorSessionForScopeChange?.() || this.flushEditorDraft?.();
          Promise.resolve(flushing).catch(error => { this.cloudStorageError = 'Could not preserve the previous editor draft: ' + error.message; });
        }
        if (!same(this.cloudUser, snapshot.user)) this.cloudUser = snapshot.user;
        this.cloudProfileId = nextProfile;
        this.cloudSignedIn = snapshot.signedIn;
        const prior = this.cloudConflict;
        const priorRevision = this.cloudRevision;
        if (Object.hasOwn(snapshot, 'conflicts') && !same(this.cloudConflicts, snapshot.conflicts)) this.cloudConflicts = snapshot.conflicts;
        this.cloudRevision = snapshot.revision;
        this.cloudNeedsDictionaryLanguage = snapshot.needsDictionaryLanguage;
        this.cloudRecoveryCount = snapshot.recoveryCount;
        if (!this.cloudUser?.isAdmin) this.cloudAdminVisible = false;
        if (this.cloudConflictIndex >= this.cloudConflicts.length) this.cloudConflictIndex = 0;
        if (!same(prior, this.cloudConflict) || priorRevision !== snapshot.revision) {
          this.cloudDefinitionsChoice = ''; this.cloudNoteChoice = '';
        }
        const rawDictionary = typeof Vue !== 'undefined' && Vue.toRaw ? Vue.toRaw(this.dictionary) : this.dictionary;
        const dictionaryChanged = Object.hasOwn(snapshot, 'dictionary') && !sameDictionary(rawDictionary, snapshot.dictionary);
        if (!dictionaryChanged && same(window.CloudSync.preferences(this), settings) && this.editorClipboard === snapshot.editorClipboard) {
          if (scopeChanged) await this.loadEditorDrafts?.();
          return;
        }
        const payload = { ...settings, dictionary: dictionaryChanged ? snapshot.dictionary : this.dictionary, editorClipboard: snapshot.editorClipboard };
        if (same(this.editorRegexes, payload.editorRegexes)) payload.editorRegexes = this.editorRegexes;
        this._cloudApplying = true;
        try {
          this.importSettings(payload);
          if (!this._cloudInitializing && this.needsInitialSettings && this.lang) this.showSetting = true;
          this.needsInitialSettings = !this.lang;
          await this.$nextTick();
          if (scopeChanged) await this.loadEditorDrafts?.();
        } finally { this._cloudApplying = false; }
      },
      async initializeCloud(legacy) {
        if (this.testMode) return;
        const initializationSession = { run: this._workspaceInitializationRun };
        this._cloudInitializing = true;
        const loginFragment = new URLSearchParams(location.hash.slice(1));
        if (loginFragment.has('cloudCode') || loginFragment.has('cloudError')) {
          const saved = JSON.parse(sessionStorage.getItem('sdeditor-login') || 'null');
          if (saved && saved.state === loginFragment.get('cloudState') && Date.now() - saved.at < 10 * 60 * 1000) {
            const original = new URL(saved.returnUrl || location.href);
            if (original.origin === location.origin) history.replaceState(null, '', original.pathname + original.search + location.hash);
          }
        }
        this._cloudApplying = true;
        this._cloud = new window.CloudSync.Client({ store: window.OfflineStore, merge: window.DictionarySync,
          fetch: window.fetch.bind(window), apiBase: apiBase(), locks: navigator.locks,
          WebSocket: window.WebSocket,
          onWork: work => this.setBrowserWork?.('cloud', work),
          yieldWork: () => this.yieldEditorPaint?.() || new Promise(resolve => setTimeout(resolve, 0)),
          beforeSharedApply: () => this.flushScheduledSettingsSave?.(),
          onChange: snapshot => {
            const pending = !!this.pendingSettingsSaves;
            this._cloudApplyPending = (async () => {
              if (pending && await this.flushScheduledSettingsSave() === false) return;
              await this.cloudApply(pending ? this._cloud.snapshot() : snapshot);
            })().catch(error => { this.cloudStorageError = error.message; });
          },
          onStatus: status => { this.cloudStatus = status.message; this.cloudError = status.error; this.cloudWarning = !!status.warning; },
        });
        try {
          await initializationTask(this, 'Restoring local profile, settings and Dictionary', () =>
            this._cloud.initialize(legacy || { ...this.cloudPayload(), dictionary: [] }), initializationSession);
          await initializationTask(this, 'Applying local settings and restoring editor drafts', () =>
            this._cloudApplyPending || this.cloudApply(this._cloud.snapshot()), initializationSession);
          await this.$nextTick();
          // Show the restored local profile before any authentication/network request.
          await this.finishStartup?.();
        } finally { this._cloudApplying = false; this._cloudInitializing = false; }
        const listen = (target, name, handler) => { target.addEventListener(name, handler); (this._cloudListeners ||= []).push([target, name, handler]); };
        listen(window, 'online', () => { this._cloud.refreshSession(true); });
        listen(window, 'focus', () => { this._cloud.refreshSession(true); });
        listen(document, 'visibilitychange', () => { if (!document.hidden) this._cloud.refreshSession(true); });
        const activity = () => { if (!document.hidden) this._cloud.refreshSession(); };
        listen(document, 'keydown', activity); listen(document, 'pointerdown', activity);
        this._cloudPoll = setInterval(() => { if (!document.hidden && !this.showMultiInstanceGate && !this._cloud.socketReady) this._cloud.sync(); }, 30000);
        if (typeof BroadcastChannel !== 'undefined') {
          this._cloudChannel = new BroadcastChannel('sdeditor-cloud-account');
          this._cloudChannel.onmessage = () => this.cloudReloadAccount();
        }
        const fragment = new URLSearchParams(location.hash.slice(1));
        if (fragment.has('cloudCode')) {
          history.replaceState(null, '', location.pathname + location.search);
          await initializationTask(this, 'Completing Google sign-in', () =>
            this.cloudFinishLogin(fragment.get('cloudCode'), fragment.get('cloudState')), initializationSession);
        } else if (fragment.has('cloudError')) {
          history.replaceState(null, '', location.pathname + location.search);
          this.cloudStatus = 'Google sign-in could not be completed. Please try again.';
          this.cloudError = true;
        } else {
          // Authentication failure remains an actionable cloud issue while the
          // restored local workspace is usable. Routine refreshes stay silent.
          const task = this.beginWorkspaceInitializationTask?.('Checking cloud session and account access', initializationSession);
          try {
            await this._cloud.refreshSession(true);
            this.finishWorkspaceInitializationTask?.(task, { error: this.cloudError ? this.cloudStatus : undefined });
          } catch (error) {
            this.finishWorkspaceInitializationTask?.(task, { error });
            throw error;
          }
        }
      },
      async cloudReloadAccount() {
        if (await this.flushScheduledSettingsSave?.() === false) return false;
        this._cloud.closeSocket();
        this._cloud.epoch++;
        this._cloud.state = await window.OfflineStore.getHybridState();
        await this.cloudApply(this._cloud.snapshot());
        this._cloud.schedule(0);
        return true;
      },
      async cloudPersist(payload) {
        if (this._cloudApplying) return true;
        try {
          await this._cloud.saveLocal(payload, payload.lang, { captured: true });
          this.cloudStorageError = '';
          return true;
        } catch (error) {
          this.cloudStorageError = 'Could not save in this browser. Keep this tab open and retry: ' + error.message;
          return false;
        }
      },
      async cloudSelectLanguage(language, previous) {
        if (!this._cloud || this._cloudApplying) return true;
        if (await this.flushEditorDraft?.() === false || await this.flushScheduledSettingsSave?.() === false) {
          this._cloudApplying = true;
          try { this.lang = previous; await this.$nextTick(); }
          finally { this._cloudApplying = false; }
          return false;
        }
        this._cloudApplying = true;
        this.cloudLanguageSwitching = true;
        try {
          await this._cloud.selectLanguage(language, this.cloudPayload(), previous);
          await this.cloudApply(this._cloud.snapshot());
          if (this.cloudStorageError.startsWith('Could not switch language:')) this.cloudStorageError = '';
          return true;
        } catch (error) {
          await this.cloudApply(this._cloud.snapshot());
          this.cloudStorageError = 'Could not switch language: ' + error.message;
          return false;
        }
        finally { await this.$nextTick(); this._cloudApplying = false; this.cloudLanguageSwitching = false; }
      },
      async cloudImport(payload) {
        if (await this.flushEditorDraft?.() === false) return false;
        if (await this.flushScheduledSettingsSave?.() === false) return false;
        this._cloudApplying = true;
        try {
          await this._cloud.importLocal(payload);
          await this.cloudApply(this._cloud.snapshot());
          this.cloudStorageError = '';
          return true;
        } catch (error) { this.cloudStorageError = 'Could not import settings: ' + error.message; return false; }
        finally { await this.$nextTick(); this._cloudApplying = false; }
      },
      async cloudLogin() {
        if (this.testMode || !this._cloud) return;
        // Open synchronously during the click so popup blockers can be handled.
        const popup = window.open('about:blank', 'sdeditor-google-login', 'width=540,height=720');
        this.cloudBusy = true;
        try {
          if (await this.flushEditorDraft?.() === false) throw new Error('Save the local editor draft before signing in.');
          if (!await this.saveSettings()) throw new Error('Save local settings before signing in.');
          const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
          const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
          const result = await this._cloud.request('/auth/google/start', { method: 'POST', body: { challenge, returnOrigin: location.origin, mode: popup ? 'popup' : 'redirect' } });
          sessionStorage.setItem('sdeditor-login', JSON.stringify({ verifier, state: result.state, at: Date.now(), returnUrl: location.href }));
          this.cloudLoginUrl = result.authorizationUrl;
          this.cloudStatus = 'Complete Google sign-in in the opened window, or continue in this tab.';
          this.cloudError = false; this.cloudWarning = false;
          if (!popup) { location.assign(result.authorizationUrl); return; }
          const handler = async event => {
            if (event.origin !== new URL(apiBase()).origin || event.source !== popup || event.data?.type !== 'sdeditor:auth') return;
            if (event.data.state !== result.state) return;
            window.removeEventListener('message', handler);
            clearInterval(watchClosed); clearTimeout(expiry);
            try {
              if (event.data.error) throw new Error(event.data.error.message || 'Google sign-in could not be completed.');
              await this.cloudFinishLogin(event.data.code, event.data.state); popup.close();
            }
            catch (error) { this.cloudStatus = error.message; this.cloudError = true; }
            finally { this.cloudBusy = false; this.cloudLoginUrl = ''; }
          };
          window.addEventListener('message', handler);
          const cleanup = () => { window.removeEventListener('message', handler); clearInterval(watchClosed); clearTimeout(expiry); this.cloudBusy = false; this.cloudLoginUrl = ''; };
          const watchClosed = setInterval(() => { if (popup.closed) cleanup(); }, 1000);
          const expiry = setTimeout(cleanup, 10 * 60 * 1000);
          popup.location = result.authorizationUrl;
        } catch (error) { popup?.close(); this.cloudStatus = error.message; this.cloudError = true; this.cloudBusy = false; this.cloudLoginUrl = ''; }
      },
      async cloudFinishLogin(code, state) {
        const saved = JSON.parse(sessionStorage.getItem('sdeditor-login') || 'null');
        if (!saved || saved.state !== state || Date.now() - saved.at > 10 * 60 * 1000) throw new Error('Login expired. Please sign in again.');
        const result = await this._cloud.request('/auth/exchange', { method: 'POST', body: { code, verifier: saved.verifier } });
        if (await this.flushEditorDraft?.() === false) throw new Error('Save the local editor draft before switching accounts.');
        if (!await this.saveSettings()) throw new Error('Save local settings before switching accounts.');
        sessionStorage.removeItem('sdeditor-login');
        await this._cloud.acceptLogin(result);
        await this.cloudApply(this._cloud.snapshot());
        this._cloudChannel?.postMessage('account-changed');
      },
      async cloudLogout() {
        this.cloudBusy = true;
        try {
          if (await this.flushEditorDraft?.() === false) return;
          if (this.waitForPendingSaves && !await this.waitForPendingSaves()) return;
          if (!await this.saveSettings()) return;
          await this._cloud.logout(); this.cloudResolverVisible = false;
          this._cloudChannel?.postMessage('account-changed');
        } catch (error) { this.cloudStatus = 'Could not sign out: ' + error.message; this.cloudError = true; }
        finally { this.cloudBusy = false; }
      },
      async cloudRetry() {
        if (!await this.saveSettings()) return;
        await this._cloud.refreshSession(true);
        await this._cloud.sync();
      },
      cloudOpenResolver() {
        this.cloudConflictIndex = 0; this.cloudDefinitionsChoice = ''; this.cloudNoteChoice = ''; this.cloudResolverVisible = true;
      },
      cloudNextConflict(delta) {
        this.cloudConflictIndex = Math.max(0, Math.min(this.cloudConflicts.length - 1, this.cloudConflictIndex + delta));
        this.cloudDefinitionsChoice = ''; this.cloudNoteChoice = '';
      },
      cloudDefinitionText(entry) {
        if (!entry) return 'Entry deleted';
        const scope = entry.gameScope === 'poe1' ? 'PoE1' : entry.gameScope === 'poe2' ? 'PoE2' : 'All';
        return 'Game: ' + scope + '\n' + [[entry.find, entry.replace], ...(entry.alts || []).map(a => [a.find, a.replace])].map(([find, replace]) => find + ' → ' + replace).join('\n');
      },
      async cloudSaveResolution() {
        if (!this.cloudResolutionReady || this.cloudBusy) return;
        this.cloudBusy = true;
        try {
          await this._cloud.resolveConflict(this.cloudConflict.id, { definitions: this.cloudDefinitionsChoice || 'local', note: this.cloudNoteChoice || 'local' }, this.cloudRevision);
          this.cloudDefinitionsChoice = ''; this.cloudNoteChoice = '';
          if (!this.cloudConflicts.length) this.cloudResolverVisible = false;
        } catch (error) { this.cloudStatus = error.message; this.cloudError = true; }
        finally { this.cloudBusy = false; }
      },
      async cloudLoadUsers() {
        this.cloudBusy = true;
        try { this.cloudAdminUsers = await this._cloud.listUsers(); this.cloudAdminVisible = true; }
        catch (error) { this.cloudStatus = error.message; this.cloudError = true; }
        finally { this.cloudBusy = false; }
      },
      async cloudAssign(user, event) {
        this.cloudBusy = true;
        try { await this._cloud.assignLanguage(user.id, event.target.value); this.cloudAdminUsers = await this._cloud.listUsers(); }
        catch (error) { event.target.value = user.language || ''; this.cloudStatus = error.message; this.cloudError = true; }
        finally { this.cloudBusy = false; }
      },
      async cloudAssignRole(user, event) {
        this.cloudBusy = true;
        try { await this._cloud.assignRole(user.id, event.target.value); this.cloudAdminUsers = await this._cloud.listUsers(); }
        catch (error) { event.target.value = user.role || 'translator'; this.cloudStatus = error.message; this.cloudError = true; }
        finally { this.cloudBusy = false; }
      },
      cloudDownloadRecovery() {
        saveAs(new Blob([JSON.stringify(this._cloud.recoveryExport(), null, 2)], { type: 'application/json' }), 'sdeditor_local_recovery.json');
      },
    },
  };
  window.CloudUI = { mixin };
})();
