const App = {
  data() {
    return {
      localStorageInitialized: false,
      langs: [
        "Thai",
        "Portuguese",
        "German",
        "Russian",
        "Spanish",
        "French",
        "Traditional Chinese",
        "Simplified Chinese",
        "Korean"
      ],
      lang: "",
      theme: 'grey',
      showSetting: false,
      loadingProgress: 0,
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
      showOnlyMissing: true,

      editorVisible: false,
      editorCurrentEditingDesc: null,
      editorDescs: [
        {
          english: "{0}% Increased Fire damage",
          translation: "ทดสอบ",
          translationReplace: "",
          words: []
        },
      ],
      editorRegexes: [
        {
          find: "\\{(\\d)*\\}\\% Increased (.+) damage",
          replace: "เพิ่มความเสียหาย $2 {$1}%"
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
    let settings = localStorage.getItem('settings');
    if (settings) {
      try {
        settings = JSON.parse(settings);
      } catch (error) {
        alert('Cannot read Localstorage!!\nFile maybe corrupted!');
        return;
      }
      this.editorRegexes = settings.editorRegexes || [];
      this.dictionary = settings.dictionary || [];
      this.editorClipboard = settings.editorClipboard || "";
      if (settings.lang) this.lang = settings.lang;
      if (settings.theme) this.theme = settings.theme;
    }

    let localDescs = localStorage.getItem('localDescs');
    if (localDescs) {
      try {
        localDescs = JSON.parse(localDescs);
      } catch (error) {
        alert('Cannot read Localstorage!!\nFile maybe corrupted!');
        return;
      }
      if (localDescs) this.localDescs = localDescs;
    }

    localStorageInitialized = true;
  },
  watch: {
    lang() {
      this.saveSettings();
    },
    theme(newTheme) {
      document.documentElement.setAttribute('data-theme', newTheme);
      this.saveSettings();
    },
    showOnlyMissing() {
      this.filterDesc();
    },
    editorClipboard() {
      this.saveSettings();
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
    }
  },
  methods: {
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
        if (desc.hasChanges) {
          this.statistic.hasChanges++;
        }
        if (desc.isMissing) {
          this.statistic.isMissing++;
        } else {
          if (this.showOnlyMissing) continue;
        }
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

      this.editorDescs = [];
      this.editorCurrentEditingDesc = desc;
      for (let i = 0; i < desc.translations.English.length; i++) {
        let english = desc.translations.English[i];
        let translation = desc.translations[this.lang]?.[i];
        this.editorDescs.push({
          english,
          translation,
          translationReplace: "",
          words: []
        })
      }
      this.editorVisible = true;
    },
    editorSave() {
      let desc = this.editorCurrentEditingDesc;
      let newTranslations = [];
      let isMissing = false;
      for (const editorBlock of this.editorDescs) {
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
      this.editorVisible = false;
      this.filterDesc();
    },
    editorExit() {
      if (!confirm('Are you sure you want to exit without saving?')) return;
      this.saveSettings();
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
      }
      let buffer = JSON.stringify(settings);
      localStorage.setItem('settings', buffer);
    },
    saveLocalDescs() {
      if (!localStorageInitialized) return;
      localStorage.setItem('localDescs', JSON.stringify(this.localDescs));
    },
    useRegex(desc) {
      for (const regexObj of this.editorRegexes) {
        let regex = new RegExp("^"+regexObj.find+"$", "igm");
        let m = regex.exec(desc.english);
        if (!m) continue;
        desc.words = [];
        for (let i = 1; i < m.length; i++) {
          const captureString = m[i];
          desc.words.push({
            captured: captureString,
            replace: captureString
          });
        }
        desc.translationReplace = regexObj.replace;
        this.doTranslationReplace(desc);
        return;
      }

      if (!confirm("No match! Create new regex?")) return;

      // magically creating regex :D
      let r = regexMagic(desc.english, this.dictionary);
      this.addRegex(r.find, r.replace);
    },
    doTranslationReplace(desc, force) {
      if (!desc.translationReplace) return;
      desc.translation = desc.translationReplace;
      for (let i = 0; i < desc.words.length; i++) {
        const word = desc.words[i];
        for (const replacerObj of this.dictionary) {
          let regex = new RegExp("^" + replacerObj.find + "$", "igm");
          let m = regex.exec(word.captured);
          if (!m) continue;
          if (!force) word.replace = replacerObj.replace;
        }
        if (!word.replace) word.replace = "";
        desc.translation = desc.translation.replace(new RegExp("\\$" + (i + 1), "ig"), word.replace);
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
      this.dictionary.unshift({ find: "", replace: "" });
      this.saveSettings();
    },
    removeVocab(word) {
      if (!confirm(`Are you sure you want to remove this word?\n\n#${word.find}\n${word.replace}`)) return;
      this.dictionary = this.dictionary.filter(o => o !== word);
      this.saveSettings();
    },
    async exportZip() {
      let descsToExport = this.descs.filter(o => o.hasChanges);
      if (!descsToExport.length) {
        alert(`There're no files to be export!`);
        return;
      }

      this.loadingProgress = 0.001;
      let vueThis = this;
      let zip = new JSZip();
      for (const desc of descsToExport) {
        let buffer = descStringify(desc);
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

Vue.createApp(App).mount('#app');



