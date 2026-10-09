const assert = require('node:assert/strict');
const PendingSaves = require('../public/pendingSaves.js');

const tests = [];
const test = (name, run) => tests.push({ name, run });
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function batch(id, value = id, extra = {}) {
  return { jobId: id, game: 'poe1', language: 'Thai', sourceHash: 'source-one', accountId: 'account-one',
    files: [{ filepath: 'source/file.txt', translations: [value], trackedForExport: true, needsReview: false }],
    descriptions: [], statuses: {}, revisions: [{ translations: [value], note: 'save' }], ...extra };
}
const scope = { game: 'poe1', language: 'Thai', sourceHash: 'source-one', accountId: 'account-one' };

test('enqueue returns before storage starts and captures an independent payload with runtime context', async () => {
  const calls = [], context = { client: { active: true } }, value = batch('first');
  const queue = PendingSaves.create({ save: async payload => { calls.push(payload); return { jobId: payload.jobId }; } });
  const job = queue.enqueue(value, { context });
  value.files[0].translations[0] = 'mutated'; value.revisions[0].translations[0] = 'mutated';
  assert.equal(job.context, context);
  assert.equal(queue.snapshot().pending, 1);
  assert.equal(job.batch.files[0].translations[0], 'first');
  assert.equal(job.batch.revisions[0].translations[0], 'first');
  await Promise.resolve();
  assert.equal(calls.length, 0, 'The close/navigation paint must get a turn before the write.');
  await queue.drain();
  assert.equal(calls.length, 1); assert.equal(queue.snapshot().pending, 0);
  assert.equal(queue.snapshot().jobs.length, 0); assert.equal(job.durable, true);
});

test('workspace branch scope is captured before dispatch and survives a subsequent branch change', async () => {
  const calls = []; let branchId = 'release-one';
  const queue = PendingSaves.create({ captureScope: value => ({ accountId: value.accountId, game: value.game, sourceHash: value.sourceHash, branchId }),
    save: async value => { calls.push(value); return { jobId: value.jobId }; } });
  const job = queue.enqueue(batch('captured-branch'));
  branchId = 'release-two';
  assert.equal(job.batch.workspaceScope.branchId, 'release-one');
  assert.equal(queue.overlay({ ...scope, branchId: 'release-one' }, 'source/file.txt').translations[0], 'captured-branch');
  assert.equal(queue.overlay({ ...scope, branchId: 'release-two' }, 'source/file.txt'), null);
  await queue.drain(); assert.equal(calls[0].branchId, 'release-one');
});

test('storage and asynchronous acknowledgement callbacks finish in queue order', async () => {
  const writes = [], commits = [], firstWrite = deferred(), firstCommit = deferred();
  const queue = PendingSaves.create({
    save: async payload => { writes.push(payload.jobId); if (payload.jobId === 'first') await firstWrite.promise; return { jobId: payload.jobId }; },
    onCommit: async job => { commits.push(job.id); if (job.id === 'first') await firstCommit.promise; },
  });
  queue.enqueue(batch('first')); queue.enqueue(batch('second'));
  const drained = queue.drain(); await tick();
  assert.deepEqual(writes, ['first']); assert.equal(queue.snapshot().pending, 2);
  firstWrite.resolve(); await tick();
  assert.deepEqual(commits, ['first']); assert.deepEqual(writes, ['first']); assert.equal(queue.snapshot().pending, 1);
  firstCommit.resolve(); await drained;
  assert.deepEqual(writes, ['first', 'second']); assert.deepEqual(commits, ['first', 'second']);
});

test('navigation holds cancel scheduled intake and require every idempotent release before dispatch', async () => {
  const calls = [];
  const queue = PendingSaves.create({ save: async value => { calls.push(value.jobId); return {}; } });
  queue.enqueue(batch('first'));
  const releaseFirst = queue.hold(), releaseSecond = queue.hold();
  let drained = false;
  const waiting = queue.drain().then(() => { drained = true; });
  await tick();
  assert.deepEqual(calls, []); assert.equal(drained, false);
  releaseFirst(); releaseFirst();
  await tick();
  assert.deepEqual(calls, [], 'An already released hold cannot release another navigation.');
  releaseSecond(); await waiting;
  assert.deepEqual(calls, ['first']); assert.equal(drained, true);
  releaseSecond(); await tick(); assert.deepEqual(calls, ['first']);
  queue.dispose();
});

