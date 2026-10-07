/* Local workspace metadata belongs to the language whose translations it describes. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WorkspaceState = api;
})(typeof window === 'object' ? window : typeof self === 'object' ? self : this, function () {
  'use strict';
  const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
  const own = (value, key) => object(value) && Object.hasOwn(value, key);
  const languageName = value => typeof value === 'string' && !!value && value !== 'English' ? value : null;
  function translatedLanguage(local) {
    const languages = Object.keys(local?.translations || {}).filter(language => language !== 'English');
    return languages.length === 1 ? languageName(languages[0]) : null;
  }
  function descriptionOwner(local, legacyLanguage) {
    return languageName(local?.statusLanguage) || translatedLanguage(local) || languageName(legacyLanguage);
  }
  function fileOwner(status, local, legacyLanguage) {
    return languageName(status?.statusLanguage) || descriptionOwner(local, legacyLanguage);
  }
  function descriptionStatus(local, language, legacyLanguage) {
    const empty = { hasChanges: false, isMissing: false };
    if (!object(local)) return empty;
    const legacyFlags = own(local, 'hasChanges') || own(local, 'isMissing');
    if (!object(local.languageStatus) && !legacyFlags) return empty;
    if (!object(local.languageStatus)) local.languageStatus = {};
    const owner = descriptionOwner(local, legacyLanguage);
    if (legacyFlags && owner && !own(local.languageStatus, owner)) {
      local.languageStatus[owner] = { hasChanges: !!local.hasChanges, isMissing: !!local.isMissing };
      local.statusLanguage ||= owner;
    }
    const selected = own(local.languageStatus, language) ? local.languageStatus[language] : null;
    return { hasChanges: !!selected?.hasChanges, isMissing: !!selected?.isMissing };
  }
  function setDescriptionStatus(local, language, patch = {}) {
    if (!object(local) || !languageName(language)) return local;
    const selected = descriptionStatus(local, language, language);
    const values = object(patch.languageStatus?.[language]) ? patch.languageStatus[language] : patch;
    const next = { ...selected };
    for (const field of ['hasChanges', 'isMissing']) if (own(values, field)) next[field] = !!values[field];
    local.languageStatus ||= {}; local.languageStatus[language] = next;
    local.hasChanges = next.hasChanges; local.isMissing = next.isMissing;
    local.statusLanguage = language;
    return local;
  }
  const sourceFields = new Set(['deleted', 'deletedAt', 'lastSourceAt']);
  const excluded = new Set(['languageStatus', 'statusLanguage', 'reviewCandidates', ...sourceFields]);
  function metadata(value) {
    return Object.fromEntries(Object.entries(value || {}).filter(([field]) => !excluded.has(field)));
  }
  function fileStatus(status, language, local, legacyLanguage) {
    if (!object(status)) return { needsReview: false };
    const legacy = !object(status.languageStatus) || own(status, 'needsReview');
    if (!object(status.languageStatus)) status.languageStatus = {};
    const owner = fileOwner(status, local, legacyLanguage);
    if (legacy && owner && !own(status.languageStatus, owner)) {
      status.languageStatus[owner] = { ...metadata(status), ...(own(status, 'needsReview') ? { needsReview: !!status.needsReview } : {}) };
      status.statusLanguage ||= owner;
    }
    const selected = own(status.languageStatus, language) ? status.languageStatus[language] : null;
    return { ...(object(selected) ? selected : {}), needsReview: !!selected?.needsReview };
  }
  function setFileStatus(status, language, patch = {}, local) {
    if (!object(status) || !languageName(language)) return status;
    const selected = fileStatus(status, language, local, language);
    const values = object(patch.languageStatus?.[language]) ? patch.languageStatus[language] : metadata(patch);
    const next = { ...selected, ...values };
    next.needsReview = !!next.needsReview;
    status.languageStatus[language] = next;
    for (const field of Object.keys(status)) if (!excluded.has(field)) delete status[field];
    Object.assign(status, next); status.statusLanguage = language;
    for (const field of sourceFields) if (own(patch, field)) status[field] = patch[field];
    if (object(patch.reviewCandidates) && own(patch.reviewCandidates, language)) {
      if (!object(status.reviewCandidates)) status.reviewCandidates = {};
      status.reviewCandidates[language] = patch.reviewCandidates[language];
    }
    return status;
  }
  const statusFlags = new Set(['hasChanges', 'isMissing', 'isEdited', 'isRevised', 'isDropped', 'needsReview', 'trackedForExport']);
  const cleanMetadata = value => Object.fromEntries(Object.entries(value || {})
    .filter(([field]) => !statusFlags.has(field) && !excluded.has(field)));
  function setFileMetadata(status, language, patch = {}, local) {
    if (!object(status) || !languageName(language)) return status;
    const owner = fileOwner(status, local, language);
    if (!object(status.languageStatus)) {
      status.languageStatus = {};
      if (owner) status.languageStatus[owner] = cleanMetadata(status);
    }
    const values = object(patch.languageStatus?.[language]) ? patch.languageStatus[language] : patch;
    const next = { ...cleanMetadata(status.languageStatus[language]), ...cleanMetadata(values) };
    status.languageStatus[language] = next;
    for (const field of Object.keys(status)) if (!excluded.has(field)) delete status[field];
    Object.assign(status, next); status.statusLanguage = language;
    for (const field of sourceFields) if (own(patch, field)) status[field] = patch[field];
    return status;
  }
  function pruneWorkspaceStatus(workspace) {
    if (!object(workspace) || !(Number(workspace.stagedVersion) >= 1)) return workspace;
    const prune = value => {
      if (!object(value)) return;
      for (const flag of statusFlags) delete value[flag];
      for (const metadata of Object.values(value.languageStatus || {})) if (object(metadata)) {
        for (const flag of statusFlags) delete metadata[flag];
      }
      for (const [language, metadata] of Object.entries(value.languageStatus || {})) if (object(metadata) && !Object.keys(metadata).length) delete value.languageStatus[language];
      if (object(value.languageStatus) && !Object.keys(value.languageStatus).length) delete value.languageStatus;
    };
    for (const desc of workspace.descs || []) prune(desc);
    for (const status of Object.values(workspace.status || {})) prune(status);
    workspace.statusMetadataVersion = 1;
    return workspace;
  }
  function scopeWorkspace(workspace, legacyLanguage) {
    if (!object(workspace) || workspace.languageStatusVersion === 1) return workspace;
    const locals = new Map();
    for (const local of workspace.descs || []) {
      if (!object(local)) continue;
      descriptionStatus(local, legacyLanguage, legacyLanguage);
      if (local.filepath) locals.set(local.filepath, local);
    }
    for (const [filepath, status] of Object.entries(workspace.status || {})) {
      fileStatus(status, legacyLanguage, locals.get(filepath), legacyLanguage);
    }
    // Every new write records its language directly; older archives need this
    // whole-workspace migration only once.
    if (languageName(legacyLanguage)) workspace.languageStatusVersion = 1;
    return workspace;
  }
  const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const canonical = value => Array.isArray(value) ? value.map(canonical) : object(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const serialized = value => JSON.stringify(canonical(value));
  const equal = (left, right) => serialized(left) === serialized(right);
  const timestamp = value => typeof value === 'string' ? Date.parse(value) || Number(value) || 0 : Number(value) || 0;
  const lines = value => Array.isArray(value) ? value.map(text => String(text ?? '')) : [];
  function displayedLines(value, count) {
    const result = lines(value);
    while (result.length < count) result.push('');
    return result;
  }
  const complete = (value, count) => Array.isArray(value) && value.length === count && value.every(text => String(text).trim());
  const snapshot = (desc, language, translations) => ({ english: lines(desc?.translations?.English),
    variables: copy(desc?.variables || []), remarks: copy(desc?.remarks || []), stats: copy(desc?.stats || []),
    name: String(desc?.name || ''), translations: lines(translations ?? desc?.translations?.[language]) });
  const sameSource = (left, right) => !!left && !!right && equal(snapshot(left, 'English', []), snapshot(right, 'English', []));
  const droppedScopeCache = new WeakMap();
  function invalidateDroppedScopes(workspace) { droppedScopeCache.delete(workspace); }
  function sourceHashes(...values) {
    return [...new Set(values.flat().filter(value => typeof value === 'string' && !!value))];
  }
  function candidateScopes(...records) {
    return sourceHashes(...records.filter(object).flatMap(record => [record.targetSourceHashes || [], record.targetSourceHash]));
  }
  function rememberDroppedScope(candidate, sourceHash) {
    candidate.targetSourceHashes = sourceHashes(candidateScopes(candidate), sourceHash);
    return candidate;
  }
  function inWorkspaceScope(workspace, record) {
    if (!record) return false;
    const game = workspace?.game || workspace?.sourceBaseline?.game;
    if (game && record.game && game !== record.game) return false;
    if (record.collaborationAccountId && String(record.collaborationAccountId) !== String(workspace?.collaborationAccountId || '')) return false;
    return true;
  }
  function wasDroppedInSource(workspace, filepath, language) {
    if (!object(workspace) || !workspace.sourceHash) return false;
    const context = [workspace.droppedArchive, workspace.sourceHash, workspace.game || workspace.sourceBaseline?.game, workspace.collaborationAccountId];
    let cached = droppedScopeCache.get(workspace);
    if (!cached || context.some((value, index) => value !== cached.context[index])) {
      const byLanguage = new Map();
      for (const record of Object.values(workspace.droppedArchive || {})) {
        if (!inWorkspaceScope(workspace, record) || !candidateScopes(record).includes(workspace.sourceHash)
          || !record.filepath || !languageName(record.language)) continue;
        if (!byLanguage.has(record.language)) byLanguage.set(record.language, new Set());
        byLanguage.get(record.language).add(record.filepath);
      }
      cached = { context, byLanguage }; droppedScopeCache.set(workspace, cached);
    }
    return !!cached.byLanguage.get(language)?.has(filepath);
  }
  function maps(workspace) {
    workspace.staged ||= {}; workspace.dropped ||= {}; workspace.droppedArchive ||= {}; workspace.droppedOutbox ||= []; workspace.droppedConflicts ||= {};
    return workspace;
  }
  function droppedForFile(workspace, filepath, language) {
    const candidate = workspace?.dropped?.[language]?.[filepath];
    return candidate && inWorkspaceScope(workspace, candidate) && (!candidate.status || candidate.status === 'dropped') ? candidate : null;
  }
  function queueDropped(workspace, candidate, kind = 'put') {
    const previous = workspace.droppedOutbox.find(operation => operation.id === candidate.id && operation.kind === kind);
    const operation = { id: candidate.id, kind, revision: Number(candidate.revision) || 0, candidate: copy(candidate) };
    if (previous) Object.assign(previous, operation); else workspace.droppedOutbox.push(operation);
  }
  function dropTranslation(workspace, desc, language, options = {}) {
    if (!object(workspace) || !languageName(language) || !desc?.filepath) return null;
    maps(workspace);
    const content = options.snapshot || snapshot(desc, language, options.translations);
    const game = options.game || workspace.game;
    const originSourceHash = own(options, 'originSourceHash') ? options.originSourceHash || '' : workspace.sourceHash || '';
    const targetSourceHash = options.targetSourceHash || workspace.sourceHash || '';
    const signature = serialized([game, language, desc.filepath, originSourceHash, content]);
    const active = droppedForFile(workspace, desc.filepath, language);
    const sameContent = record => record && record.game === game && record.language === language && record.filepath === desc.filepath
      && record.originSourceHash === originSourceHash && equal(record.snapshot, content);
    const recoveryId = options.recoveryId || '';
    // A deliberate recovery is a new generation. Its stable action ID makes
    // retries idempotent, including after that generation has been resolved.
    let candidate;
    if (recoveryId) {
      const alias = workspace.droppedAliases?.[options.id || recoveryId];
      candidate = workspace.droppedArchive[options.id || recoveryId] || workspace.droppedArchive[alias?.id]
        || Object.values(workspace.droppedArchive).find(record => record.recoveryId === recoveryId);
      if (candidate && !sameContent(candidate)) throw new Error('This recovery action belongs to a different translation.');
    } else candidate = sameContent(active) ? active : Object.values(workspace.droppedArchive).find(sameContent);
    if (candidate && candidate.status !== 'dropped') return candidate;
    if (candidate) {
      candidate.targetSourceHashes = candidateScopes(candidate, options);
      rememberDroppedScope(candidate, targetSourceHash);
      candidate.targetSourceHash = targetSourceHash;
    } else {
      const id = options.id || recoveryId || globalThis.crypto?.randomUUID?.() || ('local-' + Date.now() + '-' + Math.random().toString(36).slice(2));
      candidate = { id, game, language, filepath: desc.filepath, originSourceHash, targetSourceHash,
        targetSourceHashes: candidateScopes(options),
        snapshot: copy(content), reason: options.reason || 'Source changed', signature, status: 'dropped',
        ...(recoveryId ? { recoveryId } : {}),
        originSourceAvailable: options.originSourceAvailable !== false,
        revision: Number(options.revision) || 0, createdAt: options.createdAt || Date.now(),
        ...(options.provenance ? { provenance: copy(options.provenance) } : {}),
        ...(options.baseline ? { baseline: copy(options.baseline), proof: copy(options.proof), originArchive: copy(options.originArchive) } : {}) };
      rememberDroppedScope(candidate, targetSourceHash);
    }
    if (active && active.id !== candidate.id) workspace.droppedArchive[active.id] = copy(rememberDroppedScope(active, workspace.sourceHash));
    (workspace.dropped[language] ||= {})[desc.filepath] = candidate;
    workspace.droppedArchive[candidate.id] = copy(candidate);
    invalidateDroppedScopes(workspace);
    queueDropped(workspace, candidate);
    return candidate;
  }
  function workspaceFile(workspace, desc, language) {
    const entry = workspace?.staged?.[language]?.[desc?.filepath];
    const staged = entry && (!entry.sourceHash || entry.sourceHash === workspace?.sourceHash) ? entry : null;
    const count = desc?.translations?.English?.length || 0;
    const translations = staged ? lines(staged.translations) : lines(desc?.translations?.[language]);
    while (translations.length < count) translations.push('');
    const candidate = droppedForFile(workspace, desc?.filepath, language);
    const baseline = desc?.translations?.[language];
    return { translations, hasChanges: !!staged, isRevised: !!staged && complete(baseline, count)
      && !equal(lines(baseline), translations) && !candidate && !wasDroppedInSource(workspace, desc?.filepath, language),
      isMissing: !complete(translations, count), isDropped: !!candidate,
      needsReview: !!candidate && !staged && !complete(translations, count), candidate, staged };
  }
  function stageTranslation(workspace, file, language, options = {}) {
    if (!object(workspace) || !languageName(language) || !file?.filepath) throw new Error('Invalid staged translation.');
    maps(workspace);
    const source = Array.isArray(options.source) ? options.source.find(desc => desc.filepath === file.filepath) : options.source;
    const current = workspace.staged[language]?.[file.filepath];
    const promotion = options.promoteDropped;
    if (promotion) {
      const candidate = droppedForFile(workspace, file.filepath, language);
      if (!candidate || candidate.id !== promotion.id || Number(candidate.revision || 0) !== Number(promotion.revision || 0)
        || (promotion.targetSourceHash && promotion.targetSourceHash !== (options.sourceHash || workspace.sourceHash))) {
        throw Object.assign(new Error('The dropped translation changed before it could be promoted.'), { stale: true });
      }
      rememberDroppedScope(candidate, options.sourceHash || workspace.sourceHash);
      workspace.droppedArchive[candidate.id] = { ...copy(candidate), status: 'promoted', resolvedAt: options.savedAt || Date.now() };
      delete workspace.dropped[language][file.filepath];
      invalidateDroppedScopes(workspace);
    }
    const entry = { sourceHash: options.sourceHash || workspace.sourceHash || '', translations: lines(file.translations),
      before: lines(file.beforeTranslations ?? options.before ?? (current && equal(current.translations, file.translations) ? current.before : current?.translations)
        ?? source?.translations?.[language]), savedAt: options.savedAt || Date.now() };
    const saveOrigin = options.saveOrigin || (current?.sourceHash === entry.sourceHash
      && equal(current.translations, entry.translations) ? current.saveOrigin : null);
    if (saveOrigin) entry.saveOrigin = saveOrigin;
    (workspace.staged[language] ||= {})[file.filepath] = entry;
    return entry;
  }
  function initializeWorkspace(workspace, options = {}) {
    if (!object(workspace)) return workspace;
    if (!workspace.game && options.game) workspace.game = options.game;
    if (Number(workspace.stagedVersion) >= 1) {
      if (!workspace.sourceBaseline?.sourceHash && options.sourceHash) {
        workspace.sourceHash ||= options.sourceHash;
        workspace.sourceBaseline = { sourceHash: options.sourceHash };
        for (const entries of Object.values(workspace.staged || {})) for (const entry of Object.values(entries)) entry.sourceHash ||= options.sourceHash;
        for (const candidates of Object.values(workspace.dropped || {})) for (const candidate of Object.values(candidates)) {
          candidate.targetSourceHash ||= options.sourceHash;
          rememberDroppedScope(candidate, options.sourceHash);
          workspace.droppedArchive[candidate.id] = copy(candidate); queueDropped(workspace, candidate);
        }
        invalidateDroppedScopes(workspace);
      }
      return workspace.statusMetadataVersion === 1 ? workspace : pruneWorkspaceStatus(workspace);
    }
    scopeWorkspace(workspace, options.language);
    maps(workspace);
    const source = Array.isArray(options.source) ? options.source : [];
    const originals = new Map(source.map(desc => [desc.filepath, desc]));
    const sourceHash = options.sourceHash || workspace.sourceHash || '';
    workspace.sourceHash ||= sourceHash;
    workspace.sourceBaseline ||= { sourceHash };
    for (const desc of workspace.descs || []) {
      if (!object(desc) || !desc.filepath) continue;
      const original = originals.get(desc.filepath);
      const languages = new Set([...Object.keys(desc.translations || {}), ...Object.keys(workspace.status?.[desc.filepath]?.reviewCandidates || {})].filter(languageName));
      for (const language of languages) {
        const state = descriptionStatus(desc, language);
        const status = fileStatus(workspace.status?.[desc.filepath], language, desc);
        const carried = status.needsReview ? workspace.status?.[desc.filepath]?.reviewCandidates?.[language] : null;
        const old = carried?.translations || desc.translations[language];
        const changedSource = original && !sameSource(desc, original);
        if (status.needsReview || (changedSource && (state.hasChanges || lines(old).some(text => text.trim())))) {
          const originSourceHash = carried?.sourceHash || workspace.sourceHash;
          const historical = options.originSources?.[originSourceHash]?.find(record => record.filepath === desc.filepath);
          const englishRevision = (options.revisions || []).filter(record => record.lang === 'English' && record.filepath === desc.filepath
            && record.sourceHash === originSourceHash && (!record.collaborationAccountId || String(record.collaborationAccountId) === String(workspace.collaborationAccountId))
            && Array.isArray(record.translations)).sort((left, right) => Number(right.savedAt) - Number(left.savedAt))[0];
          const origin = historical || (englishRevision ? { ...englishRevision, translations: { English: englishRevision.translations } } : desc);
          const originSourceAvailable = !!historical || (!englishRevision && !!originSourceHash && originSourceHash === workspace.sourceHash && !changedSource);
          dropTranslation(workspace, origin, language, { game: options.game, translations: old,
            originSourceHash, targetSourceHash: sourceHash, originSourceAvailable,
            reason: 'Preserved legacy review translation', createdAt: carried?.savedAt });
        // Legacy editors pad absent/short ZIP translations with blank entries.
        // Only infer a save when the padded text differs; an explicit
        // legacy save remains meaningful even when it is blank or unchanged.
        } else if (state.hasChanges || (original && !changedSource && !equal(
          displayedLines(desc.translations[language], original.translations?.English?.length || 0),
          displayedLines(original.translations?.[language], original.translations?.English?.length || 0)))) {
          if (!workspace.staged[language]?.[desc.filepath]) stageTranslation(workspace,
            { filepath: desc.filepath, translations: desc.translations[language] }, language,
            { source: original, sourceHash, savedAt: status.lastTranslatedAt || status.lastEditedAt,
              saveOrigin: state.hasChanges ? 'legacy_save' : 'legacy_inferred' });
        }
      }
    }
    for (const room of Object.values(options.collaboration?.rooms || {})) {
      const identity = room.identity;
      const accountId = options.accountId || workspace.collaborationAccountId;
      if (!identity || (options.game && identity.game !== options.game) || identity.sourceHash !== sourceHash
        || !accountId || String(identity.accountId) !== String(accountId)) continue;
      for (const carry of Object.values(room.carries || {})) {
        const desc = (workspace.descs || []).find(desc => desc.filepath === carry.filepath) || originals.get(carry.filepath);
        if (!desc) continue;
        dropTranslation(workspace, desc, identity.language, { game: identity.game, translations: carry.translations,
          originSourceHash: '', originSourceAvailable: false, targetSourceHash: sourceHash, reason: 'Preserved local review translation' });
        if (workspace.staged[identity.language]) delete workspace.staged[identity.language][carry.filepath];
      }
    }
    workspace.stagedVersion = 1;
    return pruneWorkspaceStatus(workspace);
  }
  // Only the old migration's empty padding is eligible. Authored timestamps,
  // history, receipts and explicit operations take precedence over this repair.
  function repairLegacyPlaceholders(workspace, options = {}) {
    if (!object(workspace) || workspace.placeholderRepairVersion === 1 || workspace.stagedVersion < 1
      || !options.evidenceComplete || !Array.isArray(options.source) || !options.source.length) return false;
    const originals = new Map(options.source.map(desc => [desc.filepath, desc]));
    const rooms = Object.values(options.collaboration?.rooms || {});
    const authored = new Set((options.revisions || []).filter(rev => rev.lang && rev.lang !== 'English')
      .map(rev => JSON.stringify([rev.filepath, rev.lang])));
    for (const receipt of options.receipts || []) {
      try {
        const data = JSON.parse(receipt.signature);
        if (data.scope?.[0] === (options.game || workspace.game)) for (const file of data.files || []) {
          authored.add(JSON.stringify([file.filepath, data.scope[1]]));
        }
      }
      catch (_) { if (receipt.result?.files?.length) return false; }
    }
    const roomIndexes = new Map(), canceledByRoom = new Map();
    const indexRoom = room => {
      if (!room) return { operations: new Map(), joins: new Map(), protected: new Set() };
      if (roomIndexes.has(room)) return roomIndexes.get(room);
      const index = { operations: new Map(), joins: new Map(), protected: new Set() };
      for (const op of room.outbox || []) for (const item of op.files || []) {
        const filepath = item.yours?.filepath;
        if (!index.operations.has(filepath)) index.operations.set(filepath, []);
        if (!index.operations.get(filepath).includes(op)) index.operations.get(filepath).push(op);
      }
      for (const record of room.recovery || []) for (const file of record.files || []) {
        if (record.reason === 'Local edited translation before joining') {
          if (!index.joins.has(file.filepath)) index.joins.set(file.filepath, []);
          index.joins.get(file.filepath).push(file);
        } else index.protected.add(file.filepath);
      }
      roomIndexes.set(room, index); return index;
    };
    let changed = false;
    for (const [language, entries] of Object.entries(workspace.staged || {})) for (const [filepath, entry] of Object.entries(entries)) {
      const original = originals.get(filepath), count = original?.translations?.English?.length;
      const empty = value => Array.isArray(value) && value.every(text => text === '');
      if (!object(entry) || !count || lines(original.translations?.[language]).length || entry.sourceHash !== workspace.sourceHash
        || !empty(entry.translations) || entry.translations.length !== count || !Array.isArray(entry.before) || entry.before.length
        || (entry.saveOrigin && entry.saveOrigin !== 'legacy_inferred') || droppedForFile(workspace, filepath, language)
        || wasDroppedInSource(workspace, filepath, language)) continue;
      const metadata = workspace.status?.[filepath];
      const status = metadata?.languageStatus?.[language] || (metadata?.statusLanguage === language ? metadata : {});
      if (timestamp(status.lastTranslatedAt) || timestamp(status.lastEditedAt)
        || authored.has(JSON.stringify([filepath, language]))) continue;
      const room = rooms.find(room => room.mode === 'sparse' && room.identity?.game === (options.game || workspace.game)
        && room.identity.sourceHash === workspace.sourceHash && room.identity.language === language
        && workspace.collaborationAccountId && String(room.identity.accountId) === String(workspace.collaborationAccountId));
      const index = indexRoom(room), operations = index.operations.get(filepath) || [];
      const isJoin = op => op.kind === 'join' && op.origin === 'merge' && !op.promoteDropped && !op.restore
        && op.files.length === 1 && op.files.every(item => item.yours.filepath === filepath && item.yours.trackedForExport && !item.yours.needsReview
          && item.yours.translations.length === count && empty(item.yours.translations)
          && item.base?.revision === 0 && !item.base.trackedForExport && !item.base.needsReview && empty(item.base.translations));
      if (operations.some(op => !isJoin(op))) continue;
      if (index.protected.has(filepath)) continue;
      const joinedHere = operations.some(isJoin) || index.joins.get(filepath)?.some(file => file.trackedForExport && !file.needsReview
        && empty(file.translations) && file.translations.length === count);
      if (workspace.collaborationAccountId && (!room || !joinedHere)) continue;
      const shared = room?.shared?.[filepath];
      if (shared && (shared.revision !== 1 || !shared.trackedForExport || shared.needsReview || !empty(shared.translations))) continue;
      const repairId = globalThis.crypto?.randomUUID?.() || ('placeholder-' + Date.now() + '-' + Math.random().toString(36).slice(2));
      workspace.placeholderRepairArchive ||= {};
      workspace.placeholderRepairArchive[repairId] = { filepath, language, sourceHash: workspace.sourceHash,
        staged: copy(entry), repairedAt: Date.now(), reason: 'Recovered migration placeholder', status: room ? 'pending' : 'local' };
      if (room) {
        room.placeholderRepairs ||= [];
        room.placeholderRepairs.push({ id: repairId, filepath, baseRevision: 1 });
        if (!canceledByRoom.has(room)) canceledByRoom.set(room, new Set());
        for (const op of operations) canceledByRoom.get(room).add(op);
        if (!shared && room.local) delete room.local[filepath];
      }
      // Shared records stay staged until the server validates and publishes the
      // reset. Local-only placeholders can immediately return to their ZIP state.
      if (!shared) delete entries[filepath];
      changed = true;
    }
    for (const [room, canceled] of canceledByRoom) {
      const ids = new Set([...canceled].map(op => op.id));
      room.outbox = (room.outbox || []).filter(op => !canceled.has(op));
      room.conflicts = (room.conflicts || []).filter(conflict => !ids.has(conflict.mutationId));
    }
    workspace.placeholderRepairVersion = 1;
    return changed;
  }
  function upgradeSource(workspace, options = {}) {
    initializeWorkspace(workspace, { ...options, source: options.previousSource, sourceHash: options.previousSourceHash || workspace.sourceHash });
    const old = new Map((options.previousSource || []).map(desc => [desc.filepath, desc]));
    const next = new Map((options.source || []).map(desc => [desc.filepath, desc]));
    for (const [language, entries] of Object.entries(workspace.staged || {})) for (const [filepath, entry] of Object.entries(entries)) {
      if (sameSource(old.get(filepath), next.get(filepath))) entry.sourceHash = options.sourceHash;
      else {
        const desc = old.get(filepath) || (workspace.descs || []).find(desc => desc.filepath === filepath);
        if (desc) dropTranslation(workspace, desc, language, { game: options.game, translations: entry.translations,
          originSourceHash: entry.sourceHash || options.previousSourceHash, targetSourceHash: options.sourceHash,
          reason: next.has(filepath) ? 'English source changed' : 'File removed from source', provenance: { savedAt: entry.savedAt } });
        delete entries[filepath];
      }
    }
    // A translation supplied by the old ZIP can disappear in the next release
    // even though nobody edited it locally. Keep that original context too.
    for (const previous of options.previousSource || []) {
      const current = next.get(previous.filepath);
      for (const language of Object.keys(previous.translations || {}).filter(languageName)) {
        const translations = lines(previous.translations[language]);
        if (!translations.some(text => text.trim()) || workspace.staged[language]?.[previous.filepath]
          || droppedForFile(workspace, previous.filepath, language)) continue;
        const currentCount = current?.translations?.English?.length || 0;
        if (current && complete(current.translations?.[language], currentCount)) continue;
        if (current && sameSource(previous, current) && equal(translations, lines(current.translations?.[language]))) continue;
        dropTranslation(workspace, previous, language, { game: options.game, translations,
          originSourceHash: options.previousSourceHash, targetSourceHash: options.sourceHash,
          reason: current ? 'Translation missing from new source' : 'File removed from source' });
      }
    }
    for (const candidates of Object.values(workspace.dropped || {})) for (const candidate of Object.values(candidates)) {
      rememberDroppedScope(candidate, options.sourceHash);
      candidate.targetSourceHash = options.sourceHash; workspace.droppedArchive[candidate.id] = copy(candidate);
      queueDropped(workspace, candidate);
    }
    for (const conflicts of Object.values(workspace.droppedConflicts || {})) for (const conflict of Object.values(conflicts)) {
      conflict.targetSourceHash = options.sourceHash;
      if (conflict.yours) {
        rememberDroppedScope(conflict.yours, options.sourceHash);
        conflict.yours.targetSourceHash = options.sourceHash;
      }
    }
    workspace.sourceHash = options.sourceHash;
    workspace.sourceBaseline = { sourceHash: options.sourceHash };
    invalidateDroppedScopes(workspace);
    return workspace;
  }
  function discardDropped(workspace, filepath, language, expected) {
    const candidate = droppedForFile(workspace, filepath, language);
    if (!candidate || (expected && (candidate.id !== expected.id || Number(candidate.revision) !== Number(expected.revision))))
      throw Object.assign(new Error('The dropped translation changed before it could be discarded.'), { stale: true });
    maps(workspace); rememberDroppedScope(candidate, workspace.sourceHash);
    workspace.droppedArchive[candidate.id] = { ...copy(candidate), status: 'discarded', resolvedAt: Date.now() };
    delete workspace.dropped[language][filepath]; queueDropped(workspace, candidate, 'discard');
    invalidateDroppedScopes(workspace);
    return candidate;
  }
  function acceptDropped(workspace, records, options = {}) {
    maps(workspace); workspace.droppedAliases ||= {};
    let byFingerprint;
    const fingerprint = record => serialized([record.game || workspace.game, record.language, record.filepath, record.originSourceHash || '', record.snapshot, record.recoveryId || '']);
    const matchingLocal = remote => {
      const known = workspace.droppedArchive[remote.id];
      if (known && inWorkspaceScope(workspace, known)) return known;
      // Resolved provenance tombstones have no snapshot with which to prove
      // an alias. A trusted upload receipt can still match its local ID below.
      if (remote.snapshot == null) return null;
      if (!byFingerprint) {
        byFingerprint = new Map(Object.values(workspace.droppedArchive)
          .filter(record => record.snapshot != null && inWorkspaceScope(workspace, record))
          .map(record => [fingerprint(record), record]));
      }
      return byFingerprint.get(fingerprint(remote)) || null;
    };
    for (const remote of records || []) {
      if (!remote?.id || !inWorkspaceScope(workspace, remote) || (options.game && remote.game !== options.game) || (options.language && remote.language !== options.language)) continue;
      const active = droppedForFile(workspace, remote.filepath, remote.language);
      const acknowledged = options.acknowledge && options.acknowledgeId ? workspace.droppedArchive[options.acknowledgeId] : null;
      const local = acknowledged?.language === remote.language && acknowledged?.filepath === remote.filepath && inWorkspaceScope(workspace, acknowledged)
        ? acknowledged : matchingLocal(remote);
      if (local && local.id !== remote.id) workspace.droppedAliases[local.id] = { id: remote.id, fromRevision: Number(local.revision) || 0,
        revision: Number(remote.revision) || 0, targetSourceHash: remote.targetSourceHash };
      if (local && Number(local.revision || 0) > Number(remote.revision || 0)) continue;
      const pending = workspace.droppedOutbox.some(operation => operation.id === local?.id);
      if (pending && !options.acknowledge) continue;
      const locallyResolved = local && ['promoted', 'discarded'].includes(local.status);
      const record = { ...copy(local || {}), ...copy(remote),
        targetSourceHash: remote.targetSourceHash || local?.targetSourceHash || '',
        targetSourceHashes: candidateScopes(local, remote),
        ...(remote.snapshot == null && local?.snapshot ? { snapshot: copy(local.snapshot) } : {}),
        ...(locallyResolved && remote.status === 'dropped' ? { status: local.status } : {}) };
      if (remote.status === 'dropped' || (active && (active.id === remote.id || active.id === local?.id))) rememberDroppedScope(record, workspace.sourceHash);
      workspace.droppedArchive[remote.id] = record;
      if (byFingerprint && record.snapshot != null) byFingerprint.set(fingerprint(record), record);
      if (local?.id && local.id !== remote.id) delete workspace.droppedArchive[local.id];
      if (options.acknowledge && local) workspace.droppedOutbox = workspace.droppedOutbox.filter(operation => operation.id !== (options.acknowledgeId || local.id)
        || operation.kind !== (options.acknowledgeKind || 'put'));
      if (record.status === 'dropped') {
        // A local reviewed promotion is already queued; an upload receipt must
        // not make its candidate visible again before the mutation completes.
        if (!locallyResolved && !workspace.droppedConflicts?.[remote.language]?.[remote.filepath]
          && (!active || active.id === local?.id || active.id === remote.id || timestamp(record.createdAt) >= timestamp(active.createdAt)))
          (workspace.dropped[remote.language] ||= {})[remote.filepath] = record;
      } else if (active && (active.id === remote.id || active.id === local?.id)) delete workspace.dropped[remote.language][remote.filepath];
      if (record.snapshot && record.targetSourceHashes.some(hash => !candidateScopes(remote).includes(hash))
        && !workspace.droppedConflicts?.[remote.language]?.[remote.filepath]) queueDropped(workspace, record);
    }
    invalidateDroppedScopes(workspace);
    return workspace;
  }
  function recordDroppedConflict(workspace, conflict) {
    maps(workspace);
    (workspace.droppedConflicts[conflict.language] ||= {})[conflict.filepath] = copy(conflict);
    if (conflict.shared?.id) {
      const existing = workspace.droppedArchive[conflict.shared.id];
      workspace.droppedArchive[conflict.shared.id] = { ...copy(existing || {}), ...copy(conflict.shared),
        targetSourceHashes: candidateScopes(existing, conflict.shared),
        ...(conflict.shared.snapshot == null && existing?.snapshot ? { snapshot: copy(existing.snapshot) } : {}) };
      if (conflict.shared.status === 'dropped') rememberDroppedScope(workspace.droppedArchive[conflict.shared.id], workspace.sourceHash);
    }
    for (const operation of workspace.droppedOutbox) if (operation.id === conflict.yours?.id) operation.conflict = true;
    invalidateDroppedScopes(workspace);
    return workspace;
  }
  function resolveDroppedConflict(workspace, filepath, language, choice, expected) {
    const conflict = workspace.droppedConflicts?.[language]?.[filepath];
    if (!conflict || !['shared', 'local'].includes(choice) || !conflict.shared
      || (expected && (conflict.shared.id !== expected.id || Number(conflict.shared.revision) !== Number(expected.revision))))
      throw Object.assign(new Error('The dropped translation conflict changed. Review both copies again.'), { stale: true });
    maps(workspace);
    const local = conflict.yours, shared = conflict.shared;
    workspace.droppedOutbox = workspace.droppedOutbox.filter(operation => operation.id !== local?.id);
    if (choice === 'shared') {
      if (local?.id && local.id !== shared.id) workspace.droppedArchive[local.id] = { ...rememberDroppedScope(copy(local), workspace.sourceHash), status: 'replaced' };
      if (shared.status === 'dropped') (workspace.dropped[language] ||= {})[filepath] = copy(shared);
      else if (workspace.dropped[language]) delete workspace.dropped[language][filepath];
    } else {
      const kept = { ...copy(local), status: 'dropped', revision: Number(shared.revision) || 0 };
      rememberDroppedScope(kept, workspace.sourceHash);
      if (workspace.droppedAliases) delete workspace.droppedAliases[kept.id];
      (workspace.dropped[language] ||= {})[filepath] = kept; workspace.droppedArchive[kept.id] = copy(kept);
      queueDropped(workspace, kept);
      const operation = workspace.droppedOutbox.find(operation => operation.id === kept.id && operation.kind === 'put');
      operation.replace = true; operation.expectedSharedId = shared.id;
    }
    delete workspace.droppedConflicts[language][filepath];
    invalidateDroppedScopes(workspace);
    return choice === 'shared' ? shared : workspace.dropped[language][filepath];
  }
  return { descriptionStatus, setDescriptionStatus, fileStatus, setFileStatus, setFileMetadata, pruneWorkspaceStatus, scopeWorkspace,
    initializeWorkspace, workspaceFile, stageTranslation, repairLegacyPlaceholders, dropTranslation, droppedForFile, upgradeSource, discardDropped, acceptDropped,
    recordDroppedConflict, resolveDroppedConflict };
});
