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
  const statusFlags = new Set(['hasChanges', 'isMissing', 'isEdited', 'isRevised', 'isDropped', 'isMetadataCorrection', 'needsReview', 'trackedForExport']);
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
  // Missing language blocks display as empty lines for the English entries.
  // Compare that padding during inheritance without changing immutable data
  // or the meaning of an explicit save made in the selected version.
  const sameBaselineTranslation = (desc, language, translations) => {
    const count = desc.translations?.English?.length || 0;
    return equal(displayedLines(translations, count), displayedLines(desc.translations?.[language], count));
  };
  const complete = (value, count) => Array.isArray(value) && value.length === count && value.every(text => String(text).trim());
  const snapshot = (desc, language, translations) => ({ english: lines(desc?.translations?.English),
    variables: copy(desc?.variables || []), remarks: copy(desc?.remarks || []), stats: copy(desc?.stats || []),
    name: String(desc?.name || ''), translations: lines(translations ?? desc?.translations?.[language]) });
  const sameSource = (left, right) => !!left && !!right && equal(snapshot(left, 'English', []), snapshot(right, 'English', []));
  const sourceMetadata = desc => ({ variables: copy(desc?.variables || []), remarks: copy(desc?.remarks || []),
    stats: copy(desc?.stats || []), name: String(desc?.name || '') });
  function classifySourceCarry(previous, current, language, translations) {
    if (!current) return { action: 'drop', reason: 'File removed from source' };
    if (!previous || !equal(lines(previous.translations?.English), lines(current.translations?.English)))
      return { action: 'drop', reason: 'English source changed' };
    const carried = lines(translations), baseline = lines(current.translations?.[language]);
    if (carried.some(text => text.trim()) && !complete(baseline, current.translations?.English?.length || 0))
      return { action: 'drop', reason: 'Translation missing from new source' };
    const before = sourceMetadata(previous), after = sourceMetadata(current);
    if (!equal(before, after)) return { action: 'carry', reason: 'Source metadata corrected', metadataCorrection: { before, after } };
    return sameBaselineTranslation(current, language, carried) ? { action: 'baseline', reason: 'Translation included in new source' }
      : { action: 'carry', reason: 'Translation carried to new source' };
  }
  function metadataCorrectionForSource(entry, desc, sourceHash) {
    const carry = entry?.sourceCarry, correction = carry?.metadataCorrection;
    return !!(carry?.fromSourceHash && carry.fromSourceHash !== sourceHash && carry.toSourceHash === sourceHash
      && object(correction?.before) && object(correction?.after) && !equal(correction.before, correction.after)
      && equal(correction.after, sourceMetadata(desc)));
  }
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
    if ((record.branchId || 'default') !== (workspace?.branchId || 'default')) return false;
    if (record.groupId && record.groupId !== (workspace?.workspaceGroupId || workspace?.groupId || '')) return false;
    if (record.collaborationAccountId && String(record.collaborationAccountId) !== String(workspace?.collaborationAccountId || '')) return false;
    return true;
  }
  function wasDroppedInSource(workspace, filepath, language) {
    if (!object(workspace) || !workspace.sourceHash) return false;
    const context = [workspace.droppedArchive, workspace.sourceHash, workspace.game || workspace.sourceBaseline?.game,
      workspace.collaborationAccountId, workspace.branchId || 'default', workspace.workspaceGroupId || workspace.groupId || ''];
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
    return candidate && inWorkspaceScope(workspace, candidate)
      && (!workspace?.sourceHash || candidateScopes(candidate).includes(workspace.sourceHash))
      && (!candidate.status || candidate.status === 'dropped') ? candidate : null;
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
    const branchId = options.branchId || workspace.branchId || 'default';
    const originSourceHash = own(options, 'originSourceHash') ? options.originSourceHash || '' : workspace.sourceHash || '';
    const targetSourceHash = options.targetSourceHash || workspace.sourceHash || '';
    const signature = serialized([game, language, desc.filepath, originSourceHash, content, ...(branchId === 'default' ? [] : [branchId])]);
    const active = droppedForFile(workspace, desc.filepath, language);
    const sameContent = record => record && record.game === game && (record.branchId || 'default') === branchId
      && inWorkspaceScope(workspace, record)
      && record.language === language && record.filepath === desc.filepath
      && record.originSourceHash === originSourceHash && equal(record.snapshot, content);
    const recoveryId = options.recoveryId || '';
    // A deliberate recovery is a new generation. Its stable action ID makes
    // retries idempotent, including after that generation has been resolved.
    let candidate;
    if (recoveryId) {
      const alias = workspace.droppedAliases?.[options.id || recoveryId];
      const originalAlias = alias?.requiresReview && own(alias, 'originSourceHash');
      if (originalAlias && (alias.originSourceHash !== originSourceHash
        || (own(alias, 'originSourceAvailable') && alias.originSourceAvailable !== (options.originSourceAvailable !== false))))
        throw new Error('This recovery action belongs to a different translation.');
      candidate = workspace.droppedArchive[options.id || recoveryId] || workspace.droppedArchive[alias?.id]
        || Object.values(workspace.droppedArchive).find(record => record.recoveryId === recoveryId);
      if (candidate && !sameContent(candidate)) {
        // Older receipts replaced the temporary recovery archive. An origin-
        // changing alias binds that request's provenance to the same content.
        if (!originalAlias || !sameDroppedContent(candidate, { game, language, filepath: desc.filepath, snapshot: content }))
          throw new Error('This recovery action belongs to a different translation.');
      }
      const shared = workspace.droppedArchive[alias?.id];
      if (candidate && (alias?.fromRevision === Number(candidate.revision || 0) || originalAlias) && shared
        && inWorkspaceScope(workspace, shared) && sameDroppedContent(candidate, shared)) candidate = shared;
    } else candidate = sameContent(active) ? active : Object.values(workspace.droppedArchive).find(sameContent);
    if (candidate && candidate.status !== 'dropped') return candidate;
    if (candidate) {
      candidate.targetSourceHashes = candidateScopes(candidate, options);
      rememberDroppedScope(candidate, targetSourceHash);
      candidate.targetSourceHash = targetSourceHash;
    } else {
      const id = options.id || recoveryId || globalThis.crypto?.randomUUID?.() || ('local-' + Date.now() + '-' + Math.random().toString(36).slice(2));
      candidate = { id, game, language, ...(branchId === 'default' ? {} : { branchId }), filepath: desc.filepath, originSourceHash, targetSourceHash,
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
      isMetadataCorrection: !!staged && metadataCorrectionForSource(staged, desc, workspace?.sourceHash),
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
        throw Object.assign(new Error('The dropped translation changed before it could be promoted. Review its current preserved copy before saving again.'), { stale: true, code: 'DROPPED_PROMOTION_CHANGED' });
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
    if (options.sourceCarry) entry.sourceCarry = copy(options.sourceCarry);
    (workspace.staged[language] ||= {})[file.filepath] = entry;
    return entry;
  }
  function initializeWorkspace(workspace, options = {}) {
    if (!object(workspace)) return workspace;
    if (!workspace.game && options.game) workspace.game = options.game;
    if (!workspace.branchId && options.branchId) workspace.branchId = options.branchId;
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
            reason: 'Preserved legacy review translation', createdAt: carried?.savedAt || options.migrationAt,
            ...(options.migrationId ? { id: carried?.id || options.migrationId(desc.filepath, language, originSourceHash) } : {}) });
        // Legacy editors pad absent/short ZIP translations with blank entries.
        // Only infer a save when the padded text differs; an explicit
        // legacy save remains meaningful even when it is blank or unchanged.
        } else if (state.hasChanges || (original && !changedSource && !equal(
          displayedLines(desc.translations[language], original.translations?.English?.length || 0),
          displayedLines(original.translations?.[language], original.translations?.English?.length || 0)))) {
          if (!workspace.staged[language]?.[desc.filepath]) stageTranslation(workspace,
            { filepath: desc.filepath, translations: desc.translations[language] }, language,
            { source: original, sourceHash, savedAt: status.lastTranslatedAt || status.lastEditedAt || options.migrationAt,
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
          originSourceHash: '', originSourceAvailable: false, targetSourceHash: sourceHash, reason: 'Preserved local review translation',
          ...(options.migrationId ? { id: options.migrationId(desc.filepath, identity.language, 'carry'), createdAt: options.migrationAt } : {}) });
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
      const repairId = options.repairId?.(filepath, language) || globalThis.crypto?.randomUUID?.() || ('placeholder-' + Date.now() + '-' + Math.random().toString(36).slice(2));
      workspace.placeholderRepairArchive ||= {};
      workspace.placeholderRepairArchive[repairId] = { filepath, language, sourceHash: workspace.sourceHash,
        staged: copy(entry), repairedAt: options.repairAt ?? Date.now(), reason: 'Recovered migration placeholder', status: room ? 'pending' : 'local' };
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
    const previouslyStaged = new Set(Object.entries(workspace.staged || {}).flatMap(([language, entries]) =>
      Object.keys(entries).map(filepath => serialized([language, filepath]))));
    for (const [language, entries] of Object.entries(workspace.staged || {})) for (const [filepath, entry] of Object.entries(entries)) {
      const desc = old.get(filepath) || (workspace.descs || []).find(desc => desc.filepath === filepath);
      const decision = classifySourceCarry(desc, next.get(filepath), language, entry.translations);
      if (decision.action === 'carry') {
        entry.sourceCarry = { fromSourceHash: entry.sourceHash || options.previousSourceHash || workspace.sourceHash,
          toSourceHash: options.sourceHash, fromSavedAt: entry.savedAt,
          ...(decision.metadataCorrection ? { metadataCorrection: copy(decision.metadataCorrection) } : {}) };
        entry.sourceHash = options.sourceHash;
      } else {
        if (decision.action === 'drop') dropTranslation(workspace, desc || { filepath, translations: { English: [] } }, language, { game: options.game, translations: entry.translations,
          originSourceHash: entry.sourceHash || options.previousSourceHash, targetSourceHash: options.sourceHash,
          originSourceAvailable: !!desc, reason: decision.reason, provenance: { savedAt: entry.savedAt } });
        delete entries[filepath];
      }
    }
    // A translation supplied by the old ZIP can disappear in the next release
    // even though nobody edited it locally. Keep that original context too.
    for (const previous of options.previousSource || []) {
      const current = next.get(previous.filepath);
      for (const language of Object.keys(previous.translations || {}).filter(languageName)) {
        const translations = lines(previous.translations[language]);
        const preserved = workspace.dropped?.[language]?.[previous.filepath];
        if (!translations.some(text => text.trim()) || previouslyStaged.has(serialized([language, previous.filepath]))
          || workspace.staged[language]?.[previous.filepath]
          || droppedForFile(workspace, previous.filepath, language)
          || (preserved && inWorkspaceScope(workspace, preserved) && candidateScopes(preserved).includes(options.sourceHash))) continue;
        const currentCount = current?.translations?.English?.length || 0;
        if (current && complete(current.translations?.[language], currentCount)) continue;
        if (current && sameSource(previous, current) && equal(translations, lines(current.translations?.[language]))) continue;
        dropTranslation(workspace, previous, language, { game: options.game, translations,
          originSourceHash: options.previousSourceHash, targetSourceHash: options.sourceHash,
          reason: current ? 'Translation missing from new source' : 'File removed from source' });
      }
    }
    for (const candidates of Object.values(workspace.dropped || {})) for (const candidate of Object.values(candidates)) {
      if (!inWorkspaceScope(workspace, candidate) || !candidateScopes(candidate).some(hash =>
        hash === (options.previousSourceHash || workspace.sourceHash) || hash === options.sourceHash)) continue;
      rememberDroppedScope(candidate, options.sourceHash);
      candidate.targetSourceHash = options.sourceHash; workspace.droppedArchive[candidate.id] = copy(candidate);
      queueDropped(workspace, candidate);
    }
    for (const conflicts of Object.values(workspace.droppedConflicts || {})) for (const conflict of Object.values(conflicts)) {
      if (!inWorkspaceScope(workspace, conflict) || (conflict.targetSourceHash
        && conflict.targetSourceHash !== (options.previousSourceHash || workspace.sourceHash))) continue;
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
  function repairRedundantCarriedStages(workspace, options = {}) {
    const removed = [], corrected = [];
    if (!object(workspace) || !workspace.sourceHash || !Array.isArray(options.source)) return { changed: false, removed, corrected };
    const current = new Map(options.source.map(desc => [desc.filepath, desc]));
    const previous = new Map((options.previousSource || []).map(desc => [desc.filepath, desc]));
    const predecessor = options.previousWorkspace;
    const previousHash = options.previousSourceHash || predecessor?.sourceHash || '';
    const authoredHere = new Set((options.history || []).filter(record => record.sourceHash === workspace.sourceHash)
      .map(record => serialized([record.lang || record.language, record.filepath, lines(record.translations)])));
    const sameScope = predecessor && predecessor.sourceHash === previousHash && previousHash !== workspace.sourceHash
      && (!predecessor.game || !workspace.game || predecessor.game === workspace.game)
      && (predecessor.branchId || 'default') === (workspace.branchId || 'default')
      && (predecessor.workspaceGroupId || predecessor.groupId || '') === (workspace.workspaceGroupId || workspace.groupId || '')
      && (predecessor.workspaceVersionId || predecessor.versionId || '') === (workspace.workspaceVersionId || workspace.versionId || '')
      && String(predecessor.accountId || predecessor.collaborationAccountId || 'guest')
        === String(workspace.accountId || workspace.collaborationAccountId || 'guest');
    for (const [language, entries] of Object.entries(workspace.staged || {})) for (const [filepath, entry] of Object.entries(entries)) {
      const desc = current.get(filepath), carry = entry.sourceCarry;
      if (!desc || entry.sourceHash !== workspace.sourceHash
        || metadataCorrectionForSource(entry, desc, workspace.sourceHash) || carry?.metadataCorrection
        || droppedForFile(workspace, filepath, language) || wasDroppedInSource(workspace, filepath, language)) continue;
      // An explicit save in this version remains meaningful even when it is
      // unchanged. Only evidence of a predecessor copy permits cleanup.
      if (authoredHere.has(serialized([language, filepath, lines(entry.translations)]))) continue;
      let fromSourceHash = carry?.fromSourceHash && carry.fromSourceHash !== workspace.sourceHash
        && carry.toSourceHash === workspace.sourceHash ? carry.fromSourceHash : '';
      if (!fromSourceHash && sameScope) {
        const prior = predecessor.staged?.[language]?.[filepath];
        if (prior && prior.sourceHash === previousHash && timestamp(prior.savedAt) && timestamp(prior.savedAt) === timestamp(entry.savedAt)
          && equal(lines(prior.translations), lines(entry.translations)) && equal(lines(prior.before), lines(entry.before))) {
          const decision = classifySourceCarry(previous.get(filepath), desc, language, prior.translations);
          if (decision.metadataCorrection) {
            entry.sourceCarry = { fromSourceHash: previousHash, toSourceHash: workspace.sourceHash,
              fromSavedAt: prior.savedAt, metadataCorrection: copy(decision.metadataCorrection) };
            corrected.push({ language, filepath, fromSourceHash: previousHash });
            continue;
          }
          if (decision.action === 'baseline') fromSourceHash = previousHash;
        }
      }
      if (!fromSourceHash || !sameBaselineTranslation(desc, language, entry.translations)) continue;
      delete entries[filepath];
      removed.push({ language, filepath, fromSourceHash });
    }
    return { changed: removed.length > 0 || corrected.length > 0, removed, corrected };
  }
  function mergeSourceImportWorkspace(existing, incoming, options = {}) {
    if (!existing) return copy(incoming);
    if (!object(incoming) || existing.sourceHash !== incoming.sourceHash)
      throw new Error('Source imports can merge only the same destination workspace.');
    if ((existing.branchId || 'default') !== (incoming.branchId || 'default')
      || (existing.game && incoming.game && existing.game !== incoming.game)
      || String(existing.accountId || existing.collaborationAccountId || 'guest')
        !== String(incoming.accountId || incoming.collaborationAccountId || 'guest')
      || (existing.workspaceGroupId || existing.groupId || '') !== (incoming.workspaceGroupId || incoming.groupId || '')
      || (existing.workspaceVersionId || existing.versionId || '') !== (incoming.workspaceVersionId || incoming.versionId || ''))
      throw new Error('The destination workspace belongs to a different scope.');
    const merged = { ...copy(incoming), ...copy(existing) };
    maps(merged);
    const descriptions = new Map((incoming.descs || []).map(desc => [desc.filepath, copy(desc)]));
    for (const desc of existing.descs || []) descriptions.set(desc.filepath, copy(desc));
    merged.descs = [...descriptions.values()];
    merged.status = { ...copy(incoming.status || {}), ...copy(existing.status || {}) };
    for (const field of ['staged', 'dropped', 'droppedConflicts']) {
      merged[field] = {};
      for (const language of new Set([...Object.keys(incoming[field] || {}), ...Object.keys(existing[field] || {})]))
        merged[field][language] = { ...copy(incoming[field]?.[language] || {}), ...copy(existing[field]?.[language] || {}) };
    }
    for (const field of ['droppedArchive', 'droppedAliases', 'sourceCarryRepairArchive'])
      if (existing[field] || incoming[field]) merged[field] = { ...copy(incoming[field] || {}), ...copy(existing[field] || {}) };
    const resolvedImports = new Set();
    for (const [language, candidates] of Object.entries(incoming.dropped || {})) for (const [filepath, candidate] of Object.entries(candidates)) {
      const alias = existing.droppedAliases?.[candidate.id];
      const resolved = existing.droppedArchive?.[alias?.id] || existing.droppedArchive?.[candidate.id];
      if (!resolved || !['promoted', 'discarded'].includes(resolved.status) || !inWorkspaceScope(existing, resolved)
        || resolved.language !== language || resolved.filepath !== filepath
        || (resolved.snapshot && !sameDroppedContent(candidate, resolved))) continue;
      if (merged.dropped[language]?.[filepath]?.id === candidate.id) delete merged.dropped[language][filepath];
      merged.droppedArchive[resolved.id] = { ...copy(resolved), targetSourceHashes: candidateScopes(resolved, candidate) };
      if (candidate.id !== resolved.id && !existing.droppedArchive?.[candidate.id])
        merged.droppedArchive[candidate.id] = { ...copy(candidate), status: 'replaced' };
      resolvedImports.add(candidate.id); resolvedImports.add(resolved.id);
    }
    for (const [language, conflicts] of Object.entries(incoming.droppedConflicts || {})) for (const [filepath, conflict] of Object.entries(conflicts)) {
      if (!existing.droppedConflicts?.[language]?.[filepath] && resolvedImports.has(conflict.yours?.id)
        && (!conflict.shared?.id || resolvedImports.has(conflict.shared.id))) delete merged.droppedConflicts[language][filepath];
    }
    // A destination resolution is authoritative for this recovery generation,
    // including retries still using the local ID acknowledged by its alias.
    const operations = new Map((incoming.droppedOutbox || []).filter(operation => operation.kind !== 'put' || !resolvedImports.has(operation.id))
      .map(operation => [serialized([operation.id, operation.kind]), copy(operation)]));
    for (const operation of existing.droppedOutbox || []) operations.set(serialized([operation.id, operation.kind]), copy(operation));
    merged.droppedOutbox = [...operations.values()];
    const sources = new Map((options.source || []).map(desc => [desc.filepath, desc]));
    for (const [language, entries] of Object.entries(incoming.staged || {})) for (const [filepath, entry] of Object.entries(entries)) {
      const retained = existing.staged?.[language]?.[filepath];
      if (!retained || equal(lines(retained.translations), lines(entry.translations))) continue;
      const source = sources.get(filepath);
      if (!source) throw new Error('The original source is unavailable for conflicting imported work: ' + filepath);
      const retainedCandidate = droppedForFile(merged, filepath, language);
      const originMetadata = entry.sourceCarry?.metadataCorrection?.before || sourceMetadata(source);
      const candidate = dropTranslation(merged, source, language, { game: options.game || merged.game,
        originSourceHash: entry.sourceCarry?.fromSourceHash || entry.sourceHash,
        targetSourceHash: merged.sourceHash,
        snapshot: { english: lines(source.translations?.English), ...copy(originMetadata), translations: lines(entry.translations) },
        reason: 'Imported translation differs from saved destination work', provenance: { savedAt: entry.savedAt } });
      if (retainedCandidate && candidate?.status === 'dropped' && retainedCandidate.id !== candidate.id) {
        merged.dropped[language][filepath] = copy(retainedCandidate);
        if (!merged.droppedConflicts[language]?.[filepath]) recordDroppedConflict(merged, {
          kind: 'upload', game: merged.game, language, filepath, targetSourceHash: merged.sourceHash,
          yours: candidate, shared: retainedCandidate,
        });
        else for (const operation of merged.droppedOutbox) if (operation.id === candidate.id) operation.conflict = true;
      }
    }
    // Keep all historical recovery groups. Existing destination entries retain
    // their positions, which stored per-group recovery records refer to.
    if (Array.isArray(incoming.importRecovery) || Array.isArray(existing.importRecovery)) {
      merged.importRecovery = copy(existing.importRecovery || []);
      for (const recovery of incoming.importRecovery || []) if (!merged.importRecovery.some(retained => equal(retained, recovery)))
        merged.importRecovery.push(copy(recovery));
    }
    invalidateDroppedScopes(merged);
    return merged;
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
      const record = { ...copy(options.preserveOriginal ? {} : local || {}), ...copy(remote),
        targetSourceHash: remote.targetSourceHash || local?.targetSourceHash || '',
        targetSourceHashes: candidateScopes(local, remote),
        ...(remote.snapshot == null && local?.snapshot ? { snapshot: copy(local.snapshot) } : {}),
        ...(locallyResolved && remote.status === 'dropped' ? { status: local.status } : {}) };
      // A read/join only projects assignments established by an import/review.
      // Browsing another named version must not create new Dropped workload.
      workspace.droppedArchive[remote.id] = record;
      if (byFingerprint && record.snapshot != null) byFingerprint.set(fingerprint(record), record);
      if (local?.id && local.id !== remote.id) {
        if (options.preserveOriginal || (local.recoveryId && local.id === local.recoveryId)) {
          workspace.droppedArchive[local.id] = { ...copy(local), status: 'replaced' };
          if (options.preserveOriginal) Object.assign(workspace.droppedAliases[local.id], { requiresReview: true,
            originSourceHash: local.originSourceHash, originSourceAvailable: local.originSourceAvailable !== false });
        } else delete workspace.droppedArchive[local.id];
      }
      if (options.acknowledge && local) workspace.droppedOutbox = workspace.droppedOutbox.filter(operation => operation.id !== (options.acknowledgeId || local.id)
        || operation.kind !== (options.acknowledgeKind || 'put'));
      if (record.status === 'dropped' && (!workspace.sourceHash || candidateScopes(record).includes(workspace.sourceHash))) {
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
    if (conflict.shared?.id && conflict.shared.id !== conflict.yours?.id) {
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
  function sameDroppedContent(left, right) {
    if (!object(left?.snapshot) || !object(right?.snapshot)) return false;
    const fields = ['english', 'variables', 'remarks', 'stats', 'translations'];
    if (!fields.every(field => Array.isArray(left.snapshot[field]) && Array.isArray(right.snapshot[field]))
      || typeof left.snapshot.name !== 'string' || typeof right.snapshot.name !== 'string') return false;
    return (left.branchId || 'default') === (right.branchId || 'default')
      && ['game', 'language', 'filepath'].every(field => left[field] === right[field]) && equal(left.snapshot, right.snapshot);
  }
  function sameDroppedCopy(left, right) {
    return sameDroppedContent(left, right) && left.originSourceHash === right.originSourceHash
      && (left.originSourceAvailable !== false) === (right.originSourceAvailable !== false);
  }
  function coalesceDroppedConflict(workspace, filepath, language, shared) {
    const conflict = workspace?.droppedConflicts?.[language]?.[filepath];
    if (!conflict || !['upload', 'promotion'].includes(conflict.kind) || conflict.targetSourceHash !== workspace.sourceHash
      || shared?.status !== 'dropped' || !shared.id || !sameDroppedContent(conflict.yours, shared)
      || !inWorkspaceScope(workspace, conflict.yours) || !inWorkspaceScope(workspace, shared)) return null;
    const differentOrigin = !sameDroppedCopy(conflict.yours, shared);
    if (differentOrigin && (conflict.kind !== 'upload' || conflict.yours.id === shared.id)) return null;
    const active = droppedForFile(workspace, filepath, language);
    let local = workspace.droppedArchive?.[conflict.yours.id];
    // Older clients stored a same-ID shared revision over the local archive.
    // The still-active, unchanged local copy can establish the captured version.
    if (conflict.kind === 'upload' && local?.id === shared.id && active?.id === local.id
      && Number(active.revision || 0) === Number(conflict.yours.revision || 0) && sameDroppedCopy(active, conflict.yours)
      && Number(local.revision || 0) === Number(conflict.shared?.revision || 0) && sameDroppedCopy(local, conflict.shared)) local = active;
    if (!local || !sameDroppedCopy(local, conflict.yours) || !['dropped', 'promoted'].includes(local.status)
      || (differentOrigin && local.status !== 'dropped')
      || Number(local.revision || 0) !== Number(conflict.yours.revision || 0)
      || Number(shared.revision) < Number(local.revision || 0)
      || Number(shared.revision) < Number(conflict.shared?.revision || 0)) return null;
    if (active && active.id !== local.id && !sameDroppedCopy(active, local)) return null;
    maps(workspace);
    // Adopt the receipt for the same preserved content. This does not review or
    // stage it, and acceptDropped retains an already reviewed local promotion.
    local.targetSourceHashes = candidateScopes(local, conflict.yours, conflict.shared);
    workspace.droppedArchive[local.id] = copy(local);
    const aliases = Object.entries(workspace.droppedAliases || {}).filter(([, alias]) => alias.id === local.id
      && Number(alias.revision || 0) === Number(local.revision || 0));
    delete workspace.droppedConflicts[language][filepath];
    acceptDropped(workspace, [shared], { game: shared.game, language, acknowledge: true, acknowledgeId: local.id,
      preserveOriginal: differentOrigin });
    // Recovery retries and already captured saves may still name an earlier
    // temporary ID. Keep every proven alias directly bound to the new receipt.
    for (const [id, alias] of aliases) {
      const original = workspace.droppedArchive[id];
      workspace.droppedAliases[id] = { ...alias, id: shared.id,
        revision: Number(shared.revision) || 0, targetSourceHash: shared.targetSourceHash,
        ...(differentOrigin ? { requiresReview: true,
          originSourceHash: own(alias, 'originSourceHash') ? alias.originSourceHash : original?.originSourceHash ?? local.originSourceHash,
          ...(own(alias, 'originSourceAvailable') ? { originSourceAvailable: alias.originSourceAvailable }
            : original ? { originSourceAvailable: original.originSourceAvailable !== false } : {}) } : {}) };
    }
    return workspace.droppedArchive[shared.id];
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
      const existing = workspace.droppedArchive[shared.id];
      const selected = { ...copy(shared.snapshot == null || sameDroppedCopy(existing, shared) ? existing || {} : {}), ...copy(shared),
        targetSourceHashes: candidateScopes(existing, local, shared),
        ...(shared.snapshot == null && existing?.snapshot ? { snapshot: copy(existing.snapshot) } : {}) };
      rememberDroppedScope(selected, workspace.sourceHash);
      workspace.droppedArchive[shared.id] = selected;
      if (shared.status === 'dropped') (workspace.dropped[language] ||= {})[filepath] = copy(selected);
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
    initializeWorkspace, workspaceFile, stageTranslation, repairLegacyPlaceholders, classifySourceCarry, repairRedundantCarriedStages,
    sourceMetadata, metadataCorrectionForSource, mergeSourceImportWorkspace,
    dropTranslation, droppedForFile, upgradeSource, discardDropped, acceptDropped,
    recordDroppedConflict, resolveDroppedConflict, sameDroppedContent, sameDroppedCopy, coalesceDroppedConflict };
});
