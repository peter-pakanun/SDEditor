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
                workspaceInitializationPlan: [],
                workspaceInitializationCopyBusy: false, workspaceInitializationCopyMessage: '' };
        },
        computed: {
            workspaceInitializationElapsed() {
                return this.workspaceInitializationDuration(this.workspaceInitializationStartedAt, this.workspaceInitializationNow);
            },
            workspaceInitializationProgress() {
                const rows = this.workspaceInitializationRows;
                const completed = rows.filter(row => row.status === 'done').length;
                const running = rows.filter(row => row.status === 'running').length;
                if (!this.workspaceInitializationPlan.length) return { value: null, completed, total: null,
                    label: `${completed} steps completed${running ? ` · ${running} in progress` : ''}` };
                let earned = 0, weight = 0, finished = 0;
                for (const step of this.workspaceInitializationPlan) {
                    weight += step.weight;
                    // Nested helpers may repeat an already completed stage.
                    // Count each planned stage once; owners still hold the
                    // overall bar below 100 until all preparation finishes.
                    const row = rows.find(item => item.label === step.label);
                    if (row?.status === 'done') { earned += step.weight; finished++; }
                    else if (row?.progress?.value !== null && row?.progress?.value !== undefined) {
                        earned += step.weight * row.progress.value / 100;
                    }
                }
                const total = this.workspaceInitializationPlan.length;
                const value = Math.min(this.workspaceInitializationActive || finished < total ? 99 : 100, Math.floor(earned / weight * 100));
                return { value, completed: finished, total, label: `${value}% · ${finished} of ${total} steps completed` };
            },
            workspaceInitializationLogText() {
                if (!this.workspaceInitializationRows.length) return '';
                const statuses = { running: 'In progress', done: 'Completed', failed: 'Failed', cancelled: 'Stopped' };
                const lines = ['Workspace initialization',
                    this.workspaceInitializationLabel,
                    'Total elapsed: ' + this.workspaceInitializationElapsed,
                    'Overall progress: ' + this.workspaceInitializationProgress.label,
                    this.workspaceInitializationActive ? 'In progress' : 'Finished', ''];
                for (const row of this.workspaceInitializationRows) {
                    lines.push(`${statuses[row.status] || row.status}: ${row.label} ${this.workspaceInitializationDuration(row.startedAt, row.endedAt)}`);
                    if (row.progress) lines.push('    ' + this.workspaceInitializationTaskProgress(row).label);
                    if (row.error) lines.push('    ' + row.error);
                }
                return lines.join('\n');
            },
        },
        beforeUnmount() {
            this._workspaceBackgroundDisposed = true;
            clearTimeout(this._workspaceBackgroundTimer);
            this._workspaceBackgroundJobs?.clear();
            this.disposeWorkspaceInitialization();
        },
        methods: {
            beginWorkspaceInitialization({ label = 'Initializing workspace', force = false, session, plan = [] } = {}) {
                if (session && session.run !== this._workspaceInitializationRun) return null;
                if (force) this.disposeWorkspaceInitialization();
                let run = this._workspaceInitializationRun;
                const ownsPlan = !this.workspaceInitializationActive || !run;
                if (!this.workspaceInitializationActive || !run) {
                    const startedAt = now();
                    run = this._workspaceInitializationRun = { owners: new Set(), work: new Map(), sequence: 0 };
                    this.workspaceInitializationRows = [];
                    this.workspaceInitializationPlan = [];
                    this.setWorkspaceInitializationPlan({ run }, plan);
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
                const owner = { run, ownsPlan };
                run.owners.add(owner);
                return owner;
            },
            setWorkspaceInitializationPlan(session, plan) {
                if (!session || session.run !== this._workspaceInitializationRun) return;
                this.workspaceInitializationPlan = (plan || []).map(step => typeof step === 'string' ? { label: step, weight: 1 } : step)
                    .filter(step => step?.label).map(step => ({ label: step.label,
                        weight: Number.isFinite(step.weight) && step.weight > 0 ? step.weight : 1 }));
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
                this.flushWorkspaceBackground();
            },
            queueWorkspaceBackground(key, callback, onError) {
                if (this._workspaceBackgroundDisposed) return false;
                (this._workspaceBackgroundJobs ||= new Map()).set(key, { callback, onError });
                this.flushWorkspaceBackground();
                return true;
            },
            flushWorkspaceBackground() {
                if (this._workspaceBackgroundDisposed || this.workspaceInitializationActive
                    || this._workspaceBackgroundTimer || !this._workspaceBackgroundJobs?.size) return;
                // First expose the prepared local workspace. Remote work starts
                // in a later task, after its first paint, and never owns the gate.
                this._workspaceBackgroundTimer = setTimeout(async () => {
                    await this.$nextTick?.();
                    if (root.requestAnimationFrame && !root.document?.hidden) {
                        await new Promise(resolve => root.requestAnimationFrame(() => setTimeout(resolve, 0)));
                    }
                    this._workspaceBackgroundTimer = null;
                    if (this._workspaceBackgroundDisposed || this.workspaceInitializationActive) return;
                    const jobs = [...this._workspaceBackgroundJobs.values()];
                    this._workspaceBackgroundJobs.clear();
                    for (const job of jobs) Promise.resolve().then(job.callback).catch(error => {
                        if (!error?.stale && !this._workspaceBackgroundDisposed) job.onError?.(error);
                    });
                }, 0);
            },
            beginWorkspaceInitializationTask(label, session) {
                const run = this._workspaceInitializationRun;
                if (!run || !this.workspaceInitializationActive || (session && session.run !== run)) return null;
                const log = this.$refs?.workspaceInitializationLog;
                const follow = !log || log.scrollHeight - log.scrollTop - log.clientHeight < 40;
                const id = ++run.sequence;
                this.workspaceInitializationRows.push({ id, label, startedAt: now(), endedAt: null, status: 'running', error: '', progress: null });
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
                if (row.status === 'done' && row.progress) row.progress = { ...row.progress, value: 100,
                    completed: row.progress.total ?? row.progress.completed };
                this.workspaceInitializationNow = row.endedAt;
            },
            updateWorkspaceInitializationTaskProgress(task, progress = {}) {
                if (!task || task.run !== this._workspaceInitializationRun) return;
                const row = this.workspaceInitializationRows.find(item => item.id === task.id);
                if (!row || row.endedAt !== null) return;
                const completed = Number.isFinite(progress.completed) && progress.completed >= 0 ? progress.completed : 0;
                const total = Number.isFinite(progress.total) && progress.total > 0 ? progress.total : null;
                const percent = Number.isFinite(progress.percent) ? progress.percent : total ? completed / total * 100 : null;
                row.progress = { value: percent === null ? null : Math.max(0, Math.min(100, percent)),
                    completed: total ? Math.min(completed, total) : completed, total,
                    unit: ['bytes', 'files', 'items'].includes(progress.unit) ? progress.unit : 'items' };
            },
            workspaceInitializationTaskProgress(row) {
                const progress = row.progress;
                if (!progress) return { value: null, label: 'In progress' };
                const format = value => progress.unit === 'bytes'
                    ? value >= 1048576 ? (value / 1048576).toFixed(1) + ' MiB'
                        : value >= 1024 ? (value / 1024).toFixed(1) + ' KiB' : Math.round(value) + ' B'
                    : Math.floor(value).toLocaleString();
                const counts = progress.total ? `${format(progress.completed)} / ${format(progress.total)}`
                    : progress.completed ? format(progress.completed) : '';
                const unit = progress.unit === 'bytes' ? '' : ' ' + progress.unit;
                const percent = progress.value === null ? '' : Math.floor(progress.value) + '%';
                return { value: progress.value, label: [percent, counts ? counts + unit : ''].filter(Boolean).join(' · ') || 'In progress' };
            },
            async runWorkspaceInitializationTask(label, callback, session) {
                const task = this.beginWorkspaceInitializationTask(label, session);
                try {
                    const result = await callback(progress => this.updateWorkspaceInitializationTaskProgress(task, progress));
                    this.finishWorkspaceInitializationTask(task, { cancelled: result === false });
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
