/* Timed activity for explicit workspace preparation; routine background work stays silent. */
(function (root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.WorkspaceInitialization = api;
})(typeof window === 'object' ? window : globalThis, function (root) {
    'use strict';
    const now = () => root.performance?.now?.() ?? Date.now();
    const mixin = {
        data() {
            return { workspaceInitializationActive: false, workspaceInitializationLabel: '',
                workspaceInitializationRows: [], workspaceInitializationStartedAt: 0, workspaceInitializationNow: 0,
                workspaceInitializationCopyBusy: false, workspaceInitializationCopyMessage: '' };
        },
        computed: {
            workspaceInitializationElapsed() {
                return this.workspaceInitializationDuration(this.workspaceInitializationStartedAt, this.workspaceInitializationNow);
            },
            workspaceInitializationLogText() {
                if (!this.workspaceInitializationRows.length) return '';
                const statuses = { running: 'In progress', done: 'Completed', failed: 'Failed', cancelled: 'Stopped' };
                const lines = ['Workspace initialization',
                    this.workspaceInitializationLabel,
                    'Total elapsed: ' + this.workspaceInitializationElapsed,
                    this.workspaceInitializationActive ? 'In progress' : 'Finished', ''];
                for (const row of this.workspaceInitializationRows) {
                    lines.push(`${statuses[row.status] || row.status}: ${row.label} ${this.workspaceInitializationDuration(row.startedAt, row.endedAt)}`);
                    if (row.error) lines.push('    ' + row.error);
                }
                return lines.join('\n');
            },
        },
        beforeUnmount() { this.disposeWorkspaceInitialization(); },
        methods: {
            beginWorkspaceInitialization({ label = 'Initializing workspace', force = false, session } = {}) {
                if (session && session.run !== this._workspaceInitializationRun) return null;
                if (force) this.disposeWorkspaceInitialization();
                let run = this._workspaceInitializationRun;
                if (!this.workspaceInitializationActive || !run) {
                    const startedAt = now();
                    run = this._workspaceInitializationRun = { owners: new Set(), work: new Map(), sequence: 0 };
                    this.workspaceInitializationRows = [];
                    this.workspaceInitializationCopyMessage = '';
                    this.workspaceInitializationCopyBusy = false;
                    this._workspaceInitializationCopyRequest = null;
                    this.workspaceInitializationLabel = label;
                    this.workspaceInitializationStartedAt = startedAt;
                    this.workspaceInitializationNow = startedAt;
                    this.workspaceInitializationActive = true;
                    this._workspaceInitializationTimer = setInterval(() => {
                        if (this._workspaceInitializationRun === run) this.workspaceInitializationNow = now();
                    }, 100);
                }
                const owner = { run };
                run.owners.add(owner);
                return owner;
            },
            finishWorkspaceInitialization(owner) {
                const run = this._workspaceInitializationRun;
                if (!owner || owner.run !== run || !run.owners.delete(owner) || run.owners.size) return;
                this.workspaceInitializationNow = now();
                for (const row of this.workspaceInitializationRows) {
                    if (row.endedAt === null) { row.endedAt = this.workspaceInitializationNow; row.status = 'cancelled'; }
                }
                clearInterval(this._workspaceInitializationTimer);
                this._workspaceInitializationTimer = null;
                this.workspaceInitializationActive = false;
                this._workspaceInitializationRun = null;
            },
            beginWorkspaceInitializationTask(label, session) {
                const run = this._workspaceInitializationRun;
                if (!run || !this.workspaceInitializationActive || (session && session.run !== run)) return null;
                const log = this.$refs?.workspaceInitializationLog;
                const follow = !log || log.scrollHeight - log.scrollTop - log.clientHeight < 40;
                const id = ++run.sequence;
                this.workspaceInitializationRows.push({ id, label, startedAt: now(), endedAt: null, status: 'running', error: '' });
                if (follow) this.$nextTick?.(() => {
                    const currentLog = this.$refs?.workspaceInitializationLog;
                    if (run === this._workspaceInitializationRun && currentLog) currentLog.scrollTop = currentLog.scrollHeight;
                });
                return { run, id };
            },
            finishWorkspaceInitializationTask(task, { error, cancelled = false } = {}) {
                if (!task || task.run !== this._workspaceInitializationRun) return;
                const row = this.workspaceInitializationRows.find(item => item.id === task.id);
                if (!row || row.endedAt !== null) return;
                row.endedAt = now();
                row.status = error ? 'failed' : cancelled ? 'cancelled' : 'done';
                row.error = error?.message || (error ? String(error) : '');
                this.workspaceInitializationNow = row.endedAt;
            },
            async runWorkspaceInitializationTask(label, callback, session) {
                const task = this.beginWorkspaceInitializationTask(label, session);
                try {
                    const result = await callback();
                    this.finishWorkspaceInitializationTask(task);
                    return result;
                } catch (error) {
                    this.finishWorkspaceInitializationTask(task, error?.stale ? { cancelled: true } : { error });
                    throw error;
                }
            },
            trackWorkspaceInitializationWork(scope, { key, label, active }) {
                const run = this._workspaceInitializationRun;
                if (!run) return;
                const id = scope + ':' + key;
                const previous = run.work.get(id);
                if (previous && !active) {
                    this.finishWorkspaceInitializationTask(previous.task);
                    return;
                }
                if (previous && previous.label !== label) {
                    this.finishWorkspaceInitializationTask(previous.task);
                    run.work.delete(id);
                }
                if (active && previous?.label === label) {
                    // A queued upload/repair pass can report the same phase for
                    // thousands of files. Keep one timed row for the whole pass.
                    const row = this.workspaceInitializationRows.find(item => item.id === previous.task?.id);
                    if (row) { row.endedAt = null; row.status = 'running'; }
                    return;
                }
                if (active && label && !run.work.has(id)) run.work.set(id, {
                    label, task: this.beginWorkspaceInitializationTask(label),
                });
            },
            workspaceInitializationDuration(startedAt, endedAt) {
                return '(' + (Math.max(0, (endedAt ?? this.workspaceInitializationNow) - startedAt) / 1000).toFixed(1) + 's)';
            },
            async copyWorkspaceInitializationLog() {
                const text = this.workspaceInitializationLogText;
                if (!text || this.workspaceInitializationCopyBusy) return false;
                const request = this._workspaceInitializationCopyRequest = {};
                const rows = this.workspaceInitializationRows;
                const current = () => this._workspaceInitializationCopyRequest === request && this.workspaceInitializationRows === rows;
                this.workspaceInitializationCopyBusy = true;
                this.workspaceInitializationCopyMessage = '';
                try {
                    if (!root.navigator?.clipboard?.writeText) throw new Error('Clipboard unavailable');
                    await root.navigator.clipboard.writeText(text);
                    if (current()) this.workspaceInitializationCopyMessage = 'Log copied.';
                    return true;
                } catch (_) {
                    if (current()) {
                        const field = this.$refs?.workspaceInitializationLogText;
                        field?.focus(); field?.select();
                        field?.scrollIntoView?.({ block: 'center', inline: 'nearest' });
                        this.workspaceInitializationCopyMessage = 'Automatic copy is unavailable. Select the log and press Ctrl+C to copy.';
                    }
                    return false;
                } finally {
                    if (this._workspaceInitializationCopyRequest === request) {
                        this.workspaceInitializationCopyBusy = false;
                        this._workspaceInitializationCopyRequest = null;
                    }
                }
            },
            disposeWorkspaceInitialization() {
                const run = this._workspaceInitializationRun;
                if (run) {
                    const endedAt = now();
                    for (const row of this.workspaceInitializationRows) {
                        if (row.endedAt === null) { row.endedAt = endedAt; row.status = 'cancelled'; }
                    }
                    this.workspaceInitializationNow = endedAt;
                }
                clearInterval(this._workspaceInitializationTimer);
                this._workspaceInitializationTimer = null;
                this._workspaceInitializationRun = null;
                this.workspaceInitializationActive = false;
            },
        },
    };
    return { mixin };
});
