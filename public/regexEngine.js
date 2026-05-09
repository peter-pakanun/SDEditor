/**
 * @param {string} string
 * @returns {string}
 */
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // escapa todos os caracteres especiais do regex
}
/**
 * @param {string} str
 * @param {any} dictionary
 * @param {string[]} words
 * @returns {*} result
 */
function regexEngineLookup(str, dictionary, words = []) {
  str = str.replace(/\\n/g, " ");
  // if (dictionary && Array.isArray(dictionary)) {
  //   dictionary.sort((a, b) => b.find.length - a.find.length);
  // };
  for (const dict of dictionary) {
    let regex = new RegExp("^" + dict.find + "$", 'igm');
    let match = regex.exec(str);
    if (!match) continue;

    let replace = dict.replace;
    let failed = false;
    let failStr = "";

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
        let transformed = checkKeywordPopupTag(captured, '🔖');
        if (!transformed || !transformed.word) {
          words.push(captured);
          replace = replace.replace(m[0], '🔖')
        } else {
          words.push(transformed.word);
          replace = replace.replace(m[0], transformed.replace);
        }
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

let gggVarTagRegex = "([@\\+\\-]?\\{[\\dd\\:\\+]*\\}\\%?)";

let keywordPopupTagRegex = "(\\[([^\\]|]+)(?:\\|([^\\]]*))?\\])";

/**
 * @param {string} str the string to check
 * @param {string} replacer the string to use in place of the found string
 * @returns {{find: string, word: string | null, replace: string | null} | null}
 * if the string is not a keyword popup tag, it returns null
 */
function checkKeywordPopupTag(str, replacer = '') {
  let regex = new RegExp(keywordPopupTagRegex, 'ig');
  let match = regex.exec(str);
  if (!match) return null;
  let tagName = match[2];
  let defaultValue = match[3] || '';
  return {
    find: str,
    word: defaultValue || tagName,
    replace: replacer ? `[${tagName}|${replacer}]` : `[${tagName}${defaultValue ? `|${defaultValue}` : ''}]`
  };
}

/**
 * @param {string} str
 * @returns {number}
 */
function countGGGVarTag(str) {
  let m = str?.match(new RegExp(gggVarTagRegex, 'gi'));
  return m?.length || 0;
}

/**
 * @param {string} str
 * @param {any} dictionary
 * @returns {any}
 */
function regexEngineCreate(str, dictionary) {
  let m;
  let f = str;
  let r = str;

  // keyword popup tag
  if (m = f.match(new RegExp(keywordPopupTagRegex, 'ig'))) {
    for (const match of m) {
      f = f.replace(match, "(.+)");
      r = r.replace(match, "\u200B");
    }
  }

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

/**
 * @param {string} tagName the keyword popup tag name
 * @param {string} dynamicContent the dynamic content of the keyword popup tag
 * @param {any} dictionary the dictionary to use for lookup
 * @returns {string}
 */
function lookupKeywordPopupReplacement(tagName, dynamicContent, dictionary) {
  return lookupKeywordPopupReplacementInfo(tagName, dynamicContent, dictionary).text;
}

function lookupKeywordPopupReplacementInfo(tagName, dynamicContent, dictionary) {
  let replacement = null;
  let foundEntry = null;
  let dict = Array.isArray(dictionary) ? dictionary : [];

  if (dynamicContent && dynamicContent !== '') {
    for (const dictEntry of dict) {
      let escapedFind = escapeRegExp(dictEntry.find);
      let regex = new RegExp(`\\b${escapedFind}\\b`, "g");
      if (regex.test(dynamicContent)) {
        replacement = dictEntry.replace;
        foundEntry = dictEntry;
        break;
      }
    }
  }

  if (replacement === null) {
    for (const dictEntry of dict) {
      let escapedFind = escapeRegExp(dictEntry.find);
      let regex = new RegExp(`\\b${escapedFind}\\b`, "g");
      if (regex.test(tagName)) {
        replacement = dictEntry.replace;
        foundEntry = dictEntry;
        break;
      }
    }
  }

  if (replacement === null) {
    replacement = dynamicContent || '';
  }

  return { text: `[${tagName}|${replacement}]`, dictEntry: foundEntry };
}
