'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { TerminalReviewCompletion } = require('../src/terminalReviewCompletion');
const { TerminalReview } = require('../src/terminalReview');

module.exports = async function completionChecks() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'whitebox-completion-'));
  try {
    const start = Date.parse('2026-10-21T02:00:00Z');
    const stamp = offset => new Date(start + offset).toISOString();
    const sessionId = 'afac24ae-2ef0-4f7f-8c8f-17c4c4274fdb';
    const claudeHome = path.join(root, 'claude'), codexHome = path.join(root, 'codex');
    const metaFile = path.join(claudeHome, 'sessions/101.json');
    const log = path.join(claudeHome, 'projects/-project', `${sessionId}.jsonl`);
    await fs.mkdir(path.dirname(metaFile), { recursive: true });
    await fs.mkdir(path.dirname(log), { recursive: true });
    const metadata = { pid: 101, kind: 'interactive', sessionId, cwd: '/project', startedAt: start, status: 'idle' };
    const setMeta = overrides => fs.writeFile(metaFile, JSON.stringify({ ...metadata, ...overrides }));
    const user = (id, at, text = 'ㅎㅇ') => ({ type: 'user', sessionId, uuid: id, timestamp: stamp(at), message: { role: 'user', content: [{ type: 'text', text }] } });
    const answer = (at, reason = 'end_turn') => ({ type: 'assistant', uuid: `answer-${at}`, sessionId, timestamp: stamp(at), message: { role: 'assistant', stop_reason: reason, content: [{ type: 'thinking', thinking: 'PRIVATE' }, { type: 'text', text: reason === 'end_turn' ? '완료했습니다. 수집한 문서의 설명을 요약해 전달합니다.' : '완료했습니다.' }] } });
    const append = rows => fs.appendFile(log, rows.map(row => JSON.stringify(row) + '\n').join(''));
    const child = { provider: 'claude', pid: 101, ancestorPids: [100], startedAt: stamp(0) };
    const reader = new TerminalReviewCompletion({ claudeHome, codexHome });
    await setMeta({});
    await append([user('old', 1000), answer(2000)]);
    let result = await reader.observe(child);
    assert.equal(result.state, 'completed');
    assert.match(result.evidence, /ㅎㅇ/u);
    assert.doesNotMatch(result.evidence, /PRIVATE/u, 'hidden reasoning is not review evidence');
    await setMeta({ status: 'working' });
    assert.equal((await reader.observe(child)).state, 'working', 'old end_turn cannot override busy process');
    await setMeta({ pid: 102 });
    assert.equal((await reader.observe(child)).available, false, 'wrong process metadata is rejected');
    await setMeta({ startedAt: start - 60000 });
    assert.equal((await reader.observe(child)).available, false, 'reused PID metadata is rejected');
    await setMeta({});

    let now = start + 3000, calls = 0;
    const service = new TerminalReview({ completion: reader, now: () => now,
      manager: () => ({ get: () => ({ id: 'terminal', creationId: 'epoch', pid: 100, status: 'running' }) }),
      monitor: { scan: () => ({ available: true, processes: [child] }) },
      runner: { generateTerminalReview: async ({ prompt }) => { calls++; assert.match(prompt, /완료했습니다/u); return JSON.stringify({ tasks: [{ requestQuote: 'ㅎㅇ', evidenceQuote: '완료했습니다', actual: '완료했다고 보고', alignment: 'aligned' }] }); } } });
    const capture = (submission, force = false) => service.capture({ id: 'terminal', creationId: 'epoch', text: '❯ ㅎㅇ\n⏺ 완료했습니다.\n❯ ', submission, force });
    await capture();
    assert.equal(calls, 0, 'opening old completed conversation never starts analysis');
    const submission = { id: 'new', request: 'ㅎ', at: now }; // PTY echo may still lack the last IME character.
    assert.equal((await capture(submission)).state, 'awaiting-answer');
    now += 10000;
    await capture(submission, true);
    assert.equal(calls, 0, 'previous answer cannot complete the newly submitted request');
    await append([user('new', 3100),
      { ...answer(3200, 'tool_use'), message: { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'fetch-new', name: 'WebFetch', input: { url: 'https://arxiv.org/html/2610.28380v1' } }] } },
      { ...user('tool-response', 3300), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'fetch-new', content: 'Received 395.7KB (200 OK)', is_error: false }] } },
      answer(4000, 'tool_use')]);
    await capture(submission);
    now += 1000; await capture(submission);
    assert.equal(calls, 0, 'tool or permission pause does not mean completed');
    await append([{ ...answer(5000), sessionId: 'another-session' }]);
    assert.notEqual((await reader.observe(child)).state, 'completed', 'other session records cannot finish this turn');
    const final = Buffer.from(JSON.stringify(answer(6000)) + '\n');
    const split = final.indexOf(Buffer.from('완')) + 1;
    await fs.appendFile(log, final.subarray(0, split));
    await capture(submission);
    assert.equal(calls, 0, 'incomplete JSON and UTF-8 are buffered');
    await fs.appendFile(log, final.subarray(split));
    await capture(submission);
    now += 1000; await capture(submission);
    for (let attempt = 0; calls < 1 && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(calls, 1, 'native end_turn completes exactly once even without a screen completion footer');
    now += 90000; await capture(submission);
    assert.equal(calls, 1, 'idle polling does not repeat completed analysis');
    assert.match((await reader.observe(child)).evidence, /완료했습니다/u, 'split UTF-8 preserved');
    assert.equal((await reader.observe(child)).tools.items[0].status, 'returned');
    assert.match((await reader.observe(child)).tools.items[0].excerpt, /200 OK/u, 'native projection retains tool evidence');
    await append([{ type: 'user', sessionId, uuid: 'tool', timestamp: stamp(7000), message: { role: 'user', content: [{ type: 'tool_result', content: 'result' }] } }]);
    assert.equal((await reader.observe(child)).requestId, 'new', 'tool result is not a submitted chat request');
    await setMeta({ status: 'shell', statusUpdatedAt: start + 8000 });
    assert.equal((await reader.observe(child)).state, 'working', 'a shell plus end_turn alone cannot prove the turn ended');
    const turnEnd = { type: 'system', subtype: 'turn_duration', sessionId, uuid: 'duration', parentUuid: 'hook-summary', timestamp: stamp(8000) };
    await append([{ ...turnEnd, parentUuid: 'unrelated-answer' }, { ...turnEnd, isSidechain: true }]);
    assert.equal((await reader.observe(child)).state, 'working', 'unrelated or sidechain completion cannot release the wait');
    await append([{ type: 'system', subtype: 'stop_hook_summary', sessionId, uuid: 'hook-summary', parentUuid: 'answer-6000', timestamp: stamp(7900) }, turnEnd]);
    assert.equal((await reader.observe(child)).state, 'completed', 'linked completed turn is ready even while the background server stays alive');
    await setMeta({ status: 'working', statusUpdatedAt: start + 8000 });
    assert.equal((await reader.observe(child)).state, 'working', 'active inference still blocks analysis');
    await setMeta({ status: 'shell', statusUpdatedAt: start + 5000 });
    assert.equal((await reader.observe(child)).state, 'working', 'stale shell metadata cannot confirm a newer reply');
    await setMeta({ status: 'shell', statusUpdatedAt: start + 8000 });
    await append([user('background-notification', 8050, '<task-notification>\n<task-id>agent-1</task-id>\n<status>completed</status>\n</task-notification>')]);
    assert.equal((await reader.observe(child)).requestId, 'new', 'background completion notification is not a new human request');
    assert.equal((await reader.observe(child)).state, 'completed', 'notification after the final answer preserves its completion');
    await append([{ type: 'api-request', sessionId, timestamp: stamp(8100) }]);
    assert.equal((await reader.observe(child)).state, 'working', 'a subsequent API request invalidates the old turn-end record');
    await append([{ ...user('agent-handback', 8200, 'Another Claude session sent a message:\n<agent-message>Done</agent-message>'), isMeta: true }, answer(9000)]);
    await setMeta({ status: 'idle', statusUpdatedAt: start + 9000 });
    await capture(submission);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 1, 'unchanged background answer does not repeat analysis');
    await append([{ ...answer(10000), message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: '완료했습니다. 검사 결과를 반영한 7개 에픽입니다.' }] } }, user('late-notification', 10010, '<task-notification>completed</task-notification>')]);
    await capture(submission);
    for (let attempt = 0; calls < 2 && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(calls, 2, 'a new completed answer after background hand-back refreshes the same request');
    assert.equal(service.entries.get('terminal').result.tasks.length, 1, 'background continuation updates one request card');
    await capture(submission);
    assert.equal(calls, 2, 'the final background answer is reviewed only once');
    const repeat = { id: 'repeat', request: 'ㅎㅇ', at: now };
    await capture(repeat); now += 1000; await capture(repeat);
    assert.equal(calls, 2, 'same request submitted again cannot reuse its previous completion');
    await fs.appendFile(log, ' '.repeat(2 * 1024 * 1024) + '\n' + JSON.stringify(answer(100000)) + '\n');
    assert.equal((await reader.observe(child)).state, 'completed', 'a large append is rescanned within the 32 MiB cap without discarding request ownership');
    assert.equal((await reader.observe(child)).source.skippedBytes, 0);

    const codexLog = path.join(codexHome, 'sessions/2026/10/21/rollout-test.jsonl');
    await fs.mkdir(path.dirname(codexLog), { recursive: true });
    const event = (type, payload, at = 1000) => ({ type, timestamp: stamp(at), payload });
    const writeCodex = rows => fs.writeFile(codexLog, rows.map(row => JSON.stringify(row) + '\n').join(''));
    const codexReader = new TerminalReviewCompletion({ codexHome, platform: 'darwin', execute: async (command, args) => {
      assert.equal(command, 'lsof'); assert.deepEqual(args, ['-a', '-p', '201', '-Fn']);
      return { stdout: `p201\nn${codexLog}\n` };
    } });
    const codex = { provider: 'codex', pid: 201, startedAt: stamp(0) };
    const codexRows = [event('event_msg', { type: 'task_started', turn_id: 'turn-1' }),
      event('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'fix it' }] }),
      event('response_item', { type: 'function_call', call_id: 'codex-read', name: 'exec_command', arguments: '{}' }, 1100),
      event('response_item', { type: 'function_call_output', call_id: 'codex-read', output: 'Process exited with code 0' }, 1200),
      event('event_msg', { type: 'task_complete', turn_id: 'wrong-turn', last_agent_message: 'wrong' }, 2000)];
    await writeCodex(codexRows);
    assert.notEqual((await codexReader.observe(codex)).state, 'completed', 'completion must match the current Codex turn');
    await fs.appendFile(codexLog, JSON.stringify(event('event_msg', { type: 'task_complete', turn_id: 'turn-1', last_agent_message: 'fixed' }, 3000)) + '\n');
    assert.match((await codexReader.observe(codex)).evidence, /fixed/u);
    assert.equal((await codexReader.observe(codex)).tools.items[0].status, 'returned');
    await fs.appendFile(codexLog, JSON.stringify(event('event_msg', { type: 'task_started', turn_id: 'turn-2' }, 4000)) + '\n');
    assert.equal((await codexReader.observe(codex)).state, 'working');
    const ambiguous = new TerminalReviewCompletion({ codexHome, platform: 'darwin', execute: async () => ({ stdout: `n${codexLog}\nn${codexLog.replace('test', 'other')}\n` }) });
    assert.equal((await ambiguous.observe(codex)).available, false, 'ambiguous open logs cannot bind another conversation');
    console.log('PASS native Claude/Codex completion: exact process/turn, no footer, IME echo, partial UTF-8, busy/tool/old-answer rejection, single analysis');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
};
