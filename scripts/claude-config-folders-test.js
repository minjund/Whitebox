'use strict';

// claude-ubion runs Claude Code with CLAUDE_CONFIG_DIR=~/.claude-ubion. Its
// sessions/<pid>.json and projects/ logs must be found like ~/.claude ones.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { claudeHomes } = require('../src/claudeHomes');
const { TerminalReviewCompletion } = require('../src/terminalReviewCompletion');
const { AgentMonitor } = require('../src/agentMonitor');

module.exports = async function claudeConfigFoldersTest() {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'whitebox-claude-homes-'));
  try {
    const standard = path.join(home, '.claude'), ubion = path.join(home, '.claude-ubion');
    await fs.mkdir(path.join(standard, 'projects'), { recursive: true });
    await fs.mkdir(path.join(ubion, 'sessions'), { recursive: true });
    await fs.mkdir(path.join(home, '.claude-empty'));
    await fs.writeFile(path.join(home, '.claude-file'), 'not a folder');
    assert.deepEqual(claudeHomes({ home, env: {} }), [standard, ubion], 'only folders Claude has written into are config folders');
    const custom = path.join(home, 'custom');
    assert.deepEqual(claudeHomes({ home, env: { CLAUDE_CONFIG_DIR: custom } })[0], custom, 'CLAUDE_CONFIG_DIR comes first');

    const start = Date.now() - 10_000, stamp = delta => new Date(start + delta).toISOString();
    const sessionId = '6a2a9d43-61a4-4d7e-9a3f-7c11c0f5b8a1';
    await fs.writeFile(path.join(ubion, 'sessions/201.json'), JSON.stringify({ pid: 201, kind: 'interactive', sessionId, cwd: '/project', startedAt: start, status: 'idle' }));
    const log = path.join(ubion, 'projects/-project', `${sessionId}.jsonl`);
    await fs.mkdir(path.dirname(log), { recursive: true });
    await fs.writeFile(log, [
      { type: 'user', sessionId, uuid: 'request', timestamp: stamp(1000), message: { role: 'user', content: [{ type: 'text', text: '1+1은?' }] } },
      { type: 'assistant', sessionId, uuid: 'answer', timestamp: stamp(2000), message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: '2입니다. 계산 결과를 확인했습니다.' }] } },
    ].map(row => JSON.stringify(row)).join('\n') + '\n');
    const child = { provider: 'claude', pid: 201, ancestorPids: [200], startedAt: stamp(0) };
    const reader = new TerminalReviewCompletion({ claudeHomes: () => claudeHomes({ home, env: {} }), codexHome: path.join(home, '.codex') });
    const native = await reader.observe(child);
    assert.equal(native.available, true, 'a claude-ubion process is read from ~/.claude-ubion');
    assert.equal(native.state, 'completed');
    assert.equal(native.source.file, log);
    assert.equal((await new TerminalReviewCompletion({ claudeHome: standard }).observe(child)).available, false, 'an explicit single folder stays exact');
    assert.equal((await reader.observe({ ...child, pid: 202 })).available, false, 'no folder has another pid');

    const monitor = new AgentMonitor({ home });
    const snapshot = monitor.scanNow();
    assert(snapshot.sessions.some(session => session.file === log), 'the monitor lists ~/.claude-ubion conversations');
    assert.equal(monitor.scanHomes().filter(item => item.claudeOnly).length, 1, 'extra folders scan Claude logs only');
    console.log('PASS Claude config folders: ~/.claude-<name> discovery, exact process session lookup and monitor scanning');
  } finally { await fs.rm(home, { recursive: true, force: true }); }
};

if (require.main === module) module.exports().catch(error => { console.error(error); process.exit(1); });
