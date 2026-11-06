'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { applyClaudeRow, applyCodexRow } = require('../src/terminalReviewCompletion');
const { publicRecord } = require('../src/terminalReviewEvidence');
const { TerminalReview } = require('../src/terminalReview');
const turns = require('../src/terminalReviewTurns');

const summary = 'This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.\n<system-reminder> <tools-used-before-summary>Bash, Skill, ToolSearch, mcp__claude_ai_Notion__notion-create-pages';
module.exports = async function continuationChecks() {
  const user = (uuid, content, extra = {}) => ({ type: 'user', sessionId: 'owned', uuid, timestamp: '2026-11-04T02:00:00Z', message: { role: 'user', content }, ...extra });
  const trust = "2. Trust all and continue\n3. Continue without trusting (hooks won't run)";
  for (const menu of [trust, trust.replace('\n', ' '), '❯ 1. Trust this folder and continue\n  2. Trust all and continue\n  3. Continue without trusting (hooks won’t run)', '1. Trust and continue\n' + trust, '1. Trust once and continue\n' + trust, 'Continue without trusting (hooks won\'t run)']) {
    assert(turns.isNonTaskRequest(menu), 'trust controls are not human tasks');
    assert.equal(turns.submittedPrompt('❯ ' + menu + '\n────────'), '');
    const state = {};
    applyClaudeRow(state, user('human', '실제 요청을 설명해줘'), 'owned');
    applyClaudeRow(state, user('trust', menu), 'owned');
    assert.equal(state.requestId, 'human');
    assert.equal(publicRecord(user('trust', menu), 'claude'), null);
    for (const payload of [{ type: 'user_message', message: menu }, { type: 'message', role: 'user', content: [{ type: 'input_text', text: menu }] }]) {
      const row = { type: payload.type === 'user_message' ? 'event_msg' : 'response_item', timestamp: '2026-11-04T02:00:00Z', payload };
      const codex = { turnId: 'turn' }; applyCodexRow(codex, row);
      assert.equal(codex.requestId, undefined); assert.equal(publicRecord(row, 'codex'), null);
    }
  }
  for (const request of ['이 메뉴의 Trust all and continue는 무슨 뜻이야?', 'Explain this text:\n' + trust, '```\n' + trust + '\n```']) assert.equal(turns.isNonTaskRequest(request), false, 'quoted trust controls remain genuine requests');
  for (const row of [user('summary', summary), user('markdown', '## ' + summary), user('flagged', 'COMPACT_PRIVATE_SENTINEL', { isCompactSummary: true })]) {
    const state = {};
    applyClaudeRow(state, user('human', '오류 문구를 고쳐줘'), 'owned');
    applyClaudeRow(state, row, 'owned');
    assert.equal(state.requestId, 'human', 'automatic continuation cannot replace or interrupt the actual user request');
    assert.equal(state.request, '오류 문구를 고쳐줘');
    assert.equal(publicRecord(row, 'claude'), null, 'internal summaries never enter recoverable review evidence');
    applyClaudeRow(state, { type: 'assistant', sessionId: 'owned', uuid: 'answer', timestamp: '2026-11-04T02:00:01Z', message: { role: 'assistant', content: [{ type: 'text', text: '오류 문구를 수정했습니다.' }], stop_reason: 'end_turn' } }, 'owned');
    assert.equal(state.complete, true); assert.equal(state.requestId, 'human');
    assert(!JSON.stringify(state.context || []).includes('continued from'));
  }
  assert(turns.isNonTaskRequest(summary));
  assert.equal(turns.submittedPrompt('❯ ## ' + summary + '\n────────'), '');
  for (const request of ['요약에 This session is being continued 라고 나와. 수정해줘', 'Explain this text:\n' + summary, '```\n' + summary + '\n```']) {
    assert.equal(turns.isNonTaskRequest(request), false, 'a genuine request quoting a summary stays a task');
  }

  let now = 1000, native = { available: true, state: 'working' };
  const calls = [], session = { id: 'continuation', creationId: 'epoch', pid: 10, status: 'running' };
  const options = { now: () => now, quietMs: 0,
    manager: () => ({ get: () => session }), completion: { observe: async () => native },
    monitor: { scan: () => ({ available: true, processes: [{ provider: 'claude', pid: 11, ancestorPids: [10] }] }) },
    runner: { generateTerminalReview: options => { calls.push(options); return new Promise(() => {}); } } };
  let service = new TerminalReview(options);
  const capture = options => service.capture({ id: session.id, creationId: session.creationId, text: 'Claude Code', ...options });
  await capture();
  const entry = service.entries.get(session.id);
  const good = { taskId: 'good', request: '실제 이전 요청', actual: '이전 작업 결과', lifecycle: 'completed' };
  const bad = { taskId: 'bad', request: summary, text: 'summary only', lifecycle: 'in-progress' };
  entry.turn = { ...bad, latest: bad }; entry.following = { ...bad }; entry.failed = { ...bad };
  entry.pending = [{ ...bad }]; entry.latest.bad = bad; entry.roots.bad = 'bad';
  entry.result = { tasks: [good, { ...bad, recordOnly: true }, { taskId: 'trust', request: trust, lifecycle: 'interrupted', recordOnly: true }] };
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'whitebox-review-continuation-'));
  try {
    const file = path.join(directory, 'reviews.json');
    service.file = file; service.persist(session.id, entry);
    service = new TerminalReview({ ...options, file });
    const restored = await capture();
    assert.equal(restored.state, 'ready'); assert.deepEqual(restored.result.tasks, [good]);
    const stored = JSON.parse(await fs.readFile(file, 'utf8'));
    assert(!JSON.stringify(stored).includes('tools-used-before-summary'), 'backend reload removes internal summary content from durable review state too');
  } finally { service.file = ''; await fs.rm(directory, { recursive: true, force: true }); }
  let releaseOld, extraReads = 0, oldCalls = 0;
  const lateService = new TerminalReview({ ...options,
    completion: { observe: async () => native, prepareEvidence: async () => ({ records: [{ id: 'e1' }], linkedRecords: [], recovered: [], prior: [] }),
      retrieveEvidence: async () => { extraReads++; return [{ id: 'e1', status: 'available', text: 'stale' }]; } },
    runner: { generateTerminalReview: () => { oldCalls++; return new Promise(resolve => { releaseOld = resolve; }); } } });
  await lateService.capture({ id: session.id, creationId: session.creationId });
  const lateEntry = lateService.entries.get(session.id); lateEntry.result = { tasks: [good] };
  lateEntry.pending = [{ ...bad, source: { requestId: 'internal' } }];
  lateService.startReview(session.id, lateEntry, lateEntry.pending[0], session, {});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(oldCalls, 1);
  const cleaned = await lateService.capture({ id: session.id, creationId: session.creationId });
  assert.deepEqual(cleaned.result.tasks, [good]);
  releaseOld({ text: JSON.stringify({ evidenceRequests: ['e1'], tasks: [] }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(lateService.busy, false); assert.equal(oldCalls, 1); assert.equal(extraReads, 0, 'discarded internal analysis cannot fetch more evidence or spend another call');
  assert.deepEqual(lateEntry.result.tasks, [good], 'late internal results cannot overwrite real history');
  for (const request of [summary, trust]) {
    now += 100; native = { available: true, state: 'working', requestId: 'internal', request, requestAt: now };
    for (let index = 0; index < 3; index++) {
      const view = await capture({ force: true, reanalyze: index === 2, submission: { id: 'internal-echo', request, at: now } });
      assert.equal(view.state, 'ready'); assert.equal(view.preview, null); assert.equal(view.currentTaskId, '');
      assert.deepEqual(view.result.tasks, [good], 'already saved bogus cards are removed while real history survives');
    }
  }
  assert.equal(calls.length, 0, 'summary polling, force and reanalysis must not spend model tokens');
  now += 100; native = { available: true, state: 'completed', requestId: 'next', request: '새 오류를 수정해줘', requestAt: now,
    evidence: 'USER: 새 오류를 수정해줘\nASSISTANT: 오류를 수정했고 테스트를 통과했습니다.', tools: { items: [{ name: 'Edit', status: 'returned', excerpt: 'tests passed' }] } };
  await capture({ submission: { id: 'next', request: native.request, at: now } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1, 'the next actual user request is still analyzed');
  assert(!calls[0].prompt.includes('tools-used-before-summary'));
  console.log('PASS continuation summary: native request continuity, no internal evidence/cards/calls, saved-state recovery, quoted user requests and next real task');
};
if (require.main === module) module.exports().catch(error => { console.error(error); process.exitCode = 1; });
