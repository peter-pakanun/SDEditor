// TODO: https://www.raymondcamden.com/2018/02/08/building-table-sorting-and-pagination-in-vuejs

const dtOptions = {
  responsive: true,
  columnDefs: [
    {
      targets: 0,
      render: elipsisRenderer
    },
    {
      targets: 1,
      render: elipsisRenderer
    }
  ]
};
let oTable;

function elipsisRenderer(data, type, row) {
  if (type == "sort" || type == 'type') return data;
  return data.length > 20 ?
    data.substr(0, 5) + '…' + data.substr(data.length - 15, data.length) :
    data;
}

const App = {
  data() {
    return {
      loadingProgress: 0,
      loading: false,
      descs: []
    }
  },
  methods: {
    async fileDropped(e) {
      let vthis = this;
      e.preventDefault();
      if (e.dataTransfer.files.length !== 1) return;
      let zip;
      try {
        zip = await new JSZip().loadAsync(e.dataTransfer.files[0]);
      } catch (error) {
        alert('Cannot open this file');
        return;
      }

      this.loading = true;

      let parseFuncs = [];
      for (let filepath in zip.files) {
        if (zip.files.hasOwnProperty(filepath)) {
          let ext = filepath.split('.').pop().toLocaleLowerCase();
          if (ext.toLocaleLowerCase() == 'txt') {
            parseFuncs.push(parseFile(filepath, zip.files[filepath]));
          }
        }
      }

      let descs = await allProgress(parseFuncs, (p) => {
        this.loadingProgress = p;
      });

      this.loading = false;

      this.descs = descs.filter(Boolean);

      await Vue.nextTick();

      oTable = $('#table').DataTable(dtOptions);
      $('#table tbody tr').click(function () {
        var aData = oTable.row(this).data();
        console.log(aData);
      });
    },
  },
}

Vue.createApp(App).mount('#app');



