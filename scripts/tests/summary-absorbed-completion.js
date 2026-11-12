'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const { TerminalCollaboration } = require('../../src/terminalCollaboration');
const { inputReady, completionStamp } = require('../../src/terminalReviewTurns');

const RULE = '─'.repeat(40);
const STATUS = '  [Opus 5.5 ◑ high] │ Whitebox';
const idleScreen = `❯ first\n⏺ answer\n✻ Churned for 10s · done 3:06 PM\n\n${RULE}\n❯ \n${RULE}\n${STATUS}`;
const workingScreen = live => idleScreen.replace(`\n\n${RULE}`, `\n❯ second\n⏺ report\n${live}\n\n${RULE}`);

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-summary-absorbed-'));
  const session = { id: 'terminal:ai', creationId: 'ai-epoch', pid: 200, status: 'running', outputSequence: 1, title: 'claude' };
  const state = { now: Date.now(), native: { available: false }, writes: [], screen: idleScreen, inputDraft: '', scanMissing: false };
  const manager = { get: async id => (id === session.id ? session : null), rawWriteDeliverySupported: () => true,
    write: async (id, data, options) => { state.writes.push({ id, data, options }); } };
  const monitor = { scan: () => ({ available: true, processes: state.scanMissing ? [] : [{ pid: 1200, ancestorPids: [200], provider: 'claude' }] }) };
  const collaboration = new TerminalCollaboration({ enableControl: false, directory, manager: () => manager, monitor,
    completion: { observe: async () => state.native }, now: () => state.now });
  // `frames: false` models a renderer that stopped reporting the pane.
  const sync = ({ frames = true } = {}) => collaboration.sync({ groups: [{ id: 'group', cwd: directory, members: [session] }],
    frames: frames ? [{ id: session.id, creationId: session.creationId, outputSequence: session.outputSequence, text: state.screen, inputDraft: state.inputDraft }] : [] });
  const send = (message, extra = {}) => collaboration.summarySend({ id: randomUUID(), groupId: 'group', targetId: session.id, message,
    targetCreationId: session.creationId, targetProviderPid: 1200, targetProvider: 'claude', ...extra });
  const job = id => collaboration.jobs.get(id);
  const cleanup = () => fs.rmSync(directory, { recursive: true, force: true });
  return { state, collaboration, sync, send, job, cleanup };
}
const MINUTE = 60_000;

