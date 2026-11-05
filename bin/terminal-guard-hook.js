#!/usr/bin/env node
'use strict';
// Whitebox terminal guard. Installed only for Claude/Codex sessions that the
// Whitebox provider adapter launches inside a live Whitebox panel. It keeps
// terminal operations (create, split, send, read, close) inside Whitebox by
// denying shell commands that drive other terminal multiplexers or emulators.

const GUIDANCE = 'This session runs inside a Whitebox terminal. Create, split, close, read or send input to terminals only through Whitebox: '
  + 'the whitebox_panel MCP tools (whitebox_new_terminals, whitebox_list_terminals, whitebox_read_terminal, whitebox_ask, whitebox_wait, whitebox_close_terminal) '
  + 'or the `whitebox` CLI (`whitebox new-terminal <claude|codex> [--count N]`, `whitebox list-panels`, `whitebox read-screen --surface <id>`, '
  + '`whitebox send --surface <id> <text>`, `whitebox send-key --surface <id> enter`, `whitebox ask`, `whitebox wait`, `whitebox close-terminal`). '
  + 'Do not use tmux, screen, zellij, cmux, osascript, `open -a Terminal/iTerm`, or other terminal apps for this.';

const TERMINAL_APPS = /^(?:terminal|iterm2?|warp|ghostty|kitty|alacritty|wezterm|hyper|tabby|rio|wave)(?:\.app)?$/iu;
const TERMINAL_BUNDLES = /^(?:com\.apple\.terminal|com\.googlecode\.iterm2|dev\.warp\.warp-stable|com\.mitchellh\.ghostty|net\.kovidgoyal\.kitty|org\.alacritty|com\.github\.wez\.wezterm)$/iu;
const TMUX_COMMANDS = new Set(['new-session', 'new', 'new-window', 'neww', 'split-window', 'splitw', 'send-keys', 'send', 'capture-pane', 'capturep',
  'kill-session', 'kill-pane', 'killp', 'kill-window', 'killw', 'kill-server', 'attach-session', 'attach', 'a', 'at', 'select-pane', 'selectp',
  'select-window', 'selectw', 'respawn-pane', 'respawnp', 'respawn-window', 'respawnw', 'break-pane', 'breakp', 'join-pane', 'joinp', 'switch-client', 'switchc', 'paste-buffer', 'pasteb']);
const EMULATORS = new Set(['gnome-terminal', 'konsole', 'xterm', 'x-terminal-emulator', 'xfce4-terminal', 'tilix', 'terminator', 'alacritty', 'wt', 'wt.exe', 'conhost', 'conhost.exe']);
const WRAPPERS = new Set(['sudo', 'command', 'exec', 'nohup', 'time', 'env', 'builtin', 'xargs', 'nice']);

function words(segment) {
  return (segment.match(/"[^"]*"|'[^']*'|\S+/gu) || []).map(word => word.replace(/^["']|["']$/gu, ''));
}

function baseName(word) {
  return String(word || '').split(/[\\/]/u).pop().toLowerCase();
}

