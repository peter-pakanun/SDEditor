/* Bounded MTL context from the already loaded immutable ClientText workbooks. */
(function (root, factory) {
    const node = typeof module === 'object' && module.exports;
    const api = factory(node ? require('./clientTextState.js') : root.ClientTextState,
        node ? require('./dictionaryScope.js') : root.DictionaryScope,
        node ? require('./clientTextPortraitCatalog.js') : root.ClientTextPortraitCatalog);
    if (node) module.exports = api; else root.ClientTextMtlContext = api;
})(typeof globalThis === 'object' ? globalThis : self, function (State, DictionaryScope, PortraitCatalog) {
    'use strict';
    const LIMITS = Object.freeze({ source: 12000, context: 16000, contextBytes: 48 * 1024, contextEntries: 1500,
        bytes: 65536, surrounding: 50, fields: 8, lookups: 2, results: 4, glossary: 32,
        toneParticipant: 600, toneTotal: 1200, voiceExamples: 2, voiceExample: 200, roleEvidence: 256 });
    const copy = value => JSON.parse(JSON.stringify(value));
    const clean = value => typeof value === 'string' ? value : '';
    const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
    const metadataKind = name => /^character filter$/i.test(name) ? 'listener-constraint'
        : /^(?:speaker|speaking character)$/i.test(name) ? 'explicit-speaker'
        : /^(?:listener|listening character|addressee)$/i.test(name) ? 'explicit-listener'
        : /^(?:related ?character|character|npc)$/i.test(name) ? 'explicit-reference' : 'workbook-metadata';
    const textFields = unit => (unit?.fields || []).filter(field => field && field.kind !== 'gender' && clean(field.source).trim());
    const dialogue = unit => /^(?:NPCTextAudio|NPCTalkDialogueTextAudio)(?:_Gender)?$/.test(unit?.sheet);
    function npcResolver(units, index) {
        const loaded = new Map(units.map(value => [value.id, value])), paths = new Map(), names = new Map(), groups = new Map(), cache = new Map();
        const normalized = value => clean(value).normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
        function add(map, reference, key) {
            if (!reference) return;
            if (!map.has(reference)) map.set(reference, new Set());
            map.get(reference).add(key);
        }
        for (const [key, group] of index?.groupByKey || []) for (const candidate of group?.npcUnits || []) {
            const original = loaded.get(candidate?.id);
            if (!original || !/^NPCs(?:_Gender)?$/.test(original.sheet)) continue;
            // Browsing groups merge equal English names. They are not identity
            // equivalence: only the exact loaded path identifies an NPC here.
            add(paths, original.recordId, original.recordId); add(groups, original.recordId, key);
            if (!original.recordId.startsWith('Metadata/NPC/Info/')) for (const field of original.fields)
                if (['Name', 'Short Name'].includes(field.name)) add(names, normalized(field.source), original.recordId);
        }
        function resolve(reference, speaker = false) {
            const owners = paths.get(reference) || (speaker ? names.get(normalized(reference)) : null);
            return owners?.size === 1 ? owners.values().next().value : null;
        }
        return unit => {
            if (cache.has(unit.id)) return cache.get(unit.id);
            const metadata = Object.entries(unit.metadata || {}), speakers = metadata.filter(([name]) => /^(?:speaker|speaking character)$/i.test(name)),
                related = metadata.filter(([name]) => /^npc$/i.test(name));
            let result = null;
            const speakerRefs = speakers.map(([, value]) => clean(value).trim()),
                references = related.flatMap(([, value]) => clean(value).split(/[,\r\n]+/u).map(value => value.trim()).filter(Boolean)),
                unique = [...new Set(references)], relatedKey = unique.length === 1 ? resolve(unique[0]) : null,
                speakerKeys = speakerRefs.map(reference => resolve(reference, true));
            // Blank identity columns and conflicting verified speakers cannot
            // fall through to ID aliases. A generic player label is not an NPC.
            if (!speakerRefs.some(reference => !reference) && (!related.length || relatedKey)) {
                const verified = [...new Set(speakerKeys.filter(key => key !== null))];
                if (relatedKey && verified.every(key => key === relatedKey)) result = {
                    identityKey: 'npc:' + relatedKey, groupKey: groups.get(relatedKey)?.values().next().value,
                    reference: unique[0], evidence: 'explicit-npc-reference',
                    speakerEstablished: speakerRefs.length > 0 && speakerKeys.every(key => key === relatedKey) };
                else if (!related.length && speakerKeys.length && speakerKeys.every(key => key !== null) && verified.length === 1)
                    result = { identityKey: 'npc:' + verified[0], groupKey: groups.get(verified[0])?.values().next().value,
                        reference: speakerRefs[0], evidence: 'explicit-speaker', speakerEstablished: true };
            }
            cache.set(unit.id, result); return result;
        };
    }
    function worksheetRow(unit) {
        const rows = new Set();
        for (const field of unit.fields) for (const cell of [field?.sourceCell, field?.targetCell]) {
            if (!clean(cell)) continue;
            const match = /^\$?[A-Z]{1,3}\$?([1-9]\d*)$/i.exec(cell);
            if (!match || Number(match[1]) > 1048576) return null;
            rows.add(Number(match[1]));
        }
        return rows.size === 1 ? rows.values().next().value : null;
    }
    function translationFor(unit, field, saved) {
        // Only the caller's scoped Saved snapshot is accepted. Drafts, candidates
        // and MTL review overlays are deliberately not context inputs.
        const record = saved instanceof Map ? saved.get(unit.id) : own(saved, unit.id) ? saved[unit.id] : null;
        const authored = record && record.saved !== false && own(record.values, field.id);
        const outdated = !!field.outdated || Array.isArray(record?.outdated) && record.outdated.includes(field.id);
        if (outdated && (!authored || record.reviewed?.[field.id] !== State.sourceHash(field.source))) return null;
        if (Array.isArray(record?.conflicts) && record.conflicts.some(value => value?.fieldId === field.id)) return null;
        const translation = authored ? record.values[field.id] : field.target;
        if (!clean(translation).trim() || translation.trim() === 'NONEXISTENT' || !authored && field.originalMissing) return null;
        return { translation, translationOrigin: authored ? 'saved' : 'original-workbook' };
    }
    const roleColumns = { speaker: /^(?:speaker|speaking character)$/i, listener: /^(?:listener|listening character|addressee)$/i };
    const referenceList = value => [...new Set(clean(value).split(/[,\r\n]+/u).map(value => value.trim()).filter(Boolean))];
    function clipText(value, limit) {
        let end = Math.min(value.length, limit);
        if (end && /[\uD800-\uDBFF]/.test(value[end - 1]) && /[\uDC00-\uDFFF]/.test(value[end] || '')) end--;
        return value.slice(0, end);
    }
    function rawEvidence(value) {
        const raw = clean(value);
        return { raw: clipText(raw, LIMITS.roleEvidence), ...(raw.length > LIMITS.roleEvidence ? { truncated: true, originalCharacters: raw.length } : {}) };
    }
    function actorResolver(units, options) {
        const loaded = new Map(units.map(value => [value.id, value])), actors = new Map(), paths = new Map(), names = new Map(), terminals = new Map(), groups = new Map(),
            registry = PortraitCatalog?.games?.[options.scope?.game] || { characters: {}, npcs: {} }, normalize = value => clean(value).normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
        function add(map, reference, key) {
            if (!reference) return;
            if (!map.has(reference)) map.set(reference, new Set());
            map.get(reference).add(key);
        }
        // Repeated normal/hint rows for one exact path share identity. Equal
        // names, browsing groups and portrait art never equate distinct paths.
        for (const original of units.filter(value => /^NPCs(?:_Gender)?$/.test(value.sheet))) {
            const path = original.recordId, key = 'npc:' + path;
            let actor = actors.get(key);
            if (!actor) {
                const artwork = registry.npcs?.[path]?.[0];
                actor = { key, kind: 'npc', references: [path], originals: [], art: new Set(artwork ? [artwork] : []) }; actors.set(key, actor);
            }
            actor.originals.push(original);
            add(paths, path, key); add(terminals, path.split('/').at(-1), key);
            if (!path.startsWith('Metadata/NPC/Info/')) for (const field of original.fields)
                if (['Name', 'Short Name'].includes(field?.name)) add(names, normalize(field.source), key);
        }
        for (const actor of actors.values()) {
            const labels = [...new Set(actor.originals.flatMap(value => value.fields.filter(field => field?.name === 'Name').map(field => clean(field.source).trim())).filter(Boolean))];
            actor.name = labels.length === 1 ? labels[0] : '';
        }
        for (const [groupKey, group] of options.npcIndex?.groupByKey || []) {
            const keys = new Set();
            for (const candidate of group?.npcUnits || []) {
                const original = loaded.get(candidate?.id), key = original && 'npc:' + original.recordId;
                if (actors.has(key)) keys.add(key);
            }
            groups.set(groupKey, keys);
        }
        const characterRows = units.filter(value => /^Characters(?:_Gender)?$/.test(value.sheet));
        const characterPaths = new Set([...Object.keys(registry.characters || {}), ...characterRows.map(value => value.recordId)]);
        for (const path of characterPaths) {
            const originals = characterRows.filter(value => value.recordId === path), key = 'character:' + path,
                labels = [...new Set(originals.flatMap(value => value.fields.filter(field => field?.name === 'Name').map(field => clean(field.source).trim())).filter(Boolean))],
                name = labels.length === 1 ? labels[0] : clean(registry.characters?.[path]?.[1]), artwork = registry.characters?.[path]?.[0];
            actors.set(key, { key, kind: 'character', name, recordId: path, references: [path], originals, art: new Set(artwork ? [artwork] : []) });
            add(paths, path, key); add(terminals, path.split('/').at(-1), key);
            for (const label of labels) add(names, normalize(label), key);
            if (!labels.length && name) add(names, normalize(name), key);
        }
        return { actors, registry, group(groupKey, references) {
            const members = groups.get(groupKey) || new Set(), owners = references?.length ? new Set(references.map(path => 'npc:' + path).filter(key => members.has(key))) : members;
            if (references?.some(path => !members.has('npc:' + path))) return { reason: 'npc-group-identity-not-loaded' };
            return owners.size === 1 ? { actor: actors.get(owners.values().next().value) }
                : { reason: owners.size ? 'ambiguous-npc-group-identity' : 'npc-group-identity-not-loaded' };
        }, resolve(raw, { names: allowNames = true, terminal = false } = {}) {
            const value = clean(raw).trim(), owners = paths.get(value) || (terminal ? terminals.get(value) : null) || (allowNames ? names.get(normalize(value)) : null);
            return owners?.size === 1 ? { actor: actors.get(owners.values().next().value) } : { reason: owners?.size ? 'ambiguous-identity' : 'identity-not-loaded-or-known' };
        } };
    }
    function dialogueRoles(unit, units, options) {
        const metadata = Object.entries(unit.metadata || {}), relevant = dialogue(unit) || /^CharacterTextAudio(?:_Gender)?$/.test(unit.sheet)
            || metadata.some(([name]) => roleColumns.speaker.test(name) || roleColumns.listener.test(name));
        if (!relevant) return null;
        const resolver = actorResolver(units, options), { actors, registry } = resolver,
            hints = { version: 'clienttext-dialogue-roles-v1', speaker: { status: 'unknown' }, listener: { status: 'unknown' }, identities: [],
                order: { status: 'unavailable', participantKeys: [] }, constraints: [], conflicts: [], unresolved: [] }, blocked = new Set(), used = new Set();
        const unresolved = (role, kind, raw, reason) => { if (hints.unresolved.length < 6) hints.unresolved.push({ role, kind, ...rawEvidence(raw), reason }); };
        const conflict = (role, reason, candidateKey) => { if (hints.conflicts.length < 6) hints.conflicts.push({ role, reason, ...(candidateKey ? { candidateKey } : {}) }); };
        function explicit(role, candidate, quiet = false) {
            const columns = Object.entries(candidate.metadata || {}).filter(([name]) => roleColumns[role].test(name));
            if (!columns.length) return null;
            const keys = new Set(), evidence = []; let invalid = columns.length > 4;
            for (const [name, raw] of columns.slice(0, 4)) {
                const direct = resolver.resolve(raw), references = direct.actor ? [clean(raw).trim()] : referenceList(raw);
                if (!references.length) { invalid = true; if (!quiet) unresolved(role, 'explicit-metadata', raw, 'blank-explicit-role'); }
                if (references.length > 4) invalid = true;
                for (const reference of references.slice(0, 4)) {
                    const resolved = resolver.resolve(reference);
                    if (resolved.actor) keys.add(resolved.actor.key);
                    else { invalid = true; if (!quiet) unresolved(role, 'explicit-metadata', reference, resolved.reason); }
                }
                evidence.push({ kind: 'explicit-metadata', field: name, ...rawEvidence(raw) });
            }
            if (keys.size > 1) return { status: 'conflict', reason: 'conflicting-explicit-roles', evidence };
            if (invalid || keys.size !== 1) return { status: 'unknown', reason: 'unresolved-explicit-role', evidence };
            return { status: 'resolved', identityKey: keys.values().next().value, confidence: 'explicit', priority: 3, evidence };
        }
        for (const role of ['speaker', 'listener']) {
            const value = explicit(role, unit);
            if (value) { hints[role] = value; blocked.add(role); if (value.identityKey) used.add(value.identityKey); }
        }
        let suffixBlocksHeuristics = false;
        const equals = clean(unit.recordId).indexOf('=');
        if (equals >= 0) {
            const raw = unit.recordId.slice(equals + 1), suffix = hints.idSuffix = { ...rawEvidence(raw), status: 'unresolved', source: 'record-id-after-first-equals' };
            if (/^(?:HasLore|NoLore)$/i.test(raw.trim())) suffix.status = 'condition';
            else {
                const resolved = raw.length <= LIMITS.roleEvidence && !raw.includes('=') ? resolver.resolve(raw, { names: false, terminal: true }) : { reason: 'unsupported-listener-suffix' };
                if (!resolved.actor) {
                    suffix.reason = resolved.reason; suffixBlocksHeuristics = true;
                    unresolved('listener', 'record-id-suffix', raw, resolved.reason);
                } else {
                    suffix.status = 'resolved'; suffix.identityKey = resolved.actor.key; used.add(resolved.actor.key);
                    if (!blocked.has('listener') && hints.speaker.confidence === 'explicit' && hints.speaker.identityKey === resolved.actor.key) {
                        hints.listener = { status: 'conflict', reason: 'suffix-would-duplicate-explicit-speaker' }; blocked.add('listener');
                        conflict('listener', 'suffix-would-duplicate-explicit-speaker', resolved.actor.key);
                    } else if (!blocked.has('listener')) hints.listener = { status: 'suggested', identityKey: resolved.actor.key, confidence: 'convention', priority: 2,
                        evidence: [{ kind: 'record-id-suffix', rule: 'known-listener-id', ...rawEvidence(raw) }] };
                    else if (hints.listener.identityKey && hints.listener.identityKey !== resolved.actor.key) conflict('listener', 'suffix-disagrees-with-explicit-role', resolved.actor.key);
                }
            }
        }
        const participants = [], participantSet = new Set(); let unreliable = '';
        const addActor = (actor, origin) => { if (actor && !participantSet.has(actor.key)) { participants.push({ actor, origin }); participantSet.add(actor.key); } };
        const family = options.convoIndex?.memberships?.get(unit.id), membership = options.npcIndex?.memberships?.get(unit.id), npcColumns = metadata.filter(([name]) => name === 'NPC'),
            characterColumns = metadata.filter(([name]) => name === 'Character');
        if (family?.ambiguous || family?.npcEvidence?.unresolved?.length || family?.npcEvidence?.ambiguous?.length) unreliable = 'ambiguous-conversation-evidence';
        if (family?.parentKey && family.parentKey !== 'unassigned') {
            const references = family.npcEvidence?.participants?.find(value => value.key === family.parentKey)?.references,
                parent = resolver.group(family.parentKey, references);
            if (parent.actor) addActor(parent.actor, 'conversation-context');
            else unreliable ||= parent.reason;
        }
        if (!family) {
            const members = [...(membership || [])];
            if (members.length > 1) unreliable ||= 'unordered-npc-links';
            for (const [key, evidence] of members) {
                const resolved = resolver.group(key, evidence?.references);
                if (resolved.actor) addActor(resolved.actor, 'npc-index-context');
                else unreliable ||= resolved.reason;
            }
        }
        for (const [columns, kind] of [[characterColumns, 'character-reference'], [npcColumns, 'npc-reference']]) {
            const resolvedKeys = new Set();
            for (const [, raw] of columns) for (const reference of referenceList(raw)) {
                const resolved = resolver.resolve(reference, { names: false });
                if (!resolved.actor) { unreliable ||= 'unresolved-participant'; unresolved('participant', kind, reference, resolved.reason); }
                else { resolvedKeys.add(resolved.actor.key); addActor(resolved.actor, kind); }
            }
            if (resolvedKeys.size > 1) unreliable ||= 'unordered-reference-list';
        }
        if (participants.length > 2) unreliable ||= 'more-than-two-participants';
        const artwork = new Map(), npcRefs = referenceList(unit.metadata?.NPC), override = unit.sheet.replace(/_Gender$/, '') === 'NPCTextAudio' ? registry.overrides?.[unit.recordId] : null;
        for (const { actor } of participants) for (const id of override?.npcs?.some(path => actor.references.includes(path) && npcRefs.includes(path)) ? [override.id] : actor.art) {
            if (artwork.has(id) && artwork.get(id) !== actor.key) unreliable ||= 'merged-portrait-identities';
            artwork.set(id, actor.key);
        }
        hints.order = { status: unreliable ? 'suppressed' : participants.length ? 'reliable' : 'unavailable',
            kind: family?.parentKey && family.parentKey !== 'unassigned' ? 'conversation-context-then-row-references' : !family && membership?.size ? 'npc-index-then-row-references' : 'row-references',
            participantKeys: participants.slice(0, 4).map(value => value.actor.key), ...(unreliable ? { reason: unreliable } : {}) };
        for (const [name, raw] of metadata.filter(([name]) => /^(?:Prohibited )?Character Filter$/i.test(name)).slice(0, 4)) {
            const refs = referenceList(raw), keys = refs.map(reference => resolver.resolve(reference, { names: false }).actor?.key), complete = refs.length > 0 && refs.length <= 4 && keys.every(Boolean);
            hints.constraints.push({ field: name, kind: 'listener-constraint', ...rawEvidence(raw), identityKeys: keys.filter(Boolean).slice(0, 4), complete,
                prohibited: /^Prohibited /i.test(name) });
        }
        const proposals = participants.length === 2 ? { listener: participants[0].actor.key, speaker: participants[1].actor.key }
            : participants.length === 1 ? { speaker: participants[0].actor.key } : {};
        let suppress = !!unreliable || suffixBlocksHeuristics || [...blocked].some(role => !hints[role].identityKey);
        for (const [role, key] of Object.entries(proposals)) {
            if (hints[role].identityKey && hints[role].identityKey !== key) { suppress = true; conflict(role, 'portrait-convention-disagrees-with-stronger-role', key); }
            const opposite = role === 'speaker' ? 'listener' : 'speaker';
            if (!hints[role].identityKey && hints[opposite].identityKey === key) { suppress = true; conflict(role, 'portrait-would-duplicate-opposite-role', key); }
        }
        if (!suppress) for (const [role, key] of Object.entries(proposals)) if (!blocked.has(role) && !hints[role].identityKey) {
            hints[role] = { status: 'suggested', identityKey: key, confidence: 'heuristic', priority: 1,
                evidence: [{ kind: 'participant-order-convention', rule: participants.length === 2 ? 'first-listens-second-speaks' : 'single-participant-speaks', origin: hints.order.kind }] };
            used.add(key);
        }
        for (const constraint of hints.constraints) if (constraint.complete && hints.listener.identityKey) {
            const matches = constraint.identityKeys.includes(hints.listener.identityKey);
            if (matches === constraint.prohibited) {
                conflict('listener', 'listener-constraint-mismatch', hints.listener.identityKey);
                if (hints.listener.confidence !== 'explicit') {
                    hints.listener = { status: 'conflict', reason: 'listener-constraint-mismatch' };
                    if (hints.speaker.confidence === 'heuristic') hints.speaker = { status: 'unknown', reason: 'conflicting-participant-evidence' };
                }
            }
        }
        for (const { actor } of participants.slice(0, 4)) used.add(actor.key);
        for (const key of [...used].slice(0, 6)) {
            const actor = actors.get(key);
            if (actor) hints.identities.push({ key, kind: actor.kind, ...(actor.name ? { name: actor.name } : {}),
                ...(actor.recordId ? { recordId: actor.recordId } : { references: actor.references.slice(0, 4) }) });
        }
        if (!metadata.some(([name]) => roleColumns.speaker.test(name) || roleColumns.listener.test(name)) && !participants.length
            && !hints.constraints.length && !hints.idSuffix && !hints.unresolved.length && !unreliable) return null;
        return { hints, actors, explicit };
    }
    function toneExcerpt(unit, field, saved, limit, allowTranslation = true) {
        const source = clean(field.source), trusted = allowTranslation && translationFor(unit, field, saved), target = trusted ? trusted.translation : '';
        let sourceLimit = trusted ? Math.min(source.length, Math.ceil(limit / 2)) : limit;
        const targetLimit = Math.min(target.length, limit - sourceLimit);
        sourceLimit = Math.min(source.length, limit - targetLimit);
        const english = clipText(source, sourceLimit), translation = trusted ? clipText(target, targetLimit) : '';
        return { source: english, sourceCharacters: source.length, sourceTruncated: english.length < source.length,
            ...(translation ? { translation, translationOrigin: trusted.translationOrigin, translationCharacters: target.length,
                translationTruncated: translation.length < target.length } : {}) };
    }
    const toneCharacters = item => clean(item.source).length + clean(item.translation).length;
    function dialogueTone(unit, units, options, roles) {
        const profiles = [], voiceExamples = [], unavailable = [], grouped = new Map(), selection = {
            profileSource: 'Characters.Description', translationEvidence: 'scoped-saved-or-immutable-workbook',
            voiceExampleOrder: 'nearest-same-worksheet-first-then-stable-unit-id', maxVoiceExamples: LIMITS.voiceExamples,
            eligibleVoiceExamples: 0, omittedVoiceExamples: { duplicate: 0, entryLimit: 0, contextBudget: 0 } };
        let remaining = LIMITS.toneTotal;
        for (const role of ['speaker', 'listener']) {
            const hint = roles.hints[role], actor = roles.actors.get(hint.identityKey);
            if (!actor) { unavailable.push({ role, reason: 'role-identity-unresolved' }); continue; }
            if (!grouped.has(actor.key)) grouped.set(actor.key, { actor, roles: [] });
            grouped.get(actor.key).roles.push(role);
        }
        const provenance = (original, field) => ({ unitId: original.id, role: original.role, sheet: original.sheet, recordId: original.recordId,
            fieldId: field.id, sourceCell: clean(field.sourceCell), targetCell: clean(field.targetCell) });
        for (const { actor, roles: actorRoles } of grouped.values()) {
            if (actor.kind !== 'character') { unavailable.push({ identityKey: actor.key, roles: actorRoles, reason: 'npc-biography-not-in-workbook' }); continue; }
            const sameRole = actor.originals.filter(value => value.role === unit.role), originals = sameRole.length ? sameRole : actor.originals;
            if (originals.length !== 1) {
                unavailable.push({ identityKey: actor.key, roles: actorRoles, reason: originals.length ? 'ambiguous-character-profile'
                    : units.some(value => /^Characters(?:_Gender)?$/.test(value.sheet)) ? 'matching-character-profile-not-loaded' : 'characters-sheet-not-loaded' });
                continue;
            }
            const original = originals[0], descriptions = original.fields.filter(field => field?.name === 'Description' && ['text', 'form'].includes(field.kind)
                && clean(field.source).trim() && !State.audioOnly(field.source)), active = descriptions.filter(field => !/\bDNT[- ]?UNUSED\b/i.test(field.source));
            const base = active.filter(field => field.kind === 'text'), matching = active.filter(field => field.form && field.form === options.field?.form);
            let field = base.length === 1 ? base[0] : !base.length && matching.length === 1 ? matching[0] : null, allowTranslation = true;
            if (!field && active.length && active.every(value => value.source === active[0].source)
                && new Set(active.map(sourceCell).filter(Boolean)).size <= 1) { field = active[0]; allowTranslation = active.length === 1; }
            if (!field) {
                unavailable.push({ identityKey: actor.key, roles: actorRoles, reason: !descriptions.length ? 'description-not-loaded' : !active.length ? 'unused-description' : 'ambiguous-description-source' });
                continue;
            }
            const excerpt = toneExcerpt(original, field, options.saved, Math.min(LIMITS.toneParticipant, remaining), allowTranslation);
            profiles.push({ identityKey: actor.key, roles: actorRoles, kind: 'authored-character-introduction', provenance: provenance(original, field), ...excerpt });
            remaining -= toneCharacters(excerpt);
        }
        const speaker = roles.actors.get(roles.hints.speaker.identityKey);
        if (speaker?.kind === 'npc') {
            const candidates = [];
            for (const original of units) {
                if (original.id === unit.id || original.role !== unit.role || !dialogue(original)) continue;
                const verified = roles.explicit('speaker', original, true);
                if (verified?.status !== 'resolved' || verified.identityKey !== speaker.key) continue;
                const fields = contextFields(original, options.saved, options.field).filter(field => ['text', 'form'].includes(field.kind)
                    && !State.audioOnly(field.source) && !/\bDNT[- ]?UNUSED\b/i.test(field.source));
                const field = fields.find(value => value.id === options.field?.id) || fields.find(value => value.kind === 'text') || fields[0];
                if (!field) continue;
                const targetRow = worksheetRow(unit), row = worksheetRow(original), distance = original.sheet === unit.sheet && targetRow && row ? Math.abs(row - targetRow) : Infinity;
                candidates.push({ original, field, distance });
            }
            candidates.sort((a, b) => a.distance - b.distance || clean(a.original.id).localeCompare(clean(b.original.id), 'en'));
            const seen = new Set(), unique = []; let participantRemaining = LIMITS.toneParticipant;
            for (const candidate of candidates) {
                const { original, field } = candidate;
                const signature = JSON.stringify([field.source, translationFor(original, field, options.saved)?.translation || '']);
                if (seen.has(signature)) { selection.omittedVoiceExamples.duplicate++; continue; }
                seen.add(signature); unique.push(candidate);
            }
            selection.eligibleVoiceExamples = unique.length;
            selection.omittedVoiceExamples.entryLimit = Math.max(0, unique.length - LIMITS.voiceExamples);
            for (const { original, field } of unique.slice(0, LIMITS.voiceExamples)) {
                if (!remaining || !participantRemaining) break;
                const excerpt = toneExcerpt(original, field, options.saved, Math.min(LIMITS.voiceExample, participantRemaining, remaining));
                voiceExamples.push({ identityKey: speaker.key, role: 'speaker', kind: 'verified-speaker-voice-example',
                    provenance: provenance(original, field), speakerEvidence: 'explicit-metadata', ...excerpt });
                const characters = toneCharacters(excerpt); remaining -= characters; participantRemaining -= characters;
            }
            if (!voiceExamples.length) unavailable.push({ identityKey: speaker.key, role: 'speaker', reason: 'verified-speaker-examples-not-loaded' });
        }
        return { profiles, voiceExamples, unavailable, selection };
    }
    const sourceGroup = field => clean(field.group) || clean(field.name);
    const sourceCell = field => clean(field.sourceCell).replace(/\$/g, '').toUpperCase();
    function matchingForm(field, target) {
        return target?.kind === 'form' && field.kind === 'form' && (field.id === target.id
            || clean(target.form) && field.form === target.form && sourceGroup(field) === sourceGroup(target));
    }
    function contextFields(unit, saved, target) {
        const fields = textFields(unit), groups = new Map(), retained = new Set();
        for (const field of fields) {
            const name = sourceGroup(field), cell = sourceCell(field);
            // Without a source name or coordinate there is no evidence that
            // different form identities inherit one source cell.
            if (!name && !cell) { retained.add(field); continue; }
            const key = JSON.stringify([name, field.source]);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(field);
        }
        for (const peers of groups.values()) {
            const cells = new Set(peers.map(sourceCell).filter(Boolean)), clusters = new Map();
            for (const field of peers) {
                const cell = sourceCell(field);
                // Separate known cells are explicit distinct sources, even when
                // their text happens to match. Missing coordinates cannot join
                // those ambiguous cells to manufacture an inheritance relation.
                if (cells.size > 1 && !cell) { retained.add(field); continue; }
                const key = cells.size > 1 ? cell : '';
                if (!clusters.has(key)) clusters.set(key, []);
                clusters.get(key).push(field);
            }
            for (const cluster of clusters.values()) {
                const trusted = new Set(cluster.filter(field => translationFor(unit, field, saved))),
                    representative = cluster.find(field => field.kind !== 'form') || cluster.find(field => trusted.has(field))
                        || cluster.find(field => matchingForm(field, target)) || cluster[0];
                for (const field of cluster) if (field.kind !== 'form' || trusted.has(field) || field === representative) retained.add(field);
            }
        }
        return fields.filter(field => retained.has(field));
    }
    function limitedFields(fields, target) {
        const selected = new Set(fields.slice(0, LIMITS.fields)), matching = fields.find(field => matchingForm(field, target));
        if (matching && !selected.has(matching)) { selected.delete(fields[LIMITS.fields - 1]); selected.add(matching); }
        return fields.filter(field => selected.has(field));
    }
    function surroundingPlan(unit, units, options) {
        const conversation = options.convoIndex?.memberships?.get(unit.id), targetRow = worksheetRow(unit);
        const familyKey = clean(conversation?.familyKey), provenance = { mode: 'none', reason: 'target-not-loaded',
            maxEntries: LIMITS.surrounding, availableEntries: 0, selectedEntries: 0,
            omitted: { entryLimit: 0, contextBudget: 0, untranslated: 0, fieldLimit: 0, worksheetCoordinates: 0, existingReference: 0 },
            selectionOrder: 'nearest-first-preceding-on-ties', outputOrder: 'worksheet-row',
            orderEvidence: 'immutable-worksheet-coordinates', truncated: false, entries: [] };
        if (!units.some(value => value.id === unit.id)) return { provenance, candidates: [] };
        if (!targetRow) { provenance.reason = 'worksheet-order-unavailable'; return { provenance, candidates: [] }; }
        let candidates, explicitNpc;
        if (familyKey) {
            provenance.familyKey = familyKey;
            candidates = units.filter(value => value.role === unit.role && value.sheet === unit.sheet && value.id !== unit.id
                && options.convoIndex.memberships.get(value.id)?.familyKey === familyKey);
            if (candidates.length) { provenance.mode = 'conversation-family'; provenance.reason = 'known-conversation'; }
            else {
                explicitNpc = npcResolver(units, options.npcIndex);
                const npc = explicitNpc(unit);
                provenance.mode = 'same-explicit-npc';
                provenance.reason = npc ? 'singleton-conversation' : 'singleton-without-verified-npc';
                if (npc) {
                    provenance.npc = npc;
                    // Different sheets have no shared row coordinate system.
                    candidates = units.filter(value => value.role === unit.role && value.sheet === unit.sheet && value.id !== unit.id && dialogue(value)
                        && explicitNpc(value)?.identityKey === npc.identityKey);
                }
            }
        } else {
            provenance.mode = 'same-sheet-translated'; provenance.reason = 'no-known-conversation';
            candidates = units.filter(value => value.role === unit.role && value.sheet === unit.sheet && value.id !== unit.id);
        }
        const rows = [];
        for (const value of candidates || []) {
            const index = worksheetRow(value);
            if (!index || index === targetRow) { provenance.omitted.worksheetCoordinates++; continue; }
            const fields = contextFields(value, options.saved, options.field).filter(item => ['text', 'form'].includes(item.kind) && !State.audioOnly(item.source));
            const applicable = provenance.mode === 'same-sheet-translated' ? fields.filter(item => translationFor(value, item, options.saved)) : fields;
            if (!applicable.length) { if (fields.length) provenance.omitted.untranslated++; continue; }
            const npc = provenance.mode === 'same-explicit-npc' ? explicitNpc(value) : null;
            rows.push({ index, omittedFields: Math.max(0, applicable.length - LIMITS.fields),
                record: { unitId: value.id, sheet: value.sheet, recordId: value.recordId, role: value.role,
                    worksheetRow: index, position: index < targetRow ? 'before' : 'after', ...(npc ? { npc } : {}),
                    fields: limitedFields(applicable, options.field).map(item => ({ fieldId: item.id, name: item.name,
                        ...(item.form ? { form: item.form } : {}), source: item.source, ...translationFor(value, item, options.saved) })) } });
        }
        rows.sort((a, b) => Math.abs(a.index - targetRow) - Math.abs(b.index - targetRow) || a.index - b.index
            || a.record.unitId.localeCompare(b.record.unitId, 'en'));
        provenance.availableEntries = rows.length;
        provenance.omitted.entryLimit = Math.max(0, rows.length - LIMITS.surrounding);
        return { provenance, candidates: rows.slice(0, LIMITS.surrounding) };
    }
    function sizeOf(value) {
        const json = JSON.stringify(value);
        function count(item) {
            return 1 + (Array.isArray(item) ? item.reduce((sum, child) => sum + count(child), 0)
                : item && typeof item === 'object' ? Object.values(item).reduce((sum, child) => sum + count(child), 0) : 0);
        }
        return { characters: json.length, bytes: new TextEncoder().encode(json).length, entries: count(value) };
    }
    function create(options = {}) {
        const { unit, field } = options;
        if (!unit?.fields?.includes(field) || !['text', 'form'].includes(field?.kind) || !clean(field.source).trim()
            || State.audioOnly(field.source)) throw new TypeError('MTL requires an eligible field from the loaded workbook.');
        if (field.source.length > LIMITS.source) throw new RangeError('This source exceeds the MTL field limit.');
        const seen = new Set(), units = (Array.isArray(options.units) ? options.units : []).filter(value => {
            if (!value || !clean(value.id) || !Array.isArray(value.fields) || seen.has(value.id)) return false;
            seen.add(value.id); return true;
        }), sheets = new Set(units.map(value => value.sheet)), loaded = new Map(units.map(value => [value.id, value]));
        const budget = Math.min(LIMITS.context, Number.isSafeInteger(options.contextLimit) ? Math.max(0, options.contextLimit) : LIMITS.context);
        let lookupCount = 0;
        const plan = surroundingPlan(unit, units, options), roles = dialogueRoles(unit, units, options), tone = roles && dialogueTone(unit, units, options, roles),
            profileActors = new Set(roles ? ['speaker', 'listener'].map(name => roles.hints[name].identityKey).filter(key => roles.actors.get(key)?.kind === 'character') : []);
        function sourceRecord(value, reason) {
            const profiled = profileActors.has('character:' + value.recordId) && /^Characters(?:_Gender)?$/.test(value.sheet);
            return { unitId: value.id, sheet: value.sheet, recordId: value.recordId, role: value.role, reason,
                // Participant descriptions have their own bounded, sourced tone
                // projection; avoid repeating the full introduction or treating
                // gameplay/unused traits as personality in a generic reference.
                fields: limitedFields(contextFields(value, options.saved, field).filter(item => !profiled || !['Description', 'Traits Description'].includes(item.name)), field).map(item => ({ fieldId: item.id, name: item.name,
                    ...(item.form ? { form: item.form } : {}), source: item.source })) };
        }
        const notes = clean(unit.developerNotes).trim() ? [{ type: 'developer-notes', text: unit.developerNotes }] : [],
            metadata = [], unavailable = [], references = new Map();
        for (const [name, value] of Object.entries(unit.metadata || {}).slice(0, 32)) {
            if (typeof value !== 'string' || !value.trim()) continue;
            metadata.push({ name, value, evidence: metadataKind(name) });
            for (const id of [value, ...value.split(/[,\r\n]+/u)].map(value => value.trim()).filter(Boolean)) {
                const matches = units.filter(candidate => candidate.recordId === id && candidate.role === unit.role);
                if (matches.length === 1) references.set(matches[0].id, sourceRecord(matches[0], 'exact-metadata-reference'));
                else if (matches.length > 1) unavailable.push({ reference: id, reason: 'ambiguous-workbook-reference' });
                else if (/\//.test(id)) unavailable.push({ reference: id, reason: 'reference-not-loaded' });
            }
        }
        const membership = options.npcIndex?.memberships?.get(unit.id);
        for (const [key, evidence] of membership || []) {
            const group = options.npcIndex.groupByKey?.get(key);
            for (const candidate of group?.npcUnits || []) {
                const related = loaded.get(candidate?.id);
                if (related && related.role === unit.role) references.set(related.id, { ...sourceRecord(related, 'npc-group-related-context'),
                    relationship: copy(evidence), speakerEstablished: false });
            }
        }
        const conversation = options.convoIndex?.memberships?.get(unit.id);
        if (conversation) metadata.push({ name: 'Conversation family', value: conversation.familyKey,
            evidence: 'grouping-only', speakerEstablished: false, ambiguous: !!conversation.ambiguous });
        const skillResolver = options.skillResolver;
        if (skillResolver) for (const cardId of skillResolver.candidates?.(unit) || [])
            for (const related of skillResolver.referencedUnits?.(cardId) || []) if (units.includes(related))
                references.set(related.id, sourceRecord(related, 'verified-related-skill-field'));
        references.delete(unit.id);
        const keywordNames = new Set(State.tokenize(field.source).filter(token => token.kind === 'keyword').map(token => token.identity)),
            keywordMatches = new Map(), keywordLookup = { requested: keywordNames.size, matched: 0, missing: 0, ambiguous: 0, selfReferences: 0 };
        // Keyword identities are resolved only against exact loaded record IDs. No remote catalog is consulted.
        for (const name of keywordNames) {
            const bare = String(name).replace(/^keyword:/, ''), matches = units.filter(candidate => candidate.role === unit.role
                && /keyword/i.test(candidate.sheet) && [name, bare].includes(candidate.recordId));
            if (matches.length === 1) {
                keywordMatches.set(matches[0].id, matches[0]);
            }
            else {
                keywordLookup[matches.length ? 'ambiguous' : 'missing']++;
                unavailable.push({ reference: bare, reason: matches.length ? 'ambiguous-keyword' : 'keyword-not-loaded' });
            }
        }
        keywordLookup.matched = keywordMatches.size;
        keywordLookup.selfReferences = keywordMatches.has(unit.id) ? 1 : 0;
        keywordMatches.delete(unit.id);
        const keywordSources = [...keywordMatches.values()].map(original => ({ original, record: sourceRecord(original, 'exact-keyword-identity') })),
            glossary = [], matchText = [field.source, ...[...references.values()].flatMap(reference => reference.fields.map(item => item.source))].join('\n').toLocaleLowerCase();
        // The caller supplies only a committed shared Dictionary snapshot, never the editable Dictionary or TM.
        const entries = DictionaryScope?.activeEntries(options.dictionary || [], options.scope?.game) || [];
        for (const entry of entries) {
            const find = clean(entry?.find), target = clean(entry?.replace);
            if (entry?.disabled || !find.trim() || !target.trim() || !matchText.includes(find.toLocaleLowerCase())) continue;
            glossary.push({ id: String(entry._id || entry.id || ''), source: find, translation: target,
                ...(clean(entry.tlnote) ? { note: entry.tlnote } : {}), gameScope: DictionaryScope.normalize(entry) });
        }
        for (const [sheet, label] of [['NPCs', 'NPC context'], ['Characters', 'character context']])
            if (!sheets.has(sheet)) unavailable.push({ type: label, reason: 'optional-sheet-not-loaded' });
        const translationCount = keywordSources.reduce((sum, { original, record }) => sum + record.fields.filter(projected => {
            const item = original.fields.find(value => value?.id === projected.fieldId);
            return ['text', 'form'].includes(item?.kind) && !State.audioOnly(item.source) && translationFor(original, item, options.saved);
        }).length, 0), result = { version: 'clienttext-mtl-context-v1', identity: { unitId: unit.id, sheet: unit.sheet, recordId: unit.recordId,
            role: unit.role, fieldId: field.id, fieldName: field.name, kind: field.kind, ...(field.form ? { form: field.form } : {}) },
            notes: [], metadata: [], surrounding: plan.provenance, references: [], keywords: [], glossary: [], unavailable: [],
            ...(roles ? { toneContext: { maxCharactersPerParticipant: LIMITS.toneParticipant, maxCharacters: LIMITS.toneTotal,
                characters: 0, profiles: [], voiceExamples: [], unavailable: [], selection: tone.selection } } : {}),
            keywordLookup, omitted: { notes: notes.length, metadata: metadata.length, references: references.size,
                keywords: keywordSources.length, keywordTranslations: translationCount, glossary: glossary.length, unavailable: unavailable.length,
                ...(roles ? { roleHints: 1, toneProfiles: tone.profiles.length, voiceExamples: tone.voiceExamples.length, toneUnavailable: tone.unavailable.length } : {}) },
            evidenceRules: ['Character Filter constrains the listener; it does not identify the speaker.',
                'NPC and conversation groups are related context and do not establish a speaker without explicit workbook metadata.',
                ...(roles ? ['Role hints label tentative conventions separately from explicit workbook role metadata.',
                    'Tone introductions and examples are sourced voice evidence for their identified participant, not complete biographies.'] : [])] };
        function updateSelection() {
            if (result.toneContext) {
                result.toneContext.characters = [...result.toneContext.profiles, ...result.toneContext.voiceExamples].reduce((sum, item) => sum + toneCharacters(item), 0);
                result.toneContext.selection.omittedVoiceExamples.contextBudget = tone.voiceExamples.length - result.toneContext.voiceExamples.length;
            }
            const direct = new Set([...result.references, ...result.keywords].map(value => value.unitId));
            result.surrounding.selectedEntries = result.surrounding.entries.length;
            result.surrounding.omitted.existingReference = plan.candidates.filter(value => direct.has(value.record.unitId)).length;
            result.surrounding.omitted.contextBudget = plan.candidates.length - result.surrounding.selectedEntries - result.surrounding.omitted.existingReference;
            result.surrounding.truncated = Object.entries(result.surrounding.omitted).some(([key, count]) => !['untranslated', 'existingReference'].includes(key) && count > 0);
        }
        updateSelection();
        function fitsContext() {
            const size = sizeOf(result);
            return size.characters <= budget && size.bytes <= LIMITS.contextBytes && size.entries <= LIMITS.contextEntries;
        }
        function add(array, item) {
            array.push(copy(item)); updateSelection();
            if (fitsContext()) return true;
            array.pop(); updateSelection(); return false;
        }
        // Omission counters are reserved before packing and only decrease, so
        // diagnostics cannot disappear or grow past a completely filled budget.
        for (const name of ['notes', 'metadata']) for (const item of name === 'notes' ? notes : metadata)
            if (add(result[name], item)) result.omitted[name]--;
        const included = new Set([unit.id]), keywordRecords = new Map();
        for (const related of references.values()) {
            if (result.references.length >= 12) break;
            if (add(result.references, related)) { included.add(related.unitId); result.omitted.references--; }
        }
        for (const { original, record: source } of keywordSources) {
            if (!included.has(original.id) && add(result.keywords, source)) included.add(original.id);
            const record = [...result.keywords, ...result.references].find(value => value.unitId === original.id);
            if (record) { keywordRecords.set(original.id, { original, record }); result.omitted.keywords--; }
        }
        // Keep every retained English keyword record before spending the shared
        // budget on whole trusted translations. A deduplicated metadata reference
        // receives the same translation context without repeating the unit.
        for (const { original, record } of keywordRecords.values()) {
            const fields = new Map(original.fields.filter(Boolean).map(value => [value.id, value]));
            for (let index = 0; index < record.fields.length; index++) {
                const before = record.fields[index], field = fields.get(before.fieldId);
                if (!field || !['text', 'form'].includes(field.kind) || State.audioOnly(field.source)) continue;
                const translation = translationFor(original, field, options.saved);
                if (!translation) continue;
                record.fields[index] = { ...before, ...translation };
                if (!fitsContext()) record.fields[index] = before;
                else result.omitted.keywordTranslations--;
            }
        }
        for (const item of glossary) {
            if (result.glossary.length >= LIMITS.glossary) break;
            if (add(result.glossary, item)) result.omitted.glossary--;
        }
        for (const item of unavailable) if (add(result.unavailable, item)) result.omitted.unavailable--;
        if (roles) {
            result.roleHints = copy(roles.hints);
            if (!fitsContext()) delete result.roleHints;
            else {
                result.omitted.roleHints = 0;
                for (const [name, counter] of [['profiles', 'toneProfiles'], ['voiceExamples', 'voiceExamples'], ['unavailable', 'toneUnavailable']])
                    for (const item of tone[name]) if (add(result.toneContext[name], item)) result.omitted[counter]--;
            }
        }
        const selected = [];
        // Optional nearby rows receive only the budget left by direct workbook
        // evidence, translated keywords, glossary and explicit lookup diagnostics.
        for (const candidate of plan.candidates) {
            if (included.has(candidate.record.unitId)) continue;
            result.surrounding.omitted.fieldLimit += candidate.omittedFields;
            if (add(result.surrounding.entries, candidate.record)) { included.add(candidate.record.unitId); selected.push(candidate); }
            else result.surrounding.omitted.fieldLimit -= candidate.omittedFields;
        }
        result.surrounding.entries = selected.sort((a, b) => a.index - b.index).map(value => copy(value.record));
        updateSelection();
        const size = sizeOf(result);
        if (size.characters > LIMITS.context || size.bytes > LIMITS.contextBytes || size.entries > LIMITS.contextEntries)
            throw new RangeError('The prepared MTL context exceeds the request limit.');
        const initial = copy(result), contextHash = State.hash(initial);
        let remaining = Math.max(0, budget - size.characters), remainingBytes = LIMITS.contextBytes - size.bytes,
            remainingEntries = LIMITS.contextEntries - size.entries;
        return { initial, contextHash, glossaryHash: State.hash(initial.glossary),
            lookup(input) {
                if (lookupCount >= LIMITS.lookups) throw new RangeError('MTL context lookup limit reached.');
                lookupCount++;
                if (!input || typeof input.recordId !== 'string' || !input.recordId || input.recordId.length > 1024
                    || input.sheet !== undefined && typeof input.sheet !== 'string'
                    || Object.keys(input).some(key => !['recordId', 'sheet'].includes(key))) throw new TypeError('Invalid workbook context lookup.');
                const matches = units.filter(candidate => candidate.id !== unit.id && candidate.role === unit.role && candidate.recordId === input.recordId
                    && (input.sheet === undefined || candidate.sheet === input.sheet));
                const output = [];
                for (const match of matches.slice(0, LIMITS.results)) {
                    const record = sourceRecord(match, 'requested-exact-workbook-reference'), size = sizeOf(record);
                    if (size.characters + 1 > remaining || size.bytes + 1 > remainingBytes || size.entries > remainingEntries) continue;
                    output.push(copy(record)); remaining -= size.characters + 1; remainingBytes -= size.bytes + 1; remainingEntries -= size.entries;
                }
                return { results: output, unavailable: !matches.length, ambiguous: matches.length > 1,
                    limited: output.length < matches.length, lookupsRemaining: LIMITS.lookups - lookupCount };
            }, get lookupsUsed() { return lookupCount; }, get remainingCharacters() { return remaining; } };
    }
    return { LIMITS, create, build: options => create(options).initial };
});
