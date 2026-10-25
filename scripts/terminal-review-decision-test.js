'use strict';
const assert = require('node:assert/strict');
const { assessDecision, combinedUsage } = require('../src/terminalReviewDecision');
const { TerminalReview, parseReview } = require('../src/terminalReview');
const { render } = require('../renderer/terminal-review-decision');
const tick = () => new Promise(resolve => setImmediate(resolve));
const request = '버튼 문구를 바꿔줘';
const evidence = '버튼 문구를 변경했습니다. 긴 문구 표시는 확인하지 않았습니다.';
const fixture = () => ({ complexity: 'simple', conclusion: '버튼 문구가 변경됐습니다.',
  reasons: [{ text: '변경 완료가 답변에 보고됐습니다.', evidenceQuote: '버튼 문구를 변경했습니다.' }],
  caution: '긴 문구 표시는 확인되지 않았습니다.',
  action: { kind: 'verify', text: '긴 문구의 줄바꿈을 확인하세요.', why: '작은 화면에서 버튼을 읽을 수 있어야 합니다.', request: '작은 화면에서 긴 버튼 문구의 줄바꿈을 확인해줘.' }, alternatives: [] });
const response = decision => ({ tasks: [{ requestQuote: request, evidenceQuote: evidence, actual: '문구 변경을 보고했습니다.', alignment: 'aligned', decision }] });
const parse = decision => parseReview(JSON.stringify(response(decision)), evidence, 'ko', request).tasks[0];
const usage = { input: 100, output: 20, cachedInput: 10, cacheWrite: 0, total: 120 };