test('a navigation hold lets an active transaction acknowledge but blocks the next queued write', async () => {
  const calls = [], committed = [], active = deferred();
  const queue = PendingSaves.create({ save: async value => {
    calls.push(value.jobId); if (value.jobId === 'first') await active.promise; return {};
  }, onCommit: job => { committed.push(job.id); } });
  queue.enqueue(batch('first')); queue.enqueue(batch('second'));
  const waiting = queue.drain(); await tick();
  assert.deepEqual(calls, ['first']);
  const release = queue.hold();
  active.resolve({}); await tick();
  assert.deepEqual(committed, ['first']); assert.deepEqual(calls, ['first']);
  assert.equal(queue.snapshot().pending, 1);
  release(); await waiting;
  assert.deepEqual(calls, ['first', 'second']); assert.deepEqual(committed, ['first', 'second']);
  queue.dispose();
});

test('releasing a navigation hold after disposal never starts its retained save', async () => {
  let writes = 0;
  const queue = PendingSaves.create({ save: async () => { writes++; return {}; } });
  const release = queue.hold(), job = queue.enqueue(batch('first'));
  queue.dispose(); release(); release(); await tick();
  assert.equal(writes, 0); assert.equal(queue.snapshot().jobs[0], job);
});

test('latest pending save overlays older acknowledgements while a durable job stops overlaying', async () => {
  const commit = deferred(), write = deferred();
  const queue = PendingSaves.create({ save: async payload => {
    if (payload.jobId === 'second') await write.promise;
    return { jobId: payload.jobId };
  }, onCommit: async job => { if (job.id === 'first') await commit.promise; } });
  const first = queue.enqueue(batch('first', 'older'));
  queue.enqueue(batch('second', 'latest'));
  await tick(); assert.equal(first.durable, true);
  assert.equal(queue.overlay(scope, 'source/file.txt').translations[0], 'latest');
  assert.equal(queue.pendingFor(scope, 'source/file.txt').translations[0], 'latest');
  commit.resolve(); await tick(); assert.equal(queue.snapshot().pending, 1);
  write.resolve(); await queue.drain(); assert.equal(queue.overlay(scope, 'source/file.txt'), null);

  const acknowledged = deferred();
  const single = PendingSaves.create({ save: async () => ({}), onCommit: () => acknowledged.promise });
  single.enqueue(batch('third')); await tick();
  assert.equal(single.snapshot().pending, 0); assert.equal(single.overlay(scope, 'source/file.txt'), null);
  acknowledged.resolve(); await single.drain();
});

test('storage failure retains queued drafts, stops later writes, and rejects a drain', async () => {
  const calls = [], errors = [], failure = new Error('Disk full'); let reject = true;
  const queue = PendingSaves.create({ save: async payload => {
    calls.push(JSON.stringify(payload));
    if (reject) throw failure;
    return { jobId: payload.jobId };
  }, onError: (job, error) => { errors.push({ job, error }); } });
  const first = queue.enqueue(batch('first', 'older'));
  const second = queue.enqueue(batch('second', 'latest'));
  await assert.rejects(queue.drain(), /Disk full/); await tick();
  assert.equal(calls.length, 1); assert.equal(first.status, 'failed'); assert.equal(first.error, failure);
  assert.equal(second.status, 'queued'); assert.equal(queue.snapshot().pending, 2);
  assert.equal(queue.overlay(scope, 'source/file.txt').translations[0], 'latest');
  assert.equal(errors[0].job, first); assert.equal(errors[0].error, failure);
  queue.enqueue(batch('third', 'new draft', { files: [{ filepath: 'other.txt', translations: ['new draft'] }] }));
  assert.equal(queue.snapshot().error, 'Disk full', 'Unrelated queue intake must keep the failure visible.');
  await tick(); assert.equal(calls.length, 1);
  reject = false; await queue.retry();
  assert.equal(calls[1], calls[0], 'Retry must resend the identical saved snapshot and job ID.');
  assert.deepEqual(calls.map(value => JSON.parse(value).jobId), ['first', 'first', 'second', 'third']);
  assert.equal(queue.snapshot().error, ''); assert.equal(queue.snapshot().pending, 0);
});

