/* Local-first coordination. No browser UI dependencies; also executable in Node checks. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CloudSync = api;
})(typeof window === 'object' ? window : this, function () {
  'use strict';
  const SETTING_KEYS = ['editorRegexes', 'lang', 'theme', 'hideDNT', 'hideSourceInPreviewPanel', 'highlightDict', 'shiftEnterSave', 'autoOpenNextFile', 'inlineEditor', 'filterShortcutCtrlD', 'autocompleteShortcut', 'uiDensity', 'gamePreviewFrame', 'gamePreviewFonts'];
  const DEFAULT_SETTINGS = { editorRegexes: [], lang: '', theme: 'light', hideDNT: true, hideSourceInPreviewPanel: false, highlightDict: true, shiftEnterSave: false, autoOpenNextFile: true, inlineEditor: true, filterShortcutCtrlD: false, autocompleteShortcut: 'ctrl-space', uiDensity: 'compact', gamePreviewFrame: 'm', gamePreviewFonts: null };
  const LANGUAGES = ['French', 'German', 'Japanese', 'Korean', 'Polish', 'Portuguese', 'Russian', 'Simplified Chinese', 'Spanish', 'Thai', 'Traditional Chinese', 'Turkish'];
  const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
  const equal = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
  const preferences = value => Object.fromEntries(SETTING_KEYS.filter(k => value && Object.hasOwn(value, k)).map(k => [k, copy(value[k])]));
  const completeSettings = value => ({ ...copy(DEFAULT_SETTINGS), ...preferences(value) });
  const canAccessAllLanguages = user => !!user && (user.role === 'admin' || user.role === 'manager' || (!user.role && user.isAdmin === true));
  const sharedLanguage = (state, profile = state.profiles[state.activeProfile]) => canAccessAllLanguages(state.auth?.user) ? profile.settings.lang : state.auth?.user?.language;
  function validateImport(value) {
    const object = v => v && typeof v === 'object' && !Array.isArray(v);
    const string = v => typeof v === 'string';
    const assert = (condition, message) => { if (!condition) throw new Error('Invalid settings file: ' + message); };
    assert(object(value), 'expected a settings object.');
    if (Object.hasOwn(value, 'lang')) assert(value.lang === '' || LANGUAGES.includes(value.lang), 'unsupported language.');
    for (const key of SETTING_KEYS) {
      if (!Object.hasOwn(value, key)) continue;
      if (typeof DEFAULT_SETTINGS[key] === 'boolean') assert(typeof value[key] === 'boolean', key + ' must be boolean.');
    }
    const enums = { theme: ['light', 'grey', 'dark', 'modern-dark'], autocompleteShortcut: ['ctrl-space', 'ctrl-i', 'disabled'], uiDensity: ['compact', 'spacious'], gamePreviewFrame: ['s', 'm', 'l'] };
    for (const [key, allowed] of Object.entries(enums)) if (Object.hasOwn(value, key)) assert(allowed.includes(value[key]), key + ' is invalid.');
    if (value.gamePreviewFonts != null) assert(object(value.gamePreviewFonts) && Object.entries(value.gamePreviewFonts).every(([lang, font]) => LANGUAGES.includes(lang) && string(font)), 'preview fonts must map languages to strings.');
    if (value.editorClipboard != null) assert(string(value.editorClipboard), 'clipboard must be text.');
    if (Object.hasOwn(value, 'editorRegexes')) assert(Array.isArray(value.editorRegexes) && value.editorRegexes.every(r => object(r) && string(r.find) && string(r.replace)), 'regex rules must be Find/Replace rows.');
    if (Object.hasOwn(value, 'dictionary')) {
      assert(Array.isArray(value.dictionary), 'dictionary must be an array.');
      for (const entry of value.dictionary) {
        assert(object(entry) && string(entry.find) && string(entry.replace), 'dictionary entries must have text Find/Replace fields.');
        assert(entry.tlnote == null || string(entry.tlnote), 'TL notes must be text.');
        assert(entry._id == null || string(entry._id), 'entry IDs must be text.');
        assert(!Object.hasOwn(entry, 'gameScope') || ['all', 'poe1', 'poe2'].includes(entry.gameScope), 'Dictionary game scope must be PoE1, PoE2, or All.');
        assert(entry.alts == null || (Array.isArray(entry.alts) && entry.alts.every(a => object(a) && string(a.find) && (a.replace == null || string(a.replace)) && (a._id == null || string(a._id)))), 'alternates must be Find/Replace rows.');
      }
    }
  }
  const newDictionary = entries => ({ entries: copy(entries || []), base: null, conflicts: [], pendingResolution: null, revision: 0, localVersion: 0, syncedLocalVersion: -1 });
  function replaceEntries(dictionary, entries) {
    if (equal(dictionary.entries, entries)) return;
    dictionary.entries = entries;
    dictionary.localVersion = (dictionary.localVersion || 0) + 1;
  }
  function replaceConflicts(dictionary, conflicts) {
    if (equal(dictionary.conflicts, conflicts)) return;
    dictionary.conflicts = conflicts;
    dictionary.conflictVersion = (dictionary.conflictVersion || 0) + 1;
  }
  const revisionMatches = (left, right) => left != null && right != null && String(left) === String(right);
  function newProfile(settings) {
    return { settings: preferences(settings), clipboard: String(settings?.editorClipboard || ''), settingsBase: null, dictionaries: {}, unassignedDictionary: null, recovery: [] };
  }
  function initializeState(legacy) {
    const guest = newProfile(legacy || {});
    if (legacy?.lang) guest.dictionaries[legacy.lang] = newDictionary(legacy.dictionary);
    guest.unassignedDictionary = legacy && !legacy.lang && legacy.dictionary?.length ? copy(legacy.dictionary) : null;
    return { version: 1, activeProfile: 'guest', auth: null, profiles: { guest }, legacyRecovery: copy(legacy || null) };
  }
  function mergeSettings(base, local, remote) {
    const result = {};
    for (const key of SETTING_KEYS) {
      const value = equal(local?.[key], base?.[key]) ? remote?.[key] : local?.[key];
      if (value !== undefined) result[key] = copy(value);
    }
    return result;
  }
  function preserveConflictBases(snapshot, conflicts) {
    const result = copy(snapshot);
    for (const c of conflicts) {
      result.entries = result.entries.filter(e => e._id !== c.id);
      result.tombstones = (result.tombstones || []).filter(id => id !== c.id);
      if (c.base) result.entries.push(copy(c.base));
    }
    return result;
  }
  function acceptedSnapshot(remote, upserts, deletedIds, revision) {
    const entries = new Map(remote.entries.map(e => [e._id, copy(e)]));
    const deleted = new Set(remote.tombstones || []);
    for (const entry of upserts) { entries.set(entry._id, copy(entry)); deleted.delete(entry._id); }
    for (const id of deletedIds) { entries.delete(id); deleted.add(id); }
    return { revision, entries: [...entries.values()], tombstones: [...deleted] };
  }
  function autoMergedIds(merge, localEntries, remote, result, previous = []) {
    const local = merge.normalizeEntries(localEntries);
    const content = entry => entry && ({ find: entry.find, replace: entry.replace, gameScope: entry.gameScope || 'all', tlnote: entry.tlnote, alts: entry.alts.map(a => ({ find: a.find, replace: a.replace })) });
    const findKey = entry => entry.find.trim().toLowerCase() + '\u0000' + (entry.gameScope || 'all');
    return result.upserts.filter(entry => {
      if (previous.includes(entry._id)) return true;
      let own = local.find(row => row._id === entry._id);
      if (!own) {
        const matching = local.filter(row => findKey(row) === findKey(entry));
        if (matching.length === 1 && remote.entries.filter(row => findKey(row) === findKey(entry)).length === 1) own = matching[0];
      }
      // Uploads already differ from the remote. A result that also differs from
      // the local draft incorporated remote changes during automatic merging.
      return own && !equal(content(own), content(entry));
    }).map(entry => entry._id);
  }
  class Client {
    constructor({ store, merge, fetch: fetcher, apiBase, onChange, onStatus, uuid, locks, WebSocket: Socket, onWork, yieldWork, beforeSharedApply }) {
      this.store = store; this.merge = merge; this.fetcher = fetcher;
      this.apiBase = apiBase.replace(/\/$/, '');
      this.onChange = onChange || (() => {}); this.onStatus = onStatus || (() => {});
      this.uuid = uuid || (() => crypto.randomUUID()); this.locks = locks;
      this.state = null; this.epoch = 0; this.timer = null; this.running = null;
      this.backoff = 1000; this.lastActivityRefresh = 0; this.destroyed = false;
      this.localQueue = Promise.resolve();
      this.WebSocket = Socket; this.socket = null; this.socketOpening = null; this.socketReady = false;
      this.socketRetryAt = 0; this.socketBackoff = 1000; this.remoteHints = null; this.hintsContext = null;
      this.lastNotification = null; this.notifiedDictionary = null; this.notifiedConflicts = null;
      this.onWork = onWork || (() => {}); this.yieldWork = yieldWork || (() => Promise.resolve());
      this.beforeSharedApply = beforeSharedApply || (() => true);
    }
    async initialize(legacy) {
      this.state = await this.store.getHybridState();
      if (!this.state || Object.hasOwn(this.state, 'unassignedDictionary')) this.state = await this.store.updateHybridState(state => {
        if (!state) return initializeState(legacy);
        if (Object.hasOwn(state, 'unassignedDictionary')) {
          (state.profiles[state.activeProfile] || state.profiles.guest).unassignedDictionary = state.unassignedDictionary;
          delete state.unassignedDictionary;
        }
        return state;
      });
      return this.notify();
    }
    snapshot({ includeDictionary = true, includeConflicts = true } = {}) {
      const profile = this.state?.profiles[this.state.activeProfile];
      if (!profile) return null;
      const dictionary = profile.dictionaries[profile.settings.lang] || newDictionary();
      // Never expose a bearer token to reactive Vue state or exports.
      return { settings: copy(profile.settings), editorClipboard: profile.clipboard, ...(includeDictionary ? { dictionary: copy(dictionary.entries) } : {}), ...(includeConflicts ? { conflicts: copy(dictionary.conflicts) } : {}), revision: dictionary.revision, user: copy(this.state.auth?.user || null), signedIn: !!this.state.auth?.token, profileId: this.state.activeProfile, needsDictionaryLanguage: !!profile.unassignedDictionary?.length, recoveryCount: profile.recovery.length };
    }
    notify() {
      const profile = this.state?.profiles[this.state.activeProfile];
      if (!profile) return;
      const d = profile.dictionaries[profile.settings.lang];
      const dictionaryKey = JSON.stringify([this.state.activeProfile, profile.settings.lang, d?.localVersion || 0]);
      const conflictsKey = JSON.stringify([this.state.activeProfile, profile.settings.lang, d?.conflictVersion || 0]);
      const signature = JSON.stringify([profile.settings, profile.clipboard, conflictsKey, d?.revision || 0, this.state.auth?.user,
        !!this.state.auth?.token, this.state.activeProfile, !!profile.unassignedDictionary?.length, profile.recovery.length, dictionaryKey]);
      if (signature === this.lastNotification) return;
      const snapshot = this.snapshot({ includeDictionary: dictionaryKey !== this.notifiedDictionary, includeConflicts: conflictsKey !== this.notifiedConflicts });
      this.lastNotification = signature; this.notifiedDictionary = dictionaryKey; this.notifiedConflicts = conflictsKey;
      this.onChange(snapshot);
      return snapshot;
    }
    status(message, error = false, warning = false) { this.onStatus({ message, error, warning }); }
    context() {
      const user = this.state.auth?.user;
      return { epoch: this.epoch, profile: this.state.activeProfile, token: this.state.auth?.token,
        language: sharedLanguage(this.state), assignedLanguage: user?.language, assignmentVersion: user?.assignmentVersion,
        role: user?.role, allLanguages: canAccessAllLanguages(user) };
    }
    current(ctx, state = this.state) { return !this.destroyed && ctx.epoch === this.epoch && state.activeProfile === ctx.profile && state.auth?.token === ctx.token; }
    permissionsCurrent(ctx, state = this.state, allowSelectedLanguageChange = false) {
      return this.current(ctx, state) && state.auth?.user?.language === ctx.assignedLanguage
        && state.auth?.user?.assignmentVersion === ctx.assignmentVersion && state.auth?.user?.role === ctx.role
        && canAccessAllLanguages(state.auth?.user) === ctx.allLanguages
        && (allowSelectedLanguageChange || sharedLanguage(state) === ctx.language);
    }
    async update(fn, ctx, notify = true) {
      this.state = await this.store.updateHybridState(state => {
        if (!ctx || this.current(ctx, state)) fn(state, state.profiles[state.activeProfile]);
        return state;
      });
      if (notify) this.notify();
    }
    async updateShared(fn, ctx, notify = true, allowSelectedLanguageChange = false) {
      if (!this.permissionsCurrent(ctx, this.state, allowSelectedLanguageChange)) throw Object.assign(new Error('Account or language access changed'), { stale: true });
      await this.update((state, profile) => {
        if (!this.permissionsCurrent(ctx, state, allowSelectedLanguageChange)) throw Object.assign(new Error('Account or language access changed'), { stale: true });
        fn(state, profile);
      }, ctx, notify);
      if (!this.permissionsCurrent(ctx, this.state, allowSelectedLanguageChange)) throw Object.assign(new Error('Account or language access changed'), { stale: true });
    }
    saveLocal(payload, contextLanguage = payload.lang, { captured = false } = {}) {
      const requested = this.context();
      // UI saves already own a detached snapshot. Direct callers retain the
      // immediate capture contract so later input mutations cannot leak in.
      const snapshot = captured ? payload : copy(payload);
      const key = this.hintKey(requested) + ':' + contextLanguage;
      if (captured && this.pendingLocalJob?.captured && this.pendingLocalJob.key === key && !this.pendingLocalJob.started) {
        this.pendingLocalJob.payload = snapshot;
        return this.pendingLocalJob.operation;
      }
      const job = { key, payload: snapshot, started: false, captured };
      this.localSaveCount = (this.localSaveCount || 0) + 1;
      const operation = this.localQueue.catch(() => {}).then(() => {
        job.started = true;
        if (this.pendingLocalJob === job) this.pendingLocalJob = null;
        if (!this.current(requested)) return;
        return this.saveLocalNow(job.payload, contextLanguage);
      }).finally(() => { this.localSaveCount--; });
      job.operation = operation;
      this.pendingLocalJob = job;
      this.localQueue = operation;
      return operation;
    }
    async saveLocalNow(payload, contextLanguage) {
      const ctx = this.context();
      const observed = this.state.profiles[ctx.profile];
      await this.update((state, profile) => {
        // A language switch may already be queued. Never put the old dictionary
        // into a new language, even when Vue watchers finish out of order.
        if (profile.settings.lang !== contextLanguage) return;
        profile.settings = mergeSettings(observed.settings, preferences(payload), profile.settings);
        if (String(payload.editorClipboard || '') !== observed.clipboard) profile.clipboard = String(payload.editorClipboard || '');
        if (contextLanguage) {
          const dictionary = profile.dictionaries[contextLanguage] ||= newDictionary();
          const prior = observed.dictionaries[contextLanguage]?.entries || [];
          if (!equal(dictionary.entries, prior)) {
            const combined = this.merge.merge({ entries: prior, tombstones: [], revision: 0 }, payload.dictionary || [], { entries: dictionary.entries, tombstones: [], revision: 0 });
            if (combined.conflicts.length) throw new Error('This dictionary changed in another tab. Export your current settings to preserve this draft, then reload before retrying.');
            replaceEntries(dictionary, combined.entries);
          } else replaceEntries(dictionary, payload.dictionary || []);
        }
      }, ctx, false);
      const latest = this.state.profiles[ctx.profile];
      if (!equal(latest.settings, preferences(payload)) || !equal(latest.dictionaries[contextLanguage]?.entries || [], payload.dictionary || [])) this.notify();
      else this.notifiedDictionary = JSON.stringify([ctx.profile, contextLanguage, latest.dictionaries[contextLanguage]?.localVersion || 0]);
      this.schedule();
    }
    async selectLanguage(language, payload, oldLanguage) {
      if (this.localSaveCount) await this.localQueue;
      this.closeSocket();
      this.epoch++;
      const ctx = this.context();
      await this.update((state, profile) => {
        if (oldLanguage && profile.settings.lang === oldLanguage) {
          replaceEntries(profile.dictionaries[oldLanguage] ||= newDictionary(), copy(payload.dictionary || []));
        }
        profile.settings = { ...preferences(payload), lang: language };
        if (profile.unassignedDictionary?.length && language) {
          const existing = profile.dictionaries[language];
          if (existing) {
            const remote = { entries: existing.entries, tombstones: existing.base?.tombstones || [], revision: existing.revision };
            const merged = this.merge.merge(null, profile.unassignedDictionary, remote);
            replaceEntries(existing, merged.entries);
            replaceConflicts(existing, merged.conflicts);
            existing.base = preserveConflictBases(remote, merged.conflicts);
          } else profile.dictionaries[language] = newDictionary(profile.unassignedDictionary);
          profile.unassignedDictionary = null;
        }
        if (language) profile.dictionaries[language] ||= newDictionary();
      }, ctx);
      this.schedule(0);
    }
    async importLocal(payload) {
      if (this.localSaveCount) await this.localQueue;
      validateImport(payload);
      payload = { ...copy(payload), editorRegexes: (payload.editorRegexes || []).map(row => ({ find: row.find, replace: row.replace })), dictionary: this.merge.normalizeEntries(payload.dictionary || []) };
      if (payload.lang !== this.state.profiles[this.state.activeProfile].settings.lang) { this.closeSocket(); this.epoch++; }
      const ctx = this.context();
      await this.update((state, profile) => {
        profile.recovery.push({ at: Date.now(), reason: 'Before settings import', settings: copy(profile.settings), dictionaries: copy(profile.dictionaries), editorClipboard: profile.clipboard });
        profile.settings = preferences(payload);
        profile.clipboard = String(payload.editorClipboard || '');
        if (payload.lang) replaceEntries(profile.dictionaries[payload.lang] ||= newDictionary(), copy(payload.dictionary || []));
        else profile.unassignedDictionary = copy(payload.dictionary || []);
      }, ctx);
      this.schedule();
    }
    recoveryExport() {
      const profile = this.state.profiles[this.state.activeProfile];
      const cleanDictionary = dictionaries => Object.fromEntries(Object.entries(dictionaries || {}).map(([lang, d]) => [lang, copy(d.entries)]));
      return { legacySettings: copy(this.state.legacyRecovery), copies: profile.recovery.map(r => ({ at: r.at, reason: r.reason, settings: copy(r.settings), dictionaries: cleanDictionary(r.dictionaries), editorClipboard: r.editorClipboard })) };
    }
    async request(path, options = {}, ctx = this.context()) {
      if (!this.permissionsCurrent(ctx)) throw Object.assign(new Error('Account or language access changed'), { stale: true });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      try {
        const response = await this.fetcher(this.apiBase + path, { method: options.method || 'GET', credentials: 'omit', cache: 'no-store', signal: controller.signal,
          headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(ctx.token ? { Authorization: 'Bearer ' + ctx.token } : {}),
            ...(path.startsWith('/v1/dictionaries/') ? { 'X-SDEditor-Dictionary-Version': '2' } : {}) },
          ...(options.body ? { body: JSON.stringify(options.body) } : {}) });
        const data = response.status === 204 ? null : await response.json();
        if (!this.permissionsCurrent(ctx)) throw Object.assign(new Error('Account or language access changed'), { stale: true });
        if (!response.ok) {
          const error = Object.assign(new Error(data?.error?.message || 'Cloud request failed'), { status: response.status, code: data?.error?.code, current: data?.current });
          if (response.status === 401 && ctx.token) {
            await this.update(state => { state.auth = { ...state.auth, token: null }; }, ctx);
            this.status('Session expired. Sign in again; your local changes are safe.', true);
          } else if (response.status === 403 && ctx.token && error.code === 'LANGUAGE_UNASSIGNED') {
            // Permission revocation keeps the login and all local work, but
            // immediately closes shared views and stops their background reads.
            let currentUser;
            if (ctx.allLanguages && path !== '/v1/me') {
              try { currentUser = (await this.request('/v1/me', {}, ctx)).user; }
              catch (refreshError) { if (refreshError.stale) throw refreshError; }
            }
            await this.update(state => {
              if (this.permissionsCurrent(ctx, state)) state.auth.user = currentUser || { ...state.auth.user, language: null,
                ...(ctx.allLanguages ? { role: 'translator', canAccessAllLanguages: false, isAdmin: false } : {}) };
            }, ctx);
            this.closeSocket();
            this.reportError(error);
          } else if (response.status === 403 && ctx.token && error.code === 'LANGUAGE_FORBIDDEN' && path !== '/v1/me') {
            // A forbidden room/dictionary may indicate reassignment. Re-read
            // the profile rather than treating a scoped denial as a sign-out.
            try {
              const me = await this.request('/v1/me', {}, ctx);
              await this.update(state => {
                if (this.permissionsCurrent(ctx, state)) { state.auth.user = me.user; state.auth.expiresAt = me.expiresAt; }
              }, ctx);
              if (!this.permissionsCurrent(ctx)) this.closeSocket();
            } catch (refreshError) { if (refreshError.stale) throw refreshError; }
          }
          throw error;
        }
        return data;
      } finally { clearTimeout(timeout); }
    }
    async acceptLogin(result) {
      if (this.localSaveCount) await this.localQueue;
      this.closeSocket(); this.remoteHints = null; this.hintsContext = null;
      this.epoch++;
      await this.update((state) => {
        const id = result.user.id;
        if (!state.profiles[id]) {
          // Adopt guest data only. Never adopt the outgoing account's draft.
          const guest = state.profiles.guest;
          const profile = newProfile({ ...guest.settings, editorClipboard: guest.clipboard });
          profile.dictionaries = Object.fromEntries(Object.entries(guest.dictionaries).map(([lang, d]) => [lang, newDictionary(d.entries)]));
          profile.unassignedDictionary = copy(guest.unassignedDictionary || null);
          state.profiles[id] = profile;
        }
        state.auth = { token: result.token, user: copy(result.user), expiresAt: result.expiresAt };
        state.activeProfile = id;
      });
      this.lastActivityRefresh = Date.now();
      await this.sync();
    }
    async refreshSession(force = false) {
      if (!this.state.auth?.token || (!force && Date.now() - this.lastActivityRefresh < 5 * 60 * 1000)) return;
      const ctx = this.context();
      this.lastActivityRefresh = Date.now();
      try {
        const result = await this.request('/auth/session/refresh', { method: 'POST' }, ctx);
        await this.update(state => {
          if (this.permissionsCurrent(ctx, state)) { state.auth.user = result.user; state.auth.expiresAt = result.expiresAt; }
        }, ctx);
        const current = this.context();
        this.rememberHints(result.sync, current);
        if (this.hintKey(ctx) !== this.hintKey(current)) this.closeSocket();
        this.schedule(0);
      } catch (error) { this.lastActivityRefresh = 0; this.reportError(error); }
    }
    async logout() {
      if (this.localSaveCount) await this.localQueue;
      this.closeSocket(); this.remoteHints = null; this.hintsContext = null;
      const ctx = this.context();
      let revoked = true;
      try { if (ctx.token) await this.request('/auth/logout', { method: 'POST' }, ctx); }
      catch (error) { if (error.stale) return; revoked = error.status === 401; }
      this.epoch++;
      await this.update(state => { state.auth = null; state.activeProfile = 'guest'; });
      this.status(revoked ? 'Signed out · saved account drafts remain in this browser' : 'Signed out in this browser · server revocation could not be confirmed', !revoked);
    }
    schedule(delay = 1000) {
      clearTimeout(this.timer);
      if (!this.destroyed && this.state.auth?.token) this.timer = setTimeout(() => this.sync(), delay);
    }
    reportError(error) {
      if (error.stale) return;
      if (error.status === 401) return;
      const prefix = error.status === 403 ? 'Cloud access unavailable' : 'Saved locally · cloud unavailable';
      this.status(prefix + ': ' + error.message, true);
    }
    hintKey(ctx = this.context()) { return JSON.stringify([ctx.epoch, ctx.profile, ctx.token, ctx.language, ctx.assignedLanguage, ctx.assignmentVersion, ctx.role, ctx.allLanguages]); }
    rememberHints(hints, ctx = this.context(), authoritative = false) {
      if (!hints || hints.language !== ctx.language || !this.permissionsCurrent(ctx)) return;
      const key = this.hintKey(ctx);
      const prior = !authoritative && this.hintsContext === key ? this.remoteHints : null;
      this.remoteHints = { ...hints };
      for (const field of ['settingsRevision', 'dictionaryRevision']) {
        if (prior?.[field] != null && Number(prior[field]) > Number(hints[field])) this.remoteHints[field] = prior[field];
      }
      this.hintsContext = key;
    }
    hints(ctx = this.context()) { return this.hintsContext === this.hintKey(ctx) ? this.remoteHints : null; }
    openSocket() {
      const ctx = this.context();
      if (!this.WebSocket || !ctx.token || !ctx.language || this.destroyed || Date.now() < this.socketRetryAt) return Promise.resolve();
      const key = this.hintKey(ctx);
      if (this.socket && this.socketContext !== key) this.closeSocket();
      if (this.socket || this.socketOpening) return this.socketOpening || Promise.resolve();
      const operation = (async () => {
        const ticket = await this.request('/v1/sync/ticket', { method: 'POST', ...(ctx.allLanguages ? { body: { language: ctx.language } } : {}) }, ctx);
        if (!this.permissionsCurrent(ctx)) return;
        const url = new URL(ticket.url || '/v1/collaboration/ws?ticket=' + encodeURIComponent(ticket.ticket), this.apiBase);
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        const socket = new this.WebSocket(url.href);
        this.socket = socket; this.socketContext = key;
        socket.onmessage = event => {
          if (this.socket !== socket || !this.permissionsCurrent(ctx)) return;
          this.lastSocketMessage = Date.now();
          let message; try { message = JSON.parse(event.data); } catch (_) { return; }
          if (!['sync_ready', 'sync_changed'].includes(message.type)) return;
          if (message.sync?.language !== ctx.language) { this.closeSocket(); this.schedule(0); return; }
          this.socketReady = true; this.socketBackoff = 1000; this.socketRetryAt = 0;
          const before = JSON.stringify(this.hints(ctx));
          this.rememberHints(message.sync, ctx, message.type === 'sync_ready');
          if (before !== JSON.stringify(this.hints(ctx))) this.schedule(0);
        };
        socket.onopen = () => {
          if (this.socket !== socket || !this.permissionsCurrent(ctx)) { socket.close(); return; }
          this.lastSocketMessage = Date.now();
          this.socketHeartbeat = setInterval(() => {
            if (Date.now() - this.lastSocketMessage > 45000) { socket.close(); return; }
            if (socket.readyState === 1) socket.send(JSON.stringify({ type: 'heartbeat' }));
          }, 15000);
          this.socketHeartbeat.unref?.();
        };
        socket.onerror = () => {};
        socket.onclose = () => {
          if (this.socket !== socket) return;
          this.closeSocket();
          if (this.permissionsCurrent(ctx)) {
            this.socketRetryAt = Date.now() + this.socketBackoff;
            this.schedule(this.socketBackoff);
            this.socketBackoff = Math.min(this.socketBackoff * 2, 30000);
          }
        };
      })().catch(error => {
        if (this.permissionsCurrent(ctx)) this.socketRetryAt = Date.now() + 30000;
        // Revision checks remain available when a proxy or older API lacks sockets.
        if (error.status === 401 || error.status === 403) this.reportError(error);
      }).finally(() => { if (this.socketOpening === operation) this.socketOpening = null; });
      this.socketOpening = operation;
      return operation;
    }
    closeSocket() {
      const socket = this.socket; this.socket = null; this.socketReady = false; this.socketContext = null;
      this.socketOpening = null;
      clearInterval(this.socketHeartbeat); this.socketHeartbeat = null;
      if (socket) { socket.onclose = null; socket.close(); }
    }
    async sync() {
      clearTimeout(this.timer);
      if (this.running) { this.resyncRequested = true; return this.running; }
      if (!this.state.auth?.token || this.destroyed) return;
      await this.localQueue.catch(() => {});
      if (this.running || !this.state.auth?.token || this.destroyed) return this.running;
      let ctx = this.context();
      const run = async () => {
        this.state = await this.store.getHybridState();
        if (!this.current(ctx)) { this.notify(); return; }
        ctx = this.context();
        if (!this.socketReady || !this.hints(ctx)) {
          const me = await this.request('/v1/me', {}, ctx);
          if (!equal(this.state.auth.user, me.user)) {
            await this.update(state => {
              if (this.permissionsCurrent(ctx, state)) { state.auth.user = me.user; state.auth.expiresAt = me.expiresAt; }
            }, ctx);
          }
          if (!this.current(ctx)) return;
          const priorContext = ctx;
          ctx = this.context();
          if (this.hintKey(priorContext) !== this.hintKey(ctx)) this.closeSocket();
          this.rememberHints(me.sync, ctx, true);
        }
        if (!this.current(ctx)) return;
        ctx = this.context();
        if (!ctx.language && !ctx.allLanguages) { this.status('Not configured — awaiting admin language assignment', false, true); return; }
        let hints = this.hints(ctx);
        const profile = this.state.profiles[ctx.profile];
        if (profile.settingsWrite || !revisionMatches(profile.settingsBase?.revision, hints?.settingsRevision)
          || !equal(profile.settings, profile.settingsBase?.settings)) await this.syncSettings(ctx);
        if (!this.permissionsCurrent(ctx, this.state, true)) return;
        const priorContext = ctx;
        ctx = this.context();
        if (this.hintKey(priorContext) !== this.hintKey(ctx)) this.closeSocket();
        hints = this.hints(ctx);
        if (!ctx.language) { this.notify(); this.status('Choose a language to access shared work', false, true); return; }
        const language = ctx.language;
        // Translator drafts outside the assignment stay local. Managers sync
        // only the selected language, keeping every draft in its own dictionary.
        const d = this.state.profiles[ctx.profile].dictionaries[language];
        if (!d?.base || d.pendingWrite || d.pendingResolution || d.pendingHistoryRestore
          || d.syncedLocalVersion == null || d.syncedLocalVersion !== (d.localVersion || 0)
          || !revisionMatches(d.revision, hints?.dictionaryRevision)) await this.syncDictionary(ctx, language);
        this.backoff = 1000;
        this.notify();
        // Leave existing failures visible throughout retries; only a completed
        // sync can clear them. Routine saves and polling have no visible status.
        const active = this.state.profiles[this.state.activeProfile];
        const warning = active.dictionaries[active.settings.lang]?.conflicts.length ? 'Saved locally · dictionary conflicts need your choice'
          : active.settings.lang !== language ? 'Selected dictionary language is local only' : '';
        this.status(warning, false, !!warning);
        this.openSocket().catch(() => {});
      };
      this.running = (this.locks ? this.locks.request('sdeditor-cloud-sync', run) : run()).catch(error => {
        this.reportError(error);
        if (!error.stale && error.status !== 401 && error.status !== 403) {
          this.backoff = Math.min(this.backoff * 2, 60000); this.schedule(this.backoff);
        }
      }).finally(() => {
        this.running = null;
        if (ctx.epoch !== this.epoch || this.resyncRequested) { this.resyncRequested = false; this.schedule(0); }
      });
      return this.running;
    }
    async syncSettings(ctx) {
      for (let attempt = 0; attempt < 4; attempt++) {
        const pending = this.state.profiles[ctx.profile].settingsWrite;
        if (pending) {
          try { await this.sendSettingsWrite(ctx, pending); }
          catch (error) { if (error.status !== 409) throw error; }
          if (!this.permissionsCurrent(ctx, this.state, true)) return;
          ctx = this.context();
        }
        const remote = await this.request('/v1/settings', {}, ctx);
        if (await this.beforeSharedApply() === false) throw new Error('Save local settings before applying shared changes. Automatic sync will retry.');
        await this.updateShared((state, profile) => {
          if (!profile.settingsBase && remote.settings) {
            profile.recovery.push({ at: Date.now(), reason: 'Before first cloud restore', settings: copy(profile.settings), dictionaries: copy(profile.dictionaries), editorClipboard: profile.clipboard });
            profile.settings = preferences(remote.settings);
          } else if (profile.settingsBase) {
            profile.settings = mergeSettings(profile.settingsBase.settings, profile.settings, remote.settings || {});
          }
          profile.settingsBase = copy(remote);
        }, ctx, false, true);
        if (!this.permissionsCurrent(ctx, this.state, true)) return;
        ctx = this.context();
        const profile = this.state.profiles[ctx.profile];
        const submitted = copy(profile.settings);
        if (remote.settings && equal(submitted, remote.settings)) return;
        try {
          const write = { baseRevision: remote.revision, mutationId: this.uuid(), settings: submitted };
          await this.updateShared((state, latest) => { latest.settingsWrite = write; }, ctx, false);
          await this.sendSettingsWrite(ctx, write);
          return;
        } catch (error) { if (error.status !== 409 || attempt === 3) throw error; }
      }
    }
    async sendSettingsWrite(ctx, write) {
      try {
        const response = await this.request('/v1/settings', { method: 'PUT', body: write }, ctx);
        if (await this.beforeSharedApply() === false) throw new Error('Save local settings before applying shared changes. Automatic sync will retry.');
        await this.updateShared((state, profile) => {
          profile.settings = mergeSettings(write.settings, profile.settings, response.settings);
          profile.settingsBase = copy(response);
          if (profile.settingsWrite?.mutationId === write.mutationId) profile.settingsWrite = null;
        }, ctx, false, true);
        const hints = this.hints(ctx);
        if (hints) this.rememberHints({ ...hints, settingsRevision: response.revision }, ctx);
      } catch (error) {
        if ([400, 409, 413, 422].includes(error.status)) await this.update((state, profile) => { profile.settingsWrite = null; }, ctx, false);
        throw error;
      }
    }
    async mergeRemote(ctx, language, remote, accepted, mutationId, remoteUnchanged = false) {
      let result;
      if (await this.beforeSharedApply() === false) throw new Error('Save local Dictionary edits before applying shared changes. Automatic sync will retry.');
      this.onWork({ key: 'dictionary', label: 'Updating Dictionary entries', active: true, immediate: true });
      try {
        await this.yieldWork();
        await this.updateShared((state, profile) => {
          const d = profile.dictionaries[language] ||= newDictionary();
          const baseline = accepted ? preserveConflictBases(accepted, d.conflicts) : d.base;
          const localOnly = remoteUnchanged && this.merge.changesSince && !d.conflicts.length
            && revisionMatches(d.base?.revision, remote.revision);
          result = localOnly ? this.merge.changesSince(d.base, d.entries) : this.merge.merge(baseline, d.entries, remote);
          const priorAutoMerged = (d.autoMergedIds || []).filter(id => !accepted || !d.pendingWrite?.request.upserts.some(e => e._id === id));
          d.autoMergedIds = localOnly ? priorAutoMerged.filter(id => result.upserts.some(entry => entry._id === id))
            : autoMergedIds(this.merge, d.entries, remote, result, priorAutoMerged);
          replaceEntries(d, result.entries);
          replaceConflicts(d, result.conflicts);
          if (!localOnly) d.base = preserveConflictBases(remote, result.conflicts);
          d.revision = remote.revision;
          if (!result.upserts.length && !result.deletedIds.length) d.syncedLocalVersion = d.localVersion || 0;
          if (mutationId && d.pendingWrite?.request.mutationId === mutationId) d.pendingWrite = null;
        }, ctx, false);
      } finally { this.onWork({ key: 'dictionary', label: 'Updating Dictionary entries', active: false }); }
      const hints = this.hints(ctx);
      if (hints) this.rememberHints({ ...hints, dictionaryRevision: remote.revision }, ctx);
      return result;
    }
    async syncDictionary(ctx, language) {
      const path = '/v1/dictionaries/' + encodeURIComponent(language);
      let fetchRequired = false;
      for (let attempt = 0; attempt < 4; attempt++) {
        const historyRestore = this.state.profiles[ctx.profile].dictionaries[language]?.pendingHistoryRestore;
        if (historyRestore) await this.sendHistoryRestore(ctx, language, historyRestore);
        const pendingWrite = this.state.profiles[ctx.profile].dictionaries[language]?.pendingWrite;
        if (pendingWrite) {
          try { await this.sendDictionaryWrite(ctx, language, pendingWrite); }
          catch (error) { if (error.status !== 409) throw error; fetchRequired = true; }
        }
        const pending = this.state.profiles[ctx.profile].dictionaries[language]?.pendingResolution;
        if (pending) await this.sendResolution(ctx, language, pending);
        const current = this.state.profiles[ctx.profile].dictionaries[language];
        const hint = this.hints(ctx)?.dictionaryRevision;
        if (current?.base && !current.pendingWrite && !current.pendingResolution && !current.pendingHistoryRestore
          && current.syncedLocalVersion != null && current.syncedLocalVersion === (current.localVersion || 0)
          && hint != null && revisionMatches(current.revision, hint)) return;
        // Conflict baselines deliberately retain an older entry, so only a
        // conflict-free baseline represents the complete current remote copy.
        const cached = !fetchRequired && current?.base && !current.conflicts.length
          && hint != null && revisionMatches(current.revision, hint)
          && revisionMatches(current.base.revision, hint);
        const remote = cached ? current.base : await this.request(path, {}, ctx);
        const merged = await this.mergeRemote(ctx, language, remote, null, null, cached);
        if (!merged || !this.current(ctx)) return;
        if (!merged.upserts.length && !merged.deletedIds.length) return;
        const automatic = new Set(this.state.profiles[ctx.profile].dictionaries[language].autoMergedIds || []);
        const origins = Object.fromEntries(merged.upserts.filter(entry => automatic.has(entry._id)).map(entry => [entry._id, 'auto_merge']));
        const request = { baseRevision: remote.revision, mutationId: this.uuid(), upserts: merged.upserts, deletedIds: merged.deletedIds, ...(Object.keys(origins).length ? { origins } : {}) };
        try {
          const write = { remote, request, localVersion: this.state.profiles[ctx.profile].dictionaries[language].localVersion || 0 };
          await this.updateShared((state, profile) => { profile.dictionaries[language].pendingWrite = write; }, ctx, false);
          await this.sendDictionaryWrite(ctx, language, write);
          return;
        } catch (error) { if (error.status !== 409 || attempt === 3) throw error; fetchRequired = true; }
      }
    }
    async sendDictionaryWrite(ctx, language, write) {
      try {
        const response = await this.request('/v1/dictionaries/' + encodeURIComponent(language) + '?return=ack', { method: 'PATCH', body: write.request }, ctx);
        const accepted = acceptedSnapshot(write.remote, write.request.upserts, write.request.deletedIds, response.appliedRevision || response.revision);
        if (!Array.isArray(response.entries)) {
          if (response.revision !== response.appliedRevision || response.mutationId !== write.request.mutationId) throw new Error('Invalid Dictionary save acknowledgement. Automatic sync will retry.');
          if (await this.beforeSharedApply() === false) throw new Error('Save local Dictionary edits before applying shared changes. Automatic sync will retry.');
          const current = this.state.profiles[ctx.profile].dictionaries[language];
          if (write.localVersion != null && (current.localVersion || 0) === write.localVersion) {
            let applied = false;
            await this.updateShared((state, profile) => {
              const d = profile.dictionaries[language];
              // Other tabs can commit while the request is in flight. Recheck
              // inside the durable transaction before skipping a merge.
              if ((d.localVersion || 0) !== write.localVersion || d.pendingWrite?.request.mutationId !== write.request.mutationId) return;
              d.base = preserveConflictBases(accepted, d.conflicts);
              d.revision = accepted.revision;
              d.syncedLocalVersion = d.localVersion || 0;
              d.autoMergedIds = (d.autoMergedIds || []).filter(id => !write.request.upserts.some(entry => entry._id === id));
              if (d.pendingWrite?.request.mutationId === write.request.mutationId) d.pendingWrite = null;
              applied = true;
            }, ctx, false);
            const latest = this.state.profiles[ctx.profile].dictionaries[language];
            if (latest.pendingWrite?.request.mutationId === write.request.mutationId) await this.mergeRemote(ctx, language, accepted, accepted, write.request.mutationId);
            else if (applied) {
              const hints = this.hints(ctx);
              if (hints) this.rememberHints({ ...hints, dictionaryRevision: accepted.revision }, ctx);
            }
          } else await this.mergeRemote(ctx, language, accepted, accepted, write.request.mutationId);
        } else await this.mergeRemote(ctx, language, response, accepted, write.request.mutationId);
      } catch (error) {
        if ([400, 409, 413, 422].includes(error.status)) await this.update((state, profile) => { profile.dictionaries[language].pendingWrite = null; }, ctx, false);
        throw error;
      }
    }
    async resolveConflict(id, choices, revision) {
      if (await this.beforeSharedApply() === false) throw new Error('Save local Dictionary edits before resolving this conflict.');
      const ctx = this.context();
      const language = this.state.profiles[ctx.profile].settings.lang;
      if (!ctx.token || !language || language !== ctx.language) throw new Error('This language is local only.');
      await this.updateShared((state, profile) => {
        const d = profile.dictionaries[language];
        const conflict = d.conflicts.find(c => c.id === id);
        if (!conflict || d.revision !== revision) throw new Error('The dictionary changed. Review the current conflict again.');
        if (d.pendingResolution) throw new Error('A previous resolution is still waiting to sync. Automatic sync will retry; wait for confirmation before resolving another conflict.');
        if (d.pendingHistoryRestore) throw new Error('A history restore is still waiting to sync. Automatic sync will retry; wait for confirmation before resolving another conflict.');
        const entry = this.merge.resolve(conflict, choices);
        d.pendingResolution = { id, entry, originalLocal: copy(d.entries.find(e => e._id === id) || null), revision, mutationId: this.uuid(), origin: 'conflict_resolution' };
      }, ctx, false);
      await this.sendResolution(ctx, language, this.state.profiles[ctx.profile].dictionaries[language].pendingResolution);
      this.notify(); this.schedule(0);
    }
    async sendResolution(ctx, language, pending) {
      try {
        const response = await this.request('/v1/dictionaries/' + encodeURIComponent(language), { method: 'PATCH', body: { baseRevision: pending.revision, mutationId: pending.mutationId, upserts: pending.entry ? [pending.entry] : [], deletedIds: pending.entry ? [] : [pending.id], ...(pending.origin ? { origins: { [pending.id]: pending.origin } } : {}) } }, ctx);
        if (await this.beforeSharedApply() === false) throw new Error('Save local Dictionary edits before applying shared changes. Automatic sync will retry.');
        await this.updateShared((state, profile) => {
          const d = profile.dictionaries[language];
          const current = d.entries.find(e => e._id === pending.id) || null;
          const rebased = this.merge.merge(
            { entries: pending.originalLocal ? [pending.originalLocal] : [], tombstones: [], revision: 0 },
            current ? [current] : [],
            { entries: pending.entry ? [pending.entry] : [], tombstones: pending.entry ? [] : [pending.id], revision: response.revision }
          );
          replaceEntries(d, d.entries.filter(e => e._id !== pending.id).concat(rebased.entries));
          replaceConflicts(d, d.conflicts.filter(c => c.id !== pending.id).concat(rebased.conflicts));
          d.base = preserveConflictBases(acceptedSnapshot(d.base || { entries: [], tombstones: [] }, pending.entry ? [pending.entry] : [], pending.entry ? [] : [pending.id], response.appliedRevision || response.revision), d.conflicts);
          d.pendingResolution = null;
        }, ctx, false);
        await this.mergeRemote(ctx, language, response);
      } catch (error) {
        if (error.status === 409) {
          await this.update((state, profile) => { profile.dictionaries[language].pendingResolution = null; }, ctx, false);
          const remote = error.current || await this.request('/v1/dictionaries/' + encodeURIComponent(language), {}, ctx);
          await this.mergeRemote(ctx, language, remote);
          this.notify();
          throw new Error('Another translator updated this dictionary. Review the refreshed result before saving.');
        }
        throw error;
      }
    }
    historyContext() {
      const ctx = this.context();
      if (!ctx.token || !ctx.language) throw new Error('Sign in with language access and choose a language to view shared history.');
      return ctx;
    }
    assertHistoryContext(ctx) {
      if (!this.permissionsCurrent(ctx)) throw Object.assign(new Error('Account or language access changed. Open history again.'), { stale: true });
    }
    async getDictionaryHistory(filters = {}) {
      const ctx = this.historyContext();
      const params = new URLSearchParams();
      for (const key of ['entryId', 'q', 'actor', 'action', 'origin', 'from', 'to', 'cursor', 'limit']) {
        if (filters[key] !== undefined && filters[key] !== null && filters[key] !== '') params.set(key, String(filters[key]));
      }
      const result = await this.request('/v1/dictionaries/' + encodeURIComponent(ctx.language) + '/history?' + params, {}, ctx);
      this.assertHistoryContext(ctx);
      return result;
    }
    async getDictionaryHistoryEvent(id) {
      const ctx = this.historyContext();
      const result = await this.request('/v1/dictionaries/' + encodeURIComponent(ctx.language) + '/history/' + encodeURIComponent(id), {}, ctx);
      this.assertHistoryContext(ctx);
      return result;
    }
    async restoreDictionaryHistory(eventId, version, revision) {
      if (!['before', 'after'].includes(version)) throw new Error('Choose a history version to restore.');
      if (await this.beforeSharedApply() === false) throw new Error('Save local Dictionary edits before restoring shared history.');
      const ctx = this.historyContext();
      await this.localQueue.catch(() => {});
      while (this.running) await this.running;
      this.assertHistoryContext(ctx);
      clearTimeout(this.timer);
      const run = async () => {
        this.state = await this.store.getHybridState();
        this.assertHistoryContext(ctx);
        const path = '/v1/dictionaries/' + encodeURIComponent(ctx.language);
        const existing = this.state.profiles[ctx.profile].dictionaries[ctx.language];
        if (existing?.pendingHistoryRestore || existing?.pendingWrite || existing?.pendingResolution) throw new Error('Another dictionary change is waiting to sync. Automatic sync will retry; review the history version again after it completes.');
        const event = await this.request(path + '/history/' + encodeURIComponent(eventId), {}, ctx);
        const remote = await this.request(path, {}, ctx);
        this.assertHistoryContext(ctx);
        if (remote.revision !== revision || event.currentRevision !== revision) throw Object.assign(new Error('The shared dictionary changed. Refresh the history preview before restoring.'), { status: 409 });
        if (event.action === 'baseline' && version === 'before') throw new Error('The version before history started is unavailable.');
        const entry = event[version];
        if (entry === undefined || (entry && entry._id !== event.entryId)) throw new Error('The selected history version is invalid.');
        await this.updateShared((state, profile) => {
          const d = profile.dictionaries[ctx.language] ||= newDictionary();
          profile.recovery.push({ at: Date.now(), reason: 'Before shared history restore', settings: copy(profile.settings), dictionaries: copy(profile.dictionaries), editorClipboard: profile.clipboard });
          d.pendingHistoryRestore = { id: event.entryId, eventId, entry: copy(entry), originalLocal: copy(d.entries.find(e => e._id === event.entryId) || null), request: { baseRevision: revision, mutationId: this.uuid(), version } };
        }, ctx, false);
        const pending = this.state.profiles[ctx.profile].dictionaries[ctx.language].pendingHistoryRestore;
        await this.sendHistoryRestore(ctx, ctx.language, pending);
        this.notify();
      };
      const operation = this.locks ? this.locks.request('sdeditor-cloud-sync', run) : run();
      this.running = operation.catch(() => {}).finally(() => { this.running = null; this.schedule(1000); });
      try { await operation; }
      catch (error) {
        if (error.stale || error.status || !this.state.profiles[ctx.profile]?.dictionaries[ctx.language]?.pendingHistoryRestore) throw error;
        throw new Error('Restore is saved locally but confirmation is pending. Automatic sync will retry safely. ' + error.message);
      }
    }
    async sendHistoryRestore(ctx, language, pending) {
      try {
        const response = await this.request('/v1/dictionaries/' + encodeURIComponent(language) + '/history/' + encodeURIComponent(pending.eventId) + '/restore', { method: 'POST', body: pending.request }, ctx);
        if (await this.beforeSharedApply() === false) throw new Error('Save local Dictionary edits before applying shared changes. Automatic sync will retry.');
        await this.updateShared((state, profile) => {
          const d = profile.dictionaries[language];
          const current = d.entries.find(e => e._id === pending.id) || null;
          const rebased = this.merge.merge(
            { entries: pending.originalLocal ? [pending.originalLocal] : [], tombstones: [], revision: 0 },
            current ? [current] : [],
            { entries: pending.entry ? [pending.entry] : [], tombstones: pending.entry ? [] : [pending.id], revision: response.appliedRevision || response.revision }
          );
          const entries = d.entries.flatMap(e => e._id === pending.id ? rebased.entries : [e]);
          if (!current) entries.push(...rebased.entries);
          replaceEntries(d, entries);
          replaceConflicts(d, d.conflicts.filter(c => c.id !== pending.id).concat(rebased.conflicts));
          d.base = preserveConflictBases(acceptedSnapshot(d.base || { entries: [], tombstones: [] }, pending.entry ? [pending.entry] : [], pending.entry ? [] : [pending.id], response.appliedRevision || response.revision), d.conflicts);
          d.pendingHistoryRestore = null;
        }, ctx, false);
        await this.mergeRemote(ctx, language, response);
      } catch (error) {
        if ([400, 404, 409, 413, 422].includes(error.status)) {
          await this.update((state, profile) => { profile.dictionaries[language].pendingHistoryRestore = null; }, ctx, false);
          if (error.status === 409) {
            const remote = error.current || await this.request('/v1/dictionaries/' + encodeURIComponent(language), {}, ctx);
            await this.mergeRemote(ctx, language, remote);
            this.notify();
            error.message = 'Another translator changed the dictionary. Refresh the history preview before restoring.';
          }
        }
        throw error;
      }
    }
    async listUsers() { const result = await this.request('/v1/admin/users'); return result.users; }
    async assignLanguage(id, language) {
      const result = await this.request('/v1/admin/users/' + encodeURIComponent(id) + '/language', { method: 'PUT', body: { language: language || null } });
      await this.refreshSession(true); return result.user;
    }
    async assignRole(id, role) {
      const result = await this.request('/v1/admin/users/' + encodeURIComponent(id) + '/role', { method: 'PUT', body: { role } });
      await this.refreshSession(true); return result.user;
    }
    destroy() { this.destroyed = true; this.epoch++; clearTimeout(this.timer); this.closeSocket(); }
  }
  return { Client, SETTING_KEYS, DEFAULT_SETTINGS, initializeState, mergeSettings, preferences, completeSettings, validateImport, preserveConflictBases, acceptedSnapshot, canAccessAllLanguages };
});
