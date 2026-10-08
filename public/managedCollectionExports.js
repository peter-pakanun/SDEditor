/* Frozen managed collection exports. Never read current workspace translations. */
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const api = factory(node ? require('./collaborationProtocol.js') : root.CollaborationProtocol,
    node ? require('./statDescCodec.js') : root.StatDescCodec);
  if (node) module.exports = api;
  else root.ManagedCollectionExports = api;
})(typeof window === 'object' ? window : globalThis, function (protocol, codec) {
  'use strict';
  const copy = value => JSON.parse(JSON.stringify(value));
  const strings = value => Array.isArray(value) && value.every(line => typeof line === 'string');
  const validPath = path => typeof path === 'string' && !!path && !path.includes('\\')
    && !/[\u0000-\u001f]/.test(path) && !path.split('/').some(part => !part || part === '.' || part === '..');
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const changed = () => Object.assign(new Error('The collection download context changed. Retry in the selected version.'), { stale: true });
  function checkpoint(current) { if (current && !current()) throw changed(); }
  async function validateManifest(response, expected, { current } = {}) {
    checkpoint(current);
    // Detach before hashing so later catalog refreshes cannot change this cutoff.
    const value = copy(response), manifest = value?.manifest, version = value?.version, collection = value?.collection;
    if (!manifest || manifest.formatVersion !== 1 || manifest.parserVersion !== 1 || manifest.encoderVersion !== 1
      || collection?.id !== expected.collectionId || collection.format !== 'manifest' || collection.status !== 'ready'
      || collection.versionId !== expected.versionId || collection.language !== expected.language
      || version?.id !== expected.versionId || manifest.versionId !== expected.versionId
      || !['poe1', 'poe2'].includes(manifest.game) || manifest.game !== expected.game || version.game !== expected.game
      || (manifest.branchId || 'default') !== expected.branchId || (version.branchId || 'default') !== expected.branchId
      || manifest.sourceHash !== expected.sourceHash || version.sourceHash !== expected.sourceHash
      || manifest.zipHash !== expected.zipHash || version.zipHash !== expected.zipHash
      || manifest.language !== expected.language || !manifest.language || manifest.language === 'English'
      || /[\u0000-\u001f]/.test(manifest.language) || Object.hasOwn(Object.prototype, manifest.language)
      || manifest.language === 'prototype' || manifest.language.startsWith('__duplicate_lang_')
      || !Number.isSafeInteger(manifest.sequence) || manifest.sequence < 0
      || collection.sequence !== manifest.sequence
      || !Array.isArray(manifest.files) || manifest.files.length > 100000
      || collection.fileCount !== manifest.files.length) throw new Error('The collection manifest does not match the selected source version and team.');
    const archive = await protocol.finalizeArchive(manifest.archive);
    checkpoint(current);
    const versionArchive = await protocol.finalizeArchive(version.archive);
    checkpoint(current);
    if (archive.baselineId !== manifest.sourceHash || archive.zipHash !== manifest.zipHash
      || JSON.stringify(archive) !== JSON.stringify(versionArchive)) throw new Error('The collection baseline identity differs from its published original ZIP.');
    const paths = new Set();
    for (const file of manifest.files) {
      if (!validPath(file?.filepath) || paths.has(file.filepath) || !strings(file.translations)
        || !Number.isSafeInteger(file.revision) || file.revision < 1) throw new Error('The collection contains an invalid Saved file.');
      paths.add(file.filepath);
    }
    manifest.files.sort((a, b) => compare(a.filepath, b.filepath));
    manifest.archive = archive;
    return manifest;
  }
  async function verifyBaseline(source, archive, { current } = {}) {
    checkpoint(current);
    const files = source.map(protocol.witness).sort((a, b) => compare(a.filepath, b.filepath));
    if (files.length !== archive.descriptionCount) throw new Error('The original ZIP description count differs from the collection.');
    const tree = await protocol.buildBaselineTree(files);
    checkpoint(current);
    if (tree.root !== archive.treeRoot) throw new Error('The original ZIP does not reproduce the collection baseline.');
    return files;
  }
  async function cachedBaseline(baseline, archive, options = {}) {
    if (!baseline?.source?.length || !baseline.archive) return null;
    const descriptor = await protocol.finalizeArchive(baseline.archive);
    checkpoint(options.current);
    if (JSON.stringify(descriptor) !== JSON.stringify(archive)) return null;
    return verifyBaseline(baseline.source, archive, options);
  }
  async function parseOriginal(blob, archive, language, JSZip, { current } = {}) {
    checkpoint(current);
    const bytes = blob?.arrayBuffer ? await blob.arrayBuffer() : blob;
    checkpoint(current);
    if ((bytes?.byteLength ?? bytes?.length) !== archive.zipSize || await protocol.zipHash(bytes) !== archive.zipHash) {
      throw new Error('The downloaded original ZIP does not match this collection.');
    }
    checkpoint(current);
    const zip = await JSZip.loadAsync(bytes);
    checkpoint(current);
    const entries = Object.values(zip.files).filter(entry => !entry.dir);
    if (entries.length !== archive.fileCount) throw new Error('The original ZIP file count differs from the collection.');
    let expanded = 0;
    for (const entry of entries) {
      if (!validPath(entry.name) || entry.unsafeOriginalName && entry.unsafeOriginalName !== entry.name) throw new Error('The original ZIP contains an unsafe file path.');
      const size = entry._data?.uncompressedSize || 0;
      expanded += size;
      if (size > 2 * 1024 * 1024 || expanded > 256 * 1024 * 1024) throw new Error('The original ZIP exceeds the extracted-size limit.');
    }
    const rawSource = [];
    for (const entry of entries.filter(entry => /\.txt$/i.test(entry.name))) {
      const data = await entry.async('uint8array');
      checkpoint(current);
      expanded += data.byteLength - (entry._data?.uncompressedSize || 0);
      if (data.byteLength > 2 * 1024 * 1024 || expanded > 256 * 1024 * 1024) throw new Error('The original ZIP exceeds the extracted-size limit.');
      const desc = codec.parseText(entry.name, codec.decodeUTF16(data), language, { strict: true });
      if (desc) rawSource.push(desc);
    }
    const source = await codec.applyDuplicateSelections(rawSource, archive.decisions, { language });
    checkpoint(current);
    return verifyBaseline(source, archive, { current });
  }
  async function generate(manifest, baseline, JSZip, { current, type = 'blob', progress } = {}) {
    checkpoint(current);
    const source = new Map(baseline.map(file => [file.filepath, file])), zip = new JSZip();
    for (const saved of manifest.files) {
      const original = source.get(saved.filepath);
      if (!original) throw new Error('A Saved collection file is absent from its original ZIP: ' + saved.filepath);
      const desc = { ...original, translations: { ...original.translations, [manifest.language]: [...saved.translations] } };
      zip.file(saved.filepath, codec.descEncode(desc), { date: new Date('2000-01-01T00:00:00Z'), createFolders: false });
    }
    const blob = await zip.generateAsync({ type, compression: 'DEFLATE', compressionOptions: { level: 5 } }, metadata => {
      checkpoint(current); progress?.(metadata);
    });
    checkpoint(current);
    return blob;
  }
  return { validateManifest, verifyBaseline, cachedBaseline, parseOriginal, generate, checkpoint };
});