test('an unknown worker acknowledgement retains the original identity for receipt-based retry', async () => {
  const calls = []; let fail = true;
  const queue = PendingSaves.create({ save: async payload => {
    calls.push(payload);
    if (fail) throw Object.assign(new Error('Worker disconnected'), { durableUnknown: true });
    return { jobId: payload.jobId, recovered: true };
  } });
  const job = queue.enqueue(batch('unknown'));
  await assert.rejects(queue.drain(), /Worker disconnected/);
  assert.equal(job.durable, false); assert.equal(job.error.durableUnknown, true);
  fail = false; await queue.retry();
  assert.equal(calls[0], calls[1]); assert.equal(calls[1].jobId, 'unknown');
});

test('retrying a failed save keeps its warning visible until that operation succeeds', async () => {
  const retried = deferred(); let calls = 0;
  const queue = PendingSaves.create({ save: async () => {
    calls++;
    if (calls === 1) throw new Error('Storage is unavailable');
    return retried.promise;
  } });
  queue.enqueue(batch('first')); await assert.rejects(queue.drain(), /Storage is unavailable/);
  const retry = queue.retry();
  assert.equal(queue.snapshot().error, 'Storage is unavailable');
  await tick(); assert.equal(queue.snapshot().error, 'Storage is unavailable');
  retried.resolve({}); await retry; assert.equal(queue.snapshot().error, '');
});

test('failed UI acknowledgement keeps its record and retries the callback without another write', async () => {
  let writes = 0, callbacks = 0;
  const queue = PendingSaves.create({ save: async () => { writes++; return { accepted: 'persisted' }; }, onCommit: async (job, ack) => {
    callbacks++; assert.equal(job.durable, true); assert.equal(ack.accepted, 'persisted');
    if (callbacks === 1) throw new Error('View temporarily unavailable');
  } });
  const job = queue.enqueue(batch('first'));
  await assert.rejects(queue.drain(), /View temporarily unavailable/);
  assert.equal(queue.snapshot().jobs[0], job); assert.equal(job.durable, true);
  assert.equal(queue.snapshot().pending, 0); assert.equal(queue.overlay(scope, 'source/file.txt'), null);
  await queue.retry(); assert.equal(writes, 1); assert.equal(callbacks, 2); assert.equal(queue.snapshot().jobs.length, 0);
});

test('pending overlays stay scoped to game, language, source, account and file', async () => {
  const held = deferred();
  const queue = PendingSaves.create({ save: () => held.promise });
  queue.enqueue(batch('intended', 'intended'));
  queue.enqueue(batch('other-game', 'wrong', { game: 'poe2' }));
  queue.enqueue(batch('other-language', 'wrong', { language: 'German' }));
  queue.enqueue(batch('other-source', 'wrong', { sourceHash: 'different-source' }));
  queue.enqueue(batch('other-account', 'wrong', { accountId: 'account-two' }));
  assert.equal(queue.overlay(scope, 'source/file.txt').translations[0], 'intended');
  assert.equal(queue.overlay({ game: 'poe1', language: 'Thai', source: 'source-one', account: 'account-one' }, 'source/file.txt').translations[0], 'intended');
  assert.equal(queue.overlay(PendingSaves.scopeKey(scope), 'source/file.txt').translations[0], 'intended');
  assert.equal(queue.overlay(scope, 'absent.txt'), null);
  held.resolve({}); await queue.drain();
});

test('observer failures cannot prevent storage or discard its retained acknowledgement', async () => {
  let writes = 0;
  const queue = PendingSaves.create({ save: async () => { writes++; return {}; }, onChange: () => { throw new Error('Broken observer'); } });
  queue.enqueue(batch('first')); await queue.drain(); assert.equal(writes, 1); assert.equal(queue.snapshot().pending, 0);
});

test('duplicate pending IDs reuse only identical payloads', async () => {
  let writes = 0;
  const queue = PendingSaves.create({ save: async () => { writes++; return {}; } });
  const value = batch('first'), job = queue.enqueue(value);
  assert.equal(queue.enqueue(value), job);
  assert.throws(() => queue.enqueue(batch('first', 'different')), /cannot be reused/);
  assert.equal(queue.snapshot().pending, 1); await queue.drain(); assert.equal(writes, 1);
});

