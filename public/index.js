const App = {
  data() {
    return {
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
      loadingProgress: 0,
      descs: [],
      filteredDescs: [],
      currentSort: "english",
      currentSortDir: 'asc',
      currentSortIcon: '▲',
      pageSize: 20,
      paginationPadding: 3,
      currentPage: 1,
      searchText: "",
      showOnlyMissing: true,

      editorVisible: false,
      editorCurrentEditingDesc: null,
      hasUnsavedEdit: false,
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
      ]
    }
  },
  mounted() {
    let settings = localStorage.getItem('settings');
    if (!settings) return;
    try {
      settings = JSON.parse(settings);
    } catch (error) {
      alert('Cannot read Localstorage');
      return;
    }
    this.editorRegexes = settings.editorRegexes || [];
    this.dictionary = settings.dictionary || [];
    let vueThis = this;
    window.onbeforeunload = function () {
      if (vueThis.hasUnsavedEdit) {
        return 'Exit without save?\nYour unsaved changes will be discarded';
      }
    };
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

      this.descs = descs.filter(Boolean);

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
      for (const newDesc of descsToImport) {
        let oldDesc = this.getDescByFilepath(newDesc.filepath);
        if (!oldDesc) {
          alert(`${newDesc.filepath} not found in working table! Aborting!`);
          return;
        }
        if (oldDesc.name !== newDesc.name) {
          alert(`${newDesc.filepath} stat name mismatched! Aborting!`);
          return;
        }
        if (!arrayEquals(oldDesc.stats, newDesc.stats)) {
          alert(`${newDesc.filepath} stats definition mismatched! Aborting!`);
          return;
        }
        if (!arrayEquals(oldDesc.variables, newDesc.variables)) {
          alert(`${newDesc.filepath} variables definition mismatched! Aborting!`);
          return;
        }
        if (!arrayEquals(oldDesc.remarks, newDesc.remarks)) {
          alert(`${newDesc.filepath} remarks mismatched! Aborting!`);
          return;
        }
        if (!arrayEquals(oldDesc.translations.English, newDesc.translations.English)) {
          alert(`${newDesc.filepath} original English string changed! Aborting!`);
          return;
        }
      }

      // Look like it is safe to import, then we import!
      for (const newDesc of descsToImport) {
        let oldDesc = this.getDescByFilepath(newDesc.filepath);
        oldDesc.translations[this.lang] = newDesc.translations[this.lang];
        oldDesc.hasChanges = true;
        oldDesc.isMissing  = false;
      }
    },
    filterDesc() {
      this.filteredDescs = [];
      for (const desc of this.descs) {
        if (this.showOnlyMissing && !desc.isMissing) continue;
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
      desc.hasChanges = true;
      desc.isMissing = false;
      let translations = desc.translations;
      translations[this.lang] = [];
      for (const editorBlock of this.editorDescs) {
        translations[this.lang].push(editorBlock.translation);
      }
      this.saveToLocalStorage();
      this.editorVisible = false;
      this.hasUnsavedEdit = true;
      this.filterDesc();
    },
    editorExit() {
      if (!confirm('Are you sure you want to exit without saving?')) return;
      this.saveToLocalStorage();
      this.editorVisible = false;
    },
    saveToLocalStorage() {
      let settings = {
        editorRegexes: this.editorRegexes,
        dictionary: this.dictionary,
      }
      localStorage.setItem('settings', JSON.stringify(settings));
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
      this.saveToLocalStorage();
    },
    removeRegex(regex) {
      if (!confirm(`Are you sure you want to remove this regex?\n\n#${regex.find}\n${regex.replace}`)) return;
      this.editorRegexes = this.editorRegexes.filter(o => o !== regex);
      this.saveToLocalStorage();
    },
    moveRegexUp(regex) {
      for (let i = 0; i < this.editorRegexes.length; i++) {
        const r = this.editorRegexes[i];
        if (r == regex) {
          if (i <= 0) return;
          arrayMove(this.editorRegexes, i, i-1);
          this.saveToLocalStorage();
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
          this.saveToLocalStorage();
          return;
        }
      }
    },
    addVocab() {
      this.dictionary.unshift({ find: "", replace: "" });
      this.saveToLocalStorage();
    },
    removeVocab(word) {
      if (!confirm(`Are you sure you want to remove this word?\n\n#${word.find}\n${word.replace}`)) return;
      this.dictionary = this.dictionary.filter(o => o !== word);
      this.saveToLocalStorage();
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
      this.hasUnsavedEdit = false;
    }
  },
}

Vue.createApp(App).mount('#app');



