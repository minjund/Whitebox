'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { parseClaude, parseCodex } = require('../src/agentMonitor');
const { TerminalReviewCompletion } = require('../src/terminalReviewCompletion');
const { conversationBackground, shellBackground } = require('../src/terminalBackground');
const { processTable, TerminalActivity } = require('../src/terminalActivity');

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'whitebox-background-'));
  try {
    const now = Date.now(), start = now - 10000, stamp = delta => new Date(start + delta).toISOString();
    const sessionId = 'c09cb209-e300-4ecb-9707-5367936c013c';
    const claudeHome = path.join(root, 'claude'), file = path.join(claudeHome, 'projects/-project', sessionId + '.jsonl');
    await fs.mkdir(path.dirname(file), { recursive: true }); await fs.mkdir(path.join(claudeHome, 'sessions'));
    await fs.writeFile(path.join(claudeHome, 'sessions/101.json'), JSON.stringify({ pid: 101, kind: 'interactive', sessionId, cwd: '/project', startedAt: start, status: 'idle' }));
    const rows = [
      { type: 'user', sessionId, uuid: 'request', timestamp: stamp(1000), message: { role: 'user', content: '백그라운드 검사를 실행해줘' } },
      { type: 'assistant', sessionId, uuid: 'call', timestamp: stamp(2000), message: { role: 'assistant', content: [{ type: 'tool_use', id: 'bash-1', name: 'Bash', input: { command: 'npm test --secret PRIVATE_ARG', description: '회귀 테스트 실행', run_in_background: true } }] } },
      { type: 'user', sessionId, uuid: 'output', timestamp: stamp(3000), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'bash-1', content: 'Command running in background with ID: bg-1' }] } },
    ];
    const write = () => fs.writeFile(file, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
    const parsed = async (target, parser) => parser({ file: target, ...await fs.stat(target) });
    await write();
    const child = { provider: 'claude', pid: 101, startedAt: stamp(0) };
    const reader = new TerminalReviewCompletion({ claudeHome });
    const native = await reader.observe(child);
    const snapshot = { generatedAt: new Date(now).toISOString(), sessions: [await parsed(file, parseClaude)] };
    const jobs = conversationBackground(native, child, snapshot, now);
    assert.equal(jobs.length, 1); assert.equal(jobs[0].label, '회귀 테스트 실행');
    assert(!JSON.stringify(jobs).includes('PRIVATE_ARG'), 'commands, output and prompts are not sidebar metadata');
    const longCommand = 'node ' + 'long-argument '.repeat(20) + 'PRIVATE_ARG';
    const truncated = { ...snapshot.sessions[0], executions: [{ ...snapshot.sessions[0].executions[0], command: longCommand, label: longCommand.slice(0, 180) + '…' }] };
    assert.equal(conversationBackground(native, child, { ...snapshot, sessions: [truncated] }, now)[0].label, truncated.executions[0].runtime, 'truncated raw commands are not mistaken for safe descriptions');
    assert.deepEqual(conversationBackground({ available: false }, child, snapshot, now), []);
    assert.deepEqual(conversationBackground(native, child, { ...snapshot, generatedAt: stamp(-10000) }, now), [], 'stale monitor snapshots never claim running work');
    assert.deepEqual(conversationBackground(native, child, { ...snapshot, sessions: [{ ...snapshot.sessions[0], file: file + '.foreign' }] }, now), [], 'same cwd/title is not ownership');
    assert.deepEqual(conversationBackground(native, child, { ...snapshot, sessions: [snapshot.sessions[0], snapshot.sessions[0]] }, now), [], 'ambiguous history is rejected');
    assert.deepEqual(conversationBackground(native, { ...child, startedAt: stamp(9000) }, snapshot, now), [], 'a resumed process cannot inherit old background launches');
    // A quiet long-running command goes unverified in the log; only a live
    // process under the same AI process with the exact command keeps it.
    const quiet = { ...snapshot.sessions[0], executions: snapshot.sessions[0].executions.map(item => ({ ...item, status: 'unverified' })) };
    const quietSnapshot = { ...snapshot, sessions: [quiet] };
    const command = quiet.executions[0].command;
    const proc = (pid, extra = {}) => ({ pid, parentPid: 101, pgid: pid, stat: 'S', ancestorPids: [101, 1], commandLine: `/bin/zsh -c source snap && eval '${command}' < /dev/null`, ...extra });
    assert.deepEqual(conversationBackground(native, child, quietSnapshot, now), [], 'unverified without process evidence stays hidden');
    assert.equal(conversationBackground(native, child, quietSnapshot, now, [proc(500)]).length, 1, 'a live matching process keeps a quiet background command visible');
    assert.equal(conversationBackground(native, child, quietSnapshot, now, [proc(500), proc(501, { pgid: 500, parentPid: 500, ancestorPids: [500, 101, 1] })]).length, 1, 'a pipeline proves one command once');
    assert.deepEqual(conversationBackground(native, child, quietSnapshot, now, [proc(500, { ancestorPids: [999, 1], parentPid: 999 })]), [], 'another AI process tree is not evidence');
    assert.deepEqual(conversationBackground(native, child, quietSnapshot, now, [proc(500, { stat: 'Z' })]), [], 'a zombie is not running work');
    assert.deepEqual(conversationBackground(native, child, quietSnapshot, now, [proc(500, { commandLine: '/bin/zsh -c npm test' })]), [], 'a different command line is not evidence');
    const twice = { ...quiet, executions: [quiet.executions[0], { ...quiet.executions[0], id: 'bash-2', backgroundId: 'bg-2' }] };
    assert.equal(conversationBackground(native, child, { ...snapshot, sessions: [twice] }, now, [proc(500)]).length, 1, 'one live process never revives a finished duplicate');
    const quoting = { ...quiet, executions: [{ ...quiet.executions[0], command: "printf 'x'" }] };
    assert.equal(conversationBackground(native, child, { ...snapshot, sessions: [quoting] }, now, [proc(500, { commandLine: "/bin/zsh -c eval 'printf '\\''x'\\''' < /dev/null" })]).length, 1, 'shell-quoted commands still match');
    rows.push({ type: 'user', sessionId, uuid: 'notification', isMeta: true, timestamp: stamp(4000), message: { role: 'user', content: '<task-notification><task-id>bg-1</task-id><tool-use-id>bash-1</tool-use-id><status>completed</status></task-notification>' } });
    await write();
    assert.equal(conversationBackground(await reader.observe(child), child, { ...snapshot, sessions: [await parsed(file, parseClaude)] }, now).length, 0, 'completion removes the actual parsed background command');

    const codexHome = path.join(root, 'codex'), codexFile = path.join(codexHome, 'sessions/2026/11/04/rollout-' + sessionId + '.jsonl');
    await fs.mkdir(path.dirname(codexFile), { recursive: true });
    const codexRows = [
      { type: 'session_meta', timestamp: stamp(0), payload: { id: sessionId } },
      { type: 'response_item', timestamp: stamp(1000), payload: { type: 'function_call', name: 'exec_command', call_id: 'exec', arguments: JSON.stringify({ cmd: 'node --token PRIVATE_ARG' }) } },
      { type: 'response_item', timestamp: stamp(2000), payload: { type: 'function_call_output', call_id: 'exec', output: 'Process running with session ID 77' } },
      { type: 'response_item', timestamp: stamp(3000), payload: { type: 'function_call', name: 'spawn_agent', call_id: 'spawn', arguments: JSON.stringify({ task_name: 'audit', message: 'PRIVATE_PROMPT' }) } },
      { type: 'response_item', timestamp: stamp(4000), payload: { type: 'function_call_output', call_id: 'spawn', output: JSON.stringify({ agent_id: 'child-1', task_name: '/root/audit' }) } },
      { type: 'event_msg', timestamp: stamp(5000), payload: { type: 'sub_agent_activity', kind: 'started', event_id: 'agent-start', agent_thread_id: 'child-1', agent_path: '/root/audit' } },
    ];
    const writeCodex = () => fs.writeFile(codexFile, codexRows.map(row => JSON.stringify(row)).join('\n') + '\n');
    await writeCodex();
    const codexChild = { provider: 'codex', pid: 202, startedAt: stamp(0) };
    const codexReader = new TerminalReviewCompletion({ codexHome, platform: 'darwin', execute: async () => ({ stdout: 'n' + codexFile }) });
    const codexSnapshot = { generatedAt: new Date(now).toISOString(), sessions: [await parsed(codexFile, parseCodex)] };
    const codexJobs = conversationBackground(await codexReader.observe(codexChild), codexChild, codexSnapshot, now);
    assert.equal(codexJobs.length, 2, 'native yielded command and confirmed helper agent each count once');
    assert(!JSON.stringify(codexJobs).includes('PRIVATE_'));
    codexRows.push(
      { type: 'response_item', timestamp: stamp(6000), payload: { type: 'function_call', name: 'write_stdin', call_id: 'wait', arguments: '{"session_id":77}' } },
      { type: 'response_item', timestamp: stamp(7000), payload: { type: 'function_call_output', call_id: 'wait', output: 'Process exited with code 0' } },
      { type: 'event_msg', timestamp: stamp(8000), payload: { type: 'sub_agent_activity', kind: 'completed', event_id: 'agent-end', agent_thread_id: 'child-1', agent_path: '/root/audit' } },
    );
    await writeCodex();
    assert.equal(conversationBackground(await codexReader.observe(codexChild), codexChild, { ...codexSnapshot, sessions: [await parsed(codexFile, parseCodex)] }, now).length, 0);

    const table = '100 1 100 150 Ss 00:10 /bin/zsh /bin/zsh\n150 100 150 150 S 00:02 /bin/sleep sleep 30\n160 100 160 150 S 00:02 /usr/bin/node node secret\n161 160 160 150 S 00:01 /usr/bin/tee tee\n170 100 170 150 T 00:01 /bin/sleep sleep\n180 100 180 150 Z 00:01 /bin/sleep sleep\n999 1 999 999 R 00:10 /bin/yes yes';
    const processRows = processTable(table, now);
    const shellJobs = shellBackground(processRows, processRows[0]);
    assert.equal(shellJobs.length, 1); assert.equal(shellJobs[0].label, 'node');
    assert(!JSON.stringify(shellJobs).includes('secret'));
    const activity = new TerminalActivity({ now: () => now, platform: 'darwin', execute: async () => ({ stdout: table }) });
    const value = (await activity.observe([{ id: 'terminal', creationId: 'epoch', pid: 100 }], new Map())).get('terminal');
    assert.equal(value.background.count, 1); assert.equal(value.state, 'working', 'background work never rewrites the existing foreground dot');
    console.log('PASS terminal background: real Claude/Codex parsers and owned log binding, command/agent lifecycle, duplicates/privacy/stale/restart guards and POSIX job groups');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}
module.exports = main;
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
