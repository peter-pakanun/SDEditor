let localStorageInitialized = false;

const urlParams = new URLSearchParams(window.location.search);
const TEST_MODE = (() => {
  if (!urlParams.has('testMode')) return false;
  let v = (urlParams.get('testMode') || '').toLowerCase();
  return v === '' || v === '1' || v === 'true' || v === 'yes';
})();
const URL_LANG = urlParams.get('lang');

const config = Vue.defineComponent({
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
    }
  },
  methods: {
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
      try {
        return new RegExp("^" + p + "$", flags);
      } catch (e) {
        return new RegExp("^" + escapeRegExp(p) + "$", flags);
      }
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
      if (!word) return;
      let f = String(find ?? "").trim();
      if (!f) return;
      let pairs = this.getDictionaryDefinitionPairs(word);
      if (pairs.some(p => (p?.find || "").trim().toLowerCase() === f.toLowerCase())) return;
      if (!Array.isArray(word.alts)) word.alts = [];
      word.alts.unshift({
        _id: `a_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
        find: f,
        replace: String(replace ?? word?.replace ?? "")
      });
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
        editorBlock.translationHLter = "";
        editorBlock.multilineLineMismatch = false;
        return;
      }
      let diff = this.computeMultilineLineMismatch(editorBlock.english, editorBlock.translation);
      editorBlock.englishHLter = this.wrapHlterByLines(baseEnglishHLter, diff.engMismatch);
      editorBlock.translationHLter = this.wrapHlterByLines(escapeHtml(editorBlock.translation ?? ""), diff.trMismatch);
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
        let title = `Click / Alt+${HLs.length-i} = Paste below&#10;Ctrl+Click = Copy to Clipboard`;
        if (HL?.isKeywordPopup) {
          title += HL?.dictId
            ? `&#10;Alt+Click = Jump to Dictionary`
            : `&#10;Alt+Click = Add to Dictionary`;
        }
        let tag = `<span class='${HL.replace ? "vocab" : ""}' title='${title}' data-hl-id="${HL._hlId}" dataValue="${HL.replace ? HL.replace : HL.find}">${HL.find}</span>`;
        englishHLter = englishHLter.substring(0, HL.index) + tag + englishHLter.substring(HL.index + HL.find.length);
      }
      HLs.sort((a, b) => a.index - b.index); // sort acending

      return { englishHLter, HLs };
    },
    refreshEditorHLter() {
      if (!this.editorVisible) return;
      for (let i = 0; i < (this.editorBlocks || []).length; i++) {
        let editorBlock = this.editorBlocks[i];
        let { englishHLter: baseEnglishHLter, HLs } = this.buildEnglishHLter(editorBlock.english);
        editorBlock.HLs = HLs;
        if (!editorBlock.isMultiline) {
          editorBlock.englishHLter = baseEnglishHLter;
          editorBlock.translationHLter = "";
          editorBlock.multilineLineMismatch = false;
          continue;
        }
        let diff = this.computeMultilineLineMismatch(editorBlock.english, editorBlock.translation);
        editorBlock.englishHLter = this.wrapHlterByLines(baseEnglishHLter, diff.engMismatch);
        editorBlock.translationHLter = this.wrapHlterByLines(escapeHtml(editorBlock.translation ?? ""), diff.trMismatch);
        editorBlock.multilineLineMismatch = diff.mismatch;
        this.$nextTick(() => {
          this.syncHlScroll('english', i);
          this.syncHlScroll('translation', i);
        });
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
      let seen = new Map();
      for (const hl of HLs) {
        if (hl?.dictId) {
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
                value = `[${tn}|${p?.replace ?? ""}]`;
                label = value + (p.find && p.find !== tn ? ` (${p.find})` : "");
              } else {
                value = p?.replace || p?.find || "";
                label = p?.replace && p.replace !== p.find ? `${p.find} → ${p.replace}` : `${p.find}`;
              }
              if (!value) continue;
              let key = `${dictEntry._id}|${p.find.toLowerCase()}|${value}`;
              let exactFromContext = !!matchCandidateLower && matchCandidateLower === p.find.toLowerCase();
              let existingItem = seen.get(key);
              if (existingItem) {
                existingItem.exactFromContext = existingItem.exactFromContext || exactFromContext;
                continue;
              }
              let item = {
                label,
                value,
                matchText: p.find,
                matchTextLower: p.find.toLowerCase(),
                isAlt: !p.isMain,
                exactFromContext
              };
              seen.set(key, item);
              items.push(item);
            }
          }

          continue;
        }

        let value = hl?.replace || hl?.find || "";
        if (!value) continue;
        if (seen.has(value)) continue;
        seen.set(value, true);
        let label = hl?.replace && hl.replace !== hl.find ? `${hl.find} → ${hl.replace}` : `${hl.find}`;
        let matchText = String(hl?.find || "").trim();
        items.push({ label, value, matchText, matchTextLower: matchText.toLowerCase(), isAlt: false });
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
      if (editorBlock.isMultiline) {
        this.normalizeMultilineEditorBlock(editorBlock, editorIndex);
      } else {
        this.refreshEditorBlockMeta(editorBlock, editorIndex);
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
        let englishRaw = desc.translations.English[i] || "";
        let translationRaw = desc.translations[this.lang]?.[i] || "";
        let isMultiline = this.isMultilineText(englishRaw) || this.isMultilineText(translationRaw);
        let english = isMultiline ? this.decodeEscapedNewlines(englishRaw) : englishRaw;
        let translation = isMultiline ? this.decodeEscapedNewlines(translationRaw) : translationRaw;
        let { englishHLter: baseEnglishHLter, HLs } = this.buildEnglishHLter(english);
        let englishHLter = baseEnglishHLter;
        let translationHLter = "";
        let multilineLineMismatch = false;
        if (isMultiline) {
          let diff = this.computeMultilineLineMismatch(english, translation);
          englishHLter = this.wrapHlterByLines(baseEnglishHLter, diff.engMismatch);
          translationHLter = this.wrapHlterByLines(escapeHtml(translation ?? ""), diff.trMismatch);
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
          translation,
          translationHLter,
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
      });
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

      this.sideTab = 'dictionary';
      this.dictionaryFilter = "";

      let existing = (this.dictionary || []).find(d => (d?.find || "").trim().toLowerCase() === tagName.toLowerCase());
      if (existing) {
        if (alt) this.addDictionaryAltPair(existing, alt, existing?.replace ?? "");
        this.dictionaryFlashId = existing._id || '';
        if (this._dictFlashTimer) clearTimeout(this._dictFlashTimer);
        this._dictFlashTimer = setTimeout(() => {
          if (this.dictionaryFlashId === existing._id) this.dictionaryFlashId = '';
        }, 320);
        return;
      }

      let entry = {
        _id: `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
        find: tagName,
        replace: tagName,
        alts: alt ? [{ _id: `a_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`, find: alt, replace: tagName }] : [],
        tlnote: ""
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
        let ui = editorBlock?.translation ?? "";
        if (!String(ui).trim()) isMissing = true;
        let normalizedUi = editorBlock?.isMultiline ? this.decodeEscapedNewlines(ui) : ui;
        newTranslations.push(this.encodeNewlines(normalizedUi));
      }

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
      this.editorOriginalTranslations = (this.editorBlocks || []).map(b => b?.translation ?? "");
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
});

const app = Vue.createApp(config);
app.mount('#app');
