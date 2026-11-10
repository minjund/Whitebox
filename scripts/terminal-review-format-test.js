'use strict';

const assert = require('node:assert/strict');
const { TerminalReview } = require('../src/terminalReview');
const tick = () => new Promise(resolve => setImmediate(resolve));
const settle = async () => { for (let i = 0; i < 8; i++) await tick(); };
const request = '버튼 문구를 바꿔줘';
const evidence = '버튼 문구를 변경했습니다.';
const usage = { input: 100, output: 20, cachedInput: 10, cacheWrite: 0, total: 120 };
const task = () => ({ requestQuote: request, evidenceQuote: evidence, actual: '문구 변경을 보고했습니다.', alignment: 'aligned',
  decision: { complexity: 'simple', conclusion: '버튼 문구가 변경됐습니다.',
    reasons: [{ text: '변경 완료가 답변에 보고됐습니다.', evidenceQuote: evidence }], caution: '',
    action: { kind: 'finish', text: '', why: '', request: '' }, alternatives: [] } });
const valid = () => JSON.stringify({ tasks: [task()] });

function fixture({ retrieval = false } = {}) {
  const session = { id: 'format', creationId: 'epoch', pid: 10, status: 'running' }, calls = [];
  let reads = 0;
  const completion = retrieval ? {
    prepareEvidence: async () => ({ records: [{ id: 'late' }], recovered: [], prior: [], readCount: 0 }),
    retrieveEvidence: async (_source, ids) => {
      reads++; assert.deepEqual(ids, ['late']);
      return [{ id: 'late', requestId: 'current', role: 'tool', status: 'available', text: '추가 검사 통과' }];
    },
  } : {};
  const service = new TerminalReview({ manager: () => ({ get: () => session }), completion, now: () => 2000,
    runner: { generateTerminalReview: options => new Promise((resolve, reject) => calls.push({ ...options, resolve, reject })) } });
  const previous = { tasks: [{ taskId: 'previous', actual: '이전 정상 분석' }] };
  const entry = { key: JSON.stringify([session.id, session.creationId, session.pid, session.createdAt]), provider: 'codex',
    pending: [], latest: {}, seen: {}, revision: 0, locale: 'ko', result: previous, state: 'collecting' };
  const chunk = { taskId: 'current', request, text: `ASSISTANT: ${evidence}`, lifecycle: 'completed', submittedAt: 1000, observedAt: 2000,
    tools: { items: [{ name: 'Edit', status: 'returned', excerpt: evidence }] },
    ...(retrieval ? { source: { file: 'owned-log', requestId: 'current' } } : {}) };
  service.entries.set(session.id, entry);
  service.scheduling.set(session.id, { session, analysis: { provider: 'codex', models: { codex: 'fixture-model' } } });
  service.enqueue(session.id, entry, chunk);
  service.drain();
  return { service, session, entry, previous, chunk, calls, get reads() { return reads; },
    async reply(index, text, tokens = usage, contract = {}) { calls[index].resolve({ text, usage: tokens, ...contract }); await settle(); } };
}

