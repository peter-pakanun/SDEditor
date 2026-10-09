const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mixin } = require('../public/workspaceInitialization.js');

const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};
function app() {
    const editor = Object.assign(mixin.data(), mixin.methods);
    for (const [name, getter] of Object.entries(mixin.computed)) Object.defineProperty(editor, name, { get: () => getter.call(editor) });
    return editor;
}

function clipboard(t, writeText) {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText } } });
    t.after(() => original ? Object.defineProperty(globalThis, 'navigator', original) : delete globalThis.navigator);
}

function completedLog(editor, label = 'Opening selected version') {
    const owner = editor.beginWorkspaceInitialization({ label });
    const task = editor.beginWorkspaceInitializationTask('Restoring saved translations', owner);
    editor.finishWorkspaceInitializationTask(task);
    editor.finishWorkspaceInitialization(owner);
    return editor.workspaceInitializationLogText;
}

test('nested preparation stays active until every owner finishes and retains completed work', async () => {
    const editor = app(), first = editor.beginWorkspaceInitialization({ label: 'Opening version' });
    const nested = editor.beginWorkspaceInitialization({ session: first });
    const gate = deferred();
    const work = editor.runWorkspaceInitializationTask('Loading saved translations', () => gate.promise, nested);
    editor.finishWorkspaceInitialization(first);
    assert.equal(editor.workspaceInitializationActive, true);
    assert.equal(editor.workspaceInitializationRows[0].status, 'running');
    gate.resolve('files');
    assert.equal(await work, 'files');
    const completedAt = editor.workspaceInitializationRows[0].endedAt;
    assert.equal(editor.workspaceInitializationRows[0].status, 'done');
    editor.finishWorkspaceInitialization(nested);
    assert.equal(editor.workspaceInitializationActive, false);
    assert.equal(editor.workspaceInitializationRows[0].endedAt, completedAt);
    assert.equal(editor._workspaceInitializationTimer, null);
});

test('an old completion cannot change or release a replacement initialization', async () => {
    const editor = app(), old = editor.beginWorkspaceInitialization();
    const gate = deferred();
    const pending = editor.runWorkspaceInitializationTask('Old version', () => gate.promise, old);
    const current = editor.beginWorkspaceInitialization({ force: true, label: 'New version' });
    editor.beginWorkspaceInitializationTask('New saved files', current);
    gate.resolve(); await pending;
    editor.finishWorkspaceInitialization(old);
    assert.equal(editor.workspaceInitializationActive, true);
    assert.equal(editor.workspaceInitializationLabel, 'New version');
    assert.deepEqual(editor.workspaceInitializationRows.map(row => row.label), ['New saved files']);
    assert.equal(editor.workspaceInitializationRows[0].status, 'running');
    assert.equal(editor.beginWorkspaceInitialization({ session: old }), null);
    assert.equal(editor.beginWorkspaceInitializationTask('Stale task', old), null);
    editor.finishWorkspaceInitialization(current);
});

test('remote jobs wait for all local owners and paint without holding initialization for their response', async t => {
    const editor = app(), owner = editor.beginWorkspaceInitialization(), nested = editor.beginWorkspaceInitialization({ session: owner });
    t.after(() => mixin.beforeUnmount.call(editor));
    const paint = deferred(), started = deferred(), response = deferred(), calls = [];
    editor.$nextTick = () => paint.promise;
    editor.queueWorkspaceBackground('session', () => calls.push('superseded'));
    editor.queueWorkspaceBackground('session', async () => { calls.push('session'); started.resolve(); await response.promise; });
    editor.finishWorkspaceInitialization(owner);
    assert.equal(editor.workspaceInitializationActive, true);
    assert.deepEqual(calls, []);
    editor.finishWorkspaceInitialization(nested);
    assert.equal(editor.workspaceInitializationActive, false);
    assert.deepEqual(calls, [], 'Local completion precedes remote dispatch.');
    paint.resolve(); await started.promise;
    assert.deepEqual(calls, ['session']);
    assert.equal(editor.workspaceInitializationActive, false, 'An unresolved remote response has no local owner.');
    response.resolve();
});

test('unmount fences remote jobs already waiting for the prepared workspace paint', async () => {
    const editor = app(), owner = editor.beginWorkspaceInitialization(), paint = deferred();
    let calls = 0;
    editor.$nextTick = () => paint.promise;
    editor.queueWorkspaceBackground('remote', () => calls++);
    editor.finishWorkspaceInitialization(owner);
    mixin.beforeUnmount.call(editor);
    paint.resolve();
    assert.equal(editor.queueWorkspaceBackground('new-remote', () => calls++), false);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(calls, 0);
});