test('drain also waits for new saves enqueued while the first write is pending', async () => {
  const firstWrite = deferred(), secondWrite = deferred(); let drained = false;
  const queue = PendingSaves.create({ save: payload => payload.jobId === 'first' ? firstWrite.promise : secondWrite.promise });
  queue.enqueue(batch('first')); const waiting = queue.drain().then(() => { drained = true; });
  await tick(); queue.enqueue(batch('second')); firstWrite.resolve({}); await tick(); assert.equal(drained, false);
  secondWrite.resolve({}); await waiting; assert.equal(drained, true);
});

test('draft promotion waits for durability before becoming an overlay', async () => {
  const write = deferred();
  const queue = PendingSaves.create({ save: async () => { await write.promise; return { draftConsumed: true }; } });
  const job = queue.enqueue(batch('draft', 'uncommitted', { deferDisplay: true }));
  await tick();
  assert.equal(queue.overlay(scope, 'source/file.txt'), null);
  assert.equal(job.durable, false);
  write.resolve(); await queue.drain();
  assert.equal(job.durable, true);
  assert.equal(job.ack.draftConsumed, true);
  assert.equal(queue.overlay(scope, 'source/file.txt'), null);
  queue.dispose();
});

test('a stale draft rejection can be removed without erasing unrelated saves or retrying its old decision', async () => {
  const rejected = Object.assign(new Error('The base changed'), { code: 'DRAFT_BASE_CHANGED' });
  const calls = [];
  const queue = PendingSaves.create({ save: async payload => {
    calls.push(payload.jobId); if (payload.draft) throw rejected; return {};
  } });
  queue.enqueue(batch('draft', 'old decision', { draft: { key: 'scope', id: 'draft-id', revision: 1 }, deferDisplay: true }));
  queue.enqueue(batch('next'));
  await assert.rejects(queue.drain(), /base changed/);
  assert.equal(queue.discardRejectedDraft('draft'), true);
  await queue.drain();
  assert.deepEqual(calls, ['draft', 'next']);
  assert.equal(queue.snapshot().pending, 0);
  queue.dispose();
});

test('storage failures and uncertain completion cannot be discarded as rejected drafts', async () => {
  const queue = PendingSaves.create({ save: async () => { throw Object.assign(new Error('Worker stopped'), { durableUnknown: true }); } });
  queue.enqueue(batch('draft', 'recoverable', { draft: { key: 'scope', id: 'draft-id', revision: 1 } }));
  await assert.rejects(queue.drain(), /Worker stopped/);
  assert.equal(queue.discardRejectedDraft('draft'), false);
  assert.equal(queue.snapshot().jobs.length, 1);
  queue.dispose();
});

test('a rejected staged deletion releases the queue for a newly confirmed decision and unrelated saves', async () => {
  for (const code of ['DELETE_STAGED_BASE_CHANGED', 'DELETE_STAGED_NOT_FOUND', 'DELETE_STAGED_CONFLICT']) {
    const calls = [], queue = PendingSaves.create({ save: async payload => {
      calls.push(payload.jobId);
      if (payload.resetStaging) throw Object.assign(new Error('Delete rejected'), { code });
      return {};
    } });
    queue.enqueue(batch('delete', 'old decision', { resetStaging: true, deferDisplay: true }));
    queue.enqueue(batch('next'));
    await assert.rejects(queue.drain(), /Delete rejected/);
    assert.equal(queue.discardRejectedReset('delete'), true);
    await queue.drain();
    assert.deepEqual(calls, ['delete', 'next']); assert.equal(queue.snapshot().pending, 0);
    queue.dispose();
  }
});

