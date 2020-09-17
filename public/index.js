// TODO: https://www.raymondcamden.com/2018/02/08/building-table-sorting-and-pagination-in-vuejs
const App = {
  data() {
    return {
      lang: "Thai",
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
      replaceWords: [
        {
          find: "Fire",
          replace: "ไฟ"
        },
      ]
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
      let vthis = this;
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

      this.loading = false;

      this.descs = descs.filter(Boolean);

      this.filterDesc();
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
      for (const english of desc.translations.English) {
        console.log(english);
        this.editorDescs.push({
          english,
          translation: "",
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
      this.editorVisible = false;
      console.log(translations);
      this.filterDesc();
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
        break;
      }
    },
    doTranslationReplace(desc, force) {
      if (!desc.translationReplace) return;
      desc.translation = desc.translationReplace;
      for (let i = 0; i < desc.words.length; i++) {
        const word = desc.words[i];
        for (const replacerObj of this.replaceWords) {
          let regex = new RegExp("^" + replacerObj.find + "$", "igm");
          let m = regex.exec(word.captured);
          if (!m) continue;
          if (!force) word.replace = replacerObj.replace;
        }
        desc.translation = desc.translation.replace(new RegExp("\\$" + (i + 1), "ig"), word.replace);
      }
    },
    addRegex() {
      this.editorRegexes.push({ find: "", replace: "" });
    },
    removeRegex(regex) {
      if (confirm(`Please answer 'No/Cancel' to remove this regex\n\n#${regex.find}\n${regex.replace}`)) return;
      this.editorRegexes = this.editorRegexes.filter(o => o !== regex);
    },
    addWord() {
      this.replaceWords.push({ find: "", replace: "" });
    },
    removeWord(word) {
      if (confirm(`Please answer 'No/Cancel' to remove this word\n\n#${word.find}\n${word.replace}`)) return;
      this.replaceWords = this.replaceWords.filter(o => o !== word);
    },
  },
}

Vue.createApp(App).mount('#app');