module.exports = async function formatChecks() {
  const invalid = [
    '{"tasks":[]}',
    JSON.stringify({ tasks: [task(), task()] }),
    '{"tasks":[',
    'not JSON: UNTRUSTED_DRAFT_MARKER',
    '{"tasks":[null]}',
    valid() + '\n{"tasks":[]}',
  ];
  for (const raw of invalid) {
    const f = fixture(); await settle(); await f.reply(0, raw);
    assert.equal(f.calls.length, 2, 'invalid JSON/task boundaries automatically receive one replacement');
    assert.equal(f.entry.state, 'reviewing', 'recovery remains in progress without publishing a failure');
    assert.equal(f.entry.result, f.previous, 'invalid responses never overwrite the previous analysis');
    assert.match(f.calls[1].prompt, /QUALITY REPAIR/u);
    assert.match(f.calls[1].prompt, /exactly one task/u);
    assert.doesNotMatch(f.calls[1].prompt, /UNTRUSTED_DRAFT_MARKER/u, 'model drafts cannot become evidence or instructions');
    assert.equal(f.calls[1].provider, 'codex'); assert.equal(f.calls[1].model, 'fixture-model');
    await f.reply(1, valid());
    assert.equal(f.entry.state, 'ready'); assert.equal(f.entry.message, '');
    const recovered = f.entry.result.tasks.find(item => item.taskId === 'current');
    assert.ok(recovered.decision); assert.equal(recovered.qualityPasses, 2);
    assert.equal(recovered.analysisUsage.total, 240); assert.equal(recovered.analysisMetrics.calls, 2);
  }
  const answerFirst = task(); delete answerFirst.decision;
  answerFirst.content = { version: 2,
    answer: { text: '버튼 문구 변경이 보고됐습니다.', basis: 'reported', quote: evidence },
    details: [], limitations: [], deliverables: [], background: [],
    handoff: { kind: 'finish', temporal: null, priority: { text: '요청한 변경이 보고되어 추가 요청은 필요하지 않습니다.', basis: 'inference', quote: evidence }, prompt: null } };
  const contract = { reviewFormat: 'answer-first-v2', handoffRequired: true };
  for (const malformed of [false, true]) {
    const f = fixture(); await settle();
    if (malformed) await f.reply(0, '{"tasks":[]}', usage, contract);
    await f.reply(malformed ? 1 : 0, JSON.stringify({ tasks: [answerFirst] }), usage, contract);
    assert.equal(f.entry.state, 'ready', 'compact content and handoff survive format recovery');
    assert.equal(f.calls.length, malformed ? 2 : 1, 'valid answer-first content needs no unused legacy decision repair');
    assert.equal(f.entry.result.tasks.find(item => item.taskId === 'current').content.version, 2);
  }
  const correct = fixture(); await settle(); await correct.reply(0, valid());
  assert.equal(correct.calls.length, 1, 'valid output has no extra call');

  for (const replacement of ['{"tasks":[]}', '{"tasks":[', JSON.stringify({ tasks: [{ ...task(), evidenceQuote: '원문에 없는 근거' }] })]) {
    const f = fixture(); await settle(); await f.reply(0, '{"tasks":[]}'); await f.reply(1, replacement);
    assert.equal(f.calls.length, 2); assert.equal(f.entry.state, 'error');
    assert.equal(f.entry.result.tasks.find(item => item.taskId === 'previous').actual, '이전 정상 분석', 'failed repair retains the last usable analysis');
    const failedCard = f.entry.result.tasks.find(item => item.taskId === 'current');
    assert.deepEqual([failedCard.summaryFailure?.kind, failedCard.actual, failedCard.content], ['quality', evidence, undefined], 'a final failure shows the reply as a failed summary card');
    f.service.enqueue(f.session.id, f.entry, { ...f.chunk }); f.service.drain(); await settle();
    assert.equal(f.calls.length, 2, 'unchanged failed evidence does not trigger a retry loop');
  }
  const noDecision = fixture(); await settle(); await noDecision.reply(0, '{"tasks":[]}');
  const legacy = task(); delete legacy.decision;
  await noDecision.reply(1, JSON.stringify({ tasks: [legacy] }));
  const legacyResult = noDecision.entry.result.tasks.find(item => item.taskId === 'current');
  assert.equal(legacyResult.decision, null); assert.equal(legacyResult.nextStep, '');
  assert.ok(legacyResult.decisionIssues.includes('missing decision'));
  assert.equal(noDecision.calls.length, 2, 'format recovery cannot trigger a second quality repair');

  const badDecision = fixture(); await settle();
  const overlong = task(); overlong.decision.conclusion = '긴'.repeat(181);
  await badDecision.reply(0, JSON.stringify({ tasks: [overlong] }));
  await badDecision.reply(1, '{"tasks":[]}');
  assert.equal(badDecision.calls.length, 2, 'a malformed quality replacement cannot start another format-repair call');
  assert.equal(badDecision.entry.state, 'error');
  assert.equal(badDecision.entry.result.tasks.find(item => item.taskId === 'previous').actual, '이전 정상 분석');
  assert.equal(badDecision.entry.result.tasks.find(item => item.taskId === 'current').summaryFailure.kind, 'quality');

  const unknownUsage = fixture(); await settle(); await unknownUsage.reply(0, '{"tasks":[]}', null); await unknownUsage.reply(1, valid());
  assert.equal(unknownUsage.entry.result.tasks.find(item => item.taskId === 'current').analysisUsage, null);
  const timeout = fixture(); await settle(); timeout.calls[0].reject(Error('timeout')); await settle();
  assert.equal(timeout.calls.length, 2, 'a time-limit failure is retried once as a fresh call, not as a format repair');
  assert.doesNotMatch(timeout.calls[1].prompt, /QUALITY REPAIR/u);
  timeout.calls[1].reject(Error('timeout')); await settle();
  assert.equal(timeout.calls.length, 2, 'only one automatic retry');
  assert.equal(timeout.entry.state, 'error');
  assert.equal(timeout.entry.result.tasks.find(item => item.taskId === 'current').summaryFailure.kind, 'transient');
  const login = fixture(); await settle(); login.calls[0].reject(Error('Invalid API key · Please run /login')); await settle();
  assert.equal(login.calls.length, 1, 'a login failure is not retried');
  assert.equal(login.entry.result.tasks.find(item => item.taskId === 'current').summaryFailure.kind, 'auth');

  const retrieved = fixture({ retrieval: true }); await settle();
  await retrieved.reply(0, JSON.stringify({ tasks: [task()], evidenceRequests: ['late'] }));
  assert.equal(retrieved.reads, 1); assert.equal(retrieved.calls.length, 2);
  await retrieved.reply(1, '{"tasks":[]}');
  assert.equal(retrieved.calls.length, 3, 'a malformed answer after evidence retrieval still gets one format repair');
  assert.match(retrieved.calls[2].prompt, /추가 검사 통과/u);
  await retrieved.reply(2, valid());
  const retrievedTask = retrieved.entry.result.tasks.find(item => item.taskId === 'current');
  assert.equal(retrievedTask.analysisUsage.total, 360); assert.equal(retrievedTask.analysisMetrics.calls, 3);
  assert.equal(retrieved.reads, 1, 'recovery uses the same scoped evidence without another retrieval loop');

  for (const change of ['revision', 'process', 'removed']) {
    const f = fixture(); await settle(); await f.reply(0, '{"tasks":[]}');
    if (change === 'revision') f.entry.revision++;
    else if (change === 'process') f.session.pid++;
    else f.service.forget(f.session.id);
    await f.reply(1, valid());
    assert.equal(f.entry.result, f.previous, 'late repair cannot publish after the terminal identity changes');
    assert.equal(f.calls.length, 2);
  }
  const interrupted = fixture(); await settle(); await interrupted.reply(0, '{"tasks":[]}');
  interrupted.chunk.lifecycle = 'interrupted'; await interrupted.reply(1, valid());
  const interruptedTask = interrupted.entry.result.tasks.find(item => item.taskId === 'current');
  assert.equal(interruptedTask.lifecycle, 'interrupted'); assert.equal(interruptedTask.decision, null);
  console.log('PASS review format recovery: JSON/empty/multiple tasks, one safe repair, grounding, cache retention, usage, scoped retrieval and stale/interrupted isolation');
};

if (require.main === module) module.exports().catch(error => { console.error(error); process.exitCode = 1; });
