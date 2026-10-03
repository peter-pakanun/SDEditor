/* Source identity and entry-level merge rules shared by the browser and Node checks. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CollaborationProtocol = api;
})(typeof window === 'object' ? window : this, function () {
  'use strict';
  const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function manifest(source) {
    if (!Array.isArray(source) || !source.length) throw new Error('Collaboration requires a nonempty source archive.');
    const paths = new Set();
    const strings = value => Array.isArray(value) && value.every(item => typeof item === 'string');
    const files = source.map(desc => {
      const english = desc?.english || desc?.translations?.English;
      if (!desc || typeof desc.filepath !== 'string' || !desc.filepath || paths.has(desc.filepath)
        || desc.filepath.includes('\\') || /[\u0000-\u001f]/.test(desc.filepath)
        || desc.filepath.split('/').some(part => !part || part === '.' || part === '..')
        || !strings(english) || !english.length || !strings(desc.stats) || !desc.stats.length
        || !strings(desc.variables) || !strings(desc.remarks)
        || desc.variables.length !== english.length || desc.remarks.length !== english.length
        || (desc.name != null && typeof desc.name !== 'string')
        || desc.duplicateLangEntries?.some(item => item.lang === 'English')) {
        throw new Error('Malformed or duplicate source description: ' + (desc?.filepath || '(unknown)'));
      }
      paths.add(desc.filepath);
      return { filepath: desc.filepath, name: desc.name || '', stats: copy(desc.stats), english: copy(english), variables: copy(desc.variables), remarks: copy(desc.remarks) };
    });
    files.sort((a, b) => a.filepath < b.filepath ? -1 : a.filepath > b.filepath ? 1 : 0);
    return { version: 1, files };
  }
  async function sourceHash(source, cryptoProvider) {
    const value = source?.version === 1 && Array.isArray(source.files) ? manifest(source.files) : manifest(source);
    const provider = cryptoProvider || globalThis.crypto || (typeof require === 'function' ? require('node:crypto').webcrypto : null);
    if (!provider?.subtle) throw new Error('This browser requires a secure connection for collaboration source hashing.');
    const digest = await provider.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  function fileState(file, count) {
    if (!file || typeof file.filepath !== 'string' || !Array.isArray(file.translations)
      || file.translations.some(line => typeof line !== 'string')) throw new Error('Invalid collaboration file state.');
    const translations = copy(file.translations);
    if (count != null) {
      if (translations.length > count) throw new Error('Translation count exceeds source entry count: ' + file.filepath);
      while (translations.length < count) translations.push('');
    }
    return { filepath: file.filepath, translations, needsReview: !!file.needsReview,
      trackedForExport: !!file.trackedForExport, revision: Number(file.revision) || 0 };
  }
  function contentEqual(a, b) {
    return !!a && !!b && equal(a.translations, b.translations)
      && !!a.needsReview === !!b.needsReview && !!a.trackedForExport === !!b.trackedForExport;
  }
  function mergeFile(base, yours, shared) {
    if (!shared) throw new Error('Shared file is missing: ' + yours.filepath);
    const result = fileState(shared);
    const indexes = [];
    const metadata = [];
    for (let index = 0; index < Math.max(yours.translations.length, shared.translations.length); index++) {
      const local = yours.translations[index] ?? '';
      const remote = shared.translations[index] ?? '';
      const old = base?.translations[index] ?? '';
      if (local === remote) result.translations[index] = local;
      else if (base && local === old) result.translations[index] = remote;
      else if (base && remote === old) result.translations[index] = local;
      else { result.translations[index] = local; indexes.push(index); }
    }
    for (const key of ['needsReview', 'trackedForExport']) {
      if (!!yours[key] === !!shared[key]) result[key] = !!yours[key];
      else if (base && !!yours[key] === !!base[key]) result[key] = !!shared[key];
      else if (base && !!shared[key] === !!base[key]) result[key] = !!yours[key];
      else { result[key] = !!yours[key]; metadata.push(key); }
    }
    return { file: result, indexes, metadata, conflict: indexes.length > 0 || metadata.length > 0 };
  }
  function scopeKey(identity) {
    return JSON.stringify([String(identity.accountId), identity.game, identity.sourceHash, identity.language]);
  }
  function projectWorkspace(workspace, files, language, source = [], { mutate = false } = {}) {
    // Internal transaction projections own their IndexedDB snapshot. Other
    // callers receive an independent copy.
    const result = mutate ? workspace || { descs: [], status: {} } : copy(workspace || { descs: [], status: {} });
    result.descs ||= []; result.status ||= {};
    const descriptions = new Map(result.descs.map(desc => [desc.filepath, desc]));
    let originals;
    for (const file of files) {
      let desc = descriptions.get(file.filepath);
      if (!desc) {
        originals ||= new Map(source.map(desc => [desc.filepath, desc]));
        const original = originals.get(file.filepath);
        desc = original ? copy(original) : { filepath: file.filepath, translations: {} };
        result.descs.push(desc);
        descriptions.set(file.filepath, desc);
      }
      desc.translations ||= {};
      desc.translations[language] = copy(file.translations);
      desc.hasChanges = !!file.trackedForExport;
      desc.needsReview = !!file.needsReview;
      desc.isMissing = file.translations.some(text => !text.trim());
      result.status[file.filepath] = { ...(result.status[file.filepath] || {}), needsReview: !!file.needsReview };
    }
    return result;
  }
  return { copy, equal, manifest, sourceHash, fingerprint: sourceHash, fileState, contentEqual, mergeFile, scopeKey, projectWorkspace };
});
