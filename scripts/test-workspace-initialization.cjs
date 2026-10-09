const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mixin } = require('../public/workspaceInitialization.js');

const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};
function app() {
    return Object.assign(mixin.data(), mixin.methods);
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
