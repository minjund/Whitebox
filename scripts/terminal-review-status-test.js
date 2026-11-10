'use strict';
const assert = require('node:assert/strict');
const { TerminalReview } = require('../src/terminalReview');
const { reviewFailure } = require('../renderer/terminal-review-decision');
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };
const quote = '결과는 isEmpty로 검사합니다.';
function fixture() {
  let now = 100, completion = { available: true, state: 'working' };
  const session = { id: 'status', creationId: 'epoch', pid: 100, status: 'running' }, calls = [];
  const service = new TerminalReview({ now: () => now, quietMs: 0,
    manager: () => ({ get: () => session }),
    monitor: { scan: () => ({ available: true, processes: [{ provider: 'claude', pid: 101, ancestorPids: [100] }] }) },
    completion: { observe: async () => completion },
    runner: { generateTerminalReview: options => new Promise((resolve, reject) => calls.push({ ...options, resolve, reject })) } });
  return { service, calls,
    poll: extra => service.capture({ id: session.id, creationId: session.creationId, ...extra }),
    turn(id, { partial = false, updated = false } = {}) {
      completion = { available: true, state: partial ? 'working' : 'completed', requestId: id, request: '설명해줘', requestAt: completion.requestId === id ? completion.requestAt : ++now,
        evidence: `USER: 설명해줘\nASSISTANT: ${quote}${updated ? ' 최종 결과를 확인했습니다.' : ''}`,
        tools: { items: [{ name: 'Edit', status: 'returned', excerpt: '구현을 변경했습니다. 테스트 통과.' }] } };
      now++;
    },
    async succeed(index) {
      calls[index].resolve(JSON.stringify({ tasks: [{ requestQuote: '설명해줘', evidenceQuote: quote, actual: quote }] }));
      await settle();
    },
    async fail(index) { calls[index].reject(Error('fixture analysis unavailable')); await settle(); },
    // A generic failure is retried once automatically; fail that retry too.
    async failFinal(index) { await this.fail(index); assert.equal(calls.length, index + 2, 'one automatic retry'); await this.fail(index + 1); },
  };
}
module.exports = async function statusChecks() {
  for (const [nextId, partial] of [['first', false], ['second', false], ['second', true]]) {
    const f = fixture(); await f.poll(); f.turn('first'); await f.poll(); await settle();
    f.turn(nextId, { updated: true, partial }); await f.poll();
    await f.fail(0); assert.equal(f.calls.length, 2, 'new evidence drains after the older attempt fails');
    await f.succeed(1);
    const view = f.service.project(f.service.entries.get('status'));
    assert.equal(view.state, partial ? 'awaiting-answer' : 'ready', 'successful newest analysis clears an older failure without prematurely completing live work');
    assert.equal(view.message, ''); assert.equal(view.failure, null);
  }
  for (const partial of [false, true]) {
    const f = fixture(); await f.poll(); f.turn('same', { partial }); await f.poll(); await settle(); await f.succeed(0);
    const previous = (await f.poll()).result.tasks[0];
    f.turn('same', { updated: true }); await f.poll(); await settle(); await f.failFinal(1);
    const view = await f.poll();
    assert.equal(view.state, 'error', 'a failed newest analysis is not silently approved');
    assert.equal(view.result.tasks[0].analysisId, previous.analysisId, 'the previous article remains available');
    assert.equal(view.failure.retainedLifecycle, partial ? 'in-progress' : 'completed');
    const warning = reviewFailure(view);
    assert.equal(warning.kind, 'updated-evidence');
    assert.equal(warning.title, partial ? '최종 분석을 완료하지 못했습니다' : '추가 분석을 완료하지 못했습니다');
    assert.equal(reviewFailure({ ...view, result: { tasks: [{ ...previous, analysisId: 'foreign' }] } }), null, 'a different article cannot stand in for this failed review');
  }
  const retry = fixture(); await retry.poll(); retry.turn('same'); await retry.poll(); await settle(); await retry.succeed(0);
  await retry.poll({ reanalyze: true }); await settle(); await retry.failFinal(1);
  assert.equal(reviewFailure(await retry.poll()).kind, 'reanalysis');
  const initial = fixture(); await initial.poll(); initial.turn('new'); await initial.poll(); await settle(); await initial.failFinal(0);
  const initialView = await initial.poll();
  assert.equal(reviewFailure(initialView), null, 'without an earlier analysis there is no retained article to warn about');
  assert.equal(initialView.result.tasks[0].summaryFailure.kind, 'transient', 'the reply is shown as a failed summary card instead');
  console.log('PASS review status: late old failure/new success, updated evidence, partial/final scope, failed reanalysis, preserved articles and foreign/initial rejection');
};
if (require.main === module) module.exports().catch(error => { console.error(error); process.exitCode = 1; });
