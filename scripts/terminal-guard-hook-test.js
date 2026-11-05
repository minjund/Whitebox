'use strict';
// Terminal guard hook (item: terminal operations stay inside Whitebox) and the
// default terminal folder that Claude can remember as trusted.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const guard = require('../bin/terminal-guard-hook');
const provider = require('../bin/panel-provider');
const installer = require('../src/terminalGuardHookInstaller');
const { defaultTerminalCwd, DEFAULT_FOLDER_NAME } = require('../src/terminalDefaultCwd');

const denied = [
  'tmux new-session -d -s x', 'tmux', 'tmux split-window -h', 'TERM=x tmux send-keys -t 1 ls Enter', '/opt/homebrew/bin/tmux capture-pane -p',
  'cmux new-split right', 'open -a Terminal .', 'open -na iTerm', `osascript -e 'tell application "Terminal" to do script "ls"'`,
  'wezterm cli split-pane', 'kitty @ launch', 'bash -lc "tmux new -d"', 'cd x && tmux attach', 'sudo tmux kill-server', 'zellij run -- ls',
  'screen -dmS w', 'gnome-terminal -- bash', 'start wt.exe', 'echo $(tmux new -d)', 'nohup -n tmux new',
];
const allowed = [
  'ls -la', 'grep -rn tmux src', 'tmux -V', 'git commit -m "open the panel"', 'open README.md', 'open https://example.com', 'npm test',
  'screen -ls', 'zellij ls', 'whitebox new-terminal codex --count 3', 'whitebox send --surface abc hello', 'echo terminal',
  'node scripts/x.js 2>&1 | tail', 'cat tmux.conf', `osascript -e 'display notification "hi"'`, 'kitty --version', 'rg "split-window" .', 'start-server.sh',
];
for (const command of denied) assert.ok(guard.blockedCommand(command), `should deny: ${command}`);
for (const command of allowed) assert.equal(guard.blockedCommand(command), '', `should allow: ${command}`);
assert.ok(guard.blockedCommand(['bash', '-lc', 'tmux new -d']), 'argv form is inspected');

// Only Whitebox PTYs (WHITEBOX_SURFACE_ID) are affected.
const pre = { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'tmux new -d' } };
assert.equal(guard.respond(pre, {}), null);
assert.equal(guard.respond(pre, { WHITEBOX_SURFACE_ID: 's' }).hookSpecificOutput.permissionDecision, 'deny');
assert.match(guard.respond(pre, { WHITEBOX_SURFACE_ID: 's' }).hookSpecificOutput.permissionDecisionReason, /whitebox new-terminal/u);
assert.equal(guard.respond({ ...pre, tool_input: { command: 'ls' } }, { WHITEBOX_SURFACE_ID: 's' }), null);
assert.equal(guard.respond({ hook_event_name: 'SessionStart' }, { WHITEBOX_SURFACE_ID: 's' }).hookSpecificOutput.additionalContext, guard.GUIDANCE);
assert.ok(guard.respond({ hook_event_name: 'UserPromptSubmit', prompt: '터미널 3개 열어서 나눠 줘' }, { WHITEBOX_SURFACE_ID: 's' }));
assert.equal(guard.respond({ hook_event_name: 'UserPromptSubmit', prompt: '이 함수 리팩터링해 줘' }, { WHITEBOX_SURFACE_ID: 's' }), null);
assert.equal(guard.respond({ hook_event_name: 'SessionStart' }, {}), null);