test('task failures preserve their message and propagate so existing recovery UI can handle them', async () => {
    const editor = app(), owner = editor.beginWorkspaceInitialization();
    const error = new Error('Stored baseline unavailable');
    await assert.rejects(editor.runWorkspaceInitializationTask('Verifying source', () => { throw error; }, owner), error);
    assert.equal(editor.workspaceInitializationRows[0].status, 'failed');
    assert.equal(editor.workspaceInitializationRows[0].error, error.message);
    await assert.rejects(editor.runWorkspaceInitializationTask('Cancelled old request', () => {
        throw Object.assign(new Error('Scope changed'), { stale: true });
    }, owner));
    assert.equal(editor.workspaceInitializationRows[1].status, 'cancelled');
    editor.finishWorkspaceInitialization(owner);
});

test('existing browser work is timed only during initialization and keeps earlier phases', () => {
    const editor = app();
    editor.trackWorkspaceInitializationWork('dictionary', { key: 'prepare', active: true, label: 'Idle Dictionary sync' });
    assert.equal(editor.workspaceInitializationRows.length, 0);
    const owner = editor.beginWorkspaceInitialization();
    editor.trackWorkspaceInitializationWork('dictionary', { key: 'prepare', active: true, label: 'Preparing Dictionary' });
    editor.trackWorkspaceInitializationWork('dictionary', { key: 'prepare', active: true, label: 'Preparing Dictionary' });
    assert.equal(editor.workspaceInitializationRows.length, 1);
    editor.trackWorkspaceInitializationWork('dictionary', { key: 'prepare', active: true, label: 'Building matches' });
    assert.equal(editor.workspaceInitializationRows[0].status, 'done');
    assert.equal(editor.workspaceInitializationRows[1].status, 'running');
    editor.trackWorkspaceInitializationWork('dictionary', { key: 'prepare', active: false });
    assert.equal(editor.workspaceInitializationRows[1].status, 'done');
    editor.trackWorkspaceInitializationWork('dictionary', { key: 'prepare', active: true, label: 'Building matches' });
    assert.equal(editor.workspaceInitializationRows.length, 2, 'Repeated per-file activity shares its phase instead of flooding the log.');
    assert.equal(editor.workspaceInitializationRows[1].status, 'running');
    editor.trackWorkspaceInitializationWork('dictionary', { key: 'prepare', active: false });
    editor.finishWorkspaceInitialization(owner);
    editor.trackWorkspaceInitializationWork('collaboration', { key: 'upload', active: true, label: 'Later background save' });
    assert.equal(editor.workspaceInitializationRows.length, 2);
});

test('live elapsed time advances while completed durations remain fixed', () => {
    const editor = app();
    editor.workspaceInitializationNow = 4500;
    assert.equal(editor.workspaceInitializationDuration(1100, null), '(3.4s)');
    assert.equal(editor.workspaceInitializationDuration(1100, 2100), '(1.0s)');
    editor.workspaceInitializationNow = 10000;
    assert.equal(editor.workspaceInitializationDuration(1100, null), '(8.9s)');
    assert.equal(editor.workspaceInitializationDuration(1100, 2100), '(1.0s)');
});

test('unmount stops timers and invalidates outstanding callbacks', () => {
    const editor = app(), owner = editor.beginWorkspaceInitialization();
    const row = editor.beginWorkspaceInitializationTask('Waiting for source', owner);
    mixin.beforeUnmount.call(editor);
    editor.finishWorkspaceInitializationTask(row);
    assert.equal(editor.workspaceInitializationActive, false);
    assert.equal(editor._workspaceInitializationTimer, null);
    assert.equal(editor.workspaceInitializationRows[0].status, 'cancelled');
});

