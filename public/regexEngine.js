let dictionary = [
  {
    find: "(.+) per (\\d+%) \\b(.+)\\b Quality",
    replace: "$R1 ต่อคุณภาพของ $3 ทุกๆ $2"
  },
  {
    find: "Buff Grants (.+)",
    replace: "บัฟมอบม็อด $R1"
  },
  {
    find: "([^ ]+) (increased|reduced) Damage",
    replace: "$2ความเสียหาย $1"
  }
];

let testStr = "Buff grants {0} to {1} Added Spell Physical Damage per 1% Shield Quality";

let r = regexEngineLookup(testStr, dictionary);
console.log(r);
let finalStr = r.replace;
let _finalStr = finalStr;
while ((finalStr = finalStr.replace('🔖', r.words.shift())) !== _finalStr) {
  _finalStr = finalStr;
}
console.log(finalStr);

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
          failStr = r.failStr;
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