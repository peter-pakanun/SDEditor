// Guess what "I'll make a simple Vue runtime app and just refactor later" did to me...
let offlineStoreReady = false;

const urlParams = new URLSearchParams(window.location.search);
const TEST_MODE = (() => {
  if (!urlParams.has('testMode')) return false;
  let v = (urlParams.get('testMode') || '').toLowerCase();
  return v === '' || v === '1' || v === 'true' || v === 'yes';
})();
const URL_LANG = urlParams.get('lang');
const ZIP_TXT_FILE_COUNT_THRESHOLD = 5000;
const GAME_VERSIONS = {
  poe1: { id: 'poe1', label: 'PoE1', title: 'Path of Exile 1' },
  poe2: { id: 'poe2', label: 'PoE2', title: 'Path of Exile 2' },
};

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

const AppTooltip = {
  props: {
    state: {
      type: Object,
      required: true
    }
  },
  computed: {
    lines() {
      return String(this.state?.text || "").split(/\r?\n/);
    },
    tooltipStyle() {
      return {
        left: `${this.state?.x || 0}px`,
        top: `${this.state?.y || 0}px`,
        maxWidth: `${this.state?.maxWidth || 360}px`
      };
    }
  },
  template: `
    <div v-if="state.visible && state.text" class="appTooltip" :style="tooltipStyle" role="tooltip">
      <div v-for="(line, i) in lines" :key="i">{{ line || ' ' }}</div>
    </div>
  `
};

function escapeTooltipAttr(value) {
  return escapeHtml(String(value ?? "")).replace(/\r\n|\r|\n/g, "&#10;");
}

