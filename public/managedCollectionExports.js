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
    return protocol.validateBaselineSource(source, archive);
  }
  async function cachedBaseline(baseline, archive, options = {}) {
    if (!baseline?.source?.length || !baseline.archive) return null;
    const descriptor = await protocol.finalizeArchive(baseline.archive);
    checkpoint(options.current);
    if (JSON.stringify(descriptor) !== JSON.stringify(archive)) return null;
    return verifyBaseline(baseline.source, archive, options);
  }
  // Only immutable, verified originals enter this bounded cache. Collection
  // targets, auth, in-flight reads and generated results are never shared.
  function createBaselineCache({ maxBaselines = 2, maxFiles = 2048, maxBytes = 16 * 1024 * 1024 } = {}) {
    const baselines = new Map(); let bytes = 0, count = 0;
    const remove = key => { for (const row of baselines.get(key).values()) { bytes -= row.size; count--; } baselines.delete(key); };
    return {
      get(key, filepath) {
        const files = baselines.get(key), row = files?.get(filepath);
        if (!row) return null;
        baselines.delete(key); baselines.set(key, files); files.delete(filepath); files.set(filepath, row);
        return copy(row.file);
      },
      put(key, file) {
        const size = new TextEncoder().encode(JSON.stringify(file)).byteLength;
        if (size > maxBytes) return;
        let files = baselines.get(key);
        if (!files) baselines.set(key, files = new Map());
        if (files.has(file.filepath)) { bytes -= files.get(file.filepath).size; count--; files.delete(file.filepath); }
        files.set(file.filepath, { file: copy(file), size }); bytes += size; count++;
        while (baselines.size > maxBaselines) remove(baselines.keys().next().value);
        while (count > maxFiles || bytes > maxBytes) {
          const first = baselines.keys().next().value, rows = baselines.get(first), path = rows.keys().next().value;
          bytes -= rows.get(path).size; count--; rows.delete(path); if (!rows.size) baselines.delete(first);
        }
      },
      clear() { baselines.clear(); bytes = 0; count = 0; },
      stats: () => ({ baselines: baselines.size, files: count, bytes }),
    };
  }
  const originals = createBaselineCache();
  async function collectionBaseline(manifest, { current, phase, baseline, readBaseline, readZip, fetchZip,
    sourceWorker, storeZip, cache = originals } = {}) {
    checkpoint(current);
    phase?.('Baseline lookup / reuse');
    const archive = await protocol.finalizeArchive(manifest.archive);
    checkpoint(current);
    const key = JSON.stringify(archive), paths = new Set(), found = new Map();
    for (const file of manifest.files) {
      if (!validPath(file?.filepath) || paths.has(file.filepath) || !strings(file.translations)) throw new Error('The collection contains an invalid Saved file.');
      paths.add(file.filepath);
      const original = cache.get(key, file.filepath); if (original) found.set(file.filepath, original);
    }
    if (found.size === paths.size) return [...found.values()];
    baseline ||= await readBaseline?.(archive); checkpoint(current);
    if (baseline?.source?.length) {
      phase?.('Cached baseline verification');
      let verified;
      try { verified = await cachedBaseline(baseline, archive, { current }); }
      catch (error) { checkpoint(current); if (error.stale) throw error; /* Rebuild invalid parsed caches from the verified ZIP. */ }
      checkpoint(current);
      for (const file of verified || []) if (paths.has(file.filepath)) { cache.put(key, file); found.set(file.filepath, file); }
      if (found.size === paths.size) return [...found.values()];
    }
    phase?.('Cached original ZIP read');
    let blob = await readZip?.(archive.zipHash); checkpoint(current);
    const worker = sourceWorker();
    if (blob) {
      phase?.('Cached ZIP worker verification / directory checks');
      try { await worker.prepare(blob, archive); }
      catch (error) { checkpoint(current); if (error.stale) throw error; blob = null; }
      checkpoint(current);
    }
    if (!blob) {
      phase?.('Baseline download (network + server)');
      blob = await fetchZip(); checkpoint(current);
      phase?.('Original ZIP worker verification / directory checks');
      await worker.prepare(blob, archive); checkpoint(current);
      phase?.('Verified original ZIP cache');
      await storeZip?.(archive.zipHash, blob, { verified: true, zipSize: archive.zipSize, archive }); checkpoint(current);
    }
    phase?.('Selected file extraction / parsing (worker)');
    const missing = [...paths].filter(path => !found.has(path));
    for (let start = 0; start < missing.length; start += 64) {
      checkpoint(current);
      const batch = missing.slice(start, start + 64), extracted = await worker.extractMany(blob, archive, batch);
      checkpoint(current);
      if (extracted.length !== batch.length || extracted.some((file, index) => file.filepath !== batch[index])) throw new Error('The extracted originals differ from the requested collection files.');
      for (const file of extracted) { cache.put(key, file); found.set(file.filepath, file); }
    }
    return [...found.values()];
  }
  async function parseOriginal(blob, archive, language, JSZip, { current, phase, cacheOriginalZip } = {}) {
    checkpoint(current);
    phase?.('Original ZIP verification');
    const bytes = blob?.arrayBuffer ? await blob.arrayBuffer() : blob;
    checkpoint(current);
    if ((bytes?.byteLength ?? bytes?.length) !== archive.zipSize || await protocol.zipHash(bytes) !== archive.zipHash) {
      throw new Error('The downloaded original ZIP does not match this collection.');
    }
    checkpoint(current);
    phase?.('ZIP directory / path checks');
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
    phase?.('Extraction / parsing');
    const rawSource = []; let processed = 0;
    for (const entry of entries.filter(entry => /\.txt$/i.test(entry.name))) {
      checkpoint(current);
      // Keep the existing full parse. Yield only so Abort can be delivered.
      if (current && ++processed % 64 === 0) { await new Promise(resolve => setTimeout(resolve, 0)); checkpoint(current); }
      const data = await entry.async('uint8array');
      checkpoint(current);
      expanded += data.byteLength - (entry._data?.uncompressedSize || 0);
      if (data.byteLength > 2 * 1024 * 1024 || expanded > 256 * 1024 * 1024) throw new Error('The original ZIP exceeds the extracted-size limit.');
      const desc = codec.parseText(entry.name, codec.decodeUTF16(data), language, { strict: true });
      if (desc) rawSource.push(desc);
    }
    phase?.('Applying duplicate decisions');
    const source = await codec.applyDuplicateSelections(rawSource, archive.decisions, { language });
    checkpoint(current);
    if (cacheOriginalZip) await cacheOriginalZip(blob, archive);
    else if (typeof window === 'object' && window.SDBaselineFiles) await window.SDBaselineFiles.cacheOriginalZip(blob, archive, { current });
    phase?.('Baseline verification');
    return verifyBaseline(source, archive, { current });
  }
  async function generate(manifest, baseline, JSZip, { current, type = 'blob', progress, phase } = {}) {
    checkpoint(current);
    phase?.('Encoding');
    const source = new Map(baseline.map(file => [file.filepath, file])), zip = new JSZip();
    let processed = 0;
    for (const saved of manifest.files) {
      checkpoint(current);
      if (current && ++processed % 64 === 0) { await new Promise(resolve => setTimeout(resolve, 0)); checkpoint(current); }
      const original = source.get(saved.filepath);
      if (!original) throw new Error('A Saved collection file is absent from its original ZIP: ' + saved.filepath);
      const desc = { ...original, translations: { ...original.translations, [manifest.language]: [...saved.translations] } };
      zip.file(saved.filepath, codec.descEncode(desc), { date: new Date('2000-01-01T00:00:00Z'), createFolders: false });
    }
    phase?.('Compression');
    const blob = await zip.generateAsync({ type, compression: 'DEFLATE', compressionOptions: { level: 5 } }, metadata => {
      checkpoint(current); progress?.(metadata);
    });
    checkpoint(current);
    return blob;
  }
  return { validateManifest, verifyBaseline, cachedBaseline, parseOriginal, generate, collectionBaseline, createBaselineCache,
    archiveDescriptor: archive => protocol.finalizeArchive(archive), checkpoint };
});