test('the retained text includes total and per-step timings, outcomes and errors after preparation closes', () => {
    const editor = app();
    assert.equal(editor.workspaceInitializationLogText, '', 'No artificial log is shown before preparation.');
    const owner = editor.beginWorkspaceInitialization({ label: 'Opening selected version' });
    const done = editor.beginWorkspaceInitializationTask('Restoring saved translations', owner);
    editor.finishWorkspaceInitializationTask(done);
    const failure = editor.beginWorkspaceInitializationTask('Reading stored baseline', owner);
    editor.finishWorkspaceInitializationTask(failure, { error: new Error('Stored baseline <unavailable>') });
    editor.beginWorkspaceInitializationTask('Old source request', owner);
    editor.finishWorkspaceInitialization(owner);
    editor.workspaceInitializationStartedAt = 1000;
    editor.workspaceInitializationNow = 4500;
    editor.workspaceInitializationRows.forEach((row, index) => { row.startedAt = 1100; row.endedAt = [2100, 4300, 3300][index]; });
    const text = editor.workspaceInitializationLogText;
    assert.match(text, /Opening selected version/);
    assert.match(text, /Total elapsed: \(3\.5s\)/);
    assert.match(text, /Finished/);
    assert.match(text, /Completed: Restoring saved translations \(1\.0s\)/);
    assert.match(text, /Failed: Reading stored baseline \(3\.2s\)/);
    assert(text.includes('Stored baseline <unavailable>'), 'The error message is retained verbatim for copying.');
    assert.match(text, /Stopped: Old source request \(2\.2s\)/);
    editor.disposeWorkspaceInitialization();
    assert.equal(editor.workspaceInitializationLogText, text, 'Closing the completed preparation retains its final text and times.');
});

test('copy waits for clipboard acknowledgement, writes the complete retained text and prevents duplicate requests', async t => {
    const editor = app(), text = completedLog(editor), gate = deferred(), copied = [];
    clipboard(t, value => { copied.push(value); return gate.promise; });
    const pending = editor.copyWorkspaceInitializationLog();
    assert.equal(editor.workspaceInitializationCopyBusy, true);
    assert.equal(editor.workspaceInitializationCopyMessage, '', 'Success is not shown while clipboard writing is unresolved.');
    assert.equal(await editor.copyWorkspaceInitializationLog(), false, 'A repeated click does not duplicate pending clipboard writes.');
    assert.deepEqual(copied, [text]);
    gate.resolve();
    assert.equal(await pending, true);
    assert.equal(editor.workspaceInitializationCopyBusy, false);
    assert.match(editor.workspaceInitializationCopyMessage, /copied/i);
});

test('rejected clipboard access selects the retained text for manual copying and keeps success absent', async t => {
    const editor = app(); completedLog(editor);
    const fallback = [];
    editor.$refs = { workspaceInitializationLogText: { focus: () => fallback.push('focus'), select: () => fallback.push('select') } };
    clipboard(t, async () => { throw new Error('Clipboard permission rejected'); });
    editor.workspaceInitializationCopyMessage = 'Log copied.';
    assert.equal(await editor.copyWorkspaceInitializationLog(), false);
    assert.deepEqual(fallback, ['focus', 'select']);
    assert.doesNotMatch(editor.workspaceInitializationCopyMessage, /copied/i);
    assert.match(editor.workspaceInitializationCopyMessage, /Ctrl\+C/);
    assert.equal(editor.workspaceInitializationCopyBusy, false);
});

test('a completed old clipboard request cannot publish a message or release a replacement request', async t => {
    const writes = [];
    clipboard(t, () => { const gate = deferred(); writes.push(gate); return gate.promise; });
    for (const outcome of ['resolve', 'reject']) {
        const editor = app(); completedLog(editor, 'Old version');
        const fallback = [];
        editor.$refs = { workspaceInitializationLogText: { focus: () => fallback.push('focus'), select: () => fallback.push('select') } };
        const oldCopy = editor.copyWorkspaceInitializationLog(), oldGate = writes.at(-1);
        completedLog(editor, 'New version');
        const newCopy = editor.copyWorkspaceInitializationLog(), newGate = writes.at(-1);
        oldGate[outcome](outcome === 'reject' ? new Error('Old permission request rejected') : undefined);
        await oldCopy;
        assert.equal(editor.workspaceInitializationCopyBusy, true, outcome + ': old completion does not release the new clipboard request.');
        assert.equal(editor.workspaceInitializationCopyMessage, '', outcome + ': old completion does not publish a message for the new version.');
        assert.deepEqual(fallback, [], outcome + ': old failure does not focus or select new text.');
        newGate.resolve(); await newCopy;
        assert.match(editor.workspaceInitializationCopyMessage, /copied/i);
        assert.equal(editor.workspaceInitializationCopyBusy, false);
    }
});
