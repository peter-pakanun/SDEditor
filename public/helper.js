function allProgress(proms, progress_cb) {
  let d = 0;
  progress_cb(0);
  for (const p of proms) {
    p.then(() => {
      d++;
      progress_cb((d * 100) / proms.length);
    }, () => {});
  }
  return Promise.all(proms);
}

function arrayEquals(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function arrayMove(arr, old_index, new_index) {
  if (new_index >= arr.length) {
    var k = new_index - arr.length + 1;
    while (k--) {
      arr.push(undefined);
    }
  }
  arr.splice(new_index, 0, arr.splice(old_index, 1)[0]);
  return arr; // for testing
};

function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function unescapeHtml(escaped) {
  if (escaped == null) return "";
  let el = document.createElement("textarea");
  el.innerHTML = String(escaped);
  return el.value;
}

function computeIsMissing(engLen, lines) {
  if (!Number.isFinite(engLen) || engLen < 0) engLen = 0;
  if (!Array.isArray(lines)) return engLen > 0;
  if (lines.length !== engLen) return true;
  for (let i = 0; i < engLen; i++) {
    if (String(lines[i] ?? "").trim() === "") return true;
  }
  return false;
}

function getZipTxtFilepaths(zip) {
  const out = [];
  const files = zip?.files;
  if (!files || typeof files !== "object") return out;
  for (let filepath in files) {
    if (!Object.prototype.hasOwnProperty.call(files, filepath)) continue;
    const ext = String(filepath).split('.').pop().toLowerCase();
    if (ext !== 'txt') continue;
    out.push(filepath);
  }
  return out;
}

/**
 * @param {import('jszip').JSZipObject} zipObject
 * @param {string} [lang]
 */
async function decodeZipTxtFile(zipObject, lang) {
  let data = await zipObject.async('uint8array');
  // @ts-ignore
  let blob = new Blob([data]);
  const reader = new FileReader();
  // convert to promise
  return new Promise((resolve, reject) => {
    reader.readAsText(blob, 'utf-16le');
    reader.onload = function () {
      let text = String(reader.result)?.replace(/^\uFEFF/, '');
      resolve(text);
    };
    reader.onerror = reject;
  });
}

function makeLocalDesc(desc, lang, lines, { hasChanges, isMissing, derivedStatus = false } = {}) {
  // Detach flat string arrays from Vue proxies before they enter a storage snapshot.
  const english = Array.isArray(desc?.translations?.English) ? [...desc.translations.English] : [];
  const local = {
    filedir: desc?.filedir,
    filename: desc?.filename,
    filepath: desc?.filepath,
    ...(derivedStatus ? {} : {
      hasChanges: typeof hasChanges === "undefined" ? !!desc?.hasChanges : !!hasChanges,
      isMissing: typeof isMissing === "undefined" ? !!desc?.isMissing : !!isMissing,
    }),
    name: desc?.name,
    remarks: Array.isArray(desc?.remarks) ? [...desc.remarks] : desc?.remarks,
    stats: Array.isArray(desc?.stats) ? [...desc.stats] : desc?.stats,
    variables: Array.isArray(desc?.variables) ? [...desc.variables] : desc?.variables,
    translations: {
      English: english,
    }
  };
  if (lang) {
    local.translations[lang] = Array.isArray(lines) ? [...lines] : [];
    if (!derivedStatus) window.WorkspaceState.setDescriptionStatus(local, lang, { hasChanges: local.hasChanges, isMissing: local.isMissing });
  }
  return local;
}

function updateLocalDesc(localDesc, desc, lang, lines, { hasChanges, isMissing, derivedStatus = false } = {}) {
  if (!localDesc || typeof localDesc !== "object") return;
  // Capture legacy flags before adding another language to this description.
  if (!derivedStatus) window.WorkspaceState.descriptionStatus(localDesc, lang);
  localDesc.filedir = desc?.filedir;
  localDesc.filename = desc?.filename;
  localDesc.filepath = desc?.filepath;
  localDesc.name = desc?.name;
  localDesc.remarks = Array.isArray(desc?.remarks) ? [...desc.remarks] : desc?.remarks;
  localDesc.stats = Array.isArray(desc?.stats) ? [...desc.stats] : desc?.stats;
  localDesc.variables = Array.isArray(desc?.variables) ? [...desc.variables] : desc?.variables;
  if (!derivedStatus && typeof hasChanges !== "undefined") localDesc.hasChanges = !!hasChanges;
  if (!derivedStatus && typeof isMissing !== "undefined") localDesc.isMissing = !!isMissing;
  if (!localDesc.translations || typeof localDesc.translations !== "object") localDesc.translations = {};
  if (Array.isArray(desc?.translations?.English)) localDesc.translations.English = [...desc.translations.English];
  if (lang) localDesc.translations[lang] = Array.isArray(lines) ? [...lines] : [];
  if (lang && !derivedStatus) window.WorkspaceState.setDescriptionStatus(localDesc, lang, {
    ...(typeof hasChanges !== "undefined" ? { hasChanges: !!hasChanges } : {}),
    ...(typeof isMissing !== "undefined" ? { isMissing: !!isMissing } : {}),
  });
  if (derivedStatus) window.WorkspaceState.pruneWorkspaceStatus({ stagedVersion: 1, descs: [localDesc], status: {} });
}
