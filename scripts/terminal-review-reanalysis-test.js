'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TerminalReview } = require('../src/terminalReview');
const tick = () => new Promise(resolve => setImmediate(resolve));

module.exports = async function reanalysisChecks() {
  function fixture({ file = '' } = {}) {
    let now = 100, completion = { available: true, state: 'working' }, available = true, gateCalls = 0;
    const session = { id: 'rerun', creationId: 'epoch', pid: 10, status: 'running' }, calls = [];
    const service = new TerminalReview({ now: () => now, quietMs: 0, file,
      manager: () => ({ get: () => session }), completion: { observe: async () => completion },
      monitor: { scan: () => ({ available: true, processes: [{ provider: 'claude', pid: 11, ancestorPids: [10] }] }) },
      jev: { screenAnalysisNeed: async () => { gateCalls++; throw Error('manual requests must bypass screening'); } },
      runner: { canGenerateTerminalReview: () => available,
        generateTerminalReview: options => new Promise((resolve, reject) => calls.push({ ...options, resolve, reject })) } });
    return { service, session, calls, get gateCalls() { return gateCalls; },
      capture: options => service.capture({ id: session.id, creationId: session.creationId, text: 'frame', ...options }),
      completed() { completion = { available: true, state: 'completed', requestId: 'q1', request: '설명해줘', requestAt: ++now,
        evidence: 'USER: 설명해줘\nASSISTANT: 결과는 isEmpty로 검사합니다.', tools: { source: 'session', items: [] } }; },
      working() { completion = { ...completion, state: 'working', requestId: 'q2', request: '다음 작업', requestAt: ++now }; },
      greeting() { completion = { available: true, state: 'completed', requestId: 'greeting', request: 'ㅎㅇ', requestAt: ++now,
        evidence: 'USER: ㅎㅇ\nASSISTANT: 안녕하세요' }; },
      setAvailable(value) { available = value; },
      async finish(index) {
        const call = calls[index];
        call.resolve({ text: JSON.stringify({ tasks: [{ requestQuote: '설명해줘', evidenceQuote: '결과는 isEmpty로 검사합니다.',
          actual: `분석 ${index + 1}`, alignment: 'aligned' }] }), usage: { total: 100 + index } });
        for (let i = 0; i < 8; i++) await tick();
      } };
  }
  const f = fixture();
  await f.capture(); f.completed(); await f.capture(); await tick();
  assert.equal(f.calls.length, 1);
  await f.finish(0);
  const original = f.service.entries.get('rerun').result.tasks[0];
  await f.capture({ force: true }); await f.capture();
  assert.equal(f.calls.length, 1, 'selection and background refreshes keep billing deduplicated');
  await f.capture({ reanalyze: true, analysis: { provider: 'claude', jevEnabled: true, models: { claude: 'explicit-model' } } }); await tick();
  assert.equal(f.calls.length, 2, 'explicit reanalysis generates again from identical evidence');
  assert.equal(f.calls[1].model, 'explicit-model');
  assert.equal(f.gateCalls, 0);
  await Promise.all([f.capture({ reanalyze: true }), f.capture({ reanalyze: true }), f.capture()]);
  assert.equal(f.calls.length, 2, 'double clicks and polling join the active analysis');
  await f.finish(1);
  const updated = f.service.entries.get('rerun').result.tasks;
  assert.equal(updated.length, 1); assert.equal(updated[0].taskId, original.taskId);
  assert.equal(updated[0].actual, '분석 2'); assert.equal(updated[0].analysisDepth, 'manual');
  assert.equal(updated[0].analysisRuns.length, 2);
  assert.deepEqual(updated[0].analysisRuns.map(run => run.analysisUsage.total), [100, 101]);
  assert.notEqual(updated[0].analysisId, original.analysisId);
  await f.capture(); assert.equal(f.calls.length, 2, 'new result is cached after the explicit request');
  await f.capture({ reanalyze: true }); await tick();
  f.calls[2].reject(Error('model unavailable')); await tick();
  assert.equal(f.service.entries.get('rerun').result.tasks[0].actual, '분석 2', 'failure retains the last usable result');
  assert.equal((await f.capture()).state, 'error'); assert.equal(f.calls.length, 3);
  await f.capture({ force: true }); assert.equal(f.calls.length, 3, 'selection does not retry a failed manual request');
  await f.capture({ reanalyze: true }); await tick(); assert.equal(f.calls.length, 4);
  await f.finish(3);

  const off = fixture(); off.completed();
  await off.capture({ enabled: false });
  await off.capture({ enabled: false, reanalyze: true }); await tick();
  assert.equal(off.calls.length, 1, 'explicit button can review existing completed evidence with automatic review off');
  const pausedPoll = await off.capture({ enabled: false });
  assert.equal(pausedPoll.state, 'reviewing'); assert.equal(pausedPoll.manual, true);
  await off.finish(0); await off.capture({ enabled: false }); assert.equal(off.calls.length, 1);

  const queued = fixture(); await queued.capture(); queued.completed(); await queued.capture(); await tick(); await queued.finish(0);
  queued.setAvailable(false);
  await queued.capture({ reanalyze: true, analysis: { jevEnabled: true } });
  await queued.capture({ enabled: false, analysis: { jevEnabled: true } });
  assert.equal(queued.service.entries.get('rerun').pending.length, 1);
  queued.setAvailable(true); queued.service.drain(); await tick();
  assert.equal(queued.calls.length, 2); assert.equal(queued.gateCalls, 0, 'queued manual intent survives automatic polling');
  await queued.finish(1);

  const recorded = fixture(); await recorded.capture(); recorded.greeting(); await recorded.capture(); await tick();
  assert.equal(recorded.calls.length, 0, 'mechanical records remain free during automatic observation');
  await recorded.capture({ reanalyze: true }); await tick();
  assert.equal(recorded.calls.length, 1, 'explicit reanalysis also honors previously skipped completed records');
  recorded.calls[0].resolve(JSON.stringify({ tasks: [{ requestQuote: 'ㅎㅇ', evidenceQuote: '안녕하세요', actual: '인사에 답했습니다.', alignment: 'aligned' }] }));
  await tick();

  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-manual-review-'));
  try {
    const file = path.join(folder, 'reviews.json'), persisted = fixture({ file });
    await persisted.capture(); persisted.completed(); await persisted.capture(); await tick(); await persisted.finish(0);
    await persisted.capture({ reanalyze: true }); await tick();
    const restored = fixture({ file });
    const view = await restored.capture();
    assert.equal(view.state, 'error', 'restart preserves an unconfirmed manual run despite an older identical cached result');
    assert.equal(restored.calls.length, 0, 'restart never silently repeats a billable manual request');
    assert.equal(view.result.tasks[0].actual, '분석 1');
    persisted.service.forget('rerun');
    persisted.calls[1].resolve('{}'); await tick();
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }

  f.working(); await f.capture({ reanalyze: true }); await tick();
  assert.equal(f.calls.length, 4, 'manual request never turns an unfinished answer into a completed review');
  const stale = await f.service.capture({ id: 'rerun', creationId: 'different', reanalyze: true });
  assert.equal(stale.state, 'unbound'); assert.equal(f.calls.length, 4);
  console.log('PASS explicit reanalysis: fresh model call, same task/history/usage, click coalescing, errors/retry, auto-off, queue, Jev bypass, unfinished answers and identity guards');
};

if (require.main === module) module.exports().catch(error => { console.error(error); process.exitCode = 1; });
