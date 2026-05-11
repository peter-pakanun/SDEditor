const dummyFile = `description
	2 plague_bearer_gains_%_of_damage_from_inflicted_poisons plague_bearer_maximum_stored_poison_damage
	2
		# # table_only "Expected [Poison] damage stored (cap)@{0}% ({1})"
		# # "Stores {0}% of Expected [Poison] damage, up to {1}\nDeals [Physical] damage equal to the stored [Poison]"
	lang "German"
	2
		# # table_only "Gespeicherter erwarteter [Poison|Gift]schaden (max.)@{0}% ({1})"
		# # "Speichert {0}% des erwarteten [Poison|Gift]schadens, bis zu {1}\nVerursacht [Physical|physischen] Schaden in Höhe des gespeicherten [Poison|Gifts]"
	lang "Japanese"
	2
		# # table_only "貯められる期待[Poison|毒]ダメージ (上限)@{0}% ({1}%)"
		# # "期待[Poison|毒]ダメージの{0}%を貯める、最大{1}まで\n貯められた[Poison|毒]と同量の[Physical|物理]ダメージを与える"
	lang "Korean"
	2
		# # table_only "예상되는 [Poison|중독] 피해 저장량(한도)@{0}%({1})"
		# # "예상되는 [Poison|중독] 피해의 {0}% 저장, 최대 {1}\n저장된 [Poison|중독] 피해와 동일한 [Physical|물리] 피해를 줌"
	lang "Portuguese"
	2
		# # table_only "Dano de [Poison|veneno] esperado guardado (máximo)@{0}% ({1})"
		# # "Guarda {0}% de dano de [Poison|veneno] esperado, até {1}\nCausa dano [Physical|físico] equivalente ao [Poison|veneno] guardado"
	lang "Russian"
	2
		# # table_only "Ожидаемый сохраненный урон от [Poison|яда] (максимум)@{0}% ({1})"
		# # "Сохраняет {0}% от ожидаемого урона от [Poison|яда], вплоть до {1}\nНаносит [Physical|физический] урон, равный сохраненному урону от [Poison|яда]"
	lang "Spanish"
	2
		# # table_only "Daño de [Poison|veneno] esperado almacenado (límite)@{0}% ({1})"
		# # "Almacena el {0}% del daño de [Poison|veneno] esperado, hasta {1}\nInflige daño [Physical|físico] equivalente al [Poison|veneno] almacenado"
	lang "Thai"
	2
		# # table_only "ความเสียหายเต็มระยะเวลา ของสถานะ [Poison|พิษ] ที่กักเก็บ (สูงสุด)@{0}% ({1})"
		# # "กักเก็บ {0}% ของความเสียหาย [Poison|พิษ] เต็มระยะเวลา สูงสุด {1}\nสร้างความเสียหาย [Physical|กายภาพ] เท่ากับสถานะ [Poison|พิษ] ที่กักเก็บไว้"
	lang "Simplified Chinese"
	2
		# # table_only "储存预期[Poison|中毒]伤害（上限）@{0}%（{1}）"
		# # "储存预期[Poison|中毒]伤害的 {0}%，最多 {1}\n造成相当于储存[Poison|中毒]的[Physical|物理]伤害"
	lang "Traditional Chinese"
	2
		# # table_only "可儲存的預期[Poison|中毒]傷害（上限）@{0}% ({1})"
		# # "儲存 {0}% 預期[Poison|中毒]傷害，最多為 {1}\n造成等同於儲存的[Poison|中毒]傷害的[Physical|物理]傷害"
	lang "French"
	2
		# # table_only "Dégâts de [Poison|Poison] prévus enmmagasinés (plafond)@{0}% ({1})"
		# # "Emmagasine {0} % des Dégâts de [Poison|Poison] prévus, jusqu'à {1}\nInflige des Dégâts [Physical|Physiques] équivalents au [Poison|Poison] Emmagasiné"
`;

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

  if (desc.translations.English[0].indexOf('[DNT') == 0 || desc.translations.English[0].indexOf('DNT ') == 0) desc.isDNT = true;

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