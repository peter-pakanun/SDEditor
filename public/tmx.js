(function (root) {
  'use strict';

  const LANGUAGE_TAGS = new Map([
    ['French', 'fr'],
    ['German', 'de'],
    ['Japanese', 'ja'],
    ['Korean', 'ko'],
    ['Polish', 'pl'],
    ['Portuguese', 'pt'],
    ['Russian', 'ru'],
    ['Simplified Chinese', 'zh-Hans'],
    ['Spanish', 'es'],
    ['Thai', 'th'],
    ['Traditional Chinese', 'zh-Hant'],
    ['Turkish', 'tr']
  ]);
  const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace';
  const TMX_NAMESPACES = new Set([null, 'http://www.lisa.org/tmx', 'http://www.lisa.org/tmx14']);
  const GAME_PROP = 'x-sdeditor-game-scope';
  const CONTEXT_PROP = 'x-sdeditor-context';
  const WEBLATE_TMX_PART_BYTES = 5_000_000;
  const WEBLATE_TMX_MAX_UNITS = 100_000;
  const TMX_END = '  </body>\n</tmx>\n';
  function languageTag(language) {
    const tag = LANGUAGE_TAGS.get(language);
    if (!tag) throw new Error('Select a supported target language to use TMX.');
    return tag;
  }
  function normalizeTag(tag) {
    return tag.trim().toLowerCase().replace(/_/g, '-');
  }
  function languageGroup(tag) {
    const [language, subtag] = tag.split('-');
    if (language !== 'zh') return language;
    if (subtag === 'hans' || subtag === 'chs') return 'zh-hans';
    if (subtag === 'hant' || subtag === 'cht') return 'zh-hant';
    if (['cn', 'sg'].includes(subtag)) return 'zh-hans';
    if (['tw', 'hk', 'mo'].includes(subtag)) return 'zh-hant';
    return 'zh';
  }
  function children(element, name) {
    return Array.from(element.children).filter(
      (child) => child.localName === name && child.namespaceURI === element.namespaceURI
    );
  }
  function segmentText(variants, tag) {
    const group = languageGroup(tag);
    const matches = variants
      .map((variant) => ({
        variant,
        language: normalizeTag(
          variant.getAttributeNS(XML_NAMESPACE, 'lang') ?? variant.getAttribute('lang') ?? ''
        )
      }))
      .filter((entry) => languageGroup(entry.language) === group);
    const exact = matches.filter((entry) => entry.language === tag);
    const candidates = exact.length ? exact : matches;
    if (candidates.length !== 1) return;
    const [segment, extra] = children(candidates[0].variant, 'seg');
    // TMX Level 2 inline codes can contain placeholders or native markup. Skipping
    // these units keeps their codes from becoming literal text or disappearing.
    if (segment && !extra && !segment.childElementCount) return segment.textContent ?? '';
  }
  function readContext(value) {
    if (!value) return;
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      // An unrecognized extension does not invalidate an otherwise usable text pair.
    }
  }
  function isGameScope(value) {
    return value === 'poe1' || value === 'poe2' || value === 'all';
  }
  function withoutDoctype(xml) {
    const prolog = /^(?:[ \t\r\n]+|<\?[\s\S]*?\?>|<!--[\s\S]*?-->)*/.exec(xml)?.[0] ?? '';
    const remainder = xml.slice(prolog.length);
    if (!remainder.startsWith('<!DOCTYPE')) return xml;
    // Accept the external declaration included by some exporters without resolving
    // it. Internal subsets can define entities and are outside the TMX text format.
    const declaration =
      /^<!DOCTYPE\s+tmx(?:\s+(?:SYSTEM\s+(?:"[^"<>]*"|'[^'<>]*')|PUBLIC\s+(?:"[^"<>]*"|'[^'<>]*')\s+(?:"[^"<>]*"|'[^'<>]*')))?\s*>/.exec(
        remainder
      );
    if (!declaration)
      throw new Error('TMX files cannot contain inline DTD or entity declarations.');
    return prolog + remainder.slice(declaration[0].length);
  }
  async function decodeXml(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let encoding = 'utf-8';
    if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
    if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
    try {
      return new TextDecoder(encoding, { fatal: true }).decode(bytes);
    } catch {
      throw new Error('This TMX file must be encoded as UTF-8 or UTF-16.');
    }
  }
  async function readTmx(file, targetLanguage) {
    const targetTag = normalizeTag(languageTag(targetLanguage));
    const xml = withoutDoctype(await decodeXml(file));
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    if (document.doctype) throw new Error('This TMX file contains an unexpected DTD declaration.');
    const root = document.documentElement;
    if (document.getElementsByTagName('parsererror').length)
      throw new Error('This TMX file contains malformed XML.');
    const [header, body, extra] = Array.from(root.children);
    if (
      root.localName !== 'tmx' ||
      !TMX_NAMESPACES.has(root.namespaceURI) ||
      !/^1\.(?:[0-3]|4b?)$/.test(root.getAttribute('version') ?? '') ||
      header?.localName !== 'header' ||
      header.namespaceURI !== root.namespaceURI ||
      body?.localName !== 'body' ||
      body.namespaceURI !== root.namespaceURI ||
      extra
    ) {
      throw new Error('This file is not a supported TMX 1.x document.');
    }
    const units = [];
    const elements = children(body, 'tu');
    for (const element of elements) {
      const declaredSource = normalizeTag(
        element.getAttribute('srclang') ?? header.getAttribute('srclang') ?? ''
      );
      const sourceTag = declaredSource === '*all*' || !declaredSource ? 'en' : declaredSource;
      if (languageGroup(sourceTag) !== 'en') continue;
      const variants = children(element, 'tuv');
      const source = segmentText(variants, sourceTag);
      const target = segmentText(variants, targetTag);
      if (!source?.trim() || !target?.trim()) continue;
      const unit = { source, target };
      const note = children(element, 'note')[0]?.textContent;
      if (note) unit.note = note;
      const props = children(element, 'prop');
      const game = props.find((prop) => prop.getAttribute('type') === GAME_PROP)?.textContent;
      if (isGameScope(game)) unit.gameScope = game;
      const context = readContext(
        props.find((prop) => prop.getAttribute('type') === CONTEXT_PROP)?.textContent
      );
      if (context) unit.context = context;
      units.push(unit);
    }
    return { units, skipped: elements.length - units.length };
  }
  function xmlText(value) {
    // With the Unicode flag, this surrogate range matches only unpaired surrogates.
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/u.test(value))
      throw new Error('A Translation Memory entry contains characters that TMX cannot represent.');
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
      .replace(/\r/g, '&#13;');
  }
  function tmxStart(creationTool) {
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<tmx version="1.4">',
      `  <header creationtool="${xmlText(creationTool)}" creationtoolversion="1" segtype="block" o-tmf="SDEditor" adminlang="en" srclang="en" datatype="PlainText"/>`,
      '  <body>',
      ''
    ].join('\n');
  }
  function* tmxEntries(units, targetTag) {
    for (const unit of units) {
      if (!unit.source.trim() || !unit.target.trim()) continue;
      const lines = ['    <tu>'];
      if (unit.note) lines.push(`      <note>${xmlText(unit.note)}</note>`);
      if (isGameScope(unit.gameScope))
        lines.push(`      <prop type="${GAME_PROP}">${unit.gameScope}</prop>`);
      if (unit.context && Object.keys(unit.context).length)
        lines.push(
          `      <prop type="${CONTEXT_PROP}">${xmlText(JSON.stringify(unit.context))}</prop>`
        );
      lines.push(
        `      <tuv xml:lang="en"><seg>${xmlText(unit.source)}</seg></tuv>`,
        `      <tuv xml:lang="${targetTag}"><seg>${xmlText(unit.target)}</seg></tuv>`,
        '    </tu>',
        ''
      );
      yield lines.join('\n');
    }
  }
  function writeTmx(units, targetLanguage, creationTool = 'SDEditor') {
    return (
      tmxStart(creationTool) +
      Array.from(tmxEntries(units, languageTag(targetLanguage))).join('') +
      TMX_END
    );
  }
  function splitTmx(units, targetLanguage, maxBytes, creationTool = 'SDEditor') {
    const targetTag = languageTag(targetLanguage);
    const start = tmxStart(creationTool);
    const encoder = new TextEncoder();
    const frameBytes = encoder.encode(start + TMX_END).length;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < frameBytes)
      throw new Error('Choose a file size limit large enough for a TMX header.');
    const parts = [];
    let entries = [];
    let bytes = frameBytes;
    for (const entry of tmxEntries(units, targetTag)) {
      const entryBytes = encoder.encode(entry).length;
      if (frameBytes + entryBytes > maxBytes)
        throw new Error(
          'A single translation entry exceeds this file size limit. Increase the limit to include it.'
        );
      if (bytes + entryBytes > maxBytes || entries.length === WEBLATE_TMX_MAX_UNITS) {
        parts.push(start + entries.join('') + TMX_END);
        bytes = frameBytes;
        entries = [];
      }
      entries.push(entry);
      bytes += entryBytes;
    }
    parts.push(start + entries.join('') + TMX_END);
    return parts;
  }

  const api = { readTmx, writeTmx, splitTmx, WEBLATE_TMX_PART_BYTES };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Tmx = api;
})(typeof window !== 'undefined' ? window : globalThis);
