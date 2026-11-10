'use strict';

// Live Summary progress comes from the provider's own session log with no
// model call: the running tool as a kind, or the AI's latest progress line.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { toolActivity, currentProgress, progressNote } = require('../src/terminalProgress');
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
  assert.deepEqual(toolActivity('mcp__whitebox_panel__whitebox_ask', {}), { kind: 'mcp', detail: 'whitebox_panel' });
  assert.equal(progressNote('**엔드포인트가 브랜치마다 어떻게 다른지 비교하고 있습니다.** 이어서 정리합니다.'), '엔드포인트가 브랜치마다 어떻게 다른지 비교하고 있습니다.');

  // Most recent event wins.
  const state = { requestId: 'r', seq: 0, tools: [], answer: '' };
  assert.deepEqual(currentProgress(state), { kind: 'thinking', phase: 'thinking' });
  assert.equal(currentProgress({ ...state, complete: true }), null, 'a finished turn has no live step');

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
  } finally { await fs.rm(root, { recursive: true, force: true }); }
  console.log('PASS live progress: tool kinds without arguments, AI progress lines, most-recent ordering through the real session log');
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = main;
