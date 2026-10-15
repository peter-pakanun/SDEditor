/* Local workspace metadata belongs to the language whose translations it describes. */
(function (root, factory) {
  const api = factory(() => typeof module === 'object' && module.exports ? require('./statDescCodec.js') : root.StatDescCodec);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WorkspaceState = api;
})(typeof window === 'object' ? window : typeof self === 'object' ? self : this, function (codec) {
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
  const statusFlags = new Set(['hasChanges', 'isMissing', 'isEdited', 'isRevised', 'isDropped', 'hasLocalRecovery', 'hasSharedRecovery', 'isMetadataCorrection', 'isInvalidTranslation', 'languageBlockPresent', 'translationIssues', 'needsReview', 'trackedForExport']);
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
  const translationIssues = (value, count) => codec().translationIssues(value, count);
  const assertCompleteTranslation = (value, count, filepath) => codec().assertCompleteTranslation(value, count, filepath);
  const complete = (value, count) => translationIssues(value, count).valid;
  const statDescription = workspace => !String(workspace?.contentMode || workspace?.mode || '').toLowerCase().startsWith('clienttext');
  function invalidArchiveId(value) {
    const text = serialized(value), hashes = [2166136261, 2246822519, 3266489917, 668265263];
    for (let i = 0; i < text.length; i++) for (let j = 0; j < hashes.length; j++) hashes[j] = Math.imul(hashes[j] ^ (text.charCodeAt(i) + j), 16777619);
    return 'invalid-v1-' + hashes.map(value => (value >>> 0).toString(16).padStart(8, '0')).join('');
  }
  function archiveInvalidTranslation(workspace, stage, language, options = {}) {
    if (!object(workspace) || !statDescription(workspace) || !stage) return null;
    const filepath = options.filepath || stage.filepath, source = options.source;
    if (!filepath || !languageName(language)) throw new Error('Invalid translation recovery scope.');
    const count = source?.translations?.English?.length ?? options.expectedCount ?? stage.translations?.length ?? 0;
    const issues = translationIssues(stage.translations, count);
    if (options.sourceUnavailable) { issues.valid = false; issues.sourceUnavailable = true; }
    if (issues.valid) return null;
    const scope = { filepath, language, sourceHash: stage.sourceHash || options.sourceHash || workspace.sourceHash || '',
      game: workspace.game || options.game, branchId: workspace.branchId || options.branchId || 'default',
      accountId: String(workspace.accountId || workspace.collaborationAccountId || options.accountId || 'guest'),
      ...((workspace.groupId || workspace.workspaceGroupId || options.groupId) ? { versionId: String(workspace.versionId || workspace.workspaceVersionId || options.versionId || ''),
        groupId: String(workspace.groupId || workspace.workspaceGroupId || options.groupId) } : {}) };
    const retainedSource = source && { ...sourceMetadata(source), english: lines(source.translations?.English) };
    const id = invalidArchiveId(options.operationId ? [scope, 'operation', options.operationId, stage, retainedSource]
      : options.recoveryId ? [scope, 'server', options.recoveryId] : [scope, stage, retainedSource]);
    const previous = workspace.invalidTranslationArchive?.[id];
    if (previous && (!equal(previous.stage, stage) || !equal(previous.source, retainedSource))) throw new Error('Translation recovery identifier collision.');
    workspace.invalidTranslationArchive ||= {};
    return workspace.invalidTranslationArchive[id] ||= { id, schemaVersion: 1, ...scope, reason: 'Incomplete StatDescription translation',
      ...(options.recoveryId ? { serverRecoveryId: options.recoveryId } : {}),
      ...(options.operationId ? { operationId: options.operationId } : {}),
      issues, stage: copy(stage), ...(retainedSource ? { source: retainedSource } : {}), archivedAt: options.archivedAt || Date.now() };
  }
  function quarantineInvalidTranslations(workspace, options = {}) {
    const removed = [];
    if (!object(workspace) || !statDescription(workspace)) return { changed: false, removed };
    const sources = new Map((options.source || workspace.descs || []).map(desc => [desc.filepath, desc]));
    for (const [language, entries] of Object.entries(workspace.staged || {})) for (const [filepath, stage] of Object.entries(entries)) {
      const matchingSource = !stage.sourceHash || !workspace.sourceHash || stage.sourceHash === workspace.sourceHash;
      const source = matchingSource ? sources.get(filepath) : undefined;
      const archived = archiveInvalidTranslation(workspace, stage, language, { ...options, source, filepath,
        sourceUnavailable: !Array.isArray(source?.translations?.English) });
      if (!archived) continue;
      delete entries[filepath]; removed.push({ language, filepath, archive: archived });
    }
    return { changed: removed.length > 0, removed };
  }
  const snapshot = (desc, language, translations) => ({ english: lines(desc?.translations?.English),
    variables: copy(desc?.variables || []), remarks: copy(desc?.remarks || []), stats: copy(desc?.stats || []),
    name: String(desc?.name || ''), translations: lines(translations ?? desc?.translations?.[language]) });
  const sameSource = (left, right) => !!left && !!right && equal(snapshot(left, 'English', []), snapshot(right, 'English', []));
  const sourceMetadata = desc => ({ variables: copy(desc?.variables || []), remarks: copy(desc?.remarks || []),
    stats: copy(desc?.stats || []), name: String(desc?.name || '') });
  function classifySourceCarry(previous, current, language, translations) {
    if (!current) return { action: 'remove', reason: 'File removed from source' };
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
    if (!carry?.fromSourceHash || carry.fromSourceHash === sourceHash || carry.toSourceHash !== sourceHash) return false;
    if (object(correction?.before) && object(correction?.after)) return !equal(correction.before, correction.after)
      && equal(correction.after, sourceMetadata(desc));
    const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
    const acceptedHash = desc?.sourceFacts?.metadataHash || desc?.baselineFacts?.metadataHash;
    return validHash(correction?.beforeHash) && validHash(correction?.afterHash) && correction.beforeHash !== correction.afterHash
      && (!validHash(acceptedHash) || acceptedHash === correction.afterHash);
  }
  const droppedScopeCache = new WeakMap(), droppedCandidateCache = new WeakMap();
  function invalidateDroppedScopes(workspace) { droppedScopeCache.delete(workspace); droppedCandidateCache.delete(workspace); }
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
    if (record.localRecoveryScope && (String(record.localRecoveryScope.accountId) !== String(workspace?.accountId || workspace?.collaborationAccountId || 'guest')
      || record.localRecoveryScope.game !== game || (record.localRecoveryScope.branchId || 'default') !== (workspace?.branchId || 'default'))) return false;
    return true;
  }
  function droppedOwnership(record) {
    if (record?.ownership === 'local' || record?.ownership === 'online') return record.ownership;
    // Existing server generations retain their identity. Unacknowledged local
    // snapshots remain local; a ZIP hash or catalog association proves no ancestry.
    return record?.groupId || /^dropped_/.test(record?.id || '') ? 'online' : 'local';
  }
  function workspaceDroppedOwnership(workspace) {
    return workspace?.workspaceOrigin === 'online' || workspace?.workspaceGroupId || workspace?.groupId ? 'online' : 'local';
  }
  function droppedCandidatesForFile(workspace, filepath, language) {
    if (!object(workspace)) return [];
    const context = [workspace.droppedArchive, workspace.dropped, workspace.sourceHash, workspace.workspaceOrigin,
      workspace.workspaceGroupId || workspace.groupId, workspace.game, workspace.branchId, workspace.collaborationAccountId];
    let cached = droppedCandidateCache.get(workspace);
    if (!cached || context.some((value, index) => value !== cached.context[index])) {
      const records = Object.values(workspace.droppedArchive || {});
      const paths = new Map();
      for (const record of records) {
        if (!record?.id || !inWorkspaceScope(workspace, record)
          || workspace.sourceHash && !candidateScopes(record).includes(workspace.sourceHash)) continue;
        const key = serialized([record.language, record.filepath]);
        if (!paths.has(key)) paths.set(key, []);
        paths.get(key).push(record);
      }
      cached = { context, paths }; droppedCandidateCache.set(workspace, cached);
    }
    const preferred = workspaceDroppedOwnership(workspace);
    const selected = new Map(), active = workspace.dropped?.[language]?.[filepath];
    for (const record of [...(cached.paths.get(serialized([language, filepath])) || []), active]) {
      if (!record?.id || !inWorkspaceScope(workspace, record)
        || workspace.sourceHash && !candidateScopes(record).includes(workspace.sourceHash)) continue;
      record.ownership = droppedOwnership(record);
      const key = record.ownership + ':' + record.id, previous = selected.get(key);
      if (!previous || Number(record.revision || 0) > Number(previous.revision || 0)
        || Number(record.revision || 0) === Number(previous.revision || 0) && (!previous.status || previous.status === 'dropped')) selected.set(key, record);
    }
    const activeOnline = active && droppedOwnership(active) === 'online' && (!active.status || active.status === 'dropped') ? active.id : null;
    return [...selected.values()].filter(record => (!record.status || record.status === 'dropped')
      && (record.ownership !== 'online' || !activeOnline || record.id === activeOnline)).sort((a, b) => Number(b.ownership === preferred) - Number(a.ownership === preferred)
      || Number(b === active) - Number(a === active)
      || timestamp(b.createdAt) - timestamp(a.createdAt));
  }
  function retainDropped(workspace, record) {
    const ownership = droppedOwnership(record), current = workspace.droppedArchive[record.id];
    if (current && droppedOwnership(current) !== ownership) workspace.droppedArchive[droppedOwnership(current) + ':' + current.id] = copy(current);
    const key = current && droppedOwnership(current) !== ownership && ownership === 'local' ? 'local:' + record.id : record.id;
    workspace.droppedArchive[key] = copy({ ...record, ownership });
    return record;
  }
  function attachLocalDroppedCandidates(workspace, records) {
    maps(workspace);
    for (const incoming of records || []) {
      if (!incoming?.id || !inWorkspaceScope(workspace, incoming) || !candidateScopes(incoming).includes(workspace.sourceHash)) continue;
      const retained = Object.values(workspace.droppedArchive).find(record => record.id === incoming.id && droppedOwnership(record) === 'local');
      if (retained) {
        // A disposition in either view wins over a stale unresolved attachment.
        if ((!retained.status || retained.status === 'dropped') && ['promoted', 'discarded'].includes(incoming.status)
          && Number(incoming.revision || 0) >= Number(retained.revision || 0) && equal(incoming.snapshot, retained.snapshot)) {
          retainDropped(workspace, { ...retained, status: incoming.status, resolvedAt: incoming.resolvedAt });
          if (workspace.dropped[retained.language]?.[retained.filepath]?.id === retained.id
            && droppedOwnership(workspace.dropped[retained.language][retained.filepath]) === 'local') delete workspace.dropped[retained.language][retained.filepath];
        }
        continue;
      }
      retainDropped(workspace, { ...copy(incoming), ownership: 'local' });
    }
    invalidateDroppedScopes(workspace);
    return workspace;
  }
  function separateDroppedCopies(workspace) {
    if (!object(workspace)) return workspace;
    maps(workspace);
    for (const [language, conflicts] of Object.entries(workspace.droppedConflicts)) for (const [filepath, conflict] of Object.entries(conflicts)) {
      if (!conflict.yours || droppedOwnership(conflict.yours) !== 'local' || !conflict.shared) continue;
      // Keep the full old decision evidence, but two independent owners are no
      // longer competing for a shared slot and must not block an ordinary save.
      (workspace.droppedConflictArchive ||= {})[serialized([language, filepath, conflict.yours.id, conflict.shared.id])] = copy(conflict);
      retainDropped(workspace, { ...conflict.yours, ownership: 'local' });
      retainDropped(workspace, { ...conflict.shared, ownership: 'online' });
      delete conflicts[filepath];
    }
    workspace.droppedOwnershipVersion = 1;
    invalidateDroppedScopes(workspace);
    return workspace;
  }
  function wasDroppedInSource(workspace, filepath, language) {
    if (!object(workspace) || !workspace.sourceHash) return false;
    const context = [workspace.droppedArchive, workspace.sourceHash, workspace.game || workspace.sourceBaseline?.game,
      workspace.collaborationAccountId, workspace.branchId || 'default', workspace.workspaceGroupId || workspace.groupId || '', workspace.workspaceOrigin, workspace.accountId];
    let cached = droppedScopeCache.get(workspace);
    if (!cached || context.some((value, index) => value !== cached.context[index])) {
      const byLanguage = new Map();
      for (const record of Object.values(workspace.droppedArchive || {})) {
        if (!inWorkspaceScope(workspace, record) || droppedOwnership(record) !== workspaceDroppedOwnership(workspace) || !candidateScopes(record).includes(workspace.sourceHash)
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
  function droppedRecoveryPaths(workspace) {
    const paths = new Set();
    const add = (record, fallback) => {
      const filepath = record?.filepath || record?.candidate?.filepath || record?.yours?.filepath || record?.shared?.filepath || fallback;
      if (filepath) paths.add(filepath);
    };
    for (const field of ['dropped', 'droppedConflicts', 'droppedAssignments'])
      for (const entries of Object.values(workspace?.[field] || {})) for (const [filepath, value] of Object.entries(entries || {})) add(value, filepath);
    for (const field of ['droppedArchive', 'droppedConflictArchive', 'droppedOutbox']) for (const value of Object.values(workspace?.[field] || {})) add(value);
    return [...paths];
  }
  function removeDeletedRecoveryCopies(workspace, filepaths) {
    if (!object(workspace)) return false;
    const removed = new Set(filepaths), ids = new Set();
    let changed = false;
    const deleted = (record, fallback) => removed.has(record?.filepath || record?.candidate?.filepath
      || record?.yours?.filepath || record?.shared?.filepath || fallback);
    const remember = record => {
      for (const value of [record, record?.candidate, record?.yours, record?.shared]) if (value?.id) ids.add(value.id);
      changed = true;
    };
    for (const field of ['dropped', 'droppedConflicts', 'droppedAssignments'])
      for (const entries of Object.values(workspace[field] || {})) for (const [filepath, value] of Object.entries(entries || {}))
        if (deleted(value, filepath)) { remember(value); delete entries[filepath]; }
    for (const field of ['droppedArchive', 'droppedConflictArchive']) for (const [id, value] of Object.entries(workspace[field] || {}))
      if (deleted(value)) { remember(value); ids.add(id); delete workspace[field][id]; }
    if (workspace.droppedOutbox) workspace.droppedOutbox = workspace.droppedOutbox.filter(value => {
      if (!deleted(value)) return true;
      remember(value); return false;
    });
    let aliasesChanged;
    do {
      aliasesChanged = false;
      for (const [id, target] of Object.entries(workspace.droppedAliases || {})) if (ids.has(id) || ids.has(target)) {
        ids.add(id); delete workspace.droppedAliases[id]; aliasesChanged = changed = true;
      }
    } while (aliasesChanged);
    if (changed) invalidateDroppedScopes(workspace);
    return changed;
  }
  function droppedForFile(workspace, filepath, language, expected) {
    return droppedCandidatesForFile(workspace, filepath, language).find(candidate => !expected
      || (typeof expected === 'string' ? candidate.ownership === expected
        : (!expected.id || candidate.id === expected.id) && (!expected.ownership || candidate.ownership === expected.ownership))) || null;
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
    const ownership = options.ownership || 'local';
    const active = droppedForFile(workspace, desc.filepath, language, ownership);
    const sameContent = record => record && record.game === game && (record.branchId || 'default') === branchId
      && inWorkspaceScope(workspace, record)
      && record.language === language && record.filepath === desc.filepath
      && droppedOwnership(record) === ownership && record.originSourceHash === originSourceHash && equal(record.snapshot, content);
    const recoveryId = options.recoveryId || '';
    // A deliberate recovery is a new generation. Its stable action ID makes
    // retries idempotent, including after that generation has been resolved.
    let candidate;
    if (recoveryId) {
      const alias = workspace.droppedAliases?.[options.id || recoveryId];
      const originalAlias = own(alias, 'originSourceHash');
      if (originalAlias && (alias.originSourceHash !== originSourceHash
        || (own(alias, 'originSourceAvailable') && alias.originSourceAvailable !== (options.originSourceAvailable !== false))))
        throw new Error('This recovery action belongs to a different translation.');
      candidate = workspace.droppedArchive[options.id || recoveryId] || workspace.droppedArchive[alias?.id]
        || Object.values(workspace.droppedArchive).find(record => record.recoveryId === recoveryId);
      if (candidate && !sameContent(candidate)) {
        // Older receipts replaced the temporary recovery archive. An origin-
        // changing alias binds that request's provenance to the same content.
        // A stable recovery action still binds its exact original request.
        // Text-only equivalence is for adopting canonical receipts, not for
        // changing the historical snapshot under an already used action ID.
        if (!originalAlias || !equal(candidate.snapshot, content)
          || !sameDroppedContent(candidate, { game, branchId, language, filepath: desc.filepath, snapshot: content }))
          throw new Error('This recovery action belongs to a different translation.');
      }
      const shared = workspace.droppedArchive[alias?.id];
      if (candidate && (alias?.fromRevision === Number(candidate.revision || 0) || originalAlias) && shared
        && inWorkspaceScope(workspace, shared) && sameDroppedContent(candidate, shared)) candidate = shared;
    } else candidate = sameContent(active) ? active : Object.values(workspace.droppedArchive).find(sameContent);
    if (candidate && (candidate.status !== 'dropped' || recoveryId && candidate.id !== recoveryId
      && workspace.droppedAliases?.[options.id || recoveryId]?.id === candidate.id)) return candidate;
    if (candidate) {
      candidate.targetSourceHashes = candidateScopes(candidate, options);
      rememberDroppedScope(candidate, targetSourceHash);
      candidate.targetSourceHash = targetSourceHash;
    } else {
      const id = options.id || recoveryId || globalThis.crypto?.randomUUID?.() || ('local-' + Date.now() + '-' + Math.random().toString(36).slice(2));
      candidate = { id, ownership, game, language, ...(branchId === 'default' ? {} : { branchId }), filepath: desc.filepath, originSourceHash, targetSourceHash,
        targetSourceHashes: candidateScopes(options),
        snapshot: copy(content), reason: options.reason || 'Source changed', signature, status: 'dropped',
        ...(recoveryId ? { recoveryId } : {}),
        originSourceAvailable: options.originSourceAvailable !== false,
        ...(options.sourceRef ? { sourceRef: copy(options.sourceRef) } : {}),
        revision: Number(options.revision) || 0, createdAt: options.createdAt || Date.now(),
        ...(options.provenance ? { provenance: copy(options.provenance) } : {}),
        ...(options.baseline ? { baseline: copy(options.baseline), originArchive: copy(options.originArchive) } : {}) };
      rememberDroppedScope(candidate, targetSourceHash);
    }
    if (active && active.id !== candidate.id) workspace.droppedArchive[active.id] = copy(rememberDroppedScope(active, workspace.sourceHash));
    (workspace.dropped[language] ||= {})[desc.filepath] = candidate;
    workspace.droppedArchive[candidate.id] = copy(candidate);
    invalidateDroppedScopes(workspace);
    if (ownership === 'online') queueDropped(workspace, candidate);
    return candidate;
  }
  function workspaceFile(workspace, desc, language) {
    const entry = workspace?.staged?.[language]?.[desc?.filepath];
    const count = desc?.translations?.English?.length || 0;
    const staged = entry && (!entry.sourceHash || entry.sourceHash === workspace?.sourceHash)
      && (!statDescription(workspace) || complete(entry.translations, count)) ? entry : null;
    const committed = staged ? lines(staged.translations) : lines(desc?.translations?.[language]);
    const issues = staged ? { ...translationIssues(committed, count), languageBlockPresent: true }
      : codec().baselineTranslationIssues(desc, language);
    const translations = staged ? lines(staged.translations) : lines(desc?.translations?.[language]);
    while (translations.length < count) translations.push('');
    const candidate = droppedForFile(workspace, desc?.filepath, language, workspaceDroppedOwnership(workspace));
    const baseline = desc?.translations?.[language];
    return { translations, hasChanges: !!staged, isRevised: !!staged && complete(baseline, count)
      && !equal(lines(baseline), translations) && !candidate && !wasDroppedInSource(workspace, desc?.filepath, language),
      isMetadataCorrection: !!staged && metadataCorrectionForSource(staged, desc, workspace?.sourceHash),
      isMissing: !issues.valid, isInvalidTranslation: statDescription(workspace) && issues.languageBlockPresent && !issues.valid,
      languageBlockPresent: issues.languageBlockPresent, translationIssues: issues, isDropped: !!candidate,
      hasLocalRecovery: workspaceDroppedOwnership(workspace) === 'online' && !!droppedForFile(workspace, desc?.filepath, language, 'local'),
      hasSharedRecovery: workspaceDroppedOwnership(workspace) === 'local' && !!droppedForFile(workspace, desc?.filepath, language, 'online'),
      needsReview: !!candidate && !staged && !complete(translations, count), candidate, staged };
  }
  function translationBaseMatches(workspace, original, language, captured, current) {
    const state = workspaceFile(workspace, original, language);
    current ||= { translations: state.translations, trackedForExport: state.hasChanges, needsReview: false, revision: 0 };
    if (!Array.isArray(captured?.translations) || !Array.isArray(current?.translations)) return false;
    if (equal(captured.translations, current.translations)) return true;
    // Callers supply the verified immutable source. An overflowing original SD
    // block has two existing views: the complete local text and the source-count
    // collaboration baseline. Only those exact unsaved revision-zero views are
    // equivalent; authored saves and their durable retry bodies stay untouched.
    const count = original?.translations?.English?.length, originals = original?.translations?.[language];
    if (!object(workspace) || !statDescription(workspace) || state.staged || !Number.isSafeInteger(count) || count < 1
      || !Array.isArray(originals) || originals.length <= count || originals.some(text => typeof text !== 'string')) return false;
    const baselineView = value => !value.trackedForExport && !value.needsReview && Number(value.revision || 0) === 0
      && (!value.filepath || value.filepath === original.filepath)
      && (equal(value.translations, originals) || equal(value.translations, originals.slice(0, count)));
    return baselineView(captured) && baselineView(current);
  }
  function resolveDroppedPromotion(workspace, filepath, language, promotion, options = {}) {
    if (!object(workspace) || !languageName(language) || !filepath || !promotion) throw new Error('Invalid dropped promotion.');
    maps(workspace);
    const candidate = droppedForFile(workspace, filepath, language, promotion);
    if (!candidate || candidate.id !== promotion.id || Number(candidate.revision || 0) !== Number(promotion.revision || 0)
      || (promotion.targetSourceHash && promotion.targetSourceHash !== (options.sourceHash || workspace.sourceHash))) {
      throw Object.assign(new Error('The dropped translation changed before it could be promoted. Review its current preserved copy before saving again.'), { stale: true, code: 'DROPPED_PROMOTION_CHANGED' });
    }
    rememberDroppedScope(candidate, options.sourceHash || workspace.sourceHash);
    retainDropped(workspace, { ...copy(candidate), status: 'promoted', resolvedAt: options.savedAt || Date.now() });
    if (workspace.dropped[language]?.[filepath]?.id === candidate.id
      && droppedOwnership(workspace.dropped[language][filepath]) === candidate.ownership) delete workspace.dropped[language][filepath];
    invalidateDroppedScopes(workspace);
    return candidate;
  }
  function stageTranslation(workspace, file, language, options = {}) {
    if (!object(workspace) || !languageName(language) || !file?.filepath) throw new Error('Invalid staged translation.');
    const source = (Array.isArray(options.source) ? options.source.find(desc => desc.filepath === file.filepath) : options.source)
      || workspace.descs?.find(desc => desc.filepath === file.filepath);
    if (statDescription(workspace)) {
      if (!Array.isArray(source?.translations?.English) && !Number.isInteger(options.expectedCount)) throw Object.assign(
        new Error('The English source is unavailable. Reimport the source archive before saving.'), { code: 'SOURCE_UNAVAILABLE', filepath: file.filepath });
      codec().assertCompleteTranslation(file.translations, source?.translations?.English?.length ?? options.expectedCount, file.filepath);
    }
    maps(workspace);
    const current = workspace.staged[language]?.[file.filepath];
    if (options.promoteDropped) resolveDroppedPromotion(workspace, file.filepath, language, options.promoteDropped, options);
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
    if (!workspace.accountId && options.accountId) workspace.accountId = String(options.accountId);
    if (!workspace.branchId && options.branchId) workspace.branchId = options.branchId;
    separateDroppedCopies(workspace);
    if (Number(workspace.stagedVersion) >= 1) {
      if (!workspace.sourceBaseline?.sourceHash && options.sourceHash) {
        workspace.sourceHash ||= options.sourceHash;
        workspace.sourceBaseline = { sourceHash: options.sourceHash };
        for (const entries of Object.values(workspace.staged || {})) for (const entry of Object.values(entries)) entry.sourceHash ||= options.sourceHash;
        for (const candidates of Object.values(workspace.dropped || {})) for (const candidate of Object.values(candidates)) {
          candidate.targetSourceHash ||= options.sourceHash;
          rememberDroppedScope(candidate, options.sourceHash);
          workspace.droppedArchive[candidate.id] = copy(candidate);
          if (droppedOwnership(candidate) === 'online' && candidate.recoveryId) queueDropped(workspace, candidate);
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
          if (!workspace.staged[language]?.[desc.filepath]) {
            const file = { filepath: desc.filepath, translations: desc.translations[language] };
            const savedAt = status.lastTranslatedAt || status.lastEditedAt || options.migrationAt;
            if (!complete(file.translations, (original || desc).translations?.English?.length || 0))
              archiveInvalidTranslation(workspace, { sourceHash, translations: lines(file.translations),
                before: lines(original?.translations?.[language]), savedAt, saveOrigin: state.hasChanges ? 'legacy_save' : 'legacy_inferred' }, language,
                { filepath: desc.filepath, source: original || desc, archivedAt: options.migrationAt || 1 });
            else stageTranslation(workspace, file, language, { source: original, sourceHash, savedAt,
              saveOrigin: state.hasChanges ? 'legacy_save' : 'legacy_inferred' });
          }
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
      if (!next.has(filepath)) { delete entries[filepath]; continue; }
      const desc = old.get(filepath) || (workspace.descs || []).find(desc => desc.filepath === filepath);
      if (archiveInvalidTranslation(workspace, entry, language, { filepath, source: desc })) { delete entries[filepath]; continue; }
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
    // Preserve a missing language block only while its filepath still exists.
    // Removed files belong to the predecessor version, outside this workload.
    for (const previous of options.previousSource || []) {
      const current = next.get(previous.filepath);
      if (!current) continue;
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
          reason: 'Translation missing from new source' });
      }
    }
    const carriedCandidates = new Map([...Object.values(workspace.droppedArchive || {}), ...Object.values(workspace.dropped || {}).flatMap(Object.values)]
      .filter(candidate => candidate?.id).map(candidate => [droppedOwnership(candidate) + ':' + candidate.id, candidate]));
    for (let candidate of carriedCandidates.values()) {
      if (!next.has(candidate.filepath) || !inWorkspaceScope(workspace, candidate) || !candidateScopes(candidate).some(hash =>
        hash === (options.previousSourceHash || workspace.sourceHash) || hash === options.sourceHash) || candidate.status !== 'dropped') continue;
      if (droppedOwnership(candidate) === 'online') {
        candidate = { ...copy(candidate), id: 'local-carry:' + options.sourceHash + ':' + candidate.id, ownership: 'local', revision: 0,
          targetSourceHash: options.sourceHash, targetSourceHashes: [options.sourceHash] };
        delete candidate.groupId; delete candidate.versionId;
      }
      if (candidate.localRecoveryScope && candidate.localRecoveryScope.sourceHash !== options.sourceHash) {
        // An attachment resolves the matching standalone baseline only. A new
        // local import owns its carried copy; keep the old link as provenance,
        // never as permission to dispose work in a different source workspace.
        candidate.localRecoveryOriginScope = copy(candidate.localRecoveryScope);
        delete candidate.localRecoveryScope;
      }
      rememberDroppedScope(candidate, options.sourceHash);
      candidate.targetSourceHash = options.sourceHash; workspace.droppedArchive[candidate.id] = copy(candidate);
      (workspace.dropped[candidate.language] ||= {})[candidate.filepath] = candidate;
    }
    for (const conflicts of Object.values(workspace.droppedConflicts || {})) for (const [filepath, conflict] of Object.entries(conflicts)) {
      if (!next.has(filepath) || !inWorkspaceScope(workspace, conflict) || (conflict.targetSourceHash
        && conflict.targetSourceHash !== (options.previousSourceHash || workspace.sourceHash))) continue;
      conflict.targetSourceHash = options.sourceHash;
      if (conflict.yours) {
        rememberDroppedScope(conflict.yours, options.sourceHash);
        conflict.yours.targetSourceHash = options.sourceHash;
      }
    }
    workspace.sourceHash = options.sourceHash;
    workspace.sourceBaseline = { sourceHash: options.sourceHash };
    removeDeletedRecoveryCopies(workspace, droppedRecoveryPaths(workspace).filter(filepath => !next.has(filepath)));
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
    const protectedHere = new Set(Object.values(workspace.sourceCarryRepairArchive || {}).filter(repair => repair.protectedRevision
      && repair.sourceHash === workspace.sourceHash).map(repair => serialized([repair.language, repair.filepath])));
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
        || protectedHere.has(serialized([language, filepath]))
        || metadataCorrectionForSource(entry, desc, workspace.sourceHash) || carry?.metadataCorrection || carry?.destinationSave
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
  function carriedBaselineReplay(workspace, desc, language, file) {
    if (!workspace || !desc || !file?.trackedForExport || file.needsReview || file.sourceCarry?.metadataCorrection || file.sourceCarry?.destinationSave
      || !sameBaselineTranslation(desc, language, file.translations)
      || droppedForFile(workspace, desc.filepath, language) || wasDroppedInSource(workspace, desc.filepath, language)) return null;
    const current = workspace.staged?.[language]?.[desc.filepath];
    // A later local command takes precedence over the archived inheritance,
    // including an explicit unchanged/blank save.
    if (current?.saveOrigin || current?.sourceCarry?.metadataCorrection || current?.sourceCarry?.destinationSave
      || current && !sameBaselineTranslation(desc, language, current.translations)) return null;
    for (const repair of Object.values(workspace.sourceCarryRepairArchive || {})) {
      if (repair.protectedRevision || repair.filepath !== desc.filepath || repair.language !== language || repair.sourceHash !== workspace.sourceHash
        || !repair.fromSourceHash || repair.fromSourceHash === workspace.sourceHash || repair.stage?.sourceCarry?.metadataCorrection
        || repair.stage?.sourceHash !== workspace.sourceHash || !Array.isArray(repair.stage?.translations)
        || !sameBaselineTranslation(desc, language, repair.stage?.translations)) continue;
      const carry = file.sourceCarry;
      // A later accepted revision is authoritative unless the API actually
      // resets its staging. Unverified server work must remain visible Saved.
      if (file.revision !== 1 || carry && (carry.fromSourceHash !== repair.fromSourceHash || carry.toSourceHash !== workspace.sourceHash)) continue;
      return repair;
    }
    return null;
  }
  function mergeSourceImportWorkspace(existing, incoming, options = {}) {
    incoming = copy(incoming);
    quarantineInvalidTranslations(incoming, options);
    if (!existing) return incoming;
    existing = copy(existing);
    quarantineInvalidTranslations(existing, options);
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
    for (const field of ['droppedArchive', 'droppedAliases', 'sourceCarryRepairArchive', 'invalidTranslationArchive'])
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
    const candidate = droppedForFile(workspace, filepath, language, expected);
    if (!candidate || (expected && (candidate.id !== expected.id || Number(candidate.revision) !== Number(expected.revision)
      || expected.targetSourceHash && expected.targetSourceHash !== workspace.sourceHash)))
      throw Object.assign(new Error('The dropped translation changed before it could be discarded.'), { stale: true });
    maps(workspace); rememberDroppedScope(candidate, workspace.sourceHash);
    retainDropped(workspace, { ...copy(candidate), status: 'discarded', resolvedAt: Date.now() });
    if (workspace.dropped[language]?.[filepath]?.id === candidate.id
      && droppedOwnership(workspace.dropped[language][filepath]) === candidate.ownership) delete workspace.dropped[language][filepath];
    if (candidate.ownership === 'online') queueDropped(workspace, candidate, 'discard');
    invalidateDroppedScopes(workspace);
    return candidate;
  }
  function acceptDropped(workspace, records, options = {}) {
    maps(workspace); workspace.droppedAliases ||= {};
    let byFingerprint;
    const fingerprint = record => serialized([record.game || workspace.game, record.language, record.filepath, record.originSourceHash || '', record.snapshot, record.recoveryId || '']);
    const matchingLocal = remote => {
      const known = workspace.droppedArchive[remote.id];
      if (known && droppedOwnership(known) !== 'online') return null;
      if (known && inWorkspaceScope(workspace, known)) return known;
      // Resolved provenance tombstones have no snapshot with which to prove
      // an alias. A trusted upload receipt can still match its local ID below.
      if (remote.snapshot == null) return null;
      if (!byFingerprint) {
        byFingerprint = new Map(Object.values(workspace.droppedArchive)
          .filter(record => droppedOwnership(record) === 'online' && record.snapshot != null && inWorkspaceScope(workspace, record))
          .map(record => [fingerprint(record), record]));
      }
      return byFingerprint.get(fingerprint(remote)) || null;
    };
    for (const incoming of records || []) {
      const remote = { ...incoming, ownership: 'online' };
      if (!remote?.id || !inWorkspaceScope(workspace, remote) || (options.game && remote.game !== options.game) || (options.language && remote.language !== options.language)) continue;
      const active = droppedForFile(workspace, remote.filepath, remote.language, 'online');
      const acknowledged = options.acknowledge && options.acknowledgeId ? workspace.droppedArchive[options.acknowledgeId] : null;
      const local = droppedOwnership(acknowledged) === 'online' && acknowledged?.language === remote.language && acknowledged?.filepath === remote.filepath && inWorkspaceScope(workspace, acknowledged)
        ? acknowledged : matchingLocal(remote);
      const retainedSnapshot = remote.snapshot && !remote.snapshot.english?.length && local?.id === remote.id
        && local.game === remote.game && local.language === remote.language && local.filepath === remote.filepath
        && local.originSourceHash === remote.originSourceHash && (local.branchId || 'default') === (remote.branchId || 'default')
        && local.snapshot?.english?.length && equal(local.snapshot.translations, remote.snapshot.translations) ? local.snapshot : null;
      const equivalentContent = !!local && sameDroppedContent(local, remote);
      const preserveOriginal = options.preserveOriginal || (equivalentContent
        && (!sameDroppedCopy(local, remote) || !equal(local.snapshot, remote.snapshot)));
      if (local && local.id !== remote.id) workspace.droppedAliases[local.id] = { id: remote.id, fromRevision: Number(local.revision) || 0,
        revision: Number(remote.revision) || 0, targetSourceHash: remote.targetSourceHash };
      if (local && Number(local.revision || 0) > Number(remote.revision || 0)
        && !options.equivalentContent && !(options.acknowledge && equivalentContent)) continue;
      const pending = workspace.droppedOutbox.some(operation => operation.id === local?.id);
      if (pending && !options.acknowledge) continue;
      const locallyResolved = local && ['promoted', 'discarded'].includes(local.status);
      const record = { ...copy(preserveOriginal ? {} : local || {}), ...copy(remote),
        targetSourceHash: remote.targetSourceHash || local?.targetSourceHash || '',
        targetSourceHashes: candidateScopes(remote),
        ...(retainedSnapshot ? { snapshot: copy(retainedSnapshot) } : {}),
        ...(remote.snapshot == null && local?.snapshot ? { snapshot: copy(local.snapshot) } : {}),
        ...(locallyResolved && remote.status === 'dropped' ? { status: local.status } : {}) };
      if (!remote.sourceUnavailable && remote.snapshot?.english?.length) {
        delete record.sourceUnavailable; delete record.sourceError;
      }
      // A read/join only projects assignments established by an import/review.
      // Browsing another named version must not create new Dropped workload.
      retainDropped(workspace, record);
      if (preserveOriginal && local?.id === remote.id) workspace.droppedArchive[local.id + ':revision:' + Number(local.revision || 0)] = { ...copy(local), status: 'replaced' };
      if (byFingerprint && record.snapshot != null) byFingerprint.set(fingerprint(record), record);
      if (local?.id && local.id !== remote.id) {
        if (preserveOriginal || (local.recoveryId && local.id === local.recoveryId)) {
          workspace.droppedArchive[local.id] = { ...copy(local), status: 'replaced' };
          if (preserveOriginal) Object.assign(workspace.droppedAliases[local.id], {
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
    // Entry metadata for active work comes from the immutable current source.
    // Preserved metadata is recovery evidence, not a choice between equal text.
    const fields = ['english', 'translations'];
    if (!fields.every(field => Array.isArray(left.snapshot[field]) && Array.isArray(right.snapshot[field])
      && equal(left.snapshot[field], right.snapshot[field]))) return false;
    return (left.branchId || 'default') === (right.branchId || 'default')
      && ['game', 'language', 'filepath'].every(field => left[field] === right[field]);
  }
  function sameDroppedCopy(left, right) {
    return sameDroppedContent(left, right) && left.originSourceHash === right.originSourceHash
      && (left.originSourceAvailable !== false) === (right.originSourceAvailable !== false);
  }
  function droppedComparisonRecord(workspace, record, previous) {
    if (record?.snapshot || !['promoted', 'discarded'].includes(record?.status)) return record;
    // A generation's content is immutable. A resolution tombstone may omit its
    // payload; use only content previously retained for that exact generation.
    const known = [previous, workspace?.droppedArchive?.[record.id]].find(candidate => candidate?.id === record.id
      && candidate.snapshot && Number(candidate.revision || 0) <= Number(record.revision || 0));
    return known ? { ...copy(record), snapshot: copy(known.snapshot) } : record;
  }
  function coalesceDroppedConflict(workspace, filepath, language, shared) {
    const conflict = workspace?.droppedConflicts?.[language]?.[filepath];
    shared = droppedComparisonRecord(workspace, shared, conflict?.shared);
    if (!conflict || droppedOwnership(conflict.yours) !== droppedOwnership(shared) || !['upload', 'promotion', 'discard'].includes(conflict.kind) || conflict.targetSourceHash !== workspace.sourceHash
      || !['dropped', 'promoted', 'discarded'].includes(shared?.status) || !shared.id || !sameDroppedContent(conflict.yours, shared)
      || !inWorkspaceScope(workspace, conflict.yours) || !inWorkspaceScope(workspace, shared)) return null;
    const preserveOriginal = !sameDroppedCopy(conflict.yours, shared) || !equal(conflict.yours.snapshot, shared.snapshot);
    const active = droppedForFile(workspace, filepath, language);
    let local = workspace.droppedArchive?.[conflict.yours.id];
    // Older clients stored a same-ID shared revision over the local archive.
    // The still-active, unchanged local copy can establish the captured version.
    if (local?.id === shared.id && active?.id === local.id && sameDroppedContent(active, conflict.yours)) local = active;
    const alias = workspace.droppedAliases?.[local?.id];
    if (conflict.kind === 'promotion' && local?.status === 'replaced' && alias?.id === shared.id
      && sameDroppedContent(local, shared)) local = { ...copy(local), status: 'promoted' };
    if (!local || !sameDroppedContent(local, conflict.yours)
      || !['dropped', 'promoted', ...(conflict.kind === 'discard' ? ['discarded'] : [])].includes(local.status)) return null;
    // Revisions are guards for replacing different content. Equal text can
    // adopt the latest canonical receipt even after an ID or revision change.
    if (active && !sameDroppedContent(active, local)) return null;
    maps(workspace);
    // Adopt the receipt for the same preserved content. This does not review or
    // stage it, and acceptDropped retains an already reviewed local promotion.
    local.targetSourceHashes = candidateScopes(local, conflict.yours, conflict.shared);
    workspace.droppedArchive[local.id] = copy(local);
    const aliases = Object.entries(workspace.droppedAliases || {}).filter(([, alias]) => alias.id === local.id
      && Number(alias.revision || 0) === Number(local.revision || 0));
    delete workspace.droppedConflicts[language][filepath];
    acceptDropped(workspace, [shared], { game: shared.game, language, acknowledge: true, acknowledgeId: local.id,
      acknowledgeKind: conflict.kind === 'discard' && shared.status !== 'dropped' ? 'discard' : 'put',
      preserveOriginal, equivalentContent: true });
    // Preserve the user's explicit discard and retry it against the equivalent
    // canonical generation; consolidation does not revive the local copy.
    if (conflict.kind === 'discard') for (const operation of workspace.droppedOutbox) {
      if (operation.id === local.id && operation.kind === 'discard') {
        delete operation.conflict;
        if (shared.id === local.id) { operation.revision = Number(shared.revision) || 0; operation.candidate.revision = operation.revision; }
      }
    }
    // Recovery retries and already captured saves may still name an earlier
    // temporary ID. Keep every proven alias directly bound to the new receipt.
    for (const [id, alias] of aliases) {
      const original = workspace.droppedArchive[id];
      workspace.droppedAliases[id] = { ...alias, id: shared.id,
        revision: Number(shared.revision) || 0, targetSourceHash: shared.targetSourceHash,
        ...(preserveOriginal ? {
          originSourceHash: own(alias, 'originSourceHash') ? alias.originSourceHash : original?.originSourceHash ?? local.originSourceHash,
          ...(own(alias, 'originSourceAvailable') ? { originSourceAvailable: alias.originSourceAvailable }
            : original ? { originSourceAvailable: original.originSourceAvailable !== false } : {}) } : {}) };
      delete workspace.droppedAliases[id].requiresReview;
    }
    if (workspace.droppedAliases[local.id]) delete workspace.droppedAliases[local.id].requiresReview;
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
      const actionId = globalThis.crypto?.randomUUID?.() || ('recovery-' + Date.now() + '-' + Math.random().toString(36).slice(2));
      retainDropped(workspace, { ...local, status: 'replaced' });
      const kept = { ...copy(local), id: actionId, recoveryId: actionId, ownership: 'online', status: 'dropped', revision: Number(shared.revision) || 0 };
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
    initializeWorkspace, workspaceFile, translationBaseMatches, stageTranslation, repairLegacyPlaceholders, classifySourceCarry, repairRedundantCarriedStages,
    sourceMetadata, metadataCorrectionForSource, carriedBaselineReplay, mergeSourceImportWorkspace,
    translationIssues, assertCompleteTranslation, archiveInvalidTranslation, quarantineInvalidTranslations, resolveDroppedPromotion,
    dropTranslation, droppedForFile, droppedCandidatesForFile, droppedOwnership, workspaceDroppedOwnership,
    attachLocalDroppedCandidates, separateDroppedCopies, droppedRecoveryPaths, removeDeletedRecoveryCopies, upgradeSource, discardDropped, acceptDropped,
    recordDroppedConflict, resolveDroppedConflict, sameDroppedContent, sameDroppedCopy, droppedComparisonRecord, coalesceDroppedConflict };
});
