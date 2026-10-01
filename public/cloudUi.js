/* Vue Options API integration; cloudSync.js owns storage and network behavior. */
(() => {
  const API = 'https://sdeditor-api.poemaid.com';
  const clone = value => JSON.parse(JSON.stringify(value));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
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
      cloudUser: null, cloudSignedIn: false, cloudStatus: '', cloudError: false, cloudWarning: false,
      cloudBusy: false, cloudStorageError: '', cloudConflicts: [], cloudRevision: 0,
      cloudResolverVisible: false, cloudConflictIndex: 0, cloudDefinitionsChoice: '', cloudNoteChoice: '',
      cloudAdminVisible: false, cloudAdminUsers: [], cloudNeedsDictionaryLanguage: false, cloudRecoveryCount: 0,
      cloudLoginUrl: '',
      cloudAuthorizationGeneration: 0,
      cloudLanguageBusy: false,
      settingsImportDraft: null, settingsImportConfirm: '',
    }; },
    computed: {
      cloudSyncIssue() {
        if (this.cloudError || this.cloudWarning) return this.cloudStatus;
        if (this.cloudSignedIn && !this.cloudUser?.language) return 'Not configured — awaiting admin language assignment';
        if (this.cloudConflicts.length) return 'Saved locally · dictionary conflicts need your choice';
        if (this.cloudSignedIn && this.cloudUser?.language && this.lang !== this.cloudUser.language) return 'Selected dictionary language is local only';
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
      for (const [target, name, handler] of (this._cloudListeners || [])) target.removeEventListener(name, handler);
      clearInterval(this._cloudPoll);
      this._cloudChannel?.close();
    },
    methods: {
      async confirmSettingsImport() {
        if (this.settingsImportConfirm !== 'YES' || !this.settingsImportDraft) return;
        try {
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
        // Worker events and command replies may arrive together. Apply them in
        // order so watcher suppression and authored baselines stay consistent.
        const run = () => this.applyCloudSnapshot(snapshot);
        const pending = (this._cloudApplyQueue || Promise.resolve()).then(run);
        this._cloudApplyQueue = pending.catch(() => {});
        return pending;
      },
      async applyCloudSnapshot(snapshot) {
        if (!snapshot) return;
        const oldProfile = this._cloudProfile;
        const switchedProfile = oldProfile != null && oldProfile !== snapshot.profileId;
        if (switchedProfile) {
          if (this._cloudAuthoredBase && !same(this.cloudPayload(), this._cloudAuthoredBase)) this.rememberInstanceSettings?.(this.cloudPayload(), oldProfile);
          if (this.editorVisible && this.editorHaveChanges()) {
            this.rememberInstanceDraft?.('Signed-in profile changed');
            this.instanceSourceChanged = true;
            this.collaborationNotice = 'The signed-in profile changed in another tab. Your draft is preserved under the previous profile; reload the workspace before continuing.';
          }
        }
        this._cloudProfile = snapshot.profileId;
        this.cloudAuthorizationGeneration = this._cloud?.context()?.generation ?? this._cloud?.context()?.epoch ?? 0;
        this.cloudUser = snapshot.user;
        this.cloudSignedIn = snapshot.signedIn;
        const prior = this.cloudConflict;
        const priorRevision = this.cloudRevision;
        this.cloudConflicts = snapshot.conflicts;
        this.cloudRevision = snapshot.revision;
        this.cloudNeedsDictionaryLanguage = snapshot.needsDictionaryLanguage;
        this.cloudRecoveryCount = snapshot.recoveryCount;
        if (!this.cloudUser?.isAdmin) this.cloudAdminVisible = false;
        if (this.cloudConflictIndex >= this.cloudConflicts.length) this.cloudConflictIndex = 0;
        if (!same(prior, this.cloudConflict) || priorRevision !== snapshot.revision) {
          this.cloudDefinitionsChoice = ''; this.cloudNoteChoice = '';
        }
        const payload = { ...window.CloudSync.completeSettings(snapshot.settings), dictionary: snapshot.dictionary, editorClipboard: snapshot.editorClipboard };
        const previous = this._cloudAuthoredBase;
        const current = this.cloudPayload();
        const next = clone(payload), nextBase = clone(payload);
        if (previous && !switchedProfile) {
          for (const key of Object.keys(next)) {
            if (!same(current[key], previous[key])) {
              next[key] = clone(current[key]);
              nextBase[key] = clone(previous[key]);
            }
          }
        }
        // An active tab's language belongs to that tab. Cloud defaults apply at
        // startup; selecting a different language explicitly uses selectLanguage.
        if (this._instances && !this._cloudInitializing && !this._cloudImporting && this.lang) next.lang = this.lang;
        this._cloudAuthoredBase = nextBase;
        if (same(current, next)) return;
        this._cloudApplying = true;
        try {
          this.importSettings(next);
          if (!this._cloudInitializing && this.needsInitialSettings && this.lang) this.showSetting = true;
          this.needsInitialSettings = !this.lang;
          await this.$nextTick();
        } finally { this._cloudApplying = false; }
      },
      async initializeCloud(legacy) {
        if (this.testMode) return;
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
        const callbacks = {
          onChange: snapshot => { this.cloudApply(snapshot).catch(error => { this.cloudStorageError = error.message; }); },
          onStatus: status => { this.cloudStatus = status.message; this.cloudError = status.error; this.cloudWarning = !!status.warning; },
        };
        this._cloud = this._instances?.cloud || new window.CloudSync.Client({ store: window.OfflineStore, merge: window.DictionarySync,
          fetch: window.fetch.bind(window), apiBase: apiBase(), locks: navigator.locks,
          ...callbacks,
        });
        this._cloud.configureCallbacks?.(callbacks);
        try {
          await this._cloud.initialize(legacy || { ...this.cloudPayload(), dictionary: [] });
          await this.cloudApply(this._cloud.snapshot());
          await this.$nextTick();
        } finally { this._cloudApplying = false; this._cloudInitializing = false; }
        const listen = (target, name, handler) => { target.addEventListener(name, handler); (this._cloudListeners ||= []).push([target, name, handler]); };
        listen(window, 'online', () => { this._cloud.refreshSession(true); });
        listen(window, 'focus', () => { this._cloud.refreshSession(true); });
        listen(document, 'visibilitychange', () => { if (!document.hidden) this._cloud.refreshSession(true); });
        const activity = () => { if (!document.hidden) this._cloud.refreshSession(); };
        listen(document, 'keydown', activity); listen(document, 'pointerdown', activity);
        if (!this._instances) this._cloudPoll = setInterval(() => { if (!document.hidden && !this.showMultiInstanceGate) this._cloud.sync(); }, 30000);
        if (!this._instances && typeof BroadcastChannel !== 'undefined') {
          this._cloudChannel = new BroadcastChannel('sdeditor-cloud-account');
          this._cloudChannel.onmessage = async () => {
            this._cloud.epoch++;
            this._cloud.state = await window.OfflineStore.getHybridState();
            await this.cloudApply(this._cloud.snapshot());
          };
        }
        const fragment = new URLSearchParams(location.hash.slice(1));
        if (fragment.has('cloudCode')) {
          history.replaceState(null, '', location.pathname + location.search);
          await this.cloudFinishLogin(fragment.get('cloudCode'), fragment.get('cloudState'));
        } else if (fragment.has('cloudError')) {
          history.replaceState(null, '', location.pathname + location.search);
          this.cloudStatus = 'Google sign-in could not be completed. Please try again.';
          this.cloudError = true;
        } else await this._cloud.refreshSession(true);
      },
      async cloudPersist(payload) {
        if (this._cloudApplying) return true;
        try {
          await this._cloud.saveLocal(payload, { language: payload.lang, base: clone(this._cloudAuthoredBase || payload) });
          // Mark only this submitted draft as accepted. Later typing remains a
          // change relative to this base, even if a notification arrived first.
          this._cloudAuthoredBase = clone(payload);
          await this.cloudApply(this._cloud.snapshot());
          this.cloudStorageError = '';
          return true;
        } catch (error) {
          this.cloudStorageError = 'Could not save in this browser. Keep this tab open and retry: ' + error.message;
          return false;
        }
      },
      cloudSelectLanguage(language, previous) {
        if (!this._cloud || this._cloudApplying) return;
        this._cloudApplying = true;
        this.cloudLanguageBusy = true;
        return this._cloudLanguageTask = (async () => {
          try {
            await this._cloud.selectLanguage(language, this.cloudPayload(), previous, { base: clone(this._cloudAuthoredBase || this.cloudPayload()) });
            this._cloudAuthoredBase = null;
            await this.cloudApply(this._cloud.snapshot());
            return true;
          } catch (error) { this.lang = previous; this.cloudStorageError = 'Could not switch language: ' + error.message; return false; }
          finally { await this.$nextTick(); this._cloudApplying = false; this.cloudLanguageBusy = false; }
        })();
      },
      async cloudImport(payload) {
        this._cloudApplying = true;
        this._cloudImporting = true;
        try {
          await this._cloud.importLocal(payload);
          this._cloudAuthoredBase = null;
          await this.cloudApply(this._cloud.snapshot());
          this.cloudStorageError = '';
          return true;
        } catch (error) { this.cloudStorageError = 'Could not import settings: ' + error.message; return false; }
        finally { await this.$nextTick(); this._cloudApplying = false; this._cloudImporting = false; }
      },
      async cloudLogin() {
        if (this.testMode || !this._cloud) return;
        // Open synchronously during the click so popup blockers can be handled.
        const popup = window.open('about:blank', 'sdeditor-google-login', 'width=540,height=720');
        this.cloudBusy = true;
        try {
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
        if (this._cloud.finishLogin) await this._cloud.finishLogin(code, saved.verifier);
        else {
          const result = await this._cloud.request('/auth/exchange', { method: 'POST', body: { code, verifier: saved.verifier } });
          await this._cloud.acceptLogin(result);
        }
        sessionStorage.removeItem('sdeditor-login');
        await this.cloudApply(this._cloud.snapshot());
        this._cloudChannel?.postMessage('account-changed');
      },
      async cloudLogout() {
        this.cloudBusy = true;
        try {
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
        return [[entry.find, entry.replace], ...(entry.alts || []).map(a => [a.find, a.replace])].map(([find, replace]) => find + ' → ' + replace).join('\n');
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
      async cloudDownloadRecovery() {
        saveAs(new Blob([JSON.stringify(await this._cloud.recoveryExport(), null, 2)], { type: 'application/json' }), 'sdeditor_local_recovery.json');
      },
    },
  };
  window.CloudUI = { mixin, apiBase };
})();