// Returns a short reason when one shell segment drives a terminal outside Whitebox.
function blockedSegment(segment) {
  const parts = words(segment.trim());
  let afterWrapper = false;
  while (parts.length && (/^[A-Za-z_][A-Za-z0-9_]*=/u.test(parts[0]) || WRAPPERS.has(baseName(parts[0])) || afterWrapper && parts[0].startsWith('-'))) {
    afterWrapper = WRAPPERS.has(baseName(parts.shift())) || afterWrapper;
  }
  if (!parts.length) return '';
  const program = baseName(parts[0]);
  const args = parts.slice(1);
  if (program === 'tmux') {
    const sub = args.find(arg => !arg.startsWith('-'));
    if (!sub) return args.some(arg => ['-V', '-h'].includes(arg)) ? '' : 'tmux';
    return TMUX_COMMANDS.has(sub) ? `tmux ${sub}` : '';
  }
  if (program === 'cmux') return 'cmux';
  if (program === 'zellij') return ['ls', 'list-sessions', '--version', '-V', '--help', '-h'].includes(args[0]) ? '' : 'zellij';
  if (program === 'screen') return args.some(arg => ['-ls', '-list', '--version', '-v', '-h', '--help'].includes(arg)) ? '' : 'screen';
  if (program === 'wezterm') return ['cli', 'start', 'connect', 'ssh', 'serial'].includes(args[0]) ? `wezterm ${args[0]}` : '';
  if (program === 'kitty' || program === 'kitten') return args.includes('@') || args[0]?.startsWith('@') || program === 'kitty' && !args.some(arg => ['--version', '-v', '--help', '-h', '+list-fonts'].includes(arg)) ? program : '';
  if (program === 'ghostty') return args.some(arg => ['--version', '--help', '-h', '+version', '+list-fonts', '+list-themes', '+show-config'].includes(arg)) ? '' : 'ghostty';
  if (EMULATORS.has(program)) return args.some(arg => ['--version', '-v', '--help', '-h'].includes(arg)) ? '' : program;
  if (program === 'open') {
    for (let index = 0; index < args.length; index += 1) {
      if (['-a', '-na', '-an'].includes(args[index]) && TERMINAL_APPS.test(baseName(args[index + 1]))) return `open -a ${args[index + 1]}`;
      if (['-b', '-nb', '-bn'].includes(args[index]) && TERMINAL_BUNDLES.test(args[index + 1] || '')) return `open -b ${args[index + 1]}`;
    }
    return args.some(arg => /\.(?:command|tool)$/iu.test(arg)) ? 'open .command' : '';
  }
  if (program === 'osascript') {
    const text = args.join(' ');
    return /application\s+(?:id\s+)?"(?:terminal|iterm2?|warp|ghostty|com\.apple\.terminal|com\.googlecode\.iterm2)"/iu.test(text) ? 'osascript terminal control' : '';
  }
  if (program === 'start') return /^(?:wt|cmd|powershell|pwsh)(?:\.exe)?$/iu.test(baseName(args.find(arg => !arg.startsWith('/') && !arg.startsWith('"')) || '')) ? 'new console window' : '';
  return '';
}

function blockedCommand(command) {
  const text = Array.isArray(command) ? command.join(' ') : String(command || '');
  // Split on shell control operators and command substitutions; quoted
  // `bash -c "..."` bodies are inspected by the same segmentation.
  for (const segment of text.split(/&&|\|\||[;|\n&`()]|\$\(/u)) {
    const reason = blockedSegment(segment.replace(/^\s*(?:\S*\/)?(?:bash|sh|zsh)\s+-l?c\s+["']?/u, ''));
    if (reason) return reason;
  }
  return '';
}

const TERMINAL_PROMPT = /터미널|패널|창\s*(?:을|를)?\s*(?:열|띄|나눠|분할)|분할|tmux|terminal|pane|split|panel|window|tab|whitebox|화이트박스/iu;

function respond(input, env = process.env) {
  if (!env.WHITEBOX_SURFACE_ID) return null;
  const event = input?.hook_event_name;
  if (event === 'PreToolUse') {
    const toolInput = input.tool_input || {};
    const reason = blockedCommand(toolInput.command ?? toolInput.cmd ?? toolInput.argv);
    if (!reason) return null;
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `Blocked ${reason}. ${GUIDANCE}` } };
  }
  if (event === 'SessionStart' || event === 'UserPromptSubmit' && TERMINAL_PROMPT.test(String(input.prompt || ''))) {
    return { hookSpecificOutput: { hookEventName: event, additionalContext: GUIDANCE } };
  }
  return null;
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) { raw += chunk; if (raw.length > 4 * 1024 * 1024) break; }
  let input = null;
  try { input = JSON.parse(raw); } catch { return; }
  const output = respond(input);
  if (output) process.stdout.write(JSON.stringify(output));
}

if (require.main === module) main().catch(() => { process.exitCode = 0; });
module.exports = { GUIDANCE, blockedCommand, blockedSegment, respond };
