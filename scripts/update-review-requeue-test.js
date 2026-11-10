'use strict';

// An update restart stops Summary analyses on purpose: they must not block the
// update, and the restarted app must run them again. A crash keeps the old,
// deliberate behavior of reporting an unconfirmed call without auto-retrying.
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { TerminalReview } = require('../src/terminalReview');
const { AgentRunner } = require('../src/agentRunner');
const tick = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };

const answer = request => `› ${request}\n• Fixed the bug and ran tests. The error display now explains which input the user needs to correct before continuing.\n─ Worked for 12s ─────\nThe changes are ready. The updated error message now explains which value.\n› `;
const reply = request => JSON.stringify({ tasks: [{ requestQuote: request, evidenceQuote: 'Fixed the bug', actual: 'Fixed', alignment: 'aligned' }] });
function fixture(file) {
  const session = { id: 'requeue', creationId: 'requeue:1', pid: 10, status: 'running' };
  const state = { now: 0, calls: [] };
  const service = new TerminalReview({ file, manager: () => ({ get: () => session }), now: () => state.now,
    monitor: { scan: () => ({ available: true, processes: [{ provider: 'codex', pid: 11, ancestorPids: [10] }] }) },
    runner: { generateTerminalReview: ({ prompt }) => new Promise((resolve, reject) => state.calls.push({ prompt, resolve, reject })) } });
  const capture = (text, extra = {}) => { state.now += 1000; return service.capture({ id: session.id, creationId: session.creationId, text, ...extra }); };
  async function complete(request) {
    const submission = { id: 'r1', request };
    await capture(`› ${request}\n• Working (esc to interrupt)`, { submission });
    await capture(answer(request), { submission });
    await capture(answer(request), { submission });
    await tick();
  }
  return { state, service, capture, complete };
}

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-update-review-'));
  const request = 'fix the input error';
  try {
    // Update: the in-flight call is requeued, the killed call's failure is discarded.
    let file = path.join(directory, 'update.json');
    let first = fixture(file);
    await first.complete(request);
    assert.equal(first.state.calls.length, 1, 'analysis is in flight');
    assert.deepEqual(first.service.stopForUpdate(), { requeued: 1 });
    first.state.calls[0].reject(new Error('process killed for update'));
    await tick();
    first.service.drain(); await tick();
    assert.equal(first.state.calls.length, 1, 'no new analysis starts while the update shuts down');
    let saved = JSON.parse(fs.readFileSync(file, 'utf8')).entries.requeue;
    assert.equal(saved.pendingCall, null);
    assert.ok(!saved.failed, 'a deliberate update stop is not recorded as a failure');
    assert.equal(saved.pending.length, 1);
    let restarted = fixture(file);
    await restarted.capture(answer(request), { submission: { id: 'r1', request } }); await tick();
    assert.equal(restarted.state.calls.length, 1, 'the restarted app runs the requeued analysis');
    restarted.state.calls[0].resolve({ text: reply(request) }); await tick();
    assert.ok(restarted.service.entries.get('requeue').result?.tasks?.length, 'the re-run publishes its analysis');

    // A failed install resumes the queue in the same app.
    file = path.join(directory, 'resume.json');
    first = fixture(file);
    await first.complete(request);
    first.service.stopForUpdate(); first.state.calls[0].reject(new Error('killed')); await tick();
    first.service.resumeAfterUpdate(); await tick();
    assert.equal(first.state.calls.length, 2, 'install failure resumes the requeued analysis');

    // Crash: unchanged. An unconfirmed call is reported, never replayed.
    file = path.join(directory, 'crash.json');
    first = fixture(file);
    await first.complete(request);
    restarted = fixture(file);
    const projected = await restarted.capture(answer(request), { submission: { id: 'r1', request } }); await tick();
    assert.equal(restarted.state.calls.length, 0, 'a crash-interrupted call is not replayed automatically');
    assert.match(projected.message || restarted.service.entries.get('requeue').message, /완료를 확인하지 못했어요/u);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }

  // Only user-facing runs can invalidate the user's update confirmation.
  const runner = Object.create(AgentRunner.prototype);
  const run = (id, extra) => [id, { id, provider: 'claude', child: { pid: 1 }, state: {}, ...extra }];
  Object.assign(runner, { active: new Map([run('review', { terminalReview: true, internalQuestionnaire: true })]), disposing: false });
  assert.deepEqual(runner.listActive().map(item => item.kind), ['terminal-review']);
  runner.prepareForUpdate([]); runner.disposing = false;
  runner.active = new Map([run('form', { internalQuestionnaire: true }), run('agent', {})]);
  assert.deepEqual(runner.listActive().map(item => item.kind), ['questionnaire', 'agent']);
  assert.throws(() => runner.prepareForUpdate([{ runId: 'form' }]), /새 직접 실행 작업/u);
  runner.disposing = false; runner.prepareForUpdate([{ runId: 'form' }, { runId: 'agent' }]);
  console.log('PASS update review requeue: Summary analyses never block updates, re-run after restart, resume on failure; crashes still not replayed');
})().catch(error => { console.error(error); process.exitCode = 1; });
