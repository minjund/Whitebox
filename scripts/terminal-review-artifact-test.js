'use strict';

const assert = require('node:assert/strict');
const { addCall, addResult, toolEvidence } = require('../src/terminalReviewTools');
const { proposedChange, artifactText } = require('../src/terminalReviewArtifacts');
const { evidenceFor, assessContent } = require('../src/terminalReviewContent');
const { TerminalReview } = require('../src/terminalReview');
const { evidenceDigest } = require('../src/terminalReviewPolicy');
const tick = () => new Promise(resolve => setImmediate(resolve));

module.exports = async function artifactChecks() {
  const request = 'AGENTS.md에 개념별 빈 줄 규칙을 추가해줘';
  const clause = '- 개념이 바뀌면 빈 줄로 구분한다. 검증과 저장은 서로 다른 묶음으로 둔다.';
  const ack = 'The file /repo/AGENTS.md has been updated successfully.';
  const state = { requestId: 'r' };
  addCall(state, 'edit', 'Edit', { file_path: '/repo/AGENTS.md', old_string: '# 규칙\n', new_string: '# 규칙\n' + clause });
  assert.doesNotMatch(JSON.stringify(toolEvidence(state)), /개념이 바뀌면/, 'pending edits are not delivered as acknowledged changes');
  addResult(state, 'unmatched', ack, false);
  assert.equal(toolEvidence(state).changes, undefined);
  addResult(state, 'edit', ack, false);
  const tools = toolEvidence(state), authored = artifactText(tools.changes);
  assert.match(authored, /개념이 바뀌면/);
  assert.doesNotMatch(JSON.stringify(tools), /pendingChange/);
  assert(artifactText(Array.from({ length: 40 }, () => tools.changes[0])).length <= 3620);
  assert.equal(proposedChange('Bash', { command: 'PRIVATE_COMMAND' }), null);
  assert.equal(proposedChange('apply_patch', 'PRIVATE_PATCH'), null);
  assert.equal(proposedChange('Write', { file_path: '/repo/.env.md', content: 'ordinary' }), null);
  assert.equal(proposedChange('Write', { file_path: '/repo/notes.md', content: 'api_key=VERY_PRIVATE_VALUE' }), null);
  assert.equal(proposedChange('Write', { file_path: '/repo/notes.md', content: 'DB_PASSWORD=VERY_PRIVATE_VALUE' }), null);
  const failed = { requestId: 'r' };
  addCall(failed, 'write', 'Write', { file_path: '/repo/guide.md', content: '# Install\n## Start database\n## Check health' });
  addResult(failed, 'write', 'Permission denied', true);
  assert.equal(toolEvidence(failed).changes, undefined);
  const doc = proposedChange('Write', { file_path: '/repo/guide.md', content: '# 설치 가이드\n' + '설명\n'.repeat(500) + '## DB 실행\n## 정상 상태 확인' });
  assert(doc.outline.includes('## DB 실행'), 'headings outside the short body fragment still describe actual document content');
  const spacing = proposedChange('Edit', { file_path: '/repo/Service.java', old_string: 'validate(input);\npersist(input);', new_string: 'validate(input);\n\npersist(input);' });
  assert.equal(spacing.example.after, 'validate(input);\n\npersist(input);');
  assert.notEqual(evidenceDigest({ request, tools: { items: [], changes: [spacing] } }), evidenceDigest({ request, tools: { items: [], changes: [{ ...spacing, after: 'validate(input);\npersist(input);' }] } }), 'authored whitespace changes invalidate a stale analysis');
  const spacingEvidence = evidenceFor({ reviewEvidence: 'Formatting was edited.', toolEvidence: { items: [], changes: [{ ...spacing, acknowledgement: 'The file /repo/Service.java has been updated successfully.' }] } });
  const spacingContent = { version: 2, answer: { text: '검증과 저장을 다른 묶음으로 나누었습니다.', basis: 'reported', quote: spacing.example.after }, details: [], limitations: [], deliverables: [], background: [], nextAction: null };
  assert(assessContent(spacingContent, { ...spacingEvidence, request: '빈 줄 적용 예시를 보여줘' }).issues.some(issue => issue.includes('actual applied spacing example')));
  spacingContent.deliverables.push({ label: '빈 줄 적용 예시', kind: 'text', value: spacing.example.after, basis: 'reported', quote: spacing.example.after });
  assert(assessContent(spacingContent, { ...spacingEvidence, request: '빈 줄 적용 예시를 보여줘' }).content);
  const focused = proposedChange('Write', { file_path: '/repo/guide.md', content: '# Guide\n## 현재 상태\nDatabase is healthy.\n## unrelated\n' + 'noise\n'.repeat(800) + '## 다음 단계\nUse the web host to test the DB connection.' });
  assert(focused.sections.some(section => section.includes('Use the web host')));
  const nextCommand = 'check-db --port 5432';
  const nextBody = '# Guide\n## 다음 단계\n웹 서버에서 DB 포트의 TCP 통신을 확인합니다.\n```bash\n' + nextCommand + '\n```';
  const nextChange = proposedChange('Write', { file_path: '/repo/guide.md', content: nextBody });
  nextChange.acknowledgement = 'File created successfully at: /repo/guide.md';
  const nextEvidence = evidenceFor({ reviewEvidence: 'The guide was saved.', toolEvidence: { items: [], changes: [nextChange] } });
  const nextContent = { version: 2, answer: { text: '다음 단계는 웹 서버에서 DB 포트의 TCP 통신을 확인하는 것입니다.', basis: 'reported', quote: '웹 서버에서 DB 포트의 TCP 통신을 확인합니다.' }, details: [], limitations: [], deliverables: [], background: [], nextAction: null };
  assert(assessContent(nextContent, nextEvidence).issues.some(issue => issue.includes('recorded resume command')), 'a known next command cannot disappear behind a guide summary');
  nextContent.deliverables.push({ label: '기록된 다음 검사 명령', kind: 'command', value: nextCommand, basis: 'reported', quote: nextCommand });
  assert(assessContent(nextContent, nextEvidence).content);

  const evidence = evidenceFor({ reviewEvidence: `USER: ${request}\nASSISTANT: 규칙 파일을 수정했습니다.`, toolEvidence: tools });
  const base = { version: 2, answer: { text: '규칙 파일을 수정했습니다.', basis: 'reported', quote: ack }, details: [], limitations: [], deliverables: [], background: [], nextAction: null };
  assert(assessContent(base, evidence).issues.includes('authored content omitted from default explanation'));
  const useful = { ...base, answer: { text: '검증과 저장을 다른 묶음으로 두고 개념이 바뀌면 빈 줄로 구분하도록 규칙을 추가했습니다.', basis: 'reported', quote: clause } };
  assert(assessContent(useful, evidence).content);
  assert(!assessContent({ ...useful, answer: { ...useful.answer, basis: 'observed' } }, evidence).content, 'authored text plus acknowledgement is not an independent file read');
  // A code fix is explained, not quoted: a summary of a JS edit passes without
  // copying a code line onto the default screen.
  const codeState = { requestId: 'code-fix' };
  addCall(codeState, 'code', 'Edit', { file_path: '/repo/src/queue.js', old_string: 'if (ready) send();\n', new_string: 'if (ready && !busyLine(screen)) send(message, { deliveryId });\n' });
  addResult(codeState, 'code', 'The file /repo/src/queue.js has been updated successfully.', false);
  const codeRequest = '전송 대기가 계속 걸리는 버그 고쳐줘';
  const codeEvidence = evidenceFor({ reviewEvidence: `USER: ${codeRequest}\nASSISTANT: 작업 중 표시를 준비 완료로 오인하던 판정을 고쳤습니다.`, toolEvidence: toolEvidence(codeState) });
  const codeSummary = { version: 2, answer: { text: '작업 중 표시를 준비 완료로 오인하던 판정을 고쳐, 메시지가 15분씩 대기하지 않습니다.', basis: 'reported', quote: '작업 중 표시를 준비 완료로 오인하던 판정을 고쳤습니다.' }, details: [], limitations: [], deliverables: [], background: [], nextAction: null };
  assert.equal(assessContent(codeSummary, codeEvidence).issues.includes('authored content omitted from default explanation'), false, 'a code edit does not require a quoted code line');

  let calls = 0;
  const session = { id: 'artifact', creationId: 'c', pid: 10, status: 'running' };
  const service = new TerminalReview({ manager: () => ({ get: () => session }), now: () => 2000,
    monitor: { scan: () => ({ available: true, processes: [{ provider: 'claude', pid: 11, ancestorPids: [10] }] }) },
    completion: { observe: async () => ({ available: true, state: 'completed', requestAt: 1000, requestId: 'r', request, evidence: `USER: ${request}\nASSISTANT: 규칙 파일을 수정했습니다.`, tools }) },
    runner: { generateTerminalReview: async ({ prompt }) => {
      calls++; assert(prompt.includes(clause));
      return { reviewFormat: 'answer-first-v2', usage: { total: 10 }, text: JSON.stringify({ tasks: [{ requestQuote: request, evidenceQuote: '규칙 파일을 수정했습니다.', alignment: 'aligned', content: calls === 1 ? base : useful }] }) };
    } } });
  await service.capture({ id: session.id, creationId: 'c', text: 'frame', submission: { id: 'r', request, at: 1000 } });
  let task;
  for (let i = 0; i < 20; i++) { await tick(); task = (await service.capture({ id: session.id, creationId: 'c', text: 'frame' })).result?.tasks?.[0]; if (task?.content) break; }
  assert.equal(calls, 2, 'a metadata-only result gets one bounded repair');
  assert.equal(task?.content.answer.text, useful.answer.text);
  console.log('PASS authored artifacts: acknowledged structured fragments, privacy, failed/pending isolation, real body coverage and one production repair');
};
