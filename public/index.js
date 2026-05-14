let offlineStoreReady = false;

const urlParams = new URLSearchParams(window.location.search);
const TEST_MODE = (() => {
  if (!urlParams.has('testMode')) return false;
  let v = (urlParams.get('testMode') || '').toLowerCase();
  return v === '' || v === '1' || v === 'true' || v === 'yes';
})();
const URL_LANG = urlParams.get('lang');
const ZIP_TXT_FILE_COUNT_THRESHOLD = 5000;

/** BCP 47 tags for <input>/<textarea lang> so the browser spellchecker matches Settings → language. */
const SETTINGS_LANG_TO_BCP47 = {
  Thai: "th",
  Portuguese: "pt",
  German: "de",
  Russian: "ru",
  Spanish: "es",
  French: "fr",
  "Traditional Chinese": "zh-Hant",
  "Simplified Chinese": "zh-Hans",
  Korean: "ko",
  Japanese: "ja",
};

/** CSS font-family stacks */
const GAME_PREVIEW_FONT_STACKS = {
  Thai: '"Kanit", sans-serif',
  "Traditional Chinese": '"Noto Sans TC", sans-serif',
  "Simplified Chinese": '"Noto Sans SC", sans-serif',
  Korean: '"Spoqa Han Sans Neo", "Noto Sans KR", sans-serif',
  Japanese: '"Koruri Regular", "Koruri", "Noto Sans JP", sans-serif',
  Spanish: '"Fontin Smallcaps", "Fontin", "Noto Serif", serif',
  French: '"Friz Quadrata ITC", "Friz Quadrata", "Fontin Smallcaps", "Fontin", Georgia, serif',
  Portuguese: '"Friz Quadrata ITC", "Friz Quadrata", "Fontin Smallcaps", "Fontin", Georgia, serif',
  German: '"Friz Quadrata ITC", "Friz Quadrata", "Fontin Smallcaps", "Fontin", Georgia, serif',
  Russian: '"Friz Quadrata ITC", "Friz Quadrata", "Fontin Smallcaps", "Fontin", Georgia, serif',
};

