/* Local-first coordination. No browser UI dependencies; also executable in Node checks. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CloudSync = api;
})(typeof window === 'object' ? window : this, function () {
  'use strict';
  const SETTING_KEYS = ['editorRegexes', 'lang', 'theme', 'hideDNT', 'hideSourceInPreviewPanel', 'highlightDict', 'shiftEnterSave', 'autoOpenNextFile', 'filterShortcutCtrlD', 'autocompleteShortcut', 'uiDensity', 'gamePreviewFrame', 'gamePreviewFonts'];
  const DEFAULT_SETTINGS = { editorRegexes: [], lang: '', theme: 'light', hideDNT: true, hideSourceInPreviewPanel: false, highlightDict: true, shiftEnterSave: false, autoOpenNextFile: true, filterShortcutCtrlD: false, autocompleteShortcut: 'ctrl-space', uiDensity: 'compact', gamePreviewFrame: 'm', gamePreviewFonts: null };
  const LANGUAGES = ['French', 'German', 'Japanese', 'Korean', 'Polish', 'Portuguese', 'Russian', 'Simplified Chinese', 'Spanish', 'Thai', 'Traditional Chinese', 'Turkish'];
  const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
  const equal = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
  const preferences = value => Object.fromEntries(SETTING_KEYS.filter(k => value && Object.hasOwn(value, k)).map(k => [k, copy(value[k])]));
  const completeSettings = value => ({ ...copy(DEFAULT_SETTINGS), ...preferences(value) });
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
        assert(entry.alts == null || (Array.isArray(entry.alts) && entry.alts.every(a => object(a) && string(a.find) && (a.replace == null || string(a.replace)) && (a._id == null || string(a._id)))), 'alternates must be Find/Replace rows.');
      }
    }
  }
  const newDictionary = entries => ({ entries: copy(entries || []), base: null, conflicts: [], pendingResolution: null, revision: 0 });
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
    const content = entry => entry && ({ find: entry.find, replace: entry.replace, tlnote: entry.tlnote, alts: entry.alts.map(a => ({ find: a.find, replace: a.replace })) });
    const findKey = entry => entry.find.trim().toLowerCase();
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
    constructor({ store, merge, fetch: fetcher, apiBase, onChange, onStatus, uuid, locks }) {
      this.store = store; this.merge = merge; this.fetcher = fetcher;
      this.apiBase = apiBase.replace(/\/$/, '');
      this.onChange = onChange || (() => {}); this.onStatus = onStatus || (() => {});
      this.uuid = uuid || (() => crypto.randomUUID()); this.locks = locks;
      this.state = null; this.epoch = 0; this.timer = null; this.running = null;
      this.backoff = 1000; this.lastActivityRefresh = 0; this.destroyed = false;
      this.localQueue = Promise.resolve();
    }
    async initialize(legacy) {
      this.state = await this.store.updateHybridState(state => {
        if (!state) return initializeState(legacy);
        if (Object.hasOwn(state, 'unassignedDictionary')) {
          (state.profiles[state.activeProfile] || state.profiles.guest).unassignedDictionary = state.unassignedDictionary;
          delete state.unassignedDictionary;
        }
        return state;
      });
      this.notify();
      return this.snapshot();
    }
    snapshot() {
      const profile = this.state?.profiles[this.state.activeProfile];
      if (!profile) return null;
      const dictionary = profile.dictionaries[profile.settings.lang] || newDictionary();
      // Never expose a bearer token to reactive Vue state or exports.
      return { settings: copy(profile.settings), editorClipboard: profile.clipboard, dictionary: copy(dictionary.entries), conflicts: copy(dictionary.conflicts), revision: dictionary.revision, user: copy(this.state.auth?.user || null), signedIn: !!this.state.auth?.token, profileId: this.state.activeProfile, needsDictionaryLanguage: !!profile.unassignedDictionary?.length, recoveryCount: profile.recovery.length };
    }
    notify() { this.onChange(this.snapshot()); }
    status(message, error = false) { this.onStatus({ message, error }); }
    context() { return { epoch: this.epoch, profile: this.state.activeProfile, token: this.state.auth?.token, language: this.state.auth?.user?.language }; }
    current(ctx, state = this.state) { return !this.destroyed && ctx.epoch === this.epoch && state.activeProfile === ctx.profile && state.auth?.token === ctx.token; }
    async update(fn, ctx, notify = true) {
      this.state = await this.store.updateHybridState(state => {
        if (!ctx || this.current(ctx, state)) fn(state, state.profiles[state.activeProfile]);
        return state;
      });
      if (notify) this.notify();
    }
    saveLocal(payload, contextLanguage = payload.lang) {
      const requested = this.context();
      const snapshot = copy(payload);
      const operation = this.localQueue.catch(() => {}).then(() => {
        if (!this.current(requested)) return;
        return this.saveLocalNow(snapshot, contextLanguage);
      });
      this.localQueue = operation;
      return operation;
    }
    async saveLocalNow(payload, contextLanguage) {
      const ctx = this.context();
      const observed = copy(this.state.profiles[ctx.profile]);
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
            dictionary.entries = combined.entries;
          } else dictionary.entries = copy(payload.dictionary || []);
        }
      }, ctx, false);
      const latest = this.state.profiles[ctx.profile];
      if (!equal(latest.settings, preferences(payload)) || !equal(latest.dictionaries[contextLanguage]?.entries || [], payload.dictionary || [])) this.notify();
      this.status(this.state.auth?.token ? 'Saved locally · waiting to sync' : 'Saved in this browser');
      this.schedule();
    }
    async selectLanguage(language, payload, oldLanguage) {
      this.epoch++;
      const ctx = this.context();
      await this.update((state, profile) => {
        if (oldLanguage && profile.settings.lang === oldLanguage) {
          (profile.dictionaries[oldLanguage] ||= newDictionary()).entries = copy(payload.dictionary || []);
        }
        profile.settings = { ...preferences(payload), lang: language };
        if (profile.unassignedDictionary?.length && language) {
          const existing = profile.dictionaries[language];
          if (existing) {
            const remote = { entries: existing.entries, tombstones: existing.base?.tombstones || [], revision: existing.revision };
            const merged = this.merge.merge(null, profile.unassignedDictionary, remote);
            existing.entries = merged.entries;
            existing.conflicts = merged.conflicts;
            existing.base = preserveConflictBases(remote, merged.conflicts);
          } else profile.dictionaries[language] = newDictionary(profile.unassignedDictionary);
          profile.unassignedDictionary = null;
        }
        if (language) profile.dictionaries[language] ||= newDictionary();
      }, ctx);
      this.schedule(0);
    }
    async importLocal(payload) {
      validateImport(payload);
      payload = { ...copy(payload), editorRegexes: (payload.editorRegexes || []).map(row => ({ find: row.find, replace: row.replace })), dictionary: this.merge.normalizeEntries(payload.dictionary || []) };
      const ctx = this.context();
      await this.update((state, profile) => {
        profile.recovery.push({ at: Date.now(), reason: 'Before settings import', settings: copy(profile.settings), dictionaries: copy(profile.dictionaries), editorClipboard: profile.clipboard });
        profile.settings = preferences(payload);
        profile.clipboard = String(payload.editorClipboard || '');
        if (payload.lang) (profile.dictionaries[payload.lang] ||= newDictionary()).entries = copy(payload.dictionary || []);
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
      if (!this.current(ctx)) throw Object.assign(new Error('Account changed'), { stale: true });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      try {
        const response = await this.fetcher(this.apiBase + path, { method: options.method || 'GET', credentials: 'omit', cache: 'no-store', signal: controller.signal,
          headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(ctx.token ? { Authorization: 'Bearer ' + ctx.token } : {}) },
          ...(options.body ? { body: JSON.stringify(options.body) } : {}) });
        const data = response.status === 204 ? null : await response.json();
        if (!this.current(ctx)) throw Object.assign(new Error('Account changed'), { stale: true });
        if (!response.ok) {
          const error = Object.assign(new Error(data?.error?.message || 'Cloud request failed'), { status: response.status, code: data?.error?.code, current: data?.current });
          if (response.status === 401 && ctx.token) {
            await this.update(state => { state.auth = { ...state.auth, token: null }; }, ctx);
            this.status('Session expired. Sign in again; your local changes are safe.', true);
          }
          throw error;
        }
        return data;
      } finally { clearTimeout(timeout); }
    }
    async acceptLogin(result) {
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
        await this.update(state => { state.auth.user = result.user; state.auth.expiresAt = result.expiresAt; }, ctx);
        this.schedule(0);
      } catch (error) { this.lastActivityRefresh = 0; this.reportError(error); }
    }
    async logout() {
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
    async sync() {
      clearTimeout(this.timer);
      if (this.running) { this.resyncRequested = true; return this.running; }
      if (!this.state.auth?.token || this.destroyed) return;
      await this.localQueue.catch(() => {});
      if (this.running || !this.state.auth?.token || this.destroyed) return this.running;
      const ctx = this.context();
      const run = async () => {
        this.state = await this.store.getHybridState();
        if (!this.current(ctx)) { this.notify(); return; }
        const me = await this.request('/v1/me', {}, ctx);
        await this.update(state => { state.auth.user = me.user; state.auth.expiresAt = me.expiresAt; }, ctx, false);
        if (!me.user.language) { this.notify(); this.status('Not configured — awaiting admin language assignment'); return; }
        this.status('Syncing…');
        await this.syncSettings(ctx);
        if (!this.current(ctx)) return;
        const language = me.user.language;
        // Other language drafts stay completely local, including after reassignment.
        await this.syncDictionary(ctx, language);
        this.backoff = 1000;
        this.notify();
        const snapshot = this.snapshot();
        this.status(snapshot.conflicts.length ? 'Saved locally · dictionary conflicts need your choice' : (snapshot.settings.lang !== language ? 'Settings backed up · selected language is local only' : 'Backed up · ' + new Date().toLocaleTimeString()));
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
        }
        const remote = await this.request('/v1/settings', {}, ctx);
        await this.update((state, profile) => {
          if (!profile.settingsBase && remote.settings) {
            profile.recovery.push({ at: Date.now(), reason: 'Before first cloud restore', settings: copy(profile.settings), dictionaries: copy(profile.dictionaries), editorClipboard: profile.clipboard });
            profile.settings = preferences(remote.settings);
          } else if (profile.settingsBase) {
            profile.settings = mergeSettings(profile.settingsBase.settings, profile.settings, remote.settings || {});
          }
          profile.settingsBase = copy(remote);
        }, ctx, false);
        if (!this.current(ctx)) return;
        const profile = this.state.profiles[ctx.profile];
        const submitted = copy(profile.settings);
        if (remote.settings && equal(submitted, remote.settings)) return;
        try {
          const write = { baseRevision: remote.revision, mutationId: this.uuid(), settings: submitted };
          await this.update((state, latest) => { latest.settingsWrite = write; }, ctx, false);
          await this.sendSettingsWrite(ctx, write);
          return;
        } catch (error) { if (error.status !== 409 || attempt === 3) throw error; }
      }
    }
    async sendSettingsWrite(ctx, write) {
      try {
        const response = await this.request('/v1/settings', { method: 'PUT', body: write }, ctx);
        await this.update((state, profile) => {
          profile.settings = mergeSettings(write.settings, profile.settings, response.settings);
          profile.settingsBase = copy(response);
          if (profile.settingsWrite?.mutationId === write.mutationId) profile.settingsWrite = null;
        }, ctx, false);
      } catch (error) {
        if ([400, 409, 413, 422].includes(error.status)) await this.update((state, profile) => { profile.settingsWrite = null; }, ctx, false);
        throw error;
      }
    }
    async mergeRemote(ctx, language, remote, accepted, mutationId) {
      let result;
      await this.update((state, profile) => {
        const d = profile.dictionaries[language] ||= newDictionary();
        const baseline = accepted ? preserveConflictBases(accepted, d.conflicts) : d.base;
        result = this.merge.merge(baseline, d.entries, remote);
        const priorAutoMerged = (d.autoMergedIds || []).filter(id => !accepted || !d.pendingWrite?.request.upserts.some(e => e._id === id));
        d.autoMergedIds = autoMergedIds(this.merge, d.entries, remote, result, priorAutoMerged);
        d.entries = result.entries;
        d.conflicts = result.conflicts;
        d.base = preserveConflictBases(remote, result.conflicts);
        d.revision = remote.revision;
        if (mutationId && d.pendingWrite?.request.mutationId === mutationId) d.pendingWrite = null;
      }, ctx, false);
      return result;
    }
    async syncDictionary(ctx, language) {
      const path = '/v1/dictionaries/' + encodeURIComponent(language);
      for (let attempt = 0; attempt < 4; attempt++) {
        const historyRestore = this.state.profiles[ctx.profile].dictionaries[language]?.pendingHistoryRestore;
        if (historyRestore) await this.sendHistoryRestore(ctx, language, historyRestore);
        const pendingWrite = this.state.profiles[ctx.profile].dictionaries[language]?.pendingWrite;
        if (pendingWrite) {
          try { await this.sendDictionaryWrite(ctx, language, pendingWrite); }
          catch (error) { if (error.status !== 409) throw error; }
        }
        const pending = this.state.profiles[ctx.profile].dictionaries[language]?.pendingResolution;
        if (pending) await this.sendResolution(ctx, language, pending);
        const remote = await this.request(path, {}, ctx);
        const merged = await this.mergeRemote(ctx, language, remote);
        if (!merged || !this.current(ctx)) return;
        if (!merged.upserts.length && !merged.deletedIds.length) return;
        const automatic = new Set(this.state.profiles[ctx.profile].dictionaries[language].autoMergedIds || []);
        const origins = Object.fromEntries(merged.upserts.filter(entry => automatic.has(entry._id)).map(entry => [entry._id, 'auto_merge']));
        const request = { baseRevision: remote.revision, mutationId: this.uuid(), upserts: merged.upserts, deletedIds: merged.deletedIds, ...(Object.keys(origins).length ? { origins } : {}) };
        try {
          const write = { remote, request };
          await this.update((state, profile) => { profile.dictionaries[language].pendingWrite = write; }, ctx, false);
          await this.sendDictionaryWrite(ctx, language, write);
          return;
        } catch (error) { if (error.status !== 409 || attempt === 3) throw error; }
      }
    }
    async sendDictionaryWrite(ctx, language, write) {
      try {
        const response = await this.request('/v1/dictionaries/' + encodeURIComponent(language), { method: 'PATCH', body: write.request }, ctx);
        const accepted = acceptedSnapshot(write.remote, write.request.upserts, write.request.deletedIds, response.appliedRevision || response.revision);
        await this.mergeRemote(ctx, language, response, accepted, write.request.mutationId);
      } catch (error) {
        if ([400, 409, 413, 422].includes(error.status)) await this.update((state, profile) => { profile.dictionaries[language].pendingWrite = null; }, ctx, false);
        throw error;
      }
    }
    async resolveConflict(id, choices, revision) {
      const ctx = this.context();
      const language = this.state.profiles[ctx.profile].settings.lang;
      if (language !== this.state.auth?.user.language) throw new Error('This language is local only.');
      await this.update((state, profile) => {
        const d = profile.dictionaries[language];
        const conflict = d.conflicts.find(c => c.id === id);
        if (!conflict || d.revision !== revision) throw new Error('The dictionary changed. Review the current conflict again.');
        if (d.pendingResolution) throw new Error('A previous resolution is still waiting to sync. Retry sync first.');
        if (d.pendingHistoryRestore) throw new Error('A history restore is still waiting to sync. Retry sync first.');
        const entry = this.merge.resolve(conflict, choices);
        d.pendingResolution = { id, entry, originalLocal: copy(d.entries.find(e => e._id === id) || null), revision, mutationId: this.uuid(), origin: 'conflict_resolution' };
      }, ctx, false);
      await this.sendResolution(ctx, language, this.state.profiles[ctx.profile].dictionaries[language].pendingResolution);
      this.notify(); this.schedule(0);
    }
    async sendResolution(ctx, language, pending) {
      try {
        const response = await this.request('/v1/dictionaries/' + encodeURIComponent(language), { method: 'PATCH', body: { baseRevision: pending.revision, mutationId: pending.mutationId, upserts: pending.entry ? [pending.entry] : [], deletedIds: pending.entry ? [] : [pending.id], ...(pending.origin ? { origins: { [pending.id]: pending.origin } } : {}) } }, ctx);
        await this.update((state, profile) => {
          const d = profile.dictionaries[language];
          const current = d.entries.find(e => e._id === pending.id) || null;
          const rebased = this.merge.merge(
            { entries: pending.originalLocal ? [pending.originalLocal] : [], tombstones: [], revision: 0 },
            current ? [current] : [],
            { entries: pending.entry ? [pending.entry] : [], tombstones: pending.entry ? [] : [pending.id], revision: response.revision }
          );
          d.entries = d.entries.filter(e => e._id !== pending.id).concat(rebased.entries);
          d.conflicts = d.conflicts.filter(c => c.id !== pending.id).concat(rebased.conflicts);
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
      if (!ctx.token || !ctx.language) throw new Error('Sign in with an assigned language to view shared history.');
      return ctx;
    }
    assertHistoryContext(ctx) {
      if (!this.current(ctx) || this.state.auth?.user.language !== ctx.language) throw Object.assign(new Error('Account or assigned language changed. Open history again.'), { stale: true });
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
        if (existing?.pendingHistoryRestore || existing?.pendingWrite || existing?.pendingResolution) throw new Error('Another dictionary change is waiting to sync. Use Sync now, then review the history version again.');
        const event = await this.request(path + '/history/' + encodeURIComponent(eventId), {}, ctx);
        const remote = await this.request(path, {}, ctx);
        this.assertHistoryContext(ctx);
        if (remote.revision !== revision || event.currentRevision !== revision) throw Object.assign(new Error('The shared dictionary changed. Refresh the history preview before restoring.'), { status: 409 });
        if (event.action === 'baseline' && version === 'before') throw new Error('The version before history started is unavailable.');
        const entry = event[version];
        if (entry === undefined || (entry && entry._id !== event.entryId)) throw new Error('The selected history version is invalid.');
        await this.update((state, profile) => {
          this.assertHistoryContext(ctx);
          const d = profile.dictionaries[ctx.language] ||= newDictionary();
          profile.recovery.push({ at: Date.now(), reason: 'Before shared history restore', settings: copy(profile.settings), dictionaries: copy(profile.dictionaries), editorClipboard: profile.clipboard });
          d.pendingHistoryRestore = { id: event.entryId, eventId, entry: copy(entry), originalLocal: copy(d.entries.find(e => e._id === event.entryId) || null), request: { baseRevision: revision, mutationId: this.uuid(), version } };
        }, ctx, false);
        const pending = this.state.profiles[ctx.profile].dictionaries[ctx.language].pendingHistoryRestore;
        await this.sendHistoryRestore(ctx, ctx.language, pending);
        this.status('History version restored · other local edits will continue syncing');
        this.notify();
      };
      const operation = this.locks ? this.locks.request('sdeditor-cloud-sync', run) : run();
      this.running = operation.catch(() => {}).finally(() => { this.running = null; this.schedule(1000); });
      try { await operation; }
      catch (error) {
        if (error.stale || error.status || !this.state.profiles[ctx.profile]?.dictionaries[ctx.language]?.pendingHistoryRestore) throw error;
        throw new Error('Restore is saved locally but confirmation is pending. Use Sync now to retry safely. ' + error.message);
      }
    }
    async sendHistoryRestore(ctx, language, pending) {
      try {
        const response = await this.request('/v1/dictionaries/' + encodeURIComponent(language) + '/history/' + encodeURIComponent(pending.eventId) + '/restore', { method: 'POST', body: pending.request }, ctx);
        await this.update((state, profile) => {
          const d = profile.dictionaries[language];
          const current = d.entries.find(e => e._id === pending.id) || null;
          const rebased = this.merge.merge(
            { entries: pending.originalLocal ? [pending.originalLocal] : [], tombstones: [], revision: 0 },
            current ? [current] : [],
            { entries: pending.entry ? [pending.entry] : [], tombstones: pending.entry ? [] : [pending.id], revision: response.appliedRevision || response.revision }
          );
          d.entries = d.entries.flatMap(e => e._id === pending.id ? rebased.entries : [e]);
          if (!current) d.entries.push(...rebased.entries);
          d.conflicts = d.conflicts.filter(c => c.id !== pending.id).concat(rebased.conflicts);
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
    destroy() { this.destroyed = true; this.epoch++; clearTimeout(this.timer); }
  }
  return { Client, SETTING_KEYS, DEFAULT_SETTINGS, initializeState, mergeSettings, preferences, completeSettings, validateImport, preserveConflictBases, acceptedSnapshot };
});
