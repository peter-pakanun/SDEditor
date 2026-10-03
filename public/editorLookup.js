/* Read-only references inside the editor. The index reads saved/source descriptions,
 * never the open translation draft, and is built only while Lookup is visible. */
(() => {
  const PAGE_SIZE = 20;
  const SEARCH_DELAY = 120;
  const caches = new WeakMap();
  const asLines = value => Array.isArray(value) ? value.map(line => String(line ?? '')) : [];
  const readableText = value => String(value ?? '').replace(/\\n/g, '\n').replace(/\r\n?/g, '\n');
  const compactText = value => readableText(value).replace(/\s+/gu, ' ').trim();
  const foldText = value => compactText(value).normalize('NFC').toLocaleLowerCase();
  const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

  function queryRanges(text, query) {
    const needle = foldText(query);
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

  function excerptParts(value, query, limit = 150, matches = null) {
    const text = compactText(value);
    const ranges = matches || queryRanges(text, query);
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

  function searchIndex(index, query, scope = 'all') {
    const needle = foldText(query);
    if (!needle) return index;
    return index.filter(entry => {
      if (scope === 'path') return entry.pathText.includes(needle);
      if (scope === 'english') return entry.englishText.includes(needle);
      if (scope === 'translation') return entry.translationText.includes(needle);
      return entry.pathText.includes(needle) || entry.englishText.includes(needle)
        || entry.translationText.includes(needle);
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

  const mixin = {
    data() {
      return {
        lookupQuery: '', lookupAppliedQuery: '', lookupLanguage: '', lookupScope: 'all',
        lookupPage: 1, lookupPageSize: PAGE_SIZE, lookupSelectedFilepath: '', lookupRevision: 0,
      };
    },
    computed: {
      lookupActiveLanguage() { return this.lookupLanguage || this.lang || ''; },
      lookupLanguages() {
        // Only keys are inspected here. The text index remains lazy.
        this.lookupRevision;
        const languages = new Set(this.lang && this.lang !== 'English' ? [this.lang] : []);
        const saved = new Map((Array.isArray(this.localDescs?.descs) ? this.localDescs.descs : [])
          .filter(desc => desc?.filepath).map(desc => [desc.filepath, desc]));
        for (const desc of Array.isArray(this.descs) ? this.descs : []) {
          const translations = { ...desc?.translations, ...saved.get(desc?.filepath)?.translations };
          for (const [lang, lines] of Object.entries(translations)) {
            if (lang !== 'English' && Array.isArray(lines) && lines.length) languages.add(lang);
          }
        }
        return [...languages].sort((a, b) => a === this.lang ? -1 : b === this.lang ? 1 : a.localeCompare(b));
      },
      lookupResults() {
        // Closing the editor or using another side tab does no indexing work.
        if (!this.editorVisible || this.sideTab !== 'lookup') return [];
        const revision = this.lookupRevision;
        const lang = this.lookupActiveLanguage;
        const source = this.descs;
        const workspace = this.localDescs;
        let cache = caches.get(this);
        if (!cache || cache.source !== source || cache.workspace !== workspace
          || cache.lang !== lang || cache.revision !== revision) {
          cache = { source, workspace, lang, revision, entries: buildIndex(source, lang, workspace) };
          cache.byPath = new Map(cache.entries.map(entry => [entry.filepath, entry]));
          caches.set(this, cache);
        }
        return searchIndex(cache.entries, this.lookupAppliedQuery, this.lookupScope);
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
          const englishParts = excerptParts(entry.english, queryFor('english'));
          const translationParts = excerptParts(entry.translation, queryFor('translation'));
          const statsText = compactText(asLines(entry.desc.stats).join(' '));
          const pathText = entry.filepath + ' ' + statsText;
          const pathRanges = queryRanges(pathText, queryFor('path'));
          const statsOffset = entry.filepath.length + 1;
          const statRanges = pathRanges.filter(range => range.end > statsOffset)
            .map(range => ({ start: Math.max(0, range.start - statsOffset), end: range.end - statsOffset }));
          const statsParts = excerptParts(statsText, '', 150, statRanges);
          return {
            filepath: entry.filepath, filename: entry.filename, isDNT: !!entry.desc.isDNT,
            filepathParts: textParts(pathText, pathRanges, 0, entry.filepath.length),
            englishPreview: englishParts.map(part => part.text).join(''), englishParts,
            translationPreview: translationParts.map(part => part.text).join(''), translationParts,
            statsParts: statsParts.some(part => part.matched) ? statsParts : [],
          };
        });
      },
      lookupSelectedReference() {
        if (!this.editorVisible || this.sideTab !== 'lookup' || !this.lookupSelectedFilepath) return null;
        // Depend on the active index as well as the live text, so refreshed saved
        // translations update both matching results and the selected reference.
        this.lookupResults;
        const entry = caches.get(this)?.byPath.get(this.lookupSelectedFilepath);
        return buildReference(entry?.desc, this.lookupActiveLanguage, entry?.local);
      },
    },
    watch: {
      descs() { this.invalidateEditorLookupIndex(); },
      localDescs() { this.invalidateEditorLookupIndex(); },
      lang() { this.invalidateEditorLookupIndex(); },
      lookupLanguage() { this.lookupApplySearch(); },
      lookupScope() { this.lookupApplySearch(); },
      lookupPageCount(count) {
        if (this.editorVisible && this.sideTab === 'lookup') this.lookupPage = Math.max(1, Math.min(this.lookupPage, count));
      },
      lookupLanguages(languages) {
        if (this.lookupLanguage && !languages.includes(this.lookupLanguage)) this.lookupLanguage = '';
      },
      lookupResults(results) {
        if (this.editorVisible && this.sideTab === 'lookup' && this.lookupSelectedFilepath
          && !results.some(entry => entry.filepath === this.lookupSelectedFilepath)) this.lookupSelectedFilepath = '';
      },
    },
    beforeUnmount() { clearTimeout(this._editorLookupSearchTimer); caches.delete(this); },
    methods: {
      invalidateEditorLookupIndex() {
        caches.delete(this);
        this.lookupRevision++;
      },
      lookupSearchChanged() {
        clearTimeout(this._editorLookupSearchTimer);
        this._editorLookupSearchTimer = setTimeout(() => this.lookupApplySearch(), SEARCH_DELAY);
      },
      lookupApplySearch() {
        clearTimeout(this._editorLookupSearchTimer);
        this._editorLookupSearchTimer = null;
        this.lookupAppliedQuery = this.lookupQuery;
        this.lookupPage = 1;
        if (this.editorVisible && this.sideTab === 'lookup' && this.lookupSelectedFilepath
          && !this.lookupResults.some(entry => entry.filepath === this.lookupSelectedFilepath)) this.lookupSelectedFilepath = '';
        this.$nextTick(() => { if (this.$refs.lookupResultsList) this.$refs.lookupResultsList.scrollTop = 0; });
      },
      lookupSelect(filepath) {
        if (filepath === this.lookupSelectedFilepath || !this.lookupResults.some(entry => entry.filepath === filepath)) return;
        this.lookupSelectedFilepath = filepath;
        this.$nextTick(() => {
          if (this.lookupSelectedFilepath === filepath && this.$refs.lookupReference) this.$refs.lookupReference.scrollTop = 0;
        });
      },
      lookupGoToPage(value) {
        const page = Number(value);
        const next = Math.max(1, Math.min(this.lookupPageCount, Number.isFinite(page) ? Math.trunc(page) : 1));
        if (next === this.lookupPage) return;
        this.lookupPage = next;
        this.$nextTick(() => { if (this.$refs.lookupResultsList) this.$refs.lookupResultsList.scrollTop = 0; });
      },
      lookupClearSearch() {
        this.lookupQuery = '';
        this.lookupApplySearch();
        this.lookupFocusSearch();
      },
      lookupFocusSearch() {
        this.$nextTick(() => this.$refs.lookupSearchInput?.focus());
      },
    },
  };

  window.EditorLookup = { mixin, buildIndex, searchIndex, buildReference, highlightParts, excerptParts };
})();