const config = Vue.defineComponent({
  data() {
    return {
      offlineStoreReady: false,
      testMode: TEST_MODE,
      langs: [
        "Thai",
        "Portuguese",
        "German",
        "Russian",
        "Spanish",
        "French",
        "Traditional Chinese",
        "Simplified Chinese",
        "Korean",
        "Japanese",
      ],
      lang: "",
      theme: 'grey',
      showSetting: false,
      needsInitialSettings: true,
      loadingProgress: 0.001,
      descs: [],
      localDescs: {
        descs: [],
        lastModified: 0,
        size: 0,
        status: {}
      },
      sourceLoaded: false,
      filteredDescs: [],
      statistic: {
        hasChanges: 0,
        isMissing: 0,
        needsReview: 0
      },
      currentSort: "english",
      currentSortDir: 'asc',
      currentSortIcon: '▲',
      pageSize: 20,
      paginationPadding: 2,
      currentPage: 1,
      searchText: "",
      filterSelect: "new",
      hideDNT: true,
      highlightDict: true,
      shiftEnterSave: false,
      uiDensity: 'compact',

      sideTab: 'dictionary',
      dictionaryFilter: '',
      regexFilter: '',
      dictionaryFlashId: '',

      importDialogVisible: false,

      historyItems: [],
      historyLoading: false,
      historySelectedA: null,
      historySelectedB: null,
      historyDiffHtml: '',
      historyFilepath: '',
      historyLang: '',
      historyMode: 'translation',

      editorVisible: false,
      editorCurrentEditingDesc: null,
      editorFocusedIndex: 0,
      editorOriginalTranslations: [],
      editorShowEnglishDiff: false,
      editorCompareActive: false,
      editorCompareMode: 'translation',
      editorCompareTitle: '',
      hlPopup: {
        visible: false,
        editorIndex: 0,
        openedByBracket: false,
        items: [],
        filtered: [],
        filter: "",
        selectedIndex: 0,
        x: 0,
        y: 0,
        width: 0
      },
      editorBlocks: [
        {
          english: "+1 to Maximum [EnergyShield|Energy Shield] per {0} [ItemEvasion|Item Evasion] on Equipped Body Armour",
          englishHLter: "+1 to Maximum <span>[EnergyShield|Energy Shield]</span> per <span>{0}%</span> <span>[ItemEvasion|Item Evasion]</span> on Equipped Body Armour",
          englishDiffHtml: "",
          translation: "",
          metaLinesEn: 0,
          metaLinesTr: 0,
          metaVarsEn: 0,
          metaVarsTr: 0,
          metaKwEn: 0,
          metaKwTr: 0,
          translationReplace: "",
          words: []
        },
      ],
      editorRegexes: [
        {
          find: "(.+) per (\\d+%) \\b(.+)\\b Quality",
          replace: "$R1 ต่อคุณภาพของ $3 ทุกๆ $2"
        },
        {
          find: "Buff Grants (.+)",
          replace: "บัฟมอบม็อด $R1"
        },
        {
          find: "([^ ]+) (increased|reduced) \\b(.+)\\b Damage",
          replace: "$2ความเสียหาย $3 $1"
        }
      ],
      dictionary: [
        {
          find: "Fire",
          replace: "ไฟ"
        },
      ],
      editorClipboard: "",

      gamePreviewFrame: "m",
      gamePreviewFonts: null,
      previewGggVars: {},
      gamePreviewSegments: []
    }
  },
  async mounted() {
    if (this.testMode) {
      this.lang = (URL_LANG && this.langs.includes(URL_LANG)) ? URL_LANG : (this.langs[0] || "Thai");
      this.needsInitialSettings = false;
      this.loadingProgress = 0;
      this.ensureDictionaryIds();
      document.addEventListener('keydown', this.handleKeydown);
      this.loadDummyData();
      return;
    }

    const canUseOfflineStore = !!(window.OfflineStore && typeof window.OfflineStore.isAvailable === 'function' && window.OfflineStore.isAvailable());
    if (!canUseOfflineStore) {
      alert('This app requires IndexedDB for offline storage, but your browser does not support it.');
      return;
    }

    this.loadingProgress = 0;

    try {
      await window.OfflineStore.migrateFromLocalStorageIfNeeded();
    } catch (_) {
    }

    let settings;
    try {
      settings = await window.OfflineStore.getSettings();
      console.log('settings inside OfflineStore:', settings);
    } catch (_) {
    }
    if (settings) this.importSettings(settings);


    let localDescs;
    try {
      localDescs = await window.OfflineStore.getWorkspace();
    } catch (_) {
    }
    if (localDescs) this.localDescs = localDescs;
    this.ensureLocalDescsReady();

    this.needsInitialSettings = !this.lang;

    let source;
    try {
      source = await window.OfflineStore.getSource();
    } catch (_) {
    }
    if (Array.isArray(source) && source.length > 0) {
      this.descs = source;
      this.sourceLoaded = true;
      this.applyWorkspaceOverlay();
      this.filterDesc();
      this.loadingProgress = 99.999;
    }

    if (!this.sourceLoaded) this.loadingProgress = 0;
    offlineStoreReady = true;
    this.offlineStoreReady = true;
    this.ensureDictionaryIds();
    document.addEventListener('keydown', this.handleKeydown);

    await this.saveSettings();
    if (this.sourceLoaded) this.loadingProgress = 100;
  },
  beforeDestroy() {
    document.removeEventListener('keydown', this.handleKeydown);
  },
  watch: {
    hideDNT() {
      this.saveSettings();
    },
    highlightDict() {
      this.saveSettings();
      this.scheduleEditorHLterRefresh();
    },
    "hlPopup.visible"() {
      this.$nextTick(() => this.syncHlPopupEnglishHighlight());
    },
    "hlPopup.selectedIndex"() {
      this.$nextTick(() => this.syncHlPopupEnglishHighlight());
    },
    "hlPopup.editorIndex"() {
      this.$nextTick(() => this.syncHlPopupEnglishHighlight());
    },
    shiftEnterSave() {
      this.saveSettings();
    },
    lang() {
      if (this.sourceLoaded) {
        this.applyWorkspaceOverlay();
        this.filterDesc();
      }
      if (this.sideTab === 'history') this.refreshHistory();
    },
    sideTab() {
      if (this.sideTab === 'history') this.refreshHistory();
    },
    theme(newTheme) {
      document.documentElement.setAttribute('data-theme', newTheme);
      this.saveSettings();
    },
    filterSelect() {
      this.filterDesc();
    },
    editorClipboard() {
      this.saveSettings();
    },
    dictionary: {
      deep: true,
      handler() {
        this.saveSettings();
        this.scheduleEditorHLterRefresh();
      }
    }
  },
  computed: {
    needsPostMigrationImport() {
      if (this.sourceLoaded) return false;
      const ws = this.localDescs?.descs;
      if (!Array.isArray(ws) || ws.length === 0) return false;
      for (const d of ws) {
        if (!d || typeof d !== 'object') continue;
        const translations = d.translations;
        if (!translations || typeof translations !== 'object') continue;
        if (this.lang) {
          const lines = translations[this.lang];
          if (Array.isArray(lines) && lines.some(v => String(v ?? '').trim() !== '')) return true;
        }
        for (const k of Object.keys(translations)) {
          if (k === 'English') continue;
          const lines = translations[k];
          if (Array.isArray(lines) && lines.some(v => String(v ?? '').trim() !== '')) return true;
        }
      }
      return false;
    },
    /** BCP 47 tag for translation `<input>` / `<textarea>` `lang` (browser spellcheck follows this in Chromium). */
    translationEditorBcp47() {
      if (!this.lang) return undefined;
      const code = SETTINGS_LANG_TO_BCP47[this.lang];
      return code || undefined;
    },
    pageCount() {
      return Math.ceil(this.filteredDescs.length / this.pageSize);
    },
    pageButtons() {
      let start = this.currentPage - this.paginationPadding;
      let end = this.currentPage + this.paginationPadding;
      while (start < 1) {
        start++;
        end++;
      }
      while (end > this.pageCount) {
        start--;
        end--;
      }
      if (start < 1) start = 1;
      let btns = [];
      for (let i = start; i <= end; i++) {
        btns.push(i);
      }
      return btns;
    },
    descsDisplay() {
      descsToDisplay = this.filteredDescs.sort((a, b) => {
        let modifier = 1;
        this.currentSortIcon = '▲';
        if (this.currentSortDir === 'desc') {
          modifier = -1;
          this.currentSortIcon = '▼';
        }
        if (a[this.currentSort] < b[this.currentSort]) return -1 * modifier;
        if (a[this.currentSort] > b[this.currentSort]) return 1 * modifier;
        return 0;
      });
      descsToDisplay = descsToDisplay.filter((row, index) => {
        let start = (this.currentPage - 1) * this.pageSize;
        let end = this.currentPage * this.pageSize;
        if (index >= start && index < end) return true;
      });
      return descsToDisplay;
    },
    foundDictionarySet() {
      if (!this.editorVisible) return new Set();
      let set = new Set();
      for (const editorBlock of this.editorBlocks || []) {
        for (const hl of editorBlock?.HLs || []) {
          if (Array.isArray(hl?.dictIds)) {
            for (const id of hl.dictIds) {
              if (id) set.add(id);
            }
          }
          if (hl?.dictId) set.add(hl.dictId);
        }
      }
      return set;
    },
    foundDictionaryDefMap() {
      if (!this.editorVisible) return new Map();
      let map = new Map();
      for (const editorBlock of this.editorBlocks || []) {
        for (const hl of editorBlock?.HLs || []) {
          let dictId = hl?.dictId;
          let def = (hl?.dictDefFind || "").trim();
          if (!dictId || !def) continue;
          let key = String(dictId);
          let set = map.get(key);
          if (!set) {
            set = new Set();
            map.set(key, set);
          }
          set.add(def.toLowerCase());
        }
      }
      return map;
    },
    filteredDictionary() {
      let dictionary = this.dictionary || [];
      let f = (this.dictionaryFilter || "").trim().toLowerCase();
      let list;
      if (!f) {
        list = dictionary.slice();
      } else {
        list = dictionary.filter(word => {
        let find = (word?.find || "").toLowerCase();
        let replace = (word?.replace || "").toLowerCase();
        let alts = "";
        if (Array.isArray(word?.alts)) {
          alts = word.alts.map(a => {
            if (!a) return "";
            if (typeof a !== "object") return "";
            return `${a.find || ""} ${a.replace || ""}`;
          }).join(" ");
        }
        alts = String(alts || "").toLowerCase();
        let tlnote = String(word?.tlnote || "").toLowerCase();
        return find.includes(f) || replace.includes(f) || alts.includes(f) || tlnote.includes(f) || `${find} ${replace} ${alts} ${tlnote}`.includes(f);
        });
      }

      let foundSet = this.foundDictionarySet;
      if (!foundSet || foundSet.size <= 0) return list;

      let indexMap = new Map();
      for (let i = 0; i < dictionary.length; i++) indexMap.set(dictionary[i], i);
      return list.sort((a, b) => {
        let aFound = foundSet.has(a?._id) ? 1 : 0;
        let bFound = foundSet.has(b?._id) ? 1 : 0;
        if (aFound !== bFound) return bFound - aFound;
        return (indexMap.get(a) ?? 0) - (indexMap.get(b) ?? 0);
      });
    },
    filteredRegexes() {
      let f = (this.regexFilter || "").trim().toLowerCase();
      if (!f) return this.editorRegexes || [];
      return (this.editorRegexes || []).filter(regex => {
        let find = (regex?.find || "").toLowerCase();
        let replace = (regex?.replace || "").toLowerCase();
        return find.includes(f) || replace.includes(f) || `${find} ${replace}`.includes(f);
      });
    },
    gamePreviewFontFamily() {
      return this.getGamePreviewFontFamily(this.lang);
    },
    gamePreviewVarKeyList() {
      let seen = new Set();
      let out = [];
      for (const seg of this.gamePreviewSegments || []) {
        if (seg?.type !== "var") continue;
        let k = String(seg.key ?? "");
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(k);
      }
      return out;
    }
  },
  methods: {
    toPlainForStorage(v) {
      try {
        if (typeof structuredClone === 'function') return structuredClone(v);
      } catch (_) {
      }
      try {
        return JSON.parse(JSON.stringify(v));
      } catch (_) {
        return null;
      }
    },
    getGamePreviewFontFamily(lang) {
      let map = this.gamePreviewFonts;
      if (map && typeof map === "object" && !Array.isArray(map) && lang && map[lang]) {
        return String(map[lang]);
      }
      if (lang && Object.prototype.hasOwnProperty.call(GAME_PREVIEW_FONT_STACKS, lang)) {
        return GAME_PREVIEW_FONT_STACKS[lang];
      }
      return '"Fontin", "Noto Serif", serif';
    },
    defaultPreviewVarValue(key) {
      let k = String(key ?? "");
      if (k === "") return "?";
      if (/^\d+$/.test(k)) return k;
      return k;
    },
    mergePreviewGggVars(keysOrder) {
      let prev = this.previewGggVars && typeof this.previewGggVars === "object" ? this.previewGggVars : {};
      let next = {};
      for (let i = 0; i < (keysOrder || []).length; i++) {
        let k = keysOrder[i];
        let ks = String(k);
        if (Object.prototype.hasOwnProperty.call(prev, ks)) {
          next[ks] = prev[ks];
        } else {
          next[ks] = this.defaultPreviewVarValue(ks);
        }
      }
      this.previewGggVars = next;
    },
    buildGamePreviewSegments(decodedString) {
      let s = String(decodedString ?? "");
      let kwRe = new RegExp("^" + keywordPopupTagRegex, "i");
      let gggRe = new RegExp("^" + gggVarTagRegex, "i");
      let segments = [];
      let keysOrder = [];
      let keySeen = new Set();
      let i = 0;
      let textBuf = "";
      let flushText = () => {
        if (textBuf) {
          segments.push({ type: "text", text: textBuf });
          textBuf = "";
        }
      };
      while (i < s.length) {
        let slice = s.slice(i);
        let km = kwRe.exec(slice);
        if (km && km.index === 0) {
          flushText();
          let tagName = String(km[2] ?? "").trim();
          let dynamicContent = String(km[3] ?? "").trim();
          let display = dynamicContent || tagName;
          segments.push({ type: "kw", text: display });
          i += km[0].length;
          continue;
        }
        if (s[i] === '@') {
          flushText();
          segments.push({ type: "rightAlign" });
          i++;
          continue;
        }
        if (s[i] === '\n') {
          flushText();
          segments.push({ type: "break" });
          i++;
          continue;
        }
        let gm = gggRe.exec(slice);
        if (gm && gm.index === 0) {
          flushText();
          let full = gm[0];
          let key = typeof getGggVarIdentityKey === "function" ? getGggVarIdentityKey(full) : full;
          let ks = String(key);
          if (!keySeen.has(ks)) {
            keySeen.add(ks);
            keysOrder.push(ks);
          }
          let trailingPercent = full.endsWith("%");
          segments.push({ type: "var", key: ks, trailingPercent });
          i += full.length;
          continue;
        }
        textBuf += s[i];
        i++;
      }
      flushText();
      return { segments, keysOrder };
    },
    refreshGamePreview() {
      if (!this.editorVisible) return;
      let block = this.editorBlocks?.[this.editorFocusedIndex];
      let raw = block?.translation ?? "";
      let decoded = this.decodeEscapedNewlines(raw);
      let { segments, keysOrder } = this.buildGamePreviewSegments(decoded);
      this.mergePreviewGggVars(keysOrder);
      this.gamePreviewSegments = segments;
    },
    setGamePreviewFrame(v) {
      if (v !== "s" && v !== "m" && v !== "l") return;
      this.gamePreviewFrame = v;
      this.saveSettings();
    },
    ensureLocalDescsReady() {
      if (!this.localDescs || typeof this.localDescs !== 'object') {
        this.localDescs = { descs: [], lastModified: 0, size: 0, status: {} };
      }
      if (!Array.isArray(this.localDescs.descs)) this.localDescs.descs = [];
      if (!this.localDescs.status || typeof this.localDescs.status !== 'object') this.localDescs.status = {};
    },
    async settingsSaveClose() {
      if (!this.lang) {
        alert('Please select a language.');
        return;
      }
      await this.saveSettings();
      this.needsInitialSettings = false;
      this.showSetting = false;
    },
    toggleEditorEnglishDiff() {
      this.editorShowEnglishDiff = !this.editorShowEnglishDiff;
      if (this.editorShowEnglishDiff) this.prepareEditorEnglishDiff();
    },
    async confirmTranslationUnchanged() {
      const desc = this.editorCurrentEditingDesc;
      if (!desc || !desc.needsReview) return;
      const msg =
        "Confirm that the translation does NOT need changes for this source revision?\n\n" +
        "This will clear the Needs Review flag for this file.\n" +
        "Only do this if you're sure the English changes don't affect the translation.";
      if (!confirm(msg)) return;

      desc.needsReview = false;
      this.editorShowEnglishDiff = false;
      this.ensureLocalDescsReady();
      const st = this.localDescs.status[desc.filepath] || {};
      st.needsReview = false;
      st.reviewedAt = Date.now();
      st.reviewedReason = 'confirmed-unchanged';
      this.localDescs.status[desc.filepath] = st;

      const localDesc = (this.localDescs.descs || []).find(o => o && o.filepath == desc.filepath);
      if (localDesc) {
        localDesc.hasChanges = true;
        desc.hasChanges = true;
      }

      await this.saveLocalDescs();
      this.filterDesc();
      alert('Marked as reviewed (unchanged).');
    },
    async prepareEditorEnglishDiff() {
      if (!this.editorVisible) return;
      if (!this.editorCurrentEditingDesc) return;
      if (!this.editorCurrentEditingDesc.needsReview) return;

      const diffApi = (window.Diff && typeof window.Diff.diffWordsWithSpace === 'function') ? window.Diff : null;
      if (!diffApi) {
        for (const b of (this.editorBlocks || [])) b.englishDiffHtml = escapeHtml(String(b?.english ?? ''));
        return;
      }

      const filepath = this.editorCurrentEditingDesc.filepath;
      let prevEng = null;
      try {
        const items = await window.OfflineStore.listRevisions(filepath, 'English', 2);
        if (Array.isArray(items) && items.length >= 2) prevEng = items[1]?.translations;
      } catch (_) {
      }
      const curEng = Array.isArray(this.editorCurrentEditingDesc?.translations?.English) ? this.editorCurrentEditingDesc.translations.English : [];

      for (let i = 0; i < (this.editorBlocks || []).length; i++) {
        const b = this.editorBlocks[i];
        const oldRaw = Array.isArray(prevEng) ? (prevEng[i] ?? '') : '';
        const newRaw = curEng[i] ?? '';
        const oldStr = this.isMultilineText(oldRaw) ? this.decodeEscapedNewlines(String(oldRaw)) : String(oldRaw);
        const newStr = this.isMultilineText(newRaw) ? this.decodeEscapedNewlines(String(newRaw)) : String(newRaw);
        b.englishDiffHtml = this.renderInlineDiffHtml(oldStr, newStr);
      }
    },
    renderInlineDiffHtml(oldStr, newStr) {
      const diffApi = window.Diff;
      if (!diffApi) return escapeHtml(String(newStr ?? ''));
      let parts;
      try {
        parts = diffApi.diffWordsWithSpace(String(oldStr ?? ''), String(newStr ?? ''));
      } catch (_) {
        parts = [{ value: String(newStr ?? '') }];
      }
      return (parts || []).map(p => {
        const v = escapeHtml(String(p?.value ?? ''));
        if (p?.added) return `<span class="diffInlineAdd">${v}</span>`;
        if (p?.removed) return `<span class="diffInlineDel">${v}</span>`;
        return v;
      }).join('');
    },
    isMultilineText(text) {
      let s = text ?? "";
      return typeof s === "string" && (s.includes("\\n") || s.includes("\n"));
    },
    decodeEscapedNewlines(text) {
      let s = text ?? "";
      if (typeof s !== "string") return s;
      return s.replaceAll("\\n", "\n");
    },
    encodeNewlines(text) {
      let s = text ?? "";
      if (typeof s !== "string") return s;
      return s.replaceAll("\r\n", "\n").replaceAll("\r", "\n").replaceAll("\n", "\\n");
    },
    normalizeNewlines(text) {
      let s = text ?? "";
      if (typeof s !== "string") return s;
      return s.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
    },
    safeExactRegex(pattern, flags = "igm") {
      let p = String(pattern ?? "");
      return new RegExp("^" + escapeRegExp(p) + "$", flags);
    },
    getDictionaryDefinitionPairs(entry) {
      let mainFind = String(entry?.find ?? "").trim();
      let mainReplace = String(entry?.replace ?? "");
      let pairs = [];
      if (mainFind) pairs.push({ find: mainFind, replace: mainReplace, isMain: true });

      let normalizedAlts = Array.isArray(entry?.alts) ? entry.alts : [];

      let seen = new Set();
      if (mainFind) seen.add(mainFind.toLowerCase());
      for (const alt of normalizedAlts) {
        if (!alt || typeof alt !== "object") continue;
        let f = String(alt.find ?? "").trim();
        if (!f) continue;
        let key = f.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push({ _id: alt._id, find: f, replace: String(alt.replace ?? mainReplace), isMain: false });
      }
      return pairs;
    },
    addDictionaryAltRow(word) {
      if (!word) return;
      if (!Array.isArray(word.alts)) word.alts = [];
      word.alts.push({
        _id: `a_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
        find: "",
        replace: String(word?.replace ?? "")
      });
    },
    removeDictionaryAltRow(word, alt) {
      if (!word || !Array.isArray(word.alts)) return;
      let id = alt?._id;
      if (id) {
        word.alts = word.alts.filter(a => String(a?._id) !== String(id));
      } else {
        word.alts = word.alts.filter(a => a !== alt);
      }
    },
    addDictionaryAltPair(word, find, replace) {
      if (!word) return "";
      let f = String(find ?? "").trim();
      if (!f) return "";
      let pairs = this.getDictionaryDefinitionPairs(word);
      if (pairs.some(p => (p?.find || "").trim().toLowerCase() === f.toLowerCase())) return "";
      if (!Array.isArray(word.alts)) word.alts = [];
      let id = `a_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      word.alts.unshift({
        _id: id,
        find: f,
        replace: String(replace ?? word?.replace ?? "")
      });
      return id;
    },
    computeTextStats(text) {
      let s = this.normalizeNewlines(text ?? "");
      let lines = String(s).length <= 0 ? 0 : String(s).split("\n").length;
      return {
        lines,
        vars: countGGGVarTag(String(s)),
        kw: countKeywordPopupTag(String(s))
      };
    },
    refreshEditorBlockMeta(editorBlock, editorIndex) {
      if (!editorBlock) return;
      let eng = this.computeTextStats(editorBlock.english ?? "");
      let tr = this.computeTextStats(editorBlock.translation ?? "");
      editorBlock.metaLinesEn = eng.lines;
      editorBlock.metaLinesTr = tr.lines;
      editorBlock.metaVarsEn = eng.vars;
      editorBlock.metaVarsTr = tr.vars;
      editorBlock.metaKwEn = eng.kw;
      editorBlock.metaKwTr = tr.kw;
      if (typeof editorIndex === "number" && editorBlock.isMultiline) {
        this.$nextTick(() => this.syncHlScroll('translation', editorIndex));
      }
    },
    translationInput(editorBlock, editorIndex) {
      this.refreshEditorBlockMeta(editorBlock, editorIndex);
      if (!editorBlock?.isMultiline) {
        editorBlock.translationHLter = this.buildTagHLter(editorBlock.translation ?? "");
      }
      this.refreshGamePreview();
    },
    computeMultilineLineMismatch(english, translation) {
      let eng = this.normalizeNewlines(english ?? "");
      let tr = this.normalizeNewlines(translation ?? "");
      let engLines = String(eng).split("\n");
      let trLines = String(tr).split("\n");
      let eVarTotal = countGGGVarTag(String(eng));
      let tVarTotal = countGGGVarTag(String(tr));
      let eKwTotal = countKeywordPopupTag(String(eng));
      let tKwTotal = countKeywordPopupTag(String(tr));
      let tagMismatch = eVarTotal !== tVarTotal || eKwTotal !== tKwTotal;
      let max = Math.max(engLines.length, trLines.length);
      let engMismatch = new Array(engLines.length).fill(false);
      let trMismatch = new Array(trLines.length).fill(false);
      for (let i = 0; i < max; i++) {
        let eLine = engLines[i];
        let tLine = trLines[i];
        if (typeof eLine !== "string") {
          if (typeof tLine === "string") trMismatch[i] = true;
          continue;
        }
        if (typeof tLine !== "string") {
          engMismatch[i] = true;
          continue;
        }
      }
      if (tagMismatch) {
        engMismatch.fill(true);
        trMismatch.fill(true);
      }
      return {
        engLines,
        trLines,
        engMismatch,
        trMismatch,
        mismatch: tagMismatch || engMismatch.some(Boolean) || trMismatch.some(Boolean)
      };
    },
    wrapHlterByLines(html, mismatchLines) {
      let lines = String(html ?? "").split("\n");
      let parts = [];
      for (let i = 0; i < lines.length; i++) {
        let content = lines[i];
        if (content === "") content = "&#8203;";
        let mismatch = Array.isArray(mismatchLines) && mismatchLines[i];
        parts.push(`<div class="hlLine${mismatch ? " lineMismatch" : ""}">${content}</div>`);
      }
      return parts.join("");
    },
    refreshEditorBlockHLter(editorIndex) {
      if (!this.editorVisible) return;
      let editorBlock = this.editorBlocks?.[editorIndex];
      if (!editorBlock) return;
      let { englishHLter: baseEnglishHLter, HLs } = this.buildEnglishHLter(editorBlock.english);
      editorBlock.HLs = HLs;
      if (!editorBlock.isMultiline) {
        editorBlock.englishHLter = baseEnglishHLter;
        editorBlock.translationHLter = this.buildTagHLter(editorBlock.translation ?? "");
        editorBlock.multilineLineMismatch = false;
        return;
      }
      let diff = this.computeMultilineLineMismatch(editorBlock.english, editorBlock.translation);
      editorBlock.englishHLter = this.wrapHlterByLines(baseEnglishHLter, diff.engMismatch);
      editorBlock.translationHLter = this.wrapHlterByLines(this.buildTagHLter(editorBlock.translation ?? ""), diff.trMismatch);
      editorBlock.multilineLineMismatch = diff.mismatch;
    },
    syncHlScroll(kind, index) {
      let inputEl = this.$refs?.[`${kind}_` + index];
      let hlterEl = this.$refs?.[`${kind}HLter_` + index];
      if (Array.isArray(inputEl)) inputEl = inputEl[0];
      if (Array.isArray(hlterEl)) hlterEl = hlterEl[0];
      if (!inputEl || !hlterEl) return;
      hlterEl.style.transform = `translate(${-inputEl.scrollLeft}px, ${-inputEl.scrollTop}px)`;
    },
    autosizeTextarea(el, options = {}) {
      if (!el || el.tagName !== "TEXTAREA") return;
      let minHeight = options.minHeight ?? 72;
      let maxHeight = options.maxHeight ?? 240;
      el.style.height = "auto";
      let next = Math.min(Math.max(el.scrollHeight, minHeight), maxHeight);
      el.style.height = next + "px";
    },
    autosizeEditorMultilineFields() {
      if (!this.editorVisible) return;
      for (let i = 0; i < (this.editorBlocks || []).length; i++) {
        let b = this.editorBlocks[i];
        if (!b?.isMultiline) continue;
        this.autosizeTextarea(this.$refs["english_" + i], { minHeight: 72, maxHeight: 220 });
        this.autosizeTextarea(this.$refs["translation_" + i], { minHeight: 84, maxHeight: 260 });
      }
    },
    normalizeMultilineEditorBlock(editorBlock, editorIndex) {
      if (!editorBlock?.isMultiline) return;
      let next = this.decodeEscapedNewlines(editorBlock.translation || "");
      if (next !== editorBlock.translation) editorBlock.translation = next;
      if (typeof editorIndex === "number") {
        this.$nextTick(() => this.autosizeTextarea(this.$refs["translation_" + editorIndex], { minHeight: 84, maxHeight: 260 }));
      }
      if (typeof editorIndex === "number") this.refreshEditorBlockHLter(editorIndex);
      if (typeof editorIndex === "number") this.refreshEditorBlockMeta(editorBlock, editorIndex);
      this.refreshGamePreview();
    },
    loadDummyData() {
      let desc1 = parseDesc("test/dummy1.txt", dummyFile1, this.lang);
      let desc2 = parseDesc("test/dummy2.txt", dummyFile2, this.lang);
      let desc3 = parseDesc("test/dummy3.txt", dummyFile3, this.lang);
      if (!desc1) return;
      if (!desc2) return;
      if (!desc3) return;
      this.descs = [desc1, desc2, desc3];
      this.loadingProgress = 100;
      this.filterDesc();
    },
    ensureDictionaryIds() {
      if (!Array.isArray(this.dictionary)) return;
      for (const entry of this.dictionary) {
        if (entry && !entry._id) {
          entry._id = `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
        }
        if (!entry) continue;
        if (typeof entry.tlnote !== "string") entry.tlnote = entry.tlnote == null ? "" : String(entry.tlnote);
        if (!Array.isArray(entry.alts)) entry.alts = [];
        entry.alts = entry.alts.map(a => {
          if (!a || typeof a !== "object") return null;
          let f = String(a.find ?? "");
          let r = (typeof a.replace === "string" ? a.replace : String(entry?.replace ?? ""));
          return { _id: a._id || `a_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`, find: f, replace: r };
        }).filter(Boolean);
      }
    },
    isDictionaryEntryFound(word) {
      return this.foundDictionarySet?.has?.(word?._id) || false;
    },
    isDictionaryEntryFindMatched(word) {
      let id = word?._id;
      let find = String(word?.find ?? "").trim();
      if (!id || !find) return false;
      let set = this.foundDictionaryDefMap?.get?.(String(id));
      if (!set) return false;
      return set.has(find.toLowerCase());
    },
    isDictionaryAltFindMatched(word, alt) {
      let id = word?._id;
      let find = String(alt?.find ?? "").trim();
      if (!id || !find) return false;
      let set = this.foundDictionaryDefMap?.get?.(String(id));
      if (!set) return false;
      return set.has(find.toLowerCase());
    },
    sideAddClicked() {
      if (this.sideTab === 'regex') {
        this.addRegex();
        this.regexFilter = "";
      } else {
        this.addVocab();
        this.dictionaryFilter = "";
      }
    },
    buildEnglishHLter(english) {
      let escapedEnglish = escapeHtml(english);
      let englishHLter = escapedEnglish;
      let modifiedEnglish = escapedEnglish;
      let HLs = [];
      let nextHlId = 1;
      let addHL = (hl) => {
        hl._hlId = nextHlId++;
        HLs.push(hl);
      };
      let addMatchingDictIds = (set, text, restrictMainFindLower = "") => {
        if (!text) return;
        for (const dictEntry of this.dictionary || []) {
          if (!dictEntry?._id) continue;
          if (restrictMainFindLower && String(dictEntry?.find || "").trim().toLowerCase() !== restrictMainFindLower) continue;
          for (const pair of this.getDictionaryDefinitionPairs(dictEntry)) {
            let escapedFind = escapeRegExp(pair.find);
            let regex = new RegExp(`\\b${escapedFind}\\b`, "g");
            if (!regex.test(text)) continue;
            set.add(dictEntry._id);
            break;
          }
        }
      };
      let m;

      // highlight KeywordPopup tags [TagName|format] or [TagName]
      let keywordPopupRegex = new RegExp(keywordPopupTagRegex, 'igm');
      while (m = keywordPopupRegex.exec(modifiedEnglish)) {
        let tagName = m[2];
        let dynamicContent = m[3] || '';
        let rawTagName = unescapeHtml(tagName || "");
        let tagLower = rawTagName.trim().toLowerCase();
        let rawDynamicContent = unescapeHtml(dynamicContent || "");
        let hasDynamicContent = /<[^>]*>/.test(rawDynamicContent);
        let staticDynamicContent = rawDynamicContent
          .replace(/<[^>]*>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        let dictIdSet = new Set();
        addMatchingDictIds(dictIdSet, rawTagName, tagLower);
        addMatchingDictIds(dictIdSet, staticDynamicContent, tagLower);
        let kwInfo = lookupKeywordPopupReplacementInfo(rawTagName, hasDynamicContent ? '' : rawDynamicContent, this.dictionary);
        addHL({
          index: m.index,
          find: m[0],
          tagName: tagName,
          dynamicContent: hasDynamicContent ? '' : dynamicContent,
          isKeywordPopup: true,
          replace: kwInfo.text,
          dictId: kwInfo.dictEntry?._id,
          dictDefFind: kwInfo.matchedFind || '',
          dictIds: Array.from(dictIdSet)
        });
      }

      // highlight ggg var tag
      let regex = new RegExp(gggVarTagRegex, 'igm');
      while (m = regex.exec(modifiedEnglish)) {
        addHL({
          index: m.index,
          find: m[1]
        });
      }

      // highlight word from dictionary
      if (this.highlightDict) {
        let defs = [];
        for (const dictEntry of (this.dictionary || [])) {
          if (!dictEntry?._id) continue;
          for (const pair of this.getDictionaryDefinitionPairs(dictEntry)) {
            if (!pair?.find) continue;
            defs.push({ pair, dictEntry });
          }
        }
        defs.sort((a, b) => (b.pair.find || '').length - (a.pair.find || '').length);

        for (const d of defs) {
          if (!d.pair.find || d.pair.find.length <= 0) continue;
          let escapedFind = escapeRegExp(d.pair.find);
          let regex = new RegExp(`\\b${escapedFind}\\b`, "g");
          while (m = regex.exec(modifiedEnglish)) {
            // skip if it is within a keyword popup tag
            if (HLs.some(hl => hl.index <= m.index && m.index < hl.index + hl.find.length)) continue;
            // skip if it is within a ggg var tag
            if (HLs.some(hl => hl.index <= m.index && m.index < hl.index + hl.find.length)) continue;
            addHL({
              index: m.index,
              find: m[0],
              replace: d.pair.replace,
              dictId: d.dictEntry._id,
              dictDefFind: d.pair.find
            });
            let asterisks = '*'.repeat(m[0].length);
            modifiedEnglish = modifiedEnglish.substring(0, m.index) + asterisks + modifiedEnglish.substring(m.index + m[0].length);
          }
        }
      }

      // construct HLter
      HLs.sort((a, b) => b.index - a.index); // sort deacending
      for (let i = 0; i < HLs.length; i++) {
        const HL = HLs[i];
        let title = `Click / Alt+${HLs.length-i} = Paste below&#10;Alt+Click = Copy to Clipboard`;
        if (HL?.isKeywordPopup) {
          title += HL?.dictId
            ? `&#10;Ctrl+Click = Jump to Dictionary`
            : `&#10;Ctrl+Click = Add to Dictionary`;
        }
        let tag = `<span class='${HL.replace ? "vocab" : ""}' title='${title}' data-hl-id="${HL._hlId}" dataValue="${HL.replace ? HL.replace : HL.find}">${HL.find}</span>`;
        englishHLter = englishHLter.substring(0, HL.index) + tag + englishHLter.substring(HL.index + HL.find.length);
      }
      HLs.sort((a, b) => a.index - b.index); // sort acending

      return { englishHLter, HLs };
    },
    buildTagHLter(text) {
      let escapedText = escapeHtml(text ?? "");
      let hlter = escapedText;
      let modifiedText = escapedText;
      let HLs = [];
      let nextHlId = 1;
      let addHL = (index, find, className = "") => {
        HLs.push({ _hlId: nextHlId++, index, find, className });
      };
      let m;

      let keywordPopupRegex = new RegExp(keywordPopupTagRegex, 'igm');
      while (m = keywordPopupRegex.exec(modifiedText)) {
        addHL(m.index, m[0], "vocab");
        let mask = '*'.repeat(m[0].length);
        modifiedText = modifiedText.substring(0, m.index) + mask + modifiedText.substring(m.index + m[0].length);
      }

      let gggRegex = new RegExp(gggVarTagRegex, 'igm');
      while (m = gggRegex.exec(modifiedText)) {
        addHL(m.index, m[1]);
      }

      HLs.sort((a, b) => b.index - a.index);
      for (const HL of HLs) {
        let cls = HL.className ? ` class='${HL.className}'` : "";
        let tag = `<span${cls} data-hl-id="${HL._hlId}">${HL.find}</span>`;
        hlter = hlter.substring(0, HL.index) + tag + hlter.substring(HL.index + HL.find.length);
      }
      return hlter;
    },
    refreshEditorHLter() {
      if (!this.editorVisible) return;
      for (let i = 0; i < (this.editorBlocks || []).length; i++) {
        let editorBlock = this.editorBlocks[i];
        let { englishHLter: baseEnglishHLter, HLs } = this.buildEnglishHLter(editorBlock.english);
        editorBlock.HLs = HLs;
        if (!editorBlock.isMultiline) {
          editorBlock.englishHLter = baseEnglishHLter;
          editorBlock.translationHLter = this.buildTagHLter(editorBlock.translation ?? "");
          editorBlock.multilineLineMismatch = false;
          continue;
        }
        let diff = this.computeMultilineLineMismatch(editorBlock.english, editorBlock.translation);
        editorBlock.englishHLter = this.wrapHlterByLines(baseEnglishHLter, diff.engMismatch);
        editorBlock.translationHLter = this.wrapHlterByLines(this.buildTagHLter(editorBlock.translation ?? ""), diff.trMismatch);
        editorBlock.multilineLineMismatch = diff.mismatch;
        this.$nextTick(() => {
          this.syncHlScroll('english', i);
          this.syncHlScroll('translation', i);
        });
      }
      if (this.hlPopup.visible) {
        this.$nextTick(() => this.syncHlPopupEnglishHighlight());
      }
    },
    scheduleEditorHLterRefresh() {
      if (!this.editorVisible) return;
      if (this._hlterRefreshTimer) clearTimeout(this._hlterRefreshTimer);
      this._hlterRefreshTimer = setTimeout(() => {
        this.refreshEditorHLter();
      }, 150);
    },
    /** Rebuild english HLs immediately so foundDictionarySet / filteredDictionary match the current dictionary (avoids focus loss when a debounced refresh later re-sorts the sidebar list). */
    syncEditorHlterWithDictionaryNow() {
      if (!this.editorVisible) return;
      if (this._hlterRefreshTimer) clearTimeout(this._hlterRefreshTimer);
      this._hlterRefreshTimer = null;
      this.refreshEditorHLter();
    },
    setEditorFocus(index) {
      this.editorFocusedIndex = index;
      this.refreshGamePreview();
      if (this.hlPopup.visible) {
        this.openHlPopup(index);
      }
    },
    buildHlPopupItems(editorIndex) {
      let editorBlock = this.editorBlocks?.[editorIndex];
      let HLs = editorBlock?.HLs || [];
      let items = [];
      let seen = new Map();
      let seenValue = new Map();
      for (const hl of HLs) {
        if (hl?.dictId) {
          let kwTagName = "";
          let kwDynamicContent = "";
          if (hl?.isKeywordPopup) {
            kwTagName = unescapeHtml(hl.tagName || "").trim();
            kwDynamicContent = unescapeHtml(hl.dynamicContent || "").trim();
            if (kwDynamicContent.includes("<")) kwDynamicContent = "";
            kwDynamicContent = kwDynamicContent.trim();
          }

          let dictIdList = [hl.dictId];
          if (hl?.isKeywordPopup && Array.isArray(hl?.dictIds) && hl.dictIds.length > 0) {
            dictIdList = hl.dictIds.slice();
          }
          let uniqueDictIds = Array.from(new Set(dictIdList.map(v => String(v || "")).filter(Boolean)));
          if (uniqueDictIds.length <= 0) continue;

          let matchCandidate = "";
          if (hl?.isKeywordPopup) {
            let dc = unescapeHtml(hl.dynamicContent || "").trim();
            let tn = unescapeHtml(hl.tagName || "").trim();
            matchCandidate = (dc || tn || "").trim();
          } else {
            matchCandidate = String(hl?.dictDefFind || hl?.find || "").trim();
          }
          let matchCandidateLower = matchCandidate.toLowerCase();
          let keywordTagNameLower = "";
          if (hl?.isKeywordPopup) {
            keywordTagNameLower = unescapeHtml(hl.tagName || "").trim().toLowerCase();
          }

          for (const dictId of uniqueDictIds) {
            let dictEntry = (this.dictionary || []).find(d => String(d?._id) === String(dictId));
            if (!dictEntry) continue;
            if (keywordTagNameLower && String(dictEntry?.find || "").trim().toLowerCase() !== keywordTagNameLower) continue;
            let pairs = this.getDictionaryDefinitionPairs(dictEntry);
            for (const p of pairs) {
              let value;
              let label;
              if (hl?.isKeywordPopup) {
                let tn = unescapeHtml(hl.tagName || "").trim();
                if (!tn) tn = p.find;
                // [tagName|find] → [tagName|replace]
                value = `[${tn}|${p?.replace ?? p?.find ?? ""}]`;
                label = `[${tn}|${p?.find ?? ""}] → ${value}`;
              } else {
                // find → replace
                value = p?.replace || p?.find || "";
                label = p?.replace && p.replace !== p.find ? `${p.find} → ${p.replace}` : `${p.find}`;
              }
              if (!value) continue;
              let key = `${dictEntry._id}|${p.find.toLowerCase()}|${value}`;
              let exactFromContext = !!matchCandidateLower && matchCandidateLower === p.find.toLowerCase();
              let existingItem = seen.get(key);
              if (existingItem) {
                existingItem.exactFromContext = existingItem.exactFromContext || exactFromContext;
                if (hl?._hlId && Array.isArray(existingItem.hlIds) && !existingItem.hlIds.includes(hl._hlId)) {
                  existingItem.hlIds.push(hl._hlId);
                }
                existingItem.dictEntryId = existingItem.dictEntryId || dictEntry._id;
                if (kwTagName) existingItem.kwTagName = existingItem.kwTagName || kwTagName;
                if (kwDynamicContent) existingItem.kwDynamicContent = existingItem.kwDynamicContent || kwDynamicContent;
                continue;
              }
              let item = {
                label,
                value,
                matchText: p.find,
                matchTextLower: p.find.toLowerCase(),
                isAlt: !p.isMain,
                exactFromContext,
                hlIds: hl?._hlId ? [hl._hlId] : [],
                dictEntryId: dictEntry._id,
                dictAltId: p.isMain ? "" : (p?._id || ""),
                kwTagName,
                kwDynamicContent
              };
              seen.set(key, item);
              items.push(item);
            }
          }

          continue;
        }

        let value = hl?.replace || hl?.find || "";
        if (!value) continue;
        let existingValueItem = seenValue.get(value);
        if (existingValueItem) {
          if (hl?._hlId && Array.isArray(existingValueItem.hlIds) && !existingValueItem.hlIds.includes(hl._hlId)) {
            existingValueItem.hlIds.push(hl._hlId);
          }
          continue;
        }
        let label = hl?.replace && hl.replace !== hl.find ? `${hl.find} → ${hl.replace}` : `${hl.find}`;
        let matchText = String(hl?.find || "").trim();
        let kw = this.parseKeywordPopupTagText(value);
        let item = {
          label,
          value,
          matchText,
          matchTextLower: matchText.toLowerCase(),
          isAlt: false,
          hlIds: hl?._hlId ? [hl._hlId] : [],
          kwTagName: kw?.tagName || "",
          kwDynamicContent: kw?.dynamicContent || ""
        };
        seenValue.set(value, item);
        items.push(item);
      }
      return items;
    },
    positionHlPopup(editorIndex) {
      let el = this.$refs["translation_" + editorIndex];
      if (!el?.getBoundingClientRect) return;
      let rect = el.getBoundingClientRect();
      let width = Math.min(Math.max(rect.width, 260), 640);
      let left = Math.min(rect.left, window.innerWidth - width - 8);
      if (left < 8) left = 8;
      let top = rect.bottom + 6;
      if (top > window.innerHeight - 120) top = rect.top - 6;
      if (top < 8) top = 8;
      this.hlPopup.x = Math.round(left);
      this.hlPopup.y = Math.round(top);
      this.hlPopup.width = Math.round(width);
    },
    applyHlPopupFilter() {
      let filter = (this.hlPopup.filter || "").trim().toLowerCase();
      if (!filter) {
        this.hlPopup.filtered = this.hlPopup.items.slice();
      } else {
        this.hlPopup.filtered = this.hlPopup.items.filter(item => {
          return (item.label || "").toLowerCase().includes(filter) || (item.value || "").toLowerCase().includes(filter);
        });
      }
      for (const item of this.hlPopup.filtered) {
        item.exactMatch = (!!filter && (item?.matchTextLower || "") === filter) || (!filter && !!item?.exactFromContext);
      }
      this.hlPopup.selectedIndex = 0;
    },
    openHlPopup(editorIndex, options = {}) {
      if (!this.editorVisible) return;
      if (editorIndex == null) editorIndex = this.editorFocusedIndex || 0;
      this.hlPopup.editorIndex = editorIndex;
      this.hlPopup.openedByBracket = !!options.openedByBracket;
      this.hlPopup.items = this.buildHlPopupItems(editorIndex);
      this.hlPopup.filter = "";
      this.applyHlPopupFilter();
      this.positionHlPopup(editorIndex);
      this.hlPopup.visible = true;
      let focusFilter = options.focusFilter !== false;
      if (focusFilter) this.$nextTick(() => this.$refs.hlPopupFilter?.focus());
    },
    closeHlPopup(options = {}) {
      let editorIndex = this.hlPopup.editorIndex;
      this.hlPopup.visible = false;
      this.hlPopup.openedByBracket = false;
      this.hlPopup.filter = "";
      this.hlPopup.items = [];
      this.hlPopup.filtered = [];
      this.hlPopup.selectedIndex = 0;
      if (options.refocus && this.editorVisible) {
        this.$nextTick(() => this.$refs["translation_" + editorIndex]?.focus?.());
      }
    },
    parseKeywordPopupTagText(text) {
      let raw = String(text ?? "");
      let regex = new RegExp(keywordPopupTagRegex, "i");
      let m = regex.exec(raw);
      if (!m) return null;
      let tagName = String(m[2] ?? "").trim();
      let dynamicContent = String(m[3] ?? "").trim();
      if (!tagName) return null;
      return { tagName, dynamicContent };
    },
    getHlPopupKeywordInfo(item) {
      if (!item) return null;
      let tagName = String(item?.kwTagName || "").trim();
      let dynamicContent = String(item?.kwDynamicContent || "").trim();
      if (!tagName) {
        let parsed = this.parseKeywordPopupTagText(item.value);
        if (parsed) {
          tagName = parsed.tagName;
          dynamicContent = parsed.dynamicContent;
        }
      }
      if (!tagName) return null;
      if (dynamicContent.includes("<")) dynamicContent = "";
      dynamicContent = dynamicContent.trim();
      return { tagName, dynamicContent };
    },
    ensureDictionaryKeywordTag(tagName, altFind = "") {
      let tn = String(tagName ?? "").trim();
      if (!tn) return { dictId: "", created: false, addedAlt: false };
      let alt = String(altFind ?? "").trim();

      this.sideTab = "dictionary";
      this.dictionaryFilter = "";

      let existing = (this.dictionary || []).find(d => String(d?.find || "").trim().toLowerCase() === tn.toLowerCase());
      if (existing) {
        let addedAlt = false;
        let createdAltId = "";
        if (alt) {
          let pairs = this.getDictionaryDefinitionPairs(existing);
          if (!pairs.some(p => String(p?.find || "").trim().toLowerCase() === alt.toLowerCase())) {
            createdAltId = this.addDictionaryAltPair(existing, alt, existing?.replace ?? "");
            addedAlt = true;
          }
        }
        this.dictionaryFlashId = existing._id || '';
        if (this._dictFlashTimer) clearTimeout(this._dictFlashTimer);
        this._dictFlashTimer = setTimeout(() => {
          if (this.dictionaryFlashId === existing._id) this.dictionaryFlashId = '';
        }, 320);
        this.syncEditorHlterWithDictionaryNow();
        if (addedAlt && createdAltId) this.focusDictionaryEntryReplaceInput(existing._id, { altId: createdAltId });
        else this.focusDictionaryEntryReplaceInput(existing._id);
        return { dictId: existing._id || "", created: false, addedAlt };
      }

      let createdAltId = "";
      let entry = {
        _id: `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
        find: tn,
        replace: tn,
        alts: alt ? [{ _id: (createdAltId = `a_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`), find: alt, replace: tn }] : [],
        tlnote: ""
      };
      this.dictionary.unshift(entry);
      this.dictionaryFlashId = entry._id;
      if (this._dictFlashTimer) clearTimeout(this._dictFlashTimer);
      this._dictFlashTimer = setTimeout(() => {
        if (this.dictionaryFlashId === entry._id) this.dictionaryFlashId = '';
      }, 320);
      this.syncEditorHlterWithDictionaryNow();
      if (createdAltId) this.focusDictionaryEntryReplaceInput(entry._id, { altId: createdAltId });
      else this.focusDictionaryEntryReplaceInput(entry._id);
      return { dictId: entry._id, created: true, addedAlt: !!alt };
    },
    canCreateDictionaryEntryFromHlPopupItem(item) {
      if (!item) return false;
      let info = this.getHlPopupKeywordInfo(item);
      if (!info) return false;
      let tagNameLower = info.tagName.toLowerCase();
      if (!tagNameLower) return false;

      let alt = String(info.dynamicContent ?? "").trim();

      let existing = (this.dictionary || []).find(d => String(d?.find || "").trim().toLowerCase() === tagNameLower);
      if (!existing) return true;
      if (!alt) return false;

      let pairs = this.getDictionaryDefinitionPairs(existing);
      if (pairs.some(p => String(p?.find || "").trim().toLowerCase() === alt.toLowerCase())) return false;
      return true;
    },
    canJumpToDictionaryFromHlPopupItem(item) {
      if (!item) return false;
      return !!item.dictEntryId;
    },
    jumpToDictionaryFromHlPopupItem(item) {
      let dictId = String(item?.dictEntryId || "");
      if (!dictId) return false;
      let entry = (this.dictionary || []).find(d => String(d?._id) === dictId);
      if (!entry) return false;
      let altId = String(item?.dictAltId || "");
      this.closeHlPopup();
      this.sideTab = "dictionary";
      this.dictionaryFilter = "";
      this.dictionaryFlashId = entry._id || '';
      if (this._dictFlashTimer) clearTimeout(this._dictFlashTimer);
      this._dictFlashTimer = setTimeout(() => {
        if (this.dictionaryFlashId === entry._id) this.dictionaryFlashId = '';
      }, 320);
      if (altId) this.focusDictionaryEntryReplaceInput(entry._id, { altId });
      else this.focusDictionaryEntryReplaceInput(entry._id);
      return true;
    },
    hlPopupCtrlEnterAction() {
      let item = this.hlPopup.filtered?.[this.hlPopup.selectedIndex];
      if (!item) return false;
      if (this.canCreateDictionaryEntryFromHlPopupItem(item)) {
        return this.createDictionaryEntryFromHlPopupSelection();
      }
      if (this.canJumpToDictionaryFromHlPopupItem(item)) {
        return this.jumpToDictionaryFromHlPopupItem(item);
      }
      return false;
    },
    hlPopupCtrlEnterPillText(item) {
      if (!item) return "";
      if (this.canCreateDictionaryEntryFromHlPopupItem(item)) {
        let info = this.getHlPopupKeywordInfo(item);
        if (!info) return "";
        let existing = (this.dictionary || []).find(d => String(d?.find || "").trim().toLowerCase() === info.tagName.toLowerCase());
        return existing ? "Ctrl+Enter Add alt" : "Ctrl+Enter Add";
      }
      if (this.canJumpToDictionaryFromHlPopupItem(item)) {
        return "Ctrl+Enter Edit";
      }
      return "";
    },
    focusDictionaryEntryReplaceInput(dictId, options = {}) {
      if (!dictId) return;
      let esc = (s) => {
        if (window?.CSS?.escape) return window.CSS.escape(String(s));
        return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      };
      this.$nextTick(() => {
        let altId = String(options?.altId || "");
        if (altId) {
          let altRow = document?.querySelector?.(`.side .dictAltRow[data-dict-id="${esc(dictId)}"][data-dict-alt-id="${esc(altId)}"]`);
          let altInput = altRow?.querySelector?.('input:nth-of-type(2)');
          altRow?.scrollIntoView?.({ block: "nearest" });
          altInput?.focus?.();
          altInput?.select?.();
          return;
        }

        let row = document?.querySelector?.(`.side .dictRow[data-dict-id="${esc(dictId)}"]`);
        let input = row?.querySelector?.('input:nth-of-type(2)');
        row?.scrollIntoView?.({ block: "nearest" });
        input?.focus?.();
        input?.select?.();
      });
    },
    createDictionaryEntryFromHlPopupSelection() {
      let item = this.hlPopup.filtered?.[this.hlPopup.selectedIndex];
      if (!this.canCreateDictionaryEntryFromHlPopupItem(item)) return false;
      let info = this.getHlPopupKeywordInfo(item);
      if (!info) return false;

      this.closeHlPopup();
      let r = this.ensureDictionaryKeywordTag(info.tagName, info.dynamicContent);
      return r.created || r.addedAlt;
    },
    moveHlPopupSelection(delta) {
      let len = this.hlPopup.filtered.length;
      if (len <= 0) return;
      let next = this.hlPopup.selectedIndex + delta;
      if (next < 0) next = len - 1;
      if (next >= len) next = 0;
      this.hlPopup.selectedIndex = next;
    },
    syncHlPopupEnglishHighlight() {
      if (!this.editorVisible) return;

      let blockCount = (this.editorBlocks || []).length;
      for (let i = 0; i < blockCount; i++) {
        let r = this.$refs["englishHLter_" + i];
        if (!r?.querySelectorAll) continue;
        for (const el of r.querySelectorAll('span[data-hl-id].hlPopupActive')) {
          el.classList.remove('hlPopupActive');
        }
      }

      if (document?.querySelectorAll) {
        for (const el of document.querySelectorAll('.side .dictRow.hlPopupDictActive, .side .dictAltRow.hlPopupDictActive')) {
          el.classList.remove('hlPopupDictActive');
        }
      }

      if (!this.hlPopup.visible) return;

      let editorIndex = this.hlPopup.editorIndex;
      let root = this.$refs["englishHLter_" + editorIndex];
      if (!root?.querySelectorAll) return;

      let item = this.hlPopup.filtered?.[this.hlPopup.selectedIndex];
      if (!item) return;

      let ids = Array.isArray(item.hlIds) ? item.hlIds : [];
      let idSet = new Set(ids.map(v => String(v)));
      let value = String(item.value ?? "");
      let dictEntryId = String(item.dictEntryId || "");
      let dictAltId = String(item.dictAltId || "");

      let esc = (s) => {
        if (window?.CSS?.escape) return window.CSS.escape(String(s));
        return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      };

      if (idSet.size > 0) {
        for (const id of idSet) {
          let el = root.querySelector(`span[data-hl-id="${esc(id)}"]`);
          if (!el?.classList) continue;
          el.classList.add('hlPopupActive');
        }
      } else if (value) {
        for (const el of root.querySelectorAll(`span[data-hl-id][dataValue="${esc(value)}"]`)) {
          el.classList.add('hlPopupActive');
        }
      }

      if (!document?.querySelector) return;

      let dictEl = null;
      if (dictAltId) {
        dictEl = document.querySelector(`.side .dictAltRow[data-dict-alt-id="${esc(dictAltId)}"]`);
      } else if (dictEntryId) {
        dictEl = document.querySelector(`.side .dictRow[data-dict-id="${esc(dictEntryId)}"]`);
      }
      if (dictEl?.classList) dictEl.classList.add('hlPopupDictActive');
    },
    insertTranslationText(editorIndex, text, options = {}) {
      let el = this.$refs["translation_" + editorIndex];
      let editorBlock = this.editorBlocks?.[editorIndex];
      if (!el || !editorBlock) {
        document.execCommand("insertText", false, text);
        return;
      }
      if (typeof el.selectionStart !== "number" || typeof el.selectionEnd !== "number") {
        if (el?.focus) el.focus();
        document.execCommand("insertText", false, text);
        return;
      }
      let value = el.value || "";
      let start = el.selectionStart;
      let end = el.selectionEnd;
      if (options.deleteOpeningBracket && start > 0 && value[start - 1] === "[") {
        start = start - 1;
      }
      let newValue = value.slice(0, start) + text + value.slice(end);
      editorBlock.translation = newValue;
      if (editorBlock.isMultiline) {
        this.normalizeMultilineEditorBlock(editorBlock, editorIndex);
      } else {
        this.translationInput(editorBlock, editorIndex);
      }
      this.$nextTick(() => {
        el.focus?.();
        let caret = start + text.length;
        el.setSelectionRange?.(caret, caret);
      });
    },
    insertHlPopupItem(item) {
      let editorIndex = this.hlPopup.editorIndex;
      let deleteOpeningBracket = this.hlPopup.openedByBracket;
      this.insertTranslationText(editorIndex, item.value, { deleteOpeningBracket });
      this.closeHlPopup({ refocus: true });
    },
    insertHlPopupSelection() {
      let item = this.hlPopup.filtered[this.hlPopup.selectedIndex];
      if (!item) return;
      this.insertHlPopupItem(item);
    },
    translationKeydown(e, editorIndex) {
      if (e.key === "[" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (!this.editorVisible) return;
        this.setEditorFocus(editorIndex);
        if (!this.hlPopup.visible) {
          setTimeout(() => this.openHlPopup(editorIndex, { openedByBracket: true }), 0);
        }
        return;
      }

      if (!this.hlPopup.visible) return;

      if (e.code === "Escape") {
        e.preventDefault();
        this.closeHlPopup({ refocus: true });
        return;
      }

      if (e.code === "Backspace") {
        if (this.hlPopup.filter) {
          e.preventDefault();
          this.hlPopup.filter = this.hlPopup.filter.slice(0, -1);
          this.applyHlPopupFilter();
        } else {
          this.closeHlPopup({ refocus: true });
        }
        return;
      }

      if (e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        this.hlPopup.filter += e.key;
        this.applyHlPopupFilter();
      }
    },
    hlPopupFilterKeydown(e) {
      if (!this.hlPopup.visible) return;
      if (e.code === "Escape") {
        e.preventDefault();
        this.closeHlPopup({ refocus: true });
        return;
      }
      if (e.code === "Backspace" && !this.hlPopup.filter) {
        e.preventDefault();
        if (this.hlPopup.openedByBracket) {
          this.insertTranslationText(this.hlPopup.editorIndex, "", { deleteOpeningBracket: true });
        }
        this.closeHlPopup({ refocus: true });
      }
    },
    isActiveElementInEditorPane() {
      if (!this.editorVisible) return false;
      let el = document.activeElement;
      if (!el || typeof el.closest !== "function") return false;
      return !!el.closest(".editor .edit");
    },
    isActiveElementInSearchBox() {
      let el = document.activeElement;
      if (!el) return false;
      return [this.$refs.searchInput, this.$refs.dictionaryFilterInput, this.$refs.regexFilterInput].includes(el);
    },
    focusSidebarFilterInput() {
      if (!this.editorVisible) return false;
      let ref = this.sideTab === "regex" ? this.$refs.regexFilterInput : this.$refs.dictionaryFilterInput;
      if (!ref) return false;
      ref.focus?.();
      ref.select?.();
      return true;
    },
    handleKeydown(e) {
      if (this.importDialogVisible && e.code === "Escape") {
        e.preventDefault();
        this.closeImportDialog();
        return;
      }

      // Ctrl+S: Save in editor or Export in table view
      if (e.ctrlKey && e.code === "KeyS") {
        e.preventDefault();
        if (this.editorVisible) {
          this.editorSave();
        } else {
          this.exportZip(false);
        }
        return;
      }

      if (e.ctrlKey && (e.code === "Space" || e.key === " ")) {
        if (!this.editorVisible) return;
        e.preventDefault();
        if (this.hlPopup.visible) this.closeHlPopup({ refocus: true });
        else this.openHlPopup(this.editorFocusedIndex || 0);
        return;
      }

      if (this.hlPopup.visible) {
        if (e.code === "Escape") {
          e.preventDefault();
          this.closeHlPopup({ refocus: true });
          return;
        }
        if (e.code === "ArrowDown") {
          e.preventDefault();
          this.moveHlPopupSelection(1);
          return;
        }
        if (e.code === "ArrowUp") {
          e.preventDefault();
          this.moveHlPopupSelection(-1);
          return;
        }
        if (e.ctrlKey && e.code === "Enter") {
          if (this.hlPopupCtrlEnterAction()) {
            e.preventDefault();
            return;
          }
        }
        if (e.code === "Enter") {
          e.preventDefault();
          this.insertHlPopupSelection();
          return;
        }
      }

      if (this.editorVisible && e.code === "Escape") {
        const t = e.target;
        const inEditor = t && typeof t.closest === "function" ? t.closest(".editor") : null;
        if (!inEditor) {
          this.editorEsc(e);
          e.preventDefault();
          return;
        }
      }

      if (e.shiftKey && e.code === 'Enter') {
        this.openFirstFile();
      }
      
      if (e.ctrlKey && e.code === 'KeyF') {
        if (this.isActiveElementInSearchBox()) return;
        e.preventDefault();
        if (this.isActiveElementInEditorPane() && this.focusSidebarFilterInput()) return;
        this.$refs.searchInput?.focus();
        this.$refs.searchInput?.select();
      }
    },
  
    openFirstFile() {
      if (this.descsDisplay.length > 0) {
        let firstDesc = this.descsDisplay[0];
        this.editFile(firstDesc.filepath);
      }
    },
    importUpdateZipClicked() {
      this.$refs.importUpdateZipFile?.click?.();
    },
    async importUpdateZipChanged(e) {
      const file = e?.target?.files?.[0];
      if (!file) return;
      await this.importUpdateZipFile(file);
      this.$refs.importUpdateZipFileForm?.reset?.();
    },
    closeImportDialog() {
      this.importDialogVisible = false;
    },
    importNextVersionZipClicked() {
      this.closeImportDialog();
      this.$refs.importUpdateZipFile?.click?.();
    },
    importPreviousVersionZipClicked() {
      this.$refs.importUpdateZipFile?.click?.();
    },
    importTranslatedZipClicked() {
      this.closeImportDialog();
      this.$refs.importTranslatedZipFile?.click?.();
    },
    async importTranslatedZipChanged(e) {
      const file = e?.target?.files?.[0];
      if (!file) return;
      await this.importTranslatedZipFile(file);
      this.$refs.importTranslatedZipFileForm?.reset?.();
    },

    async startFromScratch() {
      const ok = this.confirmProceedByTypingYes(
        "This will DELETE all of your local translated workspace data and ALL revision history stored in this browser.\n\n" +
        "You will lose your working translated files and history.\n\n" +
        "Type YES to proceed:",
        { confirmMessage: "Last warning: This cannot be undone. Proceed?" }
      );
      if (!ok) return;
      try {
        await window.OfflineStore?.clearWorkspace?.();
      } catch (_) {
      }
      try {
        await window.OfflineStore?.clearSource?.();
      } catch (_) {
      }
      try {
        await window.OfflineStore?.clearRevisions?.();
      } catch (_) {
      }
      location.reload();
    },

    confirmProceedByTypingYes(message, { confirmMessage } = {}) {
      const typed = (prompt(message) || "").trim();
      if (typed !== "YES") return false;
      if (!confirm(confirmMessage || "Last warning: Proceed?")) return false;
      return true;
    },
    countZipTxtFiles(zip) {
      if (!zip?.files) return 0;
      let n = 0;
      for (const filepath of getZipTxtFilepaths(zip)) {
        const entry = zip.files[filepath];
        if (entry?.dir) continue;
        n++;
      }
      return n;
    },

    async importUpdateZipFile(file) {
      if (!file) return;
      if (!offlineStoreReady) return;
      if (!this.lang) {
        alert('Please select a language in Settings first.');
        return;
      }

      const isPostMigrationImport = !!this.needsPostMigrationImport;

      this.localDescs.lastModified = file.lastModified;
      this.localDescs.size = file.size;
      this.ensureLocalDescsReady();

      let zip;
      this.loadingProgress = 0.001;
      try {
        zip = await new JSZip().loadAsync(file);
      } catch (error) {
        this.loadingProgress = 0;
        alert('Cannot open this file');
        return;
      }

      const txtFileCount = this.countZipTxtFiles(zip);
      if (txtFileCount === 0) {
        this.loadingProgress = 100;
        alert('No .txt files found in this ZIP.');
        return;
      }
      if (txtFileCount < ZIP_TXT_FILE_COUNT_THRESHOLD) {
        const ok = this.confirmProceedByTypingYes(
          "This ZIP looks smaller than a full StatDescriptions export.\n\n" +
          `Found only ${txtFileCount} .txt files (expected ~${ZIP_TXT_FILE_COUNT_THRESHOLD}+).\n\n` +
          "This might be a partial export or the translated ZIP.\n" +
          "Importing it as a Next Version update can mark many source files as deleted.\n\n" +
          "Type YES to proceed:",
          { confirmMessage: "Last warning: Import anyway?" }
        );
        if (!ok) {
          this.loadingProgress = 100;
          return;
        }
      }

      const parseFuncs = getZipTxtFilepaths(zip).map(filepath => parseFile(filepath, zip.files[filepath], this.lang));

      let parsed = await allProgress(parseFuncs, (p) => {
        const percent = Math.max(0.001, Math.min(99.999, Number(p) || 0));
        this.loadingProgress = percent;
      });
      const nextSource = parsed.filter(Boolean);

      const prevSource = Array.isArray(this.descs) ? this.descs : [];
      const prevSourceMap = new Map(prevSource.map(d => [d.filepath, d]));
      const nextSourceMap = new Map(nextSource.map(d => [d.filepath, d]));
      const oldWorkspaceMap = new Map((this.localDescs.descs || []).map(d => [d.filepath, d]));
      const now = Date.now();

      for (const prev of prevSource) {
        if (!prev || !prev.filepath) continue;
        if (nextSourceMap.has(prev.filepath)) continue;
        const st = this.localDescs.status[prev.filepath] || {};
        st.deletedAt = now;
        st.deleted = true;
        this.localDescs.status[prev.filepath] = st;
      }

      for (const nextDesc of nextSource) {
        const filepath = nextDesc.filepath;
        const prevDesc = prevSourceMap.get(filepath);
        const prevEng = Array.isArray(prevDesc?.translations?.English) ? prevDesc.translations.English : [];
        const nextEng = Array.isArray(nextDesc?.translations?.English) ? nextDesc.translations.English : [];

        const oldLocal = oldWorkspaceMap.get(filepath);
        const oldWorkspaceLines = Array.isArray(oldLocal?.translations?.[this.lang]) ? oldLocal.translations[this.lang] : [];
        const hadOldWorkspaceTranslation = oldWorkspaceLines.some(v => String(v ?? '').trim() !== '');
        const oldLinesRaw = Array.isArray(oldLocal?.translations?.[this.lang]) ? oldLocal.translations[this.lang] : (Array.isArray(prevDesc?.translations?.[this.lang]) ? prevDesc.translations[this.lang] : []);
        const importedLinesRaw = Array.isArray(nextDesc?.translations?.[this.lang]) ? nextDesc.translations[this.lang] : [];

        const engLen = nextEng.length;
        let needsReview = false;
        const merged = [];
        for (let i = 0; i < engLen; i++) {
          const imported = String(importedLinesRaw[i] ?? '');
          if (imported.trim() !== '') {
            merged.push(importedLinesRaw[i]);
            continue;
          }
          const old = String(oldLinesRaw[i] ?? '');
          if (old.trim() !== '') {
            merged.push(oldLinesRaw[i]);
            if (!isPostMigrationImport) needsReview = true;
          } else {
            merged.push('');
          }
        }

        if (!nextDesc.translations) nextDesc.translations = { English: nextEng };
        nextDesc.translations.English = nextEng;
        nextDesc.translations[this.lang] = merged;

        nextDesc.isMissing = computeIsMissing(engLen, merged);
        nextDesc.needsReview = isPostMigrationImport ? false : needsReview;
        const hasChanges = isPostMigrationImport && hadOldWorkspaceTranslation;
        nextDesc.hasChanges = hasChanges;

        const st = this.localDescs.status[filepath] || {};
        st.deleted = false;
        st.deletedAt = 0;
        st.lastImportedAt = now;
        st.needsReview = isPostMigrationImport ? false : needsReview;
        if (prevDesc && !arrayEquals(prevEng, nextEng)) st.lastSourceAt = now;
        if (!prevDesc) st.lastSourceAt = now;
        this.localDescs.status[filepath] = st;

        let localDesc = oldLocal;
        if (!localDesc) {
          localDesc = makeLocalDesc(nextDesc, this.lang, merged, { hasChanges, isMissing: nextDesc.isMissing });
          this.localDescs.descs.push(localDesc);
          oldWorkspaceMap.set(nextDesc.filepath, localDesc);
        } else {
          updateLocalDesc(localDesc, nextDesc, this.lang, merged, { hasChanges, isMissing: nextDesc.isMissing });
        }

        if (prevDesc && !arrayEquals(prevEng, nextEng)) {
          const rev = {
            filepath: nextDesc.filepath,
            filename: nextDesc.filename,
            filedir: nextDesc.filedir,
            lang: 'English',
            savedAt: now,
            note: 'Source update',
            isMissing: false,
            translations: nextEng,
          };
          try {
            const latest = await window.OfflineStore.getLatestRevision(nextDesc.filepath, 'English');
            if (!latest || !arrayEquals(latest.translations, nextEng)) await window.OfflineStore.addRevision(rev);
          } catch (_) {
          }
        } else if (!prevDesc) {
          const rev = {
            filepath: nextDesc.filepath,
            filename: nextDesc.filename,
            filedir: nextDesc.filedir,
            lang: 'English',
            savedAt: now,
            note: 'Source import',
            isMissing: false,
            translations: nextEng,
          };
          try {
            const latest = await window.OfflineStore.getLatestRevision(nextDesc.filepath, 'English');
            if (!latest) await window.OfflineStore.addRevision(rev);
          } catch (_) {
          }
        }
      }

      this.descs = nextSource;
      this.sourceLoaded = true;

      await this.saveLocalDescs();
      if (window.OfflineStore && typeof window.OfflineStore.setSource === 'function') {
        try {
          await window.OfflineStore.setSource(nextSource);
        } catch (_) {
        }
      }

      this.loadingProgress = 100;
      this.filterDesc();
    },

    async importTranslatedZipFile(file) {
      if (!file) return;
      if (!offlineStoreReady) return;
      if (!this.lang) {
        alert('Please select a language in Settings first.');
        return;
      }
      if (!this.sourceLoaded || !Array.isArray(this.descs) || this.descs.length === 0) {
        alert('Please import the latest StatDescriptions.zip first.');
        return;
      }
      if (String(file?.name || '').toLowerCase() !== 'statdescriptions_translated.zip') {
        if (!confirm('This does not look like StatDescriptions_Translated.zip. Import anyway?')) return;
      }

      this.ensureLocalDescsReady();

      this.loadingProgress = 0.001;

      let zip;
      try {
        zip = await new JSZip().loadAsync(file);
      } catch (error) {
        this.loadingProgress = 100;
        alert('Cannot open this file');
        return;
      }

      const txtFileCount = this.countZipTxtFiles(zip);
      if (txtFileCount === 0) {
        this.loadingProgress = 100;
        alert('No .txt files found in this ZIP.');
        return;
      }
      if (txtFileCount >= ZIP_TXT_FILE_COUNT_THRESHOLD) {
        const ok = this.confirmProceedByTypingYes(
          "This ZIP looks like a full StatDescriptions export.\n\n" +
          `Found ${txtFileCount} .txt files (expected less than ${ZIP_TXT_FILE_COUNT_THRESHOLD} for a translated transfer ZIP).\n\n` +
          "This import mode is meant for moving translated data between PCs.\n" +
          "If you actually got a new export from the game data, use Import Next Version instead.\n\n" +
          "Type YES to proceed:",
          { confirmMessage: "Last warning: Import as translated anyway?" }
        );
        if (!ok) {
          this.loadingProgress = 100;
          return;
        }
      }

      const parseFuncs = getZipTxtFilepaths(zip).map(filepath => parseFile(filepath, zip.files[filepath], this.lang));

      let parsed = await allProgress(parseFuncs, (p) => {
        const percent = Math.max(0.001, Math.min(99.999, Number(p) || 0));
        this.loadingProgress = percent;
      });
      const importedDescs = parsed.filter(Boolean);

      const sourceMap = new Map((this.descs || []).filter(Boolean).map(d => [d.filepath, d]));

      const mismatchFiles = [];
      for (const imported of importedDescs) {
        const prev = sourceMap.get(imported?.filepath);
        if (!prev) {
          mismatchFiles.push(`${imported?.filepath || '(unknown)'}: file not found in current source`);
          continue;
        }
        const prevEng = Array.isArray(prev?.translations?.English) ? prev.translations.English : [];
        const impEng = Array.isArray(imported?.translations?.English) ? imported.translations.English : [];
        if (!arrayEquals(prevEng, impEng)) {
          mismatchFiles.push(`${imported.filepath}: English source text differs`);
          continue;
        }
        const impTr = Array.isArray(imported?.translations?.[this.lang]) ? imported.translations[this.lang] : null;
        if (!impTr) {
          mismatchFiles.push(`${imported.filepath}: missing "${this.lang}" translation block`);
          continue;
        }
        if (impTr.length !== prevEng.length) {
          mismatchFiles.push(`${imported.filepath}: translation line count differs`);
          continue;
        }
        const prevStats = Array.isArray(prev?.stats) ? prev.stats : [];
        const impStats = Array.isArray(imported?.stats) ? imported.stats : [];
        if (!arrayEquals(prevStats, impStats)) {
          mismatchFiles.push(`${imported.filepath}: stat list differs`);
          continue;
        }
        const prevVars = Array.isArray(prev?.variables) ? prev.variables : [];
        const impVars = Array.isArray(imported?.variables) ? imported.variables : [];
        if (!arrayEquals(prevVars, impVars)) {
          mismatchFiles.push(`${imported.filepath}: variables differ`);
          continue;
        }
        const prevRemarks = Array.isArray(prev?.remarks) ? prev.remarks : [];
        const impRemarks = Array.isArray(imported?.remarks) ? imported.remarks : [];
        if (!arrayEquals(prevRemarks, impRemarks)) {
          mismatchFiles.push(`${imported.filepath}: remarks differ`);
          continue;
        }
      }

      if (mismatchFiles.length > 0) {
        this.loadingProgress = 100;
        const head = mismatchFiles.slice(0, 12).join('\n');
        const more = mismatchFiles.length > 12 ? `\n… and ${mismatchFiles.length - 12} more` : '';
        alert(
          'Import aborted: source fields mismatch detected.\n\n' +
          head +
          more +
          '\n\nMake sure you imported the matching StatDescriptions.zip version before importing translations.'
        );
        return;
      }

      const oldWorkspaceMap = new Map((this.localDescs.descs || []).filter(Boolean).map(d => [d.filepath, d]));
      const now = Date.now();
      let changedCount = 0;
      let reviewClearedCount = 0;
      let trackedCount = 0;
      const changedPaths = new Set();

      for (const imported of importedDescs) {
        const desc = sourceMap.get(imported.filepath);
        if (!desc) continue;

        const engLen = Array.isArray(desc?.translations?.English) ? desc.translations.English.length : 0;
        const importedRaw = Array.isArray(imported?.translations?.[this.lang]) ? imported.translations[this.lang] : [];
        const importedLines = Array.from({ length: engLen }).map((_, i) => importedRaw[i] ?? "");

        let localDesc = oldWorkspaceMap.get(imported.filepath);
        const existing = Array.isArray(localDesc?.translations?.[this.lang])
          ? localDesc.translations[this.lang]
          : (Array.isArray(desc?.translations?.[this.lang]) ? desc.translations[this.lang] : []);
        const existingLines = Array.from({ length: engLen }).map((_, i) => existing[i] ?? "");

        const changed = !arrayEquals(existingLines, importedLines);
        const hasAnyTranslation = importedLines.some(v => String(v ?? '').trim() !== '');
        if (hasAnyTranslation) {
          const st = this.localDescs.status[imported.filepath] || {};
          if (st.needsReview || desc.needsReview) {
            desc.needsReview = false;
            st.needsReview = false;
            this.localDescs.status[imported.filepath] = st;
            reviewClearedCount++;
          }
        }

        if (!changed) {
          if (hasAnyTranslation) {
            desc.translations[this.lang] = importedLines;
            desc.isMissing = computeIsMissing(engLen, importedLines);
            desc.hasChanges = true;
            desc.needsReview = false;

            if (!localDesc) {
              localDesc = makeLocalDesc(desc, this.lang, importedLines, { hasChanges: true, isMissing: desc.isMissing });
              this.localDescs.descs.push(localDesc);
              oldWorkspaceMap.set(desc.filepath, localDesc);
            } else {
              updateLocalDesc(localDesc, desc, this.lang, importedLines, { hasChanges: true, isMissing: desc.isMissing });
            }
            trackedCount++;
          }
          continue;
        }

        changedCount++;
        changedPaths.add(imported.filepath);

        desc.translations[this.lang] = importedLines;
        desc.isMissing = computeIsMissing(engLen, importedLines);
        desc.hasChanges = true;
        desc.needsReview = false;

        const st = this.localDescs.status[imported.filepath] || {};
        st.needsReview = false;
        this.localDescs.status[imported.filepath] = st;

        if (!localDesc) {
          localDesc = makeLocalDesc(desc, this.lang, importedLines, { hasChanges: true, isMissing: desc.isMissing });
          this.localDescs.descs.push(localDesc);
          oldWorkspaceMap.set(desc.filepath, localDesc);
        } else {
          updateLocalDesc(localDesc, desc, this.lang, importedLines, { hasChanges: true, isMissing: desc.isMissing });
        }
      }

      if (!this.testMode && changedCount > 0 && window.OfflineStore && typeof window.OfflineStore.addRevision === 'function') {
        for (const imported of importedDescs) {
          const desc = sourceMap.get(imported?.filepath);
          if (!desc?.filepath) continue;
          if (!changedPaths.has(desc.filepath)) continue;

          const lines = Array.isArray(desc?.translations?.[this.lang]) ? desc.translations[this.lang] : [];
          const rev = {
            filepath: desc.filepath,
            filename: desc.filename,
            filedir: desc.filedir,
            lang: this.lang,
            savedAt: now,
            note: 'Import translated',
            isMissing: !!desc.isMissing,
            translations: lines,
          };

          try {
            const latest = await window.OfflineStore.getLatestRevision(desc.filepath, this.lang);
            if (!latest || !arrayEquals(latest.translations, lines)) await window.OfflineStore.addRevision(rev);
          } catch (_) {
          }

          const st = this.localDescs.status[desc.filepath] || {};
          st.lastTranslatedAt = now;
          st.lastEditedAt = now;
          this.localDescs.status[desc.filepath] = st;
        }
      }

      await this.saveLocalDescs();
      this.loadingProgress = 100;
      this.filterDesc();

      if (changedCount === 0 && reviewClearedCount === 0 && trackedCount === 0) {
        alert('No translation changes detected.');
      } else if (changedCount === 0) {
        const lines = [];
        if (reviewClearedCount > 0) lines.push(`Cleared needs-review on ${reviewClearedCount} file(s).`);
        if (trackedCount > 0) lines.push(`Marked ${trackedCount} file(s) for export.`);
        alert(lines.join('\n'));
      }
    },
    // Applies local workspace translations and status flags on top of the source descs.
    // For each file in descs it:
    // 1. Overlays the current language translations from localDescs.descs (or keeps source ones if none).
    // 2. Copies hasChanges flag from localDescs if present.
    // 3. Sets isMissing if any translation line is blank or count mismatch.
    // 4. Copies needsReview flag from localDescs.status.
    applyWorkspaceOverlay() {
      const overlay = Array.isArray(this.localDescs?.descs) ? this.localDescs.descs : [];
      const localByPath = new Map();
      for (const o of overlay) {
        if (!o || !o.filepath) continue;
        localByPath.set(o.filepath, o);
      }
      const statusByPath = (this.localDescs?.status && typeof this.localDescs.status === 'object') ? this.localDescs.status : {};

      for (const desc of this.descs || []) {
        const localDesc = localByPath.get(desc.filepath);
        const raw = Array.isArray(localDesc?.translations?.[this.lang])
          ? localDesc.translations[this.lang]
          : (Array.isArray(desc?.translations?.[this.lang]) ? desc.translations[this.lang] : []);
        const engLen = Array.isArray(desc?.translations?.English) ? desc.translations.English.length : 0;
        const merged = Array.from({ length: engLen }).map((_, i) => raw[i] ?? "");
        if (!desc.translations) desc.translations = { English: [] };
        desc.translations[this.lang] = merged;

        if (localDesc && typeof localDesc?.hasChanges !== 'undefined') {
          desc.hasChanges = !!localDesc.hasChanges;
        }

        desc.isMissing = computeIsMissing(engLen, merged);

        const st = statusByPath[desc.filepath];
        desc.needsReview = !!st?.needsReview;
      }
    },
    filterDesc() {
      this.filteredDescs = [];
      this.statistic.hasChanges = 0;
      this.statistic.isMissing = 0;
      this.statistic.needsReview = 0;
      for (const desc of this.descs) {
        if (this.hideDNT && desc.isDNT) continue;
        if (desc.hasChanges) {
          this.statistic.hasChanges++;
        }
        if (desc.isMissing) {
          this.statistic.isMissing++;
        } else {
          if (this.showOnlyMissing) continue;
        }
        if (desc.needsReview) {
          this.statistic.needsReview++;
        }

        if (this.filterSelect == "new" && !desc.isMissing && !desc.hasChanges && !desc.needsReview) continue;
        if (this.filterSelect == "blank" && !desc.isMissing) continue;
        if (this.filterSelect == "done" && !desc.hasChanges) continue;
        if (this.filterSelect == "review" && !desc.needsReview) continue;

        if (
          this.searchText.trim() == "" ||
          desc.filepath.toLocaleLowerCase().includes(this.searchText.toLocaleLowerCase()) ||
          desc.translations.English?.join("\n").toLocaleLowerCase().includes(this.searchText.toLocaleLowerCase()) ||
          desc.translations[this.lang]?.join("\n").toLocaleLowerCase().includes(this.searchText.toLocaleLowerCase())
        ) {
          let englishHtml = (desc.translations.English || []).join("<br />");
          let translationHtml = (desc.translations[this.lang] || []).join("<br />");
          this.filteredDescs.push({
            filepath: desc.filepath,
            filedir: desc.filedir,
            filename: desc.filename,
            english: englishHtml.replaceAll("\\n", "<br />"),
            translation: translationHtml.replaceAll("\\n", "<br />"),
            isMissing: desc.isMissing,
            hasChanges: desc.hasChanges,
            needsReview: !!desc.needsReview,
          });
        }
      }
      Vue.nextTick(() => {
        if (this.currentPage > this.pageCount) this.gotoPage(1);
        if (this.currentPage < 1) this.gotoPage(1);
      });
    },
    sort(s) {
      //if s == current sort, reverse
      if (s === this.currentSort) {
        this.currentSortDir = this.currentSortDir === 'asc' ? 'desc' : 'asc';
      }
      this.currentSort = s;
    },
    gotoPage(n) {
      if (n < 1) n = 1;
      if (n > this.pageCount) n = this.pageCount;
      this.currentPage = n;
    },
    prevPage() {
      if (this.currentPage > 1) this.currentPage--;
    },
    nextPage() {
      if ((this.currentPage * this.pageSize) < this.filteredDescs.length) this.currentPage++;
    },
    elipsisRenderer(data) {
      return data.length > 20 ?
        data.substr(0, 7) + '…' + data.substr(data.length - 13, data.length) :
        data;
    },
    getDescByFilepath(filepath) {
      return this.descs.find(o => o.filepath == filepath);
    },
    editFile(filepath) {
      let desc = this.getDescByFilepath(filepath);
      if (!desc) {
        alert('Unexpected Error! cannot find the file you want to edit!');
        return;
      }

      this.closeHlPopup();
      this.editorBlocks = [];
      this.editorOriginalTranslations = [];
      this.editorShowEnglishDiff = false;
      this.editorCompareActive = false;
      this.editorCompareTitle = '';
      this.editorCurrentEditingDesc = desc;
      for (let i = 0; i < desc.translations.English.length; i++) {
        let englishRaw = desc.translations.English[i] || "";
        let translationRaw = desc.translations[this.lang]?.[i] || "";
        let isMultiline = this.isMultilineText(englishRaw) || this.isMultilineText(translationRaw);
        let english = isMultiline ? this.decodeEscapedNewlines(englishRaw) : englishRaw;
        let translation = isMultiline ? this.decodeEscapedNewlines(translationRaw) : translationRaw;
        let { englishHLter: baseEnglishHLter, HLs } = this.buildEnglishHLter(english);
        let englishHLter = baseEnglishHLter;
        let translationHLter = this.buildTagHLter(translation ?? "");
        let multilineLineMismatch = false;
        if (isMultiline) {
          let diff = this.computeMultilineLineMismatch(english, translation);
          englishHLter = this.wrapHlterByLines(baseEnglishHLter, diff.engMismatch);
          translationHLter = this.wrapHlterByLines(this.buildTagHLter(translation ?? ""), diff.trMismatch);
          multilineLineMismatch = diff.mismatch;
        }
        this.editorOriginalTranslations.push(translation);
        let engStats = this.computeTextStats(english);
        let trStats = this.computeTextStats(translation);
        this.editorBlocks.push({
          isMultiline,
          english,
          englishHLter,
          HLs,
          englishDiffHtml: escapeHtml(String(english ?? '')),
          translation,
          translationHLter,
          translationDiffHtml: escapeHtml(String(translation ?? '')),
          multilineLineMismatch,
          metaLinesEn: engStats.lines,
          metaLinesTr: trStats.lines,
          metaVarsEn: engStats.vars,
          metaVarsTr: trStats.vars,
          metaKwEn: engStats.kw,
          metaKwTr: trStats.kw,
          translationReplace: "",
          words: []
        })
      }
      this.editorVisible = true;
      this.editorFocusedIndex = 0;
      this.$nextTick(() => {
        this.$refs['translation_0'].focus();
        this.autosizeEditorMultilineFields();
        for (let i = 0; i < (this.editorBlocks || []).length; i++) {
          if (!this.editorBlocks[i]?.isMultiline) continue;
          this.syncHlScroll('english', i);
          this.syncHlScroll('translation', i);
        }
        this.refreshGamePreview();
      });
      if (this.sideTab === 'history') this.refreshHistory();
      if (desc.needsReview) {
        this.editorShowEnglishDiff = true;
        this.prepareEditorEnglishDiff();
      }
    },
    copySpanToTranslation(e, editorBlock, editorIndex) {
      this.$refs['translation_' + editorIndex].focus();
      document.execCommand("insertText", false, e.target.getAttribute('datavalue'));
    },
    copySpanToClipboard(e) {
      navigator.clipboard.writeText(e.target.getAttribute('datavalue'))
    },
    altClickHighlight(e, editorBlock) {
      let target = e?.target;
      if (!target?.getAttribute) return;
      let hlId = target.getAttribute('data-hl-id');
      if (!hlId) return;
      let HL = (editorBlock?.HLs || []).find(hl => String(hl?._hlId) === String(hlId));
      if (!HL?.isKeywordPopup) return;

      let tagName = unescapeHtml(HL.tagName || "").trim();
      if (!tagName) return;

      let alt = unescapeHtml(HL.dynamicContent || "").trim();
      if (alt.includes("<")) alt = "";
      alt = alt.trim();
      this.ensureDictionaryKeywordTag(tagName, alt);
    },
    hotkeyPasteHL(e, editorBlock, editorIndex) {
      let id = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'].indexOf(e.code);
      if (id < 0) return;
      if (!editorBlock.HLs[id]) return;
      let text = editorBlock.HLs[id].replace || editorBlock.HLs[id].find;
      document.execCommand("insertText", false, text);
    },
    editorShiftEnter() {
      if (this.shiftEnterSave) this.editorSave();
    },
    editorSave() {
      if (this.editorCompareActive) return;
      let desc = this.editorCurrentEditingDesc;
      let newTranslations = [];
      for (const editorBlock of this.editorBlocks) {
        let ui = editorBlock?.translation ?? "";
        let normalizedUi = editorBlock?.isMultiline ? this.decodeEscapedNewlines(ui) : ui;
        newTranslations.push(this.encodeNewlines(normalizedUi));
      }

      const isMissing = computeIsMissing(Array.isArray(desc?.translations?.English) ? desc.translations.English.length : 0, newTranslations);
      if (isMissing && !confirm("There're missing field in translation!\nAre you sure you want to save?")) return;

      let lineMismatchInfo = [];
      for (let i = 0; i < (this.editorBlocks || []).length; i++) {
        let b = this.editorBlocks[i];
        let engLines = this.computeTextStats(b?.english ?? "").lines;
        let trLines = this.computeTextStats(b?.translation ?? "").lines;
        if (engLines !== trLines) lineMismatchInfo.push(`#${i + 1}: ${trLines}/${engLines}`);
      }
      if (lineMismatchInfo.length > 0) {
        let details = lineMismatchInfo.slice(0, 12).join("\n");
        let suffix = lineMismatchInfo.length > 12 ? `\n...and ${lineMismatchInfo.length - 12} more` : "";
        if (!confirm(`Number of lines mismatched!\n(Translation/English)\n\n${details}${suffix}\n\nDo you want to save anyway?`)) return;
      }

      let newTagCount = newTranslations.reduce((p, c) => p += countGGGVarTag(c), 0);
      let engTagCount = desc.translations.English.reduce((p, c) => p += countGGGVarTag(c), 0);
      if (newTagCount != engTagCount && !confirm("Number of variable tags ({} tag) mismatched!\nDo you want to save anyway?")) return;

      let newKeywordPopupTagCount = newTranslations.reduce((p, c) => p += countKeywordPopupTag(c), 0);
      let engKeywordPopupTagCount = desc.translations.English.reduce((p, c) => p += countKeywordPopupTag(c), 0);
      if (newKeywordPopupTagCount != engKeywordPopupTagCount && !confirm("Number of keyword popup tags ([] tag) mismatched!\nDo you want to save anyway?")) return;

      desc.isMissing = isMissing;
      if (!arrayEquals(desc.translations[this.lang], newTranslations)) desc.hasChanges = true;
      desc.translations[this.lang] = newTranslations;

      if (desc.needsReview && desc.hasChanges) {
        desc.needsReview = false;
        this.ensureLocalDescsReady();
        const st = this.localDescs.status[desc.filepath] || {};
        st.needsReview = false;
        this.localDescs.status[desc.filepath] = st;
      }

      // save to localDescs too
      this.ensureLocalDescsReady();
      let localDesc = this.localDescs.descs.find(o => o.filepath == desc.filepath);
      if (!localDesc) {
        localDesc = makeLocalDesc(desc, this.lang, newTranslations, { hasChanges: desc.hasChanges, isMissing: desc.isMissing });
        this.localDescs.descs.push(localDesc);
      } else {
        updateLocalDesc(localDesc, desc, this.lang, newTranslations, { hasChanges: desc.hasChanges, isMissing: desc.isMissing });
      }
      this.saveLocalDescs();
      this.commitRevision(desc, newTranslations, { note: 'Save' });

      this.saveSettings();
      this.closeHlPopup();
      this.editorOriginalTranslations = (this.editorBlocks || []).map(b => b?.translation ?? "");
      this.editorVisible = false;
      this.filterDesc();
    },
    async refreshHistory() {
      if (!this.editorCurrentEditingDesc) {
        this.historyItems = [];
        this.historySelectedA = null;
        this.historySelectedB = null;
        this.historyDiffHtml = '';
        this.historyFilepath = '';
        this.historyLang = '';
        return;
      }
      const filepath = this.editorCurrentEditingDesc.filepath;
      const lang = this.historyMode === 'source' ? 'English' : this.lang;

      this.historyLoading = true;
      try {
        if (window.OfflineStore && typeof window.OfflineStore.listRevisions === 'function') {
          const items = await window.OfflineStore.listRevisions(filepath, lang, 100);
          this.historyItems = (Array.isArray(items) ? items : []).map((it, idx) => {
            if (idx !== 0) return it;
            return {
              ...it,
              note: `${it?.note ? String(it.note) + ' ' : ''}(current)`
            };
          });
        } else {
          this.historyItems = [];
        }
      } catch (_) {
        this.historyItems = [];
      } finally {
        this.historyLoading = false;
      }

      this.historySelectedA = this.historyItems?.[0] || null;
      this.historySelectedB = null;
      this.historyDiffHtml = '';
      this.historyFilepath = filepath;
      this.historyLang = lang;

      if (this.editorCompareActive) this.exitEditorCompareMode();
    },
    setHistoryMode(mode) {
      if (mode !== 'translation' && mode !== 'source') return;
      this.historyMode = mode;
      if (this.sideTab === 'history') this.refreshHistory();
    },
    pickHistoryRevision(rev) {
      if (!rev) return;
      const cur = this.historyItems?.[0] || null;
      if (!cur) return;

      const sameRev = (a, b) => {
        if (!a || !b) return false;
        if (a.id != null && b.id != null) return String(a.id) === String(b.id);
        return String(a.savedAt) === String(b.savedAt) && String(a.lang) === String(b.lang) && String(a.filepath) === String(b.filepath);
      };

      this.historySelectedA = cur;

      if (sameRev(rev, cur)) {
        this.historySelectedB = null;
        this.historyDiffHtml = '';
        if (this.editorCompareActive) this.exitEditorCompareMode();
        return;
      }

      if (this.historySelectedB && sameRev(rev, this.historySelectedB)) {
        this.historySelectedB = null;
        this.historyDiffHtml = '';
        if (this.editorCompareActive) this.exitEditorCompareMode();
        return;
      }

      this.historySelectedB = rev;
      this.historyDiffHtml = this.buildHistoryDiffHtml(cur, rev);
      this.enterEditorCompareModeFromHistory();
    },
    enterEditorCompareModeFromHistory() {
      if (!this.editorVisible) return;
      if (!this.editorCurrentEditingDesc) return;
      if (!this.historySelectedA || !this.historySelectedB) return;

      const mode = this.historyMode === 'source' ? 'source' : 'translation';
      this.editorCompareActive = true;
      this.editorCompareMode = mode;
      const aLabel = this.formatHistoryTime(this.historySelectedA?.savedAt);
      const bLabel = this.formatHistoryTime(this.historySelectedB?.savedAt);
      this.editorCompareTitle = `${mode === 'source' ? 'Source' : 'Translation'} compare: ${aLabel} → ${bLabel}`;

      if (mode === 'source') {
        this.editorShowEnglishDiff = true;
      } else {
        this.editorShowEnglishDiff = false;
      }

      const aLines = Array.isArray(this.historySelectedA?.translations) ? this.historySelectedA.translations : [];
      const bLines = Array.isArray(this.historySelectedB?.translations) ? this.historySelectedB.translations : [];
      const curEng = Array.isArray(this.editorCurrentEditingDesc?.translations?.English) ? this.editorCurrentEditingDesc.translations.English : [];
      const curTr = Array.isArray(this.editorCurrentEditingDesc?.translations?.[this.lang]) ? this.editorCurrentEditingDesc.translations[this.lang] : [];

      for (let i = 0; i < (this.editorBlocks || []).length; i++) {
        const block = this.editorBlocks[i];
        if (!block) continue;

        if (mode === 'source') {
          const oldRaw = aLines[i] ?? '';
          const newRaw = bLines[i] ?? '';
          const oldStr = this.isMultilineText(oldRaw) ? this.decodeEscapedNewlines(String(oldRaw)) : String(oldRaw);
          const newStr = this.isMultilineText(newRaw) ? this.decodeEscapedNewlines(String(newRaw)) : String(newRaw);
          block.englishDiffHtml = this.renderInlineDiffHtml(oldStr, newStr);
          const engRaw = curEng[i] ?? '';
          const engStr = this.isMultilineText(engRaw) ? this.decodeEscapedNewlines(String(engRaw)) : String(engRaw);
          block.english = engStr;
          const trRaw = curTr[i] ?? '';
          block.translationDiffHtml = escapeHtml(String(trRaw ?? ''));
        } else {
          const oldRaw = aLines[i] ?? '';
          const newRaw = bLines[i] ?? '';
          const oldStr = this.isMultilineText(oldRaw) ? this.decodeEscapedNewlines(String(oldRaw)) : String(oldRaw);
          const newStr = this.isMultilineText(newRaw) ? this.decodeEscapedNewlines(String(newRaw)) : String(newRaw);
          block.translationDiffHtml = this.renderInlineDiffHtml(oldStr, newStr);
          const engRaw = curEng[i] ?? '';
          const engStr = this.isMultilineText(engRaw) ? this.decodeEscapedNewlines(String(engRaw)) : String(engRaw);
          block.english = engStr;
        }
      }
    },
    exitEditorCompareMode() {
      this.editorCompareActive = false;
      this.editorCompareTitle = '';
      this.editorShowEnglishDiff = false;
      if (this.editorCurrentEditingDesc) {
        this.editFile(this.editorCurrentEditingDesc.filepath);
      }
    },
    clearHistorySelection() {
      this.historySelectedA = this.historyItems?.[0] || null;
      this.historySelectedB = null;
      this.historyDiffHtml = '';
      if (this.editorCompareActive) this.exitEditorCompareMode();
    },
    formatHistoryTime(ts) {
      if (!ts) return '';
      try {
        return new Date(ts).toLocaleString();
      } catch (_) {
        return String(ts);
      }
    },
    buildHistoryDiffHtml(aRev, bRev) {
      const aLines = Array.isArray(aRev?.translations) ? aRev.translations : [];
      const bLines = Array.isArray(bRev?.translations) ? bRev.translations : [];
      const edits = myersLineDiff(aLines, bLines);
      return renderUnifiedLineDiff(edits);
    },
    async restoreHistoryRevision(rev) {
      const desc = this.editorCurrentEditingDesc;
      if (!desc || !rev) return;
      if (this.historyMode === 'source' || String(rev?.lang) === 'English') {
        alert('Restoring source English text is disabled.');
        return;
      }
      if (desc.filepath !== rev.filepath || this.lang !== rev.lang) {
        alert('Cannot restore: revision does not match the currently opened file/language.');
        return;
      }
      if (!confirm('Restore this revision?')) return;

      if (this.editorCompareActive) this.exitEditorCompareMode();

      const lines = Array.isArray(rev.translations) ? rev.translations : [];
      desc.isMissing = computeIsMissing(Array.isArray(desc?.translations?.English) ? desc.translations.English.length : 0, lines);
      if (!arrayEquals(desc.translations[this.lang], lines)) desc.hasChanges = true;
      desc.translations[this.lang] = lines;

      if (desc.needsReview && desc.hasChanges) {
        desc.needsReview = false;
        this.ensureLocalDescsReady();
        const st = this.localDescs.status[desc.filepath] || {};
        st.needsReview = false;
        this.localDescs.status[desc.filepath] = st;
      }

      this.ensureLocalDescsReady();
      let localDesc = this.localDescs.descs.find(o => o.filepath == desc.filepath);
      if (!localDesc) {
        localDesc = makeLocalDesc(desc, this.lang, lines, { hasChanges: desc.hasChanges, isMissing: desc.isMissing });
        this.localDescs.descs.push(localDesc);
      } else {
        updateLocalDesc(localDesc, desc, this.lang, lines, { hasChanges: desc.hasChanges, isMissing: desc.isMissing });
      }

      await this.saveLocalDescs();
      await this.commitRevision(desc, lines, { note: 'Restore' });
      this.filterDesc();
      if (this.editorVisible) this.editFile(desc.filepath);
      await this.refreshHistory();
    },
    async commitRevision(desc, translations, { note } = {}) {
      if (!desc || !Array.isArray(translations)) return;
      if (this.testMode) return;
      if (!(window.OfflineStore && typeof window.OfflineStore.addRevision === 'function')) return;

      const rev = {
        filepath: desc.filepath,
        filename: desc.filename,
        filedir: desc.filedir,
        lang: this.lang,
        savedAt: Date.now(),
        note: note || '',
        isMissing: !!desc.isMissing,
        translations: translations,
      };

      try {
        const latest = await window.OfflineStore.getLatestRevision(desc.filepath, this.lang);
        if (latest && arrayEquals(latest.translations, translations)) return;
      } catch (_) {
      }

      try {
        await window.OfflineStore.addRevision(rev);
      } catch (_) {
      }

      this.ensureLocalDescsReady();
      const st = this.localDescs.status[desc.filepath] || {};
      st.lastTranslatedAt = rev.savedAt;
      st.lastEditedAt = rev.savedAt;
      this.localDescs.status[desc.filepath] = st;
      await this.saveLocalDescs();
    },
    editorEsc(e) {
      if (e?.defaultPrevented) return;
      if (this.hlPopup.visible) {
        e?.preventDefault();
        this.closeHlPopup({ refocus: true });
        return;
      }
      this.editorExit();
    },
    editorExit() {
      let original = (this.editorOriginalTranslations || []).map(v => v ?? "");
      let current = (this.editorBlocks || []).map(b => b?.translation ?? "");
      if (!arrayEquals(original, current) && !confirm('Are you sure you want to exit without saving?')) return;
      this.saveSettings();
      this.closeHlPopup();
      this.editorVisible = false;
    },
    async saveSettings() {
      if (!offlineStoreReady) return;
      let settings = {
        editorRegexes: this.editorRegexes,
        dictionary: this.dictionary,
        editorClipboard: this.editorClipboard,
        lang: this.lang,
        theme: this.theme,
        hideDNT: this.hideDNT,
        highlightDict: this.highlightDict,
        shiftEnterSave: this.shiftEnterSave,
        uiDensity: this.uiDensity,
        gamePreviewFrame: this.gamePreviewFrame,
        gamePreviewFonts: this.gamePreviewFonts,
      }
      if (window.OfflineStore && typeof window.OfflineStore.setSettings === 'function') {
        try {
          const plain = this.toPlainForStorage(settings);
          if (!plain) throw new Error('Cannot serialize settings');
          await window.OfflineStore.setSettings(plain);
        } catch (_) {
        }
      }
    },
    exportSettingsClicked() {
      let settings = {
        editorRegexes: this.editorRegexes,
        dictionary: this.dictionary,
        editorClipboard: this.editorClipboard,
        lang: this.lang,
        theme: this.theme,
        hideDNT: this.hideDNT,
        highlightDict: this.highlightDict,
        shiftEnterSave: this.shiftEnterSave,
        uiDensity: this.uiDensity,
        gamePreviewFrame: this.gamePreviewFrame,
        gamePreviewFonts: this.gamePreviewFonts,
      }
      let settingsStr = JSON.stringify(settings, null, 2);
      var settingsBlob = new Blob([settingsStr], {});
      saveAs(settingsBlob, "sdeditor_settings.json");
    },
    importSettingsClicked() {
      this.$refs.importSettingsFile.click();
    },
    importSettingsFileChanged(e) {
      var fr = new FileReader();
      let vueThis = this;
      fr.onload = function () {
        let settings;
        try {
          settings = JSON.parse(fr.result);
        } catch (error) {
          alert("This is not JSON settings file");
          return;
        }
        if (prompt('Are you sure you want to overwrite current settings with this file?\n\nType "YES" to continue') !== "YES") {
          vueThis.$refs.importSettingsFileForm.reset();
          return;
        }

        vueThis.importSettings(settings);
        alert('Settings imported!');
        vueThis.$refs.importSettingsFileForm.reset();
      }
      fr.readAsText(e.target.files[0]); 
    },
    importSettings(settings) {
      this.editorRegexes = settings.editorRegexes || [];
      this.dictionary = settings.dictionary || [];
      this.ensureDictionaryIds();
      this.editorClipboard = settings.editorClipboard || "";
      if (settings.lang) this.lang = settings.lang;
      if (settings.theme) this.theme = settings.theme;
      if (typeof settings.hideDNT !== 'undefined') this.hideDNT = !!settings.hideDNT;
      if (typeof settings.highlightDict !== 'undefined') this.highlightDict = !!settings.highlightDict;
      if (typeof settings.shiftEnterSave !== 'undefined') this.shiftEnterSave = !!settings.shiftEnterSave;
      if (settings.uiDensity === 'compact' || settings.uiDensity === 'spacious') {
        this.uiDensity = settings.uiDensity;
      } else {
        this.uiDensity = 'compact';
      }
      if (settings.gamePreviewFrame === 's' || settings.gamePreviewFrame === 'm' || settings.gamePreviewFrame === 'l') {
        this.gamePreviewFrame = settings.gamePreviewFrame;
      }
      if (settings.gamePreviewFonts && typeof settings.gamePreviewFonts === 'object' && !Array.isArray(settings.gamePreviewFonts)) {
        this.gamePreviewFonts = settings.gamePreviewFonts;
      }
    },
    async saveLocalDescs() {
      if (!offlineStoreReady) return;
      if (window.OfflineStore && typeof window.OfflineStore.setWorkspace === 'function') {
        try {
          const plain = this.toPlainForStorage(this.localDescs);
          if (!plain) throw new Error('Cannot serialize workspace');
          await window.OfflineStore.setWorkspace(plain);
        } catch (_) {
        }
      }
    },
    useRegex(editorBlock) {
      this.sideTab = 'regex';
      let regexEngineResult = regexEngineLookup(editorBlock.english, this.editorRegexes);
      editorBlock.words = [];
      for (const word of regexEngineResult.words) {
        editorBlock.words.push({
          captured: word,
          replace: word,
        })
      }
      editorBlock.translationReplace = regexEngineResult.replace;
      this.doTranslationReplace(editorBlock);
      
      if (regexEngineResult.failed) {
        if (confirm("No match for:\n" + regexEngineResult.failStr + "\n\nCreate new regex for it?")) {
          let r = regexEngineCreate(regexEngineResult.failStr, this.dictionary);
          this.addRegex(r.find, r.replace);
        }
      }
    },
    doTranslationReplace(editorBlock, force) {
      if (!editorBlock.translationReplace) return;
      let editorIndex = this.editorBlocks?.indexOf?.(editorBlock);
      if (typeof editorIndex !== "number" || editorIndex < 0) editorIndex = undefined;
      editorBlock.translation = editorBlock.translationReplace;
      if (typeof editorIndex === "number") this.normalizeMultilineEditorBlock(editorBlock, editorIndex);
      for (let i = 0; i < editorBlock.words.length; i++) {
        const word = editorBlock.words[i];
        for (const replacerObj of this.dictionary) {
          let mainRegex = this.safeExactRegex(replacerObj.find, "igm");
          let m = mainRegex.exec(word.captured);
          if (m) {
            if (!force) word.replace = replacerObj.replace;
            continue;
          }
          for (const alt of (Array.isArray(replacerObj?.alts) ? replacerObj.alts : [])) {
            if (!alt || typeof alt !== "object") continue;
            let altFind = alt.find;
            let altReplace = alt.replace ?? replacerObj.replace;
            let altRegex = this.safeExactRegex(altFind, "i");
            if (!altRegex.test(word.captured)) continue;
            if (!force) word.replace = altReplace;
            break;
          }
        }
        if (!word.replace) word.replace = "";
        editorBlock.translation = editorBlock.translation.replace('🔖', word.replace);
      }
      if (typeof editorIndex === "number") this.refreshEditorBlockMeta(editorBlock, editorIndex);
      this.refreshGamePreview();
    },
    addRegex(find="", replace="") {
      this.editorRegexes.unshift({ find, replace });
      this.saveSettings();
    },
    removeRegex(regex) {
      if (!confirm(`Are you sure you want to remove this regex?\n\n#${regex.find}\n${regex.replace}`)) return;
      this.editorRegexes = this.editorRegexes.filter(o => o !== regex);
      this.saveSettings();
    },
    moveRegexUp(regex) {
      for (let i = 0; i < this.editorRegexes.length; i++) {
        const r = this.editorRegexes[i];
        if (r == regex) {
          if (i <= 0) return;
          arrayMove(this.editorRegexes, i, i-1);
          this.saveSettings();
          return;
        }
      }
    },
    moveRegexDown(regex) {
      for (let i = 0; i < this.editorRegexes.length; i++) {
        const r = this.editorRegexes[i];
        if (r == regex) {
          if (i >= this.editorRegexes.length-1) return;
          arrayMove(this.editorRegexes, i, i + 1);
          this.saveSettings();
          return;
        }
      }
    },
    addVocab() {
      this.dictionary.unshift({ _id: `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`, find: "", replace: "", alts: [], tlnote: "" });
      this.saveSettings();
    },
    removeVocab(word) {
      if (!confirm(`Are you sure you want to remove this word?\n\n#${word.find}\n${word.replace}`)) return;
      this.dictionary = this.dictionary.filter(o => o !== word);
      this.saveSettings();
    },
    async exportZip(doFullExport) {
      if (doFullExport && !confirm("Are you sure you want to do a full export?\nNote: This may take a couple minutes")) return;
      let descsToExport = doFullExport
        ? (this.descs || []).filter(o => !o.needsReview)
        : (this.descs || []).filter(o => o.hasChanges);
      if (!descsToExport.length) {
        alert(`There're no files to be export!`);
        return;
      }

      this.loadingProgress = 0.001;
      let vueThis = this;
      let zip = new JSZip();
      for (const desc of descsToExport) {
        let buffer = descEncode(desc);
        zip.file(desc.filepath, buffer);
      }
      let zippedBuffer = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 5 } }, function (metadata) {
        vueThis.loadingProgress = 0.001 + (metadata.percent * 0.999);
      });
      this.loadingProgress = 100;
      saveAs(zippedBuffer, "StatDescriptions_Translated.zip");
    }
  },
});

