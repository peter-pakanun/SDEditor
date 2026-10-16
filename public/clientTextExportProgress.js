/* Explicit export timings contain phase names and durations only, never workbook text or credentials. */
(function (root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.ClientTextExportProgress = api;
})(typeof window === 'object' ? window : globalThis, function (root) {
    'use strict';
    const now = () => root.performance?.now?.() ?? Date.now();
    const duration = ms => (Math.max(0, ms) / 1000).toFixed(2) + ' s';
    const aborted = () => Object.assign(new Error('ClientText export stopped.'), { name: 'AbortError' });
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
            this.state.elapsed = now() - this.state.startedAt;
            const row = this.state.rows.at(-1);
            if (row?.status === 'running') row.elapsed = now() - row.startedAt;
            this.publish({ ...this.state, rows: this.state.rows.map(row => ({ ...row })) });
        }
        phase(label) {
            this.check(); const previous = this.state.rows.at(-1);
            if (previous?.label === label && previous.status === 'running') return;
            this.endPhase('done'); this.state.rows.push({ label, startedAt: now(), elapsed: 0, status: 'running' }); this.tick();
        }
        endPhase(status) {
            const row = this.state.rows.at(-1);
            if (row?.status === 'running') { row.elapsed = now() - row.startedAt; row.status = status; }
        }
        async step(label, callback) { this.phase(label); const result = await this.wait(callback()); this.check(); return result; }
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
            ctExportLogText() {
                const state = this.ctExportTiming;
                if (!state) return '';
                return ['ClientText export timing', state.label, 'Status: ' + state.status, 'Total elapsed: ' + duration(state.elapsed),
                    collectionText(state.collection), state.downloadStarted ? 'Browser download initiated; completion is not observable.' : 'Download not initiated.',
                    'Request durations include network and server wall time; they are not server CPU measurements.',
                    ...state.rows.map(row => `${row.label}: ${duration(row.elapsed)} (${row.status})`)].join('\n');
            },
        },
        methods: {
            ctExportDuration: duration,
            ctBeginExport(label) {
                if (this._ctExportRun || this.ctBusy) return null;
                const key = this.managedCatalogScope, epoch = this._ctEpoch || 0, client = this._cloud;
                const current = () => key === this.managedCatalogScope && epoch === (this._ctEpoch || 0) && client === this._cloud;
                const run = new Run(state => {
                    if (this._ctExportRun !== run) return;
                    const log = this.$refs?.ctExportPhases, added = state.rows.length !== this.ctExportTiming?.rows.length;
                    const follow = !log || log.scrollHeight - log.scrollTop - log.clientHeight < 8;
                    this.ctExportTiming = state;
                    if (added && follow) this.$nextTick?.(() => { if (log) log.scrollTop = log.scrollHeight; });
                }, current, label);
                this._ctExportRun = this._ctExportReportId = run; this.ctBusy = true; this.ctError = '';
                this.ctExportCopyMessage = ''; this.ctExportCopyBusy = false; this._ctExportCopyRequest = null; run.tick();
                this.ctShowExport(); return run;
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