const tests = [
  {
    name: 'Session logs report the model and effort of the latest reply for Claude and Codex',
    run() {
      const { applyClaudeRow, applyCodexRow } = require('../../src/terminalReviewCompletion');
      const sessionId = randomUUID();
      const claude = { requestAt: 0 };
      applyClaudeRow(claude, { type: 'assistant', sessionId, uuid: 'a1', timestamp: '2026-11-10T01:00:00Z', effort: 'high',
        message: { role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'hi' }] } }, sessionId);
      applyClaudeRow(claude, { type: 'assistant', sessionId, uuid: 'a2', timestamp: '2026-11-10T01:00:01Z',
        message: { role: 'assistant', model: '<synthetic>', content: [] } }, sessionId);
      assert.equal(claude.model, 'claude-opus-5-5', 'a synthetic row never replaces the real model');
      assert.equal(claude.effort, 'high');
      const codex = {};
      applyCodexRow(codex, { type: 'turn_context', timestamp: '2026-11-10T01:00:00Z', payload: { model: 'gpt-6.1-sol', effort: 'xhigh' } });
      assert.equal(codex.model, 'gpt-6.1-sol');
      assert.equal(codex.effort, 'xhigh');
      const fallback = {};
      applyCodexRow(fallback, { type: 'turn_context', timestamp: '2026-11-10T01:00:00Z', payload: { model: 'gpt-6.1-sol', collaboration_mode: { settings: { reasoning_effort: 'medium' } } } });
      assert.equal(fallback.effort, 'medium');
    },
  },
  {
    name: 'Claude log parser keeps the human messages it absorbed into the running turn',
    async run() {
      const { TerminalReviewCompletion } = require('../../src/terminalReviewCompletion');
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-absorbed-log-'));
      const sessionId = randomUUID(), file = path.join(directory, `${sessionId}.jsonl`);
      const row = (fields, at) => JSON.stringify({ sessionId, uuid: randomUUID(), timestamp: new Date(at).toISOString(), ...fields });
      const t0 = Date.parse('2026-11-10T01:00:00Z');
      fs.writeFileSync(file, [
        row({ type: 'user', message: { role: 'user', content: 'first request' } }, t0),
        row({ type: 'assistant', message: { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tool-1', name: 'Bash', input: {} }] } }, t0 + 1000),
        row({ type: 'attachment', attachment: { type: 'queued_command', prompt: 'second request', origin: { kind: 'human' } } }, t0 + 2000),
        row({ type: 'attachment', attachment: { type: 'queued_command', prompt: 'task output', origin: { kind: 'task-notification' } } }, t0 + 2500),
        row({ type: 'assistant', message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'done with both' }] } }, t0 + 3000),
      ].join('\n') + '\n');
      try {
        const state = await new TerminalReviewCompletion({ claudeHomes: () => [] }).logState(file, 'claude', sessionId);
        assert.equal(state.request, 'first request', 'an absorbed message never replaces the turn request');
        assert.deepEqual(state.absorbed, [{ text: 'second request', at: t0 + 2000 }], 'only human messages count');
        assert.equal(state.complete, true);
      } finally { fs.rmSync(directory, { recursive: true, force: true }); }
    },
  },
  {
    name: 'Claude live status lines block summary delivery; only a finished line releases it',
    run() {
      assert.equal(inputReady(idleScreen, 'claude'), true);
      for (const live of ['✢ Nucleating… (1m 1s · ↓ 4.0k tokens · thought for 3s)', '✶ Pondering… (12s · ↑ 1.2k tokens)', '✻ Thinking…']) {
        assert.equal(inputReady(workingScreen(live), 'claude'), false, `${live} is still working`);
      }
      // A live line is not a completed turn, so the stamp only moves on a real finish.
      assert.equal(completionStamp(workingScreen('✢ Nucleating… (1m 1s · thought for 3s)'), 'claude'), completionStamp(idleScreen, 'claude'));
    },
  },
  {
    name: 'Summary chat does not send while Claude shows a live status line',
    async run() {
      const f = fixture();
      try {
        f.state.screen = workingScreen('✢ Nucleating… (1m 1s · ↓ 4.0k tokens · thought for 3s)');
        f.state.native = { available: true, state: 'unconfirmed', requestId: 'r1', request: 'first', requestAt: f.state.now - 60_000 };
        await f.sync();
        const result = await f.send('작업 중에 보낸 요청');
        assert.equal(result.deferred, true);
        assert.equal(f.state.writes.length, 0);
      } finally { f.cleanup(); }
    },
  },
  {
    name: 'A summary send Claude absorbed mid-turn completes when that turn ends',
    async run() {
      const f = fixture();
      try {
        f.state.native = { available: true, state: 'completed', requestId: 'r1', request: 'first', requestAt: f.state.now - 60_000, completedAt: f.state.now - 50_000, evidence: 'E1', absorbed: [] };
        await f.sync();
        const { job } = await f.send('두 번째 요청');
        assert.equal(job.state, 'running');
        const sentAt = job.sentAt;
        // Claude absorbed the message into a turn that was still running.
        f.state.now += 5_000;
        f.state.native = { ...f.state.native, state: 'working', completedAt: sentAt - 50_000, absorbed: [{ text: '두 번째 요청', at: sentAt + 50 }] };
        await f.sync();
        assert.equal(f.collaboration.jobs.get(job.id).state, 'running', 'still working');
        f.state.now += 5_000;
        f.state.native = { ...f.state.native, state: 'completed', completedAt: f.state.now, evidence: 'FINAL' };
        await f.sync();
        const done = f.collaboration.jobs.get(job.id);
        assert.equal(done.state, 'completed', 'the absorbed send finishes with its turn instead of waiting 15 minutes');
        assert.equal(done.answer, 'FINAL');
      } finally { f.cleanup(); }
    },
  },
  {
    name: 'An absorbed message must be this send: other text or an older copy does not complete it',
    async run() {
      const f = fixture();
      try {
        f.state.native = { available: true, state: 'completed', requestId: 'r1', request: 'first', requestAt: f.state.now - 60_000, completedAt: f.state.now - 50_000, evidence: 'E1', absorbed: [] };
        await f.sync();
        const { job } = await f.send('세 번째 요청');
        f.state.now += 5_000;
        f.state.native = { ...f.state.native, state: 'completed', completedAt: f.state.now, evidence: 'OTHER',
          absorbed: [{ text: '다른 요청', at: job.sentAt + 10 }, { text: '세 번째 요청', at: job.sentAt - 60_000 }] };
        await f.sync();
        assert.equal(f.collaboration.jobs.get(job.id).state, 'running');
      } finally { f.cleanup(); }
    },
  },
  {
    // Real job 3a41cbda (v2.0.27): an immediate Summary send right after
    // "✻ Baked for 12m 5s · done 9:54 AM"; the Claude turn it started ran past
    // 15 minutes and the job was marked "15분 안에 완료를 확인하지 못했습니다".
    name: 'A Summary turn still working after 15 minutes keeps its job, holds later sends as queued, then completes',
    async run() {
      const f = fixture();
      try {
        f.state.screen = idleScreen.replace('Churned for 10s · done 3:06 PM', 'Baked for 12m 5s · done 9:54 AM');
        f.state.native = { available: true, state: 'completed', inputWaiting: true, requestId: '7d841627-prev', request: 'first',
          requestAt: f.state.now - 13 * MINUTE, completedAt: f.state.now - MINUTE, evidence: 'E1', absorbed: [] };
        await f.sync();
        const request = '전체 내용 전부 수정해줘야해 그리고 요약모드에서 ai가 작업중입니다 내용도 더 풍부하게 적어주면 좋겠어.';
        const { job } = await f.send(request, { sendNow: true });
        assert.equal(job.state, 'running');
        f.state.screen = workingScreen('✻ Baking… (41m 3s · ↓ 120k tokens)');
        for (let minute = 1; minute <= 45; minute += 1) {
          f.state.now += MINUTE;
          f.state.native = { available: true, state: 'working', inputWaiting: false, requestId: 'r-long', request,
            requestAt: job.sentAt + 500, completedAt: job.sentAt - MINUTE, absorbed: [] };
          await f.sync();
          assert.equal(f.job(job.id).state, 'running', `still working at minute ${minute}`);
        }
        assert.deepEqual(await f.send('다음 요청'), { deferred: true, reason: 'previous' }, 'a later send waits as queued, never fails');
        assert.equal(f.state.writes.length, 1);
        f.state.now += MINUTE;
        f.state.screen = idleScreen;
        f.state.native = { ...f.state.native, state: 'completed', inputWaiting: true, completedAt: f.state.now, evidence: 'LONG DONE' };
        await f.sync();
        assert.equal(f.job(job.id).state, 'completed');
        assert.equal(f.job(job.id).answer, 'LONG DONE');
        const next = await f.send('다음 요청');
        assert.equal(next.job.state, 'running', 'the queued request goes out once the long turn ends');
      } finally { f.cleanup(); }
    },
  },
  {
    name: 'An idle AI whose finished turn never matches the send releases the queue after 3 minutes, with a reason',
    async run() {
      const f = fixture();
      try {
        f.state.native = { available: true, state: 'completed', inputWaiting: true, requestId: 'r1', request: 'first',
          requestAt: f.state.now - MINUTE, completedAt: f.state.now - 30_000, evidence: 'E1', absorbed: [] };
        await f.sync();
        const { job } = await f.send('짝이 맞지 않는 요청');
        f.state.native = { ...f.state.native, requestId: 'other', request: '터미널에서 직접 친 다른 요청', requestAt: job.sentAt + 1000, completedAt: job.sentAt + 2000, evidence: 'OTHER' };
        for (let minute = 1; minute <= 3; minute += 1) { f.state.now += MINUTE; await f.sync(); }
        assert.equal(f.job(job.id).state, 'running', 'a short idle gap is not a failure');
        f.state.now += MINUTE; await f.sync();
        assert.equal(f.job(job.id).state, 'interrupted');
        assert.match(f.job(job.id).error, /완료 기록을 찾지 못했습니다/u);
        assert.equal(f.job(job.id).answer, undefined, 'another turn is never attributed to this send');
      } finally { f.cleanup(); }
    },
  },
  {
    name: 'A skill sent from Summary completes when Claude logs it under its plugin name in tags',
    async run() {
      const f = fixture();
      try {
        f.state.native = { available: true, state: 'completed', inputWaiting: true, requestId: 'r1', request: 'first',
          requestAt: f.state.now - MINUTE, completedAt: f.state.now - 30_000, evidence: 'E1', absorbed: [] };
        await f.sync();
        const { job } = await f.send('/grill-with-docs 내가 /clear를 하면 요약도 비워져야 해');
        f.state.native = { ...f.state.native, requestId: 'r2', requestAt: job.sentAt + 500, completedAt: job.sentAt + 5000, evidence: 'GRILL',
          request: '<command-message>mattpocock-skills:grill-with-docs</command-message>\n<command-name>/mattpocock-skills:grill-with-docs</command-name>\n<command-args>내가 /clear를 하면 요약도 비워져야 해</command-args>' };
        f.state.now += 10_000; await f.sync();
        assert.equal(f.job(job.id).state, 'completed', 'the tagged skill turn is this send');
        assert.equal(f.job(job.id).answer, 'GRILL');
        const other = await f.send('/grill-with-docs 다른 질문');
        f.state.native = { ...f.state.native, requestId: 'r3', requestAt: other.job.sentAt + 500, completedAt: other.job.sentAt + 5000, evidence: 'OTHER',
          request: '<command-name>/mattpocock-skills:grill-me</command-name>\n<command-args>다른 질문</command-args>' };
        f.state.now += 10_000; await f.sync();
        assert.equal(f.job(other.job.id).state, 'running', 'a different skill with the same words is not this send');
      } finally { f.cleanup(); }
    },
  },
  {
    name: 'Without any work signal a Summary job ends 15 minutes after the last one, not 15 minutes after sending',
    async run() {
      const f = fixture();
      try {
        f.state.native = { available: true, state: 'completed', inputWaiting: true, requestId: 'r1', request: 'first', requestAt: f.state.now - MINUTE, completedAt: f.state.now - 30_000, evidence: 'E1', absorbed: [] };
        await f.sync();
        const { job } = await f.send('긴 작업');
        f.state.screen = workingScreen('✶ Pondering… (20m 1s · ↑ 1.2k tokens)');
        f.state.native = { available: true, state: 'working', inputWaiting: false, requestId: 'r2', request: '긴 작업', requestAt: job.sentAt + 100, absorbed: [] };
        for (let minute = 1; minute <= 20; minute += 1) { f.state.now += MINUTE; await f.sync(); }
        // The renderer stops reporting the pane: no observation, no work signal.
        f.state.now += 14 * MINUTE; await f.sync({ frames: false });
        assert.equal(f.job(job.id).state, 'running');
        f.state.now += 2 * MINUTE; await f.sync({ frames: false });
        assert.equal(f.job(job.id).state, 'interrupted');
        assert.match(f.job(job.id).error, /15분 동안 상대 AI의 작업 신호/u);
      } finally { f.cleanup(); }
    },
  },
  {
    name: 'Esc in the terminal stops the Summary job at once instead of holding the queue for 15 minutes',
    async run() {
      const f = fixture();
      try {
        f.state.native = { available: true, state: 'completed', inputWaiting: true, requestId: 'r1', request: 'first', requestAt: f.state.now - MINUTE, completedAt: f.state.now - 30_000, evidence: 'E1', absorbed: [] };
        await f.sync();
        const old = await f.send('first');
        assert.equal(old.job.state, 'running');
        f.state.now += 5_000;
        // An older aborted turn is not this send.
        f.state.native = { ...f.state.native, state: 'interrupted', inputWaiting: true };
        await f.sync();
        assert.equal(f.job(old.job.id).state, 'running', 'an earlier abort never ends a newer send');
        f.state.native = { available: true, state: 'interrupted', inputWaiting: true, requestId: 'r2', request: 'first', requestAt: old.job.sentAt + 300, absorbed: [] };
        f.state.now += 5_000; await f.sync();
        assert.equal(f.job(old.job.id).state, 'stopped');
        assert.deepEqual((await f.send('next')).job.state, 'running', 'the next send is not blocked');
      } finally { f.cleanup(); }
    },
  },
  {
    name: 'One missed process scan neither fails a queued send nor interrupts a running job; a lasting absence does',
    async run() {
      const f = fixture();
      try {
        f.state.native = { available: true, state: 'completed', inputWaiting: true, requestId: 'r1', request: 'first', requestAt: f.state.now - MINUTE, completedAt: f.state.now - 30_000, evidence: 'E1', absorbed: [] };
        await f.sync();
        f.state.scanMissing = true; await f.sync();
        assert.deepEqual(await f.send('스캔이 놓친 순간의 요청'), { deferred: true, reason: 'screen' }, 'stays queued');
        f.state.scanMissing = false; await f.sync();
        const { job } = await f.send('스캔이 놓친 순간의 요청');
        assert.equal(job.state, 'running');
        f.state.native = { available: true, state: 'working', inputWaiting: false, requestId: 'r2', request: '스캔이 놓친 순간의 요청', requestAt: job.sentAt + 100, absorbed: [] };
        f.state.scanMissing = true; f.state.now += 5_000; await f.sync();
        assert.equal(f.job(job.id).state, 'running', 'one missed scan is transient');
        f.state.scanMissing = false; f.state.now += 5_000; await f.sync();
        f.state.scanMissing = true; f.state.now += 5_000; await f.sync();
        f.state.now += 31_000; await f.sync();
        assert.equal(f.job(job.id).state, 'interrupted', 'an AI gone for 30 seconds ends the job');
      } finally { f.cleanup(); }
    },
  },
  {
    name: 'A deferred Summary send names what it waits for',
    async run() {
      const f = fixture();
      try {
        f.state.native = { available: true, state: 'completed', inputWaiting: true, requestId: 'r1', request: 'first', requestAt: f.state.now - MINUTE, completedAt: f.state.now - 30_000, evidence: 'E1', absorbed: [] };
        f.state.inputDraft = '터미널에 쓰던 글'; await f.sync();
        assert.deepEqual(await f.send('a'), { deferred: true, reason: 'draft' });
        f.state.inputDraft = ''; f.state.screen = workingScreen('✻ Thinking…'); await f.sync();
        assert.deepEqual(await f.send('a'), { deferred: true, reason: 'working' });
        f.state.screen = idleScreen; f.state.native = { ...f.state.native, state: 'working', inputWaiting: false }; await f.sync();
        assert.deepEqual(await f.send('a'), { deferred: true, reason: 'working' });
        assert.equal(f.state.writes.length, 0);
      } finally { f.cleanup(); }
    },
  },
];

module.exports = { registerSummaryAbsorbedCompletionTests: context => {
  for (const item of tests) context.test(item.name, item.run);
} };
