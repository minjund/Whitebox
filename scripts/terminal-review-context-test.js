'use strict';
const assert = require('node:assert/strict');
const { applyClaudeRow, applyCodexRow } = require('../src/terminalReviewCompletion');
const { toolEvidence, compactTools } = require('../src/terminalReviewTools');
const { reviewContext, assistantUpdates, compactContext, compactUpdates } = require('../src/terminalReviewContext');
const { TerminalReview, parseReview } = require('../src/terminalReview');
const tick = () => new Promise(resolve => setImmediate(resolve));

module.exports = async function contextChecks() {
  const state = {}, sessionId = 'rollback-fixture';
  let at = 1000;
  const row = (type, content, extra = {}) => ({ type, sessionId, uuid: `row-${at}`, timestamp: new Date(at++).toISOString(), message: { role: type, content }, ...extra });
  const apply = value => applyClaudeRow(state, value, sessionId);
  const report = '롤백했습니다. 이제 남은 건 이번 이니셔티브 폴더뿐입니다.';
  const request = '롤백해줘 데모잖아';
  apply(row('user', 'bmad를 사용해야하고 순서대로 진행해줘'));
  apply(row('assistant', '순서대로 진행합니다.'));
  apply(row('user', request));
  const requestAt = state.requestAt;
  const call = (id, name, input, content, is_error = false) => {
    apply(row('assistant', [{ type: 'tool_use', id, name, input }]));
    apply(row('user', [{ type: 'tool_result', tool_use_id: id, content, is_error }]));
  };
  call('before-1', 'Read', {}, 'plan');
  call('before-2', 'Bash', { command: 'pwd' }, '/fixture');
  // Synthetic data only: no commands in this fixture are ever executed.
  call('rollback', 'Bash', { command: 'tar czf SECRET_ARCHIVE demo-data && git restore . && rm -rf demo-data tools && git status --short' },
    'Backup created. ' + 'file listing '.repeat(200) + '\n?? _bmad-output/initiative-specflow-contract-1/');
  apply(row('assistant', report));
  for (let i = 0; i < 40; i++) call(`read-${i}`, 'Read', {}, `planning context ${i}`);
  call('write', 'Write', { content: 'SECRET_PLAN_BODY' }, 'Plan written');
  const final = '계획 초안 '.repeat(2000) + '1.1 계획을 세웠습니다. 승인해 주시면 구현에 들어갑니다.';
  apply(row('assistant', [{ type: 'thinking', thinking: 'PRIVATE_REASONING' }, { type: 'text', text: final }],
    { message: { role: 'assistant', content: [{ type: 'text', text: final }], stop_reason: 'end_turn' } }));
  const completion = { available: true, state: 'completed', request, requestId: state.requestId, requestAt,
    evidence: `USER: ${request}\nASSISTANT (completed answer):\n${state.answer}`,
    tools: toolEvidence(state), context: reviewContext(state), updates: assistantUpdates(state) };
  const packed = JSON.parse(compactTools(completion.tools));
  assert.equal(packed.retained, 12);
  assert.equal(packed.omitted, 32);
  const rollback = packed.items.find(item => item.commandHints?.includes('git restore'));
  assert.ok(rollback, 'early rollback survives later routine tool traffic and both retention caps');
  assert.equal(rollback.reportedError, false);
  assert.match(rollback.excerpt, /initiative-specflow-contract-1/);
  assert.match(compactUpdates(completion.updates), /롤백했습니다/);
  assert.match(compactContext(completion.context), /순서대로 진행해줘/);
  assert.doesNotMatch(JSON.stringify(completion), /SECRET_|PRIVATE_REASONING/);

  let prompt, calls = 0;
  const service = new TerminalReview({ manager: () => ({ get: () => ({ id: 't', creationId: 'c', pid: 10, status: 'running' }) }), now: () => 3000,
    monitor: { scan: () => ({ available: true, processes: [{ provider: 'claude', pid: 11, ancestorPids: [10] }] }) },
    snapshot: async () => null, completion: { observe: async () => completion },
    runner: { generateTerminalReview: async options => {
      prompt = options.prompt; calls++;
      return JSON.stringify({ tasks: [{ requestQuote: request, evidenceQuote: report, alignment: 'aligned', assessmentBasis: 'supported', actual: '중간 보고와 실행 기록에 롤백이 있습니다.' }] });
    } } });
  const capture = extra => service.capture({ id: 't', creationId: 'c', text: 'frame', ...extra });
  await capture({ submission: { id: 'submitted', request, at: requestAt } }); await tick();
  let task = (await capture()).result.tasks[0];
  assert.equal(task.alignment, 'aligned', 'intermediate report is valid current-turn quote evidence');
  assert.equal(task.evidenceVersion, 4);
  assert.equal(calls, 1);
  assert.match(prompt, /git restore/);
  assert.match(prompt, /롤백했습니다/);
  assert.match(prompt, /순서대로 진행해줘/);
  assert.match(prompt, /latest restriction overrides/);
  assert.ok(prompt.length < 27000, 'expanded evidence, separate context and decision instructions remain bounded');
  assert.deepEqual(task.reviewContext, completion.context);
  assert.deepEqual(task.assistantUpdates, completion.updates);
  completion.context = { items: [{ request: 'UNRELATED_FUTURE_CONTEXT' }] };
  await capture({ detail: { requestId: 'detail', providerPid: 11, task } }); await tick();
  task = (await capture()).result.tasks[0];
  assert.equal(calls, 1, 'removed detail payload never creates a billable call');
  assert.equal(task.alignment, 'aligned');
  assert.doesNotMatch(prompt, /UNRELATED_FUTURE_CONTEXT/, 'detail uses stored request context');

  apply(row('user', '다음 요청'));
  assert.deepEqual(state.tools, []);
  assert.deepEqual(state.updates, []);
  assert.equal(state.context.at(-1).request, request);
  for (let i = 0; i < 30; i++) apply(row('user', `later ${i}`));
  assert.equal(state.context.length, 6);
  assert.ok(state.contextOmitted > 0);
  for (let i = 0; i < 40; i++) apply(row('assistant', `update ${i}`));
  const updates = JSON.parse(compactUpdates(assistantUpdates(state)));
  assert.equal(updates.items.length, 8);
  assert.equal(updates.omitted, 31);

  const codex = {};
  const cx = payload => applyCodexRow(codex, { type: ['task_started', 'task_complete'].includes(payload.type) ? 'event_msg' : 'response_item', timestamp: new Date(at++).toISOString(), payload });
  cx({ type: 'task_started', turn_id: 'cx1' });
  cx({ type: 'message', role: 'user', content: [{ type: 'input_text', text: request }] });
  cx({ type: 'message', role: 'assistant', channel: 'analysis', content: [{ type: 'output_text', text: 'PRIVATE_REASONING' }] });
  cx({ type: 'message', role: 'assistant', channel: 'commentary', content: [{ type: 'output_text', text: report }] });
  cx({ type: 'task_complete', turn_id: 'cx1' });
  assert.equal(codex.complete, false, 'commentary alone cannot supply a missing completion answer');
  cx({ type: 'task_complete', turn_id: 'cx1', last_agent_message: '계획 승인 대기' });
  assert.deepEqual(codex.updates, [report]);
  assert.doesNotMatch(JSON.stringify(codex), /PRIVATE_REASONING/);
  cx({ type: 'task_started', turn_id: 'cx2' });
  assert.equal(codex.context[0].request, request);
  assert.deepEqual(codex.updates, []);

  const result = overrides => parseReview(JSON.stringify({ tasks: [{ requestQuote: request, evidenceQuote: '계획 승인 대기', alignment: 'different', explanation: '롤백하지 않았습니다.', ...overrides }] }), '계획 승인 대기\n데모 파일은 보존했습니다.', 'ko', request).tasks[0];
  assert.equal(result({}).alignment, 'unknown', 'missing evidence is not a demonstrated mismatch');
  assert.equal(result({ assessmentBasis: 'reporting-gap' }).alignment, 'unknown');
  assert.equal(result({ assessmentBasis: 'observed-conflict', conflictQuote: 'absent' }).alignment, 'unknown');
  assert.equal(result({ assessmentBasis: 'observed-conflict', conflictQuote: '데모 파일은 보존했습니다.' }).alignment, 'different', 'positive conflicting evidence remains reportable');
  console.log('PASS rollback context: early execution and progress preserved, history isolated, obsolete detail ignored, Codex privacy, bounded omission counts, conflict evidence required');
};
