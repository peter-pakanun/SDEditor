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
/** Browser ZIP and dialog adapters. Pure parsing/encoding lives in statDescCodec.js. */
function statDescCodec() { return window.StatDescCodec; }
function parserMalformed(message, options) { return window.AppDialogs.alert(message, options); }
/** @returns {Promise<StatDesc|false>} */
async function parseFile(filepath, zipObject, lang, { strict = false } = {}) {
  const text = await decodeZipTxtFile(zipObject, lang);
  return statDescCodec().parseText(filepath, text, lang, { strict, onMalformed: parserMalformed });
}
/** @returns {StatDesc|false} */
function parseDesc(filepath, text, lang, { strict = false } = {}) {
  return statDescCodec().parseDesc(filepath, text, lang, { strict, onMalformed: parserMalformed });
}
function descEncode(desc) { return statDescCodec().descEncode(desc); }
function generateTranslationBlock(desc, lang) { return statDescCodec().generateTranslationBlock(desc, lang); }
function strEncodeUTF16(text) { return statDescCodec().strEncodeUTF16(text); }
