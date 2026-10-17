/* ZIP work is isolated from the durable-save worker. */
'use strict';
importScripts('workspaceState.js', 'collaborationProtocol.js', 'statDescCodec.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', 'sdBaselineFiles.js');
const engine = self.SDBaselineFiles.createArchiveEngine({ JSZip: self.JSZip });
self.onmessage = async event => {
  const { id, type, blob, archive, filepath, filepaths } = event.data || {};
  try {
    if (!['extract', 'extractMany', 'prepare', 'verify', 'hash'].includes(type)) throw new Error('Unknown source worker operation.');
    const result = type === 'hash' ? { zipHash: await self.CollaborationProtocol.zipHash(blob), zipSize: blob.size ?? blob.byteLength }
      : type === 'prepare' ? await engine.prepare(blob, archive)
      : type === 'extractMany' ? await engine.extractMany(blob, archive, filepaths)
      : type === 'extract' ? await engine.extract(blob, archive, filepath) : (await engine.verifyZip(blob, archive)).descriptor;
    self.postMessage({ id, type: 'result', result });
  } catch (error) { self.postMessage({ id, type: 'error', error: { message: error.message, code: error.code } }); }
};
self.postMessage({ type: 'ready', version: 1 });
