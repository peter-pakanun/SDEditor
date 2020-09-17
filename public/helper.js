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

function arrayEquals(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function arrayMove(arr, old_index, new_index) {
  if (new_index >= arr.length) {
    var k = new_index - arr.length + 1;
    while (k--) {
      arr.push(undefined);
    }
  }
  arr.splice(new_index, 0, arr.splice(old_index, 1)[0]);
  return arr; // for testing
};

function regexMagic(str, dictionary) {
  let m;
  let f = str;
  let r = str;

  // {} tag
  if (m = /([\+\-]?\{[\dd\:\+]*\}\%?)/ig.exec(f)) {
    for (let i = 1; i < m.length; i++) {
      f = f.replace(m[i], "([^ ]+)");
      r = r.replace(m[i], "\u200B");
    }
  }

  // increased/reduced
  if (m = /\b(increased|reduced)\b/ig.exec(f)) {
    for (let i = 1; i < m.length; i++) {
      f = f.replace(m[i], "(increased|reduced)");
      r = r.replace(m[i], "\u200B");
    }
  }

  // more/less
  if (m = /\b(more|less)\b/ig.exec(f)) {
    for (let i = 1; i < m.length; i++) {
      f = f.replace(m[i], "(more|less)");
      r = r.replace(m[i], "\u200B");
    }
  }

  // n seconds
  if (m = /\b(\d+ seconds?)\b/ig.exec(f)) {
    for (let i = 1; i < m.length; i++) {
      f = f.replace(m[i], "(\d+) (seconds?)");
      r = r.replace(m[i], "\u200B \u200B");
    }
  }
  
  // dictionary
  if (Array.isArray(dictionary)) {
    for (const replacerObj of dictionary) {
      let regex = new RegExp("\\b(" + replacerObj.find + ")\\b", "ig");
      if (m = regex.exec(f)) {
        for (let i = 0; i < m.length; i++) {
          f = f.replace(m[i], "(.+)");
          r = r.replace(m[i], "\u200B");
        }
      }
    }
  }

  let c = 1;
  let oldR = r;
  let newR = r;
  while (oldR != ( newR = newR.replace("\u200B", "$$" + c++) )) oldR = newR;

  return {
    find: f,
    replace: newR
  }
}