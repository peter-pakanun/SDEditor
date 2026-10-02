/**
 * @typedef {Object} tempTranslation
 * @property {number} count
 * @property {string[]} content
 */
/**
 * @typedef {Object} StatDesc
 * @property {string} filepath 
 * @property {string} filedir 
 * @property {string|undefined} filename 
 * @property {string|null} name 
 * @property {string[]} stats 
 * @property {string[]} variables 
 * @property {string[]} remarks 
 * @property {Object.<string,tempTranslation>} tempTranslations
 * @property {Object.<string,string[]>} translations 
 * @property {{filepath:string, lang:string, line:number}[]} [duplicateLangEntries]
 * @property {{filepath:string, lang:string, options:{id:string, lang:string, line:number, occurrence:number, content:string[]}[]}[]} [duplicateLangGroups]
 * @property {{filepath:string, lang:string, line:number, endLine:number, kind:string}[]} [importRepairs]
 * @property {boolean} isDNT 
 * @property {boolean} [isMissing] 
 */
/**
 * @param {string} filepath 
 * @param {import('jszip').JSZipObject} zipObject
 * @param {string} lang 
 * @returns {Promise<StatDesc|false>}
 */
async function parseFile(filepath, zipObject, lang, { strict = false } = {}) {
  let text = await decodeZipTxtFile(zipObject, lang);

  // find description mark
  let count = (text.match(strict ? /^[ \t]*description\b/gim : /^description/gim) ?? []).length;
  if (count == 0) return false;
  if (count > 1) {
    if (strict) throw new Error('Multiple descriptions in ' + filepath);
    await window.AppDialogs.alert(
      'ERROR: Multiple description declaration\n' +
      filepath + '\n\n' + text,
      { title: 'Invalid description file' }
    );
    return false;
  }
  let desc = parseDesc(filepath, text, lang, { strict });
  if (strict && !desc) throw new Error('Malformed source: ' + filepath);
  return desc;
}

/**
 * @param {string} filepath 
 * @param {string} text 
 * @param {string} lang 
 * @returns {StatDesc|false}
 */
