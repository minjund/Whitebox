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
  const state = { now: Date.now(), native: { available: false }, writes: [], screen: idleScreen };
  const manager = { get: async id => (id === session.id ? session : null), rawWriteDeliverySupported: () => true,
    write: async (id, data, options) => { state.writes.push({ id, data, options }); } };
  const monitor = { scan: () => ({ available: true, processes: [{ pid: 1200, ancestorPids: [200], provider: 'claude' }] }) };
  const collaboration = new TerminalCollaboration({ enableControl: false, directory, manager: () => manager, monitor,
    completion: { observe: async () => state.native }, now: () => state.now });
  const sync = () => collaboration.sync({ groups: [{ id: 'group', cwd: directory, members: [session] }],
    frames: [{ id: session.id, creationId: session.creationId, outputSequence: session.outputSequence, text: state.screen, inputDraft: '' }] });
  const send = message => collaboration.summarySend({ id: randomUUID(), groupId: 'group', targetId: session.id, message,
    targetCreationId: session.creationId, targetProviderPid: 1200, targetProvider: 'claude' });
  const cleanup = () => fs.rmSync(directory, { recursive: true, force: true });
  return { state, collaboration, sync, send, cleanup };
}

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
];

module.exports = { registerSummaryAbsorbedCompletionTests: context => {
  for (const item of tests) context.test(item.name, item.run);
} };
