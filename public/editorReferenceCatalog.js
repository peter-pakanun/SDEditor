/* Read-only reference groups for the selected release. Preparation never activates
 * a workspace or joins a room. SD originals prepared here are kept in a bounded
 * session cache; they need preparation again after a reload. ClientText uses its
 * existing verified original cache, without publishing or staging translations. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EditorReferenceCatalog = api;
})(typeof window === 'object' ? window : globalThis, function (root) {
  'use strict';
  const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const mode = group => group?.contentMode === 'clienttext' ? 'clienttext' : 'statdescription';
  const label = group => group.name || group.label || (mode(group) === 'clienttext'
    ? 'ClientText' + (group.language ? ' · ' + group.language : '') : 'StatDescription');
  const abort = () => Object.assign(new Error('Reference preparation was cancelled or its context changed.'), { name: 'AbortError', stale: true });
  const scopeKey = scope => JSON.stringify([scope?.accountId || 'guest', scope?.game || '', scope?.branchId || 'default', scope?.versionId || '', scope?.groupId || '', scope?.sourceHash || '', scope?.language || '']);
  const preparedKey = scope => scopeKey({ ...scope, sourceHash: '' });
  function sessionFor(host) {
    if (typeof host.editorLookupSession === 'function') return host.editorLookupSession();
    const ct = !!host.ctActive;
    const scope = ct ? host.ctWorkspace?.scope || {} : host.managedWorkspaceScope?.() || {
      accountId: host.cloudProfileId || host.cloudUser?.id || 'guest', game: host.gameVersion || '',
      branchId: host.branchId || 'default', sourceHash: host.sourceIdentity || '' };
    return { mode: ct ? 'clienttext' : 'statdescription', scope, language: host.lang || scope.language || '',
      unitId: ct ? host.ctSelection : host.editorCurrentEditingDesc?.filepath,
      toolsVisible: ct ? !!host.ctCurrentUnit : !!(host.editorToolsVisible ?? host.editorSessionActive ?? host.editorVisible),
      tool: ct ? host.ctTool : host.sideTab, group: host.activeContentGroup,
      version: ct ? host.ctWorkspace?.metadata?.version : host.managedActiveVersion };
  }
  function contextKey(host, session = sessionFor(host)) {
    return JSON.stringify([scopeKey(session.scope), session.mode, session.language,
      session.version?.id || '', session.group?.id || '', host.cloudUser?.id || '',
      host.cloudUser?.assignmentVersion, host.cloudUser?.role, host.cloudUser?.language,
      !!host.cloudCanAccessAllLanguages, session.generation ?? session.scope?.generation ?? 0]);
  }
  function groupsFor(host, session) {
    const versionId = session.version?.id || session.scope?.versionId;
    // A standalone/local SD import has no named release catalog.
    if (!versionId || String(versionId).startsWith('local:')) return [];
    const details = [host.managedActiveDetails, host.managedSelectedDetails, host.managedVersionDetails]
      .find(value => value?.version?.id === versionId);
    const supplied = details?.contentGroups || session.version?.contentGroups || [];
    const groups = new Map(supplied.filter(group => group?.id && group.versionId === versionId).map(group => [group.id, group]));
    if (session.group?.id) groups.set(session.group.id, session.group);
    return [...groups.values()].filter(group => {
      if (!host.cloudSignedIn || host.cloudCanAccessAllLanguages) return true;
      const language = host.cloudUser?.language;
      if (!language) return group.id === session.group?.id;
      return mode(group) === 'clienttext' ? group.language === language
        : !group.teams?.length || group.teams.some(team => team.language === language);
    });
  }
  function groupScope(session, group, language) {
    const descriptor = group.assets?.find(asset => asset.role === 'source')?.descriptor;
    return { accountId: session.scope?.accountId || 'guest', game: session.scope?.game || session.version?.game,
      branchId: session.scope?.branchId || session.version?.branchId || 'default',
      versionId: session.version?.id || session.scope?.versionId, groupId: group.id, language,
      ...(mode(group) === 'statdescription' ? { contentMode: 'statdescription', sourceHash: descriptor?.baselineId || group.sourceHash || (group.id === session.group?.id ? session.scope?.sourceHash : '') } : {}) };
  }
  function allowsLanguage(host, group, language) {
    if (host.cloudSignedIn && !host.cloudCanAccessAllLanguages && language !== host.cloudUser?.language) return false;
    return mode(group) === 'clienttext' ? group.language === language
      : !group.teams?.length || group.teams.some(team => team.language === language);
  }
  function activeSource(host, session, language) {
    const group = session.group || {}, scope = { ...session.scope, language };
    if (session.mode === 'clienttext') {
      if (language !== session.language) return null;
      return { mode: 'clienttext', scope, groupId: group.id || scope.groupId || '', groupLabel: label({ ...group, contentMode: 'clienttext' }),
        language, units: host.ctUnits || [], saved: host.ctSaved || {} };
    }
    return { mode: 'statdescription', scope, groupId: group.id || scope.groupId || '', groupLabel: label(group),
      language, descs: host.descs || [], workspace: host.localDescs };
  }
  function create(host) {
    let retainedContext = '', prepared = new Map();
    async function load(session, language, options = {}) {
      const key = contextKey(host, session), client = host._cloud;
      const current = () => !options.signal?.aborted && key === contextKey(host) && (!options.current || options.current());
      const check = () => { if (!current()) throw abort(); };
      check();
      if (session.version && (session.version.game && session.version.game !== session.scope?.game
        || (session.version.branchId || 'default') !== (session.scope?.branchId || 'default')))
        throw new Error('Reference groups belong to another game or branch.');
      if (retainedContext !== key) { prepared.clear(); retainedContext = key; }
      const groups = groupsFor(host, session), sources = [], missing = [], errors = [];
      const active = activeSource(host, session, language);
      if (active && (!host.cloudSignedIn || host.cloudCanAccessAllLanguages || language === host.cloudUser?.language || !groups.length)) sources.push(active);
      for (const candidate of groups) {
        if (!allowsLanguage(host, candidate, language)) continue;
        if (active && candidate.id === active.groupId) continue;
        let group = candidate, scope = groupScope(session, group, language), cached;
        try {
          if (mode(group) === 'clienttext') {
            const metadata = await host._ctStore?.getMetadata(scope, { guard: current }); check();
            if (metadata?.state === 'ready') {
              const [units, saved] = await Promise.all([host._ctStore.getUnits(scope, { guard: current }), host._ctStore.getSaved(scope, { guard: current })]); check();
              cached = { mode: 'clienttext', scope, groupId: group.id, groupLabel: label(group), language, units, saved };
            }
          } else if (scope.sourceHash) {
            const descs = await root.OfflineStore?.getVersionSource(scope); check();
            if (descs?.length) {
              const workspace = await root.OfflineStore?.getVersionWorkspace(scope, language); check();
              cached = { mode: 'statdescription', scope, groupId: group.id, groupLabel: label(group), language, descs, workspace };
            }
          }
          if (!cached) {
            const retained = prepared.get(preparedKey(scope));
            if (retained) {
              // Another tab may commit a sibling translation while its original
              // exists only in this session. Refresh Saved overlays on each read.
              const workspace = await root.OfflineStore?.getVersionWorkspace(retained.scope, language); check();
              cached = { ...retained, workspace };
            }
          }
          if (!cached && options.prepare) {
            if (!host.managedOnlineAvailable || !client?.request) throw new Error('Connect to prepare the missing reference originals.');
            const response = await client.request('/v1/content-groups/' + encodeURIComponent(group.id), { signal: options.signal }); check();
            const full = response.group || response.contentGroup;
            const version = response.version || full?.version;
            if (full?.id !== group.id || full.versionId !== scope.versionId || mode(full) !== mode(group)
              || version && (version.id !== scope.versionId || version.game !== scope.game || (version.branchId || 'default') !== scope.branchId)
              || mode(full) === 'clienttext' && full.language !== language) throw new Error('The reference group does not match the selected release and language.');
            group = full; scope = groupScope(session, full, language);
            if (mode(group) === 'clienttext') {
              // Vue binds Options API methods to the editor. Calling that bound
              // method with .call(facade) would still publish root progress.
              const cacheGroup = root.ClientTextUI?.mixin?.methods?.ctCacheGroup || host.ctCacheGroup;
              if (!cacheGroup || !host._ctWorker || !host._ctStore) throw new Error('Workbook preparation is unavailable.');
              // Reuse original verification without touching the editor's busy,
              // progress, selection, activation pointer or collaboration state.
              const facade = { _cloud: client, _ctStore: host._ctStore, _ctWorker: host._ctWorker,
                ctReport: progress => { check(); options.onProgress?.(progress); },
                ctInitializationStep: async (_name, callback) => callback(progress => { check(); options.onProgress?.(progress); }) };
              await cacheGroup.call(facade, copy(session.version), group, scope, { signal: options.signal, current }); check();
              const [units, saved] = await Promise.all([host._ctStore.getUnits(scope, { guard: current }), host._ctStore.getSaved(scope, { guard: current })]); check();
              cached = { mode: 'clienttext', scope, groupId: group.id, groupLabel: label(group), language, units, saved };
            } else {
              const archive = group.assets?.find(asset => asset.role === 'source')?.descriptor;
              if (!archive || !root.ManagedCollectionExports?.parseOriginal || !root.JSZip) throw new Error('StatDescription reference preparation is unavailable.');
              options.onProgress?.({ phase: 'Preparing reference original', workbook: label(group) });
              const blob = await client.request('/v1/content-groups/' + encodeURIComponent(group.id) + '/assets/source/original', { responseType: 'blob', timeout: 120000, signal: options.signal }); check();
              const descs = await root.ManagedCollectionExports.parseOriginal(blob, archive, language, root.JSZip, { current }); check();
              const workspace = await root.OfflineStore?.getVersionWorkspace(scope, language); check();
              cached = { mode: 'statdescription', scope, groupId: group.id, groupLabel: label(group), language, descs, workspace };
              prepared.set(preparedKey(scope), cached);
            }
          }
          if (cached) sources.push(cached); else missing.push({ id: group.id, label: label(group), mode: mode(group) });
        } catch (error) {
          check();
          missing.push({ id: group.id, label: label(group), mode: mode(group) });
          errors.push(label(group) + ': ' + error.message);
        }
      }
      check();
      return { sources, groups: groups.map(group => ({ id: group.id, label: label(group), mode: mode(group) })), missing, errors };
    }
    return { load, dispose() { prepared.clear(); retainedContext = ''; } };
  }
  return { create, sessionFor, contextKey, scopeKey, groupsFor, groupScope, activeSource };
});