function parseDesc(filepath, text, lang, { strict = false } = {}) {
  text = text.replace(/\t/g, ' ').replace(/\r/g, '');
  const malformed = (message, lineIndex) => {
    throw new Error(`Malformed source: ${filepath}${lineIndex == null ? '' : ':' + (lineIndex + 1)}: ${message}`);
  };
  const isCount = token => /^\d+$/.test(token || '') && Number.isSafeInteger(Number(token));
  
  let filepaths = filepath.split('/');
  let filename = filepaths.pop();
  /**
   * @type {StatDesc}
   */
  let desc = {
    filepath,
    filedir: filepaths.join('/'),
    filename,
    name: null,
    stats: [],
    variables: [],
    remarks: [],
    tempTranslations: {},
    translations: {},
    duplicateLangEntries: [],
    duplicateLangGroups: [],
    isDNT: false
  };

  let curLang = "English"; // first translation block langauge
  let lines = text.split("\n");
  let duplicateLangIndex = 0;
  let langOccurrences = { English: 1 };
  let translationBlockInfos = {
    English: { lang: "English", line: 1, occurrence: 1 }
  };
  let duplicateLangGroupsByLang = {};
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    let line = lines[lineIndex];
    line = line.trim();
    if (line == '') continue; // ignore empty line

    // split line by space into an array
    let lineArray = line.split(' ').filter(n => n);

    // >>> expecting description name
    if (desc.name === null) {
      if (lineArray[0] != 'description') {
        if (strict) malformed('Expected a description declaration.', lineIndex);
        void window.AppDialogs.alert(
          'ERROR: Malform description file\n' +
          'expecting description field\n' +
          filepath + '\n\n' + text,
          { title: 'Invalid description file' }
        );
        return false;
      }
      if (lineArray.length > 2) {
        if (strict) malformed('A description may have only one name.', lineIndex);
        void window.AppDialogs.alert(
          'ERROR: Multiple description declaration\n' +
          filepath + '\n\n' + text,
          { title: 'Invalid description file' }
        );
        return false;
      }
      desc.name = lineArray[1] ?? "";
      continue;
    }

    // >>> expecting stat names
    if (desc.stats.length == 0) {
      let count = parseInt(lineArray[0]);
      if (strict && (!isCount(lineArray[0]) || count < 1 || lineArray.length - 1 !== count)) {
        malformed('The declared stat count must match the number of stat identifiers.', lineIndex);
      }
      if (!count) {
        void window.AppDialogs.alert(
          'ERROR: Malform description file\n' +
          'expecting stats count\n' +
          filepath + '\n\n' + text,
          { title: 'Invalid description file' }
        );
        return false;
      }
      desc.stats = lineArray;
      desc.stats.shift(); // remove the count
      continue;
    }

    // >>> expecting translation count
    if (!desc.tempTranslations[curLang]) {
      let count = parseInt(lineArray[0]);
      if (strict && (!isCount(lineArray[0]) || lineArray.length !== 1 || (translationBlockInfos[curLang]?.lang === 'English' && count < 1))) {
        malformed('Expected a whole translation count; English must contain at least one entry.', lineIndex);
      }
      if (lineArray.length > 2) {
        void window.AppDialogs.alert(
          'ERROR: Multiple description declaration\n' +
          filepath + '\n\n' + text,
          { title: 'Invalid description file' }
        );
        return false;
      }
      if (!count && !(strict && count === 0 && curLang !== 'English')) {
        void window.AppDialogs.alert(
          'ERROR: Malform description file\n' +
          'expecting translations count\n' +
          filepath + '\n\n' + text,
          { title: 'Invalid description file' }
        );
        return false;
      }
      desc.tempTranslations[curLang] = {
        count, // temporary variable, use to validate the next "expect"
        content: [], variables: [], remarks: []
      };
      continue;
    }

    // >>> expecting lang declaration
    let matchs = (strict ? /^lang\s+"([^"]+)"$/ : /lang "([^"]+)"/).exec(line);
    if (strict && /^lang\b/.test(line) && !matchs) malformed('Invalid language declaration.', lineIndex);
    if (matchs) {
      let nextLang = matchs[1];
      if (strict && (Object.hasOwn(Object.prototype, nextLang) || nextLang === 'prototype' || nextLang.startsWith('__duplicate_lang_'))) {
        malformed('Invalid language identifier.', lineIndex);
      }
      if (!desc.tempTranslations[curLang] || desc.tempTranslations[curLang].count != desc.tempTranslations[curLang].content.length) {
        if (strict) malformed('The declared translation count does not match the preceding block.', lineIndex);
        void window.AppDialogs.alert(
          'ERROR: Malform description file\n' +
          'missing some/all translation text\n' +
          filepath + '\n\nLang: ' + curLang + '\n' + text,
          { title: 'Invalid description file' }
        );
        return false;
      }
      if (desc.tempTranslations[nextLang]) {
        let occurrence = (langOccurrences[nextLang] || 1) + 1;
        langOccurrences[nextLang] = occurrence;
        let duplicateKey = `__duplicate_lang_${duplicateLangIndex++}__${nextLang}`;
        translationBlockInfos[duplicateKey] = {
          lang: nextLang,
          line: lineIndex + 1,
          occurrence
        };
        if (!duplicateLangGroupsByLang[nextLang]) {
          duplicateLangGroupsByLang[nextLang] = {
            filepath,
            lang: nextLang,
            optionKeys: [nextLang],
            options: []
          };
          desc.duplicateLangGroups.push(duplicateLangGroupsByLang[nextLang]);
        }
        duplicateLangGroupsByLang[nextLang].optionKeys.push(duplicateKey);
        desc.duplicateLangEntries.push({
          filepath,
          lang: nextLang,
          line: lineIndex + 1
        });
        curLang = duplicateKey;
        continue;
      }
      langOccurrences[nextLang] = 1;
      translationBlockInfos[nextLang] = {
        lang: nextLang,
        line: lineIndex + 1,
        occurrence: 1
      };
      curLang = nextLang;
      continue;
    }

    // >>> found nothing that we need, this mean that the current line is translation string
    const entryStartLine = lineIndex;
    let matchs2 = line.match(/^([^"]*)"([^"]*)" ?(.*)$/);
    if (!matchs2) {
      // Repair only a closing quote stranded on the immediately following line.
      // Keep whitespace inside the quotes and use the editor's escaped newline
      // representation before source hashing, comparison, rendering, and export.
      const opening = lines[lineIndex].trimStart().match(/^([^"]*)"([^"]*)$/);
      const closing = lines[lineIndex + 1]?.trimEnd().match(/^( *)"(?: ([^"]*))?$/);
      if (opening && closing) {
        matchs2 = [line, opening[1], opening[2] + '\\n' + closing[1], closing[2] || ''];
        lineIndex++;
      }
    }
    if (!matchs2) {
      if (strict) malformed('Invalid quoted translation entry.', lineIndex);
      void window.AppDialogs.alert(
        'ERROR: Malform description file\n' +
        'Malform translation text\n' +
        filepath + '\n\nLang: ' + curLang + '\n' + text,
        { title: 'Invalid description file' }
      );
      return false;
    }
    let variable = matchs2[1].trim();
    let content = matchs2[2];
    let remark = matchs2[3];
    if (strict && desc.tempTranslations[curLang].content.length >= desc.tempTranslations[curLang].count) {
      malformed('There are more translation entries than the declared count.', entryStartLine);
    }
    if (lineIndex !== entryStartLine) {
      (desc.importRepairs ||= []).push({ filepath, lang: translationBlockInfos[curLang].lang,
        line: entryStartLine + 1, endLine: lineIndex + 1, kind: 'quoted-line-break' });
    }
    if (curLang == "English") {
      desc.variables.push(variable);
      desc.remarks.push(remark);
    }
    
    desc.tempTranslations[curLang].content.push(content);
    desc.tempTranslations[curLang].variables.push(variable);
    desc.tempTranslations[curLang].remarks.push(remark);
  }

  if (strict) {
    if (desc.name === null || !desc.stats.length || !desc.tempTranslations.English?.content.length) {
      malformed('The description must include stats and a nonempty English block.');
    }
    if (Object.values(desc.tempTranslations).some(block => block.count !== block.content.length)) {
      malformed('The final translation block is incomplete.');
    }
  }

  for (let group of desc.duplicateLangGroups) {
    group.options = group.optionKeys.map(key => {
      let info = translationBlockInfos[key] || { lang: group.lang, line: 0, occurrence: 1 };
      return {
        id: key,
        lang: info.lang,
        line: info.line,
        occurrence: info.occurrence,
        content: (desc.tempTranslations[key]?.content || []).slice(),
        variables: (desc.tempTranslations[key]?.variables || []).slice(),
        remarks: (desc.tempTranslations[key]?.remarks || []).slice()
      };
    });
    delete group.optionKeys;
  }

  // remove the count and replace the translation block with the array of all the text in that langauge
  for (let lang in desc.tempTranslations) {
    if (desc.tempTranslations.hasOwnProperty(lang)) {
      if (lang.indexOf('__duplicate_lang_') === 0) {
        delete desc.tempTranslations[lang];
        continue;
      }
      desc.translations[lang] = desc.tempTranslations[lang].content;
      delete desc.tempTranslations[lang];
    }
  }

  const engLen = Array.isArray(desc?.translations?.English) ? desc.translations.English.length : 0;
  const trLines = Array.isArray(desc?.translations?.[lang]) ? desc.translations[lang] : [];
  desc.isMissing = computeIsMissing(engLen, trLines);

  const firstEnglish = desc.translations.English?.[0] || '';
  if (firstEnglish.indexOf('[DNT') == 0 || firstEnglish.indexOf('DNT ') == 0) desc.isDNT = true;

  return desc;
}

/**
 * @param {StatDesc} desc 
 * @returns {Uint8Array}
 */
function descEncode(desc) {
  var text = `description ${desc.name || ""}`.trim() + '\r\n';
  text += `\t${desc.stats.length} ${desc.stats.join(' ')}\r\n`;
  text += generateTranslationBlock(desc, 'English');
  for (var lang in desc.translations) {
    if (desc.translations.hasOwnProperty(lang)) {
      if (lang == 'English') continue;
      text += `\tlang "${lang}"\r\n`
      text += generateTranslationBlock(desc, lang);
    }
  }

  let data_16 = strEncodeUTF16(text);
  let data_8 = new Uint8Array(data_16.buffer, data_16.byteOffset, data_16.byteLength);

  let withBOM = new Uint8Array(2 + data_8.byteLength);
  withBOM.set(new Uint8Array([0xFF, 0xFE]));
  withBOM.set(data_8, 2);

  return withBOM;
}

/**
 * @param {StatDesc} desc 
 * @param {string} lang 
 * @returns {string}
 */
function generateTranslationBlock(desc, lang) {
  var text = `\t${desc.translations[lang]?.length || "0"}\r\n`;
  for (let i = 0; i < desc.translations[lang]?.length; i++) {
    const translation = desc.translations[lang][i] || "";
    text += `\t\t${desc.variables[i] || ""} "${translation}"`;
    if (desc.remarks[i]) 
      text += ` ${desc.remarks[i]}`;
    text += `\r\n`;
  }
  return text;
}

/**
 * @param {string} str 
 * @returns {Uint16Array}
 */
function strEncodeUTF16(str) {
  var buf = new ArrayBuffer(str.length * 2);
  var bufView = new Uint16Array(buf);
  for (var i = 0, strLen = str.length; i < strLen; i++) {
    bufView[i] = str.charCodeAt(i);
  }
  return bufView;
}