function myersLineDiff(aLines, bLines) {
  const a = Array.isArray(aLines) ? aLines : [];
  const b = Array.isArray(bLines) ? bLines : [];
  const N = a.length;
  const M = b.length;
  const max = N + M;

  let v = new Map();
  v.set(1, 0);
  const trace = [];

  for (let d = 0; d <= max; d++) {
    const vNew = new Map();
    for (let k = -d; k <= d; k += 2) {
      let x;
      const vKMinus = v.get(k - 1);
      const vKPlus = v.get(k + 1);
      if (k === -d || (k !== d && (vKMinus ?? -Infinity) < (vKPlus ?? -Infinity))) {
        x = vKPlus ?? 0;
      } else {
        x = (vKMinus ?? 0) + 1;
      }
      let y = x - k;
      while (x < N && y < M && a[x] === b[y]) {
        x++;
        y++;
      }
      vNew.set(k, x);
      if (x >= N && y >= M) {
        trace.push(vNew);
        return myersBacktrack(trace, a, b);
      }
    }
    trace.push(vNew);
    v = vNew;
  }
  return a.map(line => ({ type: 'equal', line }));
}

function myersBacktrack(trace, a, b) {
  let x = a.length;
  let y = b.length;
  const edits = [];

  for (let d = trace.length - 1; d >= 0; d--) {
    const v = trace[d];
    const k = x - y;
    const prevV = d > 0 ? trace[d - 1] : new Map([[0, 0]]);
    let prevK;

    const prevKMinus = prevV.get(k - 1);
    const prevKPlus = prevV.get(k + 1);
    if (k === -d || (k !== d && (prevKMinus ?? -Infinity) < (prevKPlus ?? -Infinity))) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = prevV.get(prevK) ?? 0;
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      edits.push({ type: 'equal', line: a[x - 1] });
      x--;
      y--;
    }

    if (d === 0) break;

    if (x === prevX) {
      edits.push({ type: 'insert', line: b[y - 1] });
      y--;
    } else {
      edits.push({ type: 'delete', line: a[x - 1] });
      x--;
    }
  }

  edits.reverse();
  return edits;
}

function renderUnifiedLineDiff(edits) {
  const safeEdits = Array.isArray(edits) ? edits : [];
  return safeEdits.map(e => {
    const type = e?.type;
    const rawLine = e?.line ?? '';
    const line = escapeHtml(String(rawLine));
    if (type === 'insert') return `<div class="diffLine add"><span class="diffPrefix">+</span>${line}</div>`;
    if (type === 'delete') return `<div class="diffLine del"><span class="diffPrefix">-</span>${line}</div>`;
    return `<div class="diffLine"><span class="diffPrefix"> </span>${line}</div>`;
  }).join('');
}

const app = Vue.createApp(config);
app.mount('#app');
