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
  const providers = Object.fromEntries(['codex', 'claude', 'gemini'].map(id => {
    const fixture = path.join(directory, `${id}.sh`);
    fs.writeFileSync(fixture, `printf '%s\\0' "$@" > '${fixture}.argv'\nprintf '%s' "\${CMUX_SURFACE_ID-unset}:\${CODEX_THREAD_ID-unset}:\${TMUX_PANE-unset}" > '${fixture}.env'\nexec /bin/sh -i\n`);
    return [id, { command: '/bin/sh', args: [fixture], label: id }];
  }));
  const manager = new TerminalManager({ storeFile: path.join(directory, 'sessions.json'), managedTmuxRuntime: runtime,
    agentProviders: providers });
  // Keep the real group API unchanged, but isolate this test's tmux server.
  const host = {
    list: () => manager.list(), get: (...args) => manager.get(...args), retire: id => manager.retire(id),
    create: options => {
      if (!host.supportsManagedStartupPrompt) require('../src/terminalManager').normalizeLaunchOptions(options);
      return manager.create({ ...options, tmuxSocket: socket });
    },
  };
  const storeFile = path.join(directory, 'groups.json');
  try {
    const service = new TerminalGroups({ manager: () => host, storeFile });
    const group = await service.create({ cwd: directory, name: '실제 tmux 그룹', ownerId: 'fixture' });
    const first = await service.add(group.id, { provider: 'claude' });
    for (let i = 0; i < 100 && !fs.existsSync(path.join(directory, 'claude.sh.argv')); i++) await wait(50);
    runtime.execute({ tmuxSocket: socket }, ['set-environment', '-g', 'CMUX_SURFACE_ID', 'unrelated-surface']);
    runtime.execute({ tmuxSocket: socket }, ['set-environment', '-g', 'CODEX_THREAD_ID', 'unrelated-thread']);
    host.supportsManagedStartupPrompt = true;
    const second = await service.add(group.id, { provider: 'codex', prompt: 'MULTILINE_STARTUP\n' + 'x'.repeat(9000) });
    for (let i = 0; i < 100 && !fs.existsSync(path.join(directory, 'codex.sh.argv')); i++) await wait(50);
    const firstArgv = fs.readFileSync(path.join(directory, 'claude.sh.argv'), 'utf8').split('\0');
    const secondArgv = fs.readFileSync(path.join(directory, 'codex.sh.argv'), 'utf8').split('\0');
    assert.ok(firstArgv.includes('--append-system-prompt'));
    const legacyDocument = JSON.parse(fs.readFileSync(path.join(`${storeFile}.mailboxes`, group.id, `${service.mailbox.memberId(first)}.startup.json`), 'utf8'));
    assert.ok(legacyDocument.prompt.includes(first.creationId));
    assert.ok(firstArgv.at(-2).includes(' startup '));
    assert.ok(firstArgv.every(arg => !/[\r\n]/.test(arg)), 'legacy host receives no multiline option or prompt argument');
    assert.ok(firstArgv.some(arg => arg.includes(`groupId=${group.id}`) && arg.includes(first.creationId)));
    assert.ok(secondArgv.some(arg => arg.endsWith('MULTILINE_STARTUP\n' + 'x'.repeat(9000))), 'startup prompt reaches actual provider argv without clipping or newline loss');
    assert.equal(second.terminal.promptSent, true);
    // tmux supplies its own pane identity. Foreign surface/thread identities must be gone.
    assert.match(fs.readFileSync(path.join(directory, 'codex.sh.env'), 'utf8'), /^unset:unset:%\d+$/);
    console.log('✓ 실제 tmux provider argv: 그룹/패널 안내 전달·긴 다중행 프롬프트 보존·오래된 서버의 외부 패널 환경 차단');
    const firstOptions = { ...manager.required(first.terminalId).options };
    const secondOptions = { ...manager.required(second.terminalId).options };
    for (let i = 0; i < 100 && (!runtime.existsStrict(firstOptions) || !runtime.existsStrict(secondOptions)); i += 1) await wait(50);
    assert.equal(runtime.existsStrict(firstOptions), true);
    assert.equal(runtime.existsStrict(secondOptions), true);
    manager.command(second.terminalId, "printf 'GROUP_TERMINAL_INPUT_OK\\n'");
    for (let i = 0; i < 100 && !manager.get(second.terminalId, true).replay.includes('GROUP_TERMINAL_INPUT_OK'); i += 1) await wait(50);
    assert.match(manager.get(second.terminalId, true).replay, /GROUP_TERMINAL_INPUT_OK/);
    // Exercise peer communication through the actual running shell terminals.
    const quote = value => "'" + String(value).replace(/'/g, "'\"'\"'") + "'";
    const helper = path.join(`${storeFile}.mailboxes`, group.id, 'group-message.cjs');
    const firstPeer = service.mailbox.memberId(first), secondPeer = service.mailbox.memberId(second);
    const marker = `PEER_MESSAGE_${process.pid}`;
    manager.command(first.terminalId, `ELECTRON_RUN_AS_NODE=1 ${quote(process.execPath)} -e ${quote("require('" + helper + "').run('" + path.dirname(helper) + "','" + firstPeer + "','send',['" + secondPeer + "','" + marker + "'])")}`);
    for (let i = 0; i < 100 && !fs.existsSync(path.join(path.dirname(helper), secondPeer)); i++) await wait(50);
    manager.command(second.terminalId, `ELECTRON_RUN_AS_NODE=1 ${quote(process.execPath)} -e ${quote("console.log(JSON.stringify(require('" + helper + "').run('" + path.dirname(helper) + "','" + secondPeer + "','inbox'))) ")}`);
    for (let i = 0; i < 100 && !manager.get(second.terminalId, true).replay.includes(marker); i++) await wait(50);
    assert.match(manager.get(second.terminalId, true).replay, new RegExp(marker), 'second terminal receives first terminal peer message');
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
