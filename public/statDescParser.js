async function parseFile(filepath, zipObject, lang) {
  let data = await zipObject.async('uint8array');
  let blob = new Blob([data]);
  let text = await blob.text();

  // remove Byte order mark
  text = text.replace(/^\uFEFF/, '');

  // find description mark
  let count = (text.match(/^description/gim) ?? []).length;
  if (count == 0) return false;
  let desc = parseDesc(filepath, text, lang);
  return desc;
}

function parseDesc(filepath, text, lang) {
  text = text.replace(/\t/g, ' ').replace(/\r/g, '');
  
  let filepaths = filepath.split('/');
  let filename = filepaths.pop();
  let desc = {
    filepath,
    filedir: filepaths.join('/'),
    filename,
    name: null,
    stats: [],
    variables: [],
    remarks: [],
    translations: {},
    isDNT: false
  };

  let curLang = "English"; // first translation block langauge
  let lines = text.split("\n");
  for (line of lines) {
    line = line.trim();
    if (line == '') continue; // ignore empty line

    // split line by space into an array
    let lineArray = line.split(' ').filter(n => n);

    // >>> expecting description name
    if (desc.name === null) {
      if (lineArray[0] != 'description') {
        alert(
          'ERROR: Malform description file\n' +
          'expecting description field\n' +
          filepath + '\n\n' + text
        );
        return false;
      }
      if (lineArray.length > 2) {
        alert(
          'ERROR: Multiple description declaration\n' +
          filepath + '\n\n' + text
        );
        return false;
      }
      desc.name = lineArray[1] ?? "";
      continue;
    }

    // >>> expecting stat names
    if (desc.stats.length == 0) {
      let count = parseInt(lineArray[0]);
      if (!count) {
        alert(
          'ERROR: Malform description file\n' +
          'expecting stats count\n' +
          filepath + '\n\n' + text
        );
        return false;
      }
      desc.stats = lineArray;
      desc.stats.shift(); // remove the count
      continue;
    }

    // >>> expecting translation count
    if (!desc.translations[curLang]) {
      let count = parseInt(lineArray[0]);
      if (!count) {
        alert(
          'ERROR: Malform description file\n' +
          'expecting translations count\n' +
          filepath + '\n\n' + text
        );
        return false;
      }
      desc.translations[curLang] = {
        count, // temporary variable, use to validate the next "expect"
        content: []
      };
      continue;
    }

    // >>> expecting lang declaration
    let matchs = /lang "([^"]+)"/.exec(line);
    if (matchs) {
      let nextLang = matchs[1];
      if (!desc.translations[curLang] || desc.translations[curLang].count != desc.translations[curLang].content.length) {
        alert(
          'ERROR: Malform description file\n' +
          'missing some/all translation text\n' +
          filepath + '\n\nLang: ' + curLang + '\n' + text
        );
        return false;
      }
      if (desc.translations[nextLang]) {
        alert(
          'ERROR: Malform description file\n' +
          'Duplicate Lang declaration detected\n' +
          filepath + '\n\nLang: ' + curLang
        );
        delete desc.translations[nextLang];
      }
      curLang = nextLang;
      continue;
    }

    // >>> found nothing that we need, this mean that the current line is translation string
    let str = lineArray.join(" ");
    matchs = str.match(/^([^"]*)"([^"]*)" ?(.*)$/);
    if (!matchs) {
      alert(
        'ERROR: Malform description file\n' +
        'Malform translation text\n' +
        filepath + '\n\nLang: ' + curLang + '\n' + text
      );
      continue;
    }
    let variable = matchs[1].trim();
    let content = matchs[2];
    let remark = matchs[3];
    if (curLang == "English") {
      desc.variables.push(variable);
      desc.remarks.push(remark);
    }
    
    desc.translations[curLang].content.push(content);
  }

  // remove the count and replace the translation block with the array of all the text in that langauge
  for (let lang in desc.translations) {
    if (desc.translations.hasOwnProperty(lang)) {
      desc.translations[lang] = desc.translations[lang].content;
    }
  }

  desc.isMissing = desc.translations.English?.length !== desc.translations[lang]?.length;
  if (desc.translations[lang]?.length)
  for (const translation of desc.translations[lang]) {
    if (translation.trim() == "") {
      desc.isMissing = true;
      break;
    }
  }

  if (desc.translations.English[0].indexOf('[DNT]') == 0 || desc.translations.English[0].indexOf('DNT ') == 0) desc.isDNT = true;

  return desc;
}

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

function strEncodeUTF16(str) {
  var buf = new ArrayBuffer(str.length * 2);
  var bufView = new Uint16Array(buf);
  for (var i = 0, strLen = str.length; i < strLen; i++) {
    bufView[i] = str.charCodeAt(i);
  }
  return bufView;
}