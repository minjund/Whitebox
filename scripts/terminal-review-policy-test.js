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
  // A completed reply that asks the user to choose or clarify is a result to
  // summarize; only a bare promise of future work without a question defers.
  const asking = { request: '한국말로 해서 해줘봐', terminalId: 'one', submittedAt: 10, observedAt: 30, lifecycle: 'completed', tools: { items: [] }, updates: { items: [] },
    text: 'USER:\n한국말로 해서 해줘봐\n\nASSISTANT (completed answer):\n네, 한국어로 진행하겠습니다. 아직 무엇을 설계할지 요청이 없습니다.\n\n- 범위: 새 테이블 설계, 기존 엔티티 검토, 마이그레이션 계획 중 어느 것인가요?\n- 대상 DB: H2 기준인지 PostgreSQL 기준인지 알려주세요.\n\n패키지를 지목해 주시면 스키마 안을 제안하겠습니다.' };
  assert.equal(classifyEvidence(asking, []).mode, 'analyze', 'a clarifying question is this turn\'s result');
  const plan = classifyEvidence({ ...asking, text: 'USER:\n한국말로 해서 해줘봐\n\nASSISTANT (completed answer):\n네, 한국어로 진행하겠습니다. 먼저 모듈 문서를 살펴보겠습니다.' }, []);
  assert.equal(plan.mode, 'defer', 'a bare plan without a question still waits for evidence');
  assert.equal(plan.actual, '네, 한국어로 진행하겠습니다. 먼저 모듈 문서를 살펴보겠습니다.', 'a short deferred reply is shown verbatim instead of a placeholder');
  assert.match(classifyEvidence({ ...asking, text: 'USER:\n한국말로 해서 해줘봐\n\nASSISTANT (completed answer):\n' + '먼저 문서를 살펴보겠습니다. '.repeat(60) }, []).actual, /구체적인 내용이 아직 기록에 없어요/u, 'a long deferred reply keeps the placeholder');
  assert.match(classifyEvidence({ ...asking, text: 'USER:\n수정해줘\n\nASSISTANT (completed answer):\n완료했습니다.' , request: '수정해줘' }, []).actual, /구체적인 내용이 아직 기록에 없어요/u, 'a generic completion claim is not a result to show');
  {
    // A waiting card published during the turn shows the real reply once it
    // arrives, instead of keeping the placeholder until analysis finishes.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-waiting-card-'));
    try {
      const service = new TerminalReview({ file: path.join(dir, 'reviews.json') });
      const placeholder = classifyEvidence({ ...asking, text: '' }, []).actual;
      const entry = { key: '["t","c",1,"x"]', latest: {}, seen: {}, pending: [], result: { tasks: [{ taskId: 'w', request: asking.request, lifecycle: 'in-progress', deferred: true, recordOnly: true, analysisDepth: 'deferred', actual: placeholder }] } };
      const longReply = 'GraphQL이 일부는 해소해 줍니다. '.repeat(60);
      service.enqueue('t', entry, { ...asking, taskId: 'w', lifecycle: 'completed', text: 'USER:\n' + asking.request + '\n\nASSISTANT (completed answer):\n' + longReply });
      const card = entry.result.tasks[0];
      assert.equal(card.lifecycle, 'completed');
      assert.equal(card.actual, longReply.trim(), 'a finished reply replaces the placeholder on the waiting card');
      entry.result.tasks.push({ taskId: 'r', request: 'relay', lifecycle: 'completed', recordOnly: true, analysisDepth: 'record', actual: 'Codex에 보냈고 답을 받았어요' });
      service.enqueue('t', entry, { ...asking, taskId: 'r', lifecycle: 'completed', text: 'USER:\nrelay\n\nASSISTANT (completed answer):\n다른 글' });
      assert.equal(entry.result.tasks[1].actual, 'Codex에 보냈고 답을 받았어요', 'a recorded result card is never overwritten');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  assert.equal(classifyEvidence({ ...asking, awaitingResponse: true, text: 'USER:\n한국말로 해서 해줘봐\n\nASSISTANT (completed answer):\n네, 진행하겠습니다. 어느 패키지부터 볼지 말씀해 주세요' }, []).mode, 'analyze', 'a recorded awaiting-response turn is analyzed');
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
    await submit('repeat', '대신 요약만 보여줘', { state: 'completed', evidence: 'ASSISTANT: 요약 결과를 바로 보여줍니다.' }); await tick();
    assert.equal(calls.length, 3, 'identical evidence reuses the cached model response');
    assert.ok(service.entries.get('one').result.tasks.some(t => t.taskId.endsWith(':conversation:repeat') && t.analysisCached),
      'identical text submitted separately is still a distinct request');
    await submit('repeat-changed', '대신 요약만 보여줘', { state: 'completed', evidence: 'ASSISTANT: 요약 결과를 다시 보여줍니다.' });
    assert.equal(calls.length, 4, 'changed evidence calls the model');
    calls[3].reject(new Error('fixture failure')); await tick();
    for (let i = 0; i < 3; i++) await capture();
    assert.equal(calls.length, 4, 'failure cannot automatically bill repeated retries');
    await capture({ force: true }); assert.equal(calls.length, 5);
    await capture({ enabled: false });
    await finish(calls[4], '대신 요약만 보여줘', '요약 결과를 바로 보여줍니다.');
    assert.equal(service.entries.get('one').state, 'paused');
    assert.equal(service.entries.get('one').result.tasks.filter(t => t.analysisId).length, 3, 'disabled analysis cannot publish a late result (two model results plus one cached repeat)');
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