const config = Vue.defineComponent({
  data() {
    return {
      offlineStoreReady: false,
      testMode: TEST_MODE,
      gameVersion: "",
      gameVersionSelected: false,
      pendingSingleVersionMigration: null,
      migrationInProgress: false,
      versionStorageLoading: false,
      langs: [
        "French",
        "German",
        "Japanese",
        "Korean",
        "Portuguese",
        "Russian",
        "Simplified Chinese",
        "Spanish",
        "Thai",
        "Traditional Chinese",
      ],
      lang: "",
      theme: 'light',
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
      hideSourceInPreviewPanel: false,
      highlightDict: true,
      shiftEnterSave: false,
      autoOpenNextFile: true,
      filterShortcutCtrlD: false,
      uiDensity: 'compact',

      sideTab: 'dictionary',
      dictionaryFilter: '',
      regexFilter: '',
      dictionaryFlashId: '',

      importDialogVisible: false,
      duplicateLangImportWarning: null,
      pendingDuplicateLangImport: null,

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
      editorFocusedColumnIndex: 0,
      editorOriginalTranslations: [],
      editorShowEnglishDiff: false,
      editorCompareActive: false,
      editorCompareMode: 'translation',
      editorCompareTitle: '',
      hlPopup: {
        visible: false,
        editorIndex: 0,
        openedByBracket: false,
        openedByChar: "",
        items: [],
        filtered: [],
        filter: "",
        selectedIndex: 0,
        x: 0,
        y: 0,
        columnIndex: 0,
        width: 0,
        maxHeight: 0,
        selectedTranslationText: ""
      },
      tooltip: {
        visible: false,
        text: "",
        x: 0,
        y: 0,
        maxWidth: 360
      },
      hlPopupReturnInfo: null,
      editorBlocks: [
        {
          english: "+1 to Maximum [EnergyShield|Energy Shield] per {0} [ItemEvasion|Item Evasion] on Equipped Body Armour",
          englishHLter: "+1 to Maximum <span>[EnergyShield|Energy Shield]</span> per <span>{0}%</span> <span>[ItemEvasion|Item Evasion]</span> on Equipped Body Armour",
          englishDiffHtml: "",
          translation: "",
          isTable: false,
          isMultiline: false,
          tableColumns: [],
          translationDiagnostics: [],
          diagnosticWarningCount: 0,
          diagnosticErrorCount: 0,
          metaLinesEn: 0,
          metaLinesTr: 0,
          metaColsEn: 0,
          metaColsTr: 0,
          metaVarsEn: 0,
          metaVarsTr: 0,
          metaKwEn: 0,
          metaKwTr: 0,
          metaDecorEn: 0,
          metaDecorTr: 0,
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
      gamePreviewSourceSegments: [],
      gamePreviewSegments: [],
      
      // Multi-instance detection
      showMultiInstanceGate: false,
      instanceTabId: Math.random().toString(36).substr(2, 9),
      multiInstanceCheckTimer: null,
      multiInstanceBypass: false,
    }
  },
  async mounted() {
    if (this.testMode) {
      this.gameVersion = 'poe1';
      this.gameVersionSelected = true;
      this.updateDocumentTitle();
      this.lang = (URL_LANG && this.langs.includes(URL_LANG)) ? URL_LANG : (this.langs[0] || "Thai");
      this.needsInitialSettings = false;
      this.loadingProgress = 0;
      this.ensureDictionaryIds();
      document.addEventListener('keydown', this.handleKeydown);
      this.loadDummyData();
      return;
    }

    // Check for multiple instances early
    this.checkMultipleInstances();
    this.startMultiInstanceCheck();

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


    this.needsInitialSettings = !this.lang;
    offlineStoreReady = true;
    this.offlineStoreReady = true;
    this.ensureDictionaryIds();
    document.addEventListener('keydown', this.handleKeydown);

    await this.saveSettings();
    this.updateDocumentTitle();
  },
  beforeDestroy() {
    document.removeEventListener('keydown', this.handleKeydown);
    // Clean up multi-instance detection
    if (this.multiInstanceCheckTimer) {
      clearInterval(this.multiInstanceCheckTimer);
    }
    if (this._broadcastChannel) {
      this._broadcastChannel.close();
    }
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
    autoOpenNextFile() {
      this.saveSettings();
    },
    filterShortcutCtrlD() {
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
    gameVersionLabel() {
      return GAME_VERSIONS[this.gameVersion]?.label || '';
    },
    needsPostMigrationImport() {
      if (this.versionStorageLoading) return false;
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
    editorTranslationReadOnly() {
      return this.editorCompareActive && this.editorCompareMode === 'translation';
    },
    editorDiagnosticWarningCount() {
      return this.collectEditorDiagnostics("warning").length;
    },
    editorDiagnosticErrorCount() {
      return this.collectEditorDiagnostics("error").length;
    },
    editorDiagnosticWarningTitle() {
      return this.formatDiagnosticsForDisplay(this.collectEditorDiagnostics("warning"), 10);
    },
    editorDiagnosticErrorTitle() {
      return this.formatDiagnosticsForDisplay(this.collectEditorDiagnostics("error"), 10);
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
    gamePreviewSourceFontFamily() {
      return this.getGamePreviewFontFamily("English");
    },
    gamePreviewVarKeyList() {
      let seen = new Set();
      let out = [];
      let segments = [
        ...(this.hideSourceInPreviewPanel ? [] : (this.gamePreviewSourceSegments || [])),
        ...(this.gamePreviewSegments || []),
      ];
      for (const seg of segments) {
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
    normalizeGameVersion(version) {
      const v = String(version || '').toLowerCase();
      return v === 'poe2' ? 'poe2' : 'poe1';
    },
    formatGameVersion(version) {
      const v = this.normalizeGameVersion(version);
      return GAME_VERSIONS[v]?.label || v.toUpperCase();
    },
    updateDocumentTitle() {
      document.title = this.gameVersionSelected && this.gameVersionLabel
        ? `SDEditor - ${this.gameVersionLabel}`
        : 'SDEditor';
    },
    detectGameVersionFromFilepaths(filepaths) {
      const paths = (Array.isArray(filepaths) ? filepaths : [])
        .map(p => String(p || '').replaceAll('\\', '/').replace(/^\/+/, '').toLowerCase())
        .filter(Boolean);

      for (const path of paths) {
        if (path.includes('specific_skill_stat_descriptions/explosive_grenade')) return 'poe2';
      }

      for (const path of paths) {
        const marker = 'specific_skill_stat_descriptions/';
        const idx = path.indexOf(marker);
        if (idx < 0) continue;
        const rest = path.slice(idx + marker.length);
        const parts = rest.split('/').filter(Boolean);
        if (parts.length >= 2) return 'poe2';
      }

      return 'poe1';
    },
    detectGameVersionFromDescs(descs) {
      const paths = [];
      for (const desc of (Array.isArray(descs) ? descs : [])) {
        if (desc?.filepath) paths.push(desc.filepath);
      }
      return this.detectGameVersionFromFilepaths(paths);
    },
    detectGameVersionFromZip(zip) {
      return this.detectGameVersionFromFilepaths(getZipTxtFilepaths(zip));
    },
    resetVersionedState() {
      this.descs = [];
      this.filteredDescs = [];
      this.localDescs = { descs: [], lastModified: 0, size: 0, status: {} };
      this.sourceLoaded = false;
      this.editorVisible = false;
      this.editorCurrentEditingDesc = null;
      this.historyItems = [];
      this.historySelectedA = null;
      this.historySelectedB = null;
      this.historyDiffHtml = '';
      this.loadingProgress = 0;
      this.ensureLocalDescsReady();
      this.filterDesc();
    },
    async selectGameVersion(version) {
      await this.activateGameVersion(version, { checkMigration: true });
    },
    async activateGameVersion(version, { checkMigration = true } = {}) {
      const v = this.normalizeGameVersion(version);
      this.gameVersion = v;
      this.gameVersionSelected = true;
      window.OfflineStore?.setGameVersion?.(v);
      this.updateDocumentTitle();

      if (checkMigration) {
        await this.prepareSingleVersionMigration();
        if (this.pendingSingleVersionMigration) return;
      }

      await this.loadVersionedStorage();
    },
    async prepareSingleVersionMigration() {
      this.pendingSingleVersionMigration = null;
      if (!(window.OfflineStore && typeof window.OfflineStore.hasMigratedFromSingleVersion === 'function')) return;

      let migrated = false;
      try {
        migrated = !!(await window.OfflineStore.hasMigratedFromSingleVersion());
      } catch (_) {
      }
      if (migrated) return;

      let legacySource;
      let legacyWorkspace;
      let legacyRevisionCount = 0;
      try {
        legacySource = await window.OfflineStore.getLegacySource?.();
        legacyWorkspace = await window.OfflineStore.getLegacyWorkspace?.();
        legacyRevisionCount = Number(await window.OfflineStore.getLegacyRevisionCount?.()) || 0;
      } catch (_) {
      }

      const workspaceDescs = Array.isArray(legacyWorkspace?.descs) ? legacyWorkspace.descs : [];
      const sourceDescs = Array.isArray(legacySource) ? legacySource : [];
      if (sourceDescs.length === 0 && workspaceDescs.length === 0 && legacyRevisionCount === 0) return;

      const detectedVersion = this.detectGameVersionFromDescs(sourceDescs.length > 0 ? sourceDescs : workspaceDescs);
      this.pendingSingleVersionMigration = {
        detectedVersion,
        selectedVersion: this.gameVersion,
        sourceCount: sourceDescs.length,
        workspaceCount: workspaceDescs.length,
        revisionCount: legacyRevisionCount,
      };
    },
    async confirmSingleVersionMigration() {
      if (this.migrationInProgress) return;
      const pending = this.pendingSingleVersionMigration;
      if (!pending) return;
      const targetVersion = this.normalizeGameVersion(pending.detectedVersion);
      this.migrationInProgress = true;
      this.gameVersion = targetVersion;
      this.gameVersionSelected = true;
      window.OfflineStore?.setGameVersion?.(targetVersion);
      this.updateDocumentTitle();
      this.loadingProgress = 0.001;

      try {
        await window.OfflineStore.copyLegacyToVersion(targetVersion);
      } catch (error) {
        this.loadingProgress = 0;
        this.migrationInProgress = false;
        alert('Migration failed. Your old data was left untouched.');
        return;
      }

      this.pendingSingleVersionMigration = null;
      this.migrationInProgress = false;
      await this.loadVersionedStorage();
    },
    async loadVersionedStorage() {
      this.versionStorageLoading = true;
      this.resetVersionedState();
      this.loadingProgress = 0.001;

      let localDescs;
      try {
        localDescs = await window.OfflineStore.getWorkspace(this.gameVersion);
      } catch (_) {
      }
      if (localDescs) this.localDescs = localDescs;
      this.ensureLocalDescsReady();

      let source;
      try {
        source = await window.OfflineStore.getSource(this.gameVersion);
      } catch (_) {
      }
      if (Array.isArray(source) && source.length > 0) {
        this.descs = source;
        this.sourceLoaded = true;
        this.applyWorkspaceOverlay();
        this.filterDesc();
        this.loadingProgress = 100;
      } else {
        this.versionStorageLoading = false;
        this.loadingProgress = 0;
        return;
      }
      this.versionStorageLoading = false;
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
      return "10";
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
      let decorRe = new RegExp("^" + textDecorationTagRegex, "i");
      let kwRe = new RegExp("^" + keywordPopupTagRegex, "i");
      let gggRe = new RegExp("^" + gggVarTagRegex, "i");
      let segments = [];
      let keysOrder = [];
      let keySeen = new Set();
      let textBuf = "";
      let textDecorTag = "";
      let flushText = () => {
        if (textBuf) {
          let seg = { type: "text", text: textBuf };
          if (textDecorTag) seg.decorTag = textDecorTag;
          segments.push(seg);
          textBuf = "";
          textDecorTag = "";
        }
      };
      let appendText = (text, decorTag = "") => {
        let normalizedDecorTag = String(decorTag ?? "").trim().toLowerCase();
        if (textBuf && textDecorTag !== normalizedDecorTag) flushText();
        textDecorTag = normalizedDecorTag;
        textBuf += text;
      };

      let scanInline = (part, allowBreaks = true, decorTag = "") => {
        let i = 0;
        let activeDecorTag = String(decorTag ?? "").trim().toLowerCase();
        while (i < part.length) {
          let slice = part.slice(i);
          let dm = decorRe.exec(slice);
          if (dm && dm.index === 0) {
            flushText();
            scanInline(String(dm[3] ?? ""), allowBreaks, dm[2]);
            flushText();
            i += dm[0].length;
            continue;
          }
          let km = kwRe.exec(slice);
          if (km && km.index === 0) {
            flushText();
            let tagName = String(km[2] ?? "").trim();
            let dynamicContent = String(km[3] ?? "").trim();
            let display = dynamicContent || tagName;
            let seg = { type: "kw", text: display, full: km[0] };
            if (activeDecorTag) seg.decorTag = activeDecorTag;
            segments.push(seg);
            i += km[0].length;
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
            let prefix = ["@", "+", "-"].includes(full[0]) ? full[0] : "";
            let trailingPercent = full.endsWith("%");
            let seg = { type: "var", key: ks, trailingPercent, full, prefix };
            if (activeDecorTag) seg.decorTag = activeDecorTag;
            segments.push(seg);
            i += full.length;
            continue;
          }
          if (part[i] === '@' && this.isTableDelimiterAt(part, i)) {
            flushText();
            segments.push({ type: "rightAlign" });
            i++;
            continue;
          }
          if (allowBreaks && part[i] === '\n') {
            flushText();
            segments.push({ type: "break" });
            i++;
            continue;
          }
          appendText(part[i], activeDecorTag);
          i++;
        }
      };

      if (this.isTableText(s)) {
        let columns = this.splitTableColumns(s).map(col => this.normalizeNewlines(col));
        let columnLines = columns.map(col => String(col).split("\n"));
        let rowCount = columnLines.reduce((max, lines) => Math.max(max, lines.length), 0);
        for (let row = 0; row < rowCount; row++) {
          for (let col = 0; col < columnLines.length; col++) {
            if (col > 0) {
              flushText();
              segments.push({ type: "rightAlign" });
            }
            scanInline(columnLines[col]?.[row] ?? "", false);
          }
          if (row < rowCount - 1) {
            flushText();
            segments.push({ type: "break" });
          }
        }
      } else {
        scanInline(s, true);
      }
      flushText();
      return { segments, keysOrder };
    },
    refreshGamePreview() {
      if (!this.editorVisible) return;
      let block = this.editorBlocks?.[this.editorFocusedIndex];
      let sourceRaw = block?.english ?? "";
      let translationRaw = block?.translation ?? "";
      let sourceDecoded = this.decodeEscapedNewlines(sourceRaw);
      let translationDecoded = this.decodeEscapedNewlines(translationRaw);
      let sourcePreview = this.buildGamePreviewSegments(sourceDecoded);
      let translationPreview = this.buildGamePreviewSegments(translationDecoded);
      let keysOrder = [...sourcePreview.keysOrder, ...translationPreview.keysOrder];
      this.mergePreviewGggVars(keysOrder);
      this.gamePreviewSourceSegments = sourcePreview.segments;
      this.gamePreviewSegments = translationPreview.segments;
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

      const filepath = this.editorCurrentEditingDesc.filepath;
      let prevEng = null;
      try {
        const items = await window.OfflineStore.listRevisions(filepath, 'English', 2, this.gameVersion);
        if (Array.isArray(items) && items.length >= 2) prevEng = items[1]?.translations;
      } catch (_) {
      }
      const curEng = Array.isArray(this.editorCurrentEditingDesc?.translations?.English) ? this.editorCurrentEditingDesc.translations.English : [];

      for (let i = 0; i < (this.editorBlocks || []).length; i++) {
        const b = this.editorBlocks[i];
        const oldRaw = Array.isArray(prevEng) ? (prevEng[i] ?? '') : '';
        const newRaw = curEng[i] ?? '';
        this.applyEditorEnglishDiff(b, oldRaw, newRaw, newRaw);
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
    getEditorDisplayText(raw) {
      const s = String(raw ?? '');
      const decoded = this.decodeEscapedNewlines(s);
      return (this.isTableText(decoded) || this.isMultilineText(s)) ? decoded : s;
    },
    applyEditorEnglishDiff(block, oldRaw, newRaw, tableRaw = newRaw) {
      if (!block) return;
      const oldStr = this.getEditorDisplayText(oldRaw);
      const newStr = this.getEditorDisplayText(newRaw);
      block.englishDiffHtml = this.renderInlineDiffHtml(oldStr, newStr);
      if (block.isTable) {
        this.applyEditorTableEnglishDiff(block, oldStr, newStr, this.getEditorDisplayText(tableRaw));
      }
    },
    applyEditorTableEnglishDiff(block, oldStr, newStr, tableStr = newStr) {
      if (!block?.isTable) return;
      const oldColumns = this.isTableText(oldStr) ? this.splitTableColumns(oldStr) : [String(oldStr ?? '')];
      const newColumns = this.isTableText(newStr) ? this.splitTableColumns(newStr) : [String(newStr ?? '')];
      const tableColumns = this.isTableText(tableStr) ? this.splitTableColumns(tableStr) : [String(tableStr ?? '')];
      if (!Array.isArray(block.tableColumns)) block.tableColumns = [];
      const count = Math.max(block.tableColumns.length, oldColumns.length, newColumns.length, tableColumns.length);
      for (let i = 0; i < count; i++) {
        if (!block.tableColumns[i]) {
          block.tableColumns[i] = this.makeEditorTableColumn(tableColumns[i] ?? newColumns[i] ?? '', '', i < tableColumns.length, false);
        }
        const column = block.tableColumns[i];
        column.english = String(tableColumns[i] ?? newColumns[i] ?? '');
        column.englishExists = i < tableColumns.length;
        column.englishDiffHtml = this.renderInlineDiffHtml(oldColumns[i] ?? '', newColumns[i] ?? '');
        this.refreshEditorTableColumnHLter(column);
      }
    },
    buildEditorTableTranslationDiffColumns(block, oldStr, newStr) {
      if (!block?.isTable) return [];
      const oldColumns = this.isTableText(oldStr) ? this.splitTableColumns(oldStr) : [String(oldStr ?? '')];
      const newColumns = this.isTableText(newStr) ? this.splitTableColumns(newStr) : [String(newStr ?? '')];
      const tableCount = Array.isArray(block.tableColumns) ? block.tableColumns.length : 0;
      const count = Math.max(tableCount, oldColumns.length, newColumns.length);
      let columns = [];
      for (let i = 0; i < count; i++) {
        columns.push({
          translationDiffHtml: this.renderInlineDiffHtml(oldColumns[i] ?? '', newColumns[i] ?? ''),
          oldTranslationExists: i < oldColumns.length,
          newTranslationExists: i < newColumns.length
        });
      }
      return columns;
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
    isTableDelimiterAt(text, index) {
      let s = String(text ?? "");
      return s[index] === "@";
    },
    splitTableColumns(text) {
      let s = String(text ?? "");
      let columns = [];
      let buf = "";
      for (let i = 0; i < s.length; i++) {
        if (this.isTableDelimiterAt(s, i)) {
          columns.push(buf);
          buf = "";
          continue;
        }
        buf += s[i];
      }
      columns.push(buf);
      return columns;
    },
    isTableText(text) {
      let s = text ?? "";
      if (typeof s !== "string" || !s.includes("@")) return false;
      return this.splitTableColumns(s).length > 1;
    },
    joinTableColumns(columns) {
      let values = (columns || []).map(v => String(v ?? ""));
      if (values.every(v => v === "")) return "";
      return values.join("@");
    },
    getSerializableTableColumns(editorBlock) {
      let columns = Array.isArray(editorBlock?.tableColumns) ? editorBlock.tableColumns : [];
      let end = columns.length;
      while (end > 0) {
        const column = columns[end - 1];
        const sourceColumnRemoved = column?.englishExists === false;
        const translationEmpty = String(column?.translation ?? "") === "";
        if (!sourceColumnRemoved || !translationEmpty) break;
        end--;
      }
      return columns.slice(0, end);
    },
    editorRefName(kind, index, columnIndex = null) {
      if (columnIndex === null || columnIndex === undefined) return `${kind}_${index}`;
      return `${kind}_${index}_${columnIndex}`;
    },
    getEditorRef(kind, index, columnIndex = null) {
      let r = this.$refs?.[this.editorRefName(kind, index, columnIndex)];
      if (Array.isArray(r)) r = r[0];
      return r;
    },
    normalizeTooltipText(value) {
      if (value == null) return "";
      if (Array.isArray(value)) return value.map(v => String(v ?? "")).filter(Boolean).join("\n");
      if (typeof value === "object") return String(value.text ?? value.label ?? "");
      return String(value);
    },
    placeTooltip(e, text) {
      const safeText = this.normalizeTooltipText(text);
      if (!safeText.trim()) {
        this.hideTooltip();
        return;
      }
      const lines = safeText.split(/\r?\n/);
      const maxLineLength = Math.max(8, ...lines.map(line => line.length));
      const maxWidth = Math.min(360, Math.max(180, maxLineLength * 7 + 28));
      const estimatedHeight = Math.min(320, Math.max(34, lines.length * 18 + 18));
      let x = Number(e?.clientX || 0) + 14;
      let y = Number(e?.clientY || 0) + 18;
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1024;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 768;
      if (x + maxWidth > viewportWidth - 8) x = Math.max(8, viewportWidth - maxWidth - 8);
      if (y + estimatedHeight > viewportHeight - 8) y = Math.max(8, Number(e?.clientY || 0) - estimatedHeight - 12);
      this.tooltip = {
        visible: true,
        text: safeText,
        x,
        y,
        maxWidth
      };
    },
    showTooltip(e, text) {
      this.placeTooltip(e, text);
    },
    hideTooltip() {
      if (!this.tooltip.visible) return;
      this.tooltip.visible = false;
      this.tooltip.text = "";
    },
    htmlTooltipMouseMove(e) {
      const root = e?.currentTarget;
      const target = e?.target?.closest?.("[data-tooltip]");
      if (!root || !target || !root.contains(target)) {
        this.hideTooltip();
        return;
      }
      this.showTooltip(e, target.getAttribute("data-tooltip"));
    },
    getTooltipElementAtPoint(root, x, y, selector = "[data-tooltip]") {
      if (!root || typeof root.querySelectorAll !== "function") return null;
      const targets = root.querySelectorAll(selector);
      for (const target of targets) {
        for (const rect of target.getClientRects()) {
          if (
            x >= rect.left - 1 &&
            x <= rect.right + 1 &&
            y >= rect.top - 1 &&
            y <= rect.bottom + 1
          ) {
            return target;
          }
        }
      }
      return null;
    },
    translationTooltipMouseMove(e, editorIndex, columnIndex = null) {
      const editorBlock = this.editorBlocks?.[editorIndex];
      const refColumn = editorBlock?.isTable ? columnIndex : null;
      const hlterEl = this.getEditorRef("translationHLter", editorIndex, refColumn);
      const target = this.getTooltipElementAtPoint(hlterEl, e?.clientX || 0, e?.clientY || 0, ".diagnosticRange[data-tooltip]");
      if (!target) {
        this.hideTooltip();
        return;
      }
      this.showTooltip(e, target.getAttribute("data-tooltip"));
    },
    getEditorColumn(editorBlock, columnIndex = null) {
      if (!editorBlock?.isTable) return editorBlock;
      let idx = Number.isInteger(columnIndex) ? columnIndex : 0;
      return editorBlock.tableColumns?.[idx] || editorBlock.tableColumns?.[0] || null;
    },
    editorTableColumnCount(editorBlock) {
      if (!editorBlock?.isTable) return 1;
      const tableCount = Array.isArray(editorBlock.tableColumns) ? editorBlock.tableColumns.length : 0;
      const compareCount = this.editorCompareActive && this.editorCompareMode === 'translation' && Array.isArray(editorBlock.translationCompareColumns)
        ? editorBlock.translationCompareColumns.length
        : 0;
      return Math.max(1, tableCount, compareCount);
    },
    makeEditorTableColumn(english, translation, englishExists = true, translationExists = true) {
      let column = {
        english: String(english ?? ""),
        translation: String(translation ?? ""),
        englishHLter: "",
        translationHLter: "",
        englishDiffHtml: escapeHtml(String(english ?? "")),
        translationDiffHtml: escapeHtml(String(translation ?? "")),
        HLs: [],
        translationDiagnostics: [],
        diagnosticWarningCount: 0,
        diagnosticErrorCount: 0,
        isMultiline: this.isMultilineText(String(english ?? "")) || this.isMultilineText(String(translation ?? "")),
        multilineLineMismatch: false,
        englishExists,
        translationExists
      };
      this.refreshEditorTableColumnHLter(column);
      return column;
    },
    buildEditorTableColumns(english, translation) {
      let englishColumns = this.splitTableColumns(english);
      let translationColumns = this.splitTableColumns(translation);
      let count = Math.max(englishColumns.length, translationColumns.length);
      let columns = [];
      for (let i = 0; i < count; i++) {
        columns.push(this.makeEditorTableColumn(
          englishColumns[i] ?? "",
          translationColumns[i] ?? "",
          i < englishColumns.length,
          i < translationColumns.length
        ));
      }
      return columns;
    },
    refreshEditorTableColumnHLter(column) {
      if (!column) return;
      column.isMultiline = this.isMultilineText(column.english ?? "") || this.isMultilineText(column.translation ?? "");
      const diagnostics = this.refreshTranslationDiagnostics(column);
      let { englishHLter: baseEnglishHLter, HLs } = this.buildEnglishHLter(column.english);
      column.HLs = HLs;
      if (!column.isMultiline) {
        column.englishHLter = baseEnglishHLter;
        column.translationHLter = this.buildTagHLter(column.translation ?? "", diagnostics.diagnostics);
        column.multilineLineMismatch = false;
        return;
      }
      let diff = this.computeMultilineLineMismatch(column.english, column.translation);
      column.englishHLter = this.wrapHlterByLines(baseEnglishHLter, diff.engMismatch);
      column.translationHLter = this.wrapHlterByLines(this.buildTagHLter(column.translation ?? "", diagnostics.diagnostics), diff.trMismatch);
      column.multilineLineMismatch = diff.mismatch;
    },
    syncEditorBlockFromTableColumns(editorBlock) {
      if (!editorBlock?.isTable) return;
      let columns = editorBlock.tableColumns || [];
      let serializableColumns = this.getSerializableTableColumns(editorBlock);
      editorBlock.translation = this.joinTableColumns(serializableColumns.map(col => col?.translation ?? ""));
      editorBlock.isMultiline = columns.some(col => col?.isMultiline || this.isMultilineText(col?.english ?? "") || this.isMultilineText(col?.translation ?? ""));
      editorBlock.multilineLineMismatch = columns.some(col => col?.multilineLineMismatch);
      this.syncEditorBlockDiagnosticsFromTableColumns(editorBlock);
    },
    rebuildEditorTableColumnsFromStrings(editorBlock) {
      if (!editorBlock?.isTable) return;
      editorBlock.tableColumns = this.buildEditorTableColumns(editorBlock.english ?? "", editorBlock.translation ?? "");
      this.syncEditorBlockFromTableColumns(editorBlock);
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
      if (!confirm(`Are you sure you want to remove alternate definition of ${String(alt?.find ?? "")}?`)) return;
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
      let columns = this.isTableText(String(s)) ? this.splitTableColumns(String(s)) : [String(s)];
      let lines;
      if (String(s).length <= 0) {
        lines = 0;
      } else if (columns.length > 1) {
        lines = columns.reduce((max, col) => Math.max(max, String(col).split("\n").length), 0);
      } else {
        lines = String(s).split("\n").length;
      }
      return {
        lines,
        cols: String(s).length <= 0 ? 0 : columns.length,
        vars: countGGGVarTag(String(s)),
        kw: countKeywordPopupTag(String(s)),
        decor: countTextDecorationTag(String(s))
      };
    },
    emptyTranslationDiagnostics() {
      return { diagnostics: [], warningCount: 0, errorCount: 0 };
    },
    analyzeTranslationDiagnostics(text, english = null) {
      const result = window.TranslationDiagnostics && typeof window.TranslationDiagnostics.analyze === "function"
        ? window.TranslationDiagnostics.analyze(text)
        : this.emptyTranslationDiagnostics();
      return this.addTagIdentityDiagnostics(result, english, text);
    },
    refreshTranslationDiagnostics(target) {
      if (!target) return this.emptyTranslationDiagnostics();
      const result = this.analyzeTranslationDiagnostics(target.translation ?? "", target.english ?? null);
      target.translationDiagnostics = result.diagnostics;
      target.diagnosticWarningCount = result.warningCount;
      target.diagnosticErrorCount = result.errorCount;
      return result;
    },
    addTagIdentityDiagnostics(result, english, translation) {
      const base = result && typeof result === "object" ? result : this.emptyTranslationDiagnostics();
      const diagnostics = Array.isArray(base.diagnostics) ? [...base.diagnostics] : [];
      if (english === null || english === undefined) {
        return {
          diagnostics,
          warningCount: diagnostics.filter(d => d.level === "warning").length,
          errorCount: diagnostics.filter(d => d.level === "error").length
        };
      }

      diagnostics.push(...this.buildGggVarIdentityDiagnostics(english, translation));
      diagnostics.push(...this.buildKeywordPopupTagNameDiagnostics(english, translation));
      diagnostics.push(...this.buildTextDecorationTagNameDiagnostics(english, translation));
      diagnostics.sort((a, b) => {
        if (a.start !== b.start) return a.start - b.start;
        if (a.end !== b.end) return a.end - b.end;
        if (a.level === b.level) return 0;
        return a.level === "error" ? -1 : 1;
      });

      return {
        diagnostics,
        warningCount: diagnostics.filter(d => d.level === "warning").length,
        errorCount: diagnostics.filter(d => d.level === "error").length
      };
    },
    splitLinesWithOffsets(text) {
      const source = String(text ?? "");
      const lines = [];
      let start = 0;
      for (let i = 0; i < source.length; i++) {
        if (source[i] !== "\n") continue;
        lines.push({ text: source.slice(start, i), start, end: i });
        start = i + 1;
      }
      lines.push({ text: source.slice(start), start, end: source.length });
      return lines;
    },
    extractGggVarIdentityTags(text, offset = 0) {
      const source = String(text ?? "");
      const regex = new RegExp(gggVarTagRegex, "igm");
      const tags = [];
      let m;
      while (m = regex.exec(source)) {
        const full = m[1] || m[0];
        const key = typeof getGggVarIdentityKey === "function" ? getGggVarIdentityKey(full) : full;
        tags.push({
          full,
          key: String(key),
          start: offset + m.index,
          end: offset + m.index + full.length
        });
      }
      return tags;
    },
    countGggVarIdentityTags(tags) {
      const counts = {};
      for (const tag of (Array.isArray(tags) ? tags : [])) {
        const key = String(tag?.key ?? "");
        counts[key] = (counts[key] || 0) + 1;
      }
      return counts;
    },
    formatGggVarIdentityCounts(counts) {
      return Object.keys(counts || {})
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .map(key => `{${key}}${counts[key] > 1 ? ` x${counts[key]}` : ""}`)
        .join(", ") || "none";
    },
    findGggVarIdentityMismatchRange(englishCounts, translationLine, translationTags) {
      const seen = {};
      for (const tag of translationTags) {
        const key = String(tag.key ?? "");
        seen[key] = (seen[key] || 0) + 1;
        if (seen[key] > (englishCounts[key] || 0)) return { start: tag.start, end: tag.end };
      }
      if (translationTags.length > 0) return { start: translationTags[0].start, end: translationTags[0].end };
      return null;
    },
    buildGggVarIdentityDiagnostics(english, translation) {
      const englishLines = this.splitLinesWithOffsets(english);
      const translationLines = this.splitLinesWithOffsets(translation);
      const max = Math.max(englishLines.length, translationLines.length);
      const diagnostics = [];

      if (max > 1) {
        const englishTags = this.extractGggVarIdentityTags(english);
        const translationTags = this.extractGggVarIdentityTags(translation);
        const englishCounts = this.countGggVarIdentityTags(englishTags);
        const translationCounts = this.countGggVarIdentityTags(translationTags);
        const keys = Array.from(new Set([...Object.keys(englishCounts), ...Object.keys(translationCounts)]));
        const mismatched = keys.some(key => englishCounts[key] !== translationCounts[key]);
        if (!mismatched) return diagnostics;

        const range = this.findGggVarIdentityMismatchRange(englishCounts, null, translationTags);
        const diagnostic = {
          level: "error",
          code: "variable-tag-identity-mismatch",
          message: `Variable tag mismatch: English has ${this.formatGggVarIdentityCounts(englishCounts)}; translation has ${this.formatGggVarIdentityCounts(translationCounts)}.`
        };
        if (range) {
          diagnostic.start = range.start;
          diagnostic.end = range.end;
        }
        diagnostics.push(diagnostic);
        return diagnostics;
      }

      for (let i = 0; i < max; i++) {
        const englishLine = englishLines[i] || { text: "", start: 0, end: 0 };
        const translationLine = translationLines[i] || { text: "", start: String(translation ?? "").length, end: String(translation ?? "").length };
        const englishTags = this.extractGggVarIdentityTags(englishLine.text);
        const translationTags = this.extractGggVarIdentityTags(translationLine.text, translationLine.start);
        const englishCounts = this.countGggVarIdentityTags(englishTags);
        const translationCounts = this.countGggVarIdentityTags(translationTags);
        const keys = Array.from(new Set([...Object.keys(englishCounts), ...Object.keys(translationCounts)]));
        const mismatched = keys.some(key => englishCounts[key] !== translationCounts[key]);
        if (!mismatched) continue;

        const range = this.findGggVarIdentityMismatchRange(englishCounts, translationLine, translationTags);
        const linePart = max > 1 ? ` on line ${i + 1}` : "";
        const diagnostic = {
          level: "error",
          code: "variable-tag-identity-mismatch",
          message: `Variable tag mismatch${linePart}: English has ${this.formatGggVarIdentityCounts(englishCounts)}; translation has ${this.formatGggVarIdentityCounts(translationCounts)}.`
        };
        if (range) {
          diagnostic.start = range.start;
          diagnostic.end = range.end;
        }
        diagnostics.push(diagnostic);
      }

      return diagnostics;
    },
    extractKeywordPopupIdentityTags(text, offset = 0) {
      const source = String(text ?? "");
      const regex = new RegExp(keywordPopupTagRegex, "igm");
      const tags = [];
      let m;
      while (m = regex.exec(source)) {
        const full = m[1] || m[0];
        const tagName = String(m[2] ?? "").trim();
        tags.push({
          full,
          key: tagName,
          start: offset + m.index,
          end: offset + m.index + full.length
        });
      }
      return tags;
    },
    countKeywordPopupIdentityTags(tags) {
      const counts = {};
      for (const tag of (Array.isArray(tags) ? tags : [])) {
        const key = String(tag?.key ?? "");
        counts[key] = (counts[key] || 0) + 1;
      }
      return counts;
    },
    formatKeywordPopupIdentityCounts(counts) {
      return Object.keys(counts || {})
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .map(key => `[${key}]${counts[key] > 1 ? ` x${counts[key]}` : ""}`)
        .join(", ") || "none";
    },
    findKeywordPopupTagNameMismatchRange(englishCounts, translationLine, translationTags) {
      const seen = {};
      for (const tag of translationTags) {
        const key = String(tag.key ?? "");
        seen[key] = (seen[key] || 0) + 1;
        if (seen[key] > (englishCounts[key] || 0)) return { start: tag.start, end: tag.end };
      }
      if (translationTags.length > 0) return { start: translationTags[0].start, end: translationTags[0].end };
      return null;
    },
    buildKeywordPopupTagNameDiagnostics(english, translation) {
      const englishLines = this.splitLinesWithOffsets(english);
      const translationLines = this.splitLinesWithOffsets(translation);
      const max = Math.max(englishLines.length, translationLines.length);
      const diagnostics = [];

      if (max > 1) {
        const englishTags = this.extractKeywordPopupIdentityTags(english);
        const translationTags = this.extractKeywordPopupIdentityTags(translation);
        const englishCounts = this.countKeywordPopupIdentityTags(englishTags);
        const translationCounts = this.countKeywordPopupIdentityTags(translationTags);
        const keys = Array.from(new Set([...Object.keys(englishCounts), ...Object.keys(translationCounts)]));
        const mismatched = keys.some(key => englishCounts[key] !== translationCounts[key]);
        if (!mismatched) return diagnostics;

        const range = this.findKeywordPopupTagNameMismatchRange(englishCounts, null, translationTags);
        const diagnostic = {
          level: "error",
          code: "keyword-popup-tag-name-mismatch",
          message: `KeywordPopups tagName mismatch: English has ${this.formatKeywordPopupIdentityCounts(englishCounts)}; translation has ${this.formatKeywordPopupIdentityCounts(translationCounts)}.`
        };
        if (range) {
          diagnostic.start = range.start;
          diagnostic.end = range.end;
        }
        diagnostics.push(diagnostic);
        return diagnostics;
      }

      for (let i = 0; i < max; i++) {
        const englishLine = englishLines[i] || { text: "", start: 0, end: 0 };
        const translationLine = translationLines[i] || { text: "", start: String(translation ?? "").length, end: String(translation ?? "").length };
        const englishTags = this.extractKeywordPopupIdentityTags(englishLine.text);
        const translationTags = this.extractKeywordPopupIdentityTags(translationLine.text, translationLine.start);
        const englishCounts = this.countKeywordPopupIdentityTags(englishTags);
        const translationCounts = this.countKeywordPopupIdentityTags(translationTags);
        const keys = Array.from(new Set([...Object.keys(englishCounts), ...Object.keys(translationCounts)]));
        const mismatched = keys.some(key => englishCounts[key] !== translationCounts[key]);
        if (!mismatched) continue;

        const range = this.findKeywordPopupTagNameMismatchRange(englishCounts, translationLine, translationTags);
        const linePart = max > 1 ? ` on line ${i + 1}` : "";
        const diagnostic = {
          level: "error",
          code: "keyword-popup-tag-name-mismatch",
          message: `KeywordPopups tagName mismatch${linePart}: English has ${this.formatKeywordPopupIdentityCounts(englishCounts)}; translation has ${this.formatKeywordPopupIdentityCounts(translationCounts)}.`
        };
        if (range) {
          diagnostic.start = range.start;
          diagnostic.end = range.end;
        }
        diagnostics.push(diagnostic);
      }

      return diagnostics;
    },
    extractTextDecorationIdentityTags(text, offset = 0) {
      const source = String(text ?? "");
      const regex = new RegExp(textDecorationTagRegex, "igm");
      const tags = [];
      let m;
      while (m = regex.exec(source)) {
        const full = m[1] || m[0];
        const tagName = String(m[2] ?? "").trim();
        tags.push({
          full,
          key: tagName,
          start: offset + m.index,
          end: offset + m.index + full.length,
          openerEnd: offset + m.index + `<${tagName}>`.length
        });
      }
      return tags;
    },
    countTextDecorationIdentityTags(tags) {
      const counts = {};
      for (const tag of (Array.isArray(tags) ? tags : [])) {
        const key = String(tag?.key ?? "");
        counts[key] = (counts[key] || 0) + 1;
      }
      return counts;
    },
    formatTextDecorationIdentityCounts(counts) {
      return Object.keys(counts || {})
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .map(key => `<${key}>${counts[key] > 1 ? ` x${counts[key]}` : ""}`)
        .join(", ") || "none";
    },
    findTextDecorationTagNameMismatchRange(englishCounts, translationLine, translationTags) {
      const seen = {};
      for (const tag of translationTags) {
        const key = String(tag.key ?? "");
        seen[key] = (seen[key] || 0) + 1;
        if (seen[key] > (englishCounts[key] || 0)) return { start: tag.start, end: tag.openerEnd || tag.end };
      }
      if (translationTags.length > 0) {
        const tag = translationTags[0];
        return { start: tag.start, end: tag.openerEnd || tag.end };
      }
      return null;
    },
    buildTextDecorationTagNameDiagnostics(english, translation) {
      const englishLines = this.splitLinesWithOffsets(english);
      const translationLines = this.splitLinesWithOffsets(translation);
      const max = Math.max(englishLines.length, translationLines.length);
      const diagnostics = [];

      if (max > 1) {
        const englishTags = this.extractTextDecorationIdentityTags(english);
        const translationTags = this.extractTextDecorationIdentityTags(translation);
        const englishCounts = this.countTextDecorationIdentityTags(englishTags);
        const translationCounts = this.countTextDecorationIdentityTags(translationTags);
        const keys = Array.from(new Set([...Object.keys(englishCounts), ...Object.keys(translationCounts)]));
        const mismatched = keys.some(key => englishCounts[key] !== translationCounts[key]);
        if (!mismatched) return diagnostics;

        const range = this.findTextDecorationTagNameMismatchRange(englishCounts, null, translationTags);
        const diagnostic = {
          level: "error",
          code: "text-decoration-tag-name-mismatch",
          message: `Text decoration tagName mismatch: English has ${this.formatTextDecorationIdentityCounts(englishCounts)}; translation has ${this.formatTextDecorationIdentityCounts(translationCounts)}.`
        };
        if (range) {
          diagnostic.start = range.start;
          diagnostic.end = range.end;
        }
        diagnostics.push(diagnostic);
        return diagnostics;
      }

      for (let i = 0; i < max; i++) {
        const englishLine = englishLines[i] || { text: "", start: 0, end: 0 };
        const translationLine = translationLines[i] || { text: "", start: String(translation ?? "").length, end: String(translation ?? "").length };
        const englishTags = this.extractTextDecorationIdentityTags(englishLine.text);
        const translationTags = this.extractTextDecorationIdentityTags(translationLine.text, translationLine.start);
        const englishCounts = this.countTextDecorationIdentityTags(englishTags);
        const translationCounts = this.countTextDecorationIdentityTags(translationTags);
        const keys = Array.from(new Set([...Object.keys(englishCounts), ...Object.keys(translationCounts)]));
        const mismatched = keys.some(key => englishCounts[key] !== translationCounts[key]);
        if (!mismatched) continue;

        const range = this.findTextDecorationTagNameMismatchRange(englishCounts, translationLine, translationTags);
        const linePart = max > 1 ? ` on line ${i + 1}` : "";
        const diagnostic = {
          level: "error",
          code: "text-decoration-tag-name-mismatch",
          message: `Text decoration tagName mismatch${linePart}: English has ${this.formatTextDecorationIdentityCounts(englishCounts)}; translation has ${this.formatTextDecorationIdentityCounts(translationCounts)}.`
        };
        if (range) {
          diagnostic.start = range.start;
          diagnostic.end = range.end;
        }
        diagnostics.push(diagnostic);
      }

      return diagnostics;
    },
    syncEditorBlockDiagnosticsFromTableColumns(editorBlock) {
      if (!editorBlock?.isTable) return;
      let diagnostics = [];
      let warningCount = 0;
      let errorCount = 0;
      for (let col = 0; col < (editorBlock.tableColumns || []).length; col++) {
        const column = editorBlock.tableColumns[col];
        warningCount += Number(column?.diagnosticWarningCount || 0);
        errorCount += Number(column?.diagnosticErrorCount || 0);
        for (const diagnostic of (column?.translationDiagnostics || [])) {
          diagnostics.push({ ...diagnostic, columnIndex: col });
        }
      }
      editorBlock.translationDiagnostics = diagnostics;
      editorBlock.diagnosticWarningCount = warningCount;
      editorBlock.diagnosticErrorCount = errorCount;
    },
    collectEditorDiagnostics(level = "") {
      let items = [];
      for (let i = 0; i < (this.editorBlocks || []).length; i++) {
        const block = this.editorBlocks[i];
        if (!block) continue;
        if (block.isTable) {
          for (let col = 0; col < (block.tableColumns || []).length; col++) {
            const column = block.tableColumns[col];
            for (const diagnostic of (column?.translationDiagnostics || [])) {
              if (level && diagnostic.level !== level) continue;
              items.push({ ...diagnostic, blockIndex: i, columnIndex: col });
            }
          }
          continue;
        }
        for (const diagnostic of (block.translationDiagnostics || [])) {
          if (level && diagnostic.level !== level) continue;
          items.push({ ...diagnostic, blockIndex: i });
        }
      }
      return items;
    },
    formatDiagnosticsForDisplay(diagnostics, limit = 12) {
      const list = Array.isArray(diagnostics) ? diagnostics : [];
      if (list.length <= 0) return "";
      const lines = list.slice(0, limit).map(d => {
        let location = `#${Number(d.blockIndex || 0) + 1}`;
        if (Number.isInteger(d.columnIndex)) location += `.${d.columnIndex + 1}`;
        return `${location}: ${d.message || d.code || "Translation diagnostic"}`;
      });
      if (list.length > limit) lines.push(`...and ${list.length - limit} more`);
      return lines.join("\n");
    },
    blockDiagnosticTitle(editorBlock, level) {
      if (!editorBlock) return "";
      let diagnostics = [];
      if (editorBlock.isTable) {
        for (let col = 0; col < (editorBlock.tableColumns || []).length; col++) {
          for (const diagnostic of (editorBlock.tableColumns[col]?.translationDiagnostics || [])) {
            if (level && diagnostic.level !== level) continue;
            diagnostics.push({ ...diagnostic, columnIndex: col });
          }
        }
      } else {
        diagnostics = (editorBlock.translationDiagnostics || [])
          .filter(d => !level || d.level === level);
      }
      const lines = diagnostics.slice(0, 8).map(d => {
        const prefix = Number.isInteger(d.columnIndex) ? `Column ${d.columnIndex + 1}: ` : "";
        return `${prefix}${d.message || d.code || "Translation diagnostic"}`;
      });
      if (diagnostics.length > 8) lines.push(`...and ${diagnostics.length - 8} more`);
      return lines.join("\n");
    },
    refreshEditorDiagnostics() {
      for (const editorBlock of (this.editorBlocks || [])) {
        if (!editorBlock) continue;
        if (editorBlock.isTable) {
          for (const column of (editorBlock.tableColumns || [])) {
            this.refreshTranslationDiagnostics(column);
          }
          this.syncEditorBlockDiagnosticsFromTableColumns(editorBlock);
        } else {
          this.refreshTranslationDiagnostics(editorBlock);
        }
      }
    },
    refreshEditorBlockMeta(editorBlock, editorIndex) {
      if (!editorBlock) return;
      let eng = this.computeTextStats(editorBlock.english ?? "");
      let tr = this.computeTextStats(editorBlock.translation ?? "");
      editorBlock.metaLinesEn = eng.lines;
      editorBlock.metaLinesTr = tr.lines;
      editorBlock.metaColsEn = eng.cols;
      editorBlock.metaColsTr = tr.cols;
      editorBlock.metaVarsEn = eng.vars;
      editorBlock.metaVarsTr = tr.vars;
      editorBlock.metaKwEn = eng.kw;
      editorBlock.metaKwTr = tr.kw;
      editorBlock.metaDecorEn = eng.decor;
      editorBlock.metaDecorTr = tr.decor;
      if (typeof editorIndex === "number" && editorBlock.isMultiline && !editorBlock.isTable) {
        this.$nextTick(() => this.syncHlScroll('translation', editorIndex));
      }
    },
    translationInput(editorBlock, editorIndex) {
      if (editorBlock?.isTable) {
        this.syncEditorBlockFromTableColumns(editorBlock);
        this.refreshEditorBlockMeta(editorBlock, editorIndex);
        this.refreshGamePreview();
        return;
      }
      this.refreshEditorBlockMeta(editorBlock, editorIndex);
      const diagnostics = this.refreshTranslationDiagnostics(editorBlock);
      if (!editorBlock?.isMultiline) {
        editorBlock.translationHLter = this.buildTagHLter(editorBlock.translation ?? "", diagnostics.diagnostics);
      }
      this.refreshGamePreview();
    },
    computeMultilineLineMismatch(english, translation) {
      let eng = this.normalizeNewlines(english ?? "");
      let tr = this.normalizeNewlines(translation ?? "");
      let engLines = String(eng).split("\n");
      let trLines = String(tr).split("\n");
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
      return {
        engLines,
        trLines,
        engMismatch,
        trMismatch,
        mismatch: engMismatch.some(Boolean) || trMismatch.some(Boolean)
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
      if (editorBlock.isTable) {
        for (let i = 0; i < (editorBlock.tableColumns || []).length; i++) {
          this.refreshEditorTableColumnHLter(editorBlock.tableColumns[i]);
        }
        this.syncEditorBlockFromTableColumns(editorBlock);
        return;
      }
      let { englishHLter: baseEnglishHLter, HLs } = this.buildEnglishHLter(editorBlock.english);
      editorBlock.HLs = HLs;
      const diagnostics = this.refreshTranslationDiagnostics(editorBlock);
      if (!editorBlock.isMultiline) {
        editorBlock.englishHLter = baseEnglishHLter;
        editorBlock.translationHLter = this.buildTagHLter(editorBlock.translation ?? "", diagnostics.diagnostics);
        editorBlock.multilineLineMismatch = false;
        return;
      }
      let diff = this.computeMultilineLineMismatch(editorBlock.english, editorBlock.translation);
      editorBlock.englishHLter = this.wrapHlterByLines(baseEnglishHLter, diff.engMismatch);
      editorBlock.translationHLter = this.wrapHlterByLines(this.buildTagHLter(editorBlock.translation ?? "", diagnostics.diagnostics), diff.trMismatch);
      editorBlock.multilineLineMismatch = diff.mismatch;
    },
    syncHlScroll(kind, index, columnIndex = null) {
      let inputEl = this.getEditorRef(kind, index, columnIndex);
      let hlterEl = this.getEditorRef(`${kind}HLter`, index, columnIndex);
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
        if (b.isTable) {
          for (let col = 0; col < (b.tableColumns || []).length; col++) {
            if (!b.tableColumns[col]?.isMultiline) continue;
            this.autosizeTextarea(this.getEditorRef("english", i, col), { minHeight: 72, maxHeight: 220 });
            this.autosizeTextarea(this.getEditorRef("translation", i, col), { minHeight: 84, maxHeight: 260 });
          }
          continue;
        }
        this.autosizeTextarea(this.$refs["english_" + i], { minHeight: 72, maxHeight: 220 });
        this.autosizeTextarea(this.$refs["translation_" + i], { minHeight: 84, maxHeight: 260 });
      }
    },
    normalizeMultilineEditorBlock(editorBlock, editorIndex) {
      if (!editorBlock?.isMultiline) return;
      if (editorBlock.isTable) {
        this.syncEditorBlockFromTableColumns(editorBlock);
        if (typeof editorIndex === "number") {
          this.refreshEditorBlockHLter(editorIndex);
          this.refreshEditorBlockMeta(editorBlock, editorIndex);
          this.$nextTick(() => this.autosizeEditorMultilineFields());
        }
        this.refreshGamePreview();
        return;
      }
      let next = this.decodeEscapedNewlines(editorBlock.translation || "");
      if (next !== editorBlock.translation) editorBlock.translation = next;
      if (typeof editorIndex === "number") {
        this.$nextTick(() => this.autosizeTextarea(this.$refs["translation_" + editorIndex], { minHeight: 84, maxHeight: 260 }));
      }
      if (typeof editorIndex === "number") this.refreshEditorBlockHLter(editorIndex);
      if (typeof editorIndex === "number") this.refreshEditorBlockMeta(editorBlock, editorIndex);
      this.refreshGamePreview();
    },
    tableColumnInput(editorBlock, editorIndex, columnIndex) {
      let column = editorBlock?.tableColumns?.[columnIndex];
      if (!column) return;
      let next = column.isMultiline ? this.decodeEscapedNewlines(column.translation || "") : column.translation;
      if (next !== column.translation) column.translation = next;
      this.refreshEditorTableColumnHLter(column);
      this.syncEditorBlockFromTableColumns(editorBlock);
      if (typeof editorIndex === "number") {
        this.refreshEditorBlockMeta(editorBlock, editorIndex);
        if (column.isMultiline) {
          this.$nextTick(() => {
            this.autosizeTextarea(this.getEditorRef("translation", editorIndex, columnIndex), { minHeight: 84, maxHeight: 260 });
            this.syncHlScroll("translation", editorIndex, columnIndex);
          });
        }
      }
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
      let overlapsExistingHL = (start, end) => {
        return HLs.some(hl => start < hl.index + hl.find.length && hl.index < end);
      };
      let maskRange = (value, start, end) => {
        return value.substring(0, start) + '*'.repeat(Math.max(0, end - start)) + value.substring(end);
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

      // highlight text decoration tag names <tagName>{{text}}, but keep the body unhighlighted
      let escapedTextDecorationRegex = new RegExp(`(&lt;(${textDecorationTagNameRegex})&gt;\\{\\{([\\s\\S]*?)\\}\\})`, 'igm');
      while (m = escapedTextDecorationRegex.exec(modifiedEnglish)) {
        let tagName = m[2];
        let opener = `&lt;${tagName}&gt;`;
        let value = `<${tagName}>{{}}`;
        addHL({
          index: m.index,
          find: opener,
          tagName,
          isTextDecoration: true,
          replace: value,
          label: `<${tagName}>{{_}}`,
          caretOffset: `<${tagName}>{{`.length
        });
        modifiedEnglish = maskRange(modifiedEnglish, m.index, m.index + opener.length);
      }

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
        const found = m[1] || m[0];
        if (overlapsExistingHL(m.index, m.index + found.length)) continue;
        addHL({
          index: m.index,
          find: found
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
            // skip if it overlaps a tag highlight
            if (overlapsExistingHL(m.index, m.index + m[0].length)) continue;
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
        let tooltipLines = [
          `Click / Alt+${HLs.length-i} = Paste below`,
          "Alt+Click = Copy to Clipboard"
        ];
        if (HL?.isKeywordPopup) {
          tooltipLines.push(HL?.dictId
            ? "Ctrl+Click = Jump to Dictionary"
            : "Ctrl+Click = Add to Dictionary");
        }
        const dataValue = escapeHtml(String(HL.replace ? HL.replace : unescapeHtml(HL.find)));
        const caretOffset = Number.isInteger(HL.caretOffset) ? ` data-caret-offset="${HL.caretOffset}"` : "";
        let tag = `<span class="${HL.replace ? "vocab" : ""}" data-tooltip="${escapeTooltipAttr(tooltipLines.join("\n"))}" data-hl-id="${HL._hlId}" dataValue="${dataValue}"${caretOffset}>${HL.find}</span>`;
        englishHLter = englishHLter.substring(0, HL.index) + tag + englishHLter.substring(HL.index + HL.find.length);
      }
      HLs.sort((a, b) => a.index - b.index); // sort acending

      return { englishHLter, HLs };
    },
    buildTranslationTagRanges(text) {
      let source = String(text ?? "");
      let modifiedText = source;
      let ranges = [];
      let m;

      let textDecorationRegex = new RegExp(textDecorationTagRegex, 'igm');
      while (m = textDecorationRegex.exec(modifiedText)) {
        const tagName = String(m[2] ?? "");
        const openerLength = `<${tagName}>`.length;
        ranges.push({
          start: m.index,
          end: m.index + openerLength,
          classes: ["tagRange", "vocab"]
        });
        let mask = '*'.repeat(openerLength);
        modifiedText = modifiedText.substring(0, m.index) + mask + modifiedText.substring(m.index + openerLength);
      }

      let keywordPopupRegex = new RegExp(keywordPopupTagRegex, 'igm');
      while (m = keywordPopupRegex.exec(modifiedText)) {
        ranges.push({
          start: m.index,
          end: m.index + m[0].length,
          classes: ["tagRange", "vocab"]
        });
        let mask = '*'.repeat(m[0].length);
        modifiedText = modifiedText.substring(0, m.index) + mask + modifiedText.substring(m.index + m[0].length);
      }

      let gggRegex = new RegExp(gggVarTagRegex, 'igm');
      while (m = gggRegex.exec(modifiedText)) {
        const found = m[1] || m[0];
        ranges.push({
          start: m.index,
          end: m.index + found.length,
          classes: ["tagRange"]
        });
      }

      return ranges;
    },
    buildDiagnosticRanges(diagnostics) {
      return (Array.isArray(diagnostics) ? diagnostics : []).map(diagnostic => ({
        start: diagnostic.start,
        end: diagnostic.end,
        classes: ["diagnosticRange", diagnostic.level === "error" ? "diagError" : "diagWarning"],
        message: diagnostic.message || diagnostic.code || "Translation diagnostic"
      }));
    },
    renderTextRanges(text, ranges) {
      const source = String(text ?? "");
      const length = source.length;
      const cleanRanges = (Array.isArray(ranges) ? ranges : [])
        .map(range => {
          const rawStart = Number(range.start);
          const rawEnd = Number(range.end);
          if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) return null;
          const start = Math.max(0, Math.min(length, rawStart));
          const end = Math.max(start, Math.min(length, rawEnd));
          if (end <= start) return null;
          return { ...range, start, end };
        })
        .filter(Boolean);

      if (length <= 0) return "";

      let points = new Set([0, length]);
      for (let i = 0; i < length; i++) {
        if (source[i] === "\n") {
          points.add(i);
          points.add(i + 1);
        }
      }
      for (const range of cleanRanges) {
        points.add(range.start);
        points.add(range.end);
      }

      const sortedPoints = Array.from(points).sort((a, b) => a - b);
      let html = "";
      for (let i = 0; i < sortedPoints.length - 1; i++) {
        const start = sortedPoints[i];
        const end = sortedPoints[i + 1];
        if (end <= start) continue;
        const raw = source.slice(start, end);
        if (raw === "\n") {
          html += "\n";
          continue;
        }

        const activeRanges = cleanRanges.filter(range => range.start < end && start < range.end);
        if (activeRanges.length <= 0) {
          html += escapeHtml(raw);
          continue;
        }

        const classes = [];
        const messages = [];
        for (const range of activeRanges) {
          for (const className of (range.classes || [])) {
            if (className && !classes.includes(className)) classes.push(className);
          }
          if (range.message && !messages.includes(range.message)) messages.push(range.message);
        }

        let attrs = classes.length ? ` class="${classes.join(" ")}"` : "";
        if (messages.length) attrs += ` data-tooltip="${escapeTooltipAttr(messages.join("\n"))}"`;
        html += `<span${attrs}>${escapeHtml(raw)}</span>`;
      }
      return html;
    },
    buildTagHLter(text, diagnostics = null) {
      const source = String(text ?? "");
      const diagnosticItems = Array.isArray(diagnostics)
        ? diagnostics
        : this.analyzeTranslationDiagnostics(source).diagnostics;
      const ranges = [
        ...this.buildTranslationTagRanges(source),
        ...this.buildDiagnosticRanges(diagnosticItems)
      ];
      return this.renderTextRanges(source, ranges);
    },
    refreshEditorHLter() {
      if (!this.editorVisible) return;
      for (let i = 0; i < (this.editorBlocks || []).length; i++) {
        let editorBlock = this.editorBlocks[i];
        if (editorBlock.isTable) {
          for (let col = 0; col < (editorBlock.tableColumns || []).length; col++) {
            this.refreshEditorTableColumnHLter(editorBlock.tableColumns[col]);
          }
          this.syncEditorBlockFromTableColumns(editorBlock);
          this.refreshEditorBlockMeta(editorBlock, i);
          this.$nextTick(() => {
            for (let col = 0; col < (editorBlock.tableColumns || []).length; col++) {
              if (!editorBlock.tableColumns[col]?.isMultiline) continue;
              this.syncHlScroll('english', i, col);
              this.syncHlScroll('translation', i, col);
            }
          });
          continue;
        }
        let { englishHLter: baseEnglishHLter, HLs } = this.buildEnglishHLter(editorBlock.english);
        editorBlock.HLs = HLs;
        const diagnostics = this.refreshTranslationDiagnostics(editorBlock);
        if (!editorBlock.isMultiline) {
          editorBlock.englishHLter = baseEnglishHLter;
          editorBlock.translationHLter = this.buildTagHLter(editorBlock.translation ?? "", diagnostics.diagnostics);
          editorBlock.multilineLineMismatch = false;
          continue;
        }
        let diff = this.computeMultilineLineMismatch(editorBlock.english, editorBlock.translation);
        editorBlock.englishHLter = this.wrapHlterByLines(baseEnglishHLter, diff.engMismatch);
        editorBlock.translationHLter = this.wrapHlterByLines(this.buildTagHLter(editorBlock.translation ?? "", diagnostics.diagnostics), diff.trMismatch);
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
    setEditorFocus(index, columnIndex = 0) {
      this.editorFocusedIndex = index;
      this.editorFocusedColumnIndex = Number.isInteger(columnIndex) ? columnIndex : 0;
      this.refreshGamePreview();
      if (this.hlPopup.visible) {
        this.openHlPopup(index, { columnIndex: this.editorFocusedColumnIndex });
      }
    },
    buildHlPopupItems(editorIndex, columnIndex = 0) {
      let editorBlock = this.editorBlocks?.[editorIndex];
      let source = this.getEditorColumn(editorBlock, columnIndex);
      let HLs = source?.HLs || [];
      let items = [];
      let seen = new Map();
      let seenValue = new Map();
      for (const hl of HLs) {
        if (hl?.isTextDecoration) {
          let value = hl?.replace || "";
          if (!value) continue;
          let existingValueItem = seenValue.get(value);
          if (existingValueItem) {
            if (hl?._hlId && Array.isArray(existingValueItem.hlIds) && !existingValueItem.hlIds.includes(hl._hlId)) {
              existingValueItem.hlIds.push(hl._hlId);
            }
            continue;
          }
          let label = hl?.label || value;
          let item = {
            label,
            value,
            matchText: label,
            matchTextLower: label.toLowerCase(),
            isAlt: false,
            hlIds: hl?._hlId ? [hl._hlId] : [],
            caretOffset: hl.caretOffset
          };
          seenValue.set(value, item);
          items.push(item);
          continue;
        }

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

          let itemToAdds = [];
          let exactMatchItem = null;
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
                if (exactFromContext && !exactMatchItem) exactMatchItem = existingItem;
                continue;
              }
              let item = {
                label,
                value,
                matchText: p.find,
                matchTextLower: p.find.toLowerCase(),
                // isAlt: !p.isMain,
                isAlt: true,
                exactFromContext,
                hlIds: hl?._hlId ? [hl._hlId] : [],
                dictEntryId: dictEntry._id,
                dictAltId: p.isMain ? "" : (p?._id || ""),
                kwTagName,
                kwDynamicContent
              };
              seen.set(key, item);
              if (exactFromContext && !exactMatchItem) exactMatchItem = item;
              itemToAdds.push(item);
            }
          }
          
          // Check if we got any exact matches
          if (!exactMatchItem) {
            // We have a dictionary entry that does not match the context exactly
            // Add an option to create a new dictionary entry
            console.log(`No exact match for ${hl.find}`);
            let item = {
              label: `${hl.find} → create a new alternative...`,
              value: hl.find,
              matchText: hl.find,
              matchTextLower: hl.find.toLowerCase(),
              isAlt: false,
              exactFromContext: true,
              hlIds: [],
              kwTagName,
              kwDynamicContent,
              mustCreate: true
            };
            items.push(item, ...itemToAdds.filter(item => item.isAlt));
          } else {
            // We have an exact match
            // set it as the exact match
            exactMatchItem.isAlt = false;
            let exactMatchItemIsNew = itemToAdds.includes(exactMatchItem);
            items.push(
              ...(exactMatchItemIsNew ? [exactMatchItem] : []),
              ...itemToAdds.filter(item => item.isAlt && item !== exactMatchItem)
            );
          }

          continue;
        }

        // No association with a dictionary entry
        let value = hl?.replace || hl?.find || "";
        if (!value) continue;
        let existingValueItem = seenValue.get(value);
        if (existingValueItem) {
          if (hl?._hlId && Array.isArray(existingValueItem.hlIds) && !existingValueItem.hlIds.includes(hl._hlId)) {
            existingValueItem.hlIds.push(hl._hlId);
          }
          continue;
        }
        console.log(`No association with a dictionary entry: ${value}`);
        let label = hl.find;
        let mustCreate = false;
        if (hl.isKeywordPopup) {
          label = `${hl.find} → create a new dictionary entry...`;
          mustCreate = true;
        }
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
          kwDynamicContent: kw?.dynamicContent || "",
          mustCreate
        };
        seenValue.set(value, item);
        items.push(item);
      }
      return items;
    },
    getHlPopupAnchorRects(editorIndex, columnIndex = 0) {
      let editorBlock = this.editorBlocks?.[editorIndex];
      let refColumn = editorBlock?.isTable ? columnIndex : null;
      let translationEl = this.getEditorRef("translation", editorIndex, refColumn);
      if (!translationEl?.getBoundingClientRect) return null;

      let translationRect = translationEl.getBoundingClientRect();
      let sourceEl = this.getEditorRef("english", editorIndex, refColumn)
        || this.getEditorRef("englishHLter", editorIndex, refColumn);
      let sourceRect = sourceEl?.closest?.(".textHL")?.getBoundingClientRect?.()
        || sourceEl?.getBoundingClientRect?.()
        || translationRect;

      return { sourceRect, translationRect };
    },
    positionHlPopup(editorIndex, columnIndex = 0) {
      let rects = this.getHlPopupAnchorRects(editorIndex, columnIndex);
      if (!rects) return;
      let rect = rects.translationRect;
      let sourceRect = rects.sourceRect || rect;
      let avoidTop = Math.min(sourceRect.top, rect.top);
      let avoidBottom = Math.max(sourceRect.bottom, rect.bottom);
      let gap = 6;
      let margin = 8;
      let viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
      let popupEl = this.$refs?.hlPopupPanel;
      let popupRect = popupEl?.getBoundingClientRect?.();
      let popupHeight = Math.ceil(popupRect?.height || Math.min(360, Math.max(180, viewportHeight * 0.48)));
      let width = Math.min(Math.max(rect.width, 260), 640);
      let left = Math.min(rect.left, window.innerWidth - width - 8);
      if (left < 8) left = 8;

      let belowSpace = Math.max(0, viewportHeight - avoidBottom - gap - margin);
      let aboveSpace = Math.max(0, avoidTop - gap - margin);
      let placeAbove = belowSpace < popupHeight && aboveSpace > belowSpace;
      let available = placeAbove ? aboveSpace : belowSpace;
      let maxHeight = Math.max(96, Math.min(popupHeight, available || popupHeight));
      let top = placeAbove
        ? avoidTop - gap - maxHeight
        : avoidBottom + gap;

      if (top < margin) top = margin;
      if (viewportHeight && top + maxHeight > viewportHeight - margin) {
        top = Math.max(margin, viewportHeight - margin - maxHeight);
      }

      this.hlPopup.x = Math.round(left);
      this.hlPopup.y = Math.round(top);
      this.hlPopup.width = Math.round(width);
      this.hlPopup.maxHeight = Math.round(maxHeight);
    },
    getTranslationSelectionText(editorIndex, columnIndex = 0) {
      let editorBlock = this.editorBlocks?.[editorIndex];
      let el = this.getEditorRef("translation", editorIndex, editorBlock?.isTable ? columnIndex : null);
      if (!el || typeof el.selectionStart !== "number" || typeof el.selectionEnd !== "number") return "";
      let start = Math.min(el.selectionStart, el.selectionEnd);
      let end = Math.max(el.selectionStart, el.selectionEnd);
      if (start === end) return "";
      return String(el.value || "").slice(start, end);
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
      let columnIndex = Number.isInteger(options.columnIndex) ? options.columnIndex : (this.editorFocusedColumnIndex || 0);
      this.hlPopupReturnInfo = null;
      this.hlPopup.editorIndex = editorIndex;
      this.hlPopup.columnIndex = columnIndex;
      this.hlPopup.openedByBracket = !!options.openedByBracket;
      this.hlPopup.openedByChar = String(options.openedByChar || "");
      this.hlPopup.selectedTranslationText = this.getTranslationSelectionText(editorIndex, columnIndex);
      this.hlPopup.items = this.buildHlPopupItems(editorIndex, columnIndex);
      this.hlPopup.filter = "";
      this.applyHlPopupFilter();
      this.positionHlPopup(editorIndex, columnIndex);
      this.hlPopup.visible = true;
      let focusFilter = options.focusFilter !== false;
      this.$nextTick(() => {
        this.positionHlPopup(editorIndex, columnIndex);
        if (focusFilter) this.$refs.hlPopupFilter?.focus();
      });
    },
    closeHlPopup(options = {}) {
      let editorIndex = this.hlPopup.editorIndex;
      let columnIndex = this.hlPopup.columnIndex || 0;
      this.hlPopup.visible = false;
      this.hlPopup.openedByBracket = false;
      this.hlPopup.openedByChar = "";
      this.hlPopup.filter = "";
      this.hlPopup.items = [];
      this.hlPopup.filtered = [];
      this.hlPopup.selectedIndex = 0;
      this.hlPopup.maxHeight = 0;
      this.hlPopup.selectedTranslationText = "";
      if (options.refocus && this.editorVisible) {
        this.$nextTick(() => {
          let editorBlock = this.editorBlocks?.[editorIndex];
          this.getEditorRef("translation", editorIndex, editorBlock?.isTable ? columnIndex : null)?.focus?.();
        });
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
    ensureDictionaryKeywordTag(tagName, altFind = "", replaceText = "") {
      let tn = String(tagName ?? "").trim();
      if (!tn) return { dictId: "", created: false, addedAlt: false };
      let alt = String(altFind ?? "").trim();
      let replace = String(replaceText ?? "");

      this.sideTab = "dictionary";
      this.dictionaryFilter = "";

      let existing = (this.dictionary || []).find(d => String(d?.find || "").trim().toLowerCase() === tn.toLowerCase());
      if (existing) {
        let addedAlt = false;
        let createdAltId = "";
        if (alt) {
          let pairs = this.getDictionaryDefinitionPairs(existing);
          if (!pairs.some(p => String(p?.find || "").trim().toLowerCase() === alt.toLowerCase())) {
            createdAltId = this.addDictionaryAltPair(existing, alt, replace || existing?.replace || "");
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
        replace: replace || tn,
        alts: alt ? [{ _id: (createdAltId = `a_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`), find: alt, replace: replace || tn }] : [],
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

      this.hlPopupReturnInfo = item;
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
      let selectedText = String(this.hlPopup.selectedTranslationText ?? "");
      if (selectedText) {
        if (altId) {
          let alt = Array.isArray(entry.alts) ? entry.alts.find(a => String(a?._id) === altId) : null;
          if (alt) alt.replace = selectedText;
        } else {
          entry.replace = selectedText;
        }
        this.syncEditorHlterWithDictionaryNow();
      }
      this.hlPopupReturnInfo = item;
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
    hlPopupEnterAction() {
      let item = this.hlPopup.filtered?.[this.hlPopup.selectedIndex];
      if (!item) {
        this.insertHlPopupSelection();
      }

      if (item.mustCreate) {
        return this.createDictionaryEntryFromHlPopupSelection();
      }

      this.insertHlPopupSelection();
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

      let selectedText = String(this.hlPopup.selectedTranslationText ?? "");
      this.closeHlPopup();
      let r = this.ensureDictionaryKeywordTag(info.tagName, info.dynamicContent, selectedText);
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
        let block = this.editorBlocks[i];
        if (block?.isTable) {
          for (let col = 0; col < (block.tableColumns || []).length; col++) {
            let r = this.getEditorRef("englishHLter", i, col);
            if (!r?.querySelectorAll) continue;
            for (const el of r.querySelectorAll('span[data-hl-id].hlPopupActive')) {
              el.classList.remove('hlPopupActive');
            }
          }
        } else {
          let r = this.getEditorRef("englishHLter", i);
          if (!r?.querySelectorAll) continue;
          for (const el of r.querySelectorAll('span[data-hl-id].hlPopupActive')) {
            el.classList.remove('hlPopupActive');
          }
        }
      }

      if (document?.querySelectorAll) {
        for (const el of document.querySelectorAll('.side .dictRow.hlPopupDictActive, .side .dictAltRow.hlPopupDictActive')) {
          el.classList.remove('hlPopupDictActive');
        }
      }

      if (!this.hlPopup.visible) return;

      let editorIndex = this.hlPopup.editorIndex;
      let activeBlock = this.editorBlocks?.[editorIndex];
      let root = this.getEditorRef("englishHLter", editorIndex, activeBlock?.isTable ? (this.hlPopup.columnIndex || 0) : null);
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
      let editorBlock = this.editorBlocks?.[editorIndex];
      let columnIndex = Number.isInteger(options.columnIndex) ? options.columnIndex : (editorBlock?.isTable ? (this.hlPopup.columnIndex || this.editorFocusedColumnIndex || 0) : null);
      let el = this.getEditorRef("translation", editorIndex, editorBlock?.isTable ? columnIndex : null);
      let target = editorBlock?.isTable ? editorBlock.tableColumns?.[columnIndex] : editorBlock;
      text = String(text ?? "");
      if (!el || !editorBlock) {
        if (typeof document.execCommand === "function") document.execCommand("insertText", false, text);
        return;
      }
      if (typeof el.selectionStart !== "number" || typeof el.selectionEnd !== "number") {
        if (el?.focus) el.focus();
        if (typeof document.execCommand === "function") document.execCommand("insertText", false, text);
        return;
      }
      let value = el.value || "";
      let start = el.selectionStart;
      let end = el.selectionEnd;
      if (options.deleteOpeningBracket && start > 0 && value[start - 1] === "[") {
        start = start - 1;
      }
      if (options.deleteOpeningChar && start > 0 && value[start - 1] === options.deleteOpeningChar) {
        start = start - 1;
      }
      let syncEditedValue = () => {
        if (target) target.translation = el.value || "";
        if (editorBlock.isTable) {
          this.tableColumnInput(editorBlock, editorIndex, columnIndex);
        } else if (editorBlock.isMultiline) {
          this.normalizeMultilineEditorBlock(editorBlock, editorIndex);
        } else {
          this.translationInput(editorBlock, editorIndex);
        }
      };

      el.focus?.();
      el.setSelectionRange?.(start, end);
      let expectedValue = value.slice(0, start) + text + value.slice(end);
      let usedNativeEdit = false;
      if (typeof document.execCommand === "function") {
        if (!text && start !== end) {
          usedNativeEdit = document.execCommand("delete", false, null);
        } else {
          usedNativeEdit = document.execCommand("insertText", false, text);
        }
      }
      if (!usedNativeEdit || el.value !== expectedValue) {
        if (typeof el.setRangeText === "function") {
          el.setRangeText(text, start, end, "end");
        } else {
          el.value = expectedValue;
          let fallbackCaret = start + text.length;
          el.setSelectionRange?.(fallbackCaret, fallbackCaret);
        }
        let inputEvent;
        try {
          inputEvent = new InputEvent("input", {
            bubbles: true,
            inputType: text ? "insertText" : "deleteContentBackward",
            data: text
          });
        } catch (_) {
          inputEvent = new Event("input", { bubbles: true });
        }
        el.dispatchEvent(inputEvent);
      }
      syncEditedValue();
      this.$nextTick(() => {
        el.focus?.();
        let caret = start + (Number.isInteger(options.caretOffset) ? options.caretOffset : text.length);
        el.setSelectionRange?.(caret, caret);
      });
    },
    insertHlPopupItem(item) {
      let editorIndex = this.hlPopup.editorIndex;
      let deleteOpeningBracket = this.hlPopup.openedByBracket;
      let deleteOpeningChar = this.hlPopup.openedByChar || "";
      this.insertTranslationText(editorIndex, item.value, { deleteOpeningBracket, deleteOpeningChar, columnIndex: this.hlPopup.columnIndex || 0, caretOffset: item.caretOffset });
      this.closeHlPopup({ refocus: true });
    },
    insertHlPopupSelection() {
      let item = this.hlPopup.filtered[this.hlPopup.selectedIndex];
      if (!item) return;
      this.insertHlPopupItem(item);
    },
    onDictionaryReplaceEnter(e) {
      if (!this.hlPopupReturnInfo) return;
      let returnInfo = this.hlPopupReturnInfo;
      this.hlPopupReturnInfo = null;
      this.insertTranslationText(this.hlPopup.editorIndex, `[${returnInfo.kwTagName}|${e.target.value}]`, { deleteOpeningBracket: true, columnIndex: this.hlPopup.columnIndex || 0 });
    },
    translationKeydown(e, editorIndex, columnIndex = 0) {
      if ((e.key === "[" || e.key === "<") && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (!this.editorVisible) return;
        this.setEditorFocus(editorIndex, columnIndex);
        if (!this.hlPopup.visible) {
          setTimeout(() => this.openHlPopup(editorIndex, { openedByBracket: e.key === "[", openedByChar: e.key, columnIndex }), 0);
        }
        return;
      }

      if (!this.hlPopup.visible) return;

      if (e.key === "Escape") {
        e.preventDefault();
        this.closeHlPopup({ refocus: true });
        return;
      }

      if (e.key === "Backspace") {
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
      if (e.key === "Escape") {
        e.preventDefault();
        this.closeHlPopup({ refocus: true });
        return;
      }
      if (e.key === "Backspace" && !this.hlPopup.filter) {
        e.preventDefault();
        if (this.hlPopup.openedByBracket || this.hlPopup.openedByChar) {
          this.insertTranslationText(this.hlPopup.editorIndex, "", { deleteOpeningBracket: true, deleteOpeningChar: this.hlPopup.openedByChar || "", columnIndex: this.hlPopup.columnIndex || 0 });
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
    isFilterFocusShortcut(e) {
      return !!e?.ctrlKey && e.code === (this.filterShortcutCtrlD ? "KeyD" : "KeyF");
    },
    handleKeydown(e) {
      if (this.duplicateLangImportWarning && e.key === "Escape") {
        e.preventDefault();
        return;
      }
      if (this.importDialogVisible && e.key === "Escape") {
        e.preventDefault();
        this.closeImportDialog();
        return;
      }

      // Ctrl + S: Save in editor or Export in table view
      if (e.ctrlKey && e.code === "KeyS") {
        e.preventDefault();
        if (this.editorVisible) {
          if (this.autoOpenNextFile) {
            this.saveAndSkipFile();
          } else {
            this.editorSave();
          }
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
        if (e.key === "Escape") {
          e.preventDefault();
          this.closeHlPopup({ refocus: true });
          return;
        }
        if (e.key === "ArrowDown") {
          e.preventDefault();
          this.moveHlPopupSelection(1);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          this.moveHlPopupSelection(-1);
          return;
        }
        if (e.ctrlKey && e.key === "Enter") {
          if (this.hlPopupCtrlEnterAction()) {
            e.preventDefault();
            return;
          }
        }
        if (e.key === "Enter") {
          this.hlPopupEnterAction();
          e.preventDefault();
          return;
        }
      }

      if (this.editorVisible && e.key === "Escape") {
        const t = e.target;
        const inEditor = t && typeof t.closest === "function" ? t.closest(".editor") : null;
        if (!inEditor) {
          this.editorEsc(e);
          e.preventDefault();
          return;
        }
      }

      // F2 or Ctrl + >: save and open next file
      if (e.code === "F2" || (e.ctrlKey && e.code === "Period")) {
        e.preventDefault();
        this.saveAndSkipFile(false, true);
        return;
      }
      // F1 or Ctrl + <: save and open previous file
      if (e.code === "F1" || (e.ctrlKey && e.code === "Comma")) {
        e.preventDefault();
        this.saveAndSkipFile(true, true);
        return;
      }
      
      if (this.isFilterFocusShortcut(e)) {
        if (this.isActiveElementInSearchBox()) {
          if (this.filterShortcutCtrlD) e.preventDefault();
          return;
        }
        e.preventDefault();
        if (this.editorVisible) {
          this.focusSidebarFilterInput();
          return;
        }
        this.$refs.searchInput?.focus();
        this.$refs.searchInput?.select();
      }
    },
  
    openFirstFile() {
      if (this.descsDisplay.length > 0) {
        let firstDesc = this.descsDisplay[0];
        this.editFile(firstDesc.filepath);
        return true;
      }
      return false;
    },
    saveAndSkipFile(reverse = false, noSaveIfNotChanged = false) {
      if (this.editorVisible) {
        if (noSaveIfNotChanged && !this.editorHaveChanges()) {
          this.editorExit();
        } else {
          if (!this.editorSave()) return;
        }
        this.editorVisible = true;
      } else {
        if (!this.openFirstFile()) return;
      }
      let idx = this.descsDisplay.findIndex(d => d.filepath === (this.editorVisible ? this.editorCurrentEditingDesc?.filepath : null));

      let targetIdx = idx >= 0 ? idx + (reverse ? -1 : 1) : 0;
      
      // page boundary
      if (targetIdx < 0) {
        if (this.currentPage > 0) {
          this.prevPage();
          targetIdx = this.descsDisplay.length - 1;
        } else {
          alert("No more files.");
          return;
        }
      } else if (targetIdx >= this.descsDisplay.length) {
        if (this.currentPage < this.pageCount) {
          this.nextPage();
          targetIdx = 0;
        } else {
          alert("No more files.");
          return;
        }
      }

      this.editFile(this.descsDisplay[targetIdx].filepath);
      return;
    },
    showImportUpdateZipDialog() {
      this.$refs.importUpdateZipFile?.click?.();
    },
    importZipClicked() {
      this.importDialogVisible = true;
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
    closeDuplicateLangImportWarning() {
      this.duplicateLangImportWarning = null;
      this.pendingDuplicateLangImport = null;
    },
    importNextVersionZipClicked() {
      this.closeImportDialog();
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
        `This will DELETE your ${this.formatGameVersion(this.gameVersion)} translated workspace data and ${this.formatGameVersion(this.gameVersion)} revision history stored in this browser.\n\n` +
        "You will lose your working translated files and history for the selected version.\n\n" +
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
    collectDuplicateLangGroups(parsed) {
      const groups = [];
      for (let descIndex = 0; descIndex < (parsed || []).length; descIndex++) {
        const desc = parsed[descIndex];
        if (!desc || !Array.isArray(desc.duplicateLangGroups)) continue;
        for (let groupIndex = 0; groupIndex < desc.duplicateLangGroups.length; groupIndex++) {
          const group = desc.duplicateLangGroups[groupIndex];
          const options = (group?.options || []).map(option => ({
            id: option?.id || `${group?.lang || 'lang'}-${option?.occurrence || 0}`,
            lang: option?.lang || group?.lang || '(unknown language)',
            line: Number.isFinite(option?.line) ? option.line : 0,
            occurrence: Number.isFinite(option?.occurrence) ? option.occurrence : 1,
            content: Array.isArray(option?.content) ? option.content.slice() : []
          }));
          if (options.length < 2) continue;
          groups.push({
            id: `${descIndex}:${groupIndex}:${group?.lang || 'lang'}`,
            descIndex,
            filepath: group?.filepath || desc.filepath || '(unknown file)',
            lang: group?.lang || '(unknown language)',
            selectedOptionId: '',
            options
          });
        }
      }
      groups.sort((a, b) => {
        const fileCmp = String(a.filepath).localeCompare(String(b.filepath));
        if (fileCmp !== 0) return fileCmp;
        return String(a.lang).localeCompare(String(b.lang));
      });
      return groups;
    },
    isDuplicateLangResolutionComplete() {
      const groups = this.duplicateLangImportWarning?.groups;
      return Array.isArray(groups) && groups.length > 0 && groups.every(group => !!group.selectedOptionId);
    },
    duplicateLangResolutionRemainingCount() {
      const groups = this.duplicateLangImportWarning?.groups || [];
      return groups.filter(group => !group.selectedOptionId).length;
    },
    startDuplicateLangResolution(parsed, file, { mode, importMode, isPostMigrationImport } = {}) {
      const groups = this.collectDuplicateLangGroups(parsed);
      if (groups.length === 0) return false;
      this.loadingProgress = this.sourceLoaded ? 100 : 0;
      this.pendingDuplicateLangImport = {
        mode,
        file,
        parsed,
        isPostMigrationImport: !!isPostMigrationImport
      };
      this.duplicateLangImportWarning = {
        fileName: file?.name || 'Selected ZIP',
        importMode,
        groups
      };
      return true;
    },
    applyDuplicateLangSelections(parsed, groups) {
      for (const group of groups || []) {
        const desc = parsed?.[group.descIndex];
        const selected = (group.options || []).find(option => option.id === group.selectedOptionId);
        if (!desc || !selected) continue;
        if (!desc.translations || typeof desc.translations !== 'object') desc.translations = {};
        desc.translations[group.lang] = selected.content.slice();
        if (group.lang === 'English') {
          const firstLine = String(desc.translations.English?.[0] || '');
          desc.isDNT = firstLine.indexOf('[DNT') === 0 || firstLine.indexOf('DNT ') === 0;
        }
        const engLen = Array.isArray(desc?.translations?.English) ? desc.translations.English.length : 0;
        const trLines = Array.isArray(desc?.translations?.[this.lang]) ? desc.translations[this.lang] : [];
        desc.isMissing = computeIsMissing(engLen, trLines);
      }
    },
    async confirmDuplicateLangImportResolution() {
      if (!this.isDuplicateLangResolutionComplete()) return;
      const pending = this.pendingDuplicateLangImport;
      const warning = this.duplicateLangImportWarning;
      if (!pending || !warning) return;

      this.applyDuplicateLangSelections(pending.parsed, warning.groups);
      this.duplicateLangImportWarning = null;
      this.pendingDuplicateLangImport = null;
      this.loadingProgress = 0.001;

      if (pending.mode === 'update') {
        await this.importUpdateZipFile(pending.file, pending.parsed, {
          isPostMigrationImport: pending.isPostMigrationImport
        });
        return;
      }
      if (pending.mode === 'translated') {
        await this.importTranslatedZipFile(pending.file, pending.parsed);
      }
    },

    async importUpdateZipFile(file, resolvedParsed = null, options = {}) {
      if (!file) return;
      if (!offlineStoreReady) return;
      if (!this.lang) {
        alert('Please select a language in Settings first.');
        return;
      }

      const isPostMigrationImport = typeof options.isPostMigrationImport === 'boolean' ? options.isPostMigrationImport : !!this.needsPostMigrationImport;

      let parsed = resolvedParsed;
      if (!parsed) {
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
        const detectedGameVersion = this.detectGameVersionFromZip(zip);
        if (txtFileCount >= ZIP_TXT_FILE_COUNT_THRESHOLD && detectedGameVersion && detectedGameVersion !== this.gameVersion) {
          const detectedLabel = this.formatGameVersion(detectedGameVersion);
          const currentLabel = this.formatGameVersion(this.gameVersion);
          const ok = confirm(
            `This StatDescriptions.zip looks like ${detectedLabel}, but you are currently working in ${currentLabel}.\n\n` +
            `Switch to ${detectedLabel} and import it there?`
          );
          if (!ok) {
            this.loadingProgress = 100;
            return;
          }
          await this.activateGameVersion(detectedGameVersion, { checkMigration: true });
          if (this.pendingSingleVersionMigration) {
            this.loadingProgress = 0;
            alert('Please finish or skip the migration before importing this ZIP.');
            return;
          }
          this.loadingProgress = 0.001;
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

        parsed = await allProgress(parseFuncs, (p) => {
          const percent = Math.max(0.001, Math.min(99.999, Number(p) || 0));
          this.loadingProgress = percent;
        });
        if (this.startDuplicateLangResolution(parsed, file, { mode: 'update', importMode: 'Import Next Version', isPostMigrationImport })) return;
      }
      const nextSource = parsed.filter(Boolean);

      this.localDescs.lastModified = file.lastModified;
      this.localDescs.size = file.size;
      this.ensureLocalDescsReady();

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
            const latest = await window.OfflineStore.getLatestRevision(nextDesc.filepath, 'English', this.gameVersion);
            if (!latest || !arrayEquals(latest.translations, nextEng)) await window.OfflineStore.addRevision(rev, this.gameVersion);
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
            const latest = await window.OfflineStore.getLatestRevision(nextDesc.filepath, 'English', this.gameVersion);
            if (!latest) await window.OfflineStore.addRevision(rev, this.gameVersion);
          } catch (_) {
          }
        }
      }

      this.descs = nextSource;
      this.sourceLoaded = true;

      await this.saveLocalDescs();
      if (window.OfflineStore && typeof window.OfflineStore.setSource === 'function') {
        try {
          await window.OfflineStore.setSource(nextSource, this.gameVersion);
        } catch (_) {
        }
      }

      this.loadingProgress = 100;
      this.filterDesc();
    },

    async importTranslatedZipFile(file, resolvedParsed = null) {
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
      let parsed = resolvedParsed;
      if (!parsed) {
        if (String(file?.name || '').toLowerCase() !== 'statdescriptions_translated.zip') {
          if (!confirm('This does not look like StatDescriptions_Translated.zip. Import anyway?')) return;
        }

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

        parsed = await allProgress(parseFuncs, (p) => {
          const percent = Math.max(0.001, Math.min(99.999, Number(p) || 0));
          this.loadingProgress = percent;
        });
        if (this.startDuplicateLangResolution(parsed, file, { mode: 'translated', importMode: 'Import Translated' })) return;
      }

      this.ensureLocalDescsReady();
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
            const latest = await window.OfflineStore.getLatestRevision(desc.filepath, this.lang, this.gameVersion);
            if (!latest || !arrayEquals(latest.translations, lines)) await window.OfflineStore.addRevision(rev, this.gameVersion);
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
        let decodedEnglish = this.decodeEscapedNewlines(englishRaw);
        let decodedTranslation = this.decodeEscapedNewlines(translationRaw);
        let isTable = this.isTableText(decodedEnglish) || this.isTableText(decodedTranslation);
        let isMultiline = this.isMultilineText(englishRaw) || this.isMultilineText(translationRaw);
        let english = (isTable || isMultiline) ? decodedEnglish : englishRaw;
        let translation = (isTable || isMultiline) ? decodedTranslation : translationRaw;
        let { englishHLter: baseEnglishHLter, HLs } = this.buildEnglishHLter(english);
        let englishHLter = baseEnglishHLter;
        let translationDiagnosticResult = this.analyzeTranslationDiagnostics(translation ?? "", english ?? "");
        let translationHLter = this.buildTagHLter(translation ?? "", translationDiagnosticResult.diagnostics);
        let multilineLineMismatch = false;
        let tableColumns = [];
        if (isTable) {
          tableColumns = this.buildEditorTableColumns(english, translation);
          isMultiline = tableColumns.some(col => col.isMultiline);
          multilineLineMismatch = tableColumns.some(col => col.multilineLineMismatch);
          let tableDiagnostics = [];
          let tableWarningCount = 0;
          let tableErrorCount = 0;
          for (let col = 0; col < tableColumns.length; col++) {
            const column = tableColumns[col];
            tableWarningCount += Number(column?.diagnosticWarningCount || 0);
            tableErrorCount += Number(column?.diagnosticErrorCount || 0);
            for (const diagnostic of (column?.translationDiagnostics || [])) {
              tableDiagnostics.push({ ...diagnostic, columnIndex: col });
            }
          }
          translationDiagnosticResult = {
            diagnostics: tableDiagnostics,
            warningCount: tableWarningCount,
            errorCount: tableErrorCount
          };
          englishHLter = "";
          translationHLter = "";
          HLs = [];
        } else if (isMultiline) {
          let diff = this.computeMultilineLineMismatch(english, translation);
          englishHLter = this.wrapHlterByLines(baseEnglishHLter, diff.engMismatch);
          translationHLter = this.wrapHlterByLines(this.buildTagHLter(translation ?? "", translationDiagnosticResult.diagnostics), diff.trMismatch);
          multilineLineMismatch = diff.mismatch;
        }
        this.editorOriginalTranslations.push(translation);
        let engStats = this.computeTextStats(english);
        let trStats = this.computeTextStats(translation);
        this.editorBlocks.push({
          isTable,
          isMultiline,
          tableColumns,
          english,
          englishHLter,
          HLs,
          englishDiffHtml: escapeHtml(String(english ?? '')),
          translation,
          translationHLter,
          translationDiagnostics: translationDiagnosticResult.diagnostics,
          diagnosticWarningCount: translationDiagnosticResult.warningCount,
          diagnosticErrorCount: translationDiagnosticResult.errorCount,
          translationDiffHtml: escapeHtml(String(translation ?? '')),
          translationCompareColumns: [],
          multilineLineMismatch,
          metaLinesEn: engStats.lines,
          metaLinesTr: trStats.lines,
          metaColsEn: engStats.cols,
          metaColsTr: trStats.cols,
          metaVarsEn: engStats.vars,
          metaVarsTr: trStats.vars,
          metaKwEn: engStats.kw,
          metaKwTr: trStats.kw,
          metaDecorEn: engStats.decor,
          metaDecorTr: trStats.decor,
          translationReplace: "",
          words: []
        })
      }
      this.editorVisible = true;
      this.editorFocusedIndex = 0;
      this.editorFocusedColumnIndex = 0;
      this.$nextTick(() => {
        let firstBlock = this.editorBlocks?.[0];
        this.getEditorRef("translation", 0, firstBlock?.isTable ? 0 : null)?.focus?.();
        this.autosizeEditorMultilineFields();
        for (let i = 0; i < (this.editorBlocks || []).length; i++) {
          if (!this.editorBlocks[i]?.isMultiline) continue;
          if (this.editorBlocks[i]?.isTable) {
            for (let col = 0; col < (this.editorBlocks[i].tableColumns || []).length; col++) {
              if (!this.editorBlocks[i].tableColumns[col]?.isMultiline) continue;
              this.syncHlScroll('english', i, col);
              this.syncHlScroll('translation', i, col);
            }
            continue;
          }
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
    copySpanToTranslation(e, editorBlock, editorIndex, columnIndex = 0) {
      let text = e.target.getAttribute('datavalue') || "";
      let caretOffsetRaw = e.target.getAttribute('data-caret-offset');
      let caretOffset = caretOffsetRaw == null ? null : Number(caretOffsetRaw);
      this.getEditorRef("translation", editorIndex, editorBlock?.isTable ? columnIndex : null)?.focus?.();
      this.insertTranslationText(editorIndex, text, { columnIndex, caretOffset: Number.isInteger(caretOffset) ? caretOffset : undefined });
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
    hotkeyPasteHL(e, editorBlock, editorIndex, columnIndex = 0) {
      let id = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'].indexOf(e.code);
      if (id < 0) return;
      let source = this.getEditorColumn(editorBlock, columnIndex);
      if (!source?.HLs?.[id]) return;
      let text = source.HLs[id].replace || source.HLs[id].find;
      this.insertTranslationText(editorIndex, text, { columnIndex, caretOffset: source.HLs[id].caretOffset });
    },
    editorShiftEnter() {
      if (this.shiftEnterSave) {
        if (this.autoOpenNextFile) {
          this.saveAndSkipFile();
        } else {
          this.editorSave();
        }
      }
    },
    editorSave() {
      if (this.editorTranslationReadOnly) return false;
      if (!this.editorHaveChanges()) return false;

      let desc = this.editorCurrentEditingDesc;
      let newTranslations = [];
      for (const editorBlock of this.editorBlocks) {
        if (editorBlock?.isTable) this.syncEditorBlockFromTableColumns(editorBlock);
        let ui = editorBlock?.translation ?? "";
        let normalizedUi = editorBlock?.isMultiline ? this.decodeEscapedNewlines(ui) : ui;
        newTranslations.push(this.encodeNewlines(normalizedUi));
      }

      this.refreshEditorDiagnostics();
      const diagnosticErrors = this.collectEditorDiagnostics("error");
      if (diagnosticErrors.length > 0) {
        alert(
          `Translation errors found. Please fix them before saving.\n\n` +
          `${this.formatDiagnosticsForDisplay(diagnosticErrors, 12)}`
        );
        return false;
      }

      const diagnosticWarnings = this.collectEditorDiagnostics("warning");
      if (diagnosticWarnings.length > 0) {
        const details = this.formatDiagnosticsForDisplay(diagnosticWarnings, 12);
        if (!confirm(`Translation warnings found:\n\n${details}\n\nDo you want to save anyway?`)) return false;
      }

      const isMissing = computeIsMissing(Array.isArray(desc?.translations?.English) ? desc.translations.English.length : 0, newTranslations);
      if (isMissing && !confirm("There're missing field in translation!\nAre you sure you want to save?")) return false;

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
        if (!confirm(`Number of lines mismatched!\n(Translation/English)\n\n${details}${suffix}\n\nDo you want to save anyway?`)) return false;
      }

      let columnMismatchInfo = [];
      for (let i = 0; i < (this.editorBlocks || []).length; i++) {
        let b = this.editorBlocks[i];
        if (!b?.isTable) continue;
        let engCols = this.computeTextStats(b?.english ?? "").cols;
        let trCols = this.computeTextStats(b?.translation ?? "").cols;
        if (engCols !== trCols) columnMismatchInfo.push(`#${i + 1}: ${trCols}/${engCols}`);
      }
      if (columnMismatchInfo.length > 0) {
        let details = columnMismatchInfo.slice(0, 12).join("\n");
        let suffix = columnMismatchInfo.length > 12 ? `\n...and ${columnMismatchInfo.length - 12} more` : "";
        if (!confirm(`Number of table columns mismatched!\n(Translation/English)\n\n${details}${suffix}\n\nDo you want to save anyway?`)) return false;
      }

      let newTagCount = newTranslations.reduce((p, c) => p += countGGGVarTag(c), 0);
      let engTagCount = desc.translations.English.reduce((p, c) => p += countGGGVarTag(c), 0);
      if (newTagCount != engTagCount && !confirm("Number of variable tags ({} tag) mismatched!\nDo you want to save anyway?")) return false;

      let newKeywordPopupTagCount = newTranslations.reduce((p, c) => p += countKeywordPopupTag(c), 0);
      let engKeywordPopupTagCount = desc.translations.English.reduce((p, c) => p += countKeywordPopupTag(c), 0);
      if (newKeywordPopupTagCount != engKeywordPopupTagCount && !confirm("Number of keyword popup tags ([] tag) mismatched!\nDo you want to save anyway?")) return false;

      let newTextDecorationTagCount = newTranslations.reduce((p, c) => p += countTextDecorationTag(c), 0);
      let engTextDecorationTagCount = desc.translations.English.reduce((p, c) => p += countTextDecorationTag(c), 0);
      if (newTextDecorationTagCount != engTextDecorationTagCount && !confirm("Number of text decoration tags (<tag>{{}} tag) mismatched!\nDo you want to save anyway?")) return false;

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
      return true;
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
          const items = await window.OfflineStore.listRevisions(filepath, lang, 100, this.gameVersion);
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
          this.applyEditorEnglishDiff(block, oldRaw, newRaw, curEng[i] ?? newRaw);
          const engRaw = curEng[i] ?? '';
          const engStr = this.getEditorDisplayText(engRaw);
          block.english = engStr;
          const trRaw = curTr[i] ?? '';
          block.translationDiffHtml = escapeHtml(String(trRaw ?? ''));
          block.translationCompareColumns = [];
        } else {
          const oldRaw = aLines[i] ?? '';
          const newRaw = bLines[i] ?? '';
          const oldStr = this.getEditorDisplayText(oldRaw);
          const newStr = this.getEditorDisplayText(newRaw);
          block.translationDiffHtml = this.renderInlineDiffHtml(oldStr, newStr);
          block.translationCompareColumns = block.isTable
            ? this.buildEditorTableTranslationDiffColumns(block, oldStr, newStr)
            : [];
          const engRaw = curEng[i] ?? '';
          const engStr = this.getEditorDisplayText(engRaw);
          block.english = engStr;
        }
      }
    },
    exitEditorCompareMode() {
      this.editorCompareActive = false;
      this.editorCompareTitle = '';
      this.editorShowEnglishDiff = !!this.editorCurrentEditingDesc?.needsReview;
      this.refreshEditorHLter();
      if (this.editorShowEnglishDiff) this.prepareEditorEnglishDiff();
      this.$nextTick(() => {
        this.autosizeEditorMultilineFields();
        this.refreshGamePreview();
      });
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
        const latest = await window.OfflineStore.getLatestRevision(desc.filepath, this.lang, this.gameVersion);
        if (latest && arrayEquals(latest.translations, translations)) return;
      } catch (_) {
      }

      try {
        await window.OfflineStore.addRevision(rev, this.gameVersion);
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
    editorHaveChanges() {
      let original = (this.editorOriginalTranslations || []).map(v => v ?? "");
      let current = (this.editorBlocks || []).map(b => b?.translation ?? "");
      return !arrayEquals(original, current);
    },
    editorExit() {
      if (this.editorHaveChanges() && !confirm('Are you sure you want to exit without saving?')) return;
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
        hideSourceInPreviewPanel: this.hideSourceInPreviewPanel,
        highlightDict: this.highlightDict,
        shiftEnterSave: this.shiftEnterSave,
        autoOpenNextFile: this.autoOpenNextFile,
        filterShortcutCtrlD: this.filterShortcutCtrlD,
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
        hideSourceInPreviewPanel: this.hideSourceInPreviewPanel,
        highlightDict: this.highlightDict,
        shiftEnterSave: this.shiftEnterSave,
        autoOpenNextFile: this.autoOpenNextFile,
        filterShortcutCtrlD: this.filterShortcutCtrlD,
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
      if (typeof settings.hideSourceInPreviewPanel !== 'undefined') this.hideSourceInPreviewPanel = !!settings.hideSourceInPreviewPanel;
      if (typeof settings.highlightDict !== 'undefined') this.highlightDict = !!settings.highlightDict;
      if (typeof settings.shiftEnterSave !== 'undefined') this.shiftEnterSave = !!settings.shiftEnterSave;
      if (typeof settings.autoOpenNextFile !== 'undefined') this.autoOpenNextFile = !!settings.autoOpenNextFile;
      if (typeof settings.filterShortcutCtrlD !== 'undefined') this.filterShortcutCtrlD = !!settings.filterShortcutCtrlD;
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
          await window.OfflineStore.setWorkspace(plain, this.gameVersion);
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
      if (editorBlock.isTable) {
        this.rebuildEditorTableColumnsFromStrings(editorBlock);
      } else if (typeof editorIndex === "number") {
        this.normalizeMultilineEditorBlock(editorBlock, editorIndex);
      }
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
      if (editorBlock.isTable) this.rebuildEditorTableColumnsFromStrings(editorBlock);
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
    },
    
    // Multi-instance detection methods
    checkMultipleInstances() {
      // Use localStorage with heartbeat pattern to detect multiple instances
      const storageKey = 'sdeditor_instance_heartbeat';
      const currentTime = Date.now();
      const heartbeatInterval = 1000; // 1 second
      const timeoutThreshold = 5000; // 5 seconds - if no update, consider instance dead
      
      try {
        // Check if we can use BroadcastChannel (better option)
        if (typeof BroadcastChannel !== 'undefined') {
          try {
            const channel = new BroadcastChannel('sdeditor-instances');
            channel.onmessage = (event) => {
              if (event.data.type === 'instance_check' && event.data.id !== this.instanceTabId) {
                // Another instance detected
                if (!this.showMultiInstanceGate && !this.multiInstanceBypass) {
                  this.showMultiInstanceGate = true;
                }
              }
            };
            // Announce this instance
            channel.postMessage({ type: 'instance_check', id: this.instanceTabId });
            this._broadcastChannel = channel;
            return;
          } catch (e) {
            // BroadcastChannel not available, fall back to localStorage
          }
        }
        
        // Fallback: localStorage heartbeat
        let instances = {};
        try {
          const stored = localStorage.getItem(storageKey);
          if (stored) {
            instances = JSON.parse(stored);
          }
        } catch (_) {
          // localStorage parsing failed
        }
        
        // Clean up dead instances
        for (const id in instances) {
          if (currentTime - instances[id] > timeoutThreshold) {
            delete instances[id];
          }
        }
        
        // Register this instance
        instances[this.instanceTabId] = currentTime;
        
        try {
          localStorage.setItem(storageKey, JSON.stringify(instances));
        } catch (_) {
          // localStorage write failed
        }
        
        // Check if multiple instances exist (more than just this one)
        if (Object.keys(instances).length > 1) {
          if (!this.showMultiInstanceGate && !this.multiInstanceBypass) {
            this.showMultiInstanceGate = true;
          }
        }
      } catch (e) {
        // If all detection fails, silently continue
      }
    },
    
    startMultiInstanceCheck() {
      // Start periodic checks for multiple instances
      if (this.multiInstanceCheckTimer) {
        clearInterval(this.multiInstanceCheckTimer);
      }
      
      this.multiInstanceCheckTimer = setInterval(() => {
        if (!this.multiInstanceBypass) {
          this.checkMultipleInstances();
        }
      }, 2000); // Check every 2 seconds
    },
    
    bypassMultiInstanceGate() {
      // User chose to continue anyway
      this.multiInstanceBypass = true;
      this.showMultiInstanceGate = false;
    },
    
    closeAllButThis() {
      // Provide user guidance - we can't close other tabs directly for security reasons
      const message = 'Since browsers prevent programmatic closing of other tabs for security reasons, ' +
        'you will need to manually close other instances of SDEditor in your browser tabs/windows. ' +
        'After closing them, this message will disappear automatically.\n\n' +
        'To proceed with this instance, click "Continue Anyway" below.';
      alert(message);
    },
    
    closeThisInstance() {
      // Close this instance
      window.close();
    },
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

app.component('app-tooltip', AppTooltip);

app.directive('tooltip', {
  mounted(el, binding) {
    el.__sdTooltipValue = binding.value;
    const show = (e) => binding.instance?.showTooltip?.(e, el.__sdTooltipValue);
    const hide = () => binding.instance?.hideTooltip?.();
    el.__sdTooltipHandlers = { show, hide };
    el.addEventListener('mouseenter', show);
    el.addEventListener('mousemove', show);
    el.addEventListener('mouseleave', hide);
    el.addEventListener('blur', hide);
    el.removeAttribute('title');
  },
  updated(el, binding) {
    el.__sdTooltipValue = binding.value;
    el.removeAttribute('title');
  },
  unmounted(el) {
    const handlers = el.__sdTooltipHandlers;
    if (!handlers) return;
    el.removeEventListener('mouseenter', handlers.show);
    el.removeEventListener('mousemove', handlers.show);
    el.removeEventListener('mouseleave', handlers.hide);
    el.removeEventListener('blur', handlers.hide);
    delete el.__sdTooltipHandlers;
    delete el.__sdTooltipValue;
  }
});

app.mount('#app');
