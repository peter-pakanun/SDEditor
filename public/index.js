let localStorageInitialized = false;

const urlParams = new URLSearchParams(window.location.search);
const TEST_MODE = (() => {
  if (!urlParams.has('testMode')) return false;
  let v = (urlParams.get('testMode') || '').toLowerCase();
  return v === '' || v === '1' || v === 'true' || v === 'yes';
})();
const URL_LANG = urlParams.get('lang');

const config = {
  data() {
    return {
      localStorageInitialized: false,
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
      loadingProgress: 0.001,
      descs: [],
      localDescs: {
        descs: [],
        lastModified: 0,
        size: 0
      },
      filteredDescs: [],
      statistic: {
        hasChanges: 0,
        isMissing: 0
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

      sideTab: 'dictionary',
      dictionaryFilter: '',
      regexFilter: '',
      dictionaryFlashId: '',

      editorVisible: false,
      editorCurrentEditingDesc: null,
      editorFocusedIndex: 0,
      editorOriginalTranslations: [],
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
          translation: "",
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
      editorClipboard: ""
    }
  },
  mounted() {
    if (this.testMode) {
      this.lang = (URL_LANG && this.langs.includes(URL_LANG)) ? URL_LANG : (this.langs[0] || "Thai");
      this.loadingProgress = 0;
      this.ensureDictionaryIds();
      document.addEventListener('keydown', this.handleKeydown);
      this.loadDummyData();
      return;
    }

    let settings = localStorage.getItem('settings');
    if (settings) {
      try {
        settings = JSON.parse(settings);
      } catch (error) {
        alert('Cannot read Localstorage!!\nFile maybe corrupted!');
        if (prompt('Do you want to clear localStorage!?\nThis process cannot be undone!\n\nAnswer "YES" to confirm.') == "YES") {
          localStorage.removeItem('settings');
        }
        window.location.reload();
        return;
      }
      this.importSettings(settings);
    }

    let localDescs = localStorage.getItem('localDescs');
    if (localDescs) {
      try {
        localDescs = JSON.parse(localDescs);
      } catch (error) {
        alert('Cannot read Localstorage!!\nFile maybe corrupted!');
        if (prompt('Do you want to clear localStorage!?\nThis process cannot be undone!\n\nAnswer "YES" to confirm.') == "YES") {
          localStorage.removeItem('localDescs');
        }
        window.location.reload();
        return;
      }
      if (localDescs) this.localDescs = localDescs;
    }

    this.loadingProgress = 0;
    localStorageInitialized = true;
    this.ensureDictionaryIds();
    document.addEventListener('keydown', this.handleKeydown);
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
    shiftEnterSave() {
      this.saveSettings();
    },
    lang() {
      this.saveSettings();
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
        return find.includes(f) || replace.includes(f) || `${find} ${replace}`.includes(f);
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
    }
  },
  methods: {
    loadDummyData() {
      let desc = parseDesc("test/dummy.txt", dummyFile, this.lang);
      if (!desc) return;
      this.descs = [desc];
      this.loadingProgress = 100;
      this.filterDesc();
    },
    ensureDictionaryIds() {
      if (!Array.isArray(this.dictionary)) return;
      for (const entry of this.dictionary) {
        if (entry && !entry._id) {
          entry._id = `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
        }
      }
    },
    isDictionaryEntryFound(word) {
      return this.foundDictionarySet?.has?.(word?._id) || false;
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
      let addMatchingDictIds = (set, text) => {
        if (!text) return;
        for (const dictEntry of this.dictionary || []) {
          if (!dictEntry?._id || !dictEntry?.find) continue;
          let escapedFind = escapeRegExp(dictEntry.find);
          let regex = new RegExp(`\\b${escapedFind}\\b`, "g");
          if (regex.test(text)) set.add(dictEntry._id);
        }
      };
      let m;

      // highlight KeywordPopup tags [TagName|format] or [TagName]
      let keywordPopupRegex = new RegExp(keywordPopupTagRegex, 'igm');
      while (m = keywordPopupRegex.exec(modifiedEnglish)) {
        let tagName = m[2];
        let dynamicContent = m[3] || '';
        let rawTagName = unescapeHtml(tagName || "");
        let rawDynamicContent = unescapeHtml(dynamicContent || "");
        let hasDynamicContent = /<[^>]*>/.test(rawDynamicContent);
        let staticDynamicContent = rawDynamicContent
          .replace(/<[^>]*>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        let dictIdSet = new Set();
        addMatchingDictIds(dictIdSet, rawTagName);
        addMatchingDictIds(dictIdSet, staticDynamicContent);
        let kwInfo = lookupKeywordPopupReplacementInfo(rawTagName, hasDynamicContent ? '' : rawDynamicContent, this.dictionary);
        addHL({
          index: m.index,
          find: m[0],
          tagName: tagName,
          dynamicContent: hasDynamicContent ? '' : dynamicContent,
          isKeywordPopup: true,
          replace: kwInfo.text,
          dictId: kwInfo.dictEntry?._id,
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
        let sortedDictionary = (this.dictionary || [])
          .slice()
          .sort((a, b) => (b.find || '').length - (a.find || '').length);
        for (const replacerObj of sortedDictionary) {
          if (!replacerObj.find || replacerObj.find.length <= 0) continue;
          let escapedFind = escapeRegExp(replacerObj.find);
          let regex = new RegExp(`\\b${escapedFind}\\b`, "g");
          while (m = regex.exec(modifiedEnglish)) {
            // skip if it is within a keyword popup tag
            if (HLs.some(hl => hl.index <= m.index && m.index < hl.index + hl.find.length)) continue;
            // skip if it is within a ggg var tag
            if (HLs.some(hl => hl.index <= m.index && m.index < hl.index + hl.find.length)) continue;
            addHL({
              index: m.index,
              find: m[0],
              replace: replacerObj.replace,
              dictId: replacerObj._id
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
        let title = `Click / Alt+${HLs.length-i} = Paste below\nCtrl+Click = Copy to Clipboard`;
        if (HL?.isKeywordPopup) {
          title += HL?.dictId
            ? `\nAlt+Click = Jump to Dictionary`
            : `\nAlt+Click = Add to Dictionary`;
        }
        let tag = `<span class='${HL.replace ? "vocab" : ""}' title='${title}' data-hl-id="${HL._hlId}" dataValue="${HL.replace ? HL.replace : HL.find}">${HL.find}</span>`;
        englishHLter = englishHLter.substring(0, HL.index) + tag + englishHLter.substring(HL.index + HL.find.length);
      }
      HLs.sort((a, b) => a.index - b.index); // sort acending

      return { englishHLter, HLs };
    },
    refreshEditorHLter() {
      if (!this.editorVisible) return;
      for (const editorBlock of this.editorBlocks) {
        let { englishHLter, HLs } = this.buildEnglishHLter(editorBlock.english);
        editorBlock.englishHLter = englishHLter;
        editorBlock.HLs = HLs;
      }
    },
    scheduleEditorHLterRefresh() {
      if (!this.editorVisible) return;
      if (this._hlterRefreshTimer) clearTimeout(this._hlterRefreshTimer);
      this._hlterRefreshTimer = setTimeout(() => {
        this.refreshEditorHLter();
      }, 150);
    },
    setEditorFocus(index) {
      this.editorFocusedIndex = index;
      if (this.hlPopup.visible) {
        this.openHlPopup(index);
      }
    },
    buildHlPopupItems(editorIndex) {
      let editorBlock = this.editorBlocks?.[editorIndex];
      let HLs = editorBlock?.HLs || [];
      let items = [];
      let seen = new Set();
      for (const hl of HLs) {
        let value = hl?.replace || hl?.find || "";
        if (!value) continue;
        if (seen.has(value)) continue;
        seen.add(value);
        let label = hl?.replace && hl.replace !== hl.find ? `${hl.find} → ${hl.replace}` : `${hl.find}`;
        items.push({ label, value });
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
    moveHlPopupSelection(delta) {
      let len = this.hlPopup.filtered.length;
      if (len <= 0) return;
      let next = this.hlPopup.selectedIndex + delta;
      if (next < 0) next = len - 1;
      if (next >= len) next = 0;
      this.hlPopup.selectedIndex = next;
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
    focusSidebarFilterInput() {
      if (!this.editorVisible) return false;
      let ref = this.sideTab === "regex" ? this.$refs.regexFilterInput : this.$refs.dictionaryFilterInput;
      if (!ref) return false;
      ref.focus?.();
      ref.select?.();
      return true;
    },
    handleKeydown(e) {
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
        if (e.code === "Enter") {
          e.preventDefault();
          this.insertHlPopupSelection();
          return;
        }
      }

      if (e.shiftKey && e.code === 'Enter') {
        this.openFirstFile();
      }
      
      if (e.ctrlKey && e.code === 'KeyF') {
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
    async fileDropped(e) {
      e.preventDefault();
      if (e.dataTransfer.files.length !== 1) return; // only accpet one file at a time

      if (
        e.dataTransfer.files[0].lastModified !== this.localDescs.lastModified &&
        e.dataTransfer.files[0].size !== this.localDescs.size
      ) {
        if (prompt(
          "This seems like a new file, Do you want to start anew?\n" +
          "Type 'YES' to confirm\n" +
          "All your work on last file will be lost!!") !== 'YES'
        ) return;
        this.localDescs.lastModified = e.dataTransfer.files[0].lastModified;
        this.localDescs.size = e.dataTransfer.files[0].size;
        this.localDescs.descs = [];
        this.saveLocalDescs();
      }

      let zip;
      this.loadingProgress = 0.001;
      try {
        zip = await new JSZip().loadAsync(e.dataTransfer.files[0]);
      } catch (error) {
        this.loadingProgress = 0;
        alert('Cannot open this file');
        return;
      }

      let parseFuncs = [];
      for (let filepath in zip.files) {
        if (zip.files.hasOwnProperty(filepath)) {
          let ext = filepath.split('.').pop().toLocaleLowerCase();
          if (ext.toLocaleLowerCase() == 'txt') {
            parseFuncs.push(parseFile(filepath, zip.files[filepath], this.lang));
          }
        }
      }

      let descs = await allProgress(parseFuncs, (p) => {
        this.loadingProgress = 0.001 + (p * 0.99999);
      });

      this.descs = descs.filter(Boolean);

      this.importDescs(this.localDescs.descs);

      this.filterDesc();
    },
    async importFileDropped(e) {
      e.preventDefault();

      if (!confirm('Do you want to load your local changes from this file?')) return;

      if (e.dataTransfer.files.length !== 1) return;
      let zip;
      this.loadingProgress = 0.001;
      try {
        zip = await new JSZip().loadAsync(e.dataTransfer.files[0]);
      } catch (error) {
        this.loadingProgress = 0;
        alert('Cannot open this file');
        return;
      }

      let parseFuncs = [];
      for (let filepath in zip.files) {
        if (zip.files.hasOwnProperty(filepath)) {
          let ext = filepath.split('.').pop().toLocaleLowerCase();
          if (ext.toLocaleLowerCase() == 'txt') {
            parseFuncs.push(parseFile(filepath, zip.files[filepath], this.lang));
          }
        }
      }

      let descs = await allProgress(parseFuncs, (p) => {
        this.loadingProgress = 0.001 + (p * 0.99999);
      });

      let descsToImport = descs.filter(Boolean);
      this.importDescs(descsToImport);
      this.filterDesc();
    },
    importDescs(descsToImport) {
      // check if it is safe to import new desc
      for (const importingDesc of descsToImport) {
        let oldDesc = this.getDescByFilepath(importingDesc.filepath);
        if (!oldDesc) {
          alert(`${importingDesc.filepath} not found in working table! Aborting!`);
          return;
        }
        if (oldDesc.name !== importingDesc.name) {
          alert(`${importingDesc.filepath} stat name mismatched! Aborting!`);
          return;
        }
        if (!arrayEquals(oldDesc.stats, importingDesc.stats)) {
          alert(`${importingDesc.filepath} stats definition mismatched! Aborting!`);
          return;
        }
        if (!arrayEquals(oldDesc.variables, importingDesc.variables)) {
          alert(`${importingDesc.filepath} variables definition mismatched! Aborting!`);
          return;
        }
        if (!arrayEquals(oldDesc.remarks, importingDesc.remarks)) {
          alert(`${importingDesc.filepath} remarks mismatched! Aborting!`);
          return;
        }
        if (!arrayEquals(oldDesc.translations.English, importingDesc.translations.English)) {
          alert(`${importingDesc.filepath} original English string changed! Aborting!`);
          return;
        }
      }

      // Look like it is safe to import, then we import!
      for (const importingDesc of descsToImport) {
        let oldDesc = this.getDescByFilepath(importingDesc.filepath);
        if (!arrayEquals(oldDesc.translations[this.lang], importingDesc.translations[this.lang])) oldDesc.hasChanges = true;
        oldDesc.translations[this.lang] = importingDesc.translations[this.lang];
        oldDesc.isMissing = oldDesc.translations[this.lang].length !== oldDesc.translations.English.length;
        for (const translation of oldDesc.translations[this.lang]) {
          if (translation?.trim() == "") {
            oldDesc.isMissing = true;
            break;
          }
        }

        // save to localDescs too
        let localDesc = this.localDescs.descs.find(o => o.filepath == oldDesc.filepath);
        if (localDesc) {
          localDesc.isMissing = oldDesc.isMissing;
          localDesc.hasChanges = oldDesc.hasChanges;
          localDesc.translations[this.lang] = oldDesc.translations[this.lang];
        } else {
          let cloneDesc = {
            filedir: oldDesc.filedir,
            filename: oldDesc.filename,
            filepath: oldDesc.filepath,
            hasChanges: oldDesc.hasChanges,
            isMissing: oldDesc.isMissing,
            name: oldDesc.name,
            remarks: oldDesc.remarks,
            stats: oldDesc.stats,
            variables: oldDesc.variables,
            translations: {
              English: oldDesc.translations.English,
            }
          }
          cloneDesc.translations[this.lang] = oldDesc.translations[this.lang];
          this.localDescs.descs.push(cloneDesc);
        }
      }

      this.saveLocalDescs();
    },
    filterDesc() {
      this.filteredDescs = [];
      this.statistic.hasChanges = 0;
      this.statistic.isMissing = 0;
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

        if (this.filterSelect == "new" && !desc.isMissing && !desc.hasChanges) continue;
        if (this.filterSelect == "blank" && !desc.isMissing) continue;
        if (this.filterSelect == "done" && !desc.hasChanges) continue;

        if (
          this.searchText.trim() == "" ||
          desc.filepath.toLocaleLowerCase().includes(this.searchText.toLocaleLowerCase()) ||
          desc.translations.English?.join("\n").toLocaleLowerCase().includes(this.searchText.toLocaleLowerCase()) ||
          desc.translations[this.lang]?.join("\n").toLocaleLowerCase().includes(this.searchText.toLocaleLowerCase())
        ) {
          this.filteredDescs.push({
            filepath: desc.filepath,
            filedir: desc.filedir,
            filename: desc.filename,
            english: desc.translations.English?.join("<br />"),
            translation: desc.translations[this.lang]?.join("<br />"),
            isMissing: desc.isMissing,
            hasChanges: desc.hasChanges,
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
      this.editorCurrentEditingDesc = desc;
      for (let i = 0; i < desc.translations.English.length; i++) {
        let english = desc.translations.English[i];
        let { englishHLter, HLs } = this.buildEnglishHLter(english);
        let translation = desc.translations[this.lang]?.[i] || "";
        this.editorOriginalTranslations.push(translation);
        this.editorBlocks.push({
          english,
          englishHLter,
          HLs,
          translation,
          translationReplace: "",
          words: []
        })
      }
      this.editorVisible = true;
      this.editorFocusedIndex = 0;
      this.$nextTick(() => this.$refs['translation_0'].focus());
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

      let replace = unescapeHtml(HL.dynamicContent || "").trim();
      if (replace.includes("<")) replace = "";
  
      let find = replace || tagName;

      this.sideTab = 'dictionary';
      // this.dictionaryFilter = find;
      this.dictionaryFilter = "";

      let existing = (this.dictionary || []).find(d => (d?.find || "").trim().toLowerCase() === find.toLowerCase());
      if (existing) {
        this.dictionaryFlashId = existing._id || '';
        if (this._dictFlashTimer) clearTimeout(this._dictFlashTimer);
        this._dictFlashTimer = setTimeout(() => {
          if (this.dictionaryFlashId === existing._id) this.dictionaryFlashId = '';
        }, 320);
        return;
      }

      let entry = {
        _id: `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
        find: find,
        replace: find
      };
      this.dictionary.unshift(entry);
      this.dictionaryFlashId = entry._id;
      if (this._dictFlashTimer) clearTimeout(this._dictFlashTimer);
      this._dictFlashTimer = setTimeout(() => {
        if (this.dictionaryFlashId === entry._id) this.dictionaryFlashId = '';
      }, 320);
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
      let desc = this.editorCurrentEditingDesc;
      let newTranslations = [];
      let isMissing = false;
      for (const editorBlock of this.editorBlocks) {
        newTranslations.push(editorBlock.translation);
        if (!editorBlock.translation?.trim()) isMissing = true;
      }

      if (isMissing && !confirm("There're missing field in translation!\nAre you sure you want to save?")) return;

      let newTagCount = newTranslations.reduce((p, c) => p += countGGGVarTag(c), 0);
      let engTagCount = desc.translations.English.reduce((p, c) => p += countGGGVarTag(c), 0);
      if (newTagCount != engTagCount && !confirm("Number of variable tags ({} tag) mismatched!\nDo you want to save anyway?")) return;

      desc.isMissing = isMissing;
      if (!arrayEquals(desc.translations[this.lang], newTranslations)) desc.hasChanges = true;
      desc.translations[this.lang] = newTranslations;

      // save to localDescs too
      let localDesc = this.localDescs.descs.find(o => o.filepath == desc.filepath);
      if (localDesc) {
        localDesc.isMissing = desc.isMissing;
        localDesc.hasChanges = desc.hasChanges;
        localDesc.translations[this.lang] = newTranslations;
      } else {
        let cloneDesc = {
          filedir: desc.filedir,
          filename: desc.filename,
          filepath: desc.filepath,
          hasChanges: desc.hasChanges,
          isMissing: desc.isMissing,
          name: desc.name,
          remarks: desc.remarks,
          stats: desc.stats,
          variables: desc.variables,
          translations: {
            English: desc.translations.English,
          }
        }
        cloneDesc.translations[this.lang] = newTranslations;
        this.localDescs.descs.push(cloneDesc);
      }
      this.saveLocalDescs();

      this.saveSettings();
      this.closeHlPopup();
      this.editorOriginalTranslations = newTranslations.slice();
      this.editorVisible = false;
      this.filterDesc();
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
    saveSettings() {
      if (!localStorageInitialized) return;
      let settings = {
        editorRegexes: this.editorRegexes,
        dictionary: this.dictionary,
        editorClipboard: this.editorClipboard,
        lang: this.lang,
        theme: this.theme,
        hideDNT: this.hideDNT,
        highlightDict: this.highlightDict,
        shiftEnterSave: this.shiftEnterSave,
      }
      let buffer = JSON.stringify(settings);
      localStorage.setItem('settings', buffer);
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
    },
    saveLocalDescs() {
      if (!localStorageInitialized) return;
      localStorage.setItem('localDescs', JSON.stringify(this.localDescs));
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
      editorBlock.translation = editorBlock.translationReplace;
      for (let i = 0; i < editorBlock.words.length; i++) {
        const word = editorBlock.words[i];
        for (const replacerObj of this.dictionary) {
          let regex = new RegExp("^" + replacerObj.find + "$", "igm");
          let m = regex.exec(word.captured);
          if (!m) continue;
          if (!force) word.replace = replacerObj.replace;
        }
        if (!word.replace) word.replace = "";
        editorBlock.translation = editorBlock.translation.replace('🔖', word.replace);
      }
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
      this.dictionary.unshift({ _id: `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`, find: "", replace: "" });
      this.saveSettings();
    },
    removeVocab(word) {
      if (!confirm(`Are you sure you want to remove this word?\n\n#${word.find}\n${word.replace}`)) return;
      this.dictionary = this.dictionary.filter(o => o !== word);
      this.saveSettings();
    },
    async exportZip(doFullExport) {
      if (doFullExport && !confirm("Are you sure you want to do a full export?\nNote: This may take a couple minutes")) return;
      let descsToExport = doFullExport ? this.descs : this.descs.filter(o => o.hasChanges);
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
}

const app = Vue.createApp(config);
app.mount('#app');
