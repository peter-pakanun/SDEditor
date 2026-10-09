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
const FILE_SEARCH_DELAY = 250;
const DIAGNOSTIC_SCAN_TYPES = [
  { key: 'whitespace', label: 'Whitespace', description: 'Leading, trailing, and repeated spaces.' },
  { key: 'dash', label: 'Dash spacing', description: 'Dashes at line boundaries or next to spaces.' },
  { key: 'tagSyntax', label: 'Tag syntax', description: 'Missing, extra, nested, or malformed tags.' },
  { key: 'variables', label: 'Variable tags', description: 'Variable identities, counts, and percentage suffixes.' },
  { key: 'keywords', label: 'Keyword popup tags', description: 'Keyword identities and counts compared with English.' },
  { key: 'decorations', label: 'Text decoration tags', description: 'Decoration names and counts compared with English.' },
  { key: 'consistency', label: 'Inconsistent translations', description: 'Different translations of identical complete English entries.' },
  { key: 'terminology', label: 'Dictionary terminology', description: 'Terms that do not use an approved dictionary translation.' },
];
const defaultDiagnosticScanChecks = () => Object.fromEntries(
  DIAGNOSTIC_SCAN_TYPES.map(type => [type.key, type.key !== 'terminology'])
);
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
  Polish: "pl",
  Turkish: "tr",
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
  Polish: '"Friz Quadrata ITC", "Friz Quadrata", "Fontin Smallcaps", "Fontin", Georgia, serif',
  Turkish: '"Friz Quadrata ITC", "Friz Quadrata", "Fontin Smallcaps", "Fontin", Georgia, serif',
};

const AppTooltip = {
  props: {
    state: {
      type: Object,
      required: true
    }
  },
  data() {
    return { width: 0, height: 0, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight };
  },
  computed: {
    lines() {
      return String(this.state?.text || "").split(/\r?\n/);
    },
    tooltipStyle() {
      const maxWidth = Math.min(this.state?.maxWidth || 360, Math.max(1, this.viewportWidth - 16));
      const width = Math.min(this.width || maxWidth, maxWidth);
      const height = this.height;
      const preferredX = this.state?.x || 0;
      let preferredY = this.state?.y || 0;
      if (preferredY + height > this.viewportHeight - 8) preferredY -= 18 + height + 12;
      return {
        left: `${Math.max(8, Math.min(preferredX, this.viewportWidth - width - 8))}px`,
        top: `${Math.max(8, Math.min(preferredY, this.viewportHeight - height - 8))}px`,
        maxWidth: `${maxWidth}px`
      };
    }
  },
  methods: {
    measureTooltip() {
      const rect = this.$refs.tooltip?.getBoundingClientRect();
      if (!rect) return;
      this.width = rect.width;
      this.height = rect.height;
    },
    observeTooltip() {
      const element = this.$refs.tooltip;
      if (element === this._tooltipElement) return;
      this._tooltipObserver.disconnect();
      this._tooltipElement = element;
      if (element) {
        this._tooltipObserver.observe(element);
        this.measureTooltip();
      }
    }
  },
  mounted() {
    this._tooltipObserver = new ResizeObserver(() => this.measureTooltip());
    this._tooltipResize = () => {
      this.viewportWidth = window.innerWidth;
      this.viewportHeight = window.innerHeight;
    };
    window.addEventListener('resize', this._tooltipResize);
    this.observeTooltip();
  },
  updated() {
    // Measure content/size changes, not every pointer movement.
    this.observeTooltip();
  },
  beforeUnmount() {
    this._tooltipObserver.disconnect();
    window.removeEventListener('resize', this._tooltipResize);
  },
  template: `
    <div v-if="state.visible && state.text" ref="tooltip" class="appTooltip" :style="tooltipStyle" role="tooltip">
      <div v-for="(line, i) in lines" :key="i">{{ line || ' ' }}</div>
    </div>
  `
};

function escapeTooltipAttr(value) {
  return escapeHtml(String(value ?? "")).replace(/\r\n|\r|\n/g, "&#10;");
}

function formatPageRange(total, page, pageSize) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.max(1, Math.min(page, pageCount));
  const start = total ? (current - 1) * pageSize + 1 : 0;
  const end = Math.min(current * pageSize, total);
  const [first, last, count] = [start, end, total].map(value => value.toLocaleString('en-US'));
  return `${first}–${last} of ${count}`;
}

