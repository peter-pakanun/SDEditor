/* Immutable SD files are resolved individually; callers own their scope fence. */
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const api = factory(root, node ? require('./collaborationProtocol.js') : root.CollaborationProtocol,
    node ? require('./statDescCodec.js') : root.StatDescCodec);
  if (node) module.exports = api; else root.SDBaselineFiles = api;
})(typeof window === 'object' ? window : globalThis, function (root, protocol, codec) {
  'use strict';
  const HEX = /^[a-f0-9]{64}$/, copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const validPath = path => typeof path === 'string' && !!path && !path.includes('\\') && !/[\u0000-\u001f]/.test(path)
    && !path.split('/').some(part => !part || part === '.' || part === '..');
  const unavailable = message => Object.assign(new Error(message || 'The original source is unavailable. Reconnect or import its original ZIP to compare this file. Your translation is preserved.'), { code: 'SD_BASELINE_UNAVAILABLE' });
  function checkpoint(options = {}) {
    if (options.signal?.aborted || options.current && !options.current()) throw Object.assign(new Error('The source comparison context changed.'), { stale: true, code: 'SD_BASELINE_STALE' });
  }
  function normalizeReference(value) {
    const ref = copy(value), baselineId = ref?.baselineId || ref?.sourceHash;
    if (typeof baselineId !== 'string' || !baselineId || !validPath(ref?.filepath)
      || ref.fingerprint != null && !HEX.test(ref.fingerprint)) throw new Error('Invalid immutable SD source reference.');
    return { ...ref, baselineId, sourceHash: baselineId };
  }
  async function fingerprint(file) {
    const bytes = new TextEncoder().encode('sdeditor:baseline:leaf:v1\n' + JSON.stringify(protocol.witness(file)));
    return protocol.zipHash(bytes);
  }
  async function verifiedFile(file, ref) {
    if (!file || file.filepath !== ref.filepath) throw unavailable('The retained source file does not match this comparison. Your translation is preserved.');
    const result = protocol.witness(file);
    if (ref.fingerprint && await fingerprint(result) !== ref.fingerprint) throw unavailable('The retained source fingerprint differs. Reimport the original ZIP before comparing. Your translation is preserved.');
    return result;
  }
  // This engine is also used in a dedicated worker. Reading a ZIP directory does
  // not inflate entries. Never enable JSZip checkCRC32: it inflates every file.
  function createArchiveEngine({ JSZip = root.JSZip, maxArchives = 2, yieldTask = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) {
    const archives = new Map(), opening = new Map();
    let opens = 0, extractions = 0;
    async function verifyZip(blob, archive) {
      const descriptor = await protocol.finalizeArchive(archive);
      await yieldTask();
      const bytes = blob?.arrayBuffer ? await blob.arrayBuffer() : blob;
      if ((bytes?.byteLength ?? bytes?.length) !== descriptor.zipSize || await protocol.zipHash(bytes) !== descriptor.zipHash) throw unavailable('The cached original ZIP is corrupt or belongs to another baseline. Reimport its original ZIP. Your translation is preserved.');
      return { descriptor, bytes };
    }
    async function open(blob, archive) {
      const descriptor = await protocol.finalizeArchive(archive), key = descriptor.zipHash;
      if (archives.has(key)) { const value = archives.get(key); archives.delete(key); archives.set(key, value); return value; }
      if (!opening.has(key)) {
        const pending = (async () => {
          const { bytes } = await verifyZip(blob, descriptor);
          if (!JSZip?.loadAsync) throw unavailable('ZIP extraction is unavailable. Reload the editor before comparing.');
          const zip = await JSZip.loadAsync(bytes, { checkCRC32: false }), entries = Object.values(zip.files).filter(entry => !entry.dir);
          if (entries.length !== descriptor.fileCount) throw unavailable('The original ZIP file count differs from its accepted baseline.');
          let expanded = 0;
          for (const entry of entries) {
            if (!validPath(entry.name) || entry.unsafeOriginalName && entry.unsafeOriginalName !== entry.name) throw unavailable('The original ZIP contains an unsafe path.');
            const size = entry._data?.uncompressedSize || 0; expanded += size;
            if (size > 2 * 1024 * 1024 || expanded > 256 * 1024 * 1024) throw unavailable('The original ZIP exceeds the extracted-size limit.');
          }
          const value = { zip, fileCount: entries.length }; archives.set(key, value); opens++;
          while (archives.size > maxArchives) archives.delete(archives.keys().next().value);
          return value;
        })();
        opening.set(key, pending); pending.finally(() => opening.delete(key)).catch(() => {});
      }
      return opening.get(key);
    }
    async function extract(blob, archive, filepath, yieldBefore = true) {
      const descriptor = await protocol.finalizeArchive(archive);
      if (!validPath(filepath) || !/\.txt$/i.test(filepath)) throw new Error('Invalid SD comparison filepath.');
      const value = await open(blob, descriptor);
      if (value.fileCount !== descriptor.fileCount) throw unavailable('The accepted ZIP file count changed.');
      const entry = value.zip.file(filepath);
      if (!entry || entry.dir) throw unavailable('This file is absent from its original ZIP. Your translation is preserved.');
      if (yieldBefore) await yieldTask();
      const bytes = await entry.async('uint8array'); extractions++;
      if (bytes.byteLength > 2 * 1024 * 1024) throw unavailable('The source file exceeds the extracted-size limit.');
      const raw = codec.parseText(filepath, codec.decodeUTF16(bytes), 'English', { strict: true });
      if (!raw) throw unavailable('This file does not contain a StatDescription source.');
      const files = await codec.applyDuplicateSelections([raw], descriptor.decisions.filter(decision => decision.filepath === filepath), { language: 'English' });
      return protocol.witness(files[0]);
    }
    async function extractMany(blob, archive, filepaths) {
      if (!Array.isArray(filepaths) || filepaths.length > 64) throw new Error('Invalid SD extraction batch.');
      await yieldTask();
      const result = [];
      for (const filepath of filepaths) result.push(await extract(blob, archive, filepath, false));
      return result;
    }
    return { extract, extractMany, verifyZip, async prepare(blob, archive) {
      const descriptor = await protocol.finalizeArchive(archive);
      const value = await open(blob, descriptor);
      if (value.fileCount !== descriptor.fileCount) throw unavailable('The accepted ZIP file count changed.');
      return descriptor;
    }, stats: () => ({ opens, extractions, archives: archives.size }), clear: () => archives.clear() };
  }
  function createWorkerClient({ Worker = root.Worker, url = 'sdBaselineWorker.js', engine = createArchiveEngine(), readyTimeout = 5000 } = {}) {
    let worker, sequence = 0, readyTimer, settled = false, disposed = false;
    const stopped = () => Object.assign(new Error('Source worker cancelled.'), { name: 'AbortError', stale: true });
    const pending = new Map(); let resolveReady;
    const ready = new Promise(resolve => { resolveReady = resolve; });
    const fail = () => {
      clearTimeout(readyTimer); worker?.terminate(); worker = null;
      if (!settled) { settled = true; resolveReady(false); }
      for (const request of pending.values()) request.reject(disposed ? stopped() : Object.assign(new Error('The source extraction worker stopped.'), { workerFailed: true }));
      pending.clear();
    };
    try {
      if (typeof Worker !== 'function') fail();
      else {
        worker = new Worker(url);
        worker.onmessage = event => {
          const message = event.data;
          if (message?.type === 'ready') { clearTimeout(readyTimer); settled = true; resolveReady(true); return; }
          const request = pending.get(message?.id); if (!request) return; pending.delete(message.id);
          if (message.type === 'result') request.resolve(message.result);
          else request.reject(Object.assign(new Error(message.error?.message || 'Could not extract the original source.'), message.error));
        };
        worker.onerror = fail; worker.onmessageerror = fail;
        readyTimer = setTimeout(fail, readyTimeout);
      }
    } catch (_) { fail(); }
    const fallback = async (type, input) => {
      if (type === 'hash') return { zipHash: await protocol.zipHash(input.blob), zipSize: input.blob.size ?? input.blob.byteLength };
      if (type === 'prepare') return engine.prepare(input.blob, input.archive);
      if (type === 'extractMany') return engine.extractMany(input.blob, input.archive, input.filepaths);
      return type === 'verify' ? engine.verifyZip(input.blob, input.archive).then(({ descriptor }) => descriptor) : engine.extract(input.blob, input.archive, input.filepath);
    };
    async function run(type, input) {
      if (disposed) throw stopped();
      await ready;
      if (disposed) throw stopped();
      if (!worker) return fallback(type, input);
      try {
        return await new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject });
          try { worker.postMessage({ id, type, ...input }); } catch (error) { pending.delete(id); reject(Object.assign(error, { workerFailed: true })); fail(); } });
      } catch (error) {
        if (disposed) throw stopped();
        if (!error.workerFailed) throw error;
        return fallback(type, input);
      }
    }
    return { extract: (blob, archive, filepath) => run('extract', { blob, archive, filepath }),
      extractMany: (blob, archive, filepaths) => run('extractMany', { blob, archive, filepaths }),
      prepare: (blob, archive) => run('prepare', { blob, archive }), verify: (blob, archive) => run('verify', { blob, archive }),
      hash: blob => run('hash', { blob }), dispose() { disposed = true; fail(); } };
  }
  function createResolver({ store = root.OfflineStore, extractor, maxFiles = 64, maxBytes = 16 * 1024 * 1024 } = {}) {
    const files = new Map(), pending = new Map(); let retainedBytes = 0;
    const worker = extractor || createWorkerClient();
    function remember(key, file) {
      const size = new TextEncoder().encode(JSON.stringify(file)).byteLength;
      if (size > maxBytes) return;
      if (files.has(key)) { retainedBytes -= files.get(key).size; files.delete(key); }
      files.set(key, { file, size }); retainedBytes += size;
      while (files.size > maxFiles || retainedBytes > maxBytes) { const first = files.keys().next().value; retainedBytes -= files.get(first).size; files.delete(first); }
    }
    async function resolveBaselineFile(value, options = {}, retrySharedStale = true) {
      checkpoint(options);
      const ref = normalizeReference(value);
      // Legacy room imports can share a source hash and have different original
      // targets. Their room/language bindings must remain in the cache identity.
      const key = JSON.stringify([ref.game || '', ref.baselineId, ref.filepath, ref.fingerprint || '', ref.roomId || '', ref.language || '', ref.candidateId || '']);
      // Immutable verified files can be reused, but authenticated in-flight
      // fetches belong to their captured account/access/content-group scope.
      const pendingKey = JSON.stringify([key, options.readScope || '']);
      if (files.has(key)) {
        const row = files.get(key);
        try {
          await options.validateFile?.(row.file, ref); checkpoint(options);
          files.delete(key); files.set(key, row); return copy(row.file);
        } catch (error) {
          if (error.stale) throw error;
          files.delete(key); retainedBytes -= row.size;
        }
      }
      // A caller's cancellation never poisons another caller's shared read.
      if (!pending.has(pendingKey)) {
        const read = (async () => {
          // A legacy source hash alone does not bind original target text. A
          // room-specific reference needs its fingerprint before using globals.
          let file = ref.roomId && !ref.fingerprint ? null : await (options.readFile ? options.readFile(ref) : store?.getBaselineFile?.(ref));
          const verify = async value => { const checked = await verifiedFile(value, ref); await options.validateFile?.(checked, ref); return checked; };
          if (file) { try { file = await verify(file); } catch (_) { file = null; } }
          if (!file) {
            let archive = ref.archive || options.archive || await store?.getBaselineArchive?.(ref);
            if (archive) {
              archive = await protocol.finalizeArchive(archive);
              if (archive.baselineId !== ref.baselineId) throw unavailable('The source archive identity differs from this historical version.');
              let blob = await store?.getStatDescriptionZip?.(archive.zipHash);
              if (!blob && options.fetchZip) { blob = await options.fetchZip(ref, archive); if (blob) await cacheOriginalZip(blob, archive); }
              if (blob) {
                try { file = await verify(await worker.extract(blob, archive, ref.filepath)); }
                catch (error) { if (!options.fetchFile) throw error; }
              }
            }
          }
          if (!file && options.fetchFile) {
            const response = await options.fetchFile(ref), accepted = response?.reference;
            if (accepted && ((accepted.baselineId || accepted.sourceHash) !== ref.baselineId || accepted.filepath !== ref.filepath
              || ref.fingerprint && accepted.fingerprint !== ref.fingerprint)) throw unavailable('The downloaded source reference differs from this comparison.');
            file = await verifiedFile(response?.file || response, { ...ref, fingerprint: ref.fingerprint || accepted?.fingerprint });
            await options.validateFile?.(file, ref);
          }
          if (!file) throw unavailable();
          remember(key, file); return file;
        })();
        pending.set(pendingKey, { promise: read, owner: options });
        read.finally(() => { if (pending.get(pendingKey)?.promise === read) pending.delete(pendingKey); }).catch(() => {});
      }
      const shared = pending.get(pendingKey);
      let result;
      try { result = await shared.promise; }
      catch (error) {
        checkpoint(options);
        // A custom fetch adapter may still tie its I/O to its first viewer.
        // Let another valid viewer use its own captured adapter once, without
        // replaying a cancelled caller's auth or creating a retry loop.
        if (error.stale && shared.owner !== options && retrySharedStale) return resolveBaselineFile(ref, options, false);
        throw error;
      }
      // Coalescing shares I/O, not the caller's frozen recovery evidence. Every
      // viewer validates its own expected metadata before publishing a result.
      await options.validateFile?.(result, ref); checkpoint(options); return copy(result);
    }
    async function cacheOriginalZip(blob, archive, options = {}) {
      checkpoint(options); const descriptor = await worker.verify(blob, archive); checkpoint(options);
      await store?.putStatDescriptionZip?.(descriptor.zipHash, blob, { zipSize: descriptor.zipSize, verified: true, archive: descriptor });
      checkpoint(options); return descriptor;
    }
    return { resolveBaselineFile, cacheOriginalZip, stats: () => ({ files: files.size, bytes: retainedBytes, pending: pending.size }),
      readZipIdentity: blob => worker.hash(blob), clear: () => { files.clear(); retainedBytes = 0; }, dispose: () => worker.dispose?.() };
  }
  let shared;
  const resolver = () => shared ||= createResolver();
  return { normalizeReference, fingerprint, verifiedFile, createArchiveEngine, createWorkerClient, createResolver, checkpoint,
    resolveBaselineFile: (...args) => resolver().resolveBaselineFile(...args), cacheOriginalZip: (...args) => resolver().cacheOriginalZip(...args),
    readZipIdentity: blob => resolver().readZipIdentity(blob) };
});
