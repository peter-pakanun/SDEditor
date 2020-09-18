function regexEngineLookup(str, dictionary, words = []) {
  str = str.replace(/\\n/g, " ");
  for (const dict of dictionary) {
    let regex = new RegExp("^" + dict.find + "$", 'igm');
    let match = regex.exec(str);
    if (!match) continue;

    let replace = dict.replace;
    let failed = false;

    let m;
    while (m = /\$(R?)(\d+)/.exec(replace)) {
      let isRecursive = m[1] == 'R';
      let index = parseInt(m[2]);
      let captured = match[index];
      if (isRecursive) {
        let r = regexEngineLookup(captured, dictionary);
        replace = replace.replace(m[0], r.replace);
        words.push(...r.words)
        if (r.failed) {
          failed = true;
          failStr = captured;
        }
      } else {
        words.push(captured);
        replace = replace.replace(m[0], '🔖')
      }
    }

    return {
      replace,
      words,
      failed,
      failStr
    }
  }

  return {
    replace: str,
    words,
    failed: true,
    failStr: str
  }
}

let gggVarTagRegex = "([\\+\\-]?\\{[\\dd\\:\\+]*\\}\\%?)";

function countGGGVarTag(str) {
  let m = str?.match(new RegExp(gggVarTagRegex, 'gi'));
  return m?.length || 0;
}

function regexEngineCreate(str, dictionary) {
  let m;
  let f = str;
  let r = str;

  // {} tag
  if (m = f.match(new RegExp(gggVarTagRegex, 'ig'))) {
    for (const match of m) {
      f = f.replace(match, "([^ ]+)");
      r = r.replace(match, "\u200B");
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
      f = f.replace(m[i], "(\\d+) (seconds?)");
      r = r.replace(m[i], "\u200B \u200B");
    }
  }

  // dictionary
  if (Array.isArray(dictionary)) {
    for (const replacerObj of dictionary) {

      // ignore what we already did
      if (replacerObj.find.toLowerCase().includes("increased")) continue;
      if (replacerObj.find.toLowerCase().includes("reduced")) continue;
      if (replacerObj.find.toLowerCase().includes("more")) continue;
      if (replacerObj.find.toLowerCase().includes("less")) continue;
      if (replacerObj.find.toLowerCase().includes("second")) continue;

      let regex = new RegExp("\\b(" + replacerObj.find + ")\\b", "ig");
      if (m = regex.exec(f)) {
        for (let i = 0; i < m.length; i++) {
          f = f.replace(m[i], "\\b(.+)\\b");
          r = r.replace(m[i], "\u200B");
        }
      }
    }
  }

  let c = 1;
  let oldR = r;
  let newR = r;
  while (oldR != (newR = newR.replace("\u200B", "$$" + c++))) oldR = newR;

  return {
    find: f,
    replace: newR
  }
}