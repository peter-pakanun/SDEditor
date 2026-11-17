/* Export reports retain allowlisted failure details, never raw error payloads, workbook text or credentials. */
(function (root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.ClientTextExportProgress = api;
})(typeof window === 'object' ? window : globalThis, function (root) {
    'use strict';
    const now = () => root.performance?.now?.() ?? Date.now();
    const duration = ms => (Math.max(0, ms) / 1000).toFixed(2) + ' s';
    const aborted = () => Object.assign(new Error('Export stopped.'), { name: 'AbortError', stale: true });
    const operations = {
        'workspace-metadata': 'Workspace metadata', 'original-preparation': 'Original workbook preparation',
        'saved-records': 'Saved records', 'saved-originals': 'Original records for saved values', 'workbook-original': 'Original workbook package',
        'workbook-bytes': 'Reading original workbook bytes'
    };
    const failureCodes = new Set(['CLIENTTEXT_NOT_READY', 'CLIENTTEXT_ORIGINAL_UNIT_MISSING', 'CLIENTTEXT_ORIGINAL_ASSET_MISSING', 'CLIENTTEXT_ORIGINAL_FILE_UNAVAILABLE']);
    const sdFailures = {
        SD_EXPORT_INCOMPLETE_TRANSLATIONS: 'Included files have incomplete StatDescription translations. Complete every entry and match the English entry count before exporting. Affected files are listed in the report below.',
        SD_EXPORT_NO_SAVED_FILES: 'There are no saved files to export.',
        SD_EXPORT_DRAFT_FAILED: 'Export could not preserve the current editor draft. Keep this tab open and resolve the editor error before retrying.',
        SD_EXPORT_PENDING_SAVES: 'Pending local saves did not complete. Resolve the local save error before retrying export.',
        SD_BASELINE_UNAVAILABLE: 'The matching original ZIP is unavailable. Reconnect or reimport that original ZIP before retrying; saved translations are preserved.',
        SD_TRANSLATION_INVALID: 'A StatDescription translation is incomplete. Complete every entry and match the English entry count before exporting.',
    };
    // Keep arbitrary exception messages, URLs and stack payloads out of shared reports.
    // Code locations and explicitly supplied validation facts still identify the failure.
    function sdFailureDetails(error) {
        const integer = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
        const files = (Array.isArray(error?.invalidFiles) ? error.invalidFiles : []).slice(0, 20)
            .filter(file => typeof file?.filepath === 'string' && file.filepath.length <= 1024
                && !/[\u0000-\u001f?#:]/.test(file.filepath) && !file.filepath.includes('\\')
                && !file.filepath.split('/').some(part => !part || part === '.' || part === '..'))
            .map(file => ({ filepath: file.filepath, expectedCount: integer(file.expectedCount), actualCount: integer(file.actualCount),
                blankEntryCount: Array.isArray(file.blankEntries) ? file.blankEntries.length : 0,
                blankEntries: (Array.isArray(file.blankEntries) ? file.blankEntries : []).filter(value => integer(value) !== null && value > 0).slice(0, 20) }));
        const locations = [...new Set(String(error?.stack || '').split('\n').slice(1)
            .flatMap(line => [...line.matchAll(/\b([A-Za-z][A-Za-z0-9_-]*\.(?:js|cjs)):(\d+):(\d+)\b/g)].map(match => match[0])))].slice(0, 8);
        return { files, invalidFileCount: integer(error?.invalidFiles?.length), locations };
    }
    function failureDetails(failure) {
        if (!failure) return '';
        return ['Failure code: ' + failure.code, 'Error type: ' + failure.name, 'Failure step: ' + failure.step,
            ...(failure.invalidFileCount !== null && failure.invalidFileCount !== undefined
                ? ['Incomplete files: ' + failure.invalidFileCount + ' (' + failure.files.length + ' listed)'] : []),
            ...(failure.files || []).map(file => file.filepath + ': English entries ' + file.expectedCount
                + ', translation entries ' + file.actualCount + (file.blankEntries.length ? '; blank/missing entries ' + file.blankEntries.join(', ')
                    + (file.blankEntryCount > file.blankEntries.length ? ' (first ' + file.blankEntries.length + ' of ' + file.blankEntryCount + ')' : '') : '')),
            ...(failure.locations || []).map(location => 'Code location: ' + location)].join('\n');
    }
    const errorNames = new Set(['Error', 'TypeError', 'SyntaxError', 'DataError', 'DataCloneError', 'InvalidStateError', 'NotFoundError', 'NotReadableError', 'QuotaExceededError', 'TransactionInactiveError', 'UnknownError', 'VersionError', 'ReadOnlyError', 'ConstraintError', 'NetworkError']);
    const collectionText = state => state === 'accepted'
        ? 'Collection accepted by the server. Local Abort cannot undo collection or ending. An interrupted download can retry using the retained receipt.'
        : state === 'uncertain' ? 'Collection outcome unknown: the server may have accepted it or ended the team. Retry uses the same retained request ID.'
        : 'No collection request sent by this run.';
    class Run {
        constructor(publish, current, label) {
            this.publish = publish; this.current = current; this.controller = new AbortController();
            this.state = { label, status: 'running', startedAt: now(), elapsed: 0, rows: [], collection: 'none', downloadStarted: false };
            this.timer = setInterval(() => this.tick(), 100);
        }
        get signal() { return this.controller.signal; }
        check() { if (this.signal.aborted || !this.current()) throw aborted(); }
        tick() {
            if (this.state.status === 'running' && !this.signal.aborted && !this.current()) { this.abort(); return; }
            this.state.elapsed = now() - this.state.startedAt;
            const row = this.state.rows.at(-1);
            if (row?.status === 'running') row.elapsed = now() - row.startedAt;
            this.publish({ ...this.state, rows: this.state.rows.map(row => ({ ...row })) });
        }
        phase(label, operation) {
            this.check(); const previous = this.state.rows.at(-1);
            const detail = operations[operation] || '';
            if (previous?.label === label && previous.status === 'running' && (previous.detail || '') === detail) return;
            this.endPhase('done'); this.state.rows.push({ label, ...(detail ? { detail } : {}), startedAt: now(), elapsed: 0, status: 'running' }); this.tick();
        }
        endPhase(status) {
            const row = this.state.rows.at(-1);
            if (row?.status === 'running') { row.elapsed = now() - row.startedAt; row.status = status; }
        }
        async step(label, callback, operation) { this.phase(label, operation); const result = await this.wait(callback()); this.check(); return result; }
        fail(error) {
            if (this.signal.aborted || !this.current() || this.state.failure) return;
            const row = this.state.rows.at(-1), originalRead = ['Workspace metadata', 'Original workbook preparation', 'Original records for saved values', 'Original workbook package', 'Reading original workbook bytes'].includes(row?.detail);
            this.state.failure = {
                code: failureCodes.has(error?.code) ? error.code : 'CLIENTTEXT_EXPORT_FAILED',
                name: errorNames.has(error?.name) ? error.name : 'Error',
                step: row?.detail || row?.label || 'Export setup',
                message: this.state.localOnly
                    ? 'Local workbook export failed. Keep this tab open if a draft checkpoint failed. Download a recovery backup or the current draft, then reopen the same local workspace and retry. Share Copy timings and the workspace error details if it still fails.'
                    : originalRead
                    ? 'Export could not read its original workbook data. Reopen the same content group and retry. If it fails again, share Copy timings and the workspace error details.'
                    : 'Share Copy timings and the workspace error details if retrying the export fails.'
            };
            if (this.state.contentMode === 'statdescription') {
                const code = Object.hasOwn(sdFailures, error?.code) ? error.code : 'SD_EXPORT_FAILED';
                this.state.failure = { code,
                    name: this.state.failure.name, step: this.state.failure.step,
                    message: sdFailures[code] || 'StatDescription export failed. Share Copy timings, including the failure details and code locations below, to diagnose this run.',
                    ...sdFailureDetails(error) };
            }
            this.tick();
        }
        async delay(ms) {
            let timer;
            const cancel = () => clearTimeout(timer);
            this.signal.addEventListener('abort', cancel, { once: true });
            try { await this.wait(new Promise(resolve => { timer = setTimeout(resolve, ms); })); }
            finally { clearTimeout(timer); this.signal.removeEventListener('abort', cancel); }
        }
        // Storage reads may finish after Abort. Ignore their results and remove the listener in either outcome.
        wait(promise) {
            if (this.signal.aborted || !this.current()) { Promise.resolve(promise).catch(() => {}); return Promise.reject(aborted()); }
            return new Promise((resolve, reject) => {
                const abort = () => { cleanup(); reject(aborted()); };
                const cleanup = () => this.signal.removeEventListener('abort', abort);
                this.signal.addEventListener('abort', abort, { once: true });
                Promise.resolve(promise).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
            });
        }
        accepted() { this.state.collection = 'accepted'; this.tick(); }
        abort() { if (this.state.status !== 'running') return; this.state.stopping = true; this.controller.abort(); this.worker?.dispose?.(); this.tick(); }
        finish(status) {
            clearInterval(this.timer); this.timer = null; this.worker?.dispose?.(); this.worker = null;
            this.endPhase(status === 'done' ? 'done' : status); this.state.status = status; this.tick();
        }
    }
    const mixin = {
        data: () => ({ ctExportTiming: null, ctExportCopyMessage: '', ctExportCopyBusy: false }),
        computed: {
            ctExportActive() { return this.ctExportTiming?.status === 'running'; },
            ctExportCollectionText() { return collectionText(this.ctExportTiming?.collection); },
            ctExportFailureDetails() { return failureDetails(this.ctExportTiming?.failure); },
            ctExportLogText() {
                const state = this.ctExportTiming;
                if (!state) return '';
                return [(state.contentMode === 'statdescription' ? 'StatDescription' : 'ClientText') + ' export timing', state.label, 'Status: ' + state.status, 'Total elapsed: ' + duration(state.elapsed),
                    ...(state.sdContext ? [state.sdContext.game ? 'Game: ' + state.sdContext.game : '',
                        state.sdContext.language ? 'Language: ' + state.sdContext.language : '',
                        state.sdContext.sourceHash ? 'Source identity: ' + state.sdContext.sourceHash : ''].filter(Boolean) : []),
                    ...(state.localOnly ? ['Workbook storage: local IndexedDB; checkpoint failures remain in the open tab. Browser storage is not a backup.'] : []),
                    collectionText(state.collection), state.downloadStarted ? 'Browser download initiated; completion is not observable.' : 'Download not initiated.',
                    ...(state.failure ? [failureDetails(state.failure), 'Next action: ' + state.failure.message] : []),
                    'Request durations include network and server wall time; they are not server CPU measurements.',
                    ...state.rows.map(row => `${row.label}${row.detail ? ' [' + row.detail + ']' : ''}: ${duration(row.elapsed)} (${row.status})`)].join('\n');
            },
        },
        methods: {
            ctExportDuration: duration,
            ctBeginExport(label, { contentMode = 'clienttext', current: guard, show = true, managedOperation } = {}) {
                if (this._ctExportRun || this.ctBusy || this.managedVersionBusy && (!managedOperation || managedOperation !== this._managedOperation)) return null;
                const key = this.managedCatalogScope, epoch = this._ctEpoch || 0, client = this._cloud;
                const current = () => key === this.managedCatalogScope && epoch === (this._ctEpoch || 0) && client === this._cloud && (!guard || guard());
                const run = new Run(state => {
                    if (this._ctExportRun !== run) return;
                    const log = this.$refs?.ctExportPhases, added = state.rows.length !== this.ctExportTiming?.rows.length;
                    const follow = !log || log.scrollHeight - log.scrollTop - log.clientHeight < 8;
                    this.ctExportTiming = state;
                    if (added && follow) this.$nextTick?.(() => { if (log) log.scrollTop = log.scrollHeight; });
                }, current, label);
                run.state.contentMode = contentMode;
                run.state.localOnly = contentMode === 'clienttext' && !!this.ctOfflineTest;
                this._ctExportRun = this._ctExportReportId = run; this.ctBusy = true; this.ctError = '';
                this.ctExportCopyMessage = ''; this.ctExportCopyBusy = false; this._ctExportCopyRequest = null; run.tick();
                if (show) this.ctShowExport(); return run;
            },
            ctShowExport() {
                const show = () => { const dialog = this.$refs?.ctExportDialog; if (this.ctExportTiming && dialog && !dialog.open) dialog.showModal(); };
                this.$nextTick ? this.$nextTick(show) : show();
            },
            ctAbortExport() {
                const run = this._ctExportRun;
                if (run) { run.focusClose = root.document?.activeElement?.matches?.('[data-ct-export-abort]'); run.abort(); }
            },
            ctFinishExport(run, status) {
                const focusClose = run.focusClose || root.document?.activeElement?.matches?.('[data-ct-export-abort]');
                run.finish(status);
                if (this._ctExportRun !== run) return;
                this._ctExportRun = null;
                if (run.current()) { this.ctBusy = false; this.ctProgress = null; }
                if (focusClose) this.$nextTick?.(() => { const dialog = this.$refs?.ctExportDialog; if (dialog?.open) dialog.querySelector('[data-ct-export-close]')?.focus(); });
            },
            ctCloseExport() { if (!this.ctExportActive) this.$refs?.ctExportDialog?.close(); },
            ctDownloadExportLog() {
                if (!this.ctExportTiming || this.ctExportActive) return;
                try {
                    const mode = this.ctExportTiming.contentMode === 'statdescription' ? 'StatDescription' : 'ClientText';
                    root.saveAs(new Blob([this.ctExportLogText], { type: 'text/plain;charset=utf-8' }), mode + '_Export_Report.txt');
                } catch (_) { this.ctExportCopyMessage = 'Could not download the report. Use Copy timings instead.'; }
            },
            async ctCopyExportLog() {
                if (this.ctExportCopyBusy) return;
                const text = this.ctExportLogText;
                const report = this._ctExportReportId, request = this._ctExportCopyRequest = {};
                const current = () => report === this._ctExportReportId && request === this._ctExportCopyRequest;
                this.ctExportCopyBusy = true;
                try { await root.navigator.clipboard.writeText(text); if (current()) this.ctExportCopyMessage = 'Timings copied.'; }
                catch (_) {
                    if (!current()) return;
                    const log = this.$refs?.ctExportLog; if (log?.parentElement) log.parentElement.open = true;
                    log?.focus(); log?.select(); this.ctExportCopyMessage = 'Press Ctrl+C to copy the selected timings.';
                } finally { if (current()) { this.ctExportCopyBusy = false; this._ctExportCopyRequest = null; } }
            },
        },
    };
    return { Run, mixin, duration };
});
