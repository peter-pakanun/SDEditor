/* MTL candidates never become authored ClientText values without explicit review. */
(function (root, factory) {
    const state = root.ClientTextState || (typeof require === 'function' ? require('./clientTextState.js') : null);
    const api = factory(state);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.ClientTextMtlState = api;
})(typeof globalThis === 'object' ? globalThis : self, function (S) {
    'use strict';
    const MAX_TEXT = 32768, statuses = Object.freeze(['pending', 'accepted', 'dismissed', 'superseded']);
    const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
    const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
    const rawSourceHash = source => S.hash(['sdeditor:mtl:source:v1', String(source ?? '')]);
    const eligible = field => !!field && ['text', 'form'].includes(field.kind)
        && !!S.canonicalSource(field.source).trim() && !S.audioOnly(field.source);
    const changed = message => Object.assign(new Error(message || 'This MTL candidate changed. Review it again.'), { code: 'MTL_CANDIDATE_CHANGED' });
    function normalizeCandidate(input) {
        if (!input || typeof input !== 'object') throw new TypeError('Invalid MTL candidate.');
        for (const name of ['id', 'requestId', 'unitId', 'fieldId', 'role', 'parserVersion']) {
            if (typeof input[name] !== 'string' || !input[name] || input[name].length > (name === 'unitId' || name === 'fieldId' ? 4096 : 256))
                throw new TypeError('MTL candidate requires ' + name + '.');
        }
        if (!['normal', 'gender'].includes(input.role) || !S.PARSER_VERSIONS.includes(input.parserVersion)
            || !['assetHash', 'sourceHash', 'rawSourceHash', 'baseTargetHash'].every(name => hex(input[name])))
            throw new TypeError('Invalid MTL source identity.');
        if (typeof input.generatedText !== 'string' || !input.generatedText.trim() || input.generatedText.length > MAX_TEXT)
            throw new TypeError('Invalid MTL translation.');
        if (!Number.isSafeInteger(input.revision) || input.revision < 1 || !statuses.includes(input.status)
            || !Number.isFinite(input.createdAt) || input.createdAt < 0) throw new TypeError('Invalid MTL candidate revision.');
        const result = {};
        // Keep a small provenance record, never a source catalog, provider response or credentials.
        for (const name of ['id', 'requestId', 'unitId', 'fieldId', 'role', 'assetHash', 'parserVersion', 'sourceHash', 'rawSourceHash',
            'generatedText', 'revision', 'status', 'baseTargetHash', 'createdAt', 'provider', 'model', 'effort', 'promptVersion', 'schemaVersion',
            'contextHash', 'glossaryHash', 'actorId', 'updatedAt', 'resolvedAt', 'resolvedBy', 'acceptedAt', 'acceptedBy', 'acceptanceJobId', 'localDisposition', 'reviewedTextHash']) {
            if (own(input, name)) result[name] = S.copy(input[name]);
        }
        for (const name of ['provider', 'model', 'effort', 'promptVersion', 'schemaVersion', 'actorId', 'resolvedBy', 'acceptedBy', 'acceptanceJobId'])
            if (own(result, name) && (typeof result[name] !== 'string' || result[name].length > 256)) throw new TypeError('Invalid MTL provenance.');
        if(own(input,'inferenceSettings')){
            const value=input.inferenceSettings,efforts=value?.model==='gpt-6-luna'?['none','low','medium','high','xhigh','max']:value?.model==='gpt-6.1-sol'?['low','medium','high','xhigh','max']:[];
            if(!value||value.version!=='mtl-inference-settings-v1'||Object.keys(value).some(key=>!['version','model','effort'].includes(key))
                ||!efforts.includes(value.effort)||input.model!==value.model||input.effort!==value.effort)throw new TypeError('Invalid MTL inference settings.');
            result.inferenceSettings={version:value.version,model:value.model,effort:value.effort};
        }
        return result;
    }
    const immutable = candidate => S.hash(Object.fromEntries(['id', 'requestId', 'unitId', 'fieldId', 'role', 'assetHash', 'parserVersion',
        'sourceHash', 'rawSourceHash', 'generatedText', 'baseTargetHash', 'createdAt', 'provider', 'model', 'effort', 'promptVersion', 'schemaVersion',
        'contextHash', 'glossaryHash', 'actorId', 'inferenceSettings'].filter(name => own(candidate, name)).map(name => [name, candidate[name]])));
    function mergeCandidate(before, input) {
        const next = normalizeCandidate(input);
        if (!before) return next;
        if (before.id !== next.id || immutable(before) !== immutable(next)) throw changed('An MTL candidate ID was reused for different content.');
        if (next.revision < before.revision) return S.copy(before);
        // A pending local save/dismissal must not be undone by an old snapshot.
        if (next.revision === before.revision && before.localDisposition) return S.copy(before);
        if (next.revision === before.revision && before.status !== next.status) throw changed();
        return next;
    }
    function generationUpdates(candidates, next) {
        if (next.status !== 'pending') return [next];
        const pending = [...candidates.filter(candidate => candidate.id !== next.id && candidate.status === 'pending'
            && candidate.unitId === next.unitId && candidate.fieldId === next.fieldId), next];
        pending.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
        return pending.map((candidate, index) => index ? { ...candidate, status: 'superseded', localDisposition: true } : candidate);
    }
    function applicable(candidate, field, descriptor) {
        if (!candidate || candidate.status !== 'pending' || !eligible(field) || candidate.fieldId !== field.id
            || candidate.sourceHash !== S.sourceHash(field.source) || candidate.rawSourceHash !== rawSourceHash(field.source)) return false;
        if (!descriptor || candidate.role !== descriptor.role || candidate.assetHash !== (descriptor.assetHash || descriptor.hash)
            || candidate.parserVersion !== descriptor.parserVersion || descriptor.unitId && candidate.unitId !== descriptor.unitId) return false;
        return true;
    }
    function validate(field, text) {
        const issues = [];
        if (!eligible(field)) issues.push({ level: 'error', code: 'mtl-ineligible', message: 'This field cannot receive an MTL translation.' });
        if (typeof text !== 'string' || !text.trim()) issues.push({ level: 'error', code: 'mtl-empty', message: 'MTL returned no translation.' });
        else if (text.length > MAX_TEXT) issues.push({ level: 'error', code: 'mtl-too-long', message: 'The MTL translation exceeds the field limit.' });
        if (field && typeof text === 'string' && text.length <= MAX_TEXT) {
            issues.push(...S.diagnose(field, text));
            const counts = values => S.stableStringify(values.reduce((result, value) => { result[value] = (result[value] || 0) + 1; return result; }, {}));
            // Ordinary diagnostics allow locale-specific variable decoration.
            // Generated text has the stricter requirement to retain raw control
            // spelling and distinguish real line breaks from literal backslash-n.
            const source = String(field.source ?? ''), variables = value => S.tokenize(value).filter(token => token.kind === 'variable').map(token => token.full);
            if (counts(variables(source)) !== counts(variables(text))) issues.push({ level: 'error', code: 'mtl-variable-spelling', message: 'MTL must preserve the exact variable tokens.' });
            const unknown = value => S.tokenize(value).filter(token => token.kind === 'stage-direction').map(token => token.full);
            if (counts(unknown(source)) !== counts(unknown(text))) issues.push({ level: 'error', code: 'mtl-control-spelling', message: 'MTL must preserve upstream control syntax.' });
            const breaks = value => value.match(/\\n|\r\n|\r|\n/g) || [];
            if (S.stableStringify(breaks(source)) !== S.stableStringify(breaks(text))) issues.push({ level: 'error', code: 'mtl-line-breaks', message: 'MTL must preserve line-break and literal backslash-n controls.' });
            if ((source.match(/@/g) || []).length !== (text.match(/@/g) || []).length)
                issues.push({ level: 'error', code: 'mtl-at-control', message: 'MTL must preserve @ controls.' });
        }
        const errors = issues.filter(issue => issue.level === 'error'), warnings = issues.filter(issue => issue.level === 'warning');
        return { valid: errors.length === 0, issues, errors, warnings };
    }
    function acceptance(candidate, text) {
        const value = normalizeCandidate(candidate);
        if (value.status !== 'pending') throw changed();
        // Once explicitly accepted, ordinary human editing keeps ClientText's
        // blank-field and manual-token semantics. The initial Accept action and
        // generation boundary use validate(); provenance binds the exact Save.
        if (typeof text !== 'string' || text.length > MAX_TEXT) throw new TypeError('Invalid reviewed MTL translation.');
        return { candidateId: value.id, candidateRevision: value.revision, fieldId: value.fieldId,
            rawSourceHash: value.rawSourceHash, reviewedTextHash: S.hash(text) };
    }
    function validateAcceptances(candidates, unit, acceptances, values, descriptor) {
        if (acceptances === undefined || acceptances === null) return [];
        if (!Array.isArray(acceptances) || acceptances.length > unit.fields.length) throw new TypeError('Invalid MTL acceptances.');
        const used = new Set();
        return acceptances.map(claim => {
            if (!claim || typeof claim.candidateId !== 'string' || used.has(claim.fieldId)) throw new TypeError('Duplicate or invalid MTL acceptance.');
            used.add(claim.fieldId);
            const candidate = candidates.find(value => value.id === claim.candidateId), field = unit.fields.find(value => value.id === claim.fieldId);
            if (!candidate || candidate.unitId !== unit.id || candidate.revision !== claim.candidateRevision
                || !applicable(candidate, field, { ...descriptor, role: unit.role, unitId: unit.id })
                || claim.rawSourceHash !== candidate.rawSourceHash || claim.reviewedTextHash !== S.hash(values?.[claim.fieldId])) throw changed();
            return { ...acceptance(candidate, values[claim.fieldId]), candidate: S.copy(candidate), unitId: unit.id };
        });
    }
    return { MAX_TEXT, statuses, rawSourceHash, eligible, normalizeCandidate, immutable, mergeCandidate, generationUpdates, applicable, validate, acceptance,
        validateAcceptances, changed };
});