module.exports = async function decisionChecks() {
  assert.ok(parse(fixture()).decision);
  assert.equal(parse(fixture()).nextStep, fixture().action.request);
  let bad = fixture(); bad.reasons[0].evidenceQuote = '모든 테스트 통과';
  assert.equal(parse(bad).decision, null, 'an invented CURRENT quote cannot support a decision');
  assert.equal(parse(bad).nextStep, '', 'a rejected recommendation cannot become a follow-up');
  bad = fixture(); bad.action.kind = 'finish'; bad.action.request = '';
  assert.ok(parse(bad).decision, 'completed work can finish without inventing a new task');
  assert.equal(parseReview(JSON.stringify(response(bad)), evidence, 'ko', request, 'interrupted').tasks[0].decision, null);
  assert.equal(assessDecision(bad, { source: evidence, supported: true, unverified: [{}] }).decision, null);
  bad = fixture(); bad.caution = '';
  assert.equal(assessDecision(bad, { source: `${evidence}\n[omitted: evidence exceeds budget]`, supported: true }).decision, null);
  bad = fixture(); bad.action.text = bad.conclusion;
  assert.ok(parse(bad).decisionIssues.includes('repeated explanation'));
  bad = fixture(); bad.action.kind = 'choose';
  assert.equal(parse(bad).decision, null, 'a real choice requires alternatives');
  bad.alternatives = [{ option: '고정 너비', tradeoff: '정렬은 쉽지만 긴 문구가 잘릴 수 있습니다.', when: '문구 길이를 제한할 수 있을 때' },
    { option: '가변 너비', tradeoff: '문구는 보이지만 배치가 바뀔 수 있습니다.', when: '다양한 문구 길이를 지원할 때' }];
  assert.ok(parse(bad).decision);
  bad = fixture(); bad.complexity = 'simple'; bad.conclusion = '가'.repeat(180);
  assert.ok(parse(bad).decisionIssues.includes('first-screen length'));
  for (const complexity of ['standard', 'complex']) {
    bad.complexity = complexity;
    assert.ok(parse(bad).decision);
  }
  assert.equal(combinedUsage(usage, null), null);
  assert.deepEqual(combinedUsage(usage, usage), { input: 200, output: 40, cachedInput: 20, cacheWrite: 0, total: 240 });

  const esc = value => String(value).replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;');
  const options = { t: value => value, esc, taskKey: 'fixture' };
  assert.equal(render({}, options), '', 'old cached analyses use their existing display');
  const task = parse(fixture());
  task.decision.conclusion = '<img src=x onerror=alert(1)>';
  const html = render(task, options);
  assert.doesNotMatch(html, /<img/u);
  assert.match(html, /&lt;img/u);
  assert.ok(html.indexOf('현재 결론') < html.indexOf('판단 이유') && html.indexOf('판단 이유') < html.indexOf('권하는 다음 행동'));
  assert.doesNotMatch(html, /선택지 비교/u, 'simple work has no empty choice section');
  assert.doesNotMatch(html, /버튼 문구를 변경했습니다\./u, 'verbatim quotes stay in the detailed evidence section');

  async function run(replies, { interruptDuringRepair = false, invalidateDuringRepair = false } = {}) {
    const session = { id: 'decision', creationId: 'epoch', pid: 10, status: 'running' };
    let completion = { available: true };
    const calls = [];
    let service;
    service = new TerminalReview({ manager: () => ({ get: () => session }), now: () => 2000,
      completion: { observe: async () => completion },
      monitor: { scan: () => ({ available: true, processes: [{ provider: 'codex', pid: 11, ancestorPids: [10] }] }) },
      runner: { generateTerminalReview: async options => {
        calls.push(options);
        if (interruptDuringRepair && calls.length === 2) Object.values(service.entries.get('decision').latest)[0].lifecycle = 'interrupted';
        if (invalidateDuringRepair && calls.length === 2) service.entries.get('decision').revision++;
        return { text: JSON.stringify(response(replies[calls.length - 1])), usage };
      } } });
    await service.capture({ id: session.id, creationId: session.creationId, text: 'frame' });
    completion = { available: true, requestAt: 2000, requestId: 'one', request, state: 'completed', evidence: `ASSISTANT: ${evidence}`,
      tools: { source: 'session', items: [{ name: 'Edit', status: 'returned', excerpt: '문구 변경 완료' }] } };
    await service.capture({ id: session.id, creationId: session.creationId, text: 'frame', submission: { id: 'one', request, at: 2000 } });
    for (let i = 0; i < 12; i++) await tick();
    return { calls, task: service.entries.get('decision').result?.tasks[0], service };
  }
  let result = await run([fixture()]);
  assert.equal(result.calls.length, 1, 'valid concise output incurs no repair call');
  assert.equal(result.task.qualityPasses, 1);
  bad = fixture(); bad.conclusion = '긴'.repeat(181);
  result = await run([bad, fixture()]);
  assert.equal(result.calls.length, 2);
  assert.ok(result.task.decision);
  assert.equal(result.task.analysisUsage.total, 240, 'repair usage is counted with the original call');
  assert.match(result.calls[1].prompt, /QUALITY REPAIR/u);
  assert.doesNotMatch(result.calls[1].prompt, /긴{181}/u, 'invalid draft is never injected as new evidence');
  result = await run([bad, bad]);
  assert.equal(result.calls.length, 2, 'repair is bounded to one extra call');
  assert.equal(result.task.decision, null);
  assert.equal(result.task.nextStep, '');
  result = await run([bad, undefined]);
  assert.ok(result.task.decisionIssues.includes('missing decision'), 'a repair cannot silently fall back to legacy output');
  result = await run([bad, fixture()], { invalidateDuringRepair: true });
  assert.equal(result.task, undefined, 'a repair from an invalidated session cannot publish');
  const finished = fixture(); finished.action.kind = 'finish'; finished.action.request = '';
  result = await run([bad, finished], { interruptDuringRepair: true });
  assert.equal(result.task.lifecycle, 'interrupted');
  assert.equal(result.task.decision, null, 'late repair cannot finish an interrupted request');
  console.log('PASS decision brief: evidence, uncertainty, adaptive length, alternatives, safe rendering, single repair, usage and interruption');
};

if (require.main === module) module.exports().catch(error => { console.error(error); process.exitCode = 1; });
