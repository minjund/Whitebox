'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TerminalReview, parseReview } = require('../src/terminalReview');
const { classifyEvidence, evidenceDigest } = require('../src/terminalReviewPolicy');
const { addCall, addResult, toolEvidence } = require('../src/terminalReviewTools');
const tick = () => new Promise(resolve => setImmediate(resolve));
module.exports = async function policyChecks() {
  const relay = { request: 'Codex에 ㅎㅇ 입력 후 결과 가져오기', terminalId: 'one', submittedAt: 10, observedAt: 30, lifecycle: 'completed', text: 'ASSISTANT: 완료했습니다.' };
  const jobs = [{ sourceId: 'one', provider: 'codex', request: 'ㅎㅇ', state: 'completed', sentAt: 20, finishedAt: 25, answer: 'ASSISTANT: 반가워요!' }];
  assert.equal(classifyEvidence(relay, jobs).mode, 'record');
  assert.equal(classifyEvidence(relay, [{ ...jobs[0], sourceId: 'other' }]).mode, 'defer');
  assert.equal(classifyEvidence(relay, [{ ...jobs[0], sentAt: 1 }]).mode, 'defer');
  assert.equal(classifyEvidence({ ...relay, request: 'Codex에 ㅎㅇ 입력 후 결과 가져오기 그리고 오류 수정해줘' }, jobs).mode, 'defer');
  const rename = { request: '파일 "a.txt" 이름을 "b.txt"로 바꿔줘', lifecycle: 'completed', text: 'ASSISTANT: 변경했습니다.' };
  const state = { requestId: 'rename' };
  addCall(state, 'mv', 'exec_command', { cmd: 'mv -- a.txt b.txt' });
  addResult(state, 'mv', 'Process exited with code 0');
  assert.equal(classifyEvidence({ ...rename, tools: toolEvidence(state) }, []).mode, 'record');
  const unsafe = { requestId: 'rename' };
  addCall(unsafe, 'mv', 'Bash', { command: 'mv a.txt b.txt && echo other' });
  addResult(unsafe, 'mv', 'Process exited with code 0');
  assert.notEqual(classifyEvidence({ ...rename, tools: toolEvidence(unsafe) }, []).mode, 'record');
  assert.equal(classifyEvidence({ ...rename, lifecycle: 'interrupted' }, []).mode, 'record');
  const unrelated = parseReview(JSON.stringify({ tasks: [{ requestQuote: '인사해줘', evidenceQuote: '안녕하세요', unverified: [{ item: '테스트', requestQuote: '없는 요구사항', reason: '필요' }, { item: '인사 결과', requestQuote: '인사해줘', reason: '요청한 답변이 보여야 합니다' }] }] }), '안녕하세요', 'ko', '인사해줘');
  assert.equal(unrelated.tasks[0].unverified.length, 1, 'missing checks must cite the actual requirement');
  assert.equal(evidenceDigest({ request: 'a', text: 'answer', observedAt: 1 }), evidenceDigest({ request: 'a', text: 'answer', observedAt: 2 }));

  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-review-policy-'));
  try {
    let now = 10000, completion = { available: true }, session = { id: 'one', creationId: 'epoch', pid: 10, createdAt: 'start', status: 'running' };
    let processes = [{ provider: 'codex', pid: 11, ancestorPids: [10] }];
    const calls = [];
    const options = { file: path.join(folder, 'review.json'), manager: () => ({ get: () => session }), now: () => now,
      monitor: { scan: () => ({ available: true, processes }) }, completion: { observe: async () => completion },
      runner: { generateTerminalReview: options => new Promise((resolve, reject) => calls.push({ ...options, resolve, reject })) } };
    let service = new TerminalReview(options);
    const capture = extra => service.capture({ id: 'one', creationId: 'epoch', ...extra });
    const submit = async (id, request, extra = {}) => {
      now += 100;
      completion = { available: true, conversationId: 'conversation', requestId: id, rootRequestId: id, requestAt: now, request, state: 'working', ...extra };
      return capture({ submission: { id, at: now, request } });
    };
    const finish = async (call, request, quote, usage = 3000) => {
      call.resolve({ text: JSON.stringify({ tasks: [{ requestQuote: request, evidenceQuote: quote, actual: '보고된 변경', why: '사용자가 확인하기 위해', understanding: '결과를 바로 보여줍니다', alignment: 'aligned', explanation: '기록과 연결됨' }] }), usage: { total: usage } });
      await tick();
    };
    await capture();
    await submit('empty', '분석란 수정해줘');
    assert.equal(calls.length, 0, 'missing evidence never bills');
    await capture({ interruption: { id: 'stop-1' } });
    assert.equal(service.entries.get('one').result.tasks[0].lifecycle, 'interrupted');
    assert.equal(calls.length, 0, 'interrupted before results stays local');
    await submit('long', '분석란 수정해줘');
    completion = { ...completion, partialEvidence: 'ASSISTANT (current report): 결과 표시를 수정했고 테스트를 통과했습니다.', tools: { items: [{ name: 'Bash', status: 'returned', excerpt: '4 tests passed' }] } };
    let view = await capture();
    assert.equal(view.state, 'reviewing');
    assert.equal(calls.length, 1, 'a concrete checkpoint starts analysis before the whole request ends');
    assert.ok(view.preview.facts.length > 0, 'facts available immediately, before 30s');
    now += 31000;
    view = await capture();
    assert.equal(view.elapsedSeconds, 31);
    assert.equal(calls.length, 1, 'clock alone cannot bill again');
    await finish(calls[0], '분석란 수정해줘', '결과 표시를 수정했고 테스트를 통과했습니다.');
    assert.equal(service.entries.get('one').result.tasks.at(-1).alignment, 'in-progress');
    // More verified progress adds another explanation; no cumulative cap.
    completion.partialEvidence = 'ASSISTANT (current report): 오류 안내를 추가했고 테스트를 통과했습니다.';
    await capture(); assert.equal(calls.length, 2);
    await submit('changed', '대신 요약만 보여줘');
    await finish(calls[1], '분석란 수정해줘', '오류 안내를 추가했고 테스트를 통과했습니다.');
    assert.equal(service.entries.get('one').result.tasks.find(t => t.request === '분석란 수정해줘' && t.analysisId).lifecycle, 'interrupted');
    completion = { ...completion, state: 'completed', evidence: 'ASSISTANT: 요약 결과를 바로 보여줍니다.' };
    await capture(); await capture();
    assert.equal(calls.length, 3);
    await finish(calls[2], '대신 요약만 보여줘', '요약 결과를 바로 보여줍니다.');
    view = await capture();
    assert.equal(view.result.tasks.at(-1).request, '대신 요약만 보여줘');
    assert.equal(view.result.tasks.at(-1).relation, 'changed');
    assert.ok(view.result.tasks.at(-1).relatedTaskId);
    await capture({ force: true }); assert.equal(calls.length, 3, 'manual refresh cannot bill identical successful evidence');
    service = new TerminalReview(options);
    await capture(); assert.equal(calls.length, 3, 'restart retains result/digest without another call');
    await submit('repeat', '대신 요약만 보여줘', { state: 'completed', evidence: 'ASSISTANT: 요약 결과를 바로 보여줍니다.' });
    assert.equal(calls.length, 4, 'identical text submitted separately is a distinct request');
    calls[3].reject(new Error('fixture failure')); await tick();
    for (let i = 0; i < 3; i++) await capture();
    assert.equal(calls.length, 4, 'failure cannot automatically bill repeated retries');
    await capture({ force: true }); assert.equal(calls.length, 5);
    await capture({ enabled: false });
    await finish(calls[4], '대신 요약만 보여줘', '요약 결과를 바로 보여줍니다.');
    assert.equal(service.entries.get('one').state, 'paused');
    assert.equal(service.entries.get('one').result.tasks.filter(t => t.analysisId).length, 2, 'disabled analysis cannot publish a late result');
    // Process identity invalidates an in-flight model response.
    await capture();
    await submit('new-child-task', '작동 원리 설명해줘', { state: 'completed', evidence: 'ASSISTANT: 입력을 읽고 결과를 표시하는 방식입니다.' });
    const oldCall = calls.at(-1);
    session = { ...session, pid: 20 };
    await finish(oldCall, '작동 원리 설명해줘', '입력을 읽고 결과를 표시하는 방식입니다.');
    assert.equal(service.entries.get('one').result.tasks.some(t => t.request === '작동 원리 설명해줘' && t.analysisId), false);
    await capture();
    assert.equal(service.entries.get('one').result, null, 'new terminal identity cannot inherit old results');
    // Native-only submitted requests are discovered without an Enter event.
    session = { ...session, pid: 30 };
    processes = [{ provider: 'codex', pid: 31, ancestorPids: [30] }];
    completion = { available: true };
    await capture(); now += 100;
    completion = { available: true, conversationId: 'conversation', requestId: 'native-only', requestAt: now, request: 'ㅎㅇ', state: 'completed', evidence: 'ASSISTANT: 안녕!' };
    await capture();
    assert.equal(service.entries.get('one').result.tasks.at(-1).request, 'ㅎㅇ');
    assert.equal(service.entries.get('one').result.tasks.at(-1).recordOnly, true);
    // An explicit question response keeps the original request; matching text alone does not.
    service = new TerminalReview({ ...options, file: '' });
    completion = { available: true };
    await capture();
    await submit('question', '결과창을 만들어줘', { state: 'completed', awaitingResponse: true,
      evidence: 'ASSISTANT: 어떤 방식으로 진행할까요?' });
    const rootTask = service.entries.get('one').turn.taskId;
    await submit('response', 'ㅇㅇ', { rootRequestId: 'question' });
    assert.equal(service.entries.get('one').turn.taskId, rootTask);
    assert.equal(service.entries.get('one').turn.request, '결과창을 만들어줘');
    completion = { ...completion, state: 'completed', evidence: 'ASSISTANT: 결과창을 추가했습니다.', tools: { items: [{ name: 'Write', status: 'returned', excerpt: 'Created the results view' }] } };
    await capture();
    await finish(calls.at(-1), '결과창을 만들어줘', '결과창을 추가했습니다.');
    assert.equal(service.entries.get('one').result.tasks.length, 1);
    assert.equal(service.entries.get('one').result.tasks[0].alignment, 'aligned');
    // A fresh completion signal justifies a final verdict, then stays deduplicated.
    await submit('checkpoint', '검사 결과 설명해줘', { partialEvidence: 'ASSISTANT: 첫 검사를 통과했습니다.', tools: { items: [{ name: 'Bash', status: 'returned', excerpt: '2 tests passed' }] } });
    await finish(calls.at(-1), '검사 결과 설명해줘', '첫 검사를 통과했습니다.');
    const count = calls.length;
    completion = { ...completion, state: 'completed', evidence: completion.partialEvidence.replace('current report', 'completed answer') };
    await capture();
    assert.equal(calls.length, count + 1);
    await finish(calls.at(-1), '검사 결과 설명해줘', '첫 검사를 통과했습니다.');
    await capture();
    assert.equal(calls.length, count + 1);
    assert.equal(service.entries.get('one').result.tasks.at(-1).alignment, 'aligned');
    const base = { request: 'result', text: 'ASSISTANT: found result', tools: { items: [{ name: 'Read', status: 'returned', excerpt: 'contents' }] } };
    assert.equal(evidenceDigest(base), evidenceDigest({ ...base, tools: { items: [...base.tools.items, { name: 'Read', status: 'returned', excerpt: 'another read' }] } }), 'routine reads alone do not repeatedly analyze the same report');
    // An interrupted app run cannot silently bill the same in-flight evidence again.
    const durable = { ...options, file: path.join(folder, 'inflight.json') };
    service = new TerminalReview(durable); completion = { available: true }; await capture();
    await submit('inflight', '내용 설명해줘', { state: 'completed', evidence: 'ASSISTANT: 입력값을 결과 화면으로 보내는 구조입니다.' });
    const inflightCount = calls.length;
    service = new TerminalReview(durable);
    view = await capture();
    assert.equal(calls.length, inflightCount);
    assert.equal(view.state, 'error');
    assert.match(view.message, /자동 재호출하지/);
    console.log('PASS analysis policy: proven no-call records, relevant unknowns, partial facts under 30s, incremental analysis, interruption, new request identity, cache, retry, pause and late-result isolation');
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
};
if (require.main === module) module.exports().catch(error => { console.error(error); process.exitCode = 1; });
