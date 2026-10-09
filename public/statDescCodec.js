/* Shared StatDescriptions parser version 1 and UTF-16LE codec. Keep the API vendor copy byte-identical. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StatDescCodec = api;
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  function detectGameVersionFromFilepaths(filepaths) {
    const paths = (Array.isArray(filepaths) ? filepaths : [])
      .map(path => String(path || '').replaceAll('\\', '/').replace(/^\/+/, '').toLowerCase())
      .filter(Boolean);
    for (const path of paths) {
      if (path.includes('specific_skill_stat_descriptions/explosive_grenade')) return 'poe2';
      const marker = 'specific_skill_stat_descriptions/';
      const index = path.indexOf(marker);
      if (index >= 0 && path.slice(index + marker.length).split('/').filter(Boolean).length >= 2) return 'poe2';
    }
    return 'poe1';
  }
  function computeIsMissing(engLen, lines) {
    if (!Number.isFinite(engLen) || engLen < 0) engLen = 0;
    if (!Array.isArray(lines)) return engLen > 0;
    if (lines.length !== engLen) return true;
    for (let index = 0; index < engLen; index++) if (String(lines[index] ?? '').trim() === '') return true;
    return false;
  }
  function computeIsDNT(english) {
    return Array.isArray(english) && english.some(line => {
      const text = String(line || '');
      return text.startsWith('[DNT') || text.startsWith('DNT ');
    });
  }
  function parseText(filepath, text, lang, options = {}) {
    const count = (text.match(options.strict ? /^[ \t]*description\b/gim : /^description/gim) || []).length;
    if (!count) return false;
    if (count > 1) {
      if (options.strict) throw new Error('Multiple descriptions in ' + filepath);
      options.onMalformed?.('ERROR: Multiple description declaration\n' + filepath + '\n\n' + text, { title: 'Invalid description file' });
      return false;
    }
    const desc = parseDesc(filepath, text, lang, options);
    if (options.strict && !desc) throw new Error('Malformed source: ' + filepath);
    return desc;
  }
  function decodeUTF16(input) {
    if (!(input instanceof ArrayBuffer) && !ArrayBuffer.isView(input)) throw new TypeError('Archive entry bytes are required.');
    return new TextDecoder('utf-16le').decode(input).replace(/^\uFEFF/, '');
  }
function parseDesc(filepath, text, lang, { strict = false, onMalformed = () => {} } = {}) {
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
        void onMalformed(
          'ERROR: Malform description file\n' +
          'expecting description field\n' +
          filepath + '\n\n' + text,
          { title: 'Invalid description file' }
        );
        return false;
      }
      if (lineArray.length > 2) {
        if (strict) malformed('A description may have only one name.', lineIndex);
        void onMalformed(
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
        void onMalformed(
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
        void onMalformed(
          'ERROR: Multiple description declaration\n' +
          filepath + '\n\n' + text,
          { title: 'Invalid description file' }
        );
        return false;
      }
      if (!count && !(strict && count === 0 && curLang !== 'English')) {
        void onMalformed(
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
        void onMalformed(
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
      void onMalformed(
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

  desc.isDNT = computeIsDNT(desc.translations.English);

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

  function collectDuplicateLangGroups(source) {
    const groups = [];
    for (let descIndex = 0; descIndex < (source || []).length; descIndex++) {
      const desc = source[descIndex];
      for (let groupIndex = 0; groupIndex < (desc?.duplicateLangGroups || []).length; groupIndex++) {
        const group = desc.duplicateLangGroups[groupIndex];
        const options = (group.options || []).map(option => ({ id: option.id, lang: option.lang || group.lang,
          line: option.line, occurrence: option.occurrence, content: [...option.content],
          variables: [...option.variables], remarks: [...option.remarks] }));
        if (options.length > 1) groups.push({ id: descIndex + ':' + groupIndex + ':' + group.lang,
          descIndex, filepath: desc.filepath, lang: group.lang, selectedOptionId: '', options });
      }
    }
    return groups.sort((a, b) => String(a.filepath).localeCompare(String(b.filepath)) || String(a.lang).localeCompare(String(b.lang)));
  }
  async function blockHash(block) {
    if (!block || !['content', 'variables', 'remarks'].every(field => Array.isArray(block[field])
      && block[field].every(value => typeof value === 'string'))
      || block.content.length !== block.variables.length || block.content.length !== block.remarks.length) {
      throw new Error('Invalid baseline language block.');
    }
    const provider = globalThis.crypto || (typeof require === 'function' ? require('node:crypto').webcrypto : null);
    if (!provider?.subtle) throw new Error('A secure connection is required for baseline hashing.');
    const value = { content: [...block.content], variables: [...block.variables], remarks: [...block.remarks] };
    const digest = await provider.subtle.digest('SHA-256', new TextEncoder().encode('sdeditor:baseline:block:v1\n' + JSON.stringify(value)));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  async function applyDuplicateSelections(rawSource, decisions = [], { language } = {}) {
    const source = JSON.parse(JSON.stringify(rawSource));
    const groups = collectDuplicateLangGroups(source);
    if (!Array.isArray(decisions) || decisions.length !== groups.length) throw new Error('The shared import decisions do not match this ZIP.');
    const keys = new Set();
    for (const record of decisions) {
      const key = JSON.stringify([record.filepath, record.language]);
      if (keys.has(key)) throw new Error('Duplicate archive decision.');
      keys.add(key);
    }
    for (const group of groups) {
      const record = decisions.find(item => item.filepath === group.filepath && item.language === group.lang);
      if (!record) throw new Error('A shared duplicate language choice is missing.');
      const selected = group.options.find(option => option.occurrence === record.occurrence);
      if (!selected || await blockHash(selected) !== record.blockHash) throw new Error('A shared duplicate language choice does not match the original ZIP.');
      const desc = source[group.descIndex];
      desc.translations[group.lang] = [...selected.content];
      if (group.lang === 'English') {
        desc.variables = [...selected.variables]; desc.remarks = [...selected.remarks];
        desc.duplicateLangEntries = (desc.duplicateLangEntries || []).filter(entry => entry.lang !== 'English');
        desc.isDNT = computeIsDNT(desc.translations.English);
      }
      if (language) desc.isMissing = computeIsMissing(desc.translations.English?.length || 0, desc.translations[language]);
    }
    return source.filter(Boolean);
  }
  return { parserVersion: 1, detectGameVersionFromFilepaths, computeIsDNT, parseDesc, parseText, descEncode, generateTranslationBlock, strEncodeUTF16,
    decodeUTF16, collectDuplicateLangGroups, applyDuplicateSelections, blockHash };
});
