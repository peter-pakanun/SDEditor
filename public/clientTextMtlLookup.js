/* Shared inert lookup wire contract. Keep the API vendor copy byte-identical. */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api; else root.ClientTextMtlLookup = api;
})(typeof globalThis === 'object' ? globalThis : self, function () {
    'use strict';
    const VERSION = 'clienttext-mtl-lookup-v1';
    const LIMITS = Object.freeze({ rounds: 2, queries: 2, results: 4, fields: 2, fieldCharacters: 2048,
        roundBytes: 8192, totalBytes: 16384, totalCharacters: 8000, contextBytes: 56 * 1024,
        contextCharacters: 24000, waitMs: 15000, leaseMs: 15000, modelCalls: 3,
        outputTokensPerCall: 8192, totalOutputTokens: 24576, totalInputTokenBound: 196608 });
    const bad = () => { throw new TypeError('Invalid bounded MTL lookup.'); };
    const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
    function keys(value, allowed, required = allowed) {
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))
            || required.some(key => !own(value, key))) bad();
    }
    function text(value, max = 1024) {
        if (typeof value !== 'string' || !value || value.length > max || /[\u0000-\u001f]/.test(value) || !value.isWellFormed()) bad();
        return value;
    }
    const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
    function characters(value) {
        if (typeof value === 'string') return value.length;
        if (Array.isArray(value)) return value.reduce((n, item) => n + characters(item), 0);
        if (value && typeof value === 'object') return Object.entries(value).reduce((n, [key, item]) => n + key.length + characters(item), 0);
        return 0;
    }
    function config(value) {
        keys(value, ['version', 'snapshotHash']);
        if (value.version !== VERSION || !/^[a-f0-9]{64}$/.test(value.snapshotHash)) bad();
        return { version: VERSION, snapshotHash: value.snapshotHash };
    }
    function queries(value) {
        if (!Array.isArray(value) || !value.length || value.length > LIMITS.queries) bad();
        const seen = new Set();
        return value.map(query => {
            keys(query, ['kind', 'recordId', 'sheet']);
            if (!['keyword', 'record'].includes(query.kind)) bad();
            const result = { kind: query.kind, recordId: text(query.recordId), sheet: text(query.sheet, 128) };
            if (result.kind === 'keyword' && !/^KeywordPopups(?:_Gender)?$/.test(result.sheet)) bad();
            const key = JSON.stringify([result.sheet, result.recordId]); if (seen.has(key)) bad(); seen.add(key); return result;
        });
    }
    function binding(input, scope) {
        return { snapshotHash: config(input.lookup).snapshotHash, unitId: input.unitId, fieldId: input.fieldId || input.field.id,
            rawSourceHash: input.rawSourceHash, role: input.role, assetHash: input.assetHash, parserVersion: input.parserVersion,
            language: scope.language, game: scope.game, branchId: scope.branchId || 'default',
            groupId: scope.local || String(scope.groupId).startsWith('local:') ? null : scope.groupId };
    }
    function results(value, requested, role) {
        if (!Array.isArray(value) || value.length !== requested.length || bytes(value) > LIMITS.roundBytes) bad();
        let count = 0;
        const output = value.map((result, index) => {
            keys(result, ['queryIndex', 'unavailable', 'truncated', 'records']);
            if (result.queryIndex !== index || typeof result.unavailable !== 'boolean' || typeof result.truncated !== 'boolean'
                || !Array.isArray(result.records) || result.records.length > LIMITS.results || result.unavailable && result.records.length) bad();
            const query = requested[index];
            const records = result.records.map(record => {
                keys(record, ['unitId', 'role', 'sheet', 'recordId', 'fields']);
                if (++count > LIMITS.results || record.role !== role || record.sheet !== query.sheet || record.recordId !== query.recordId) bad();
                text(record.unitId, 4096); text(record.recordId); text(record.sheet, 128);
                if (record.unitId !== JSON.stringify([role, record.sheet, record.recordId])) bad();
                if (!Array.isArray(record.fields) || !record.fields.length || record.fields.length > LIMITS.fields) bad();
                const fields = record.fields.map(field => {
                    keys(field, ['fieldId', 'name', 'source', 'translation', 'translationOrigin'], ['fieldId', 'name', 'source']);
                    text(field.fieldId, 4096); text(field.name, 128);
                    if (typeof field.source !== 'string' || !field.source.trim() || field.source.length > LIMITS.fieldCharacters
                        || field.source.includes('\u0000') || !field.source.isWellFormed()) bad();
                    if (own(field, 'translation') !== own(field, 'translationOrigin')) bad();
                    if (own(field, 'translation') && (typeof field.translation !== 'string' || !field.translation.trim()
                        || field.translation.length > LIMITS.fieldCharacters || field.translation.includes('\u0000') || !field.translation.isWellFormed()
                        || !['saved', 'original-workbook'].includes(field.translationOrigin))) bad();
                    return { ...field };
                });
                return { unitId: record.unitId, role, sheet: record.sheet, recordId: record.recordId, fields };
            });
            return { queryIndex: index, unavailable: result.unavailable, truncated: result.truncated, records };
        });
        if (characters(output) > LIMITS.totalCharacters) bad();
        return output;
    }
    return { VERSION, LIMITS, keys, bytes, characters, config, queries, binding, results };
});
