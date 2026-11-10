'use strict';
const assert = require('node:assert/strict');
const { assessContent, pendingChoices } = require('../src/terminalReviewContent');
const { render } = require('../renderer/terminal-review-decision');
const esc = value => String(value).replace(/[&<>"']/gu, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const { TerminalReview } = require('../src/terminalReview');

const source = 'F1 결정 필요: (A) google-java-format 정본 커밋 (B) 기존 포맷 유지. E3~E11 서비스 catch 182개 정리가 남았습니다. 모든 Gradle 빌드가 컴파일 전에 실패합니다. S3 업로드는 그대로입니다.';
const claim = (text, quote, basis = 'reported') => ({ text, basis, quote });
const content = (priority, prompt, answer = '개발은 끝나지 않았고 E3~E11 작업이 남았습니다.') => ({ version: 2,
  answer: claim(answer, 'E3~E11 서비스 catch 182개 정리가 남았습니다.'), details: [], limitations: [], deliverables: [], background: [], nextAction: null,
  handoff: { kind: 'decide', temporal: null, priority: claim(priority, 'F1 결정 필요', 'inference'), prompt: claim(prompt, 'F1 결정 필요', 'inference') } });
const evidence = { source };

// The reported card: bare F1, E3~E11 and E2 are opaque outside the terminal.
let result = assessContent(content('F1 선택이 가장 먼저입니다.', 'F1은 권장안 (A)로 하자.'), evidence);
assert.ok(result.content, 'an unexplained label never discards an otherwise valid analysis');
assert.match(result.advisories[0], /E3~E11/u); assert.match(result.advisories[0], /F1/u);

// Glossed at first visible use, in either order, is enough; later uses may stay short.
result = assessContent(content('F1(코드 포맷 도구 선택)부터 정해야 빌드가 다시 돕니다.', 'F1은 google-java-format으로 하자.',
  '개발은 끝나지 않았고 E3~E11(서비스 catch 182개 정리)이 남았습니다.'), evidence);
assert.deepEqual(result.advisories, []);
result = assessContent(content('코드 포맷 도구 선택(F1)부터 정해야 합니다.', 'F1은 google-java-format으로 하자.',
  '서비스 예외 처리 정리(E3~E11)가 남았습니다.'), evidence);
assert.deepEqual(result.advisories, []);

// Korean particles attach directly to a label and must not hide it.
const q12 = 'Q12 - 화면이 다르다는 어떤 형태인가요?';
result = assessContent(content('먼저 Q12에 답해야 합니다.', '화면 구성 설정 구조로 가자.', '설정 구조가 핵심입니다.'), { source: `${source}\n${q12}` });
assert.match(result.advisories[0] || '', /Q12/u, 'a label followed by a particle is still a label');

// Questions the reply ends with keep every option verbatim; the first option
// named in the assistant's pick is the recommendation, not one it rejects.
const reply = `맞춰 보겠습니다.\n\n❓ ${q12}\n- (a) 대학마다 프론트를 따로 만든다\n- (b) 코드베이스는 하나, 화면 구성이 다르다\n- (c) 같은 화면, 항목만 다르다\n\n➡️ (b)라고 봅니다. (a)는 권하지 않습니다`;
const [block] = pendingChoices(reply);
assert.equal(block.question, q12);
assert.deepEqual(block.options.map(item => item.label), ['a', 'b', 'c']);
assert.equal(block.options[2].text, '같은 화면, 항목만 다르다');
assert.equal(block.recommendation.label, 'b');
assert.equal(pendingChoices('어떻게 할까요?\n1. 지금 배포\n2. 내일 배포\n\n추천은 2번입니다.')[0].recommendation.label, '2');
assert.deepEqual(pendingChoices('이게 맞나요? 네 맞습니다.\n- 이유 하나'), [], 'prose with a question mark is not a choice list');
// Options first, question last: the list before a closing decision question.
const trailing = pendingChoices('**고칠 목록 (배포 없음)**\n1. **전송 대기:** 판정 고치기\n2. 2048 접기\n3. 선택지 보이기\n\n세 가지를 한 브랜치에서 같이 진행할까요? 배포는 하지 않겠습니다.');
assert.equal(trailing.length, 1);
assert.equal(trailing[0].question, '세 가지를 한 브랜치에서 같이 진행할까요?');
assert.deepEqual(trailing[0].options.map(item => [item.label, item.text]), [['1', '전송 대기: 판정 고치기'], ['2', '2048 접기'], ['3', '선택지 보이기']]);
assert.deepEqual(pendingChoices('변경 요약\n1. 파일 수정\n2. 테스트 추가\n\n궁금한 점 있으면 말씀해 주세요?'), [], 'a generic closing question does not turn a summary list into choices');
assert.deepEqual(pendingChoices('결과\n1. 테스트 통과\n2. 빌드 성공\n\n중간 설명 문단입니다.\n\n진행할까요?'), [], 'the list must sit right before the closing question');
const shown = { version: 2, answer: { text: '조건부 답입니다.', basis: 'reported', quote: '' }, details: [], limitations: [], background: [], nextAction: null,
  deliverables: [{ label: '비교표', kind: 'text', value: '| 방식 | 비용 |\n|---|---|\n| **BFF** | 작음 |\n| GraphQL | <큼> |', basis: 'reported', quote: '' }], choices: [block] };
const html = render({ content: shown }, { t: v => v, esc, taskKey: 'choices' });
for (const option of block.options) assert.ok(html.includes(esc(option.text)), `option ${option.label} is visible`);
assert.ok(html.includes('답변의 권장') && html.indexOf('답해야 할 질문') < html.indexOf('비교표'));
assert.ok(html.includes('<table>') && html.includes('<td>BFF</td>') && html.includes('&lt;큼&gt;') && !html.includes('|---|'), 'pipe tables render as escaped tables');
const ragged = render({ content: { ...shown, choices: [{ question: 'x', options: 'bad' }], deliverables: [{ ...shown.deliverables[0], value: '| a | b |\n|---|---|\n| only |' }] } }, { t: v => v, esc, taskKey: 'ragged' });
assert.ok(!ragged.includes('<table>') && ragged.includes('<pre>') && !ragged.includes('답해야 할 질문'), 'malformed tables and saved choices fall back safely');

// Summary claims read one sentence per line; versions, list numbers and
// abbreviations never split, and every piece stays escaped.
const prose = render({ content: { ...shown, choices: [], deliverables: [], answer: { text: '조건부 답입니다. 버전 2.0.26의 1. 항목은 유지됩니다! e.g. this stays. <b>끝</b>입니다.', basis: 'reported', quote: '' } } }, { t: v => v, esc, taskKey: 'prose' });
assert.ok(prose.includes('조건부 답입니다.<br>버전 2.0.26의 1. 항목은 유지됩니다!<br>e.g. this stays.<br>&lt;b&gt;끝&lt;/b&gt;입니다.'), 'sentences break onto lines');

// Well-known names and labels absent from the record are not conversation labels.
result = assessContent(content('S3 업로드는 그대로이고 포맷 도구 선택이 먼저입니다.', 'google-java-format으로 하자.', '개발은 끝나지 않았습니다. 서비스 정리가 남았습니다.'), evidence);
assert.deepEqual(result.advisories, []);

async function repairFlow(second, analysis = undefined) {
  let calls = 0; const efforts = []; const request = '개발 끝났어?', session = { id: 'labels', creationId: 'one', pid: 1, status: 'running' };
  const reply = c => ({ reviewFormat: 'answer-first-v2', handoffRequired: true, text: JSON.stringify({ tasks: [{ requestQuote: request, evidenceQuote: 'F1 결정 필요', content: c, alignment: 'partial' }] }) });
  const service = new TerminalReview({ manager: () => ({ get: () => session }), now: () => 2000, quietMs: 0,
    monitor: { scan: () => ({ available: true, processes: [{ provider: 'codex', pid: 2, ancestorPids: [1] }] }) },
    completion: { observe: async () => ({ available: true, state: 'completed', requestAt: 1000, requestId: 'r', request, evidence: `USER: ${request}\nASSISTANT: ${source}` }) },
    runner: { generateTerminalReview: async ({ effort }) => (efforts.push(effort), ++calls === 1 ? reply(content('F1 선택이 가장 먼저입니다.', 'F1은 권장안 (A)로 하자.')) : second(reply)) } });
  await service.capture({ id: session.id, creationId: session.creationId, text: '', submission: { id: 'r', request, at: 1000 }, ...(analysis ? { analysis } : {}) });
  for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
  return { calls, efforts, task: service.entries.get(session.id).result?.tasks[0] };
}
async function main() {
  let run = await repairFlow(reply => reply(content('F1(코드 포맷 도구 선택)부터 정해야 빌드가 다시 돕니다.', 'F1은 google-java-format으로 하자.',
    '개발은 끝나지 않았고 E3~E11(서비스 catch 182개 정리)이 남았습니다.')));
  assert.equal(run.calls, 2, 'unexplained labels get the one bounded rewrite');
  assert.deepEqual(run.efforts, ['low', 'medium'], 'summaries run at low effort; the one repair gets medium');
  const glossed = reply => reply(content('F1(코드 포맷 도구 선택)부터 정해야 빌드가 다시 돕니다.', 'F1은 google-java-format으로 하자.', '개발은 끝나지 않았고 E3~E11(서비스 catch 182개 정리)이 남았습니다.'));
  assert.deepEqual((await repairFlow(glossed, { effort: 'high' })).efforts, ['high', 'high'], 'the chosen effort reaches the model call');
  assert.deepEqual((await repairFlow(glossed, { effort: 'inherit' })).efforts, ['', ''], '"same as the terminal AI" sends no effort');
  const { questionnaireCommand } = require('../src/questionnaireCommand');
  const args = (review, effort) => questionnaireCommand('claude', require('node:os').tmpdir(), 'claude-opus-5-5', 'darwin', review, effort).args.join(' ');
  assert.match(args(true, 'low'), /--effort low/u, 'review calls set effort instead of inheriting the interactive one');
  assert.doesNotMatch(args(false, 'low'), /--effort/u, 'questionnaires keep their behavior');
  assert.doesNotMatch(args(true, 'max; rm'), /--effort/u, 'only known effort levels reach the CLI');
  assert.doesNotMatch(args(true, ''), /--effort/u, '"same as the terminal AI" passes no effort');
  const { normalizeReviewSettings } = require('../src/terminalReviewSettings');
  assert.equal(normalizeReviewSettings({}).effort, 'low');
  assert.equal(normalizeReviewSettings({ effort: 'inherit' }).effort, 'inherit');
  assert.equal(normalizeReviewSettings({ effort: 'max' }).effort, 'low', 'unknown saved values fall back to low');
  assert.match(run.task.content.handoff.priority.text, /코드 포맷 도구 선택/u);
  run = await repairFlow(() => ({ reviewFormat: 'answer-first-v2', handoffRequired: true, text: 'not json' }));
  assert.equal(run.calls, 2);
  assert.equal(run.task.content.handoff.priority.text, 'F1 선택이 가장 먼저입니다.', 'a failed rewrite keeps the original analysis');
  console.log('PASS labels: conversation labels glossed at first visible use, known names exempt, one non-destructive rewrite, verbatim choices, rendered tables, sentence lines, review effort');
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = main;
