/* Read-only references inside the editor. The index reads saved/source descriptions,
 * never the open translation draft, and is built only for a nonempty search
 * while Lookup is visible. */
(() => {
  const PAGE_SIZE = 20;
  const SEARCH_DELAY = 250;
  const caches = new WeakMap();
  const languageCaches = new WeakMap();
  const raw = value => typeof Vue !== 'undefined' && Vue.toRaw ? Vue.toRaw(value) : value;
  const sessionFor = model => window.EditorReferenceCatalog?.sessionFor(model) || (typeof model.editorLookupSession === 'function'
    ? model.editorLookupSession() : { mode: 'statdescription', language: model.lang, scope: {},
      toolsVisible: !!(model.editorToolsVisible ?? model.editorSessionActive ?? model.editorVisible), tool: model.sideTab });
  const sessionKey = model => window.EditorReferenceCatalog?.contextKey(model) || JSON.stringify([sessionFor(model).mode, sessionFor(model).scope, sessionFor(model).language]);
  const lookupActive = model => { const session = sessionFor(model); return !!session.toolsVisible && session.tool === 'lookup'; };
  const componentRef = (model, name) => model.getEditorComponentRef?.(name) || model.$refs?.[name];
  const asLines = value => Array.isArray(value) ? value.map(line => String(line ?? '')) : [];
  const readableText = value => String(value ?? '').replace(/\\n/g, '\n').replace(/\r\n?/g, '\n');
  const compactText = (value, literal = false) => (literal ? String(value ?? '') : readableText(value)).replace(/\s+/gu, ' ').trim();
  const foldText = (value, literal = false) => compactText(value, literal).normalize('NFC').toLocaleLowerCase();
  const hasQuery = (model, value) => !!foldText(value, sessionFor(model).mode === 'clienttext' || !!model.lookupCatalogSources?.some(source => source.mode === 'clienttext'));
  // Use the editor's immutable-English detector for CT references too. Saved
  // targets never control visibility; SD Lookup keeps its existing behavior.
  const clientTextFieldVisible = (field, hideDNT) => !hideDNT
    || !!window.ClientTextUI?.isDNTSource && !window.ClientTextUI.isDNTSource(field?.source);
  const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

  function queryRanges(text, query, literal = false) {
    const needle = foldText(query, literal);
    if (!needle) return [];
    // Keep original offsets when normalization, case folding or whitespace
    // changes the length of the searchable text. Reference text stays literal.
    const chunks = [];
    for (const { segment, index } of graphemes.segment(text)) {
      let offset = index;
      for (const piece of segment.split(/(\s+)/u)) {
        if (!piece) continue;
        const end = offset + piece.length;
        if (/^\s+$/u.test(piece)) {
          if (chunks.at(-1)?.text === ' ') chunks.at(-1).end = end;
          else chunks.push({ text: ' ', start: offset, end });
        } else chunks.push({ text: piece.normalize('NFC'), start: offset, end });
        offset = end;
      }
    }
    if (chunks[0]?.text === ' ') chunks.shift();
    if (chunks.at(-1)?.text === ' ') chunks.pop();
    const folded = chunks.map(chunk => chunk.text).join('').toLocaleLowerCase();
    const starts = [], ends = [];
    for (const chunk of chunks) {
      for (let i = 0; i < chunk.text.toLocaleLowerCase().length; i++) {
        starts.push(chunk.start); ends.push(chunk.end);
      }
    }
    const ranges = [];
    let from = 0, match;
    while ((match = folded.indexOf(needle, from)) !== -1) {
      const start = starts[match], end = ends[match + needle.length - 1];
      const previous = ranges.at(-1);
      if (previous && start <= previous.end) previous.end = Math.max(previous.end, end);
      else ranges.push({ start, end });
      from = match + needle.length;
    }
    return ranges;
  }

  function textParts(text, ranges, start = 0, end = text.length) {
    const parts = [];
    let cursor = start;
    for (const range of ranges) {
      const first = Math.max(start, range.start), last = Math.min(end, range.end);
      if (first >= last) continue;
      if (first > cursor) parts.push({ text: text.slice(cursor, first), matched: false });
      parts.push({ text: text.slice(first, last), matched: true });
      cursor = last;
    }
    if (cursor < end) parts.push({ text: text.slice(cursor, end), matched: false });
    return parts;
  }

  function highlightParts(value, query) {
    const text = String(value ?? '');
    return textParts(text, queryRanges(text, query));
  }

  function excerptParts(value, query, limit = 150, matches = null, literal = false) {
    const text = compactText(value, literal);
    const ranges = matches || queryRanges(text, query, literal);
    const wantedStart = Math.max(0, (ranges[0]?.start || 0) - 35);
    const wantedEnd = Math.min(text.length, wantedStart + limit);
    let start = wantedStart, end = wantedEnd;
    // Excerpt edges must not split emoji, accents or other grapheme clusters.
    for (const { segment, index } of graphemes.segment(text)) {
      const next = index + segment.length;
      if (index <= wantedStart && next > wantedStart) start = index;
      if (index < wantedEnd && next >= wantedEnd) { end = next; break; }
    }
    const parts = textParts(text, ranges, start, end);
    if (start) parts.unshift({ text: '…', matched: false });
    if (end < text.length) parts.push({ text: '…', matched: false });
    return parts;
  }

  function buildIndex(descs, lang, workspace = null) {
    const saved = new Map((Array.isArray(workspace?.descs) ? workspace.descs : [])
      .filter(desc => desc && typeof desc.filepath === 'string').map(desc => [desc.filepath, desc]));
    const entries = [];
    for (const desc of Array.isArray(descs) ? descs : []) {
      if (!desc || typeof desc.filepath !== 'string' || !desc.filepath) continue;
      const english = asLines(desc.translations?.English).map(readableText).join('\n');
      const local = saved.get(desc.filepath);
      const savedLines = local?.translations?.[lang];
      const translation = asLines(Array.isArray(savedLines) ? savedLines : desc.translations?.[lang])
        .map(readableText).join('\n');
      const stats = asLines(desc.stats);
      entries.push({
        desc, local, filepath: desc.filepath,
        filename: String(desc.filename || desc.filepath.split('/').pop()),
        pathText: foldText([desc.filepath, ...stats].join('\n')),
        englishText: foldText(english), translationText: foldText(translation),
        english, translation,
      });
    }
    return entries;
  }

  function searchIndex(index, query, scope = 'all', translatedOnly = false, mixed = false) {
    const needle = foldText(query);
    const literalNeedle = foldText(query, true);
    if (!needle && (!mixed || !literalNeedle)) return [];
    return index.filter(entry => {
      const wanted = entry.literal ? literalNeedle : needle;
      if (!wanted) return false;
      if (translatedOnly && !entry.translationText) return false;
      if (scope === 'path' || scope === 'metadata') return entry.pathText.includes(wanted);
      if (scope === 'english') return entry.englishText.includes(wanted);
      if (scope === 'translation') return entry.translationText.includes(wanted);
      return entry.pathText.includes(wanted) || entry.englishText.includes(wanted)
        || entry.translationText.includes(wanted);
    });
  }

  function buildReference(desc, lang, local = null) {
    if (!desc) return null;
    const english = asLines(desc.translations?.English);
    const savedLines = local?.translations?.[lang];
    const translation = asLines(Array.isArray(savedLines) ? savedLines : desc.translations?.[lang]);
    const blocks = Array.from({ length: Math.max(english.length, translation.length) }, (_, index) => {
      const source = readableText(english[index]);
      const target = readableText(translation[index]);
      return {
        index, english: source, translation: target,
        isTable: source.includes('@'),
        englishColumns: source.split('@'), translationColumns: target.split('@'),
        variables: String(desc.variables?.[index] ?? ''),
        remark: String(desc.remarks?.[index] ?? ''),
      };
    });
    return {
      filepath: desc.filepath, filename: String(desc.filename || desc.filepath.split('/').pop()),
      lang, stats: asLines(desc.stats), isDNT: !!desc.isDNT, blocks,
    };
  }

  function buildCatalogIndex(sources, lang, options = {}) {
    const output = [];
    for (const source of sources || []) {
      const scope = window.EditorReferenceCatalog?.scopeKey(source.scope) || JSON.stringify(source.scope || {});
      const common = { mode: source.mode, groupId: source.groupId || '', groupLabel: source.groupLabel || '', language: source.language || lang };
      if (source.mode !== 'clienttext') {
        for (const entry of buildIndex(source.descs, lang, source.workspace)) output.push({ ...entry, ...common,
          key: JSON.stringify(['statdescription', scope, entry.filepath]), metadata: asLines(entry.desc.stats).join(' ') });
        continue;
      }
      if (source.language !== lang) continue;
      const contextReferences = source.contextReferences
        ?? window.ContentAdapters?.clienttext?.cachedContextReferenceIndex?.(source.units);
      for (const unit of source.units || []) {
        const values = window.ContentAdapters?.clienttext?.values(unit, source.saved?.[unit.id])
          || window.ClientTextState?.valuesFor(unit, source.saved?.[unit.id]) || { ...Object.fromEntries((unit.fields || []).map(field => [field.id, field.target])), ...source.saved?.[unit.id]?.values };
        const referenceMetadata = window.ContentAdapters?.clienttext?.referenceMetadata(unit, contextReferences, {game:source.scope?.game}) || [];
        for (const field of unit.fields || []) {
          if (!clientTextFieldVisible(field, options.hideDNT)) continue;
          const filepath = [unit.role, unit.sheet, unit.recordId, field.name || field.id, field.form].filter(value => value != null && value !== '').join(' · ');
          const english = String(field.source ?? ''), translation = String(values[field.id] ?? '');
          const metadata = [unit.id, field.id, field.kind,
            ...Object.entries(unit.metadata || {}).flatMap(([name, value]) => [name, String(value ?? '')]),
            unit.developerNotes].filter(Boolean).join(' ');
          const reference = { ...common, filepath, filename: String(unit.recordId), lang, stats: [], isDNT: false,
            referenceMetadata,
            developerNotes: String(unit.developerNotes ?? ''), blocks: [{ index: 0, fieldId: field.id,
              label: [field.name || field.id, field.form].filter(Boolean).join(' · '), kind: field.kind, form: field.form,
              english, translation, isTable: false, englishColumns: [english], translationColumns: [translation] }] };
          output.push({ ...common, key: JSON.stringify(['clienttext', scope, unit.id, field.id]),
            filepath, filename: String(unit.recordId), unit, field, metadata, reference,
            literal: true, english, translation, pathText: foldText(filepath + ' ' + metadata, true),
            englishText: foldText(english, true), translationText: foldText(translation, true) });
        }
      }
    }
    return output;
  }

  const mixin = {
    data() {
      return {
        lookupQuery: '', lookupAppliedQuery: '', lookupLanguage: '', lookupScope: 'all', lookupTranslatedOnly: false,
        lookupPage: 1, lookupPageSize: PAGE_SIZE, lookupSelectedFilepath: '', lookupRevision: 0,
        lookupModeFilter: 'all', lookupGroupFilter: '', lookupCatalogSources: [], lookupCatalogGroups: [],
        lookupMissingReferences: [], lookupPreparing: false, lookupPreparationError: '', lookupCatalogKey: '',
        lookupFiltersVisible: false, lookupCopyStatus: '',
      };
    },
    computed: {
      lookupSessionKey() { return sessionKey(this); },
      lookupPanelActive() { return lookupActive(this); },
      lookupSelectedKey() { return this.lookupSelectedFilepath; },
      lookupGroups() { return this.lookupCatalogGroups; },
      lookupPreparationAvailable() { return this.lookupMissingReferences.length > 0 && !!this.managedOnlineAvailable; },
      lookupMissingReferenceCount() { return this.lookupMissingReferences.length; },
      lookupActiveLanguage() { return this.lookupLanguage || sessionFor(this).language || this.lang || ''; },
      lookupHasAppliedQuery() { return hasQuery(this, this.lookupAppliedQuery); },
      lookupLanguages() {
        const source = this.descs, workspace = this.localDescs, lang = this.lang;
        let cache = languageCaches.get(this);
        const sameSource = cache && cache.source === source && cache.workspace === workspace && cache.lang === lang;
        if (cache && !sameSource) languageCaches.delete(this);
        // Vue evaluates watched computeds even when the v-show panel is hidden.
        // Keep its last complete choices without reading the reactive corpus.
        if (!lookupActive(this)) return sameSource ? cache.languages : lang && lang !== 'English' ? [lang] : [];
        const revision = this.lookupRevision;
        if (sameSource && cache.revision === revision) return cache.languages;
        const languages = new Set(lang && lang !== 'English' ? [lang] : []);
        for (const item of this.lookupCatalogSources || []) if (item.language && item.language !== 'English') languages.add(item.language);
        for (const group of window.EditorReferenceCatalog?.groupsFor(this, sessionFor(this)) || []) {
          if (group.language && group.language !== 'English') languages.add(group.language);
          for (const team of group.teams || []) if (team.language && team.language !== 'English'
            && (!this.cloudSignedIn || this.cloudCanAccessAllLanguages || team.language === this.cloudUser?.language)) languages.add(team.language);
        }
        const saved = new Map();
        const localDescs = raw(raw(workspace)?.descs);
        for (const value of Array.isArray(localDescs) ? localDescs : []) {
          const desc = raw(value);
          if (desc?.filepath) saved.set(desc.filepath, desc);
        }
        // Committed workspace/source invalidations advance lookupRevision.
        // Read raw rows here so hidden typing cannot register thousands of
        // deep dependencies or copy every translation object's values.
        for (const value of sessionFor(this).mode === 'clienttext' ? [] : Array.isArray(source) ? raw(source) : []) {
          const desc = raw(value);
          const original = raw(desc?.translations) || {};
          const overlay = raw(saved.get(desc?.filepath)?.translations) || {};
          for (const language of new Set([...Object.keys(original), ...Object.keys(overlay)])) {
            if (language === 'English') continue;
            const lines = raw(Object.prototype.hasOwnProperty.call(overlay, language) ? overlay[language] : original[language]);
            if (Array.isArray(lines) && lines.length) languages.add(language);
          }
        }
        cache = { source, workspace, lang, revision,
          languages: [...languages].sort((a, b) => a === lang ? -1 : b === lang ? 1 : a.localeCompare(b)) };
        languageCaches.set(this, cache);
        return cache.languages;
      },
      lookupResults() {
        // Wait for an applied nonempty query before indexing the corpus.
        if (!lookupActive(this) || !this.lookupHasAppliedQuery) return [];
        const revision = this.lookupRevision;
        const lang = this.lookupActiveLanguage;
        const source = this.descs;
        const workspace = this.localDescs;
        const catalog = this.lookupCatalogSources, key = sessionKey(this), hideDNT = !!this.hideDNT;
        let cache = caches.get(this);
        if (!cache || cache.source !== source || cache.workspace !== workspace
          || cache.lang !== lang || cache.revision !== revision || cache.catalog !== catalog || cache.key !== key || cache.hideDNT !== hideDNT) {
          const active = window.EditorReferenceCatalog?.activeSource(this, sessionFor(this), lang);
          // The active committed view can be replaced after a durable save.
          // Keep cached sibling groups while refreshing that live source only.
          const sources = catalog?.length && this.lookupCatalogKey === key
            ? catalog.map(item => active && item.groupId === active.groupId && item.mode === active.mode ? active : item)
            : active ? [active] : null;
          cache = { source, workspace, lang, revision, catalog, key, hideDNT,
            entries: sources ? buildCatalogIndex(sources, lang, {hideDNT}) : sessionFor(this).mode === 'clienttext' ? [] : buildIndex(source, lang, workspace) };
          cache.byPath = new Map(cache.entries.map(entry => [entry.key || entry.filepath, entry]));
          caches.set(this, cache);
        }
        return searchIndex(cache.entries, this.lookupAppliedQuery, this.lookupScope, this.lookupTranslatedOnly, true)
          .filter(entry => (!this.lookupModeFilter || this.lookupModeFilter === 'all' || (entry.mode || 'statdescription') === this.lookupModeFilter)
            && (!this.lookupGroupFilter || entry.groupId === this.lookupGroupFilter));
      },
      lookupResultCount() { return this.lookupResults.length; },
      lookupPageCount() { return Math.max(1, Math.ceil(this.lookupResultCount / this.lookupPageSize)); },
      lookupCurrentPage() { return Math.max(1, Math.min(this.lookupPage, this.lookupPageCount)); },
      lookupRangeLabel() {
        const total = this.lookupResultCount;
        const start = total ? (this.lookupCurrentPage - 1) * this.lookupPageSize + 1 : 0;
        const end = Math.min(this.lookupCurrentPage * this.lookupPageSize, total);
        return `${start.toLocaleString('en-US')}–${end.toLocaleString('en-US')} of ${total.toLocaleString('en-US')}`;
      },
      lookupVisibleResults() {
        const start = (this.lookupCurrentPage - 1) * this.lookupPageSize;
        const queryFor = scope => this.lookupScope === 'all' || this.lookupScope === scope ? this.lookupAppliedQuery : '';
        return this.lookupResults.slice(start, start + this.lookupPageSize).map(entry => {
          const englishParts = excerptParts(entry.english, queryFor('english'), 150, null, entry.literal);
          const translationParts = excerptParts(entry.translation, queryFor('translation'), 150, null, entry.literal);
          const statsText = compactText(entry.metadata || asLines(entry.desc?.stats).join(' '), entry.literal);
          const pathText = entry.filepath + ' ' + statsText;
          const pathRanges = queryRanges(pathText, queryFor('path') || queryFor('metadata'), entry.literal);
          const statsOffset = entry.filepath.length + 1;
          const statRanges = pathRanges.filter(range => range.end > statsOffset)
            .map(range => ({ start: Math.max(0, range.start - statsOffset), end: range.end - statsOffset }));
          const statsParts = excerptParts(statsText, '', 150, statRanges, entry.literal);
          return {
            key: entry.key || entry.filepath, mode: entry.mode || 'statdescription', groupId: entry.groupId || '', groupLabel: entry.groupLabel || '',
            filepath: entry.filepath, filename: entry.filename, isDNT: !!entry.desc?.isDNT,
            filepathParts: textParts(pathText, pathRanges, 0, entry.filepath.length),
            englishPreview: englishParts.map(part => part.text).join(''), englishParts,
            translationPreview: translationParts.map(part => part.text).join(''), translationParts,
            statsParts: statsParts.some(part => part.matched) ? statsParts : [],
          };
        });
      },
      lookupSelectedReference() {
        if (!lookupActive(this) || !this.lookupSelectedFilepath) return null;
        // Depend on the active index as well as the live text, so refreshed saved
        // translations update both matching results and the selected reference.
        this.lookupResults;
        const entry = caches.get(this)?.byPath.get(this.lookupSelectedFilepath);
        if (entry?.mode === 'clienttext' && !clientTextFieldVisible(entry.field, this.hideDNT)) return null;
        return entry?.reference || (entry ? { ...buildReference(entry.desc, this.lookupActiveLanguage, entry.local),
          mode: entry.mode || 'statdescription', groupId: entry.groupId || '', groupLabel: entry.groupLabel || '' } : null);
      },
    },
    watch: {
      descs() { this.invalidateEditorLookupIndex(); },
      localDescs() { this.invalidateEditorLookupIndex(); },
      lang() { this.invalidateEditorLookupIndex(); },
      hideDNT: {flush:'sync',handler() {
        const selected = caches.get(this)?.byPath.get(this.lookupSelectedFilepath);
        if (selected?.mode === 'clienttext' && !clientTextFieldVisible(selected.field, this.hideDNT)) this.lookupSelectedFilepath = '';
        this.invalidateEditorLookupIndex();
        if (lookupActive(this) && this.lookupSelectedFilepath
          && !this.lookupResults.some(entry => (entry.key || entry.filepath) === this.lookupSelectedFilepath)) this.lookupSelectedFilepath = '';
      }},
      lookupLanguage() { this.lookupCopyStatus = ''; this.lookupCancelPreparation(); this.lookupApplySearch(); this.lookupLoadCatalog(); },
      lookupSelectedFilepath() { this.lookupCopyStatus = ''; },
      lookupModeFilter() { this.lookupApplySearch(); },
      lookupGroupFilter() { this.lookupApplySearch(); },
      lookupSessionKey() { this.lookupCloseFilters(false); this.lookupCopyStatus = ''; this.lookupResetCatalog(); if (lookupActive(this)) this.lookupLoadCatalog(); },
      lookupPanelActive(active) { if (active) this.lookupLoadCatalog(); else this.lookupCloseFilters(false); },
      ctRevision() { this.invalidateEditorLookupIndex(); if (lookupActive(this) && !this.lookupPreparing) this.lookupLoadCatalog(); },
      lookupScope() { this.lookupApplySearch(); },
      lookupTranslatedOnly() { this.lookupApplySearch(); },
      lookupPageCount(count) {
        if (lookupActive(this)) this.lookupPage = Math.max(1, Math.min(this.lookupPage, count));
      },
      lookupLanguages(languages) {
        if (lookupActive(this) && this.lookupLanguage && !languages.includes(this.lookupLanguage)) this.lookupLanguage = '';
      },
      lookupResults(results) {
        if (lookupActive(this) && this.lookupSelectedFilepath
          && !results.some(entry => (entry.key || entry.filepath) === this.lookupSelectedFilepath)) this.lookupSelectedFilepath = '';
      },
    },
    beforeUnmount() { clearTimeout(this._editorLookupSearchTimer); this.lookupCancelPreparation(); this._editorReferenceCatalog?.dispose(); caches.delete(this); languageCaches.delete(this); },
    methods: {
      lookupRetainFocus(event, name = 'lookupFiltersButton') {
        if (lookupActive(this) && event?.currentTarget?.matches?.(':focus')) componentRef(this, name)?.focus({ preventScroll: true });
      },
      lookupCloseFilters(restoreFocus = true) {
        this.lookupFiltersVisible = false;
        if (restoreFocus && lookupActive(this)) componentRef(this, 'lookupFiltersButton')?.focus();
      },
      async lookupCopyText(text, label) {
        const scope = sessionKey(this), selected = this.lookupSelectedFilepath, language = this.lookupActiveLanguage;
        const current = () => lookupActive(this) && scope === sessionKey(this)
          && selected === this.lookupSelectedFilepath && language === this.lookupActiveLanguage;
        this.lookupCopyStatus = '';
        try {
          await window.navigator.clipboard.writeText(String(text ?? ''));
          if (current()) this.lookupCopyStatus = 'Copied ' + label + '.';
        } catch (error) {
          if (current()) this.lookupCopyStatus = 'Copy unavailable. Select the text and use your copy shortcut.';
        }
      },
      invalidateEditorLookupIndex() {
        caches.delete(this);
        this.lookupRevision++;
      },
      lookupResetCatalog() {
        clearTimeout(this._editorLookupSearchTimer); this._editorLookupSearchTimer = null;
        this.lookupCancelPreparation(); this._lookupCatalogRun = null; this._editorReferenceCatalog?.dispose();
        this.lookupCatalogSources = []; this.lookupCatalogGroups = []; this.lookupMissingReferences = [];
        this.lookupCatalogKey = ''; this.lookupSelectedFilepath = ''; this.lookupGroupFilter = ''; this.lookupPreparationError = '';
        this.invalidateEditorLookupIndex(); languageCaches.delete(this);
      },
      async lookupLoadCatalog(options = {}) {
        if (!window.EditorReferenceCatalog || !lookupActive(this)) return false;
        const session = sessionFor(this), key = sessionKey(this), language = this.lookupActiveLanguage;
        const run = this._lookupCatalogRun = {}, signal = options.signal;
        const current = () => this._lookupCatalogRun === run && sessionKey(this) === key && this.lookupActiveLanguage === language && !signal?.aborted;
        this._editorReferenceCatalog ||= window.EditorReferenceCatalog.create(this);
        try {
          const result = await this._editorReferenceCatalog.load(session, language, { ...options, current });
          if (!current()) return false;
          const mark = value => typeof Vue !== 'undefined' && Vue.markRaw ? Vue.markRaw(value) : value;
          this.lookupCatalogSources = mark(result.sources); this.lookupCatalogGroups = result.groups;
          this.lookupMissingReferences = result.missing; this.lookupCatalogKey = key;
          if (options.prepare || result.errors.length) this.lookupPreparationError = result.errors.join('\n');
          this.invalidateEditorLookupIndex(); languageCaches.delete(this);
          return !result.errors.length;
        } catch (error) {
          if (current() && !error.stale && error.name !== 'AbortError') this.lookupPreparationError = error.message;
          return false;
        }
      },
      async lookupPrepareReferences(event) {
        if (this.lookupPreparing || !this.lookupPreparationAvailable) return false;
        this.lookupRetainFocus(event);
        const aborter = this._lookupPreparationAbort = new AbortController(), key = sessionKey(this);
        this.lookupPreparing = true;
        const work = String(this._lookupPreparationSequence = (this._lookupPreparationSequence || 0) + 1);
        this.setBrowserWork?.('references', { key: work, label: 'Preparing reference originals', active: true, immediate: true });
        try { return await this.lookupLoadCatalog({ prepare: true, signal: aborter.signal }); }
        finally {
          this.setBrowserWork?.('references', { key: work, active: false });
          if (this._lookupPreparationAbort === aborter) {
            this._lookupPreparationAbort = null;
            if (key === sessionKey(this)) {
              const active = window.document?.activeElement;
              if (componentRef(this, 'lookupPreparation')?.contains(active)) this.lookupRetainFocus({ currentTarget: active });
              this.lookupPreparing = false;
            }
          }
        }
      },
      lookupCancelPreparation(event) {
        this.lookupRetainFocus(event);
        this._lookupPreparationAbort?.abort(); this._lookupPreparationAbort = null; this.lookupPreparing = false;
      },
      lookupSearchChanged() {
        clearTimeout(this._editorLookupSearchTimer);
        if (!hasQuery(this, this.lookupQuery)) {
          this.lookupApplySearch();
          return;
        }
        const key = sessionKey(this);
        this._editorLookupSearchTimer = setTimeout(() => { if (sessionKey(this) === key) this.lookupApplySearch(); }, SEARCH_DELAY);
      },
      lookupApplySearch() {
        clearTimeout(this._editorLookupSearchTimer);
        this._editorLookupSearchTimer = null;
        this.lookupAppliedQuery = this.lookupQuery;
        this.lookupPage = 1;
        if (lookupActive(this) && this.lookupSelectedFilepath
          && !this.lookupResults.some(entry => (entry.key || entry.filepath) === this.lookupSelectedFilepath)) this.lookupSelectedFilepath = '';
        const key = sessionKey(this);
        this.$nextTick(() => { const list = componentRef(this, 'lookupResultsList'); if (sessionKey(this) === key && list) list.scrollTop = 0; });
      },
      lookupSelect(filepath) {
        if (filepath === this.lookupSelectedFilepath || !this.lookupResults.some(entry => (entry.key || entry.filepath) === filepath)) return;
        this.lookupSelectedFilepath = filepath;
        const key = sessionKey(this);
        this.$nextTick(() => {
          const reference = componentRef(this, 'lookupReference');
          if (sessionKey(this) === key && this.lookupSelectedFilepath === filepath && reference) reference.scrollTop = 0;
        });
      },
      lookupGoToPage(value, event) {
        const page = Number(value);
        const next = Math.max(1, Math.min(this.lookupPageCount, Number.isFinite(page) ? Math.trunc(page) : 1));
        if (next === this.lookupPage) return;
        // A boundary arrow becomes disabled on this render. Move its focus
        // before that happens, so inline focusout cannot promote the draft.
        if (next === 1 || next === this.lookupPageCount) this.lookupRetainFocus(event, 'lookupResultsList');
        this.lookupPage = next;
        const key = sessionKey(this);
        this.$nextTick(() => { const list = componentRef(this, 'lookupResultsList'); if (sessionKey(this) === key && list) list.scrollTop = 0; });
      },
      lookupClearSearch() {
        this.lookupQuery = '';
        this.lookupApplySearch();
        this.lookupFocusSearch();
      },
      lookupFocusSearch() {
        const key = sessionKey(this);
        this.$nextTick(() => { if (sessionKey(this) === key) componentRef(this, 'lookupSearchInput')?.focus(); });
      },
    },
  };

  window.EditorLookup = { mixin, buildIndex, buildCatalogIndex, searchIndex, buildReference, highlightParts, excerptParts };
})();