test('staged deletion storage failures, uncertain completion and durable acknowledgements remain recoverable', async () => {
  for (const options of [
    { save: async () => { throw new Error('Quota exceeded'); } },
    { save: async () => { throw Object.assign(new Error('Worker stopped'), { code: 'DELETE_STAGED_BASE_CHANGED', durableUnknown: true }); } },
    { save: async () => ({}), onCommit: () => { throw Object.assign(new Error('UI failed'), { code: 'DELETE_STAGED_BASE_CHANGED' }); } },
  ]) {
    const queue = PendingSaves.create(options);
    queue.enqueue(batch('delete', 'captured', { resetStaging: true }));
    await assert.rejects(queue.drain());
    assert.equal(queue.discardRejectedReset('delete'), false);
    assert.equal(queue.snapshot().jobs.length, 1);
    queue.dispose();
  }
});

test('journaled stale submissions without checkpoints release only after durable review preservation', async () => {
  const calls = [], reviewed = deferred();
  const queue = PendingSaves.create({ save: async value => {
    calls.push(value.jobId);
    if (value.jobId === 'stale') throw Object.assign(new Error('Review required'), { code: 'DRAFT_BASE_CHANGED' });
    return {};
  }, onError: async job => { await reviewed.promise; queue.discardRejectedSubmission(job.id); } });
  const job = queue.enqueue(batch('stale', 'Captured direct save', { deferDisplay: true })); job.journaled = true;
  queue.enqueue(batch('next'));
  await assert.rejects(queue.drain(), /Review required/);
  assert.equal(queue.discardRejectedDraft(job.id), false);
  await tick(); assert.deepEqual(calls, ['stale']);
  reviewed.resolve(); await tick(); await queue.drain();
  assert.deepEqual(calls, ['stale', 'next']); assert.equal(queue.snapshot().pending, 0); queue.dispose();
});

test('uncertain, unjournaled or durable failed submissions cannot be removed as reviewed saves', async () => {
  for (const extra of [{}, { journaled: true, error: { durableUnknown: true } }, { journaled: true, durable: true }]) {
    const queue = PendingSaves.create({ save: async () => { throw Object.assign(new Error('Failed'), { code: 'DRAFT_CHANGED' }); } });
    const job = queue.enqueue(batch('failed'));
    await assert.rejects(queue.drain());
    if (extra.journaled) job.journaled = true;
    if (extra.error) Object.assign(job.error, extra.error);
    if (extra.durable) job.durable = true;
    assert.equal(queue.discardRejectedSubmission(job.id), false); queue.dispose();
  }
});

test('captured scope and stale deletion rejections require review before journaled jobs release', async () => {
  for (const code of ['SAVE_SCOPE_CHANGED', 'DROPPED_PROMOTION_CHANGED', 'DELETE_STAGED_BASE_CHANGED', 'DELETE_STAGED_NOT_FOUND', 'DELETE_STAGED_CONFLICT']) {
    const error = Object.assign(new Error('A fresh decision is required'), { code });
    assert.equal(PendingSaves.requiresReview(error), true);
    assert.equal(PendingSaves.requiresReview({ ...error, durableUnknown: true }), false);
    const queue = PendingSaves.create({ save: async () => { throw error; } });
    const job = queue.enqueue(batch(code, 'Captured text', { resetStaging: code.startsWith('DELETE_STAGED_') }));
    job.journaled = true;
    await assert.rejects(queue.drain(), /fresh decision/);
    assert.equal(queue.discardRejectedSubmission(job.id), true);
    assert.equal(queue.snapshot().pending, 0); queue.dispose();
  }
  assert.equal(PendingSaves.requiresReview({ code: 'QUOTA_EXCEEDED' }), false);
});

test('disposing a queue cancels deferred intake without erasing recovery records', async () => {
  let writes = 0;
  const queue = PendingSaves.create({ save: async () => { writes++; return {}; } });
  const job = queue.enqueue(batch('first'));
  const drained = queue.drain(); queue.dispose(); await assert.rejects(drained, /queue is closed/);
  await tick(); assert.equal(writes, 0); assert.equal(queue.snapshot().jobs[0], job); assert.equal(queue.snapshot().pending, 1);
  assert.throws(() => queue.enqueue(batch('second')), /queue is closed/);
  await assert.rejects(queue.retry(), /queue is closed/);
});

(async () => {
  let failures = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log('PASS ' + name); }
    catch (error) { failures++; console.error('FAIL ' + name); console.error(error); }
  }
  console.log(`${tests.length - failures}/${tests.length} pending save checks passed`);
  if (failures) process.exitCode = 1;
})();
