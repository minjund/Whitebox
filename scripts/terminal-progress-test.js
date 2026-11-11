'use strict';

// Live Summary progress comes from the provider's own session log with no
// model call: the running tool as a kind, or the AI's latest progress line.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { toolActivity, currentProgress, progressNote, observeNotice, recordStep, turnStats } = require('../src/terminalProgress');
const { TerminalReviewCompletion } = require('../src/terminalReviewCompletion');

async function main() {
  // Shell commands contribute a kind or program name, never their arguments.
  assert.deepEqual(toolActivity('Bash', { command: 'npm test -- --grep auth' }), { kind: 'test' });
  assert.deepEqual(toolActivity('Bash', { command: 'cd app && ./gradlew :api:test' }), { kind: 'test' });
  assert.deepEqual(toolActivity('Bash', { command: 'node scripts/terminal-review-label-test.js' }), { kind: 'test' });
  assert.deepEqual(toolActivity('Bash', { command: 'npm run build' }), { kind: 'build' });
  assert.deepEqual(toolActivity('Bash', { command: 'git -C repo status --short' }), { kind: 'git', detail: 'status' });
  assert.deepEqual(toolActivity('Bash', { command: 'rg "token" src' }), { kind: 'read' });
  const secret = toolActivity('Bash', { command: 'curl -H "Authorization: Bearer sk-SECRET" https://api.example.com' });
  assert.deepEqual(secret, { kind: 'command', detail: 'curl' });
  assert.doesNotMatch(JSON.stringify(toolActivity('Bash', { command: 'API_KEY=sk-SECRET deploy --token sk-SECRET' })), /SECRET/u, 'credentials never reach the label');
  assert.deepEqual(toolActivity('exec_command', JSON.stringify({ cmd: 'pytest -q' })), { kind: 'test' });
  assert.deepEqual(toolActivity('Edit', { file_path: '/Users/me/app/src/main.js' }), { kind: 'edit', detail: 'main.js' });
  assert.deepEqual(toolActivity('apply_patch', { input: '*** Begin Patch\n*** Update File: src/a/b.ts\n' }), { kind: 'edit', detail: 'b.ts' });
  assert.deepEqual(toolActivity('WebFetch', { url: 'https://docs.example.com/path?q=secret' }), { kind: 'web', detail: 'docs.example.com' });
  assert.deepEqual(toolActivity('mcp__whitebox_panel__whitebox_ask', {}), { kind: 'mcp', detail: 'whitebox_panel › whitebox_ask' });
  assert.deepEqual(toolActivity('mcp__claude_ai_Figma__get_screenshot', {}), { kind: 'mcp', detail: 'Figma › get_screenshot' }, 'connected tool: server and tool');
  // Concrete detail: what is searched, which helper AI task, which web query.
  assert.deepEqual(toolActivity('Grep', { pattern: 'refreshToken', path: 'src' }), { kind: 'search', detail: 'refreshToken' });
  assert.deepEqual(toolActivity('WebSearch', { query: 'electron 33 release notes' }), { kind: 'web', detail: 'electron 33 release notes' });
  assert.deepEqual(toolActivity('Agent', { description: '인증 실패 원인 조사', prompt: 'PROMPT_SECRET', subagent_type: 'Explore' }), { kind: 'agent', detail: '인증 실패 원인 조사' });
  assert.doesNotMatch(JSON.stringify(toolActivity('Agent', { prompt: 'PROMPT_SECRET' })), /PROMPT_SECRET/u, 'a helper AI prompt never reaches the label');
  // Blocking on work the AI started earlier is a distinct wait.
  assert.deepEqual(toolActivity('TaskOutput', { task_id: 'b1' }), { kind: 'wait' });
  assert.deepEqual(toolActivity('write_stdin', JSON.stringify({ session_id: 3, chars: '' })), { kind: 'wait' });
  assert.equal(toolActivity('write_stdin', JSON.stringify({ session_id: 3, chars: 'y\n' })).kind, 'tool', 'typing into a process is not waiting');
  // Current Codex (0.160) runs tools from one `exec` script; its most telling call names the step.
  assert.deepEqual(toolActivity('exec', 'text(await tools.exec_command({cmd:"npm test","max_output_tokens":4000}));'), { kind: 'test' });
  assert.deepEqual(toolActivity('exec', 'const r = await Promise.allSettled([\ntools.exec_command({cmd:"cat a.md"}),\ntools.apply_patch("*** Begin Patch\\n*** Update File: /p/src/a.js\\n@@\\n*** Add File: /p/src/b.js\\n+x\\n*** End Patch")]);'),
    { kind: 'edit', detail: 'a.js', files: ['a.js', 'b.js'] }, 'an edit outranks a read in the same script');
  assert.deepEqual(toolActivity('wait', JSON.stringify({ cell_id: '24', yield_time_ms: 1000 })), { kind: 'wait' });
  assert.deepEqual(toolActivity('sleep', '{}'), { kind: 'wait' });
  const patched = { requestId: 'p', requestAt: 0 };
  recordStep(patched, { kind: 'edit', detail: 'a.js', files: ['a.js', 'b.js'] });
  assert.equal(turnStats(patched).files, 2, 'every file one patch touches is counted');
  assert.equal(progressNote('**엔드포인트가 브랜치마다 어떻게 다른지 비교하고 있습니다.** 이어서 정리합니다.'), '엔드포인트가 브랜치마다 어떻게 다른지 비교하고 있습니다.');

  // Most recent event wins.
  const state = { requestId: 'r', seq: 0, tools: [], answer: '' };
  assert.deepEqual(currentProgress(state), { kind: 'thinking', phase: 'thinking' });
  assert.equal(currentProgress({ ...state, complete: true }), null, 'a finished turn has no live step');
  // Several helper AIs started together are counted.
  const agents = { requestId: 'r', seq: 2, answerSeq: 0, answer: '', tools: [
    { id: 'a', status: 'called', seq: 1, activity: { kind: 'agent', detail: 'one' } }, { id: 'b', status: 'called', seq: 2, activity: { kind: 'agent', detail: 'two' } }] };
  assert.deepEqual(currentProgress(agents), { kind: 'agent', detail: 'two', phase: 'running', count: 2 });
  // Waits Claude logs itself: a usage-limit pause and an API retry, cleared by the next request.
  const waits = { requestId: 'r', seq: 1, answerSeq: 1, answer: '확인 중입니다.', tools: [] };
  observeNotice(waits, { type: 'system', subtype: 'informational', content: 'Usage limit reached · continuing automatically at 6:50pm · esc to cancel' });
  assert.deepEqual(currentProgress(waits), { kind: 'limit', detail: '6:50pm', phase: 'notice' });
  observeNotice(waits, { type: 'system', subtype: 'api_error', retryAttempt: 2, maxRetries: 10, retryInMs: 5000 });
  assert.deepEqual(currentProgress(waits), { kind: 'retry', detail: '2/10', phase: 'notice' });
  observeNotice(waits, { type: 'api-request' });
  assert.equal(currentProgress(waits).kind, 'note', 'the next request clears the wait');
  // Lightweight per-request counts reset with the request.
  const counted = { requestId: 'r', requestAt: 1000 };
  for (const activity of [{ kind: 'read' }, { kind: 'edit', detail: 'a.js' }, { kind: 'edit', detail: 'a.js' }, { kind: 'edit', detail: 'b.js' }]) recordStep(counted, activity);
  assert.deepEqual(turnStats(counted), { since: 1000, steps: 4, files: 2 });
  counted.requestId = 'next'; counted.requestAt = 2000; recordStep(counted, { kind: 'read' });
  assert.deepEqual(turnStats(counted), { since: 2000, steps: 1, files: 0 }, 'a new request starts from zero');

  // Through the real session-log reader.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'whitebox-progress-'));
  try {
    const start = Date.parse('2026-11-10T02:00:00Z'), stamp = at => new Date(start + at).toISOString();
    const sessionId = 'b1f0c2d3-1111-4222-8333-944455556666';
    const claudeHome = path.join(root, 'claude'), log = path.join(claudeHome, 'projects/-p', `${sessionId}.jsonl`);
    await fs.mkdir(path.join(claudeHome, 'sessions'), { recursive: true }); await fs.mkdir(path.dirname(log), { recursive: true });
    await fs.writeFile(path.join(claudeHome, 'sessions/201.json'), JSON.stringify({ pid: 201, kind: 'interactive', sessionId, cwd: '/p', startedAt: start, status: 'busy' }));
    const append = rows => fs.appendFile(log, rows.map(row => JSON.stringify(row) + '\n').join(''));
    const assistant = (at, content, stop = 'tool_use') => ({ type: 'assistant', uuid: `a-${at}`, sessionId, timestamp: stamp(at), message: { role: 'assistant', stop_reason: stop, content } });
    const child = { provider: 'claude', pid: 201, ancestorPids: [200], startedAt: stamp(0) };
    const reader = new TerminalReviewCompletion({ claudeHome, codexHome: path.join(root, 'codex') });
    await append([{ type: 'user', sessionId, uuid: 'u1', timestamp: stamp(1000), message: { role: 'user', content: [{ type: 'text', text: '테스트 고쳐줘' }] } },
      assistant(2000, [{ type: 'text', text: '실패하는 인증 테스트부터 원인을 찾고 있습니다.' }])]);
    let native = await reader.observe(child);
    assert.equal(native.state, 'working');
    assert.deepEqual(native.progress, { kind: 'note', detail: '실패하는 인증 테스트부터 원인을 찾고 있습니다.', phase: 'note' }, 'the AI\'s own progress line');
    await append([assistant(3000, [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test -- --token=SECRET' } }])]);
    native = await reader.observe(child);
    assert.equal(native.progress.kind, 'test'); assert.equal(native.progress.phase, 'running');
    assert.doesNotMatch(JSON.stringify(native.progress), /SECRET/u);
    await append([{ type: 'user', sessionId, uuid: 'r1', timestamp: stamp(4000), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '2 failed' }] } }]);
    native = await reader.observe(child);
    assert.equal(native.progress.kind, 'test'); assert.equal(native.progress.phase, 'after', 'after a tool returns, the AI is reading its result');
    await append([assistant(5000, [{ type: 'tool_use', id: 't2', name: 'Edit', input: { file_path: '/p/src/auth.js', old_string: 'a', new_string: 'b' } }])]);
    native = await reader.observe(child);
    assert.deepEqual([native.progress.kind, native.progress.detail, native.progress.phase], ['edit', 'auth.js', 'running']);
    assert.deepEqual(native.turn, { since: start + 1000, steps: 2, files: 1 }, 'elapsed-time origin, tool calls and edited files of this request');
    await append([{ type: 'user', sessionId, uuid: 'r2', timestamp: stamp(6000), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: 'ok' }] } },
      { type: 'system', subtype: 'informational', sessionId, uuid: 's1', timestamp: stamp(7000), content: 'Usage limit reached · continuing automatically at 6:50pm · esc to cancel', isMeta: false }]);
    native = await reader.observe(child);
    assert.deepEqual(native.progress, { kind: 'limit', detail: '6:50pm', phase: 'notice' }, 'a usage-limit pause from the real session log');
    await append([{ type: 'api-request', sessionId, uuid: 'q1', timestamp: stamp(8000) }]);
    native = await reader.observe(child);
    assert.equal(native.progress.kind, 'edit', 'the resumed request clears the pause');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
  console.log('PASS live progress: tool kinds and concrete details without arguments/prompts, helper AI counts, background waits, usage-limit/retry waits, per-request counts, most-recent ordering through the real session log');
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = main;
