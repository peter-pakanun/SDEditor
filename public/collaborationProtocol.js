/* Source identity and entry-level merge rules shared by the browser and Node checks. */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./workspaceState.js') : root.WorkspaceState);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CollaborationProtocol = api;
})(typeof window === 'object' ? window : this, function (WorkspaceState) {
  'use strict';
  const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const HEX = /^[a-f0-9]{64}$/;
  const strings = value => Array.isArray(value) && value.every(item => typeof item === 'string');
  const validPath = value => typeof value === 'string' && !!value && !value.includes('\\')
    && !/[\u0000-\u001f]/.test(value) && !value.split('/').some(part => !part || part === '.' || part === '..');
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  function cryptoProvider(provider) {
    const value = provider || globalThis.crypto || (typeof require === 'function' ? require('node:crypto').webcrypto : null);
    if (!value?.subtle) throw new Error('This browser requires a secure connection for collaboration source hashing.');
    return value;
  }
  async function digestBytes(bytes, provider) {
    const value = await cryptoProvider(provider).subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(value), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  const digest = (domain, value, provider) => digestBytes(new TextEncoder().encode(domain + '\n' + JSON.stringify(value)), provider);
  async function zipHash(file, provider) {
    const bytes = file?.arrayBuffer ? await file.arrayBuffer() : file;
    if (!(bytes instanceof ArrayBuffer) && !ArrayBuffer.isView(bytes)) throw new Error('Archive bytes are required.');
    return digestBytes(bytes, provider);
  }
  function witness(desc) {
    if (!desc || !validPath(desc.filepath) || (desc.name != null && typeof desc.name !== 'string')
      || !strings(desc.stats) || !desc.stats.length || !strings(desc.variables) || !strings(desc.remarks)
      || !desc.translations || typeof desc.translations !== 'object' || Array.isArray(desc.translations)) throw new Error('Invalid baseline description.');
    const translations = {};
    for (const language of Object.keys(desc.translations).sort(compare)) {
      if (!language || /[\u0000-\u001f]/.test(language) || Object.hasOwn(Object.prototype, language)
        || language === 'prototype' || language.startsWith('__duplicate_lang_') || !strings(desc.translations[language])) throw new Error('Invalid baseline language.');
      translations[language] = [...desc.translations[language]];
    }
    const count = translations.English?.length;
    if (!count || desc.variables.length !== count || desc.remarks.length !== count) throw new Error('Invalid baseline English entries.');
    return { filepath: desc.filepath, name: desc.name || '', stats: [...desc.stats], variables: [...desc.variables], remarks: [...desc.remarks], translations };
  }
  const leafHash = (file, provider) => digest('sdeditor:baseline:leaf:v1', witness(file), provider);
  function parentHash(left, right, provider) {
    if (!HEX.test(left) || !HEX.test(right)) throw new Error('Invalid baseline tree hash.');
    return digest('sdeditor:baseline:parent:v1', [left, right], provider);
  }
  function blockHash(block, provider) {
    if (!block || !strings(block.content) || !strings(block.variables) || !strings(block.remarks)
      || block.content.length !== block.variables.length || block.content.length !== block.remarks.length) throw new Error('Invalid baseline language block.');
    return digest('sdeditor:baseline:block:v1', { content: [...block.content], variables: [...block.variables], remarks: [...block.remarks] }, provider);
  }
  function normalizeDecisions(decisions = []) {
    if (!Array.isArray(decisions) || decisions.length > 100000) throw new Error('Invalid archive decisions.');
    const seen = new Set();
    return decisions.map(item => {
      if (!item || !validPath(item.filepath) || typeof item.language !== 'string' || !item.language
        || /[\u0000-\u001f]/.test(item.language) || Object.hasOwn(Object.prototype, item.language) || item.language === 'prototype'
        || !Number.isSafeInteger(item.occurrence) || item.occurrence < 1 || item.occurrence > 10000 || !HEX.test(item.blockHash)) throw new Error('Invalid archive decision.');
      const key = JSON.stringify([item.filepath, item.language]);
      if (seen.has(key)) throw new Error('Duplicate archive decision.');
      seen.add(key);
      return { filepath: item.filepath, language: item.language, occurrence: item.occurrence, blockHash: item.blockHash };
    }).sort((a, b) => compare(a.filepath, b.filepath) || compare(a.language, b.language));
  }
  function configHash(value, provider) {
    if (value?.parserVersion !== 1) throw new Error('Unsupported baseline parser version.');
    return digest('sdeditor:baseline:config:v1', { parserVersion: 1, decisions: normalizeDecisions(value.decisions) }, provider);
  }
  function baselineId(value, provider) {
    if (![value?.zipHash, value?.configHash, value?.treeRoot].every(item => HEX.test(item))) throw new Error('Invalid archive identity.');
    return digest('sdeditor:baseline:id:v1', { zipHash: value.zipHash, configHash: value.configHash, treeRoot: value.treeRoot }, provider);
  }
  function normalizeArchive(value) {
    if (!value || value.version !== 1 || value.parserVersion !== 1 || !HEX.test(value.zipHash) || !HEX.test(value.treeRoot)
      || !Number.isSafeInteger(value.zipSize) || value.zipSize <= 0 || !Number.isSafeInteger(value.fileCount) || value.fileCount <= 0
      || value.fileCount > 100000 || !Number.isSafeInteger(value.descriptionCount) || value.descriptionCount <= 0 || value.descriptionCount > value.fileCount
      || (value.configHash != null && !HEX.test(value.configHash)) || (value.baselineId != null && !HEX.test(value.baselineId))) throw new Error('Invalid archive descriptor.');
    return { version: 1, zipHash: value.zipHash, zipSize: value.zipSize, fileCount: value.fileCount, descriptionCount: value.descriptionCount,
      parserVersion: 1, decisions: normalizeDecisions(value.decisions), treeRoot: value.treeRoot,
      ...(value.configHash ? { configHash: value.configHash } : {}), ...(value.baselineId ? { baselineId: value.baselineId } : {}) };
  }
  async function finalizeArchive(value, provider) {
    const archive = normalizeArchive(value);
    const calculatedConfig = await configHash(archive, provider);
    if (archive.configHash && archive.configHash !== calculatedConfig) throw new Error('Archive configuration hash differs.');
    archive.configHash = calculatedConfig;
    const calculatedId = await baselineId(archive, provider);
    if (archive.baselineId && archive.baselineId !== calculatedId) throw new Error('Archive identity differs.');
    archive.baselineId = calculatedId;
    return archive;
  }
  async function buildBaselineTree(source, provider, options = {}) {
    if (!Array.isArray(source) || !source.length) throw new Error('A baseline requires descriptions.');
    const files = source.map(witness).sort((a, b) => compare(a.filepath, b.filepath));
    if (files.some((file, index) => index && file.filepath === files[index - 1].filepath)) throw new Error('Duplicate baseline filepath.');
    let total = files.length;
    for (let width = files.length; width > 1;) { width = Math.ceil(width / 2); total += width; }
    let completed = 0;
    const report = () => {
      if (options.isCancelled?.()) throw Object.assign(new Error('Collaboration workspace changed.'), { stale: true });
      options.onProgress?.({ completed, total, unit: 'items' });
    };
    report();
    const track = async pending => { const hash = await pending; completed++; report(); return hash; };
    const levels = [await Promise.all(files.map(file => track(leafHash(file, provider))))];
    while (levels[levels.length - 1].length > 1) {
      const previous = levels[levels.length - 1]; const next = [];
      for (let index = 0; index < previous.length; index += 2) next.push(track(parentHash(previous[index], previous[index + 1] || previous[index], provider)));
      levels.push(await Promise.all(next));
    }
    return { version: 1, root: levels[levels.length - 1][0], paths: files.map(file => file.filepath), levels };
  }
  function baselineProof(tree, filepath) {
    let index = tree?.paths?.indexOf(filepath);
    if (tree?.version !== 1 || index == null || index < 0 || !Array.isArray(tree.levels)) throw new Error('Baseline file is absent from the proof cache.');
    const proof = { index, siblings: [] };
    for (let level = 0; level < tree.levels.length - 1; level++) {
      const nodes = tree.levels[level];
      proof.siblings.push({ hash: nodes[index ^ 1] || nodes[index], left: !!(index % 2) });
      index = Math.floor(index / 2);
    }
    return proof;
  }
  async function verifyBaselineProof(file, proof, treeRoot, count, provider) {
    if (!HEX.test(treeRoot) || !Number.isSafeInteger(count) || count < 1 || count > 100000 || !Number.isSafeInteger(proof?.index)
      || proof.index < 0 || proof.index >= count || !Array.isArray(proof.siblings) || proof.siblings.length > 17) return false;
    let hash = await leafHash(file, provider); let index = proof.index; let width = count; let offset = 0;
    while (width > 1) {
      const sibling = proof.siblings[offset++];
      if (!sibling || !HEX.test(sibling.hash) || sibling.left !== !!(index % 2)) return false;
      if (index === width - 1 && width % 2 && sibling.hash !== hash) return false;
      hash = sibling.left ? await parentHash(sibling.hash, hash, provider) : await parentHash(hash, sibling.hash, provider);
      index = Math.floor(index / 2); width = Math.ceil(width / 2);
    }
    return offset === proof.siblings.length && hash === treeRoot;
  }
  function manifestFile(desc, paths) {
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
    return { filepath: desc.filepath, name: desc.name || '', stats: [...desc.stats], english: [...english], variables: [...desc.variables], remarks: [...desc.remarks] };
  }
  function manifest(source) {
    if (!Array.isArray(source) || !source.length) throw new Error('Collaboration requires a nonempty source archive.');
    const paths = new Set();
    const files = source.map(desc => manifestFile(desc, paths));
    files.sort((a, b) => a.filepath < b.filepath ? -1 : a.filepath > b.filepath ? 1 : 0);
    return { version: 1, files };
  }
  function preparationSlice({ isCancelled = () => false, yieldTask = () => new Promise(resolve => setTimeout(resolve, 0)), budgetMs = 8 } = {}) {
    let start = Date.now();
    const check = () => { if (isCancelled()) throw Object.assign(new Error('Collaboration workspace changed.'), { stale: true }); };
    return async force => {
      check();
      if (force || Date.now() - start >= budgetMs) {
        await yieldTask(); check(); start = Date.now();
      }
    };
  }
  async function manifestAsync(source, options = {}) {
    if (!Array.isArray(source) || !source.length) throw new Error('Collaboration requires a nonempty source archive.');
    const checkpoint = preparationSlice(options), paths = new Set(), files = [];
    options.onProgress?.({ completed: 0, total: source.length, unit: 'files' });
    for (const desc of source) {
      files.push(manifestFile(desc, paths));
      if (files.length % 64 === 0) {
        await checkpoint();
        options.onProgress?.({ completed: files.length, total: source.length, unit: 'files' });
      }
    }
    await checkpoint();
    files.sort((a, b) => compare(a.filepath, b.filepath));
    await checkpoint();
    options.onProgress?.({ completed: files.length, total: source.length, unit: 'files' });
    return { version: 1, files };
  }
  async function sourceHashAsync(source, options = {}) {
    const input = source?.version === 1 && Array.isArray(source.files) ? source.files : source;
    if (!Array.isArray(input) || !input.length) throw new Error('Collaboration requires a nonempty source archive.');
    const total = input.length * 3 + 3;
    const report = completed => options.onProgress?.({ completed, total, unit: 'items' });
    const value = await manifestAsync(input, { ...options, onProgress: progress => report(progress.completed) });
    options.onManifest?.(value);
    const provider = cryptoProvider(options.cryptoProvider), encoder = new TextEncoder(), checkpoint = preparationSlice(options);
    const chunks = [encoder.encode('{"version":1,"files":[')];
    let length = chunks[0].length;
    for (let index = 0; index < value.files.length; index++) {
      const bytes = encoder.encode((index ? ',' : '') + JSON.stringify(value.files[index]));
      chunks.push(bytes); length += bytes.length;
      if (index % 64 === 63) { await checkpoint(); report(value.files.length + index + 1); }
    }
    report(value.files.length * 2);
    chunks.push(encoder.encode(']}')); length += 2;
    const bytes = new Uint8Array(length); let offset = 0;
    for (let index = 0; index < chunks.length; index++) {
      bytes.set(chunks[index], offset); offset += chunks[index].length;
      if (index % 64 === 63) { await checkpoint(); report(value.files.length * 2 + index + 1); }
    }
    await checkpoint();
    report(total - 1);
    const digest = await provider.subtle.digest('SHA-256', bytes);
    await checkpoint();
    report(total);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
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
      trackedForExport: !!file.trackedForExport, revision: Number(file.revision) || 0,
      ...(!file.trackedForExport && file.stagingReset ? { stagingReset: true } : {}),
      ...(Array.isArray(file.beforeTranslations) ? { beforeTranslations: copy(file.beforeTranslations) } : {}) };
  }
  function contentEqual(a, b) {
    return !!a && !!b && equal(a.translations, b.translations)
      && !!a.needsReview === !!b.needsReview && !!a.trackedForExport === !!b.trackedForExport;
  }
  function mergeFile(base, yours, shared) {
    if (!shared) throw new Error('Shared file is missing: ' + yours.filepath);
    if (yours.stagingReset && !yours.trackedForExport) {
      // Removing a staged save is a decision about the complete file. Never
      // combine its original ZIP text with a concurrent translator's changes.
      if (shared.stagingReset && contentEqual(yours, shared)) return { file: fileState(shared), indexes: [], metadata: [], conflict: false };
      const unchanged = !!base && base.revision === shared.revision && contentEqual(base, shared);
      const indexes = unchanged ? [] : Array.from({ length: Math.max(yours.translations.length, shared.translations.length) }, (_, index) => index)
        .filter(index => (yours.translations[index] ?? '') !== (shared.translations[index] ?? ''));
      return { file: fileState(yours), indexes, metadata: unchanged ? [] : ['trackedForExport'], conflict: !unchanged };
    }
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
    if (result.trackedForExport) delete result.stagingReset;
    return { file: result, indexes, metadata, conflict: indexes.length > 0 || metadata.length > 0 };
  }
  function scopeKey(identity) {
    const branch = identity.branchId || 'default';
    const parts = branch === 'default' ? [String(identity.accountId), identity.game, identity.sourceHash, identity.language]
      : [String(identity.accountId), identity.game, branch, identity.sourceHash, identity.language];
    if (identity.groupId) parts.push({ versionId: String(identity.versionId || ''), groupId: String(identity.groupId) });
    return JSON.stringify(parts);
  }
  function projectWorkspace(workspace, files, language, source = [], { mutate = false } = {}) {
    // Internal transaction projections own their IndexedDB snapshot. Other
    // callers receive an independent copy.
    const result = mutate ? workspace || { descs: [], status: {} } : copy(workspace || { descs: [], status: {} });
    result.descs ||= []; result.status ||= {};
    WorkspaceState.initializeWorkspace(result, { source, language });
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
      originals ||= new Map(source.map(desc => [desc.filepath, desc]));
      if (file.needsReview) {
        if (!WorkspaceState.droppedForFile(result, file.filepath, language) && file.translations.some(text => text.trim())) {
          WorkspaceState.dropTranslation(result, desc, language, { translations: file.translations,
            originSourceHash: '', originSourceAvailable: false, targetSourceHash: result.sourceHash,
            reason: 'Preserved legacy dropped translation' });
        }
      } else if (file.stagingReset && !file.trackedForExport) {
        if (result.staged[language]) delete result.staged[language][file.filepath];
      } else if (file.trackedForExport || file.revision > 0) {
        WorkspaceState.stageTranslation(result, file, language, { source: originals.get(file.filepath) });
      }
      desc.translations[language] = file.needsReview
        ? WorkspaceState.workspaceFile(result, originals.get(file.filepath) || desc, language).translations
        : copy(file.translations);
    }
    return WorkspaceState.pruneWorkspaceStatus(result);
  }
  return { copy, equal, manifest, manifestAsync, sourceHash, sourceHashAsync, fingerprint: sourceHash, fileState, contentEqual, mergeFile, scopeKey, projectWorkspace,
    zipHash, witness, leafHash, parentHash, blockHash, normalizeDecisions, configHash, baselineId, normalizeArchive, finalizeArchive,
    buildBaselineTree, baselineProof, verifyBaselineProof };
});
