function allProgress(proms, progress_cb) {
  let d = 0;
  progress_cb(0);
  for (const p of proms) {
    p.then(() => {
      d++;
      progress_cb((d * 100) / proms.length);
    });
  }
  return Promise.all(proms);
}

function elipsisRenderer(data, type, row) {
  if (type == "sort" || type == 'type') return data;
  return data.length > 20 ?
    data.substr(0, 5) + '…' + data.substr(data.length - 15, data.length) :
    data;
}