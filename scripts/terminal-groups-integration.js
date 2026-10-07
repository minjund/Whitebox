'use strict';

const { app } = require('electron');
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { TerminalManager } = require('../src/terminalManager');
const { ManagedTmuxRuntime } = require('../src/managedTmuxRuntime');
const { TerminalGroups } = require('../src/terminalGroups');

process.env.PATH = ['/opt/homebrew/bin', '/usr/local/bin', process.env.PATH].join(path.delimiter);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-groups-e2e-'));
  const socket = `wb-groups-${process.pid}`;
  const runtime = new ManagedTmuxRuntime();
  const manager = new TerminalManager({ storeFile: path.join(directory, 'sessions.json'), managedTmuxRuntime: runtime,
    agentProviders: Object.fromEntries(['codex', 'claude', 'gemini'].map(id => [id, { command: '/bin/sh', args: ['-i'], label: id }])) });
  // Keep the real group API unchanged, but isolate this test's tmux server.
  const host = {
    list: () => manager.list(), get: (...args) => manager.get(...args), retire: id => manager.retire(id),
    create: options => manager.create({ ...options, initialCommand: '', tmuxSocket: socket }),
  };
  const storeFile = path.join(directory, 'groups.json');
  try {
    const service = new TerminalGroups({ manager: () => host, storeFile });
    const group = await service.create({ cwd: directory, name: '실제 tmux 그룹', ownerId: 'fixture' });
    const first = await service.add(group.id, { provider: 'claude' });
    const second = await service.add(group.id, { provider: 'codex' });
    const firstOptions = { ...manager.required(first.terminalId).options };
    const secondOptions = { ...manager.required(second.terminalId).options };
    for (let i = 0; i < 100 && (!runtime.existsStrict(firstOptions) || !runtime.existsStrict(secondOptions)); i += 1) await wait(50);
    assert.equal(runtime.existsStrict(firstOptions), true);
    assert.equal(runtime.existsStrict(secondOptions), true);
    manager.command(second.terminalId, "printf 'GROUP_TERMINAL_INPUT_OK\\n'");
    for (let i = 0; i < 100 && !manager.get(second.terminalId, true).replay.includes('GROUP_TERMINAL_INPUT_OK'); i += 1) await wait(50);
    assert.match(manager.get(second.terminalId, true).replay, /GROUP_TERMINAL_INPUT_OK/);
    await service.remove(group.id, first.creationId);
    assert.equal(runtime.existsStrict(firstOptions), false, 'removed AI must be gone from tmux');
    assert.equal(manager.get(first.terminalId), null, 'removed AI must be gone from terminal registry');
    assert.equal(runtime.existsStrict(secondOptions), true, 'other group members must keep running');
    const restored = new TerminalGroups({ manager: () => host, storeFile });
    assert.equal((await restored.list())[0].members.length, 1);
    const replacement = await restored.add(group.id, { provider: 'claude' });
    assert.notEqual(replacement.creationId, first.creationId, 'adding again must create a fresh AI session');
    await restored.delete(group.id);
    assert.equal(runtime.existsStrict(secondOptions), false);
    assert.equal(manager.list().length, 0);
    assert.deepEqual(await restored.list(), []);
    console.log('✓ 실제 tmux: AI 추가·입력/출력·제외 시 런타임/기록 삭제·나머지 유지·복원·새 AI 재추가·전체 삭제');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally {
    await manager.dispose();
    try { runtime.execute({ tmuxSocket: socket }, ['kill-server']); } catch (_) { /* An empty server exits itself. */ }
    fs.rmSync(directory, { recursive: true, force: true });
    app.exit(process.exitCode || 0);
  }
});
