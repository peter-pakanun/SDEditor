/* Historical v1 proof data for compatibility fixtures only. Never loaded by the app. */
const P = require('../public/collaborationProtocol.js');
const crypto = require('node:crypto');
const digest = async (domain, value, provider) => {
  const bytes = new TextEncoder().encode(domain + '\n' + JSON.stringify(value));
  return Buffer.from(await (provider || crypto.webcrypto).subtle.digest('SHA-256', bytes)).toString('hex');
};
const leafHash = (file, provider) => digest('sdeditor:baseline:leaf:v1', P.witness(file), provider);
const parentHash = (left, right, provider) => digest('sdeditor:baseline:parent:v1', [left, right], provider);
async function buildBaselineTree(source, provider, options = {}) {
  const files = P.validateBaselineSource(source);
  let total = files.length;
  for (let width = files.length; width > 1;) { width = Math.ceil(width / 2); total += width; }
  let completed = 0;
  const report = () => options.onProgress?.({ completed, total, unit: 'items' });
  const track = async pending => { const hash = await pending; completed++; report(); return hash; };
  report();
  const levels = [await Promise.all(files.map(file => track(leafHash(file, provider))))];
  while (levels.at(-1).length > 1) {
    const previous = levels.at(-1), next = [];
    for (let index = 0; index < previous.length; index += 2) next.push(track(parentHash(previous[index], previous[index + 1] || previous[index], provider)));
    levels.push(await Promise.all(next));
  }
  return { version: 1, root: levels.at(-1)[0], paths: files.map(file => file.filepath), levels };
}
function baselineProof(tree, filepath) {
  let index = tree.paths.indexOf(filepath);
  if (index < 0) throw new Error('Baseline file is absent from the fixture tree.');
  const proof = { index, siblings: [] };
  for (const nodes of tree.levels.slice(0, -1)) {
    proof.siblings.push({ hash: nodes[index ^ 1] || nodes[index], left: !!(index % 2) });
    index = Math.floor(index / 2);
  }
  return proof;
}
async function verifyBaselineProof(file, proof, root, count, provider) {
  if (!Number.isSafeInteger(proof?.index) || proof.index < 0 || proof.index >= count || !Array.isArray(proof.siblings)) return false;
  let hash = await leafHash(file, provider), index = proof.index, width = count, offset = 0;
  while (width > 1) {
    const sibling = proof.siblings[offset++];
    if (!sibling || sibling.left !== !!(index % 2) || index === width - 1 && width % 2 && sibling.hash !== hash) return false;
    hash = sibling.left ? await parentHash(sibling.hash, hash, provider) : await parentHash(hash, sibling.hash, provider);
    index = Math.floor(index / 2); width = Math.ceil(width / 2);
  }
  return offset === proof.siblings.length && hash === root;
}
module.exports = { ...P, buildBaselineTree, baselineProof, verifyBaselineProof };