// The script reads hook JSON on stdin and writes the decision on stdout.
const script = path.join(__dirname, '..', 'bin', 'terminal-guard-hook.js');
const run = (input, env) => execFileSync(process.execPath, [script], { input: JSON.stringify(input), env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' });
assert.equal(JSON.parse(run(pre, { WHITEBOX_SURFACE_ID: 's' })).hookSpecificOutput.permissionDecision, 'deny');
assert.equal(run(pre, {}), '');
assert.equal(execFileSync(process.execPath, [script], { input: 'not json', encoding: 'utf8' }), '');

// Claude gets session-scoped hooks through --settings; user flags and utilities are untouched.
const server = { command: '/x/node', args: ['/x/panel-mcp.js'], env: { WHITEBOX_SURFACE_ID: 's' } };
const command = provider.guardHookCommand('/x/node');
const claudeArgs = provider.providerArgs('claude', ['--model', 'opus'], server, command);
const settings = JSON.parse(claudeArgs[claudeArgs.indexOf('--settings') + 1]);
assert.equal(settings.hooks.PreToolUse[0].matcher, 'Bash');
assert.match(settings.hooks.PreToolUse[0].hooks[0].command, /terminal-guard-hook\.js' --whitebox-terminal-guard$/u);
assert.ok(settings.hooks.SessionStart && settings.hooks.UserPromptSubmit);
assert.ok(!JSON.parse(claudeArgs[claudeArgs.indexOf('--mcp-config') + 1]).mcpServers.whitebox_panel.guard);
const own = provider.providerArgs('claude', ['--settings', '/mine.json'], server, command);
assert.equal(own.filter(arg => arg === '--settings').length, 1);
assert.deepEqual(provider.providerArgs('claude', ['-p', 'hi'], server, command), ['-p', 'hi']);
const separated = provider.providerArgs('claude', ['--', 'prompt'], server, command);
assert.ok(separated.indexOf('--settings') < separated.indexOf('--'));
assert.ok(!provider.providerArgs('codex', [], server, command).some(arg => arg.includes('hooks')));

// Codex: reviewed hooks in hooks.json + trusted hashes in config.toml.
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-guard-'));
try {
  const codexHome = path.join(temp, '.codex');
  fs.mkdirSync(codexHome);
  const existing = { hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: '/other/hook.sh' }] }], Stop: [{ hooks: [{ type: 'command', command: '/other/stop.sh' }] }] } };
  fs.writeFileSync(path.join(codexHome, 'hooks.json'), JSON.stringify(existing));
  fs.writeFileSync(path.join(codexHome, 'config.toml'), 'model = "x"\n\n[hooks.state."/elsewhere:pre_tool_use:0:0"]\ntrusted_hash = "sha256:keep"\n');
  const options = { codexHome, nodeExecutable: '/x/node', scriptPath: '/x/terminal-guard-hook.js', platform: 'darwin', write: (file, content) => { fs.writeFileSync(file, content); return { changed: true }; } };
  const first = installer.installCodexTerminalGuard(options);
  assert.equal(first.installed, true);
  const hooks = JSON.parse(fs.readFileSync(path.join(codexHome, 'hooks.json'), 'utf8'));
  assert.equal(hooks.hooks.PreToolUse[0].hooks[0].command, '/other/hook.sh', 'existing group positions are kept');
  assert.ok(installer.isGuardHandler(hooks.hooks.PreToolUse[1].hooks[0]));
  assert.ok(installer.isGuardHandler(hooks.hooks.SessionStart[0].hooks[0]));
  assert.deepEqual(hooks.hooks.Stop, existing.hooks.Stop);
  const toml = fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8');
  assert.match(toml, /\[features\]\s*\nhooks = true/u);
  assert.match(toml, /trusted_hash = "sha256:keep"/u);
  const hooksPath = path.join(codexHome, 'hooks.json');
  const handler = hooks.hooks.PreToolUse[1].hooks[0];
  assert.ok(toml.includes(`[hooks.state.${JSON.stringify(`${hooksPath}:pre_tool_use:1:0`)}]\ntrusted_hash = ${JSON.stringify(installer.guardHookHash('pre_tool_use', handler))}`));
  assert.ok(toml.includes(`${hooksPath}:session_start:0:0`) && toml.includes(`${hooksPath}:user_prompt_submit:0:0`));
  // Idempotent, and a moved runtime path is replaced in place with a new hash.
  assert.equal(installer.installCodexTerminalGuard(options).changed, false);
  installer.installCodexTerminalGuard({ ...options, nodeExecutable: '/y/node' });
  const moved = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
  assert.equal(moved.hooks.PreToolUse.length, 2);
  assert.match(moved.hooks.PreToolUse[1].hooks[0].command, /'\/y\/node'/u);
  const movedToml = fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8');
  assert.equal(movedToml.split(`${hooksPath}:pre_tool_use:1:0`).length, 2, 'one trust section per key');
  assert.ok(movedToml.includes(installer.guardHookHash('pre_tool_use', moved.hooks.PreToolUse[1].hooks[0])));
  // Invalid JSON is never overwritten; Windows is skipped.
  fs.writeFileSync(hooksPath, '{ broken');
  assert.equal(installer.installCodexTerminalGuard(options).reason, 'invalid-hooks-json');
  assert.equal(fs.readFileSync(hooksPath, 'utf8'), '{ broken');
  assert.equal(installer.installCodexTerminalGuard({ ...options, platform: 'win32' }).installed, false);

  // Default folder: never the home directory, which Claude cannot remember as trusted.
  const home = path.join(temp, 'home');
  fs.mkdirSync(home);
  assert.equal(defaultTerminalCwd({ home }), path.join(home, DEFAULT_FOLDER_NAME));
  assert.ok(fs.statSync(path.join(home, DEFAULT_FOLDER_NAME)).isDirectory());
  const blocked = path.join(temp, 'blocked');
  fs.mkdirSync(blocked);
  fs.writeFileSync(path.join(blocked, DEFAULT_FOLDER_NAME), 'file');
  assert.equal(defaultTerminalCwd({ home: blocked }), blocked, 'falls back to home when the folder is unusable');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
console.log('terminal guard hook tests passed');
