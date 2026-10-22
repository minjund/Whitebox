'use strict';
const assert = require('node:assert/strict');
const { applyClaudeRow, applyCodexRow } = require('../src/terminalReviewCompletion');
const { toolEvidence, screenTools, compactTools } = require('../src/terminalReviewTools');
const { TerminalReview, parseReview } = require('../src/terminalReview');
const tick = () => new Promise(resolve => setImmediate(resolve));

module.exports = async function toolChecks() {
  const request = 'https://arxiv.org/html/2610.28380v1 이 사이트 분석해줘';
  const state = {}, sessionId = 'fixture';
  let at = 1000;
  const row = (type, content, extra = {}) => ({ type, sessionId, uuid: `r-${at}`, timestamp: new Date(at++).toISOString(), message: { role: type, content }, ...extra });
  const apply = value => applyClaudeRow(state, value, sessionId);
  apply(row('user', request));
  for (let i = 0; i < 3; i++) {
    apply(row('assistant', [{ type: 'tool_use', id: `fetch-${i}`, name: 'WebFetch', input: { url: 'https://arxiv.org/html/2610.28380v1?token=SECRET', prompt: 'SECRET_PROMPT' } }, { type: 'thinking', thinking: 'PRIVATE_REASONING' }]));
    apply(row('user', [{ type: 'tool_result', tool_use_id: `fetch-${i}`, content: 'Received 395.7KB (200 OK)', is_error: false }, { type: 'text', text: 'tool annotation must not reset the request' }]));
  }
  assert.equal(state.request, request);
  assert.equal(state.tools.length, 3);
  apply(row('user', [{ type: 'tool_result', tool_use_id: 'unmatched', content: 'unrelated result' }]));
  apply({ ...row('assistant', [{ type: 'tool_use', id: 'foreign', name: 'Write', input: {} }]), sessionId: 'other' });
  apply({ ...row('assistant', [{ type: 'tool_use', id: 'side', name: 'Write', input: {} }]), isSidechain: true });
  assert.equal(state.tools.length, 3);
  const tools = toolEvidence(state), packed = compactTools(tools);
  assert.equal(tools.items.filter(item => item.status === 'returned').length, 3);
  assert.match(packed, /200 OK/);
  assert.doesNotMatch(packed, /SECRET|PRIVATE|unrelated/);
  // Failed and pending calls must not be advertised as successful execution.
  apply(row('assistant', [{ type: 'tool_use', id: 'fail', name: 'Bash', input: { command: 'SECRET_COMMAND' } }]));
  apply(row('user', [{ type: 'tool_result', tool_use_id: 'fail', is_error: true, content: 'Permission denied' }]));
  apply(row('assistant', [{ type: 'tool_use', id: 'pending', name: 'Read', input: {} }]));
  assert.deepEqual(state.tools.slice(-2).map(item => item.status), ['error', 'called']);
  const full = { ...state, tools: Array.from({ length: 40 }, (_, i) => ({ id: `${i}`, name: 'Read', status: 'returned', target: '', excerpt: 'x'.repeat(10000) })) };
  assert.ok(compactTools(toolEvidence(full)).length < 4000);
  assert.equal(JSON.parse(compactTools(toolEvidence(full))).omitted, 28);
  apply(row('user', '새 요청'));
  assert.equal(state.tools.length, 0, 'next request cannot inherit previous fetches');

  const codex = {};
  const cx = payload => applyCodexRow(codex, { type: payload.type === 'task_started' || payload.type === 'task_complete' ? 'event_msg' : 'response_item', timestamp: new Date(at++).toISOString(), payload });
  cx({ type: 'task_started', turn_id: 'turn-1' });
  cx({ type: 'message', role: 'user', content: [{ type: 'input_text', text: request }] });
  cx({ type: 'function_call', call_id: 'c1', name: 'web_fetch', arguments: JSON.stringify({ url: 'https://arxiv.org/html/2610.28380v1' }) });
  cx({ type: 'function_call_output', call_id: 'old', output: 'not this turn' });
  cx({ type: 'function_call_output', call_id: 'c1', output: 'HTTP 200 OK' });
  cx({ type: 'custom_tool_call', call_id: 'c2', name: 'apply_patch', input: 'DO_NOT_STORE_PATCH' });
  cx({ type: 'custom_tool_call_output', call_id: 'c2', output: 'Patch failed' });
  cx({ type: 'web_search_call', id: 'search', status: 'completed', action: { url: 'https://arxiv.org/html/2610.28380v1' } });
  cx({ type: 'function_call', turn_id: 'other', call_id: 'other', name: 'wrong' });
  cx({ type: 'task_complete', turn_id: 'turn-1', last_agent_message: '분석했습니다' });
  assert.equal(codex.tools.length, 3);
  assert.doesNotMatch(compactTools(toolEvidence(codex)), /not this turn|DO_NOT_STORE_PATCH|wrong/);
  cx({ type: 'task_started', turn_id: 'turn-2' });
  assert.equal(codex.tools.length, 0);
  const screen = screenTools(`❯ ${request}\n⏺ Fetch(https://arxiv.org/html/2610.28380v1)\nReceived 395.7KB (200 OK)\nAllowed by auto mode classifier\n⏺ 분석했습니다\n✻ Baked for 1m 32s · done 9:30 AM`);
  assert.equal(screen.items[0].status, 'returned');
  assert.match(screen.items[0].excerpt, /200 OK/);

  let prompt, calls = 0;
  const completion = { available: true, state: 'completed', requestAt: 1000, requestId: 'request', request,
    evidence: `USER: ${request}\nASSISTANT (completed answer):\n${'Long answer '.repeat(3000)}논문 분석 완료`, tools };
  const service = new TerminalReview({ manager: () => ({ get: () => ({ id: 't', creationId: 'c', pid: 10, status: 'running' }) }), now: () => 2000,
    monitor: { scan: () => ({ available: true, processes: [{ provider: 'claude', pid: 11, ancestorPids: [10] }] }) },
    completion: { observe: async () => completion }, snapshot: async () => null,
    runner: { generateTerminalReview: async options => { calls++; prompt = options.prompt;
      return { text: JSON.stringify({ tasks: [{ requestQuote: request, evidenceQuote: '논문 분석 완료', actual: '논문 분석 답변', alignment: 'aligned', contentAccuracy: '원문 대조는 하지 않았습니다.' }] }), usage: { total: 123 } }; } } });
  const capture = extra => service.capture({ id: 't', creationId: 'c', text: 'frame', ...extra });
  await capture({ submission: { id: 'r', request, at: 1000 } }); await tick();
  let task = (await capture()).result.tasks[0];
  assert.equal(calls, 1);
  assert.match(prompt, /200 OK/);
  assert.equal((prompt.match(/WebFetch/g) || []).length, 3, 'all three fetch metadata records survive a very long answer');
  assert.match(prompt, /A tool result being returned does not prove success/);
  assert.match(prompt, /Never claim to have inspected files, run tests or checked external sources yourself/);
  assert.equal(task.reviewSchema, 3);
  assert.equal(task.toolEvidence.items.length, 3);
  assert.equal(task.contentAccuracy, '원문 대조는 하지 않았습니다.');
  assert.equal(task.analysisUsage.total, 123);
  await capture({ detail: { requestId: 'detail', providerPid: 11, task } }); await tick();
  task = (await capture()).result.tasks[0];
  assert.equal(task.toolEvidence.items.length, 3, 'detail reuses the exact request tool records');
  assert.equal(calls, 1, 'removed detail request does not call a model');
  assert.equal((await capture()).result.tasks.length, 1);
  assert.equal(parseReview(JSON.stringify({ tasks: [{ evidenceQuote: 'missing', contentAccuracy: 'verified' }] }), 'other').tasks[0].contentAccuracy, '', 'unsupported accuracy text is rejected');
  console.log('PASS request-scoped Claude/Codex tool evidence: fetch/error/pending, turn isolation, bounded metadata, long-answer preservation, no paid detail and accuracy separation');
};
