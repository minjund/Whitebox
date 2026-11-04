'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assessContent, contentIdentity, historyContent, evidenceFor, sourceExcerpt } = require('../src/terminalReviewContent');
const { parseReview, reviewPrompt, TerminalReview } = require('../src/terminalReview');
const { render, applyHistoryContent } = require('../renderer/terminal-review-decision');
const { AgentRunner } = require('../src/agentRunner');

const request = '문서를 작성하고 명령어도 보여줘';
const record = 'ASSISTANT: 문서를 작성했다고 보고했습니다. 본문 조회 결과는 없습니다.\n명령어: docker compose ps';
const observed = 'created page id=123';
const evidence = { source: record + '\n' + observed, observed };
const fixture = () => ({ version: 1,
  answer: { text: '문서 생성은 보고됐지만 작성된 본문의 정확성은 확인할 수 없습니다.', basis: 'reported', quote: '문서를 작성했다고 보고했습니다.' },
  details: [{ text: 'docker compose ps는 현재 컨테이너 상태를 확인하는 명령으로 안내됐습니다.', basis: 'reported', quote: '명령어: docker compose ps' }],
  limitations: [{ text: '페이지 식별자는 본문의 내용을 확인한 결과가 아닙니다.', quote: 'created page id=123' }],
  deliverables: [{ label: '안내된 명령어', kind: 'command', value: 'docker compose ps', basis: 'reported', quote: '명령어: docker compose ps' }],
});
const esc = value => String(value).replace(/[&<>"']/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const options = { t: value => value, esc, taskKey: 'one' };
const parse = value => parseReview(JSON.stringify({ tasks: [{ requestQuote: request, evidenceQuote: '문서를 작성했다고 보고했습니다.', alignment: 'aligned', actual: '생성 보고', content: value }] }), evidence.source, 'ko', request, 'completed', '', observed).tasks[0];

async function main() {
  const transformer = Object.create(AgentRunner.prototype);
  transformer.generateQuestionnaire = async () => ({ text: '{"tasks":[]}', usage: null });
  assert.equal((await transformer.generateTerminalReview({})).reviewFormat, 'answer-first-v2', 'fresh production calls declare their required content contract independently of model output');
  const decoded = evidenceFor({ assistantUpdates: { items: ['A\n\n"B"'] }, reviewContext: { items: [{ request: 'earlier', answer: 'literal\nanswer' }] }, toolEvidence: { items: [{ status: 'error', excerpt: 'Exit code 1' }] } });
  assert.ok(decoded.source.includes('A\n\n"B"'), 'original multi-line reports remain exactly citable');
  assert.ok(decoded.source.includes('literal\nanswer'));
  assert.equal(decoded.observed, 'Exit code 1', 'recorded failures are observations too');
  assert.equal(sourceExcerpt('first\n\nsecond', 'first\n  \n  second'), 'first\n  \n  second', 'only original source bytes are displayed after whitespace recovery');
  assert.equal(sourceExcerpt('docker compose down', 'docker compose ps'), '', 'command tokens cannot be rewritten');
  assert.equal(sourceExcerpt('a b', 'a\n b; a\n\nb'), '', 'different possible original byte sequences are ambiguous');
  assert.deepEqual(assessContent(fixture(), evidence).issues, []);
  const omission = '[omitted: evidence exceeds budget]';
  let limited = fixture(); limited.limitations = [{ text: '목록 일부가 생략되어 전체 항목의 부재는 판단할 수 없습니다.', quote: omission }];
  assert.ok(assessContent(limited, { ...evidence, source: evidence.source + '\n' + omission }).content, 'omission metadata can document an evidence limitation');
  limited.answer.quote = omission;
  assert.equal(assessContent(limited, { ...evidence, source: evidence.source + '\n' + omission }).content, null, 'omission metadata cannot substantiate an answer');
  let bad = fixture(); bad.answer.basis = 'observed';
  assert.ok(assessContent(bad, evidence).issues.includes('answer observed attribution'), 'a narrative cannot be upgraded to a tool observation');
  bad = fixture(); bad.answer.quote = 'all tests pass';
  assert.equal(assessContent(bad, evidence).content, null, 'invented citations cannot validate a claim');
  bad = fixture(); bad.answer.text = '질문에 직접 답했고 요청을 충족했습니다.';
  assert.ok(assessContent(bad, evidence).issues.includes('answer is only a verdict'));
  bad = fixture(); bad.deliverables[0].value = 'docker compose down';
  assert.ok(assessContent(bad, evidence).issues.includes('deliverable 0 invented output'), 'the model cannot substitute a different command');
  bad = fixture(); bad.deliverables[0] = { label: 'unsafe', kind: 'url', value: 'javascript:alert(1)', basis: 'reported', quote: 'javascript:alert(1)' };
  assert.ok(assessContent(bad, { ...evidence, source: evidence.source + '\njavascript:alert(1)' }).issues.includes('deliverable 0 unsafe URL'));
  bad = fixture(); bad.details[0].text = '가'.repeat(1601);
  assert.equal(assessContent(bad, evidence).content, null, 'overlong facts are rejected, never silently truncated');
  assert.ok(assessContent({ version: 1, answer: { text: '보존된 원문이 없어 확인할 수 없습니다.', basis: 'unknown', quote: '' }, details: [], limitations: [], deliverables: [] }, { source: '' }).content);
  const task = { ...parse(fixture()), taskId: 'turn', analysisId: 'original', evidenceDigest: 'digest' };
  assert.equal(render({ content: { version: 1, details: null } }, options), '', 'a corrupt nested cache cannot break the workspace');
  assert.ok(task.content);
  const compact = { ...fixture(), version: 2, background: [{ text: 'ADDITIONAL_STEP_EXPLANATION', basis: 'reported', quote: '명령어: docker compose ps' }] };
  assert.ok(assessContent(compact, evidence).content);
  const compactVisible = render({ content: compact }, options).replace(/<details[\s\S]*?<\/details>/gu, '');
  assert.ok(compactVisible.includes('docker compose ps'), 'requested literal commands remain visible in compact reviews');
  assert.ok(compactVisible.includes('본문의 내용을 확인한 결과가 아닙니다'), 'compact reviews keep material uncertainty visible');
  assert.ok(compactVisible.indexOf('본문의 내용을 확인한 결과가 아닙니다') < compactVisible.indexOf('docker compose ps는'), 'material limits appear immediately after the answer, ahead of mechanism and supporting detail');
  assert.ok(!compactVisible.includes('ADDITIONAL_STEP_EXPLANATION'), 'background starts collapsed');
  const actionable = { ...compact, nextAction: { text: '작성된 문서 본문을 조회해 실제 반영 내용을 확인합니다.', basis: 'inference', quote: '본문 조회 결과는 없습니다.' } };
  assert.ok(assessContent(actionable, evidence).content);
  const actionHtml = render({ content: actionable }, options).replace(/<details[\s\S]*?<\/details>/gu, '');
  assert.ok(actionHtml.indexOf('실제 답') < actionHtml.indexOf('판단 근거') && actionHtml.indexOf('판단 근거') < actionHtml.indexOf('필요한 다음 행동'), 'pyramid order preserves answer, decisive reasons and next action');
  assert.ok(actionHtml.includes(actionable.nextAction.text));
  assert.equal(parse(actionable).nextStep, '', 'a suggested action does not silently become an executable follow-up');
  assert.equal(assessContent({ ...actionable, nextAction: { ...actionable.nextAction, quote: 'invented proof' } }, evidence).content, null, 'the next action also needs source grounding');
  assert.doesNotMatch(render({ content: compact }, options), /필요한 다음 행동/u, 'completed explanations do not invent an empty action section');
  const overBudget = { ...compact, answer: { ...compact.answer, text: '가'.repeat(220) }, details: [
    { ...compact.answer, text: '나'.repeat(140) }, { ...compact.answer, text: '다'.repeat(140) }], limitations: [{ text: '라'.repeat(140), quote: '' }] };
  assert.ok(assessContent(overBudget, evidence).issues.includes('compact explanation length'), 'verbose retellings cannot silently enter the compact format');
  assert.equal(parse(bad).content, null);
  const html = render(task, options);
  const visible = html.replace(/<details[\s\S]*?<\/details>/gu, '');
  for (const expected of ['실제 답', '정확성은 확인할 수 없습니다', '본문의 내용을 확인한 결과가 아닙니다', 'docker compose ps', '대화 원문 기준']) assert.ok(visible.includes(expected), `${expected} must be visible without opening details`);
  assert.equal((visible.match(/wb-content-source/gu) || []).length, 1, 'source scope appears once for the whole explanation');
  assert.doesNotMatch(visible, /보고된 내용|wb-content-basis/u, 'reported-only prose and outputs do not repeat source badges');
  const qualified = fixture(); qualified.details = [
    { text: '페이지 생성 출력이 있습니다.', basis: 'observed', quote: observed },
    { text: '기록상 식별자는 123입니다.', basis: 'observed', quote: observed },
    { text: '본문 저장은 추론입니다.', basis: 'inference', quote: observed },
    { text: '본문 정확성은 알 수 없습니다.', basis: 'unknown', quote: '' },
  ];
  const scoped = render({ content: qualified }, options).replace(/<details[\s\S]*?<\/details>/gu, '');
  for (const label of ['도구 출력', '추론', '확인 안 됨']) assert.equal((scoped.match(new RegExp(`class="wb-content-basis">${label}</span>`, 'gu')) || []).length, 1, `${label} remains visible without repeated labels`);
  assert.doesNotMatch(visible, /요청을 충족|현재 결론/u);
  bad = fixture(); bad.answer.text = '<img src=x onerror=alert(1)>';
  bad.deliverables[0].value = '<script>alert(1)</script>';
  const malicious = render({ content: bad }, options);
  assert.doesNotMatch(malicious, /<script|<img/u);
  assert.match(malicious, /&lt;script/u);
  const legacy = render({ decision: { conclusion: '본문 정확성까지 확인됐습니다.', reasons: [], alternatives: [], caution: '', action: {} },
    actual: '생성을 보고했습니다.', understanding: '원문에 있던 핵심 설명', verification: '본문은 조회하지 못했습니다.' }, options);
  assert.match(legacy, /원문 재검토 전/u);
  assert.match(legacy, /본문은 조회하지 못했습니다/u);
  assert.match(legacy, /원문에 있던 핵심 설명/u);
  assert.doesNotMatch(legacy, /본문 정확성까지 확인됐습니다/u, 'legacy certainty cannot override its recorded limitation');

  const item = { sessionId: 's', creationId: 'creation', identity: contentIdentity(task), content: fixture(), evidence, generatedAt: '2026-11-04', usage: { total: 50 } };
  assert.equal(applyHistoryContent(task, [item], 's', 'creation').contentGeneratedAt, '2026-11-04');
  for (const changed of [{ taskId: 'other' }, { analysisId: 'new' }, { request: 'different request' }, { evidenceDigest: 'new evidence' }]) {
    const updated = { ...task, ...changed, content: null };
    assert.equal(applyHistoryContent(updated, [item], 's', 'creation'), updated, 'stale history cannot replace a new analysis');
  }
  assert.equal(applyHistoryContent(task, [item], 's', 'new creation'), task);
  assert.equal(applyHistoryContent(task, [item], 'different session', 'creation'), task);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-history-test-'));
  try {
    const reviews = path.join(dir, 'terminal-reviews.json');
    fs.writeFileSync(reviews, '{"original":true}');
    fs.writeFileSync(path.join(dir, 'terminal-review-content-backfill.json'), JSON.stringify({ version: 1, entries: [item, { ...item, content: bad }] }));
    assert.equal(historyContent(reviews).length, 1, 'invalid additions are not imported');
    const service = new TerminalReview({ file: reviews });
    const response = await service.capture({ historyContent: true });
    assert.equal(response.entries.length, 1, 'loading archived content does not need a live process or start a model');
    assert.equal(fs.readFileSync(reviews, 'utf8'), '{"original":true}', 'loading explanations never rewrites live review state');
    fs.writeFileSync(path.join(dir, 'terminal-review-content-backfill.json'), 'corrupt');
    assert.deepEqual(historyContent(reviews), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  assert.match(reviewPrompt(record, 'ko', request), /ANSWER-FIRST FORMAT/u);
  console.log('PASS answer-first content: direct answer, visible mechanism/limits/commands, exact outputs, provenance validation, safe rendering, archived identity and non-destructive import');
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = main;