const config = Vue.defineComponent({
  mixins: [window.WorkspaceInitialization?.mixin || {}, window.CloudUI.mixin, window.CloudHistoryUI?.mixin || {}, window.CollaborationUI?.mixin || {}, window.CollaborationIntegration?.mixin || {}, window.CommentsUI?.mixin || {}, window.EditorLookup?.mixin || {}, window.InlineEditor?.mixin || {}, window.ManagedVersions?.mixin || {}, window.DictionaryWorkerUI?.mixin || {}],
  data() {
    return {
      offlineStoreReady: false,
      startupReady: false,
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
        "Polish",
        "Portuguese",
        "Russian",
        "Simplified Chinese",
        "Spanish",
        "Thai",
        "Traditional Chinese",
        "Turkish",
      ],
      lang: "",
      theme: document.documentElement?.getAttribute('data-theme') || 'light',
      showSetting: false,
      settingsTab: 'general',
      settingsGameVersion: '',
      settingsTabs: [
        { id: 'general', label: 'General' },
        { id: 'editor', label: 'Editor & shortcuts' },
        { id: 'cloud', label: 'Cloud backup' },
        { id: 'data', label: 'Data' },
        { id: 'logs', label: 'Logs' },
      ],
      settingsSaving: false,
      settingsMessage: '',
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
        isRevised: 0,
        isMissing: 0,
        isDropped: 0
      },
      currentSort: "english",
      currentSortDir: 'asc',
      currentSortIcon: '▲',
      pageSize: 20,
      currentPage: 1,
      searchText: "",
      selectedFileFilters: ['missing', 'saved', 'revised', 'dropped', 'diagnosticError', 'diagnosticWarning', 'localDraft'],
      fileFiltersVisible: false,
      selectedFilepath: '',
      diagnosticScanResults: {},
      diagnosticScanAppliedChecks: null,
      diagnosticScanTypes: DIAGNOSTIC_SCAN_TYPES,
      diagnosticScanChecks: defaultDiagnosticScanChecks(),
      diagnosticScanRunning: false,
      diagnosticScanCompleted: false,
      diagnosticScanProcessed: 0,
      diagnosticScanTotal: 0,
      diagnosticScanErrorFileCount: 0,
      diagnosticScanWarningFileCount: 0,
      diagnosticScanRunId: 0,
      diagnosticScanError: '',
      diagnosticScanStopped: false,
      diagnosticScanPhase: '',
      diagnosticScanResultsPage: 1,
      diagnosticScanResultsPageSize: 20,
      consistencyResolver: null,
      consistencyResolverBusy: false,
      consistencyResolverError: '',
      consistencyOtherVersion: 0,
      consistencyShowWhitespace: false,
      consistencyResolutionNotice: '',
      hideDNT: true,
      hideSourceInPreviewPanel: false,
      highlightDict: true,
      shiftEnterSave: false,
      autoOpenNextFile: true,
      filterShortcutCtrlD: false,
      autocompleteShortcut: 'ctrl-space',
      uiDensity: 'compact',

      sideTab: 'dictionary',
      dictionaryFilter: '',
      dictionaryPage: 1,
      dictionaryPageSize: 40,
      dictionaryEditOrder: [],
      dictionaryEditingId: '',
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
      historyIncludeLegacy: false,

      editorVisible: false,
      editorLoading: false,
      editorLoadError: '',
      rawFilePreview: null,
      rawFileMode: 'original',
      editorDictionaryRevision: 0,
      editorDictionaryMatchPack: null,
      editorCurrentEditingDesc: null,
      editorFilePathCopied: false,
      editorFocusedIndex: 0,
      editorFocusedColumnIndex: 0,
      editorOriginalTranslations: [],
      editorDroppedCandidate: null,
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
        noteX: 0,
        noteY: 0,
        noteWidth: 280,
        noteMaxHeight: 240,
        selectedTranslationText: ""
      },
      tooltip: {
        visible: false,
        text: "",
        x: 0,
        y: 0,
        maxWidth: 360
      },
      browserWorkItems: {},
      storageMigrationMessage: '',
      storageMigrationBusy: false,
      pendingSettingsSaves: 0,
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
    const initialization = !this.testMode ? this.beginWorkspaceInitialization?.({ label: 'Starting workspace' }) : null;
    const prepare = (label, callback) => this.runWorkspaceInitializationTask?.(label, callback, initialization) ?? callback();
    try {
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
        await this.finishStartup(true);
        this.appAlert('This app requires IndexedDB for offline storage, but your browser does not support it.');
        return;
      }

      this.loadingProgress = 0;

      this._storageMigrationUnsubscribe = window.OfflineStore.onMigration?.(event => this.storageMigrationChanged(event));
      try {
        await prepare('Opening browser storage and checking legacy data', () => window.OfflineStore.migrateFromLocalStorageIfNeeded());
      } catch (error) {
        this.cloudStorageError = 'Could not load existing browser storage. Reload to retry: ' + error.message;
        return;
      }

      let settings;
      try {
        settings = await prepare('Restoring local settings', () => window.OfflineStore.getSettings());
      } catch (error) {
        this.cloudStorageError = 'Could not load existing settings. Reload to retry: ' + error.message;
        return;
      }
      // The startup cache is only a first-paint hint; local settings remain authoritative.
      if (settings) this.importSettings(settings);
      else this.theme = 'light';


      this.needsInitialSettings = !this.lang;
      offlineStoreReady = true;
      this.offlineStoreReady = true;
      this.ensureDictionaryIds();
      document.addEventListener('keydown', this.handleKeydown);

      try { await prepare('Restoring account and Dictionary', () => this.initializeCloud(settings)); }
      catch (error) {
        offlineStoreReady = false;
        this.offlineStoreReady = false;
        this.cloudStorageError = 'Could not initialize local backup storage. Reload to retry: ' + error.message;
        return;
      }
      await prepare('Saving restored settings', () => this.saveSettings());
      this.updateDocumentTitle();
    } finally {
      this.finishWorkspaceInitialization?.(initialization);
      // Storage errors and test mode must also reveal their rendered UI.
      await this.finishStartup(true);
    }
  },
  beforeUnmount() {
    this._dictionaryAssistanceDisposed = true;
    this.stopStorageMigrationNotice();
    clearTimeout(this._fileSearchTimer);
    this.resetEditorFilePathCopy();
    this._fileSearchTimer = null;
    this._fileSearchSnapshot = null;
    this._settingsSaveDisposed = true;
    clearTimeout(this._settingsSaveTimer);
    window.removeEventListener('beforeunload', this._settingsSaveBeforeUnload);
    this._editorDictionaryRefreshRun = (this._editorDictionaryRefreshRun || 0) + 1;
    this.cancelDictionaryMatchRequests();
    clearTimeout(this._hlterRefreshTimer);
    for (const task of this._browserWorkPending?.values() || []) clearTimeout(task.timer);
    this._browserWorkPending?.clear();
    document.removeEventListener?.('keydown', this.handleKeydown);
    if (this.multiInstanceCheckTimer != null) clearInterval(this.multiInstanceCheckTimer);
    this.multiInstanceCheckTimer = null;
    this._broadcastChannel?.close();
    this._broadcastChannel = null;
    this._instancePeers?.clear();
  },
  watch: {
    settingsDialogVisible(visible) {
      if (visible) {
        this._settingsReturnFocus = document.activeElement;
        this._settingsBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        this.settingsMessage = '';
        this.settingsGameVersion = this.gameVersion;
        if (this.needsInitialSettings) this.settingsTab = 'general';
        this.$nextTick(() => {
          if (!this.settingsDialogVisible) return;
          if (this._settingsFocusControl) this.$refs[this._settingsFocusControl]?.focus();
          else if (this.needsInitialSettings && !this.lang) this.$refs.settingsLanguage?.focus();
          else this.$refs.settingsDialog?.querySelector('[role="tab"][aria-selected="true"]')?.focus();
          this._settingsFocusControl = '';
        });
      } else {
        document.body.style.overflow = this._settingsBodyOverflow || '';
        this.$nextTick(() => {
          if (this._settingsReturnFocus?.isConnected) this._settingsReturnFocus.focus();
          else this.$refs.settingsButton?.focus();
          this._settingsReturnFocus = null;
        });
      }
    },
    hideDNT() {
      this.saveSettings();
      this.clearDiagnosticScanResults();
      if (this.sourceLoaded) this.filterDesc();
    },
    highlightDict() {
      this.saveSettings();
      this.scheduleEditorHLterRefresh();
    },
    hlPopupSelectedItem() {
      this.$nextTick(() => {
        if (this.hlPopup.visible) this.positionHlPopup(this.hlPopup.editorIndex, this.hlPopup.columnIndex);
        this.$nextTick(() => this.syncHlPopupEnglishHighlight());
      });
    },
    hlPopupTlnote() {
      if (this.hlPopup.visible) this.$nextTick(() => {
        this.positionHlPopup(this.hlPopup.editorIndex, this.hlPopup.columnIndex);
        this.$nextTick(() => this.scrollHlPopupSelectionIntoView());
      });
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
    autocompleteShortcut() {
      this.saveSettings();
    },
    lang(language, previous) {
      window.WorkspaceState.scopeWorkspace(this.localDescs, previous);
      this.endDictionaryEdit();
      if (!this._cloudApplying) this._cloudLanguageSwitch = Promise.resolve(this.cloudSelectLanguage(language, previous));
      this.clearDiagnosticScanResults();
      if (this.sourceLoaded) {
        this.applyWorkspaceOverlay();
        this.filterDesc();
      }
      if (this.sideTab === 'history') this.refreshHistory();
    },
    gameVersion() {
      this.endDictionaryEdit();
      this.invalidateEditorDictionaryIndex();
      this.closeHlPopup();
      this.scheduleEditorHLterRefresh();
    },
    sideTab() {
      if (this.sideTab !== 'dictionary') this.endDictionaryEdit();
      if (this.sideTab === 'history') this.refreshHistory();
    },
    editorVisible(visible) {
      if (!visible) {
        this.resetEditorFilePathCopy();
        this.endDictionaryEdit();
        this.closeRawFileDialog();
      }
    },
    editorSessionActive(active) {
      if (active) return;
      this.cancelDictionaryMatchRequests();
      this._editorDictionaryRefreshRun = (this._editorDictionaryRefreshRun || 0) + 1;
      clearTimeout(this._hlterRefreshTimer);
      this._hlterRefreshTimer = null;
    },
    rawFileScope(scope) {
      this.resetEditorFilePathCopy();
      if (this.rawFilePreview && scope !== this._rawFileScope) this.closeRawFileDialog();
    },
    theme(newTheme) {
      // Legacy settings can differ from the active local profile during startup.
      if (this.startupReady) this.applyTheme(newTheme);
      this.saveSettings();
    },
    selectedFileFilters: {
      deep: true,
      handler() {
        if (this.inlineActive && !this.inlineTransitionBusy) {
          this.finishInlineSession({ promote: true }).then(ok => { if (ok) { this.currentPage = 1; this.filterDesc(); } });
          return;
        }
        this.currentPage = 1;
        this.filterDesc();
      }
    },
    descsDisplay() {
      this.syncFileSelection();
    },
    diagnosticScanResultPageCount(count) {
      this.diagnosticScanResultsPage = Math.max(1, Math.min(this.diagnosticScanResultsPage, count));
    },
    editorClipboard() {
      this.saveSettings();
    },
    dictionary: {
      // Field and membership actions journal changes explicitly. A deep watch
      // traverses every Dictionary row on each keystroke in a large dictionary.
      handler() {
        this.invalidateEditorDictionaryIndex(null, { observed: true });
        this.scheduleSettingsSave();
        this.scheduleDictionaryDiagnosticScan();
      }
    },
    dictionaryFilter() { this.dictionaryPage = 1; },
    hideSourceInPreviewPanel() { this.saveSettings(); },
    uiDensity() { this.saveSettings(); },
    editorRegexes: { deep: true, handler() { this.saveSettings(); } },
    gamePreviewFonts: { deep: true, handler() { this.saveSettings(); } },
  },
  computed: {
    editorSessionActive() { return this.editorVisible || !!this.inlineActive; },
    rawFileText() {
      return this.rawFilePreview?.[this.rawFileMode] || '';
    },
    rawFileScope() {
      return JSON.stringify([this.cloudProfileId || this.cloudUser?.id || 'guest', this.gameVersion,
        this.branchId || 'default', this.sourceIdentity, this.lang, this.editorCurrentEditingDesc?.filepath]);
    },
    editorDroppedConflict() {
      return this.localDescs?.droppedConflicts?.[this.lang]?.[this.editorCurrentEditingDesc?.filepath] || null;
    },
    editorDroppedSourceDiff() {
      const candidate = this.editorDroppedCandidate;
      if (!candidate || candidate.originSourceAvailable === false) return '';
      return this.renderInlineDiffHtml((candidate.snapshot.english || []).map(this.decodeEscapedNewlines).join('\n'),
        (this.editorCurrentEditingDesc?.translations?.English || []).map(this.decodeEscapedNewlines).join('\n'));
    },
    editorDroppedTranslationDiff() {
      const candidate = this.editorDroppedCandidate;
      if (!candidate) return '';
      return this.renderInlineDiffHtml((candidate.snapshot.translations || []).map(this.decodeEscapedNewlines).join('\n'),
        (this.editorCurrentEditingDesc?.translations?.[this.lang] || []).map(this.decodeEscapedNewlines).join('\n'));
    },
    editorDroppedCanPromote() {
      const candidate = this.editorDroppedCandidate;
      const desc = this.editorCurrentEditingDesc;
      return !!candidate && candidate.snapshot.translations?.length === desc?.translations?.English?.length
        && !this.editorDroppedConflict && !!this.editorReady && !this.editorSaving && !this.editorHaveChanges();
    },
    browserWorkTooltip() {
      const labels = Object.values(this.browserWorkItems);
      if (this.editorLoading) labels.push('Preparing translation fields and Dictionary matches');
      if (this.diagnosticScanRunning) labels.push('Checking translation diagnostics');
      return labels.length ? 'Work in progress\n' + [...new Set(labels)].join('\n') : '';
    },
    settingsDialogVisible() {
      return this.gameVersionSelected && (this.showSetting || this.needsInitialSettings)
        && !this.showMultiInstanceGate && !this.pendingSingleVersionMigration && !this.duplicateLangImportWarning;
    },
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
    lookupReferenceBcp47() {
      return SETTINGS_LANG_TO_BCP47[this.lookupActiveLanguage] || undefined;
    },
    editorTranslationReadOnly() {
      return this.editorLoading || !!this.editorLoadError || (this.editorCompareActive && this.editorCompareMode === 'translation');
    },
    editorReady() {
      return !this.editorLoading && !this.editorLoadError;
    },
    terminologyDictionary() {
      return window.TerminologyDiagnostics.compileDictionary(this.getActiveDictionaryEntries());
    },
    dictionaryScopeView() {
      const source = this.dictionary || [];
      // Journaled Dictionary mutations advance this revision for in-place edits.
      // Read-only indexing and ordering must not subscribe to every field of
      // every reactive entry; only the visible page is resolved to live proxies.
      const revision = this.editorDictionaryRevision;
      const entries = Vue.toRaw ? Vue.toRaw(source) : source;
      const active = window.DictionaryScope.activeEntries(entries, this.gameVersion);
      const positions = new Map();
      const entryPositions = new WeakMap();
      const keywords = new Map();
      for (const entry of active) {
        const key = window.DictionaryScope.findKey(entry);
        if (!keywords.has(key)) keywords.set(key, []);
        keywords.get(key).push(entry);
      }
      entries.forEach((entry, index) => {
        const id = String(entry?._id);
        if (!positions.has(id)) positions.set(id, index);
        if (entry && typeof entry === 'object') entryPositions.set(entry, index);
      });
      return { source, revision, entries, active, positions, entryPositions, keywords,
        activeIds: new Set(active.map(entry => String(entry?._id || ''))) };
    },
    activeDictionaryIds() {
      return this.dictionaryScopeView.activeIds;
    },
    editorConsistencyDiagnostics() {
      return (this.editorBlocks || []).map((block, blockIndex) =>
        this.getEditorDiagnosticScanResult(block, blockIndex)?.consistencyDiagnostics
          .find(diagnostic => diagnostic.blockIndex === blockIndex) || null
      );
    },
    hasDiagnosticScanSelection() {
      return this.diagnosticScanTypes.some(type => this.diagnosticScanChecks[type.key]);
    },
    diagnosticScanDescs() {
      return (Array.isArray(this.descs) ? this.descs : [])
        .filter(desc => !(this.hideDNT && desc.isDNT));
    },
    diagnosticScanPercent() {
      if (!this.diagnosticScanTotal) return this.diagnosticScanCompleted ? 100 : 0;
      return Math.round(this.diagnosticScanProcessed / this.diagnosticScanTotal * 100);
    },
    diagnosticScanResultFiles() {
      return Object.entries(this.diagnosticScanResults)
        .filter(([, result]) => result.hasDiagnosticError || result.hasDiagnosticWarning)
        .map(([filepath, result]) => ({ filepath, result }))
        .sort((a, b) => Number(b.result.hasDiagnosticError) - Number(a.result.hasDiagnosticError)
          || a.filepath.localeCompare(b.filepath));
    },
    diagnosticScanResultPageCount() {
      return Math.max(1, Math.ceil(this.diagnosticScanResultFiles.length / this.diagnosticScanResultsPageSize));
    },
    diagnosticScanResultRangeLabel() {
      return formatPageRange(this.diagnosticScanResultFiles.length, this.diagnosticScanResultsPage, this.diagnosticScanResultsPageSize);
    },
    diagnosticScanVisibleResults() {
      const page = Math.min(this.diagnosticScanResultsPage, this.diagnosticScanResultPageCount);
      const start = (page - 1) * this.diagnosticScanResultsPageSize;
      return this.diagnosticScanResultFiles.slice(start, start + this.diagnosticScanResultsPageSize);
    },
    diagnosticScanIssueCounts() {
      return Object.values(this.diagnosticScanResults).reduce((counts, result) => ({
        errors: counts.errors + Number(result.errorCount || 0),
        warnings: counts.warnings + Number(result.warningCount || 0),
      }), { errors: 0, warnings: 0 });
    },
    consistencyCurrentChoice() {
      return this.consistencyResolver ? this.buildConsistencyChoice(this.consistencyResolver.currentTranslation) : null;
    },
    consistencyAlternatives() {
      const resolver = this.consistencyResolver;
      return (resolver?.versions || []).filter(version => version.text !== resolver.currentTranslation);
    },
    consistencyOtherChoice() {
      const version = this.consistencyAlternatives.find(item => item.id === this.consistencyOtherVersion);
      return version ? this.buildConsistencyChoice(version.text) : null;
    },
    consistencyDiffHtml() {
      if (!this.consistencyCurrentChoice || !this.consistencyOtherChoice) return '';
      return this.renderInlineDiffHtml(this.consistencyCurrentChoice.text, this.consistencyOtherChoice.text, {
        characters: true, showWhitespace: this.consistencyShowWhitespace,
      });
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
    fileFilterOptions() {
      return [
        { key: 'missing', label: 'Missing translation', tone: 'missing' },
        { key: 'saved', label: 'Saved changes', tone: 'saved' },
        { key: 'revised', label: 'Revised translations', tone: 'revised' },
        { key: 'dropped', label: 'Dropped translations', tone: 'dropped' },
        { key: 'diagnosticError', label: 'Diagnostic errors', tone: 'error' },
        { key: 'diagnosticWarning', label: 'Diagnostic warnings', tone: 'warning' },
        { key: 'localDraft', label: 'Local drafts', tone: '' },
        { key: 'unchanged', label: 'Unchanged', tone: '' },
      ];
    },
    allFileFiltersSelected() {
      return this.fileFilterOptions.every(option => this.selectedFileFilters.includes(option.key));
    },
    fileRangeLabel() {
      return formatPageRange(this.filteredDescs.length, this.currentPage, this.pageSize);
    },
    pageCount() {
      return Math.max(1, Math.ceil(this.filteredDescs.length / this.pageSize));
    },
    descsDisplay() {
      if (this.inlineActive && this._inlineHeldRows) return this._inlineHeldRows;
      const key = this.currentSort;
      const modifier = this.currentSortDir === 'desc' ? -1 : 1;
      this.currentSortIcon = modifier === 1 ? '▲' : '▼';
      const descsToDisplay = this.filteredDescs.slice().sort((a, b) => {
        if (a[key] < b[key]) return -modifier;
        if (a[key] > b[key]) return modifier;
        return 0;
      });
      const start = (this.currentPage - 1) * this.pageSize;
      return descsToDisplay.slice(start, start + this.pageSize);
    },
    hlPopupSelectedItem() {
      return this.hlPopup.visible ? this.hlPopup.filtered[this.hlPopup.selectedIndex] || null : null;
    },
    hlPopupTlnote() {
      const dictId = this.hlPopupSelectedItem?.dictEntryId;
      if (!dictId) return '';
      const entry = this.getDictionaryAssistanceEntry(dictId, true);
      return String(entry?.tlnote ?? '').trim();
    },
    foundDictionarySet() {
      if (!this.editorSessionActive || !this.getEditorDictionaryMatchPack()) return new Set();
      let set = new Set();
      for (const editorBlock of this.editorBlocks || []) {
        const highlights = editorBlock?.isTable
          ? (editorBlock.tableColumns || []).flatMap(column => column.HLs || []) : editorBlock?.HLs || [];
        for (const hl of highlights) {
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
      if (!this.editorSessionActive || !this.getEditorDictionaryMatchPack()) return new Map();
      let map = new Map();
      for (const editorBlock of this.editorBlocks || []) {
        const highlights = editorBlock?.isTable
          ? (editorBlock.tableColumns || []).flatMap(column => column.HLs || []) : editorBlock?.HLs || [];
        for (const hl of highlights) {
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
    orderedDictionary() {
      const dictionary = this.dictionaryScopeView.entries;
      // Resolve the captured order against live entries so cloud replacements
      // still update the fields without moving the row being edited.
      if (this.dictionaryEditOrder.length) {
        const entries = new Map(dictionary.map(entry => [String(entry?._id), entry]));
        const ordered = [];
        const heldOrder = Vue.toRaw ? Vue.toRaw(this.dictionaryEditOrder) : this.dictionaryEditOrder;
        for (const id of heldOrder) {
          if (!entries.has(id)) continue;
          ordered.push(entries.get(id));
          entries.delete(id);
        }
        return ordered.concat(Array.from(entries.values()));
      }
      const foundSet = this.foundDictionarySet;
      if (!foundSet || foundSet.size <= 0) return dictionary;
      const found = [], rest = [];
      for (const entry of dictionary) (foundSet.has(entry?._id) ? found : rest).push(entry);
      return found.concat(rest);
    },
    filteredDictionary() {
      let dictionary = this.orderedDictionary;
      let f = (this.dictionaryFilter || "").trim().toLowerCase();
      let list;
      if (!f) {
        list = dictionary.slice();
      } else {
        list = dictionary.filter(word => {
        if (this.dictionaryEditingId && String(word?._id) === this.dictionaryEditingId) return true;
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

      return list;
    },
    dictionaryPageCount() {
      return Math.max(1, Math.ceil(this.filteredDictionary.length / this.dictionaryPageSize));
    },
    visibleDictionary() {
      if (!this.editorReady) return [];
      const page = Math.min(this.dictionaryPage, this.dictionaryPageCount);
      return this.filteredDictionary.slice((page - 1) * this.dictionaryPageSize, page * this.dictionaryPageSize)
        .map(entry => this.getLiveDictionaryEntry(entry));
    },
    dictionaryRangeLabel() {
      return formatPageRange(this.filteredDictionary.length, Math.min(this.dictionaryPage, this.dictionaryPageCount), this.dictionaryPageSize);
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
    setBrowserWork(scope, { key, label, active, immediate = false }) {
      this.trackWorkspaceInitializationWork?.(scope, { key, label, active });
      const id = scope + ':' + key;
      const pending = this._browserWorkPending ||= new Map();
      clearTimeout(pending.get(id)?.timer);
      if (!active) {
        pending.delete(id);
        delete this.browserWorkItems[id];
        return;
      }
      const task = { label };
      pending.set(id, task);
      const show = () => {
        if (pending.get(id) === task) this.browserWorkItems[id] = label;
      };
      if (immediate) show();
      else task.timer = setTimeout(show, 80);
    },
    clearBrowserWork(scope) {
      for (const id of this._browserWorkPending?.keys() || []) {
        if (id.startsWith(scope + ':')) this.setBrowserWork(scope, { key: id.slice(scope.length + 1), active: false });
      }
    },
    storageMigrationChanged(event) {
      if (this._storageMigrationDisposed || !event?.id) return;
      const initializationTasks = this._storageMigrationInitializationTasks ||= new Map();
      if (event.state === 'started' && !initializationTasks.has(event.id)) {
        initializationTasks.set(event.id, this.beginWorkspaceInitializationTask?.('Updating existing local work'));
      } else if (['completed', 'failed'].includes(event.state)) {
        this.finishWorkspaceInitializationTask?.(initializationTasks.get(event.id), event.state === 'failed'
          ? { error: event.error || 'Local storage update could not finish' } : {});
        initializationTasks.delete(event.id);
      }
      const active = this._storageMigrations ||= new Set();
      const message = 'Preparing existing local work for faster saves. This is a one-time update for each stored version; loading may be slower until it finishes.';
      if (event.state === 'started') {
        if (active.has(event.id)) return;
        if (!active.size) {
          this._storageMigrationFailed = false;
          this._storageMigrationGeneration = (this._storageMigrationGeneration || 0) + 1;
        }
        active.add(event.id);
        clearTimeout(this._storageMigrationHideTimer);
        if (this.storageMigrationMessage) {
          this.storageMigrationMessage = message;
          this.storageMigrationBusy = true;
          this.setBrowserWork('migration', { key: 'conversion', label: 'Updating existing local work', active: true, immediate: true });
        } else if (!this._storageMigrationShowTimer) {
          const generation = this._storageMigrationGeneration;
          this._storageMigrationShowTimer = setTimeout(() => {
            if (this._storageMigrationDisposed || this._storageMigrationGeneration !== generation || !active.size) return;
            this._storageMigrationShowTimer = null;
            this.storageMigrationMessage = message;
            this.storageMigrationBusy = true;
            this.setBrowserWork('migration', { key: 'conversion', label: 'Updating existing local work', active: true, immediate: true });
            // Initial activation can convert before mounted() reveals the app.
            if (!this.startupReady) void this.finishStartup(true);
          }, 750);
        }
        return;
      }
      if (!['completed', 'failed'].includes(event.state) || !active.delete(event.id)) return;
      if (event.state === 'failed') this._storageMigrationFailed = true;
      if (active.size) return;
      clearTimeout(this._storageMigrationShowTimer);
      this._storageMigrationShowTimer = null;
      this.storageMigrationBusy = false;
      this.clearBrowserWork('migration');
      if (!this.storageMigrationMessage) return;
      if (this._storageMigrationFailed) { this.storageMigrationMessage = ''; return; }
      this.storageMigrationMessage = 'Local storage update complete. This work will skip the update on future loads and use the faster saves.';
      const generation = this._storageMigrationGeneration;
      this._storageMigrationHideTimer = setTimeout(() => {
        if (!this._storageMigrationDisposed && this._storageMigrationGeneration === generation && !active.size) this.storageMigrationMessage = '';
      }, 5000);
    },
    stopStorageMigrationNotice() {
      this._storageMigrationDisposed = true;
      this._storageMigrationUnsubscribe?.();
      this._storageMigrationUnsubscribe = null;
      clearTimeout(this._storageMigrationShowTimer);
      clearTimeout(this._storageMigrationHideTimer);
      this._storageMigrations?.clear();
      this.clearBrowserWork('migration');
    },
    appAlert(message, options) {
      return window.AppDialogs.alert(message, options);
    },
    appConfirm(message, options) {
      return window.AppDialogs.confirm(message, options);
    },
    appPrompt(message, options) {
      return window.AppDialogs.prompt(message, options);
    },
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
      return window.StatDescCodec.detectGameVersionFromFilepaths(filepaths);
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
      this.inlineActive = false;
      this._draftSession = null;
      this._collaboration?.disconnect();
      this._collaboration = null;
      this._collabKey = '';
      this._editorCollabBase = undefined;
      this.sourceIdentity = '';
      this.importBaseline = null;
      this._workspaceSourceBaseline = null;
      this._workspaceBaselineIndex = null;
      this.editorDroppedCandidate = null;
      this.clearDiagnosticScanResults();
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
    showGameVersionSelector() {
      if (this.managedVersionBusy || this.versionStorageLoading || this.pendingSingleVersionMigration) return false;
      this.gameVersionSelected = false;
      this.updateDocumentTitle();
      return true;
    },
    async activateGameVersion(version, { checkMigration = true } = {}) {
      const selection = this._gameSelectionGeneration = (this._gameSelectionGeneration || 0) + 1;
      const owner = this.cloudProfileId || 'guest';
      const current = () => selection === this._gameSelectionGeneration && owner === (this.cloudProfileId || 'guest');
      if (this.flushEditorDraft && !await this.flushEditorDraft()) return;
      if (!current()) return;
      if (this._importReconciliationDone) await this._importReconciliationDone;
      if (!current()) return;
      if (this._pendingSaves?.snapshot().jobs.length && !await this.waitForPendingSaves()) return;
      if (!current()) return;
      const v = this.normalizeGameVersion(version);
      this.gameVersion = v;
      this.gameVersionSelected = true;
      window.OfflineStore?.setGameVersion?.(v);
      if (this.managedWorkspaceScope) window.OfflineStore?.setWorkspaceContext?.(this.managedWorkspaceScope(''));
      this.updateDocumentTitle();

      if (this.testMode) {
        this.resetVersionedState();
        this.loadDummyData();
        return;
      }

      this.ensureDictionaryWorker();

      const catalogOnly = !!window.ManagedVersions;
      if (catalogOnly) {
        // Choosing a game needs catalog metadata, not the active translation files.
        this._versionLoadGeneration = (this._versionLoadGeneration || 0) + 1;
        this.versionStorageLoading = false;
        this.clearBrowserWork?.('workspace');
        this.versionChooserVisible = true;
        this.resetVersionedState();
      }

      if (checkMigration) {
        await this.prepareSingleVersionMigration();
        if (!current() || this.gameVersion !== v) return;
        if (this.pendingSingleVersionMigration) return;
      }

      if (!current() || this.gameVersion !== v) return;
      if (catalogOnly) Promise.resolve(this.managedScopeChanged({ deferWorkspace: true })).catch(error => {
        if (current() && this.gameVersion === v) this.managedSetOperationError?.('catalog', error);
      });
      else await this.loadVersionedStorage();
    },
    async prepareSingleVersionMigration() {
      const selection = this._gameSelectionGeneration;
      const versionLoad = this._versionLoadGeneration;
      const scope = JSON.stringify([this.gameVersion, this.cloudProfileId || 'guest', this.branchId || 'default']);
      const current = () => selection === this._gameSelectionGeneration
        && scope === JSON.stringify([this.gameVersion, this.cloudProfileId || 'guest', this.branchId || 'default']);
      this.pendingSingleVersionMigration = null;
      if (!(window.OfflineStore && typeof window.OfflineStore.hasMigratedFromSingleVersion === 'function')) return;

      let migrated = false;
      try {
        migrated = !!(await window.OfflineStore.hasMigratedFromSingleVersion());
      } catch (_) {
      }
      if (!current()) return;
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
      if (!current()) return;
      if (window.ManagedVersions && (!this.versionChooserVisible || this.sourceLoaded
        || this.managedVersionBusy || this._managedActivation || versionLoad !== this._versionLoadGeneration)) return;

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
      const initialization = this.beginWorkspaceInitialization?.({ label: 'Restoring the earlier workspace' });
      const preparation = this.beginWorkspaceInitializationTask?.('Migrating legacy source, translations and history', initialization);
      try {
        await window.OfflineStore.copyLegacyToVersion(targetVersion);
        this.finishWorkspaceInitializationTask?.(preparation);
      } catch (error) {
        this.finishWorkspaceInitializationTask?.(preparation, { error });
        this.loadingProgress = 0;
        this.migrationInProgress = false;
        this.appAlert('Migration failed. Your old data was left untouched.');
        this.finishWorkspaceInitialization?.(initialization);
        return;
      }

      this.pendingSingleVersionMigration = null;
      this.migrationInProgress = false;
      try {
        if (window.ManagedVersions && !this.testMode) {
          this.versionChooserVisible = true;
          await this.managedScopeChanged({ deferWorkspace: true });
        } else await this.loadVersionedStorage(initialization);
      } finally { this.finishWorkspaceInitialization?.(initialization); }
    },
    async loadVersionedStorage(initializationSession, activatedSnapshot) {
      if (this.flushEditorDraft && !await this.flushEditorDraft()) return;
      if (this._importReconciliationDone) await this._importReconciliationDone;
      if (this._pendingSaves?.snapshot().jobs.length && !await this.waitForPendingSaves()) return;
      if (initializationSession && this.beginWorkspaceInitialization
        && initializationSession.run !== this._workspaceInitializationRun) return;
      const game = this.gameVersion;
      const profile = this.cloudProfileId || 'guest', branch = this.branchId || 'default';
      const generation = this._versionLoadGeneration = (this._versionLoadGeneration || 0) + 1;
      const current = () => generation === this._versionLoadGeneration && game === this.gameVersion
        && profile === (this.cloudProfileId || 'guest') && branch === (this.branchId || 'default');
      const initialization = this.beginWorkspaceInitialization?.({ label: 'Initializing workspace', session: initializationSession,
        force: !initializationSession && !!this._workspaceLoadInitialization });
      this._workspaceLoadInitialization = initialization;
      const prepare = (label, callback) => this.runWorkspaceInitializationTask?.(label, callback, initialization) ?? callback();
      this.versionStorageLoading = true;
      const workKey = 'load-' + generation;
      this.setBrowserWork('workspace', { key: workKey, label: 'Preparing stored translation files', active: true });
      this.resetVersionedState();
      this.loadingProgress = 0.001;
      try {
        this.ensureDictionaryWorker();
        const cached = activatedSnapshot?.scope;
        const reusable = cached && cached.game === game && String(cached.accountId) === String(profile)
          && (cached.branchId || 'default') === branch && activatedSnapshot.language === this.lang
          && cached.sourceHash && activatedSnapshot.workspace?.sourceHash === cached.sourceHash
          && activatedSnapshot.workspace?.stagedVersion >= 1 && activatedSnapshot.workspace?.statusMetadataVersion === 1
          && Array.isArray(activatedSnapshot.source);
        let snapshot;
        if (reusable) snapshot = await prepare('Reusing the activated local source and saved translations', () => activatedSnapshot);
        else if (window.OfflineStore.getWorkspaceSnapshot) snapshot = await prepare('Loading saved translations and the original source baseline', () => window.OfflineStore.getWorkspaceSnapshot(game, this.lang));
        else {
          const [workspace, source] = await Promise.all([
            prepare('Loading saved translations and preserved copies', () => window.OfflineStore.getWorkspace(game, this.lang)),
            prepare('Loading stored source files', () => window.OfflineStore.getSource(game)),
          ]);
          snapshot = { workspace, source };
        }
        const { workspace, source: storedSource } = snapshot;
        if (!current()) return;
        let source = storedSource;
        let importedBaseline = null;
        let sourceHash = '';
        let cloneSource = false;
        if (workspace?.importArchive) {
          importedBaseline = await prepare('Loading and verifying the original baseline', () => Object.hasOwn(snapshot, 'baseline')
            ? snapshot.baseline : window.OfflineStore.getImportedBaseline(workspace.importArchive.baselineId, game));
          if (!current()) return;
          const archive = window.CollaborationProtocol.normalizeArchive(workspace.importArchive);
          if (!importedBaseline || importedBaseline.archive?.baselineId !== archive.baselineId
            || importedBaseline.tree?.root !== archive.treeRoot || importedBaseline.source?.length !== archive.descriptionCount) {
            throw new Error('The imported baseline is unavailable. Reimport the original upstream ZIP; your translations have been preserved.');
          }
          // Normalized activation supplies an independently detached accepted
          // source. Render that view rather than copying the immutable baseline
          // again. Legacy adapters retain the baseline as their authority.
          const scope = snapshot.scope;
          const detachedSource = snapshot.sourceBaselineId === archive.baselineId
            && scope?.sourceHash === archive.baselineId && scope.game === game
            && String(scope.accountId) === String(profile) && (scope.branchId || 'default') === branch
            && Array.isArray(storedSource) && storedSource.length === archive.descriptionCount
            && storedSource !== importedBaseline.source;
          source = detachedSource ? storedSource : importedBaseline.source;
          cloneSource = !detachedSource;
          sourceHash = archive.baselineId;
        } else if (Array.isArray(source) && source.length && window.CollaborationProtocol) {
          try {
            sourceHash = await prepare('Verifying stored source identity', () => window.CollaborationProtocol.sourceHashAsync
              ? window.CollaborationProtocol.sourceHashAsync(source, { isCancelled: () => !current(), yieldTask: () => this.yieldEditorWork() })
              : window.CollaborationProtocol.sourceHash(source));
          }
          catch (error) { if (current()) this.collaborationNotice = 'Source identity could not be verified. Reimport the source ZIP. ' + error.message; }
        }
        if (!current()) return;
        if (workspace?.sourceHash && sourceHash && workspace.sourceHash !== sourceHash) {
          throw new Error('Stored translations and source have different version hashes. Reimport the matching source ZIP; existing browser data has been preserved.');
        }
        this._workspaceSourceBaseline = importedBaseline?.source || this.toPlainForStorage(source);
        this._workspaceBaselineIndex = null;
        window.WorkspaceState.initializeWorkspace(workspace, { source: this._workspaceSourceBaseline,
          sourceHash, game, branchId: branch, language: this.lang });
        let prepared;
        if (Array.isArray(source) && source.length) {
          // Preferences may arrive while preparation yields. Apply the latest
          // language before publishing any descriptions to the workspace.
          let language;
          do {
            language = this.lang;
            prepared = await prepare('Applying translations and calculating file statuses', () => this.prepareStoredWorkspaceSource(prepared || source, workspace, !prepared && cloneSource, current));
            if (!prepared || !current()) return;
          } while (language !== this.lang);
        }
        if (workspace) this.localDescs = workspace;
        this.importBaseline = importedBaseline && Vue.markRaw ? Vue.markRaw(importedBaseline) : importedBaseline;
        this.ensureLocalDescsReady();
        this.sourceIdentity = sourceHash;
        if (sourceHash) this.localDescs.sourceHash = sourceHash;
        if (Array.isArray(source) && source.length) {
          await prepare('Preparing Dictionary matches', () => this.ensureDictionarySnapshot());
          if (!current()) return;
          this.descs = prepared; this.sourceLoaded = true;
          await prepare('Preparing file search and workspace rows', () => this.filterDesc());
          if (!current()) return;
          this.loadingProgress = 100;
        } else this.loadingProgress = 0;
      } catch (error) {
        if (current()) {
          this.loadingProgress = 0;
          if (this.cloudStorageError !== this._dictionaryWorkerStorageError) this.cloudStorageError = 'Could not load this workspace. ' + error.message;
        }
      } finally {
        this.setBrowserWork('workspace', { key: workKey, active: false });
        try {
          if (current()) {
            this.versionStorageLoading = false;
            if (this.sourceLoaded && this.initializeCollaboration) {
              try { await prepare('Preparing cached shared translations and queued work', () => this.initializeCollaboration(initialization)); }
              catch (error) { if (current()) this.collaborationFailure?.(error); }
            }
            if (current()) this.scheduleCollaboration?.();
          }
        } finally {
          if (this._workspaceLoadInitialization === initialization) this._workspaceLoadInitialization = null;
          this.finishWorkspaceInitialization?.(initialization);
        }
      }
    },
    async prepareStoredWorkspaceSource(source, workspace, cloneSource, isCurrent) {
      const prepared = [];
      const language = this.lang;
      let started = Date.now();
      window.WorkspaceState.initializeWorkspace(workspace, { source: this.workspaceSource(),
        sourceHash: workspace?.sourceHash || this.sourceIdentity, game: this.gameVersion, language });
      for (const original of source) {
        if (!isCurrent()) return null;
        // IndexedDB already detached storedSource. Only the immutable imported
        // baseline needs another copy, one description at a time.
        const desc = cloneSource ? this.toPlainForStorage(original) : original;
        if (!desc) throw new Error('Could not prepare the stored source.');
        const state = window.WorkspaceState.workspaceFile(workspace, this.workspaceSourceFile(desc.filepath) || desc, language);
        desc.translations ||= { English: [] };
        desc.isDNT = window.StatDescCodec.computeIsDNT(desc.translations.English);
        desc.translations[language] = [...state.translations];
        desc.hasChanges = state.hasChanges;
        desc.isRevised = state.isRevised;
        desc.isMissing = state.isMissing;
        desc.isDropped = state.isDropped;
        desc.needsReview = state.needsReview;
        prepared.push(desc);
        if (Date.now() - started >= 6) { await this.yieldEditorWork(); started = Date.now(); }
      }
      return isCurrent() ? prepared : null;
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
      if (!this.editorSessionActive) return;
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
    openSettings(tab = 'general', focusControl = '') {
      if ((this.inlineActive || this._inlineFinishing) && this.finishInlineSession) {
        return this.finishInlineSession({ promote: true }).then(done => done && this.openSettings(tab, focusControl));
      }
      this._settingsFocusControl = ['settingsGameVersion', 'settingsLanguage'].includes(focusControl) ? focusControl : '';
      this.setSettingsTab(tab);
      this.settingsMessage = '';
      if (this.settingsDialogVisible && this._settingsFocusControl) {
        this.$nextTick(() => {
          this.$refs[this._settingsFocusControl]?.focus();
          this._settingsFocusControl = '';
        });
      }
      this.showSetting = true;
    },
    setSettingsTab(tab, focusTab = false) {
      if (!this.settingsTabs.some(item => item.id === tab)) return;
      this.settingsTab = tab;
      if (focusTab) this.$nextTick(() => {
        this.$refs.settingsDialog?.querySelector('[role="tab"][aria-selected="true"]')?.focus();
      });
    },
    handleSettingsTabKeydown(event, index) {
      let nextIndex;
      if (event.key === 'ArrowRight') nextIndex = (index + 1) % this.settingsTabs.length;
      else if (event.key === 'ArrowLeft') nextIndex = (index + this.settingsTabs.length - 1) % this.settingsTabs.length;
      else if (event.key === 'Home') nextIndex = 0;
      else if (event.key === 'End') nextIndex = this.settingsTabs.length - 1;
      else return;
      event.preventDefault();
      this.setSettingsTab(this.settingsTabs[nextIndex].id, true);
    },
    settingsTrapFocus(event) {
      const dialog = this.$refs.settingsDialog;
      if (!dialog) return;
      const controls = [...dialog.querySelectorAll('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')]
        .filter(element => element.getClientRects().length && element.tabIndex >= 0);
      if (!controls.length) { event.preventDefault(); dialog.focus(); return; }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
        event.preventDefault(); first.focus();
      }
    },
    async settingsSaveClose() {
      if (this.settingsSaving) return;
      if (!this.lang) {
        this.settingsMessage = 'Choose a translation language before continuing.';
        this.setSettingsTab('general');
        this.$nextTick(() => this.$refs.settingsLanguage?.focus());
        return;
      }
      this.settingsSaving = true;
      this.settingsMessage = '';
      try {
        const languageSwitch = this._cloudLanguageSwitch;
        if (languageSwitch) {
          const switched = await languageSwitch;
          if (this._cloudLanguageSwitch === languageSwitch) this._cloudLanguageSwitch = null;
          if (switched === false) {
            this.settingsMessage = this.cloudStorageError || 'Could not switch language. Please try again.';
            return;
          }
        }
        const nextGame = this.normalizeGameVersion(this.settingsGameVersion || this.gameVersion);
        if (nextGame !== this.gameVersion && (this.editorVisible || this.navigationBusy || this.versionStorageLoading)) {
          this.settingsMessage = 'Close the current editor and finish pending work before changing game version.';
          return;
        }
        if (await this.saveSettings() === false) {
          this.settingsMessage = this.cloudStorageError || 'Could not save preferences. Please try again.';
          return;
        }
        if (nextGame !== this.gameVersion) {
          await this.selectGameVersion(nextGame);
          if (this.gameVersion !== nextGame) {
            this.settingsMessage = this.localSaveError || 'Finish saving your translations before changing game version.';
            return;
          }
        }
        this.needsInitialSettings = false;
        this.showSetting = false;
      } catch (error) {
        this.settingsMessage = 'Could not save preferences: ' + error.message;
      } finally {
        this.settingsSaving = false;
      }
    },
    toggleEditorEnglishDiff() {
      if (!this.editorReady) return;
      this.editorShowEnglishDiff = !this.editorShowEnglishDiff;
      if (this.editorShowEnglishDiff) this.prepareEditorEnglishDiff();
    },
    async confirmTranslationUnchanged() {
      if (!this.editorReady) return;
      const desc = this.editorCurrentEditingDesc;
      if (!desc || this.editorSaving) return;
      const context = this.captureCollaborationContext();
      const blocks = this.editorBlocks;
      const candidate = this.editorDroppedCandidate || window.WorkspaceState.droppedForFile(this.localDescs, desc.filepath, this.lang);
      if (!candidate && !desc.needsReview) return; // Older workspace compatibility.
      const lines = [...(candidate?.snapshot?.translations || desc.translations[this.lang] || [])];
      if (lines.length !== desc.translations.English.length) {
        this.appAlert('The source entry count changed. Review the dropped copy and save a replacement translation.'); return;
      }
      if (candidate && this.editorHaveChanges()) return;
      const savedLines = [...(desc.translations[this.lang] || [])];
      let promotion;
      try { promotion = candidate ? this.capturedDroppedPromotion(desc.filepath, candidate) : null; }
      catch (error) { this.collaborationNotice = error.message; return; }
      const english = JSON.stringify(desc.translations.English);
      const base = this._editorCollabBase;
      this.editorSaving = true;
      try {
        const candidateMatchesDraft = candidate && arrayEquals(blocks.map(block => this.encodeNewlines(block.translation)), lines);
        if (candidateMatchesDraft) this.refreshEditorDiagnostics();
        const candidateErrors = candidate && !candidateMatchesDraft
          ? this.analyzeDescDiagnostics({ ...desc, translations: { ...desc.translations, [this.lang]: lines } },
            this.lang, null, defaultDiagnosticScanChecks()).errorCount : 0;
        if (candidate && (candidateErrors || (candidateMatchesDraft && this.collectEditorDiagnostics('error').length))) {
          this.appAlert('The dropped translation has errors against the current source. Correct them and save a replacement.'); return;
        }
        if (!await this.appConfirm('Use the dropped translation unchanged for the current source version? This stages it for export and sharing.', {
          title: 'Promote dropped translation?', confirmLabel: 'Confirm unchanged',
        })) return;
        if (this.editorCurrentEditingDesc !== desc || this.editorBlocks !== blocks
          || !this.collaborationContextCurrent(context) || this._editorCollabBase !== base
          || JSON.stringify(desc.translations.English) !== english
          || !arrayEquals(savedLines, desc.translations[this.lang] || [])) return;
        if (candidate) this.capturedDroppedPromotion(desc.filepath, candidate);
        const result = await this.persistTranslationBatch([{ desc, lines, needsReview: false }], 'confirm', {
          context, bases: base ? { [desc.filepath]: base } : undefined, promoteDropped: promotion,
        });
        if (result.stale || result.status === 'conflict') return;
        this.editorShowEnglishDiff = false;
        this.editorDroppedCandidate = null;
        this._editorCollabBase = this._collaboration?.fileBase(desc.filepath);
        this.rebaseEditorAfterCommit(this._collaboration?.fileBase(desc.filepath) || this.collaborationFile(desc), {
          draftBefore: blocks.map(block => block.translation), submittedTranslations: lines,
        });
        this.collaborationNotice = 'Dropped translation saved unchanged.';
      } catch (error) { this.collaborationNotice = 'Could not save the dropped translation: ' + error.message; }
      finally { this.editorSaving = false; }
    },
    async prepareEditorEnglishDiff() {
      if (!this.editorVisible) return;
      if (!this.editorCurrentEditingDesc) return;
      const filepath = this.editorCurrentEditingDesc.filepath;
      const candidate = this.editorDroppedCandidate || window.WorkspaceState.droppedForFile(this.localDescs, filepath, this.lang);
      if (!candidate || candidate.originSourceAvailable === false) return;
      const prevEng = candidate?.snapshot?.english || [];
      const curEng = Array.isArray(this.editorCurrentEditingDesc?.translations?.English) ? this.editorCurrentEditingDesc.translations.English : [];

      for (let i = 0; i < (this.editorBlocks || []).length; i++) {
        const b = this.editorBlocks[i];
        const oldRaw = Array.isArray(prevEng) ? (prevEng[i] ?? '') : '';
        const newRaw = curEng[i] ?? '';
        this.applyEditorEnglishDiff(b, oldRaw, newRaw, newRaw);
      }
    },
    renderInlineDiffHtml(oldStr, newStr, options = {}) {
      const diffApi = window.Diff;
      if (!diffApi) return escapeHtml(String(newStr ?? ''));
      let parts;
      try {
        const diff = options.characters && diffApi.diffChars ? diffApi.diffChars : diffApi.diffWordsWithSpace;
        parts = diff(String(oldStr ?? ''), String(newStr ?? ''));
      } catch (_) {
        parts = [{ value: String(newStr ?? '') }];
      }
      return (parts || []).map(p => {
        let value = String(p?.value ?? '');
        if (options.showWhitespace) value = value.replace(/ /g, '·').replace(/\u00a0/g, '⍽').replace(/\t/g, '⇥   ').replace(/\n/g, '↵\n');
        const v = escapeHtml(value);
        if (p?.added) return `<span class="diffInlineAdd">${v}</span>`;
        if (p?.removed) return `<span class="diffInlineDel">${v}</span>`;
        return v;
      }).join('');
    },
    droppedConflictExplanation(conflict) {
      const yours = conflict?.yours, shared = conflict?.shared;
      if (!yours?.snapshot || !shared?.snapshot) return '';
      const sameText = normalize => ['english', 'translations'].every(field => {
        const left = yours.snapshot[field], right = shared.snapshot[field];
        return Array.isArray(left) && Array.isArray(right) && left.length === right.length
          && left.every((text, index) => normalize(text) === normalize(right[index]));
      });
      if (!sameText(text => text)) {
        return sameText(text => String(text).replace(/\s/gu, ''))
          ? 'Spacing or line breaks differ between these copies. Review the exact text before choosing one.' : '';
      }
      if (!window.WorkspaceState.sameDroppedContent(yours, shared)) {
        return 'The text matches, but the preserved entry details differ. Review the copies before choosing one.';
      }
      if ((conflict.kind === 'promotion' || yours.id === shared.id) && (yours.originSourceHash !== shared.originSourceHash
        || (yours.originSourceAvailable !== false) !== (shared.originSourceAvailable !== false))) {
        return 'The text matches, but the original source information differs. Review the copies before choosing one.';
      }
      return '';
    },
    async resolveDroppedTranslationConflict(choice, filepath = this.editorCurrentEditingDesc?.filepath) {
      const desc = this.editorVisible && this.editorCurrentEditingDesc?.filepath === filepath ? this.editorCurrentEditingDesc : null;
      const conflict = this.localDescs?.droppedConflicts?.[this.lang]?.[filepath];
      if (!filepath || !conflict || conflict.targetSourceHash !== this.sourceIdentity || this.editorSaving || this.navigationBusy) return;
      const context = this.captureCollaborationContext(), captured = JSON.stringify(conflict);
      const hadChanges = !!desc && this.editorHaveChanges();
      this.editorSaving = true;
      try {
        const local = choice === 'local';
        if (!await this.appConfirm(local ? 'Replace the shared dropped copy with your preserved copy? This does not stage a translation.'
          : 'Use the shared dropped copy for review? Your other copy remains in local recovery storage.', {
          title: 'Resolve dropped copies', confirmLabel: local ? 'Keep this dropped copy' : 'Use shared dropped copy',
        }) || !this.collaborationContextCurrent(context)) return;
        if (JSON.stringify(this.localDescs?.droppedConflicts?.[context.language]?.[filepath]) !== captured) throw new Error('The competing copies changed. Review them again.');
        if (!context.client?.resolveDroppedConflict) throw new Error('Reconnect to resolve these dropped copies.');
        await context.client.resolveDroppedConflict(filepath, choice, { id: conflict.shared.id, revision: conflict.shared.revision });
        if (!this.collaborationContextCurrent(context)) return;
        if (desc && this.editorCurrentEditingDesc === desc) {
          this.editorDroppedCandidate = this.toPlainForStorage(window.WorkspaceState.droppedForFile(this.localDescs, filepath, this.lang));
          this.editorShowEnglishDiff = false;
        }
        this.applyWorkspaceOverlay(); this.filterDesc();
        if (desc && this.editorVisible && this.editorCurrentEditingDesc === desc && !hadChanges && !this.editorHaveChanges()) await this.openEditorFile(filepath);
      } catch (error) { if (this.collaborationContextCurrent(context)) this.collaborationNotice = 'Could not resolve the dropped copies: ' + error.message; }
      finally { this.editorSaving = false; }
    },
    async discardDroppedTranslation() {
      const desc = this.editorCurrentEditingDesc;
      const candidate = this.editorDroppedCandidate;
      if (!desc || !candidate || this.editorSaving) return;
      const context = this.captureCollaborationContext();
      this.editorSaving = true;
      try {
        const expected = this.capturedDroppedPromotion(desc.filepath, candidate);
        if (!await this.appConfirm('Discard this dropped translation? It will no longer appear for review.', {
          title: 'Discard dropped translation?', confirmLabel: 'Discard', danger: true,
        }) || !this.collaborationContextCurrent(context)) return;
        this.capturedDroppedPromotion(desc.filepath, candidate);
        if (context.client?.discardDropped) await context.client.discardDropped(desc.filepath, expected);
        else {
          const discard = workspace => {
            window.WorkspaceState.discardDropped(workspace, desc.filepath, context.language, expected);
            return workspace;
          };
          const workspace = !this.testMode && window.OfflineStore.updateWorkspace
            ? await window.OfflineStore.updateWorkspace(discard, context.game, { filepaths: [desc.filepath] })
            : discard(this.toPlainForStorage(this.localDescs));
          if (!this.testMode && !window.OfflineStore.updateWorkspace) await window.OfflineStore.saveWorkspaceWithRevisions(workspace, [], context.game);
          if (!this.collaborationContextCurrent(context)) return;
          this.localDescs = window.OfflineStore.mergeWorkspaceRecords?.(this.localDescs, workspace) || workspace;
        }
        if (!this.collaborationContextCurrent(context)) return;
        this.editorDroppedCandidate = null; this.editorShowEnglishDiff = false;
        this.applyWorkspaceOverlay(); this.filterDesc();
      } catch (error) { this.collaborationNotice = 'Could not discard the translation: ' + error.message; }
      finally { this.editorSaving = false; }
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
      const name = this.editorRefName(kind, index, columnIndex);
      const field = document.querySelector?.('[data-editor-ref="' + name + '"]');
      let r = field?.dataset?.editorRef === name ? field : this.$refs?.[name];
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
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1024;
      const maxWidth = Math.min(360, Math.max(180, maxLineLength * 7 + 28), Math.max(1, viewportWidth - 16));
      // Keep the object passed to AppTooltip stable. Replacing it schedules a
      // render of the entire editor for every pointer movement; nested changes
      // only update the tooltip component that reads these fields.
      Object.assign(this.tooltip, {
        visible: true,
        text: safeText,
        x: Number(e?.clientX || 0) + 14,
        y: Number(e?.clientY || 0) + 18,
        maxWidth
      });
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
    makeEditorTableColumn(english, translation, englishExists = true, translationExists = true, hydrate = true, pack = this.getEditorDictionaryMatchPack()) {
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
      if (hydrate) this.refreshEditorTableColumnHLter(column, pack);
      return column;
    },
    buildEditorTableColumns(english, translation, hydrate = true, pack = this.getEditorDictionaryMatchPack()) {
      let englishColumns = this.splitTableColumns(english);
      let translationColumns = this.splitTableColumns(translation);
      let count = Math.max(englishColumns.length, translationColumns.length);
      let columns = [];
      for (let i = 0; i < count; i++) {
        columns.push(this.makeEditorTableColumn(
          englishColumns[i] ?? "",
          translationColumns[i] ?? "",
          i < englishColumns.length,
          i < translationColumns.length,
          hydrate, pack
        ));
      }
      return columns;
    },
    refreshEditorTableColumnHLter(column, pack = this.getEditorDictionaryMatchPack()) {
      if (!column) return;
      column.isMultiline = this.isMultilineText(column.english ?? "") || this.isMultilineText(column.translation ?? "");
      const diagnostics = this.refreshTranslationDiagnostics(column);
      let { englishHLter: baseEnglishHLter, HLs } = this.buildEnglishHLter(column.english, pack);
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
      this.markDictionarySnapshotDirty?.(word._id);
    },
    async removeDictionaryAltRow(word, alt) {
      if (!word || !Array.isArray(word.alts)) return;
      let id = alt?._id;
      const dictionary = this.dictionary;
      if (!await this.appConfirm(`Are you sure you want to remove alternate definition of ${String(alt?.find ?? "")}?`, {
        title: 'Remove alternate definition?', confirmLabel: 'Remove alternate',
      })) return;
      if (this.dictionary !== dictionary) return;
      if (id) {
        word.alts = word.alts.filter(a => String(a?._id) !== String(id));
      } else {
        word.alts = word.alts.filter(a => a !== alt);
      }
      this.markDictionarySnapshotDirty?.(word._id);
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
      this.markDictionarySnapshotDirty?.(word._id);
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
    getConsistencyResolutionEntries(sourceEnglish) {
      const normalize = window.TranslationDiagnostics.normalizeConsistencyText;
      const entries = [];
      for (const desc of this.descs) {
        for (let blockIndex = 0; blockIndex < (desc.translations?.English || []).length; blockIndex++) {
          if (normalize(desc.translations.English[blockIndex]) !== sourceEnglish) continue;
          const savedTranslation = String(desc.translations[this.lang]?.[blockIndex] ?? '');
          const block = this.editorVisible && desc.filepath === this.editorCurrentEditingDesc?.filepath
            ? this.editorBlocks[blockIndex] : null;
          const draft = block?.isTable
            ? this.joinTableColumns(this.getSerializableTableColumns(block).map(column => column.translation ?? ''))
            : block?.translation;
          entries.push({ filepath: desc.filepath, blockIndex, savedTranslation, translation: normalize(draft ?? savedTranslation) });
        }
      }
      return entries;
    },
    async openConsistencyResolver(blockIndex) {
      if (this.editorLoading || this.editorLoadError || this.editorCompareActive || !this.editorVisible || this.consistencyResolverBusy) return;
      const desc = this.editorCurrentEditingDesc;
      const sourceEnglish = window.TranslationDiagnostics.normalizeConsistencyText(desc?.translations?.English?.[blockIndex]);
      if (!sourceEnglish) return;
      const entries = this.getConsistencyResolutionEntries(sourceEnglish);
      const current = entries.find(entry => entry.filepath === desc.filepath && entry.blockIndex === blockIndex);
      if (!current) return;
      const variants = new Map();
      for (const entry of entries) {
        if (!variants.has(entry.translation)) variants.set(entry.translation, []);
        variants.get(entry.translation).push({ filepath: entry.filepath, blockIndex: entry.blockIndex });
      }
      if (variants.size < 2) return;
      const versions = Array.from(variants, ([text, locations], id) => ({
        id, text, locations, label: `Version ${id + 1} · ${locations.length} ${locations.length === 1 ? 'entry' : 'entries'}`,
      }));
      this._consistencyReturnFocus = document.activeElement;
      this.consistencyResolver = {
        sourceEnglish, entries, versions, currentTranslation: current.translation,
        filepath: desc.filepath, blockIndex, lang: this.lang, gameVersion: this.gameVersion,
        entryCount: entries.length, fileCount: new Set(entries.map(entry => entry.filepath)).size,
      };
      this.consistencyOtherVersion = versions.find(version => version.text !== current.translation).id;
      this.consistencyShowWhitespace = false;
      this.consistencyResolverError = '';
      this.consistencyResolutionNotice = '';
      this.closeHlPopup();
      this.hideTooltip();
      await this.$nextTick();
      this.$refs.consistencyDialog?.showModal();
    },
    closeConsistencyResolver() {
      if (this.consistencyResolverBusy) return;
      const blockIndex = this.consistencyResolver?.blockIndex ?? this.editorFocusedIndex ?? 0;
      this.$refs.consistencyDialog?.close();
      this.consistencyResolver = null;
      this.consistencyResolverError = '';
      this.$nextTick(() => {
        if (this._consistencyReturnFocus?.isConnected) this._consistencyReturnFocus.focus();
        else this.getEditorRef('translation', blockIndex, this.editorBlocks[blockIndex]?.isTable ? 0 : null)?.focus?.();
        this._consistencyReturnFocus = null;
      });
    },
    consistencyDialogKeydown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.closeConsistencyResolver();
      } else if ((event.ctrlKey || event.metaKey) && event.code === 'KeyS') event.preventDefault();
    },
    buildConsistencyChoice(text) {
      const resolver = this.consistencyResolver;
      const normalize = window.TranslationDiagnostics.normalizeConsistencyText;
      const changed = resolver.entries.filter(entry => entry.translation !== text || normalize(entry.savedTranslation) !== text);
      const diagnostics = [];
      const englishColumns = this.isTableText(resolver.sourceEnglish) || this.isTableText(text)
        ? this.splitTableColumns(resolver.sourceEnglish) : [resolver.sourceEnglish];
      const translationColumns = englishColumns.length > 1 || this.isTableText(text) ? this.splitTableColumns(text) : [text];
      for (let i = 0; i < Math.max(englishColumns.length, translationColumns.length); i++) {
        diagnostics.push(...this.analyzeTranslationDiagnostics(translationColumns[i] ?? '', englishColumns[i] ?? '', resolver.lang).diagnostics);
      }
      if (!text.trim()) diagnostics.push({ level: 'warning', message: 'Empty translation: applying this version clears all matching entries.' });
      if (englishColumns.length !== translationColumns.length) diagnostics.push({ level: 'error', message: 'Match the English table column count before applying this version to all entries.' });
      if (this.computeTextStats(text).lines !== this.computeTextStats(resolver.sourceEnglish).lines) {
        diagnostics.push({ level: 'warning', message: 'The number of lines differs from English.' });
      }
      return {
        text, locations: resolver.versions.find(version => version.text === text)?.locations || [],
        changeCount: changed.length, changeFileCount: new Set(changed.map(entry => entry.filepath)).size,
        errors: diagnostics.filter(item => item.level === 'error'), warnings: diagnostics.filter(item => item.level === 'warning'),
      };
    },
    async applyConsistencyVersion(text) {
      const resolver = this.consistencyResolver;
      if (!resolver || this.consistencyResolverBusy || this.editorCompareActive) return false;
      const originalBlocks = this.editorBlocks;
      const draftBeforeResolution = originalBlocks.map(block => block?.translation ?? '');
      const originalsBeforeResolution = [...this.editorOriginalTranslations];
      const baseBeforeResolution = this._editorCollabBase ? this.toPlainForStorage(this._editorCollabBase) : null;
      this.consistencyResolverError = '';
      if (this.lang !== resolver.lang || this.gameVersion !== resolver.gameVersion
        || !this.editorVisible || this.editorCurrentEditingDesc?.filepath !== resolver.filepath
        || JSON.stringify(this.getConsistencyResolutionEntries(resolver.sourceEnglish)) !== JSON.stringify(resolver.entries)) {
        this.consistencyResolverError = 'These entries changed while the comparison was open. Close it and compare again.';
        return false;
      }
      if (!resolver.versions.some(version => version.text === text)) return false;
      const choice = this.buildConsistencyChoice(text);
      if (choice.errors.length) {
        this.consistencyResolverError = 'Fix the errors in this version before applying it to other entries.';
        return false;
      }
      const normalize = window.TranslationDiagnostics.normalizeConsistencyText;
      const nextWorkspace = this.toPlainForStorage(this.localDescs);
      if (!nextWorkspace) {
        this.consistencyResolverError = 'The workspace could not be prepared for saving. No entries were changed.';
        return false;
      }
      if (!Array.isArray(nextWorkspace.descs)) nextWorkspace.descs = [];
      if (!nextWorkspace.status) nextWorkspace.status = {};
      window.WorkspaceState.scopeWorkspace(nextWorkspace, resolver.lang);
      const encoded = this.encodeNewlines(text);
      const updates = new Map();
      const revisions = [];
      const savedAt = Date.now();
      // Stage all files first. Unrelated editor drafts never enter the stored snapshot.
      for (const entry of resolver.entries) {
        if (normalize(entry.savedTranslation) === text) continue;
        if (!updates.has(entry.filepath)) {
          const desc = this.getDescByFilepath(entry.filepath);
          updates.set(entry.filepath, { desc, before: [...(desc.translations[resolver.lang] || [])], lines: [...(desc.translations[resolver.lang] || [])] });
        }
        updates.get(entry.filepath).lines[entry.blockIndex] = encoded;
      }
      for (const { desc, before, lines } of updates.values()) {
        const isMissing = computeIsMissing(desc.translations.English.length, lines);
        const local = nextWorkspace.descs.find(item => item.filepath === desc.filepath);
        if (local) updateLocalDesc(local, desc, resolver.lang, lines, { derivedStatus: true });
        else nextWorkspace.descs.push(makeLocalDesc(desc, resolver.lang, lines, { derivedStatus: true }));
        nextWorkspace.status[desc.filepath] = window.WorkspaceState.setFileMetadata(nextWorkspace.status[desc.filepath] || {}, resolver.lang,
          { lastTranslatedAt: savedAt, lastEditedAt: savedAt }, local);
        const metadata = { filepath: desc.filepath, filename: desc.filename, filedir: desc.filedir, lang: resolver.lang };
        revisions.push(
          { ...metadata, savedAt: savedAt - 1, note: 'Before consistency resolution', translations: before, isMissing: computeIsMissing(desc.translations.English.length, before) },
          { ...metadata, savedAt, note: 'Resolve inconsistent translations', translations: lines, isMissing },
        );
      }
      const submittedCurrentFile = [...(updates.get(resolver.filepath)?.lines || this.editorCurrentEditingDesc.translations[resolver.lang] || [])];
      this.consistencyResolverBusy = true;
      try {
        if (updates.size && this.persistTranslationBatch) {
          const result = await this.persistTranslationBatch([...updates.values()], 'consistency', { workspace: nextWorkspace, revisions });
          if (result.status === 'conflict' || result.stale) {
            this.consistencyResolverError = 'Saved locally. Resolve shared changes before applying this result.';
            this.consistencyResolverBusy = false;
            return false;
          }
          const effective = new Map((this._collaboration?.snapshot()?.files || []).map(file => [file.filepath, file]));
          for (const [path, update] of updates) if (effective.has(path)) update.lines = [...effective.get(path).translations];
        } else if (updates.size && !this.testMode) {
          if (!window.OfflineStore?.saveWorkspaceWithRevisions) throw new Error('Local storage is unavailable.');
          const snapshot = this.toPlainForStorage({ workspace: nextWorkspace, revisions });
          if (!snapshot) throw new Error('The workspace could not be serialized.');
          await window.OfflineStore.saveWorkspaceWithRevisions(snapshot.workspace, snapshot.revisions, resolver.gameVersion);
        }
      } catch (error) {
        this.consistencyResolverError = `Could not save the resolution. No entries were changed. ${error.message || error}`;
        this.consistencyResolverBusy = false;
        return false;
      }
      // A background settings sync can switch language while storage is committing.
      // The committed batch belongs to its captured version; never replace another
      // version's workspace or write into a newly opened editor.
      const sameVersion = this.gameVersion === resolver.gameVersion;
      const sameEditor = sameVersion && this.lang === resolver.lang && this.editorBlocks === originalBlocks
        && this.editorCurrentEditingDesc?.filepath === resolver.filepath && this.editorVisible;
      if (updates.size && sameVersion && !this.persistTranslationBatch) this.localDescs = nextWorkspace;
      for (const { desc, lines } of updates.values()) {
        desc.translations[resolver.lang] = lines;
        if (this.lang === resolver.lang) desc.hasChanges = true;
        desc.isMissing = computeIsMissing(desc.translations.English.length, desc.translations[this.lang] || []);
      }
      // Matching entries commit; unrelated drafts retain their own merge bases.
      // Clean entries may adopt independent remote changes accepted in the batch.
      if (sameEditor && this.rebaseEditorAfterCommit) {
        const accepted = this._collaboration?.fileBase(resolver.filepath)
          || { filepath: resolver.filepath, translations: [...this.editorCurrentEditingDesc.translations[resolver.lang]],
            needsReview: !!this.editorCurrentEditingDesc.needsReview, trackedForExport: !!this.editorCurrentEditingDesc.hasChanges };
        this.rebaseEditorAfterCommit(accepted, {
          draftBefore: draftBeforeResolution, submittedTranslations: submittedCurrentFile,
          savedIndexes: resolver.entries.filter(entry => entry.filepath === resolver.filepath).map(entry => entry.blockIndex),
          baseBefore: baseBeforeResolution, originalsBefore: originalsBeforeResolution,
        });
      } else if (sameEditor) {
        for (const entry of resolver.entries) {
          if (entry.filepath !== this.editorCurrentEditingDesc?.filepath) continue;
          const block = this.editorBlocks[entry.blockIndex];
          if (!block) continue;
          block.translation = text;
          block.isTable = this.isTableText(block.english) || this.isTableText(text);
          block.isMultiline = this.isMultilineText(block.english) || this.isMultilineText(text);
          if (block.isTable) this.rebuildEditorTableColumnsFromStrings(block);
          else block.tableColumns = [];
          block.translationReplace = ''; block.words = [];
          this.editorOriginalTranslations[entry.blockIndex] = block.translation;
          this.refreshEditorBlockMeta(block, entry.blockIndex);
        }
        this.refreshEditorHLter(); this.refreshGamePreview();
      }
      this.refreshConsistencyResolutionDiagnostics(resolver);
      this.filterDesc();
      this.consistencyResolutionNotice = `Applied this version to all ${resolver.entryCount} matching ${resolver.lang} entries in ${resolver.fileCount} files. ${choice.changeCount} entries updated. Other edits remain in draft.`;
      if (this.sideTab === 'history') await this.refreshHistory();
      this.consistencyResolverBusy = false;
      this.closeConsistencyResolver();
      return true;
    },
    analyzeTranslationDiagnostics(text, english = null, lang = this.lang, checks = null) {
      const result = window.TranslationDiagnostics && typeof window.TranslationDiagnostics.analyze === "function"
        ? window.TranslationDiagnostics.analyze(text, { lang, checks })
        : this.emptyTranslationDiagnostics();
      const analysis = this.addTagIdentityDiagnostics(result, english, text, checks);
      // Terminology is opt-in for a manual scan, never part of editor/save validation.
      const terminology = !checks?.terminology || english == null ? [] : window.TerminologyDiagnostics.analyze(
        english, text, this.terminologyDictionary, { lang }
      );
      return {
        diagnostics: [...analysis.diagnostics, ...terminology],
        warningCount: analysis.warningCount + terminology.length,
        errorCount: analysis.errorCount,
      };
    },
    analyzeDescConsistencyDiagnostics(desc, lang = this.lang, index = null) {
      if (!index) return [];
      const englishLines = Array.isArray(desc?.translations?.English) ? desc.translations.English : [];
      const translationLines = Array.isArray(desc?.translations?.[lang]) ? desc.translations[lang] : [];
      const diagnostics = [];
      for (let blockIndex = 0; blockIndex < englishLines.length; blockIndex++) {
        const diagnostic = window.TranslationDiagnostics.getConsistencyDiagnostic(
          index, englishLines[blockIndex], translationLines[blockIndex] ?? ""
        );
        if (diagnostic) diagnostics.push({ ...diagnostic, blockIndex });
      }
      return diagnostics;
    },
    analyzeDescDiagnostics(desc, lang = this.lang, consistencyIndex = null, checks = this.diagnosticScanChecks) {
      const englishLines = Array.isArray(desc?.translations?.English) ? desc.translations.English : [];
      const translationLines = Array.isArray(desc?.translations?.[lang]) ? desc.translations[lang] : [];
      let warningCount = 0;
      let errorCount = 0;
      const terminologyDiagnostics = [];
      const diagnostics = [];
      // Keep cards bounded while retaining the exact counts and manual editor caches.
      const collectDiagnostic = (diagnostic, blockIndex, columnIndex) => {
        const located = { ...diagnostic, blockIndex, columnIndex };
        if (diagnostics.length < 40) diagnostics.push(located);
        else if (diagnostic.level === 'error') {
          const warningIndex = diagnostics.findIndex(item => item.level !== 'error');
          if (warningIndex >= 0) diagnostics[warningIndex] = located;
        }
      };
      const collectDiagnostics = (result, blockIndex, columnIndex) => {
        for (const diagnostic of result.diagnostics) {
          collectDiagnostic(diagnostic, blockIndex, columnIndex);
          if (diagnostic.code === "dictionary-terminology") {
            terminologyDiagnostics.push({ ...diagnostic, blockIndex, columnIndex });
          }
        }
      };

      for (let i = 0; i < englishLines.length; i++) {
        const englishRaw = englishLines[i] || "";
        const translationRaw = translationLines[i] || "";
        const decodedEnglish = this.decodeEscapedNewlines(englishRaw);
        const decodedTranslation = this.decodeEscapedNewlines(translationRaw);
        const isTable = this.isTableText(decodedEnglish) || this.isTableText(decodedTranslation);
        const isMultiline = this.isMultilineText(englishRaw) || this.isMultilineText(translationRaw);
        const english = (isTable || isMultiline) ? decodedEnglish : englishRaw;
        const translation = (isTable || isMultiline) ? decodedTranslation : translationRaw;

        if (isTable) {
          const englishColumns = this.splitTableColumns(english);
          const translationColumns = this.splitTableColumns(translation);
          const columnCount = Math.max(englishColumns.length, translationColumns.length);
          for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
            const result = this.analyzeTranslationDiagnostics(
              translationColumns[columnIndex] ?? "",
              englishColumns[columnIndex] ?? "",
              lang,
              checks
            );
            warningCount += Number(result.warningCount || 0);
            errorCount += Number(result.errorCount || 0);
            collectDiagnostics(result, i, columnIndex);
          }
        } else {
          const result = this.analyzeTranslationDiagnostics(translation, english, lang, checks);
          warningCount += Number(result.warningCount || 0);
          errorCount += Number(result.errorCount || 0);
          collectDiagnostics(result, i);
        }
      }

      const consistencyDiagnostics = checks.consistency
        ? this.analyzeDescConsistencyDiagnostics(desc, lang, consistencyIndex) : [];
      warningCount += consistencyDiagnostics.length;
      for (const diagnostic of consistencyDiagnostics) collectDiagnostic(diagnostic, diagnostic.blockIndex);
      diagnostics.sort((a, b) => Number(b.level === 'error') - Number(a.level === 'error')
        || a.blockIndex - b.blockIndex || Number(a.columnIndex || 0) - Number(b.columnIndex || 0));
      return {
        warningCount,
        errorCount,
        diagnostics,
        diagnosticsTruncated: Math.max(0, warningCount + errorCount - diagnostics.length),
        consistencyDiagnostics,
        terminologyDiagnostics,
        lang,
        englishLines: [...englishLines],
        translationLines: [...translationLines],
        hasDiagnosticWarning: warningCount > 0,
        hasDiagnosticError: errorCount > 0,
      };
    },
    getDiagnosticScanTitle(result) {
      if (!result) return "";
      const warnings = Number(result.warningCount || 0);
      const errors = Number(result.errorCount || 0);
      const consistency = result.consistencyDiagnostics || [];
      const details = consistency.length > 0
        ? `\nInconsistent entries: ${consistency.length}\n${this.formatDiagnosticsForDisplay(consistency, 3)}`
        : "";
      const terminology = result.terminologyDiagnostics || [];
      const terminologyDetails = terminology.length > 0
        ? `\nDictionary terminology: ${terminology.length}\n${this.formatDiagnosticsForDisplay(terminology, 3)}`
        : "";
      return `Diagnostic scan: ${errors} error(s), ${warnings} warning(s)${details}${terminologyDetails}`;
    },
    clearDiagnosticScanResults() {
      this.diagnosticScanRunId++;
      this._diagnosticScanCache = null;
      this.diagnosticScanResults = {};
      this.diagnosticScanAppliedChecks = null;
      this.diagnosticScanRunning = false;
      this.diagnosticScanCompleted = false;
      this.diagnosticScanProcessed = 0;
      this.diagnosticScanTotal = 0;
      this.diagnosticScanErrorFileCount = 0;
      this.diagnosticScanWarningFileCount = 0;
      this.diagnosticScanError = '';
      this.diagnosticScanStopped = false;
      this.diagnosticScanPhase = '';
      this.diagnosticScanResultsPage = 1;
    },
    refreshConsistencyResolutionDiagnostics(resolver) {
      if (this.lang !== resolver.lang || this.gameVersion !== resolver.gameVersion) return;
      this.updateScannedDescDiagnostics(resolver.entries.map(entry => entry.filepath));
    },
    scheduleDictionaryDiagnosticScan() {
      // Dictionary edits invalidate the snapshot; only the scan button starts a new scan.
      const hadResults = Object.keys(this.diagnosticScanResults || {}).length > 0;
      if (!hadResults && !this.diagnosticScanRunning && !this.diagnosticScanCompleted && !this.diagnosticScanStopped) return;
      this.clearDiagnosticScanResults();
      if (hadResults) this.filterDesc();
    },
    updateScannedDescDiagnostics(changedDescs = []) {
      // An unfinished scan may have read translations that have just changed.
      if (this.diagnosticScanRunning) {
        this.clearDiagnosticScanResults();
        return null;
      }
      if (!this.diagnosticScanCompleted || !this.diagnosticScanAppliedChecks) return [];
      const cache = this._diagnosticScanCache;
      const descriptions = Vue.toRaw ? Vue.toRaw(this.descs) : this.descs;
      if (!cache || cache.runId !== this.diagnosticScanRunId || cache.descriptions !== descriptions
        || cache.lang !== this.lang || cache.game !== this.gameVersion || cache.source !== this.sourceIdentity
        || cache.account !== (this.cloudUser?.id || '') || cache.branch !== (this.branchId || 'default')
        || cache.hideDNT !== this.hideDNT) {
        this.clearDiagnosticScanResults();
        return null;
      }
      const filepaths = new Set((Array.isArray(changedDescs) ? changedDescs : [changedDescs])
        .map(desc => typeof desc === 'string' ? desc : desc?.filepath));
      const checks = this.diagnosticScanAppliedChecks;
      const results = this.diagnosticScanResults;
      const changed = [...filepaths].map(filepath => cache.files.get(filepath))
        .filter(desc => desc && results[desc.filepath]);
      if (!changed.length) return [];
      const affected = checks.consistency
        ? window.TranslationDiagnostics.updateConsistencyIndex(cache.consistencyIndex, changed, this.lang, results)
        : new Set(changed.map(desc => desc.filepath));
      // Refresh saved files and peers of changed entries, including clean peers
      // that now have a conflict. Retain unrelated findings and scan selections.
      const refreshed = [];
      for (const filepath of affected) {
        const desc = cache.files.get(filepath), previous = results[filepath];
        if (!desc || !previous) continue;
        const next = this.analyzeDescDiagnostics(desc, this.lang, cache.consistencyIndex, checks);
        results[filepath] = next;
        refreshed.push(filepath);
        this.diagnosticScanErrorFileCount += Number(next.hasDiagnosticError) - Number(previous.hasDiagnosticError);
        this.diagnosticScanWarningFileCount += Number(next.hasDiagnosticWarning) - Number(previous.hasDiagnosticWarning);
      }
      return refreshed;
    },
    openRawFileDialog() {
      if (!this.editorVisible || this.editorLoading || this.editorLoadError || this.editorSaving || this.navigationBusy) return;
      const dialog = this.$refs.rawFileDialog;
      const desc = this.editorCurrentEditingDesc;
      const original = desc && this.workspaceSourceFile(desc.filepath);
      if (!dialog || dialog.open || !original) return;
      const translations = this.serializeEditorTranslations();
      const applied = { ...original, translations: { ...original.translations, [this.lang]: translations } };
      // Render both views through the export encoder without changing source or saved text.
      const originalBytes = descEncode(original), translatedBytes = descEncode(applied);
      this._rawFileDownloadBuffers = { original: originalBytes, translated: translatedBytes };
      this.rawFilePreview = {
        filepath: desc.filepath,
        filename: desc.filename || desc.filepath.split('/').pop(),
        language: this.lang,
        original: window.StatDescCodec.decodeUTF16(originalBytes),
        translated: window.StatDescCodec.decodeUTF16(translatedBytes),
      };
      this.rawFileMode = 'original';
      this._rawFileScope = this.rawFileScope;
      this._rawFileReturnFocus = document.activeElement;
      this.closeHlPopup();
      this.hideTooltip();
      dialog.showModal();
      this.$nextTick(() => this.$refs.rawFileMode?.focus());
    },
    closeRawFileDialog() {
      const dialog = this.$refs.rawFileDialog;
      if (dialog?.open) dialog.close();
    },
    rawFileDialogClosed() {
      const target = this._rawFileReturnFocus;
      const restoreFocus = this.editorVisible && this._rawFileScope === this.rawFileScope;
      this._rawFileReturnFocus = null;
      this._rawFileScope = null;
      this._rawFileDownloadBuffers = null;
      this.rawFilePreview = null;
      if (restoreFocus && target?.isConnected && typeof target.focus === 'function') target.focus({ preventScroll: true });
    },
    rawFileDialogKeydown(event) {
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyS') event.preventDefault();
    },
    downloadRawFile() {
      const bytes = this._rawFileDownloadBuffers?.[this.rawFileMode];
      if (!this.rawFilePreview || !bytes || this._rawFileScope !== this.rawFileScope) return;
      saveAs(new Blob([bytes], { type: 'text/plain;charset=utf-16le' }), this.rawFilePreview.filename);
    },
    openDiagnosticScanDialog() {
      if ((this.inlineActive || this._inlineFinishing) && this.finishInlineSession) {
        return this.finishInlineSession({ promote: true }).then(done => done && this.openDiagnosticScanDialog());
      }
      this.hideTooltip();
      const dialog = this.$refs.diagnosticScanDialog;
      if (!dialog || dialog.open) return;
      this._diagnosticScanReturnFocus = document.activeElement;
      dialog.showModal();
      this.$nextTick(() => this.$refs.diagnosticScanHeading?.focus());
    },
    closeDiagnosticScanDialog(restoreFocus = true) {
      if (restoreFocus === false) this._diagnosticScanReturnFocus = null;
      this.$refs.diagnosticScanDialog?.close();
    },
    diagnosticScanDialogClosed() {
      const target = this._diagnosticScanReturnFocus;
      this._diagnosticScanReturnFocus = null;
      if (target?.isConnected && typeof target.focus === 'function') target.focus({ preventScroll: true });
    },
    diagnosticScanDialogKeydown(event) {
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyS') event.preventDefault();
    },
    startDiagnosticScan() {
      if (!this.hasDiagnosticScanSelection || this.diagnosticScanRunning) return;
      return this.scanAllDiagnostics();
    },
    stopDiagnosticScan() {
      if (!this.diagnosticScanRunning) return;
      this.diagnosticScanRunId++;
      this.diagnosticScanRunning = false;
      this.diagnosticScanStopped = true;
      this.diagnosticScanPhase = '';
    },
    openDiagnosticResult(filepath) {
      this.closeDiagnosticScanDialog(false);
      this.editFile(filepath);
    },
    diagnosticScanIssueLocation(diagnostic) {
      let location = `Entry ${Number(diagnostic.blockIndex || 0) + 1}`;
      if (Number.isInteger(diagnostic.columnIndex)) location += ` · column ${diagnostic.columnIndex + 1}`;
      return location;
    },
    async scanAllDiagnostics() {
      if (this.diagnosticScanRunning || !this.hasDiagnosticScanSelection) return;
      const descs = this.diagnosticScanDescs;
      const scanLang = this.lang;
      const descriptions = Vue.toRaw ? Vue.toRaw(this.descs) : this.descs;
      const scanGame = this.gameVersion, scanSource = this.sourceIdentity, scanHideDNT = this.hideDNT;
      const scanAccount = this.cloudUser?.id || '', scanBranch = this.branchId || 'default';
      const checks = { ...this.diagnosticScanChecks };
      const runId = ++this.diagnosticScanRunId;
      const results = {};
      let errorFileCount = 0;
      let warningFileCount = 0;

      this.diagnosticScanResults = {};
      this._diagnosticScanCache = null;
      this.diagnosticScanAppliedChecks = null;
      this.diagnosticScanRunning = true;
      this.diagnosticScanCompleted = false;
      this.diagnosticScanProcessed = 0;
      this.diagnosticScanTotal = descs.length;
      this.diagnosticScanErrorFileCount = 0;
      this.diagnosticScanWarningFileCount = 0;
      this.diagnosticScanError = '';
      this.diagnosticScanStopped = false;
      this.diagnosticScanPhase = 'Preparing checks…';
      this.diagnosticScanResultsPage = 1;
      this.filterDesc();

      try {
        // Paint the modal before indexing or analysis; even a small scan has visible feedback.
        await this.$nextTick?.();
        await new Promise(resolve => setTimeout(resolve, 0));
        if (runId !== this.diagnosticScanRunId || scanLang !== this.lang) return;
        const consistencyIndex = checks.consistency
          ? window.TranslationDiagnostics.createConsistencyIndex(descs, scanLang) : null;
        this.diagnosticScanPhase = 'Checking files…';
        await new Promise(resolve => setTimeout(resolve, 0));
        for (let i = 0; i < descs.length; i++) {
          if (runId !== this.diagnosticScanRunId || scanLang !== this.lang) return;
          const desc = descs[i];
          const result = this.analyzeDescDiagnostics(desc, scanLang, consistencyIndex, checks);
          results[desc.filepath] = result;
          if (result.hasDiagnosticError) errorFileCount++;
          if (result.hasDiagnosticWarning) warningFileCount++;
          this.diagnosticScanProcessed = i + 1;
          this.diagnosticScanErrorFileCount = errorFileCount;
          this.diagnosticScanWarningFileCount = warningFileCount;

          if ((i + 1) % 25 === 0) {
            await new Promise(resolve => setTimeout(resolve, 0));
            if (runId !== this.diagnosticScanRunId || scanLang !== this.lang) return;
          }
        }

        if (runId !== this.diagnosticScanRunId || scanLang !== this.lang) return;
        this.diagnosticScanResults = results;
        const cache = { runId, descriptions, lang: scanLang, game: scanGame, source: scanSource, hideDNT: scanHideDNT,
          account: scanAccount, branch: scanBranch,
          files: new Map(descs.map(desc => [desc.filepath, desc])), consistencyIndex };
        this._diagnosticScanCache = Vue.markRaw ? Vue.markRaw(cache) : cache;
        this.diagnosticScanAppliedChecks = checks;
        this.diagnosticScanErrorFileCount = errorFileCount;
        this.diagnosticScanWarningFileCount = warningFileCount;
        this.diagnosticScanCompleted = true;
        this.diagnosticScanRunning = false;
        this.diagnosticScanPhase = '';
        this.filterDesc();
      } catch (error) {
        if (runId !== this.diagnosticScanRunId) return;
        console.error("Diagnostic scan failed:", error);
        this.diagnosticScanRunning = false;
        this.diagnosticScanPhase = '';
        this.diagnosticScanError = `The scan could not be completed. ${error.message || error}`;
      }
    },
    refreshTranslationDiagnostics(target) {
      if (!target) return this.emptyTranslationDiagnostics();
      const result = this.analyzeTranslationDiagnostics(target.translation ?? "", target.english ?? null);
      target.translationDiagnostics = result.diagnostics;
      target.diagnosticWarningCount = result.warningCount;
      target.diagnosticErrorCount = result.errorCount;
      return result;
    },
    addTagIdentityDiagnostics(result, english, translation, checks = null) {
      const base = result && typeof result === "object" ? result : this.emptyTranslationDiagnostics();
      const diagnostics = Array.isArray(base.diagnostics) ? [...base.diagnostics] : [];
      if (english === null || english === undefined) {
        return {
          diagnostics,
          warningCount: diagnostics.filter(d => d.level === "warning").length,
          errorCount: diagnostics.filter(d => d.level === "error").length
        };
      }

      if (!checks || checks.variables) diagnostics.push(...this.buildGggVarIdentityDiagnostics(english, translation));
      if (!checks || checks.keywords) diagnostics.push(...this.buildKeywordPopupTagNameDiagnostics(english, translation));
      if (!checks || checks.decorations) diagnostics.push(...this.buildTextDecorationTagNameDiagnostics(english, translation));
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
      const tags = [];
      for (const { full, start, end } of extractGGGVarTags(source)) {
        const key = typeof getGggVarIdentityKey === "function" ? getGggVarIdentityKey(full) : full;
        tags.push({
          full,
          // Diagnostics distinguish percent values; preview inputs still share the bare identity.
          key: `{${key}}${full.endsWith("%") ? "%" : ""}`,
          start: offset + start,
          end: offset + end
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
        .map(key => `${key}${counts[key] > 1 ? ` x${counts[key]}` : ""}`)
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
        for (const diagnostic of this.blockTerminologyDiagnostics(block, i)) {
          if (!level || diagnostic.level === level) items.push(diagnostic);
        }
        const consistency = this.editorConsistencyDiagnostics[i];
        if (consistency && (!level || consistency.level === level)) {
          items.push({ ...consistency, blockIndex: i });
        }
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
    blockDiagnosticTitle(editorBlock, level, blockIndex = this.editorBlocks.indexOf(editorBlock)) {
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
      const consistency = this.editorConsistencyDiagnostics[blockIndex];
      if (consistency && (!level || consistency.level === level)) diagnostics.unshift(consistency);
      diagnostics.push(...this.blockTerminologyDiagnostics(editorBlock, blockIndex)
        .filter(diagnostic => !level || diagnostic.level === level));
      const lines = diagnostics.slice(0, 8).map(d => {
        const prefix = Number.isInteger(d.columnIndex) ? `Column ${d.columnIndex + 1}: ` : "";
        return `${prefix}${d.message || d.code || "Translation diagnostic"}`;
      });
      if (diagnostics.length > 8) lines.push(`...and ${diagnostics.length - 8} more`);
      return lines.join("\n");
    },
    getEditorDiagnosticScanResult(editorBlock, blockIndex) {
      if (!(this.editorSessionActive ?? this.editorVisible) || this.editorCompareActive || !this.diagnosticScanCompleted) return null;
      const result = this.diagnosticScanResults[this.editorCurrentEditingDesc?.filepath];
      if (!result || result.lang !== this.lang) return null;
      const translation = editorBlock.isTable
        ? this.joinTableColumns(this.getSerializableTableColumns(editorBlock).map(column => column.translation ?? ''))
        : editorBlock.translation ?? '';
      const normalize = window.TranslationDiagnostics.normalizeConsistencyText;
      // Cached manual warnings belong only to the exact text that was scanned.
      if (normalize(editorBlock.english) !== normalize(result.englishLines[blockIndex])
        || normalize(translation) !== normalize(result.translationLines[blockIndex])) return null;
      return result;
    },
    blockTerminologyDiagnostics(editorBlock, blockIndex = this.editorBlocks.indexOf(editorBlock)) {
      return this.getEditorDiagnosticScanResult(editorBlock, blockIndex)?.terminologyDiagnostics
        .filter(diagnostic => diagnostic.blockIndex === blockIndex) || [];
    },
    blockDiagnosticWarningCount(editorBlock, blockIndex) {
      return Number(editorBlock.diagnosticWarningCount || 0)
        + this.blockTerminologyDiagnostics(editorBlock, blockIndex).length
        + (this.editorConsistencyDiagnostics[blockIndex] ? 1 : 0);
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
      if (typeof editorIndex === "number" && !editorBlock.isTable) {
        this.$nextTick(() => this.syncHlScroll('translation', editorIndex));
      }
    },
    translationInput(editorBlock, editorIndex, e) {
      if (this.editorTranslationReadOnly) return;
      if (this.isImeComposingEvent(e)) return;
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
      this.queueCommittedAutocompleteTrigger(e, editorIndex);
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
      if (!this.editorSessionActive) return;
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
      if (!this.editorSessionActive) return;
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
        this.autosizeTextarea(this.getEditorRef("english", i), { minHeight: 72, maxHeight: 220 });
        this.autosizeTextarea(this.getEditorRef("translation", i), { minHeight: 84, maxHeight: 260 });
      }
    },
    normalizeMultilineEditorBlock(editorBlock, editorIndex, e) {
      if (this.editorTranslationReadOnly) return;
      if (this.isImeComposingEvent(e)) return;
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
      this.queueCommittedAutocompleteTrigger(e, editorIndex);
    },
    tableColumnInput(editorBlock, editorIndex, columnIndex, e) {
      if (this.editorTranslationReadOnly) return;
      if (this.isImeComposingEvent(e)) return;
      let column = editorBlock?.tableColumns?.[columnIndex];
      if (!column) return;
      let next = column.isMultiline ? this.decodeEscapedNewlines(column.translation || "") : column.translation;
      if (next !== column.translation) column.translation = next;
      this.refreshEditorTableColumnHLter(column);
      this.syncEditorBlockFromTableColumns(editorBlock);
      if (typeof editorIndex === "number") {
        this.refreshEditorBlockMeta(editorBlock, editorIndex);
        this.$nextTick(() => {
          if (column.isMultiline) {
            this.autosizeTextarea(this.getEditorRef("translation", editorIndex, columnIndex), { minHeight: 84, maxHeight: 260 });
          }
          this.syncHlScroll("translation", editorIndex, columnIndex);
        });
      }
      this.refreshGamePreview();
      this.queueCommittedAutocompleteTrigger(e, editorIndex, columnIndex);
    },
    loadDummyData() {
      let desc1 = parseDesc("test/dummy1.txt", dummyFile1, this.lang);
      let desc2 = parseDesc("test/dummy2.txt", dummyFile2, this.lang);
      let desc3 = parseDesc("test/dummy3.txt", dummyFile3, this.lang);
      if (!desc1) return;
      if (!desc2) return;
      if (!desc3) return;
      this._workspaceSourceBaseline = this.toPlainForStorage([desc1, desc2, desc3]);
      this._workspaceBaselineIndex = null;
      this.descs = [desc1, desc2, desc3];
      this.sourceLoaded = true;
      this.applyWorkspaceOverlay();
      this.loadingProgress = 100;
      this.filterDesc();
    },
    ensureDictionaryIds() {
      if (!Array.isArray(this.dictionary)) return;
      const reservedIds = new Set(this.dictionary.map(entry => String(entry?._id || '')).filter(Boolean));
      const usedIds = new Set();
      for (const entry of this.dictionary) {
        if (!entry) continue;
        let id = String(entry._id || `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`);
        if (usedIds.has(id)) {
          const base = id;
          let suffix = 2;
          while (reservedIds.has(id = `${base}~${suffix++}`) || usedIds.has(id)) {}
        }
        entry._id = id;
        usedIds.add(id);
        if (Object.prototype.hasOwnProperty.call(entry, 'gameScope')) {
          const scope = window.DictionaryScope.normalize(entry);
          if (scope === 'all') delete entry.gameScope;
          else entry.gameScope = scope;
        }
        if (typeof entry.tlnote !== "string") entry.tlnote = entry.tlnote == null ? "" : String(entry.tlnote);
        if (!Array.isArray(entry.alts)) entry.alts = [];
        entry.alts = entry.alts.map(a => {
          if (!a || typeof a !== "object") return null;
          let f = String(a.find ?? "");
          let r = (typeof a.replace === "string" ? a.replace : String(entry?.replace ?? ""));
          return { _id: a._id || `a_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`, find: f, replace: r };
        }).filter(Boolean);
      }
      this.markDictionarySnapshotDirty?.(null, { replace: true });
    },
    getActiveDictionaryEntries() {
      return this.dictionaryScopeView.active;
    },
    getPreparedEditorDictionaryIndex() {
      return this.getEditorDictionaryMatchPack();
    },
    getEditorDictionaryMatchPack(popup = false) {
      const pack = popup && this._hlPopupDictionaryPack || this.editorDictionaryMatchPack;
      return pack && pack.scopeKey === this.dictionaryWorkerScopeKey?.() ? pack : null;
    },
    getDictionaryAssistanceEntry(dictId, popup = false) {
      return this.getEditorDictionaryMatchPack(popup)?.entriesById?.[String(dictId)];
    },
    resetDictionaryAssistanceScope() {
      this.cancelDictionaryMatchRequests();
      this.editorDictionaryMatchPack = null;
      this._pendingDictionaryMatchPack = null;
      this._hlPopupDictionaryPack = null;
      this.closeHlPopup();
      for (const block of this.editorBlocks || []) {
        for (const column of block.isTable ? block.tableColumns || [] : [block]) {
          column.HLs = [];
          column.englishHLter = escapeHtml(String(column.english ?? ''));
        }
      }
    },
    cancelDictionaryMatchRequests() {
      for (const request of this._dictionaryMatchRequests || []) request.cancel?.();
      this._dictionaryMatchRequests?.clear();
      this._pendingDictionaryMatchPack = null;
    },
    dictionaryEditorContext() {
      return JSON.stringify([this.dictionaryWorkerScopeKey?.(), this.branchId || 'default', this.sourceIdentity,
        this.editorCurrentEditingDesc?.filepath, this._editorOpenRun]);
    },
    async prepareEditorDictionaryMatches(blocks, isCurrent = () => true) {
      const scopeKey = this.dictionaryWorkerScopeKey();
      const client = this.ensureDictionaryWorker();
      try { await this.ensureDictionarySnapshot(); }
      catch (error) {
        if (!isCurrent() || scopeKey !== this.dictionaryWorkerScopeKey() || error?.name === 'AbortError') return null;
        throw error;
      }
      if (!isCurrent() || scopeKey !== this.dictionaryWorkerScopeKey()) return null;
      const texts = new Set();
      for (const block of blocks || []) {
        if (block?.isTable) for (const column of block.tableColumns || []) texts.add(String(column.english ?? ''));
        else texts.add(String(block?.english ?? ''));
      }
      texts.add('');
      const cached = this.getEditorDictionaryMatchPack();
      if (cached?.generation === client.readyGeneration && cached.highlightDict === !!this.highlightDict
        && Array.from(texts).every(text => cached.byEnglish.has(text))) return cached;
      const units = Array.from(texts, (english, index) => ({ key: String(index), english }));
      const highlightDict = !!this.highlightDict;
      const request = client.match(units, { highlightDict });
      const requests = this._dictionaryMatchRequests ||= new Set();
      requests.add(request);
      try {
        const result = await request;
        if (!isCurrent() || scopeKey !== this.dictionaryWorkerScopeKey() || highlightDict !== !!this.highlightDict) return null;
        const pack = { ...result, scopeKey, highlightDict,
          byEnglish: new Map(result.units.map(unit => [unit.english, unit])) };
        return Vue.markRaw ? Vue.markRaw(pack) : pack;
      } catch (error) {
        if (!isCurrent() || scopeKey !== this.dictionaryWorkerScopeKey() || error?.code === 'CANCELLED' || error?.name === 'AbortError') return null;
        throw error;
      } finally { requests.delete(request); }
    },
    adoptEditorDictionaryMatchPack(pack) {
      if (!pack || pack.scopeKey !== this.dictionaryWorkerScopeKey() || pack.highlightDict !== !!this.highlightDict) return false;
      const previous = this.getEditorDictionaryMatchPack();
      if (previous && previous.generation > pack.generation) return false;
      this.editorDictionaryMatchPack = Vue.markRaw ? Vue.markRaw(pack) : pack;
      return true;
    },
    async prepareMatchedEditorBlocks(english, translations, isCurrent = () => true, minimumLength = 0) {
      const englishSource = Array.from(english, text => String(text ?? ''));
      const translationSource = Array.from(translations, text => String(text ?? ''));
      const seeds = Array.from({ length: Math.max(englishSource.length, translationSource.length, minimumLength) }, (_, index) =>
        this.makeEditorBlock(englishSource[index] || '', translationSource[index] || ''));
      const pack = await this.prepareEditorDictionaryMatches(seeds, isCurrent);
      if (!isCurrent()) return null;
      if (!pack) return this.prepareMatchedEditorBlocks(englishSource, translationSource, isCurrent, minimumLength);
      const blocks = [];
      let started = Date.now();
      for (let index = 0; index < seeds.length; index++) {
        if (!isCurrent() || pack.scopeKey !== this.dictionaryWorkerScopeKey()) return null;
        if (pack.highlightDict !== !!this.highlightDict) return this.prepareMatchedEditorBlocks(englishSource, translationSource, isCurrent, minimumLength);
        blocks.push(this.makeEditorBlock(englishSource[index] || '', translationSource[index] || '', true, pack));
        if (Date.now() - started >= 4) { await this.yieldEditorWork(); started = Date.now(); }
      }
      if (!isCurrent() || pack.scopeKey !== this.dictionaryWorkerScopeKey()) return null;
      if (pack.highlightDict !== !!this.highlightDict) return this.prepareMatchedEditorBlocks(englishSource, translationSource, isCurrent, minimumLength);
      blocks.dictionaryPack = pack;
      return blocks;
    },
    scheduleMissingDictionaryMatches() {
      if (this._missingDictionaryMatchScheduled || !this.editorSessionActive || this.editorLoading || this.editorLoadError) return;
      this._missingDictionaryMatchScheduled = true;
      this.$nextTick(() => {
        this._missingDictionaryMatchScheduled = false;
        this.scheduleEditorHLterRefresh();
      });
    },
    getDictionaryEntryById(dictId) {
      // Resolve only the requested entry through Vue's array so v-model, notes,
      // and explicit Dictionary actions receive a live proxy, never the raw row.
      const position = this.dictionaryScopeView.positions.get(String(dictId));
      return position === undefined ? undefined : this.dictionary[position];
    },
    getLiveDictionaryEntry(entry) {
      // Keep exact identity even for imported entries awaiting ID normalization.
      const raw = Vue.toRaw ? Vue.toRaw(entry) : entry;
      const position = this.dictionaryScopeView.entryPositions.get(raw);
      return position === undefined ? entry : this.dictionary[position];
    },
    isDictionaryEntryActive(word) {
      if (!word) return false;
      return this.activeDictionaryIds
        ? this.activeDictionaryIds.has(String(word._id || ''))
        : this.getActiveDictionaryEntries().includes(word);
    },
    dictionaryEntryScope(word) {
      return window.DictionaryScope.normalize(word);
    },
    setDictionaryEntryScope(word, scope) {
      if (!word || !this.dictionary.includes(word)) return;
      this.beginDictionaryEdit(word._id);
      const normalized = window.DictionaryScope.normalize(scope);
      if (normalized === 'all') delete word.gameScope;
      else word.gameScope = normalized;
      this.invalidateEditorDictionaryIndex(word._id);
    },
    dictionaryEntryScopeWarning(word) {
      if (window.DictionaryScope.available(word, this.gameVersion)) return '';
      const entryGame = this.dictionaryEntryScope(word) === 'poe2' ? 'PoE2' : 'PoE1';
      const currentGame = this.gameVersion === 'poe2' ? 'PoE2' : 'PoE1';
      return `${entryGame} entry. Excluded from ${currentGame} matches, autocomplete, and regex.`;
    },
    findActiveDictionaryKeywordEntry(tagName) {
      const key = getKeywordPopupLookupName(tagName).toLowerCase();
      const entry = this.dictionaryScopeView.keywords.get(key)?.[0];
      return entry ? this.getLiveDictionaryEntry(entry) : undefined;
    },
    isDictionaryHighlightActive(highlight) {
      return !highlight?.dictId || !!this.getDictionaryAssistanceEntry(highlight.dictId);
    },
    isDictionaryEntryFound(word) {
      return this.foundDictionarySet?.has?.(word?._id) || false;
    },
    isDictionaryEntryFindMatched(word) {
      let id = word?._id;
      let find = String(word?.find ?? "").trim();
      if (!id || !find || !this.isDictionaryEntryActive(word)) return false;
      let set = this.foundDictionaryDefMap?.get?.(String(id));
      if (!set) return false;
      return set.has(find.toLowerCase());
    },
    isDictionaryAltFindMatched(word, alt) {
      let id = word?._id;
      let find = String(alt?.find ?? "").trim();
      if (!id || !find || !this.isDictionaryEntryActive(word)) return false;
      let set = this.foundDictionaryDefMap?.get?.(String(id));
      if (!set) return false;
      return set.has(find.toLowerCase());
    },
    sideAddClicked() {
      if (this.sideTab === 'regex') {
        this.addRegex();
        this.regexFilter = "";
      } else {
        this.dictionaryFilter = "";
        this.addVocab();
      }
    },
    beginDictionaryEdit(dictId, options = {}) {
      const id = String(dictId || '');
      if (!id || !this.dictionaryScopeView.positions.has(id)) return;
      if (!this.dictionaryEditOrder.length || options.newEntry) {
        const order = this.orderedDictionary.map(entry => String(entry?._id));
        this.dictionaryEditOrder = options.newEntry ? [id, ...order.filter(entryId => entryId !== id)] : order;
      }
      this.dictionaryEditingId = id;
    },
    endDictionaryEdit() {
      if (this.dictionaryEditOrder.length) this.dictionaryEditOrder = [];
      this.dictionaryEditingId = '';
    },
    dictionaryEntryFocusIn(event) {
      const id = event.target?.closest?.('.editBlock[data-dict-id]')?.getAttribute?.('data-dict-id');
      if (id) this.beginDictionaryEdit(id);
    },
    dictionaryEntryFocusOut(event) {
      const nextId = event?.relatedTarget?.closest?.('.editBlock[data-dict-id]')?.getAttribute?.('data-dict-id');
      if (nextId) {
        this.beginDictionaryEdit(nextId);
        return;
      }
      const editingId = this.dictionaryEditingId;
      // Find -> Replace -> Alternates -> TL note is one editing session.
      // Wait until the next field has focus before releasing the row order.
      return this.$nextTick(() => {
        if (editingId !== this.dictionaryEditingId) return;
        const id = document.activeElement?.closest?.('.editBlock[data-dict-id]')?.getAttribute?.('data-dict-id');
        if (id && (this.editorSessionActive ?? this.editorVisible) && this.sideTab === 'dictionary') this.beginDictionaryEdit(id);
        else this.endDictionaryEdit();
      });
    },
    invalidateEditorDictionaryIndex(dictId, options = {}) {
      this.markDictionarySnapshotDirty?.(dictId, options);
      this.scheduleDictionarySnapshot?.();
    },
    dictionaryMutationObserved() {
      this.editorDictionaryRevision = (this.editorDictionaryRevision || 0) + 1;
      this.scheduleSettingsSave();
      this.scheduleDictionaryDiagnosticScan();
    },
    dictionaryEntryInput(word) {
      this.markDictionarySnapshotDirty?.(word?._id);
    },
    getEditorDictionaryIndex() {
      // Compatibility accessor; ordinary rendering never constructs a trie.
      return this.getPreparedEditorDictionaryIndex();
    },
    async prepareEditorDictionaryIndex(isCurrent = () => true) {
      await this.ensureDictionarySnapshot();
      return isCurrent();
    },
    setDictionaryPage(page) {
      this.endDictionaryEdit();
      this.dictionaryPage = Math.max(1, Math.min(page, this.dictionaryPageCount));
      this.$nextTick(() => { const side = this.$refs.editorSide; if (side) side.scrollTop = 0; });
    },
    revealDictionaryEntry(dictId) {
      const dictionary = this.filteredDictionary;
      // The computed filtered view is stable while arrowing through suggestions.
      // Rebuild only when filtering, matches-first ordering, or membership changes.
      if (this._popupDictionaryPositionsSource !== dictionary) {
        const positions = new Map();
        dictionary.forEach((entry, index) => {
          const id = String(entry?._id);
          if (!positions.has(id)) positions.set(id, index);
        });
        this._popupDictionaryPositions = positions;
        this._popupDictionaryPositionsSource = dictionary;
      }
      const index = this._popupDictionaryPositions.get(String(dictId));
      if (index >= 0) this.dictionaryPage = Math.floor(index / this.dictionaryPageSize) + 1;
    },
    buildEnglishHLter(english, preparedPack = this.getEditorDictionaryMatchPack()) {
      const text = String(english ?? '');
      const pack = preparedPack;
      const unit = pack?.highlightDict === !!this.highlightDict ? pack.byEnglish.get(text) : null;
      let englishHLter = escapeHtml(text);
      // Rendering owns its array; the published matches stay immutable.
      const HLs = unit ? unit.HLs.map(highlight => ({ ...highlight })) : [];
      if (!unit) this.scheduleMissingDictionaryMatches();

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
      if (!this.editorSessionActive || this.editorLoading || this.editorLoadError) return;
      const focusedDictionaryId = document.activeElement?.closest?.('[data-dict-id]')?.getAttribute?.('data-dict-id');
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
              this.syncHlScroll('english', i, col);
              this.syncHlScroll('translation', i, col);
            }
          });
          continue;
        }
        let { englishHLter: baseEnglishHLter, HLs } = this.buildEnglishHLter(editorBlock.english);
        editorBlock.HLs = HLs;
        const diagnostics = this.refreshTranslationDiagnostics(editorBlock);
        this.$nextTick(() => {
          this.syncHlScroll('english', i);
          this.syncHlScroll('translation', i);
        });
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
      }
      if (focusedDictionaryId) this.revealDictionaryEntry(focusedDictionaryId);
      if (this.hlPopup.visible) {
        this.$nextTick(() => this.syncHlPopupEnglishHighlight());
      }
    },
    dictionaryEditorEnglishKey(blocks = this.editorBlocks) {
      return JSON.stringify((blocks || []).map(block => block.isTable
        ? (block.tableColumns || []).map(column => String(column.english ?? '')) : String(block.english ?? '')));
    },
    scheduleEditorHLterRefresh() {
      const run = this._editorDictionaryRefreshRun = (this._editorDictionaryRefreshRun || 0) + 1;
      if (this._hlterRefreshTimer) clearTimeout(this._hlterRefreshTimer);
      if (this._dictionaryAssistanceDisposed || !this.editorSessionActive || this.editorLoading || this.editorLoadError) return;
      this._hlterRefreshTimer = setTimeout(() => {
        this._hlterRefreshTimer = null;
        this._dictionaryRefreshPending = this.refreshEditorDictionaryHighlights(run);
      }, 0);
    },
    async refreshEditorDictionaryHighlights(run) {
      const blocks = this.editorBlocks, context = this.dictionaryEditorContext();
      const englishKey = this.dictionaryEditorEnglishKey(blocks);
      const isCurrent = () => !this._dictionaryAssistanceDisposed && this.editorSessionActive && !this.editorLoading
        && !this.editorLoadError && this.editorBlocks === blocks && this.dictionaryEditorContext() === context
        && this.dictionaryEditorEnglishKey(blocks) === englishKey;
      if (!isCurrent()) return false;
      try {
        const pack = await this.prepareEditorDictionaryMatches(blocks, isCurrent);
        if (!pack || !isCurrent()) return false;
        // A popup and its notes/actions keep one captured generation until close.
        if (this.hlPopup.visible) {
          if (!this._pendingDictionaryMatchPack || pack.generation >= this._pendingDictionaryMatchPack.pack.generation) {
            this._pendingDictionaryMatchPack = { pack, context, englishKey, blocks };
          }
          return true;
        }
        return this.applyDictionaryAssistancePack(pack, isCurrent);
      } catch (error) {
        console.error('Could not update Dictionary matches:', error);
        return false;
      }
    },
    applyDictionaryAssistancePack(pack, isCurrent = () => true) {
      if (!isCurrent() || !this.adoptEditorDictionaryMatchPack(pack)) return false;
      for (let index = 0; index < this.editorBlocks.length; index++) {
        const block = this.editorBlocks[index];
        const columns = block.isTable ? block.tableColumns || [] : [block];
        for (let columnIndex = 0; columnIndex < columns.length; columnIndex++) {
          const column = columns[columnIndex];
          const rendered = this.buildEnglishHLter(column.english, pack);
          column.HLs = rendered.HLs;
          column.englishHLter = column.isMultiline
            ? this.wrapHlterByLines(rendered.englishHLter, this.computeMultilineLineMismatch(column.english, column.translation).engMismatch)
            : rendered.englishHLter;
          this.$nextTick(() => {
            if (isCurrent()) this.syncHlScroll('english', index, block.isTable ? columnIndex : null);
          });
        }
      }
      return true;
    },
    /** Dictionary mutations publish assistance only after their replacement is ready. */
    syncEditorHlterWithDictionaryNow(dictId) {
      this.invalidateEditorDictionaryIndex(dictId);
      this._dictionaryRefreshPending = this.scheduleDictionarySnapshot({ immediate: true });
      return this._dictionaryRefreshPending;
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
            let tn = getKeywordPopupLookupName(unescapeHtml(hl.tagName || ""));
            matchCandidate = (dc || tn || "").trim();
          } else {
            matchCandidate = String(hl?.dictDefFind || hl?.find || "").trim();
          }
          let matchCandidateLower = matchCandidate.toLowerCase();
          let keywordTagNameLower = "";
          if (hl?.isKeywordPopup) {
            keywordTagNameLower = getKeywordPopupLookupName(unescapeHtml(hl.tagName || "")).toLowerCase();
          }

          let itemToAdds = [];
          let exactMatchItem = null;
          for (const dictId of uniqueDictIds) {
            let dictEntry = this.getDictionaryAssistanceEntry(dictId, true);
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
          
          // A scope change can leave old highlights visible until their refresh.
          // Do not turn a now-inactive definition into a create-alternative item.
          if (!exactMatchItem && itemToAdds.length === 0) continue;
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
      let viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
      let popupEl = this.$refs?.hlPopupPanel;
      let list = popupEl?.querySelector?.('.hlPopupList');
      let filterHeight = this.$refs?.hlPopupFilter?.getBoundingClientRect?.().height || 42;
      let popupHeight = Math.ceil(list ? Math.min(list.scrollHeight, viewportHeight * 0.4) + filterHeight + 24 : Math.min(360, Math.max(180, viewportHeight * 0.48)));
      let width = Math.min(Math.max(rect.width, 260), 640, Math.max(0, viewportWidth - margin * 2));
      let left = Math.max(margin, Math.min(rect.left, viewportWidth - width - margin));
      let hasNote = !!this.hlPopupTlnote;
      if (hasNote && this.inlineActive) {
        // Keep inline notes over the source column, reserving room to the left.
        let noteWidth = Math.min(320, Math.max(0, viewportWidth - margin * 2 - width - gap));
        if (noteWidth >= 220) left = Math.max(left, margin + noteWidth + gap);
      }
      let rightSpace = viewportWidth - left - width - gap - margin;
      let leftSpace = left - gap - margin;
      let noteOnLeft = this.inlineActive || rightSpace < 220;
      let noteSideSpace = noteOnLeft ? leftSpace : rightSpace;
      let stackNote = hasNote && noteSideSpace < 220;
      let noteMaxHeight = Math.min(stackNote ? 144 : 240, Math.max(0, viewportHeight - margin * 2) * 0.3);
      let noteSpace = stackNote ? noteMaxHeight + gap : 0;
      let groupHeight = popupHeight + noteSpace;

      let belowSpace = Math.max(0, viewportHeight - avoidBottom - gap - margin);
      let aboveSpace = Math.max(0, avoidTop - gap - margin);
      let placeAbove = belowSpace < groupHeight && aboveSpace > belowSpace;
      let available = placeAbove ? aboveSpace : belowSpace;
      let maxHeight = Math.min(Math.max(96, Math.min(popupHeight, (available || groupHeight) - noteSpace)), Math.max(0, viewportHeight - margin * 2 - noteSpace));
      let totalHeight = maxHeight + noteSpace;
      let top = placeAbove
        ? avoidTop - gap - totalHeight
        : avoidBottom + gap;

      if (top < margin) top = margin;
      if (viewportHeight && top + totalHeight > viewportHeight - margin) {
        top = Math.max(margin, viewportHeight - margin - totalHeight);
      }

      this.hlPopup.x = Math.round(left);
      this.hlPopup.y = Math.round(top);
      this.hlPopup.width = Math.round(width);
      this.hlPopup.maxHeight = Math.round(maxHeight);
      this.hlPopup.noteWidth = Math.round(stackNote ? width : Math.min(320, Math.max(0, noteSideSpace)));
      this.hlPopup.noteX = Math.round(stackNote ? left : noteOnLeft ? left - gap - this.hlPopup.noteWidth : left + width + gap);
      this.hlPopup.noteY = Math.round(stackNote ? top + maxHeight + gap : Math.max(margin, Math.min(top + filterHeight + 12, viewportHeight - margin - noteMaxHeight)));
      this.hlPopup.noteMaxHeight = Math.floor(noteMaxHeight);
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
      if (this.editorTranslationReadOnly) return;
      if (!this.editorSessionActive) return;
      if (editorIndex == null) editorIndex = this.editorFocusedIndex || 0;
      let columnIndex = Number.isInteger(options.columnIndex) ? options.columnIndex : (this.editorFocusedColumnIndex || 0);
      this.hlPopupReturnInfo = null;
      this.hlPopup.editorIndex = editorIndex;
      this.hlPopup.columnIndex = columnIndex;
      this.hlPopup.openedByBracket = !!options.openedByBracket;
      this.hlPopup.openedByChar = String(options.openedByChar || "");
      this.hlPopup.selectedTranslationText = this.getTranslationSelectionText(editorIndex, columnIndex);
      this._hlPopupDictionaryPack = this.getEditorDictionaryMatchPack();
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
      this._hlPopupDictionaryPack = null;
      const pending = this._pendingDictionaryMatchPack;
      this._pendingDictionaryMatchPack = null;
      if (pending && this.editorSessionActive && pending.context === this.dictionaryEditorContext()
        && pending.blocks === this.editorBlocks && pending.englishKey === this.dictionaryEditorEnglishKey()) {
        this.applyDictionaryAssistancePack(pending.pack);
      }
      if (options.refocus && this.editorSessionActive) {
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
      let tn = getKeywordPopupLookupName(tagName);
      if (!tn) return { dictId: "", created: false, addedAlt: false };
      let alt = String(altFind ?? "").trim();
      let replace = String(replaceText ?? "");

      this.sideTab = "dictionary";
      this.dictionaryFilter = "";

      let existing = this.findActiveDictionaryKeywordEntry(tn);
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
        this.syncEditorHlterWithDictionaryNow(existing._id);
        if (addedAlt && createdAltId) this.focusDictionaryEntryReplaceInput(existing._id, { altId: createdAltId });
        else this.focusDictionaryEntryReplaceInput(existing._id);
        return { dictId: existing._id || "", created: false, addedAlt };
      }

      let createdAltId = "";
      let entry = {
        _id: `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
        find: tn,
        gameScope: this.gameVersion === 'poe2' ? 'poe2' : 'poe1',
        replace: replace || tn,
        alts: alt ? [{ _id: (createdAltId = `a_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`), find: alt, replace: replace || tn }] : [],
        tlnote: ""
      };
      this.dictionary.unshift(entry);
      this.invalidateEditorDictionaryIndex(entry._id, { membership: true });
      this.beginDictionaryEdit(entry._id, { newEntry: true });
      this.dictionaryFlashId = entry._id;
      if (this._dictFlashTimer) clearTimeout(this._dictFlashTimer);
      this._dictFlashTimer = setTimeout(() => {
        if (this.dictionaryFlashId === entry._id) this.dictionaryFlashId = '';
      }, 320);
      this.syncEditorHlterWithDictionaryNow(entry._id);
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

      let existing = this.findActiveDictionaryKeywordEntry(tagNameLower);
      if (!existing) return true;
      if (!alt) return false;

      let pairs = this.getDictionaryDefinitionPairs(existing);
      if (pairs.some(p => String(p?.find || "").trim().toLowerCase() === alt.toLowerCase())) return false;
      return true;
    },
    canJumpToDictionaryFromHlPopupItem(item) {
      if (!item) return false;
      const entry = this.getDictionaryEntryById(item.dictEntryId);
      return this.isDictionaryEntryActive(entry) && (!item.dictAltId
        || (entry.alts || []).some(alt => String(alt?._id) === String(item.dictAltId)));
    },
    jumpToDictionaryFromHlPopupItem(item) {
      let dictId = String(item?.dictEntryId || "");
      if (!dictId) return false;
      let entry = this.getDictionaryEntryById(dictId);
      if (!entry || !this.isDictionaryEntryActive(entry)) return false;
      let altId = String(item?.dictAltId || "");
      if (altId && !(entry.alts || []).some(alt => String(alt?._id) === altId)) return false;
      let selectedText = String(this.hlPopup.selectedTranslationText ?? "");
      if (selectedText) {
        if (altId) {
          let alt = Array.isArray(entry.alts) ? entry.alts.find(a => String(a?._id) === altId) : null;
          if (alt) alt.replace = selectedText;
        } else {
          entry.replace = selectedText;
        }
        this.syncEditorHlterWithDictionaryNow(entry._id);
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
        let existing = this.findActiveDictionaryKeywordEntry(info.tagName);
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
    getHlPopupDictionaryRow(item) {
      const dictId = String(item?.dictEntryId || '');
      if (!dictId || !document?.querySelector) return null;
      const esc = value => window.CSS?.escape ? window.CSS.escape(String(value)) : String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const altId = String(item?.dictAltId || '');
      if (altId) {
        const altRow = document.querySelector(`.side .dictAltRow[data-dict-id="${esc(dictId)}"][data-dict-alt-id="${esc(altId)}"]`);
        if (altRow) return altRow;
      }
      return document.querySelector(`.side .dictRow[data-dict-id="${esc(dictId)}"]`);
    },
    scrollDictionaryEntryIntoView(row, options = {}) {
      const side = row?.closest?.('.side');
      if (!side?.getBoundingClientRect || !row?.getBoundingClientRect) return;
      const overflow = window.getComputedStyle?.(side)?.overflowY;
      if (!['auto', 'scroll'].includes(overflow) || side.scrollHeight <= side.clientHeight) {
        if (options.allowPageScroll) row.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
        return;
      }
      const sideRect = side.getBoundingClientRect();
      const headerRect = side.querySelector('.sideHeader')?.getBoundingClientRect();
      const top = Math.max(sideRect.top, headerRect?.bottom || sideRect.top) + 6;
      const bottom = Math.min(sideRect.bottom, window.innerHeight || sideRect.bottom) - 6;
      const block = row.closest('.editBlock');
      const blockRect = block?.getBoundingClientRect();
      const targetRect = blockRect && blockRect.height <= bottom - top ? blockRect : row.getBoundingClientRect();
      if (targetRect.top < top) side.scrollTop += targetRect.top - top;
      else if (targetRect.bottom > bottom) side.scrollTop += targetRect.bottom - bottom;
    },
    scrollHlPopupSelectionIntoView() {
      const panel = this.$refs?.hlPopupPanel;
      const list = panel?.querySelector?.('.hlPopupList');
      const item = panel?.querySelector?.('.hlPopupItem.active');
      if (!list?.getBoundingClientRect || !item?.getBoundingClientRect) return;
      const listRect = list.getBoundingClientRect();
      const itemRect = item.getBoundingClientRect();
      if (itemRect.top < listRect.top) list.scrollTop += itemRect.top - listRect.top;
      else if (itemRect.bottom > listRect.bottom) list.scrollTop += itemRect.bottom - listRect.bottom;
    },
    focusDictionaryEntryReplaceInput(dictId, options = {}) {
      if (!dictId) return;
      this.beginDictionaryEdit(dictId);
      let esc = (s) => {
        if (window?.CSS?.escape) return window.CSS.escape(String(s));
        return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      };
      this.$nextTick(() => {
        this.revealDictionaryEntry(dictId);
        this.$nextTick(() => {
          let altId = String(options?.altId || "");
          if (altId) {
            let altRow = document?.querySelector?.(`.side .dictAltRow[data-dict-id="${esc(dictId)}"][data-dict-alt-id="${esc(altId)}"]`);
            let altInput = altRow?.querySelector?.('input:nth-of-type(2)');
            this.scrollDictionaryEntryIntoView(altRow, { allowPageScroll: true });
            altInput?.focus?.({ preventScroll: true });
            altInput?.select?.();
            return;
          }

          let row = document?.querySelector?.(`.side .dictRow[data-dict-id="${esc(dictId)}"]`);
          let input = row?.querySelector?.('input:nth-of-type(2)');
          this.scrollDictionaryEntryIntoView(row, { allowPageScroll: true });
          input?.focus?.({ preventScroll: true });
          input?.select?.();
        });
      });
    },
    createDictionaryEntryFromHlPopupSelection() {
      let item = this.hlPopup.filtered?.[this.hlPopup.selectedIndex];
      if (!this.canCreateDictionaryEntryFromHlPopupItem(item)) return false;
      let info = this.getHlPopupKeywordInfo(item);
      if (!info) return false;

      let selectedText = String(this.hlPopup.selectedTranslationText ?? "");
      this.hlPopupReturnInfo = item;
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
      if (!this.editorSessionActive) return;

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

      let item = this.hlPopup.filtered?.[this.hlPopup.selectedIndex];
      if (!item) return;
      if (this.sideTab === 'dictionary' && item.dictEntryId) {
        const page = this.dictionaryPage;
        this.revealDictionaryEntry(item.dictEntryId);
        if (page !== this.dictionaryPage) {
          this.$nextTick(() => this.syncHlPopupEnglishHighlight());
          return;
        }
      }
      this.scrollHlPopupSelectionIntoView();

      let ids = Array.isArray(item.hlIds) ? item.hlIds : [];
      let idSet = new Set(ids.map(v => String(v)));
      let value = String(item.value ?? "");

      let esc = (s) => {
        if (window?.CSS?.escape) return window.CSS.escape(String(s));
        return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      };

      if (root?.querySelectorAll && idSet.size > 0) {
        for (const id of idSet) {
          let el = root.querySelector(`span[data-hl-id="${esc(id)}"]`);
          if (!el?.classList) continue;
          el.classList.add('hlPopupActive');
        }
      } else if (root?.querySelectorAll && value) {
        for (const el of root.querySelectorAll(`span[data-hl-id][dataValue="${esc(value)}"]`)) {
          el.classList.add('hlPopupActive');
        }
      }

      if (!document?.querySelector) return;

      const dictEl = this.getHlPopupDictionaryRow(item);
      if (dictEl?.classList) {
        dictEl.classList.add('hlPopupDictActive');
        this.scrollDictionaryEntryIntoView(dictEl);
      }
    },
    insertTranslationText(editorIndex, text, options = {}) {
      if (this.editorTranslationReadOnly) return;
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
      } else if (options.deleteOpeningChar && start > 0 && value[start - 1] === options.deleteOpeningChar) {
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
      if (item.dictEntryId && !this.getDictionaryAssistanceEntry(item.dictEntryId, true)) {
        this.closeHlPopup({ refocus: true });
        return;
      }
      this.scrollDictionaryEntryIntoView(this.getHlPopupDictionaryRow(item));
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
      if (this.isImeComposingEvent(e)) return;
      if (!this.hlPopupReturnInfo) return;
      const entryId = e.target?.closest?.('[data-dict-id]')?.getAttribute?.('data-dict-id');
      if (entryId && !this.isDictionaryEntryActive(this.dictionary.find(entry => String(entry?._id) === entryId))) return;
      // Consume Enter before moving focus, or its default edit can reach the translation textarea.
      e.preventDefault();
      let returnInfo = this.hlPopupReturnInfo;
      this.hlPopupReturnInfo = null;
      this.insertTranslationText(this.hlPopup.editorIndex, `[${returnInfo.kwTagName}|${e.target.value}]`, { deleteOpeningBracket: true, columnIndex: this.hlPopup.columnIndex || 0 });
    },
    isImeComposingEvent(e) {
      return !!e?.isComposing || e?.keyCode === 229;
    },
    queueCommittedAutocompleteTrigger(e, editorIndex, columnIndex = 0, options = {}) {
      if (this.editorTranslationReadOnly) return;
      if (!e || this.isImeComposingEvent(e)) return;
      if (e.type === "input") {
        if (e.isTrusted === false) return;
        let inputType = String(e.inputType || "");
        if (inputType !== "insertText" && inputType !== "insertCompositionText") return;
        if (e.data !== "[") return;
      } else if (e.type !== "compositionend") return;
      let committedChars = Array.from(String(e.data || ""));
      if (committedChars[committedChars.length - 1] !== "[") return;
      let compositionTarget = options.compositionTarget || e.target;
      setTimeout(() => {
        if (!this.editorSessionActive || this.hlPopup.visible) return;
        let editorBlock = this.editorBlocks?.[editorIndex];
        if (!editorBlock) return;
        let el = this.getEditorRef("translation", editorIndex, editorBlock.isTable ? columnIndex : null);
        if (!el || el !== compositionTarget || document.activeElement !== el) return;
        let caret = el.selectionStart;
        if (typeof caret !== "number" || caret < 1 || (el.value || "").slice(caret - 1, caret) !== "[") return;
        this.setEditorFocus(editorIndex, columnIndex);
        this.openHlPopup(editorIndex, { openedByBracket: true, openedByChar: "[", columnIndex });
      }, 0);
    },
    translationCompositionEnd(e, editorIndex, columnIndex = 0) {
      this.queueCommittedAutocompleteTrigger(e, editorIndex, columnIndex, { compositionTarget: e?.target });
    },
    translationKeydown(e, editorIndex, columnIndex = 0) {
      if (this.inlineTranslationKeydown?.(e)) return;
      if (this.editorTranslationReadOnly) return;
      if (this.isImeComposingEvent(e)) return;
      if ((e.key === "[" || e.key === "<") && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (!this.editorSessionActive) return;
        this.setEditorFocus(editorIndex, columnIndex);
        if (!this.hlPopup.visible) {
          setTimeout(() => {
            if (!this.hlPopup.visible) this.openHlPopup(editorIndex, { openedByBracket: e.key === "[", openedByChar: e.key, columnIndex });
          }, 0);
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
      if (this.isImeComposingEvent(e)) return;
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
      if (!this.editorSessionActive) return false;
      let el = document.activeElement;
      if (!el || typeof el.closest !== "function") return false;
      return !!el.closest(".editor .edit");
    },
    isActiveElementInSearchBox() {
      let el = document.activeElement;
      if (!el) return false;
      return [this.$refs.searchInput, this.$refs.dictionaryFilterInput, this.$refs.regexFilterInput, this.$refs.lookupSearchInput].includes(el);
    },
    focusSidebarFilterInput() {
      if (!this.editorSessionActive) return false;
      let ref = this.sideTab === "lookup" ? this.$refs.lookupSearchInput
        : this.sideTab === "regex" ? this.$refs.regexFilterInput : this.$refs.dictionaryFilterInput;
      if (!ref) return false;
      ref.focus?.();
      ref.select?.();
      return true;
    },
    isFilterFocusShortcut(e) {
      return !!e?.ctrlKey && e.code === (this.filterShortcutCtrlD ? "KeyD" : "KeyF");
    },
    openEditorLookup() {
      this.sideTab = 'lookup';
      this.$nextTick(() => this.lookupFocusSearch?.());
    },
    lookupPanelKeydown(e) {
      if (this.isImeComposingEvent(e)) return;
      if (this.isFilterFocusShortcut(e)) {
        e.preventDefault();
        this.lookupFocusSearch?.();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (this.lookupQuery) this.lookupClearSearch?.();
      } else if (((e.ctrlKey || e.metaKey) && e.code === 'KeyS')
        || e.code === 'F1' || e.code === 'F2') {
        // These editor shortcuts must not save or navigate from reference controls.
        e.preventDefault();
      }
    },
    isAutocompleteShortcut(e) {
      if (!e || this.autocompleteShortcut === "disabled") return false;
      if (!e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return false;
      if (this.autocompleteShortcut === "ctrl-space") {
        return e.code === "Space" || e.key === " ";
      }
      return this.autocompleteShortcut === "ctrl-i"
        && (e.code === "KeyI" || String(e.key || "").toLowerCase() === "i");
    },
    handleKeydown(e) {
      if (this.isImeComposingEvent(e)) return;
      if (e.defaultPrevented) return;
      if (window.AppDialogs?.isOpen) return;
      if (this.$refs.rawFileDialog?.open) {
        if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') e.preventDefault();
        return;
      }
      if (this.editorSessionActive && (this.editorLoading || this.editorLoadError)) {
        if (e.key === 'Escape') { e.preventDefault(); this.editorExit(); }
        else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') e.preventDefault();
        return;
      }
      if (this.collaborationConflictVisible || this.collaborationHistoryVisible) {
        if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') e.preventDefault();
        return;
      }
      if ((this.navigationBusy || this.editorSaving) && ['F1', 'F2', 'Comma', 'Period', 'KeyS'].includes(e.code)) { e.preventDefault(); return; }
      if (this.handleFileListKeydown(e)) return;
      if (this.consistencyResolver) {
        if (e.key === 'Escape') {
          e.preventDefault();
          this.closeConsistencyResolver();
        } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') e.preventDefault();
        return;
      }
      if (this.duplicateLangImportWarning && e.key === "Escape") {
        e.preventDefault();
        return;
      }
      if (this.importDialogVisible && e.key === "Escape") {
        e.preventDefault();
        this.closeImportDialog();
        return;
      }

      if (this.settingsDialogVisible) {
        // Cloud and settings-import overlays keep their own keyboard handling.
        const overlay = e.target?.closest?.('.cloudResolverBackdrop');
        if (overlay || this.cloudResolverVisible || this.cloudHistoryVisible || this.settingsImportDraft) return;
        if (e.key === 'Escape' || ((e.ctrlKey || e.metaKey) && e.code === 'KeyS')) {
          e.preventDefault();
          this.settingsSaveClose();
        }
        return;
      }

      // Ctrl + S: Save in editor or Export in table view
      if (e.ctrlKey && e.code === "KeyS") {
        e.preventDefault();
        if (this.inlineActive) { this.saveInlineDraft(); }
        else if (this.editorVisible) {
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

      if (this.isAutocompleteShortcut(e)) {
        if (!this.editorSessionActive) return;
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

      if (this.inlineActive && e.key === "Escape") { e.preventDefault(); this.finishInlineSession({ promote: false }); return; }
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
        if (this.editorSessionActive ?? this.editorVisible) {
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
    async saveAndSkipFile(reverse = false, noSaveIfNotChanged = false) {
      if (this.editorLoading || this.editorLoadError || this.navigationBusy || this.editorSaving || this.collaborationConflictVisible || this.collaborationHistoryVisible) return false;
      if (!this.editorVisible && this._fileSearchTimer != null) this.applyFileSearch();
      this.navigationBusy = true;
      const ctx = this.captureCollaborationContext?.();
      const cancelRevision = this._editorOpenCancelRevision || 0;
      const direction = reverse ? -1 : 1;
      const sortRows = () => this.filteredDescs.slice().sort((a, b) => {
        const modifier = this.currentSortDir === 'desc' ? -1 : 1;
        return a[this.currentSort] < b[this.currentSort] ? -modifier : a[this.currentSort] > b[this.currentSort] ? modifier : 0;
      });
      const ordered = sortRows();
      const hadEditor = this.editorSessionActive ?? this.editorVisible;
      const currentPath = this.editorCurrentEditingDesc?.filepath;
      const anchor = hadEditor ? ordered.findIndex(d => d.filepath === currentPath)
        : (this.currentPage - 1) * this.pageSize + (reverse ? this.descsDisplay.length - 1 : 0);
      const candidates = [];
      for (let i = hadEditor ? anchor + direction : anchor; i >= 0 && i < ordered.length; i += direction) candidates.push(ordered[i].filepath);
      const willSave = hadEditor && (!noSaveIfNotChanged || this.editorHaveChanges() || this._draftSession?.record);
      // Starting the old file's worker transaction first can lock IndexedDB's
      // draft store while the next file is claiming/preparing its editor.
      const releaseLocalSaves = willSave
        ? (!this.testMode ? this.initializePendingSaves?.() : this._pendingSaves)?.hold?.() : null;
      try {
        if (willSave && !await this.editorSave({ close: false, defer: true })) return false;
        if (ctx && !this.collaborationContextCurrent(ctx)) return false;
        for (const filepath of candidates) {
          if (this._collaboration?.isEditing(filepath)) continue;
          // Saving can remove the current row from the filter; keep its original anchor.
          const position = sortRows().findIndex(d => d.filepath === filepath);
          if (position < 0) continue;
          // Revisiting already queued work deliberately awaits that save; it
          // must be allowed to run before editFile enters its pending barrier.
          if (this.pendingDraftSaveFor?.(filepath)) releaseLocalSaves?.();
          const opened = await this.editFile(filepath, true, { automatic: true });
          if (cancelRevision !== (this._editorOpenCancelRevision || 0)) return false;
          if (opened === false) continue;
          this.currentPage = Math.floor(position / this.pageSize) + 1;
          this.selectedFilepath = filepath;
          this.collaborationNotice = '';
          if (releaseLocalSaves) await this.yieldEditorPaint();
          if ((ctx && !this.collaborationContextCurrent(ctx)) || cancelRevision !== (this._editorOpenCancelRevision || 0)) return false;
          return true;
        }
        this.collaborationNotice = 'No available files in this direction.';
        return false;
      } finally { releaseLocalSaves?.(); this.navigationBusy = false; }
    },
    showImportUpdateZipDialog() {
      this.$refs.importUpdateZipFile?.click?.();
    },
    importZipClicked() {
      if (this.managedImportZipDisabled) return;
      if ((this.inlineActive || this._inlineFinishing) && this.finishInlineSession) {
        return this.finishInlineSession({ promote: true }).then(done => done && this.importZipClicked());
      }
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
      const sourceImport = this.pendingDuplicateLangImport?.mode === 'update';
      this.duplicateLangImportWarning = null;
      this.pendingDuplicateLangImport = null;
      if (sourceImport) this.scheduleCollaboration?.();
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
      if (this._resetConfirming) return;
      this._resetConfirming = true;
      const game = this.gameVersion;
      const context = this.captureCollaborationContext?.();
      const workspace = this.localDescs;
      try {
        const ok = await this.confirmProceedByTypingYes(
          `This will DELETE your ${this.formatGameVersion(this.gameVersion)} translated workspace data and ${this.formatGameVersion(this.gameVersion)} revision history stored in this browser.\n\n` +
          "You will lose your working translated files and history for the selected version.\n\n" +
          "Type YES to proceed:",
          { confirmMessage: "Last warning: This cannot be undone. Proceed?" }
        );
        if (!ok) return;
        if (this.gameVersion !== game || this.localDescs !== workspace
          || (context && !this.collaborationContextCurrent(context))) return;
        if (this._pendingSaves?.snapshot().jobs.length && !await this.waitForPendingSaves()) return;
        if (this.gameVersion !== game || this.localDescs !== workspace
          || (context && !this.collaborationContextCurrent(context))) return;
        try {
          await window.OfflineStore?.clearWorkspace?.(game);
        } catch (_) {
        }
        try {
          await window.OfflineStore?.clearSource?.(game);
        } catch (_) {
        }
        try {
          await window.OfflineStore?.clearRevisions?.(game);
        } catch (_) {
        }
        location.reload();
      } finally { this._resetConfirming = false; }
    },

    async confirmProceedByTypingYes(message, { confirmMessage } = {}) {
      const typed = (await this.appPrompt(message, {
        title: 'Confirm potentially destructive action', requiredText: 'YES',
        confirmLabel: 'Continue', danger: true,
      }) || "").trim();
      if (typed !== "YES") return false;
      if (!await this.appConfirm(confirmMessage || "Last warning: Proceed?", {
        title: 'Last warning', confirmLabel: 'Proceed', danger: true,
      })) return false;
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
            content: Array.isArray(option?.content) ? option.content.slice() : [],
            variables: option.variables?.slice(), remarks: option.remarks?.slice()
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
    startDuplicateLangResolution(parsed, file, { mode, importMode, isPostMigrationImport, rawSource, identity, generation } = {}) {
      const groups = this.collectDuplicateLangGroups(parsed);
      if (groups.length === 0) return false;
      this.loadingProgress = this.sourceLoaded ? 100 : 0;
      this.pendingDuplicateLangImport = {
        mode,
        file,
        parsed,
        rawSource: rawSource || this.toPlainForStorage(parsed),
        identity,
        generation,
        context: this.captureCollaborationContext?.(),
        workspace: this.localDescs,
        source: this.descs,
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
          if (selected.variables) desc.variables = selected.variables.slice();
          if (selected.remarks) desc.remarks = selected.remarks.slice();
          desc.duplicateLangEntries = (desc.duplicateLangEntries || []).filter(entry => entry.lang !== 'English');
          desc.isDNT = window.StatDescCodec.computeIsDNT(desc.translations.English);
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
      if ((pending.context && !this.collaborationContextCurrent(pending.context)) || pending.workspace !== this.localDescs
        || pending.source !== this.descs || (pending.generation && pending.generation !== this._sourceImportGeneration)) {
        this.duplicateLangImportWarning = null; this.pendingDuplicateLangImport = null;
        this.collaborationNotice = 'The workspace changed while choosing import options. Import the ZIP again in the intended workspace.';
        return;
      }

      const decisions = pending.identity ? await this.importDecisionRecords(warning.groups) : [];
      if ((pending.context && !this.collaborationContextCurrent(pending.context)) || pending.workspace !== this.localDescs
        || pending.source !== this.descs || (pending.generation && pending.generation !== this._sourceImportGeneration)) return;

      this.applyDuplicateLangSelections(pending.parsed, warning.groups);
      this.duplicateLangImportWarning = null;
      this.pendingDuplicateLangImport = null;
      this.loadingProgress = 0.001;

      if (pending.mode === 'update') {
        await this.importUpdateZipFile(pending.file, pending.parsed, {
          isPostMigrationImport: pending.isPostMigrationImport, rawSource: pending.rawSource,
          identity: pending.identity, decisions, generation: pending.generation
        });
        return;
      }
      if (pending.mode === 'translated') {
        await this.importTranslatedZipFile(pending.file, pending.parsed);
      }
    },

    getImportRepairSummary(parsed) {
      const repairs = (parsed || []).flatMap(desc => desc?.importRepairs || []);
      if (!repairs.length) return '';
      const entries = repairs.length === 1 ? '1 quoted entry' : `${repairs.length} quoted entries`;
      const details = repairs.slice(0, 12).map(repair =>
        `${repair.filepath}:${repair.line}-${repair.endLine} (${repair.lang})`).join('\n');
      const more = repairs.length > 12 ? `\n... and ${repairs.length - 12} more` : '';
      return `Automatically repaired ${entries} with a closing quote on the following line.\n` +
        'The line breaks were preserved as \\n.\n\n' + details + more;
    },

    async importUpdateZipFile(file, resolvedParsed = null, options = {}) {
      if (this.flushEditorDraft && !await this.flushEditorDraft()) return;
      if (this._importingSource || this._reconcilingImport) return;
      if (!file) return;
      if (!offlineStoreReady) return;
      if (!this.lang) {
        this.appAlert('Please select a language in Settings first.');
        return;
      }

      if (options.generation && options.generation !== this._sourceImportGeneration) return;
      const generation = options.generation || (this._sourceImportGeneration = (this._sourceImportGeneration || 0) + 1);
      const requestedContext = this.captureCollaborationContext?.();
      const requestedWorkspace = this.localDescs, requestedSource = this.descs;
      const initialization = this.beginWorkspaceInitialization?.({ label: 'Importing source ZIP' });
      this._importingSource = true;
      try {
        // Finish durable local saves before retiring their collaboration client.
        // Suspend the old room before parsing: even a failed background join
        // must not change the context captured by this source import.
        if (this._pendingSaves?.snapshot().jobs.length && !await this.waitForPendingSaves()) return;
        const currentContext = this.captureCollaborationContext?.();
        if ((requestedContext && Object.entries(requestedContext).some(([key, value]) => key !== 'client' && value !== currentContext?.[key]))
          || this.localDescs !== requestedWorkspace || this.descs !== requestedSource) return;
        clearTimeout(this._collabStartTimer);
        this._collaboration?.disconnect(); this._collaboration = null; this._collabKey = '';
        this._collabFileIndexes = null;
        this.clearBrowserWork?.('collaboration');
        await this.performSourceZipImport(file, resolvedParsed, { ...options, generation, initialization });
      } finally {
        this._importingSource = false;
        if (generation === this._sourceImportGeneration) {
          this.importBaselineHashing = false;
          if (!this.versionStorageLoading && this.loadingProgress > 0 && this.loadingProgress < 100) {
            this.loadingProgress = this.sourceLoaded ? 100 : 0;
          }
        }
        try {
          if (generation === this._sourceImportGeneration && this.sourceLoaded && !this.pendingDuplicateLangImport && this.initializeCollaboration) {
            try { await this.initializeCollaboration(initialization); }
            catch (error) { if (generation === this._sourceImportGeneration) this.collaborationFailure?.(error); }
          }
          this.scheduleCollaboration?.();
        } finally { this.finishWorkspaceInitialization?.(initialization); }
      }
    },

    async performSourceZipImport(file, resolvedParsed, options) {
      const prepare = (label, callback) => this.runWorkspaceInitializationTask?.(label, callback, options.initialization) ?? callback();
      const isPostMigrationImport = typeof options.isPostMigrationImport === 'boolean' ? options.isPostMigrationImport : !!this.needsPostMigrationImport;
      const generation = options.generation;
      const importCurrent = () => generation === this._sourceImportGeneration;

      let parseContext = this.captureCollaborationContext?.();
      let parseWorkspace = this.localDescs, parseSource = this.descs;
      const parseCurrent = () => importCurrent() && (!parseContext || this.collaborationContextCurrent(parseContext))
        && this.localDescs === parseWorkspace && this.descs === parseSource;
      let parsed = resolvedParsed;
      let identity = options.identity || null;
      let acceptedArchive = options.acceptedArchive || null;
      let rawSource = options.rawSource || null;
      if (!parsed) {
        let zip;
        this.loadingProgress = 0.001;
        try {
          zip = await prepare('Opening source ZIP', () => new JSZip().loadAsync(file));
        } catch (error) {
          if (!parseCurrent()) return;
          this.loadingProgress = this.sourceLoaded ? 100 : 0;
          this.appAlert('Cannot open this file');
          return;
        }

        if (!parseCurrent()) return;
        const txtFileCount = this.countZipTxtFiles(zip);
        if (txtFileCount === 0) {
          this.loadingProgress = 100;
          this.appAlert('No .txt files found in this ZIP.');
          return;
        }
        if (!parseCurrent()) return;
        const detectedGameVersion = this.detectGameVersionFromZip(zip);
        if (txtFileCount >= ZIP_TXT_FILE_COUNT_THRESHOLD && detectedGameVersion && detectedGameVersion !== this.gameVersion) {
          const detectedLabel = this.formatGameVersion(detectedGameVersion);
          const currentLabel = this.formatGameVersion(this.gameVersion);
          const ok = await this.appConfirm(
            `This StatDescriptions.zip looks like ${detectedLabel}, but you are currently working in ${currentLabel}.\n\n` +
            `Switch to ${detectedLabel} and import it there?`
          );
          if (!ok) {
            this.loadingProgress = 100;
            return;
          }
          if (!parseCurrent()) return;
          await this.activateGameVersion(detectedGameVersion, { checkMigration: true });
          parseContext = this.captureCollaborationContext?.();
          parseWorkspace = this.localDescs; parseSource = this.descs;
          if (this.pendingSingleVersionMigration) {
            this.loadingProgress = 0;
            this.appAlert('Please finish or skip the migration before importing this ZIP.');
            return;
          }
          this.loadingProgress = 0.001;
        }
        if (txtFileCount < ZIP_TXT_FILE_COUNT_THRESHOLD) {
          const ok = await this.confirmProceedByTypingYes(
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

        if (!parseCurrent()) return;
        const parseFuncs = getZipTxtFilepaths(zip).map(filepath => parseFile(filepath, zip.files[filepath], this.lang, { strict: true }));

        try {
          parsed = await prepare('Parsing source descriptions', () => allProgress(parseFuncs, (p) => {
            if (!parseCurrent()) return;
            const percent = Math.max(0.001, Math.min(99.999, Number(p) || 0));
            this.loadingProgress = percent;
          }));
        } catch (error) {
          if (!parseCurrent()) return;
          this.loadingProgress = this.sourceLoaded ? 100 : 0;
          this.appAlert('Import aborted. ' + error.message);
          return;
        }
        if (!parseCurrent()) return;
        rawSource = this.toPlainForStorage(parsed);
        try {
          this.importBaselineHashing = true;
          identity = await this.readImportZipIdentity(file, zip);
          if (!parseCurrent()) return;
          acceptedArchive = await prepare('Checking published import choices', () => this.lookupImportArchive(identity));
          if (!parseCurrent()) return;
          if (acceptedArchive) parsed = await this.sourceWithImportDecisions(rawSource, acceptedArchive.decisions);
        } catch (error) {
          if (!parseCurrent()) return;
          this.loadingProgress = this.sourceLoaded ? 100 : 0;
          if (!error.stale) this.appAlert('Import aborted. ' + error.message);
          return;
        } finally { if (importCurrent()) this.importBaselineHashing = false; }
        if (!parseCurrent()) return;
        if (!acceptedArchive && this.startDuplicateLangResolution(parsed, file, { mode: 'update', importMode: 'Import Next Version',
          isPostMigrationImport, rawSource, identity, generation })) return;
      }
      let nextSource = parsed.filter(Boolean);
      if (!nextSource.length) { this.loadingProgress = this.sourceLoaded ? 100 : 0; this.appAlert('No valid source descriptions found.'); return; }
      const game = this.gameVersion, language = this.lang;
      const importContext = this.captureCollaborationContext?.();
      const importWorkspace = this.localDescs;
      const importSource = this.descs;
      const workspaceCurrent = () => importCurrent() && (!importContext || this.collaborationContextCurrent(importContext))
        && this.localDescs === importWorkspace && this.descs === importSource;
      let sourceHash;
      let importedBaseline = null;
      try {
        this.importBaselineHashing = !!identity;
        importedBaseline = await this.buildImportedBaseline(identity, rawSource || parsed, options.decisions || [], acceptedArchive);
        if (importedBaseline) { sourceHash = importedBaseline.archive.baselineId; nextSource = this.toPlainForStorage(importedBaseline.source); }
        else sourceHash = await window.CollaborationProtocol.sourceHash(nextSource);
      }
      catch (error) {
        if (!workspaceCurrent()) return;
        this.loadingProgress = this.sourceLoaded ? 100 : 0;
        this.appAlert('Import aborted. ' + error.message);
        return;
      }
      finally { if (importCurrent()) this.importBaselineHashing = false; }
      if (this._pendingSaves?.snapshot().jobs.length && !await this.waitForPendingSaves()) {
        this.loadingProgress = this.sourceLoaded ? 100 : 0;
        return;
      }
      if (this._reconcilingImport || !workspaceCurrent()) {
        this.loadingProgress = this.sourceLoaded ? 100 : 0;
        this.collaborationNotice = 'The workspace changed while importing. Import the source again in the intended workspace.';
        return;
      }
      const carryForward = this.beginWorkspaceInitializationTask?.('Carrying translations and preserved copies into the new source', options.initialization);
      const nextWorkspace = this.toPlainForStorage(this.localDescs);
      nextWorkspace.descs ||= []; nextWorkspace.status ||= {};
      const baselineSource = importedBaseline?.source || this.toPlainForStorage(nextSource);
      const prevSource = this.workspaceSource();
      window.WorkspaceState.upgradeSource(nextWorkspace, { previousSource: prevSource, source: baselineSource,
        previousSourceHash: this.sourceIdentity, sourceHash, game });
      if (importedBaseline) nextWorkspace.importArchive = importedBaseline.archive;
      else delete nextWorkspace.importArchive;
      const sourceRevisions = [];


      nextWorkspace.lastModified = file.lastModified;
      nextWorkspace.size = file.size;


      const prevSourceMap = new Map(prevSource.map(d => [d.filepath, d]));
      const baselineSourceMap = new Map(baselineSource.map(d => [d.filepath, d]));
      const nextSourceMap = new Map(nextSource.map(d => [d.filepath, d]));
      const oldWorkspaceMap = new Map((nextWorkspace.descs || []).map(d => [d.filepath, d]));
      const now = Date.now();

      for (const prev of prevSource) {
        if (!prev || !prev.filepath) continue;
        if (nextSourceMap.has(prev.filepath)) continue;
        const st = nextWorkspace.status[prev.filepath] || {};
        st.deletedAt = now;
        st.deleted = true;
        nextWorkspace.status[prev.filepath] = st;
      }

      for (const nextDesc of nextSource) {
        const filepath = nextDesc.filepath;
        const prevDesc = prevSourceMap.get(filepath);
        const prevEng = Array.isArray(prevDesc?.translations?.English) ? prevDesc.translations.English : [];
        const nextEng = Array.isArray(nextDesc?.translations?.English) ? nextDesc.translations.English : [];

        const oldLocal = oldWorkspaceMap.get(filepath);
        const state = window.WorkspaceState.workspaceFile(nextWorkspace,
          baselineSourceMap.get(filepath) || nextDesc, language);
        const merged = state.translations;

        if (!nextDesc.translations) nextDesc.translations = { English: nextEng };
        nextDesc.translations.English = nextEng;
        nextDesc.translations[language] = merged;

        nextDesc.isMissing = state.isMissing;
        nextDesc.needsReview = state.needsReview;
        nextDesc.isDropped = state.isDropped;
        nextDesc.isRevised = state.isRevised;
        const hasChanges = state.hasChanges;
        nextDesc.hasChanges = hasChanges;

        const st = nextWorkspace.status[filepath] || {};
        st.deleted = false;
        st.deletedAt = 0;
        st.lastImportedAt = now;
        window.WorkspaceState.setFileMetadata(st, language, { lastImportedAt: now }, oldLocal);
        if (prevDesc && !arrayEquals(prevEng, nextEng)) st.lastSourceAt = now;
        if (!prevDesc) st.lastSourceAt = now;
        nextWorkspace.status[filepath] = st;

        let localDesc = oldLocal;
        if (!localDesc) {
          localDesc = makeLocalDesc(nextDesc, language, merged, { derivedStatus: true });
          nextWorkspace.descs.push(localDesc);
          oldWorkspaceMap.set(nextDesc.filepath, localDesc);
        } else {
          updateLocalDesc(localDesc, nextDesc, language, merged, { derivedStatus: true });
        }

        if (!prevDesc || !arrayEquals(prevEng, nextEng)) {
          sourceRevisions.push({ filepath, filename: nextDesc.filename, filedir: nextDesc.filedir,
            lang: 'English', savedAt: now, note: prevDesc ? 'Source update' : 'Source import',
            isMissing: false, translations: nextEng, sourceHash });
        }
      }

      this.finishWorkspaceInitializationTask?.(carryForward);
      try {
        await prepare('Saving source, translations and recovery history', () => window.OfflineStore.saveSourceWorkspaceWithRevisions(this.toPlainForStorage(baselineSource), nextWorkspace, sourceRevisions, game, importedBaseline));
      } catch (error) {
        if (!workspaceCurrent()) return;
        this.loadingProgress = this.sourceLoaded ? 100 : 0;
        this.appAlert('Could not save the imported source. Existing work is unchanged. ' + error.message);
        return;
      }
      if (!workspaceCurrent()) return;
      this.localDescs = nextWorkspace;
      this.importBaseline = importedBaseline;
      this._workspaceSourceBaseline = baselineSource;
      this._workspaceBaselineIndex = null;
      this.sourceIdentity = sourceHash;
      this.descs = nextSource;
      this.sourceLoaded = true;
      this.clearDiagnosticScanResults();
      this.loadingProgress = 100;
      this.filterDesc();
      const repairSummary = this.getImportRepairSummary(parsed);
      if (repairSummary) this.appAlert('Source import completed.\n\n' + repairSummary);
    },

    async importTranslatedZipFile(file, resolvedParsed = null) {
      const initialization = this.beginWorkspaceInitialization?.({ label: 'Importing translated ZIP' });
      try { return await this.performTranslatedZipImport(file, resolvedParsed, initialization); }
      finally { this.finishWorkspaceInitialization?.(initialization); }
    },
    async performTranslatedZipImport(file, resolvedParsed = null, initialization) {
      const prepare = (label, callback) => this.runWorkspaceInitializationTask?.(label, callback, initialization) ?? callback();
      if (this._importingSource || this._reconcilingImport) return;
      if (this._pendingSaves?.snapshot().jobs.length && !await this.waitForPendingSaves()) return;
      if (this._importingSource || this._reconcilingImport) return;
      if (!file) return;
      if (!offlineStoreReady) return;
      if (!this.lang) {
        this.appAlert('Please select a language in Settings first.');
        return;
      }
      if (!this.sourceLoaded || !Array.isArray(this.descs) || this.descs.length === 0) {
        this.appAlert('Please import the latest StatDescriptions.zip first.');
        return;
      }
      const importContext = this.captureCollaborationContext?.();
      let parsed = resolvedParsed;
      if (!parsed) {
        if (String(file?.name || '').toLowerCase() !== 'statdescriptions_translated.zip') {
          if (!await this.appConfirm('This does not look like StatDescriptions_Translated.zip. Import anyway?', {
            title: 'Import an unexpected ZIP?', confirmLabel: 'Import anyway',
          })) return;
        }
        if (importContext && !this.collaborationContextCurrent(importContext)) return;

        this.loadingProgress = 0.001;

        let zip;
        try {
          zip = await prepare('Opening translated ZIP', () => new JSZip().loadAsync(file));
        } catch (error) {
          this.loadingProgress = 100;
          this.appAlert('Cannot open this file');
          return;
        }

        const txtFileCount = this.countZipTxtFiles(zip);
        if (txtFileCount === 0) {
          this.loadingProgress = 100;
          this.appAlert('No .txt files found in this ZIP.');
          return;
        }
        if (txtFileCount >= ZIP_TXT_FILE_COUNT_THRESHOLD) {
          const ok = await this.confirmProceedByTypingYes(
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

        if (importContext && !this.collaborationContextCurrent(importContext)) return;
        const parseFuncs = getZipTxtFilepaths(zip).map(filepath => parseFile(filepath, zip.files[filepath], this.lang, { strict: true }));

        try {
          parsed = await prepare('Parsing translated descriptions', () => allProgress(parseFuncs, (p) => {
            const percent = Math.max(0.001, Math.min(99.999, Number(p) || 0));
            this.loadingProgress = percent;
          }));
        } catch (error) {
          this.loadingProgress = this.sourceLoaded ? 100 : 0;
          this.appAlert('Import aborted. ' + error.message);
          return;
        }
        if (importContext && !this.collaborationContextCurrent(importContext)) return;
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
        if ((prev.name || '') !== (imported.name || '')) {
          mismatchFiles.push(`${imported.filepath}: description name differs`);
          continue;
        }
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
        this.appAlert(
          'Import aborted: source fields mismatch detected.\n\n' +
          head +
          more +
          '\n\nMake sure you imported the matching StatDescriptions.zip version before importing translations.'
        );
        return;
      }

      const updates = [];
      for (const imported of importedDescs) {
        const desc = sourceMap.get(imported.filepath);
        const lines = [...imported.translations[this.lang]];
        if (!arrayEquals(desc.translations[this.lang] || [], lines) || lines.some(value => String(value).trim())) {
          updates.push({ desc, lines, needsReview: false });
        }
      }
      const repairSummary = this.getImportRepairSummary(parsed);
      if (!updates.length) {
        this.loadingProgress = 100;
        this.appAlert('No translation changes detected.' + (repairSummary ? '\n\n' + repairSummary : ''));
        return;
      }
      try {
        const result = await prepare('Saving imported translations and recovery history', () => this.persistTranslationBatch(updates, 'import'));
        if (result.stale) return;
        this.loadingProgress = 100;
        this.clearDiagnosticScanResults();
        this.filterDesc();
        if (result.status !== 'conflict') this.collaborationNotice = 'Imported ' + updates.length + ' translated files' + (result.status === 'pending' ? ' · Pending sync' : '.');
        if (repairSummary) this.appAlert(repairSummary);
      } catch (error) {
        this.loadingProgress = 100;
        this.appAlert('Could not save imported translations. Existing work is unchanged. ' + error.message);
      }
    },
    // Overlay staged text on the immutable ZIP baseline. Status fields on these
    // visible descriptions are caches derived from text and unresolved copies.
    applyWorkspaceOverlay({ filepaths } = {}) {
      window.WorkspaceState.initializeWorkspace(this.localDescs, { source: this.workspaceSource(),
        sourceHash: this.sourceIdentity, game: this.gameVersion, language: this.lang });
      const rows = filepaths ? filepaths.map(path => this.collaborationFileIndexes().descriptions.get(path)).filter(Boolean) : this.descs || [];
      let translationsChanged = false;
      for (const desc of rows) {
        const state = window.WorkspaceState.workspaceFile(this.localDescs, this.workspaceSourceFile(desc.filepath) || desc, this.lang);
        if (!desc.translations) desc.translations = { English: [] };
        desc.isDNT = window.StatDescCodec.computeIsDNT(desc.translations.English);
        if (!arrayEquals(desc.translations[this.lang], state.translations)) {
          desc.translations[this.lang] = [...state.translations]; translationsChanged = true;
        }
        desc.hasChanges = state.hasChanges;
        desc.isRevised = state.isRevised;
        desc.isMissing = state.isMissing;
        desc.isDropped = state.isDropped;
        desc.needsReview = state.needsReview;
      }
      // A full workspace replacement can change saved reference languages
      // without changing the selected language's visible overlay.
      if (!filepaths || translationsChanged) this.invalidateEditorLookupIndex?.();
    },
    selectAllFileFilters() {
      this.selectedFileFilters = this.fileFilterOptions.map(option => option.key);
    },
    syncFileSelection() {
      const rows = this.descsDisplay;
      if (rows.some(row => row.filepath === this.selectedFilepath)) return;
      const active = document.activeElement;
      const listHadFocus = active === this.$refs.fileTableRegion
        || (active?.matches?.('tr[data-filepath]') && this.$refs.fileTableRegion?.contains(active));
      this.selectedFilepath = rows[0]?.filepath || '';
      if (listHadFocus && !this.editorVisible) this.focusSelectedFileRow();
    },
    fileListNavigationBlocked() {
      const region = this.$refs.fileTableRegion;
      return !region || (region.getClientRects && !region.getClientRects().length)
        || window.AppDialogs?.isOpen
        || this.editorVisible || this.settingsDialogVisible || this.$refs.diagnosticScanDialog?.open
        || this.importDialogVisible || this.consistencyResolver || this.cloudResolverVisible
        || this.cloudHistoryVisible || this.duplicateLangImportWarning || this.showMultiInstanceGate
        || this.settingsImportDraft || this.pendingSingleVersionMigration
        || this.collaborationConflictVisible || this.collaborationHistoryVisible;
    },
    selectFileRow(filepath, focus = false) {
      if (!this.descsDisplay.some(row => row.filepath === filepath)) return;
      this.selectedFilepath = filepath;
      if (focus) this.focusSelectedFileRow();
    },
    openFileRow(filepath) {
      if (!this.descsDisplay.some(row => row.filepath === filepath)) return;
      this.selectFileRow(filepath);
      if (this.inlineEditor && this.activateInlineRow) return this.activateInlineRow(filepath);
      this.editFile(filepath, true);
    },
    focusSelectedFileRow(moveFocus = true) {
      this.$nextTick(() => {
        if (this.fileListNavigationBlocked()) return;
        const region = this.$refs.fileTableRegion;
        const row = Array.from(region?.querySelectorAll('tr[data-filepath]') || [])
          .find(element => element.dataset.filepath === this.selectedFilepath);
        if (!row) {
          if (moveFocus) region?.focus({ preventScroll: true });
          return;
        }
        if (moveFocus) row.focus({ preventScroll: true });
        row.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
        // Keep keyboard selection clear of both sticky navigation surfaces.
        const bounds = row.getBoundingClientRect?.();
        if (!bounds) return;
        const top = (document.querySelector('.workspaceHeader')?.getBoundingClientRect().bottom || 0) + 8;
        const bottom = (document.querySelector('.workspaceFooter')?.getBoundingClientRect().top || window.innerHeight) - 8;
        const delta = bounds.top < top || bounds.height > bottom - top
          ? bounds.top - top : bounds.bottom > bottom ? bounds.bottom - bottom : 0;
        if (delta) window.scrollBy({ top: delta, behavior: 'instant' });
      });
    },
    fileTableFocused() {
      this.syncFileSelection();
      if (this.selectedFilepath) this.focusSelectedFileRow();
    },
    isFileNavigationInput(target) {
      return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName)
        || target?.isContentEditable
        || !!target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="spinbutton"], [role="slider"]');
    },
    fileNavigationIndex(key, index, count) {
      if (key === 'Home') return 0;
      if (key === 'End') return count - 1;
      const step = { ArrowUp: -1, ArrowDown: 1, PageUp: -10, PageDown: 10 }[key] || 0;
      return Math.max(0, Math.min(count - 1, index + step));
    },
    handleFileListKeydown(event) {
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)
        || event.defaultPrevented || this.isImeComposingEvent(event)
        || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
        || this.fileListNavigationBlocked()) return false;
      const target = event.target;
      const region = this.$refs.fileTableRegion;
      const isRow = target?.matches?.('tr[data-filepath]') || target?.closest?.('tr[data-filepath]');
      if (target === region || (isRow && region.contains(target))) {
        this.fileTableKeydown(event);
        return event.defaultPrevented;
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') return false;
      const isSearchArrow = target === this.$refs.searchInput && ['ArrowUp', 'ArrowDown'].includes(event.key);
      // Search may hand focus to the list; other editable and selection controls
      // keep their native arrow behavior, even while the workspace is visible.
      if ((!isSearchArrow && this.isFileNavigationInput(target))
        || target?.closest?.('.fileFilters, [role="tablist"], [role="menu"], [role="listbox"]')) return false;
      if (isSearchArrow && this._fileSearchTimer != null) this.applyFileSearch();
      const rows = this.descsDisplay;
      if (!rows.length) return false;
      let index = Math.max(0, rows.findIndex(row => row.filepath === this.selectedFilepath));
      if (isSearchArrow && event.key === 'ArrowDown') index = 0;
      else if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
        index = this.fileNavigationIndex(event.key, index, rows.length);
      }
      event.preventDefault();
      event.stopPropagation();
      this.selectFileRow(rows[index].filepath, true);
      return true;
    },
    fileTableKeydown(event) {
      const region = this.$refs.fileTableRegion;
      const target = event.target;
      const row = target?.matches?.('tr[data-filepath]') ? target : target?.closest?.('tr[data-filepath]');
      const isRow = row && region?.contains(target);
      if (event.defaultPrevented || (target !== region && !isRow) || this.isImeComposingEvent(event)
        || this.fileListNavigationBlocked() || this.isFileNavigationInput(target)) return;
      if (this.inlineEditor && event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
        && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        this.moveInlineFile(event.key === 'ArrowUp' ? -1 : 1, row?.dataset?.filepath || this.selectedFilepath);
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Enter'].includes(event.key)) return;
      if (event.key === 'Enter' && target !== region && target !== row) return;
      const rows = this.descsDisplay;
      if (!rows.length) return;
      event.preventDefault();
      event.stopPropagation();
      let index = rows.findIndex(row => row.filepath === this.selectedFilepath);
      if (index < 0) index = 0;
      if (event.key === 'Enter') {
        this.selectFileRow(rows[index].filepath);
        if (this.inlineActive && this.openInlineFullEditor) this.openInlineFullEditor(rows[index].filepath);
        else this.editFile(rows[index].filepath);
        return;
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        this.gotoPage(this.currentPage + (event.key === 'ArrowLeft' ? -1 : 1));
        this.focusSelectedFileRow();
        return;
      }
      index = this.fileNavigationIndex(event.key, index, rows.length);
      this.selectFileRow(rows[index].filepath, true);
    },
    closeFileFilters() {
      this.fileFiltersVisible = false;
      this.$refs.fileFiltersButton?.focus();
    },
    resetFileSearch() {
      clearTimeout(this._fileSearchTimer);
      this._fileSearchTimer = null;
      this._fileSearchComposing = false;
      this.searchText = '';
      this.selectedFileFilters = ['missing', 'saved', 'revised', 'dropped', 'diagnosticError', 'diagnosticWarning', 'localDraft'];
      this.currentPage = 1;
      this.filterDesc();
    },
    fileSearchChanged(event) {
      clearTimeout(this._fileSearchTimer);
      this._fileSearchTimer = null;
      this._fileSearchComposing = this.isImeComposingEvent(event) || !!event?.target?.composing;
      if (this._fileSearchComposing) return;
      if (!this.searchText.trim()) {
        this.applyFileSearch();
        return;
      }
      this._fileSearchTimer = setTimeout(() => this.applyFileSearch(), FILE_SEARCH_DELAY);
    },
    applyFileSearch(event) {
      if (this.inlineActive && !this.inlineTransitionBusy) {
        this.finishInlineSession({ promote: true }).then(ok => { if (ok) this.applyFileSearch(event); });
        return;
      }
      if (this._fileSearchComposing || this.isImeComposingEvent(event) || event?.target?.composing) return;
      clearTimeout(this._fileSearchTimer);
      this._fileSearchTimer = null;
      this.currentPage = 1;
      this.filterDesc({ searchOnly: true });
    },
    clearFileSearch() {
      this._fileSearchComposing = false;
      this.searchText = '';
      this.fileSearchChanged();
      this.$refs.searchInput?.focus();
    },
    renderFileListLines(lines) {
      const source = Vue.toRaw ? Vue.toRaw(lines) : lines;
      const cache = this._fileListLineCache ||= Vue.markRaw ? Vue.markRaw(new WeakMap()) : new WeakMap();
      const cached = cache.get(source);
      // Check the content as well as the array identity: imported/repaired text
      // and callers editing an array in place must never reuse stale HTML.
      if (cached && arrayEquals(cached.lines, source)) return cached.html;
      const html = source.map(line => escapeHtml(String(line ?? ''))).join('<br />').replaceAll('\\n', '<br />');
      cache.set(source, { lines: [...source], html });
      return html;
    },
    filterDesc({ searchOnly = false, changedFilepaths = null, draftOnly = false } = {}) {
      const hideDNT = this.hideDNT;
      const lang = this.lang;
      const selectedFilters = this.selectedFileFilters.map(key => key === 'review' ? 'dropped' : key === 'edited' ? 'revised' : key);
      if (this.selectedFileFilters.some(key => key === 'review' || key === 'edited')) this.selectedFileFilters = [...new Set(selectedFilters)];
      // Data refreshes keep the settled query while the user is still typing.
      const query = this._fileSearchTimer != null || this._fileSearchComposing ? (this._fileSearchAppliedText || '') : this.searchText;
      const search = query.toLocaleLowerCase();
      const hasSearch = !!search.trim();
      const diagnosticResults = this.diagnosticScanResults;
      const descs = Vue.toRaw ? Vue.toRaw(this.descs) : this.descs;
      const workspace = Vue.toRaw ? Vue.toRaw(this.localDescs) : this.localDescs;
      const account = this._cloud?.context?.().profile || this.cloudProfileId || this.cloudUser?.id || 'guest';
      const branch = this.branchId || 'default';
      const filters = selectedFilters.join(',');
      const droppedReviewPaths = new Set(this.collaborationDroppedReviewPaths || []);
      const droppedReviewSignature = JSON.stringify([...droppedReviewPaths].sort());
      const showDroppedConflicts = selectedFilters.includes('droppedConflict');
      let snapshot = this._fileSearchSnapshot;
      const sameScope = snapshot && snapshot.descs === descs && snapshot.workspace === workspace
        && snapshot.sourceLength === descs.length
        && snapshot.lang === lang && snapshot.game === this.gameVersion && snapshot.source === this.sourceIdentity
        && snapshot.account === account && snapshot.branch === branch
        && snapshot.hideDNT === hideDNT && snapshot.filters === filters
        && snapshot.droppedReviewSignature === droppedReviewSignature;
      const canPatch = sameScope && snapshot.diagnostics === diagnosticResults && Array.isArray(changedFilepaths) && snapshot.files
        && changedFilepaths.every(filepath => {
          const cached = snapshot.files.get(filepath);
          return cached && descs[cached.order] === cached.desc;
        });
      if (canPatch || !searchOnly || !sameScope || snapshot.diagnostics !== diagnosticResults) {
        if (!draftOnly || !canPatch) this.invalidateEditorLookupIndex?.();
        const entries = canPatch ? snapshot.entries : [];
        const files = canPatch ? snapshot.files : new Map();
        const counts = canPatch ? { ...snapshot.counts } : { hasChanges: 0, isRevised: 0, isMissing: 0, isDropped: 0 };
        // Read raw data once and prepare a replaced display/search snapshot.
        // Typing then only searches strings, without recalculating statuses,
        // copying translation arrays, escaping HTML, or invalidating Lookup.
        const prepare = (desc, order) => {
          const hiddenDNT = hideDNT && desc.isDNT;
          const record = { desc, order, counts: {}, entry: null };
          if (hiddenDNT && !(showDroppedConflicts && droppedReviewPaths.has(desc.filepath))) return record;
          const baseline = workspace?.stagedVersion >= 1 ? this.workspaceSourceFile?.(desc.filepath) : null;
          const state = baseline ? window.WorkspaceState.workspaceFile(workspace, baseline, lang) : desc;
          if (!hiddenDNT) {
            for (const field of Object.keys(counts)) record.counts[field] = !!state[field];
          }

          const diagnosticResult = diagnosticResults?.[desc.filepath] || null;
          const statuses = {
            localDraft: !!this.inlineDraftRows?.[desc.filepath],
            missing: !!state.isMissing,
            saved: !!state.hasChanges,
            revised: !!state.isRevised,
            dropped: !!state.isDropped,
            droppedConflict: droppedReviewPaths.has(desc.filepath),
            unchanged: !state.isMissing && !state.hasChanges && !state.isDropped,
            diagnosticError: !!diagnosticResult?.hasDiagnosticError,
            diagnosticWarning: !!diagnosticResult?.hasDiagnosticWarning,
          };
          if (!selectedFilters.some(key => statuses[key])) return record;

          const english = desc.translations.English || [];
          const translation = desc.translations[lang] || [];
          record.entry = {
            order,
            path: desc.filepath.toLocaleLowerCase(),
            english: english.join('\n').toLocaleLowerCase(),
            translation: [...translation, ...(this.inlineDraftRows?.[desc.filepath]?.translations || [])].join('\n').toLocaleLowerCase(),
            row: {
              filepath: desc.filepath,
              filedir: desc.filedir,
              filename: desc.filename,
              english: this.renderFileListLines(english),
              translation: this.renderFileListLines(translation),
              isMissing: !!state.isMissing,
              hasChanges: !!state.hasChanges,
              isRevised: !!state.isRevised,
              isDropped: !!state.isDropped,
              hasDiagnosticWarning: !!diagnosticResult?.hasDiagnosticWarning,
              hasDiagnosticError: !!diagnosticResult?.hasDiagnosticError,
              diagnosticWarningCount: Number(diagnosticResult?.warningCount || 0),
              diagnosticErrorCount: Number(diagnosticResult?.errorCount || 0),
              diagnosticScanTitle: this.getDiagnosticScanTitle(diagnosticResult),
            },
          };
          return record;
        };
        const addCounts = (record, direction) => {
          for (const field of Object.keys(counts)) if (record.counts[field]) counts[field] += direction;
        };
        if (canPatch) {
          // Saves and draft acknowledgements replace only their affected rows.
          // Keep source order when a changed status enters or leaves the filters.
          for (const filepath of new Set(changedFilepaths)) {
            const previous = files.get(filepath);
            const record = prepare(previous.desc, previous.order);
            let low = 0, high = entries.length;
            while (low < high) {
              const middle = (low + high) >>> 1;
              if (entries[middle].order < record.order) low = middle + 1;
              else high = middle;
            }
            const existing = entries[low]?.order === record.order;
            if (existing || record.entry) entries.splice(low, existing ? 1 : 0, ...(record.entry ? [record.entry] : []));
            addCounts(previous, -1); addCounts(record, 1);
            files.set(filepath, record);
          }
        } else {
          for (let order = 0; order < descs.length; order++) {
            const record = prepare(descs[order], order);
            files.set(record.desc.filepath, record); addCounts(record, 1);
            if (record.entry) entries.push(record.entry);
          }
        }
        snapshot = { descs, workspace, lang, game: this.gameVersion, source: this.sourceIdentity,
          account, branch, sourceLength: descs.length, hideDNT, filters, diagnostics: diagnosticResults, droppedReviewSignature, entries, files, counts };
        this._fileSearchSnapshot = Vue.markRaw ? Vue.markRaw(snapshot) : snapshot;
        Object.assign(this.statistic, counts);
      }
      const filtered = [];
      for (const entry of snapshot.entries) {
        if (!hasSearch || entry.path.includes(search) || entry.english.includes(search) || entry.translation.includes(search)) filtered.push(entry.row);
      }
      this._fileSearchAppliedText = query;
      // Rows are a replaced display snapshot. Tracking every field of 20,000
      // derived rows makes the next render expensive even for a one-file save.
      this.filteredDescs = Vue.markRaw ? Vue.markRaw(filtered) : filtered;
      Vue.nextTick(() => {
        if (this.currentPage > this.pageCount) this.gotoPage(1);
        if (this.currentPage < 1) this.gotoPage(1);
      });
    },
    sort(s) {
      if (this.inlineActive && !this.inlineTransitionBusy) return this.finishInlineSession({ promote: true }).then(ok => { if (ok) this.sort(s); });
      //if s == current sort, reverse
      if (s === this.currentSort) {
        this.currentSortDir = this.currentSortDir === 'asc' ? 'desc' : 'asc';
      }
      this.currentSort = s;
    },
    gotoPage(n) {
      if (this.inlineActive && !this.inlineTransitionBusy) return this.finishInlineSession({ promote: true }).then(ok => { if (ok) this.gotoPage(n); });
      const page = Number(n);
      const next = Math.max(1, Math.min(this.pageCount, Number.isFinite(page) ? Math.trunc(page) : 1));
      if (next === this.currentPage) return;
      const previous = this.currentPage;
      const active = document.activeElement;
      const region = this.$refs.fileTableRegion;
      const listHadFocus = !!region && (active === region || (active?.closest?.('tr[data-filepath]') && region.contains(active))
        || (active?.matches?.('tr[data-filepath]') && region.contains(active)));
      this.currentPage = next;
      const rows = this.descsDisplay;
      this.selectedFilepath = (next > previous ? rows[0] : rows[rows.length - 1])?.filepath || '';
      this.focusSelectedFileRow(listHadFocus);
    },
    prevPage() {
      this.gotoPage(this.currentPage - 1);
    },
    nextPage() {
      this.gotoPage(this.currentPage + 1);
    },
    elipsisRenderer(data) {
      return data.length > 20 ?
        data.substr(0, 7) + '…' + data.substr(data.length - 13, data.length) :
        data;
    },
    getDescByFilepath(filepath) {
      // Source filepaths are immutable; imports replace this array. Index the
      // raw corpus once so rendering does not subscribe to every file's path.
      // Return the selected proxy, keeping edits and peer updates reactive.
      const source = Vue.toRaw ? Vue.toRaw(this.descs) : this.descs;
      let cache = this._descFilepathIndex;
      const key = String(filepath);
      if (!cache || cache.source !== source || cache.length !== source.length
        || (cache.paths.has(key) && String(source[cache.paths.get(key)]?.filepath) !== key)) {
        const paths = new Map();
        for (let i = 0; i < source.length; i++) {
          const path = String(source[i].filepath);
          if (!paths.has(path)) paths.set(path, i);
        }
        cache = { source, length: source.length, paths };
        this._descFilepathIndex = Vue.markRaw ? Vue.markRaw(cache) : cache;
      }
      const index = cache.paths.get(key);
      return index === undefined ? undefined : this.descs[index];
    },
    async commentsOpenFile(filepath) {
      if (this.editorLoading || this.navigationBusy || this.editorSaving || !this.getDescByFilepath(filepath)) return;
      const context = this.captureCollaborationContext();
      this.navigationBusy = true;
      try {
        if (this.flushEditorDraft) { if (!await this.flushEditorDraft()) return; }
        else if (this.editorVisible && this.editorHaveChanges() && !await this.editorSave({ close: false })) return;
        if (!this.collaborationContextCurrent(context)) return;
        const opened = this.inlineEditor && !this.editorVisible && this.activateInlineRow
          ? await this.activateInlineRow(filepath) : await this.editFile(filepath, true);
        if (opened === false || !this.collaborationContextCurrent(context)) return;
        this.commentsAllVisible = false;
        this.sideTab = 'comments';
        await this.$nextTick();
        this.$refs.commentsFileList?.focus();
      } finally { this.navigationBusy = false; }
    },
    editFile(filepath, returnToFileList = false, options = {}) {
      if (this.pendingDraftSaveFor?.(filepath)) {
        const context = this.captureCollaborationContext();
        const cancelRevision = this._editorOpenCancelRevision || 0;
        const openRun = this._editorOpenRun;
        // Only revisiting the queued file needs its committed base and consumed
        // draft. Opening another file can proceed while its transaction runs.
        return this.waitForPendingSaves().then(ok => ok && this.collaborationContextCurrent(context)
          && cancelRevision === (this._editorOpenCancelRevision || 0)
          && openRun === this._editorOpenRun
          ? this.editFile(filepath, returnToFileList, options) : false);
      }
      if (!options.endedAcknowledged && this.managedWarnBeforeEdit && (this.managedActiveTeam?.ended || this.managedActiveVersion?.status === 'withdrawn')) {
        const context = this.captureCollaborationContext();
        return this.managedWarnBeforeEdit().then(ok => ok && this.collaborationContextCurrent(context)
          ? this.editFile(filepath, returnToFileList, { ...options, endedAcknowledged: true }) : false);
      }
      if (this.inlineActive && !options.inline && this.editorCurrentEditingDesc?.filepath === filepath && !this._nextEditorSurface && !this.editorLoadError) return this.openInlineFullEditor(filepath);
      if (this._draftSession && this.editorCurrentEditingDesc?.filepath !== filepath && !options.draftFlushed) {
        return this.flushEditorDraft().then(ok => ok ? this.editFile(filepath, returnToFileList, { ...options, draftFlushed: true }) : false);
      }
      if (!this._collaboration) {
        this._editorCollabBase = undefined;
        return this.openEditorFile(filepath, returnToFileList);
      }
      return this.openClaimedEditorFile(filepath, returnToFileList, options);
    },
    async openClaimedEditorFile(filepath, returnToFileList, options = {}) {
      if (this._openingFile) return false;
      const request = this.beginEditorOpen(filepath, returnToFileList);
      if (!request) return false;
      this._openingFile = request.run;
      // Serialize claims so a cancelled response cannot release a newer file.
      const previousClaim = this._editorClaimPending;
      let releaseClaim;
      this._editorClaimPending = new Promise(resolve => { releaseClaim = resolve; });
      const ctx = this.captureCollaborationContext();
      const client = this._collaboration;
      const editorCurrent = request.isCurrent;
      request.isCurrent = () => editorCurrent() && this.collaborationContextCurrent(ctx);
      try {
        await this.yieldEditorPaint();
        if (previousClaim) await previousClaim;
        if (!request.isCurrent()) return false;
        if (!await this.claimCollaborationFile(filepath, !!options.automatic, request.isCurrent)) {
          if (request.isCurrent()) this.cancelEditorOpen();
          return false;
        }
        if (!request.isCurrent() || !this.collaborationContextCurrent(ctx)) {
          client?.leaveEdit();
          if (this._editorOpenRun === request.run) this.cancelEditorOpen();
          return false;
        }
        this._editorCollabBase = this._collaboration?.fileBase(filepath)
          || this.collaborationFile(this.editorCurrentEditingDesc);
        // A claim can bring in newer saved translations. Pair the visible text
        // and the hydration snapshot with the base captured above.
        this.seedEditorOpenSource(request);
        const opened = await this.openEditorFile(filepath, returnToFileList, request);
        const failure = this._collaborationOpenFailure;
        if (opened && request.isCurrent() && failure?.filepath === filepath && this.collaborationContextCurrent(failure.context)) {
          this._collaborationOpenFailure = null;
          if (this.collaborationNotice === failure.message) this.collaborationNotice = '';
          if (this.collaborationState?.error === failure.message) {
            // Only this file's successful reopen clears its claim failure.
            // Keep an independent upload or presence failure visible.
            const status = client.lastStatus;
            this.collabReceiveState?.({ ...this.collaborationState,
              status: status?.message || '', error: status?.error ? status.message : '' });
          }
        }
        return opened;
      } catch (error) {
        if (request.isCurrent()) {
          this.editorLoading = false;
          this.editorLoadError = 'Could not open this file. Close it and try again. ' + error.message;
          this._collaborationOpenFailure = { context: ctx, filepath, message: error.message };
          this.collaborationFailure(error);
        }
        return false;
      }
      finally {
        releaseClaim();
        if (this._openingFile === request.run) this._openingFile = false;
        if (this._editorOpenRun === request.run && !request.isCurrent() && this.editorLoading) this.cancelEditorOpen();
      }
    },
    yieldEditorWork() {
      return new Promise(resolve => setTimeout(resolve, 0));
    },
    async yieldEditorPaint() {
      await this.$nextTick();
      this.autosizeEditorMultilineFields();
      // A nextTick alone flushes Vue but does not allow the browser to paint.
      await new Promise(resolve => {
        if (typeof requestAnimationFrame === 'function' && !document.hidden) {
          requestAnimationFrame(() => setTimeout(resolve, 0));
        } else setTimeout(resolve, 0);
      });
    },
    cancelEditorOpen() {
      this.cancelDictionaryMatchRequests();
      this._editorOpenRun = (this._editorOpenRun || 0) + 1;
      this._openingFile = false;
      this.editorLoading = false;
      this.editorLoadError = '';
      this.editorVisible = false;
      this.inlineActive = false;
      this.editorBlocks = [];
      this.editorOriginalTranslations = [];
      this.editorDroppedCandidate = null;
      this.restoreFileTableFocusAfterEditor();
    },
    applyPreparedEditorBlocks(blocks) {
      if (blocks.dictionaryPack) this.adoptEditorDictionaryMatchPack(blocks.dictionaryPack);
      // Keep the existing fields mounted, including their focus, selection and
      // scroll positions. Only their highlight/diagnostic data needs replacing.
      for (let i = 0; i < blocks.length; i++) {
        const next = blocks[i], current = this.editorBlocks[i];
        if (!current) { this.editorBlocks.push(next); continue; }
        if (current.isTable && next.isTable) {
          const columns = current.tableColumns;
          for (let col = 0; col < next.tableColumns.length; col++) {
            if (columns[col]) Object.assign(columns[col], next.tableColumns[col]);
            else columns.push(next.tableColumns[col]);
          }
          columns.length = next.tableColumns.length;
          Object.assign(current, next, { tableColumns: columns });
        } else Object.assign(current, next);
      }
      this.editorBlocks.length = blocks.length;
      const latest = this.getEditorDictionaryMatchPack();
      if (blocks.dictionaryPack && latest?.generation > blocks.dictionaryPack.generation) this.applyDictionaryAssistancePack(latest);
    },
    seedEditorOpenSource(request) {
      const desc = request.desc;
      const candidate = window.WorkspaceState.droppedForFile(this.localDescs, desc.filepath, this.lang);
      this.editorDroppedCandidate = candidate ? this.toPlainForStorage(candidate) : null;
      const candidateLines = candidate?.snapshot?.translations;
      const storedDraft = request.draftLoaded ? request.draftRecord : this.inlineDraftRows?.[desc.filepath];
      const draft = storedDraft?.state === 'active' ? storedDraft.translations
        : !this.inlineActive && desc.needsReview && candidateLines?.length === desc.translations.English.length
          ? candidateLines : (desc.translations[this.lang] || []);
      request.source = {
        english: [...desc.translations.English],
        translations: [...draft],
        needsReview: !this.inlineActive && desc.needsReview,
      };
      const blocks = Array.from({ length: Math.max(request.source.english.length, request.source.translations.length) }, (_, index) =>
        this.makeEditorBlock(request.source.english[index] || '', request.source.translations[index] || ''));
      this.applyPreparedEditorBlocks(blocks);
      this.editorOriginalTranslations = blocks.map(block => block.translation);
      this.editorShowEnglishDiff = !!request.source.needsReview;
      this.beginEditorDraftSession?.(request);
      this.refreshGamePreview();
    },
    makeEditorBlock(englishRaw, translationRaw, hydrate = false, pack = this.getEditorDictionaryMatchPack()) {
      let decodedEnglish = this.decodeEscapedNewlines(englishRaw);
      let decodedTranslation = this.decodeEscapedNewlines(translationRaw);
      let isTable = this.isTableText(decodedEnglish) || this.isTableText(decodedTranslation);
      let isMultiline = this.isMultilineText(englishRaw) || this.isMultilineText(translationRaw);
      let english = (isTable || isMultiline) ? decodedEnglish : englishRaw;
      let translation = (isTable || isMultiline) ? decodedTranslation : translationRaw;
      let { englishHLter: baseEnglishHLter, HLs } = !hydrate || isTable ? { englishHLter: '', HLs: [] } : this.buildEnglishHLter(english, pack);
      let englishHLter = baseEnglishHLter;
      let translationDiagnosticResult = !hydrate || isTable ? { diagnostics: [], warningCount: 0, errorCount: 0 } : this.analyzeTranslationDiagnostics(translation ?? "", english ?? "");
      let translationHLter = !hydrate || isTable ? '' : this.buildTagHLter(translation ?? "", translationDiagnosticResult.diagnostics);
      let multilineLineMismatch = false;
      let tableColumns = [];
      if (isTable) {
        tableColumns = this.buildEditorTableColumns(english, translation, hydrate, pack);
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
      } else if (hydrate && isMultiline) {
        let diff = this.computeMultilineLineMismatch(english, translation);
        englishHLter = this.wrapHlterByLines(baseEnglishHLter, diff.engMismatch);
        translationHLter = this.wrapHlterByLines(this.buildTagHLter(translation ?? "", translationDiagnosticResult.diagnostics), diff.trMismatch);
        multilineLineMismatch = diff.mismatch;
      }
      let engStats = this.computeTextStats(english);
      let trStats = this.computeTextStats(translation);
      return {
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
      };
    },
    beginEditorOpen(filepath, returnToFileList = false) {
      if (this._reconcilingImport || this._importingSource) return null;
      this.resetEditorFilePathCopy();
      this.closeRawFileDialog();
      this.consistencyResolutionNotice = '';
      let desc = this.getDescByFilepath(filepath);
      if (!desc) {
        this.appAlert('Unexpected Error! cannot find the file you want to edit!');
        return null;
      }
      if (!this.editorVisible) this._fileTableReturnFocus = returnToFileList || !!document.activeElement?.closest?.('.fileTableScroll');
      this.selectFileRow(filepath);

      this.cancelDictionaryMatchRequests();
      this.closeHlPopup();
      this.editorDictionaryMatchPack = null;
      this.editorBlocks = [];
      this.editorOriginalTranslations = [];
      this.editorDroppedCandidate = null;
      this.editorShowEnglishDiff = false;
      this.editorCompareActive = false;
      this.editorCompareTitle = '';
      this.editorCurrentEditingDesc = desc;
      this.gamePreviewSourceSegments = [];
      this.gamePreviewSegments = [];
      this.editorLoadError = '';
      this.editorLoading = true;
      this.inlineActive = this._nextEditorSurface === 'inline';
      this.editorVisible = !this.inlineActive;
      this.editorFocusedIndex = 0;
      this.editorFocusedColumnIndex = 0;
      this.endDictionaryEdit();
      this.dictionaryPage = 1;
      const run = this._editorOpenRun = (this._editorOpenRun || 0) + 1;
      const lang = this.lang, version = this.gameVersion, sourceIdentity = this.sourceIdentity;
      const dictionaryScope = this.dictionaryWorkerScopeKey(), branch = this.branchId || 'default';
      const isCurrent = () => !this._dictionaryAssistanceDisposed && this._editorOpenRun === run && this.editorSessionActive
        && this.editorCurrentEditingDesc === desc && this.lang === lang && this.gameVersion === version
        && this.sourceIdentity === sourceIdentity && dictionaryScope === this.dictionaryWorkerScopeKey()
        && branch === (this.branchId || 'default');
      const request = { desc, run, isCurrent };
      this.seedEditorOpenSource(request);
      this.$nextTick(() => {
        if (!isCurrent()) return;
        if (!this.inlineActive) this.getEditorRef('translation', 0, this.editorBlocks[0]?.isTable ? 0 : null)?.focus?.({ preventScroll: true });
      });
      return request;
    },
    async openEditorFile(filepath, returnToFileList = false, pendingRequest = null) {
      const request = pendingRequest || this.beginEditorOpen(filepath, returnToFileList);
      if (!request) return false;
      const { desc, isCurrent } = request;
      // Keep the draft aligned with the collaboration base captured at open,
      // even if background sync changes the saved description between chunks.
      try {
        if (this.hydrateEditorDraft) await this.hydrateEditorDraft(request);
        if (!isCurrent()) return false;
        const source = request.source;
        const seededBlocks = this.editorBlocks, englishKey = this.dictionaryEditorEnglishKey(seededBlocks);
        const preparationCurrent = () => isCurrent() && this.editorBlocks === seededBlocks
          && this.dictionaryEditorEnglishKey(seededBlocks) === englishKey;
        await this.yieldEditorPaint();
        if (!preparationCurrent()) {
          if (isCurrent()) this.cancelEditorOpen();
          return false;
        }
        const blocks = await this.prepareMatchedEditorBlocks(source.english, source.translations, preparationCurrent);
        if (!blocks || !preparationCurrent()) {
          if (isCurrent()) this.cancelEditorOpen();
          return false;
        }
        this.applyPreparedEditorBlocks(blocks);
        this.editorLoading = false;
        if (this._dictionaryWorkerClient?.readyGeneration > this.editorDictionaryMatchPack?.generation) this.scheduleEditorHLterRefresh();
        this.$nextTick(() => {
          if (!isCurrent()) return;
          for (let i = 0; i < (this.editorBlocks || []).length; i++) {
            if (this.editorBlocks[i]?.isTable) {
              for (let col = 0; col < (this.editorBlocks[i].tableColumns || []).length; col++) {
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
        if (source.needsReview) {
          this.editorShowEnglishDiff = true;
          this.prepareEditorEnglishDiff();
        }
        return true;
      } catch (error) {
        if (isCurrent()) {
          this.editorLoading = false;
          this.editorLoadError = 'Could not prepare this file. Close it and try again. ' + error.message;
        }
        return false;
      } finally {
        if (this._editorOpenRun === request.run && !isCurrent() && this.editorLoading) this.cancelEditorOpen();
      }
    },
    copySpanToTranslation(e, editorBlock, editorIndex, columnIndex = 0) {
      const hlId = e.target.getAttribute('data-hl-id');
      const highlight = (editorBlock?.HLs || []).find(hl => String(hl?._hlId) === String(hlId));
      if (!this.isDictionaryHighlightActive(highlight)) return;
      let text = e.target.getAttribute('datavalue') || "";
      let caretOffsetRaw = e.target.getAttribute('data-caret-offset');
      let caretOffset = caretOffsetRaw == null ? null : Number(caretOffsetRaw);
      this.getEditorRef("translation", editorIndex, editorBlock?.isTable ? columnIndex : null)?.focus?.();
      this.insertTranslationText(editorIndex, text, { columnIndex, caretOffset: Number.isInteger(caretOffset) ? caretOffset : undefined });
    },
    resetEditorFilePathCopy() {
      clearTimeout(this._editorFilePathCopyTimer);
      this._editorFilePathCopyTimer = null;
      this._editorFilePathCopyRun = (this._editorFilePathCopyRun || 0) + 1;
      this.editorFilePathCopied = false;
    },
    async copyEditorFilePath() {
      const desc = this.editorCurrentEditingDesc;
      const filepath = desc?.filepath;
      if (!filepath || !this.editorVisible) return;
      this.resetEditorFilePathCopy();
      const run = this._editorFilePathCopyRun;
      const scope = this.rawFileScope;
      const isCurrent = () => this._editorFilePathCopyRun === run && this.editorVisible
        && this.editorCurrentEditingDesc === desc && this.rawFileScope === scope;
      try {
        await navigator.clipboard.writeText(filepath);
        if (!isCurrent()) return;
        this.editorFilePathCopied = true;
        this._editorFilePathCopyTimer = setTimeout(() => {
          if (isCurrent()) this.resetEditorFilePathCopy();
        }, 1400);
      } catch (error) {
        if (isCurrent()) this.appAlert('Could not copy the file path. Select the path and copy it manually.');
      }
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
      if (this.isImeComposingEvent(e)) return;
      let id = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'].indexOf(e.code);
      if (id < 0) return;
      let source = this.getEditorColumn(editorBlock, columnIndex);
      if (!source?.HLs?.[id]) return;
      if (!this.isDictionaryHighlightActive(source.HLs[id])) return;
      let text = source.HLs[id].replace || source.HLs[id].find;
      this.insertTranslationText(editorIndex, text, { columnIndex, caretOffset: source.HLs[id].caretOffset });
    },
    editorShiftEnter(e) {
      if (this.isImeComposingEvent(e)) return;
      if (this.shiftEnterSave) {
        if (this.autoOpenNextFile) {
          this.saveAndSkipFile();
        } else {
          this.editorSave();
        }
      }
    },
    editorSaveFindings(newTranslations) {
      this.refreshEditorDiagnostics();
      const errors = this.collectEditorDiagnostics("error");
      const warnings = this.collectEditorDiagnostics("warning");
      const confirmations = [];
      if (warnings.length) confirmations.push('Translation warnings found:\n' + this.formatDiagnosticsForDisplay(warnings, 12));
      const english = this.editorCurrentEditingDesc?.translations?.English || [];
      if (computeIsMissing(english.length, newTranslations)) confirmations.push("There are missing fields in translation.");
      const lineMismatch = [], columnMismatch = [];
      for (const [index, block] of (this.editorBlocks || []).entries()) {
        const source = this.computeTextStats(block.english || ''), target = this.computeTextStats(block.translation || '');
        if (source.lines !== target.lines) lineMismatch.push('#' + (index + 1) + ': ' + target.lines + '/' + source.lines);
        if (block.isTable && source.cols !== target.cols) columnMismatch.push('#' + (index + 1) + ': ' + target.cols + '/' + source.cols);
      }
      if (lineMismatch.length) confirmations.push('Number of lines mismatched! (Translation/English)\n' + lineMismatch.slice(0, 12).join('\n'));
      if (columnMismatch.length) confirmations.push('Number of table columns mismatched! (Translation/English)\n' + columnMismatch.slice(0, 12).join('\n'));
      for (const [counter, label] of [[countGGGVarTag, 'variable tags'], [countKeywordPopupTag, 'keyword popup tags'], [countTextDecorationTag, 'text decoration tags']]) {
        if (newTranslations.reduce((n, text) => n + counter(text), 0) !== english.reduce((n, text) => n + counter(text), 0)) confirmations.push('Number of ' + label + ' mismatched!');
      }
      return { errors, warnings, confirmations };
    },
    async editorSave({ close = true, automatic = false, defer = close || automatic } = {}) {
      if (this.editorLoading || this.editorLoadError || this.editorSaving || this._importingSource || this._resetConfirming || this.versionStorageLoading) return false;
      if (this.editorTranslationReadOnly) return false;
      const desc = this.editorCurrentEditingDesc;
      if (!desc) return false;
      if (this.pendingDraftSaveFor?.(desc.filepath)) return false;
      const dropped = window.WorkspaceState?.droppedForFile(this.localDescs, desc.filepath, this.lang);
      if ((this.inlineActive && dropped) || this.editorDroppedConflict) {
        const message = 'Open the full editor to review the dropped translation before saving this file.';
        this.collaborationNotice = message;
        if (this.inlineDraftFindings) this.inlineDraftFindings = { ...this.inlineDraftFindings, [desc.filepath]: [{ level: 'warning', message }] };
        return false;
      }
      this.editorSaving = true;
      const saveToken = this._editorSaveToken = {};
      const saveContext = this.captureCollaborationContext();
      try {
        const newTranslations = this.serializeEditorTranslations ? this.serializeEditorTranslations() : this.editorBlocks.map(block => {
          if (block?.isTable) this.syncEditorBlockFromTableColumns(block);
          return this.encodeNewlines(block.isMultiline ? this.decodeEscapedNewlines(block.translation || '') : block.translation || '');
        });
        const context = this.captureCollaborationContext();
        const draftAtSave = this.editorBlocks.map(block => block?.translation ?? '');
        const blocksAtSave = this.editorBlocks, baseAtSave = this._editorCollabBase;
        const englishAtSave = JSON.stringify(desc.translations.English);
        const session = this._draftSession;
        // Save journals validated text directly. Only finish a checkpoint write
        // that already started; creating another checkpoint would duplicate this
        // submission and delay moving to the next file.
        clearTimeout(this._draftTimer); this._draftTimer = null;
        if (session?.write) await session.write;
        if (session?.writeError && this.flushEditorDraft && !await this.flushEditorDraft({ force: true })) return false;
        if (this.editorCurrentEditingDesc !== desc || this.editorBlocks !== blocksAtSave
          || !this.collaborationContextCurrent(context) || (session && session !== this._draftSession)
          || !arrayEquals(draftAtSave, this.editorBlocks.map(block => block?.translation ?? ''))) return false;
        if (session?.conflict || session?.record?.conflicts?.length) {
          this.collaborationNotice = 'Another tab changed this local draft. Open Local drafts to review both copies.';
          if (this.inlineDraftFindings) this.inlineDraftFindings = { ...this.inlineDraftFindings, [desc.filepath]: [{ level: 'error', message: this.collaborationNotice }] };
          return false;
        }
        const findings = this.editorSaveFindings(newTranslations);
        if (this.inlineDraftFindings) this.inlineDraftFindings = { ...this.inlineDraftFindings, [desc.filepath]: [
          ...(this.inlineDraftFindings[desc.filepath] || []).filter(finding => finding.deferredSave),
          ...findings.errors.map(item => ({ ...item, level: 'error' })),
          ...findings.warnings.map(item => ({ ...item, level: 'warning' })),
          ...findings.confirmations.slice(findings.warnings.length ? 1 : 0).map(message => ({ level: 'warning', message })),
        ] };
        if (findings.errors.length) {
          if (this.flushEditorDraft && !await this.flushEditorDraft({ force: true })) return false;
          if (!automatic) await this.appAlert('Translation errors found. Please fix them before saving.\n\n' + this.formatDiagnosticsForDisplay(findings.errors, 12));
          return false;
        }
        const confirmation = findings.confirmations.join('\n\n');
        const fingerprint = JSON.stringify([newTranslations, confirmation]);
        if (confirmation) {
          if (automatic && session?.declined === fingerprint) return false;
          // Until the user accepts a warning this remains unfinished work;
          // retain its captured text before an asynchronous confirmation.
          if (this.flushEditorDraft && !await this.flushEditorDraft({ force: true })) return false;
          if (!await this.appConfirm(confirmation + '\n\nDo you want to save anyway?')) {
            if (session && this._draftSession === session && this.collaborationContextCurrent(context)) {
              session.declined = fingerprint;
              await this.flushEditorDraft?.({ force: true });
            }
            return false;
          }
        }
        if (this.editorCurrentEditingDesc !== desc || this.editorBlocks !== blocksAtSave
          || !this.collaborationContextCurrent(context) || this.editorTranslationReadOnly
          || this._editorCollabBase !== baseAtSave || JSON.stringify(desc.translations.English) !== englishAtSave
          || !arrayEquals(draftAtSave, this.editorBlocks.map(block => block?.translation ?? ''))
          || (session && session !== this._draftSession)) {
          this.collaborationNotice = 'The file changed while confirming the save. Review the current draft and save again.';
          return false;
        }
        const record = session?.record;
        const deferCommit = !this.testMode && defer && !!this.initializePendingSaves?.();
        const completeDeferredSave = async ack => {
          if (!this.collaborationContextCurrent(context)) return;
          const accepted = context.client?.fileBase(desc.filepath) || this.collaborationFile(desc);
          const active = this._draftSession === session && this.editorBlocks === blocksAtSave && this.editorCurrentEditingDesc === desc;
          if (active) {
            this.rebaseEditorAfterCommit(accepted, { draftBefore: draftAtSave, submittedTranslations: newTranslations });
            this.editorDroppedCandidate = null; this.editorShowEnglishDiff = false;
          }
          // Bookkeeping uses the captured session even after a new file opens.
          // It must never clear or rebase the next file's typing.
          await this.editorDraftCommitted?.(session, newTranslations, ack, accepted);
        };
        const rejectDeferredSave = error => {
          if (!this.collaborationContextCurrent(context)) return;
          const message = desc.filepath + ': ' + (error.code === 'DROPPED_PROMOTION_CHANGED'
            ? error.message + ' Open the full editor to review the current Dropped translation before saving again.'
            : error.draftReview ? error.message
            : 'The committed translation or local draft changed. Open Local drafts to compare and review before saving.');
          if (this.inlineDraftFindings) this.inlineDraftFindings = { ...this.inlineDraftFindings,
            [desc.filepath]: [{ level: 'error', message, deferredSave: true }] };
        };
        const result = await this.persistTranslationBatch([{ desc, lines: newTranslations, needsReview: false }], 'save', {
          context, close, bases: { [desc.filepath]: this.toPlainForStorage(baseAtSave || session?.base || this.collaborationFile(desc)) },
          promoteDropped: this.editorDroppedCandidate ? this.capturedDroppedPromotion(desc.filepath) : null,
          inline: !!this.inlineActive,
          awaitDurable: true,
          ...(record && !this.testMode ? { draft: { key: record.key, id: record.id, revision: record.revision, base: record.base,
            ...(record.submissionJobId ? { submissionJobId: record.submissionJobId } : {}),
            ...(record.submissionJobIds?.length ? { submissionJobIds: [...record.submissionJobIds] } : {}) } } : {}),
          ...(session && !this.testMode ? { checkpoint: { key: session.key, revision: session.expectedRevision || null,
            ...(session.id || record?.id ? { id: session.id || record.id } : {}) } } : {}),
          ...(deferCommit ? { deferCommit: true, onCommitted: completeDeferredSave, onRejected: rejectDeferredSave } : {}),
        });
        if (result.stale || result.status === 'conflict') return false;
        if (this.editorBlocks !== blocksAtSave || !this.collaborationContextCurrent(context)) return false;
        if (deferCommit && result.status === 'queued') {
          if (session) session.submission = { jobId: result.jobId, translations: [...newTranslations] };
          if (!arrayEquals(draftAtSave, this.editorBlocks.map(block => block?.translation ?? ''))) {
            await this.flushEditorDraft?.({ force: true });
            return false;
          }
          this.closeHlPopup();
          if (close) {
            this.editorVisible = false; this.inlineActive = false; this._draftSession = null;
            this._collaboration?.leaveEdit(); this.restoreFileTableFocusAfterEditor();
          }
          return true;
        }
        const accepted = this._collaboration?.fileBase(desc.filepath) || this.collaborationFile(desc);
        const { typedDuringSave } = this.rebaseEditorAfterCommit(accepted, {
          draftBefore: draftAtSave, submittedTranslations: newTranslations, refresh: !close,
        });
        await this.editorDraftCommitted?.(session, newTranslations, result, accepted);
        if (this.editorBlocks !== blocksAtSave || !this.collaborationContextCurrent(context)
          || (session && this._draftSession !== session)) return false;
        this.editorDroppedCandidate = null; this.editorShowEnglishDiff = false;
        if (typedDuringSave) return false;
        this.closeHlPopup();
        if (close) {
          this.editorVisible = false; this.inlineActive = false; this._draftSession = null;
          this._collaboration?.leaveEdit(); this.restoreFileTableFocusAfterEditor();
        }
        return true;
      } catch (error) {
        if (!this.collaborationContextCurrent(saveContext) || this._editorSaveToken !== saveToken) return false;
        await this.flushEditorDraft?.({ force: true });
        if (!this.collaborationContextCurrent(saveContext) || this._editorSaveToken !== saveToken) return false;
        const review = ['DRAFT_BASE_CHANGED', 'DRAFT_CHANGED', 'DRAFT_CONFLICT'].includes(error.code);
        const message = error.draftReview ? error.message : review ? 'The committed translation or local draft changed. Open Local drafts to compare and review before saving.'
          : 'Could not save this translation. Your local draft has been retained. ' + error.message;
        if (!review) this.cloudStorageError = message;
        this.collaborationNotice = message;
        if (this.inlineDraftFindings) this.inlineDraftFindings = { ...this.inlineDraftFindings, [desc.filepath]: [{ level: 'error', message }] };
        return false;
      } finally { if (this._editorSaveToken === saveToken) this.editorSaving = false; }
    },
    async refreshHistory() {
      const generation = this._localHistoryRun = (this._localHistoryRun || 0) + 1;
      const desc = this.editorCurrentEditingDesc, scope = this.managedWorkspaceScope?.();
      const context = this.captureCollaborationContext?.(), mode = this.historyMode, includeLegacy = this.historyIncludeLegacy;
      const current = () => generation === this._localHistoryRun && desc === this.editorCurrentEditingDesc
        && mode === this.historyMode && includeLegacy === this.historyIncludeLegacy
        && (!context || this.collaborationContextCurrent(context));
      if (this._pendingSaves?.snapshot().jobs.length && !await this.waitForPendingSaves()) return;
      if (!current()) return;
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
          const items = await window.OfflineStore.listRevisions(filepath, lang, 100, scope || this.gameVersion);
          if (!current()) return;
          this.historyItems = (Array.isArray(items) ? items : []).map((it, idx) => {
            if (idx !== 0) return it;
            return {
              ...it,
              note: `${it?.note ? String(it.note) + ' ' : ''}(current)`
            };
          });
          if (lang === this.lang && this.importBaseline && this._collaboration?.recoveryFiles) {
            const recoveries = this._collaboration.recoveryFiles(filepath).map((item, index) => ({
              ...item, id: 'local-carry:' + index + ':' + item.recoveryId, filepath, lang,
              sourceHash: this.sourceIdentity, needsReview: true, note: item.note || 'Dropped translation' }));
            this.historyItems.push(...recoveries);
          }
          if (includeLegacy && scope) {
            const metadata = this.localVersions?.find(v => v.sourceHash === scope.sourceHash);
            const legacy = await window.OfflineStore.listRevisions(filepath, lang, 100, { ...scope, legacyHistory: true });
            const guest = metadata?.adoptedFrom === 'guest' ? await window.OfflineStore.listRevisions(filepath, lang, 100,
              { ...scope, accountId: 'guest', legacyHistory: true }) : [];
            if (!current()) return;
            if (!this.historyItems.length) this.historyItems.push({ id: 'current-version', filepath, lang,
              sourceHash: this.sourceIdentity, branchId: this.branchId, translations: [...(desc.translations?.[lang] || [])],
              note: '(current)', savedAt: this.localDescs?.lastModified });
            const existing = new Set(this.historyItems.map(row => String(row.id)));
            this.historyItems.push(...[...(legacy || []).filter(row => !existing.has(String(row.id))), ...(guest || [])].map((row, index) => ({ ...row,
              id: 'legacy-reference:' + index + ':' + row.id, legacyReference: true,
              note: `Legacy local reference · ${row.accountId === 'guest' || !row.accountId ? 'original local profile · ' : ''}${row.sourceHash?.slice(0, 12) || 'unknown source'}${row.note ? ' · ' + row.note : ''}` })));
          }
          const inherited = (this.managedActiveTeam?.recoveries || []).filter(row => row.filepath === filepath);
          if (inherited.length) {
            if (!this.historyItems.length) this.historyItems.push({ id: 'current-version', filepath, lang, translations: [...(desc.translations?.[lang] || [])], note: '(current)' });
            this.historyItems.push(...inherited.map(row => ({ id: 'inherited-reference:' + row.id, filepath, lang,
              sourceHash: row.originSourceHash, translations: [...(row.snapshot?.translations || [])], legacyReference: true,
              savedAt: row.provenance?.capturedAt || row.provenance?.savedAt,
              note: 'Inherited reference · ' + (row.reason || 'Previous version work') })));
          }
        } else {
          this.historyItems = [];
        }
      } catch (_) {
        if (current()) this.historyItems = [];
      } finally {
        if (current()) this.historyLoading = false;
      }
      if (!current()) return;

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
      if (this.draftRecoveryCandidate?.originalBlocks) this.applyPreparedEditorBlocks(this.draftRecoveryCandidate.originalBlocks);
      this.draftRecoveryCandidate = null;
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
      if (!desc || !rev || this.editorSaving) return;
      if (rev.legacyReference) { this.appAlert('Legacy local records are reference copies. Compare their text and explicitly recover it in the intended source version.'); return; }
      if (rev.branchId && rev.branchId !== this.branchId) { this.appAlert('Cannot restore: revision belongs to another branch.'); return; }
      if (this.historyMode === 'source' || String(rev.lang) === 'English') { this.appAlert('Restoring source English text is disabled.'); return; }
      if (desc.filepath !== rev.filepath || this.lang !== rev.lang || (rev.sourceHash && this.sourceIdentity && rev.sourceHash !== this.sourceIdentity)) {
        this.appAlert('Cannot restore: revision does not match the current source, file and language.'); return;
      }
      const lines = Array.isArray(rev.translations) ? rev.translations : [];
      if (lines.length !== desc.translations.English.length) { this.appAlert('Cannot restore: the source entry layout differs.'); return; }
      const context = this.captureCollaborationContext();
      const blocks = this.editorBlocks;
      const english = JSON.stringify(desc.translations.English);
      const base = this._editorCollabBase;
      this.editorSaving = true;
      try {
        if (!await this.appConfirm(rev.needsReview ? 'Recover this as a dropped translation? The copy will be synchronized for review. Save or Confirm unchanged stages it for export.'
          : 'Restore this revision? A new saved revision will be created.', {
          title: 'Restore saved revision?', confirmLabel: 'Restore revision',
        })) return;
        if (this.editorCurrentEditingDesc !== desc || this.editorBlocks !== blocks
          || !this.collaborationContextCurrent(context) || this._editorCollabBase !== base
          || JSON.stringify(desc.translations.English) !== english) return;
        const result = rev.needsReview
          ? await this.restoreReviewCandidate(desc, lines, context)
          : await this.persistTranslationBatch([{ desc, lines, needsReview: false }], 'restore', {
            context, bases: base ? { [desc.filepath]: base } : undefined,
          });
        if (result.stale || result.status === 'conflict') return;
        if (this.editorVisible) this.openEditorFile(desc.filepath);
        this._editorCollabBase = this._collaboration?.fileBase(desc.filepath);
        await this.refreshHistory();
      } catch (error) { this.collaborationNotice = 'Could not restore the translation: ' + error.message; }
      finally { this.editorSaving = false; }
    },
    editorEsc(e) {
      if (this.isImeComposingEvent(e)) return;
      if (e?.defaultPrevented) return;
      if (this.hlPopup.visible) {
        e?.preventDefault();
        this.closeHlPopup({ refocus: true });
        return;
      }
      this.editorExit();
    },
    editorHaveChanges() {
      if (this.editorLoading || this.editorLoadError) return false;
      let original = (this.editorOriginalTranslations || []).map(v => v ?? "");
      let current = (this.editorBlocks || []).map(b => b?.translation ?? "");
      return !arrayEquals(original, current);
    },
    async editorExit() {
      if (this.inlineActive) return this.finishInlineSession({ promote: false });
      if (this.flushEditorDraft && !this.editorLoading && !this.editorLoadError) {
        if (this.editorSaving || this.navigationBusy || !await this.flushEditorDraft()) return;
        this.saveSettings(); this.closeHlPopup(); this.editorVisible = false;
        this._draftSession = null; this._collaboration?.leaveEdit(); this.restoreFileTableFocusAfterEditor(); return;
      }
      if (this.editorLoading || this.editorLoadError) {
        this._editorOpenCancelRevision = (this._editorOpenCancelRevision || 0) + 1;
        this.cancelEditorOpen();
        this._collaboration?.leaveEdit();
        return;
      }
      if (this.editorSaving || this.navigationBusy) return;
      if (this.editorHaveChanges()) {
        if (this._editorExitConfirming) return;
        const blocks = this.editorBlocks;
        const desc = this.editorCurrentEditingDesc;
        const context = this.captureCollaborationContext?.();
        const draft = this.editorBlocks.map(block => block?.translation ?? '');
        this._editorExitConfirming = true;
        try {
          if (!await this.appConfirm('Are you sure you want to exit without saving?', {
            title: 'Discard unsaved changes?', confirmLabel: 'Discard changes', danger: true,
          })) return;
          if (this.editorBlocks !== blocks || this.editorCurrentEditingDesc !== desc
            || (context && !this.collaborationContextCurrent(context))
            || !arrayEquals(draft, this.editorBlocks.map(block => block?.translation ?? ''))) return;
        } finally { this._editorExitConfirming = false; }
      }
      if (this.editorSaving || this.navigationBusy) return;
      this.saveSettings();
      this.closeHlPopup();
      this.editorVisible = false;
      this._collaboration?.leaveEdit();
      this.restoreFileTableFocusAfterEditor();
    },
    restoreFileTableFocusAfterEditor() {
      if (!this._fileTableReturnFocus) return;
      this.$nextTick(() => {
        if (this.editorVisible) return;
        this._fileTableReturnFocus = false;
        this.syncFileSelection();
        this.focusSelectedFileRow();
      });
    },
    applyTheme(theme) {
      if (!['light', 'grey', 'dark', 'modern-dark'].includes(theme)) return;
      document.documentElement.setAttribute('data-theme', theme);
      try { localStorage.setItem('sdeditor-theme', theme); }
      catch (_) { /* The appearance cache must never block settings or startup. */ }
    },
    async finishStartup(preserveBootTheme = false) {
      if (this.startupReady) return;
      // The restored local profile is ready here; network authentication starts
      // after this screen. The first local cache is the only blocking generation.
      if (this.lang && this.gameVersion) {
        try { await this.ensureDictionarySnapshot(); }
        catch (error) {
          if (!this.cloudStorageError) this.cloudStorageError = 'Could not prepare Dictionary matches. Reload to retry: ' + error.message;
        }
      }
      if (preserveBootTheme) this.theme = document.documentElement.getAttribute('data-theme') || this.theme;
      this.applyTheme(this.theme);
      this.startupReady = true;
      await this.$nextTick();
      document.documentElement.removeAttribute('data-app-booting');
    },
    settingsSavePayload() {
      return {
        editorRegexes: this.editorRegexes,
        dictionary: this.dictionary,
        editorClipboard: this.editorClipboard,
        lang: this.lang,
        theme: this.theme,
        hideDNT: this.hideDNT,
        hideSourceInPreviewPanel: this.hideSourceInPreviewPanel,
        highlightDict: this.highlightDict,
        inlineEditor: this.inlineEditor !== false,
        shiftEnterSave: this.shiftEnterSave,
        autoOpenNextFile: this.autoOpenNextFile,
        filterShortcutCtrlD: this.filterShortcutCtrlD,
        autocompleteShortcut: this.autocompleteShortcut,
        uiDensity: this.uiDensity,
        gamePreviewFrame: this.gamePreviewFrame,
        gamePreviewFonts: this.gamePreviewFonts,
      };
    },
    scheduleSettingsSave() {
      if (this._settingsSaveDisposed || this._cloudApplying || !offlineStoreReady) return;
      const settings = this.settingsSavePayload();
      const context = this._cloud?.context();
      const jobs = this._settingsSaveJobs ||= [];
      const last = jobs.at(-1);
      const sameContext = last && last !== this._settingsSaveActive && last.client === this._cloud && last.settings.lang === settings.lang
        && (!context || ['epoch', 'profile', 'token', 'language', 'assignmentVersion'].every(key => last.context?.[key] === context[key]));
      if (sameContext) last.settings = settings;
      else jobs.push({ settings, client: this._cloud, context });
      this.pendingSettingsSaves = jobs.length;
      this._settingsSaveBeforeUnload ||= event => {
        if (!this.pendingSettingsSaves) return;
        event.preventDefault(); event.returnValue = 'Dictionary changes are still saving in this browser.';
      };
      window.addEventListener?.('beforeunload', this._settingsSaveBeforeUnload);
      clearTimeout(this._settingsSaveTimer);
      this._settingsSaveTimer = setTimeout(() => this.flushScheduledSettingsSave(), 150);
    },
    async prepareSettingsSaveSnapshot(settings) {
      const plain = this.toPlainForStorage({ ...settings, dictionary: [] });
      if (!plain) throw new Error('Cannot serialize settings');
      const raw = typeof Vue.toRaw === 'function' ? Vue.toRaw(settings.dictionary) : settings.dictionary;
      const entries = [...(raw || [])];
      let started = Date.now();
      for (const entry of entries) {
        plain.dictionary.push(this.toPlainForStorage(typeof Vue.toRaw === 'function' ? Vue.toRaw(entry) : entry));
        if (Date.now() - started >= 6) { await this.yieldEditorWork(); started = Date.now(); }
      }
      return plain;
    },
    flushScheduledSettingsSave() {
      clearTimeout(this._settingsSaveTimer);
      if (this._settingsSaveDrain) return this._settingsSaveDrain;
      if (!this._settingsSaveJobs?.length) return Promise.resolve(true);
      const drain = async () => {
        while (this._settingsSaveJobs.length) {
          const job = this._settingsSaveActive = this._settingsSaveJobs[0];
          try {
            // Let the new row and its input focus paint before copying data.
            await this.yieldEditorWork();
            if (job.client && (job.client !== this._cloud || !job.client.permissionsCurrent(job.context))) {
              throw new Error('The account or language changed before these settings were saved. Keep this tab open and export your settings.');
            }
            const plain = await this.prepareSettingsSaveSnapshot(job.settings);
            if (job.client) {
              if (!job.client.permissionsCurrent(job.context)) throw new Error('The account or language changed before these settings were saved. Keep this tab open and export your settings.');
              if (!await this.cloudPersist(plain)) throw new Error(this.cloudStorageError || 'Local settings could not be saved.');
            } else if (window.OfflineStore?.setSettings) await window.OfflineStore.setSettings(plain);
            this._settingsSaveJobs.shift();
            this.pendingSettingsSaves = this._settingsSaveJobs.length;
            if (this.cloudStorageError === this._settingsSaveFailure) this.cloudStorageError = '';
            this._settingsSaveFailure = ''; this._settingsSaveBackoff = 1000;
          } catch (error) {
            this._settingsSaveFailure = 'Could not save settings locally: ' + error.message;
            this.cloudStorageError = this._settingsSaveFailure;
            if (!this._settingsSaveDisposed) this._settingsSaveTimer = setTimeout(() => this.flushScheduledSettingsSave(), this._settingsSaveBackoff || 1000);
            this._settingsSaveBackoff = Math.min((this._settingsSaveBackoff || 1000) * 2, 30000);
            return false;
          } finally { this._settingsSaveActive = null; }
        }
        window.removeEventListener?.('beforeunload', this._settingsSaveBeforeUnload);
        return true;
      };
      this._settingsSaveDrain = drain().finally(() => { this._settingsSaveDrain = null; });
      return this._settingsSaveDrain;
    },
    async saveSettings() {
      if (this._cloudApplying) return true;
      if (!offlineStoreReady) return !!this.testMode;
      this.scheduleSettingsSave();
      return this.flushScheduledSettingsSave();
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
        inlineEditor: this.inlineEditor !== false,
        shiftEnterSave: this.shiftEnterSave,
        autoOpenNextFile: this.autoOpenNextFile,
        filterShortcutCtrlD: this.filterShortcutCtrlD,
        autocompleteShortcut: this.autocompleteShortcut,
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
      fr.onload = async function () {
        let settings;
        try {
          settings = JSON.parse(fr.result);
          window.CloudSync.validateImport(settings);
        } catch (error) {
          vueThis.cloudStorageError = 'Could not import settings: ' + error.message;
          vueThis.$refs.importSettingsFileForm.reset();
          return;
        }
        vueThis.settingsImportDraft = settings;
        vueThis.settingsImportConfirm = '';
      }
      fr.readAsText(e.target.files[0]); 
    },
    importSettings(settings) {
      this.editorRegexes = settings.editorRegexes || [];
      const dictionary = settings.dictionary || [];
      if (dictionary !== this.dictionary) {
        this.dictionary = dictionary;
        this.ensureDictionaryIds();
        this.markDictionarySnapshotDirty?.(null, { replace: true });
      }
      this.editorClipboard = settings.editorClipboard || "";
      this.lang = this.langs.includes(settings.lang) ? settings.lang : '';
      if (['light', 'grey', 'dark', 'modern-dark'].includes(settings.theme)) this.theme = settings.theme;
      if (typeof settings.hideDNT !== 'undefined') this.hideDNT = !!settings.hideDNT;
      if (typeof settings.hideSourceInPreviewPanel !== 'undefined') this.hideSourceInPreviewPanel = !!settings.hideSourceInPreviewPanel;
      if (typeof settings.inlineEditor !== 'undefined') this.inlineEditor = !!settings.inlineEditor;
      if (typeof settings.highlightDict !== 'undefined') this.highlightDict = !!settings.highlightDict;
      if (typeof settings.shiftEnterSave !== 'undefined') this.shiftEnterSave = !!settings.shiftEnterSave;
      if (typeof settings.autoOpenNextFile !== 'undefined') this.autoOpenNextFile = !!settings.autoOpenNextFile;
      if (typeof settings.filterShortcutCtrlD !== 'undefined') this.filterShortcutCtrlD = !!settings.filterShortcutCtrlD;
      if (["ctrl-space", "ctrl-i", "disabled"].includes(settings.autocompleteShortcut)) {
        this.autocompleteShortcut = settings.autocompleteShortcut;
      }
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
      } else this.gamePreviewFonts = null;
    },
    async saveLocalDescs() {
      if (this.testMode) return;
      if (this._pendingSaves?.snapshot().jobs.length && !await this.waitForPendingSaves()) throw new Error('Retry the pending local saves before saving the workspace.');
      if (!offlineStoreReady || !window.OfflineStore?.setWorkspace) throw new Error('Local storage is unavailable.');
      const plain = this.toPlainForStorage(this.localDescs);
      if (!plain) throw new Error('Cannot serialize workspace');
      await window.OfflineStore.setWorkspace(plain, this.gameVersion);
    },
    async useRegex(editorBlock) {
      if (this.editorTranslationReadOnly) return;
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
      const regexes = this.editorRegexes;
      const dictionary = this.dictionary;
      const game = this.gameVersion, language = this.lang;
      
      if (regexEngineResult.failed) {
        if (await this.appConfirm("No match for:\n" + regexEngineResult.failStr + "\n\nCreate new regex for it?", {
          title: 'Create a regex rule?', confirmLabel: 'Create rule', danger: false,
        }) && this.editorRegexes === regexes && this.dictionary === dictionary && this.gameVersion === game && this.lang === language) {
          let r = regexEngineCreate(regexEngineResult.failStr, this.getActiveDictionaryEntries());
          this.addRegex(r.find, r.replace);
        }
      }
    },
    doTranslationReplace(editorBlock, force) {
      if (this.editorTranslationReadOnly) return;
      if (!editorBlock.translationReplace) return;
      let editorIndex = this.editorBlocks?.indexOf?.(editorBlock);
      if (typeof editorIndex !== "number" || editorIndex < 0) editorIndex = undefined;
      editorBlock.translation = editorBlock.translationReplace;
      if (editorBlock.isTable) {
        this.rebuildEditorTableColumnsFromStrings(editorBlock);
      } else if (typeof editorIndex === "number") {
        this.normalizeMultilineEditorBlock(editorBlock, editorIndex);
      }
      const activeDictionary = this.getActiveDictionaryEntries();
      for (let i = 0; i < editorBlock.words.length; i++) {
        const word = editorBlock.words[i];
        for (const replacerObj of activeDictionary) {
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
    async removeRegex(regex) {
      const regexes = this.editorRegexes;
      if (!await this.appConfirm(`Are you sure you want to remove this regex?\n\n#${regex.find}\n${regex.replace}`, {
        title: 'Remove regex rule?', confirmLabel: 'Remove rule',
      })) return;
      if (this.editorRegexes !== regexes) return;
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
      const entry = { _id: `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`, gameScope: this.gameVersion === 'poe2' ? 'poe2' : 'poe1', find: "", replace: "", alts: [], tlnote: "" };
      this.dictionary.unshift(entry);
      this.invalidateEditorDictionaryIndex(entry._id, { membership: true });
      this.beginDictionaryEdit(entry._id, { newEntry: true });
      this.focusDictionaryEntryReplaceInput(entry._id);
    },
    async removeVocab(word) {
      const dictionary = this.dictionary;
      if (!await this.appConfirm(`Are you sure you want to remove this word?\n\n#${word.find}\n${word.replace}`, {
        title: 'Remove Dictionary entry?', confirmLabel: 'Remove entry',
      })) return;
      if (this.dictionary !== dictionary) return;
      if (String(word?._id) === this.dictionaryEditingId) this.endDictionaryEdit();
      this.dictionary = this.dictionary.filter(o => o !== word);
      this.markDictionarySnapshotDirty?.(null, { replace: true });
      this.saveSettings();
    },
    async exportZip(doFullExport) {
      if (this.inlineActive && this.finishInlineSession && !await this.finishInlineSession({ promote: true })) return;
      if (this.flushEditorDraft && !await this.flushEditorDraft()) return;
      if (this._pendingSaves?.snapshot().jobs.length && !await this.waitForPendingSaves()) return;
      if (doFullExport && !await this.appConfirm("Are you sure you want to do a full export?\nNote: This may take a couple minutes", {
        title: 'Export full translation set?', confirmLabel: 'Export all', danger: false,
      })) return;
      if (this._pendingSaves?.snapshot().jobs.length && !await this.waitForPendingSaves()) return;
      const descsToExport = (this.descs || []).filter(desc => {
        const baseline = this.localDescs?.stagedVersion >= 1 ? this.workspaceSourceFile?.(desc.filepath) : null;
        const state = baseline ? window.WorkspaceState.workspaceFile(this.localDescs, baseline, this.lang) : desc;
        // An unresolved copy never replaces current ZIP/staged text. Keep valid
        // current translations exportable even while their older copy is dropped.
        return doFullExport ? !(state.isDropped && state.isMissing && !state.hasChanges) : !!state.hasChanges;
      });
      if (!descsToExport.length) {
        this.appAlert(`There're no files to be export!`);
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
    refreshMultiInstanceGate(currentTime = Date.now()) {
      for (const [id, lastSeen] of this._instancePeers || []) {
        if (currentTime - lastSeen > 5000) this._instancePeers.delete(id);
      }
      this.showMultiInstanceGate = !this.multiInstanceBypass && !!this._instancePeers?.size;
    },
    checkMultipleInstances() {
      // Use localStorage with heartbeat pattern to detect multiple instances
      const storageKey = 'sdeditor_instance_heartbeat';
      const currentTime = Date.now();
      const timeoutThreshold = 5000; // 5 seconds - if no update, consider instance dead
      
      try {
        // Check if we can use BroadcastChannel (better option)
        if (typeof BroadcastChannel !== 'undefined') {
          try {
            // Keep one subscription for this tab. Creating a new channel every
            // heartbeat retains old listeners and fans out messages to them.
            if (!this._broadcastChannel) {
              const channel = new BroadcastChannel('sdeditor-instances');
              this._instancePeers ||= new Map();
              channel.onmessage = (event) => {
                if (this._broadcastChannel !== channel || event.data?.type !== 'instance_check'
                  || typeof event.data.id !== 'string' || !event.data.id || event.data.id === this.instanceTabId) return;
                this._instancePeers.set(event.data.id, Date.now());
                this.refreshMultiInstanceGate();
              };
              this._broadcastChannel = channel;
            }
            // Announce this instance
            this._broadcastChannel.postMessage({ type: 'instance_check', id: this.instanceTabId });
            this.refreshMultiInstanceGate(currentTime);
            return;
          } catch (e) {
            // BroadcastChannel not available, fall back to localStorage
            this._broadcastChannel?.close();
            this._broadcastChannel = null;
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
        
        this._instancePeers = new Map(Object.entries(instances).filter(([id]) => id !== this.instanceTabId));
        this.refreshMultiInstanceGate(currentTime);
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
        // A bypassed tab is still an active writer that other tabs must see.
        this.checkMultipleInstances();
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
      this.appAlert(message);
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
if (window.EditorComponents?.TextField) app.component('editor-text-field', window.EditorComponents.TextField);
if (window.EditorComponents?.Preview) app.component('editor-preview', window.EditorComponents.Preview);
if (window.EditorComponents?.Assistance) app.component('editor-assistance', window.EditorComponents.Assistance);

app.component('app-tooltip', AppTooltip);
app.component('app-dialog', window.AppDialogs?.component || {});

app.directive('tooltip', {
  mounted(el, binding) {
    el.__sdTooltipValue = binding.value;
    const show = (e) => {
      el.__sdTooltipShown = true;
      binding.instance?.showTooltip?.(e, el.__sdTooltipValue);
    };
    const focus = () => {
      const rect = el.getBoundingClientRect();
      show({ clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 });
    };
    const hide = () => { el.__sdTooltipShown = false; binding.instance?.hideTooltip?.(); };
    el.__sdTooltipHandlers = { show, focus, hide };
    el.addEventListener('mouseenter', show);
    el.addEventListener('mousemove', show);
    el.addEventListener('mouseleave', hide);
    el.addEventListener('focus', focus);
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
    el.removeEventListener('focus', handlers.focus);
    el.removeEventListener('blur', handlers.hide);
    if (el.__sdTooltipShown) handlers.hide();
    delete el.__sdTooltipHandlers;
    delete el.__sdTooltipValue;
  }
});

app.mount('#app');
