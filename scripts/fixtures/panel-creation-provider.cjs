'use strict';
// Deterministic interactive TUI for the real PTY/adoption/MCP E2E.
const assert = require('node:assert/strict');
const args = process.argv.slice(2);
assert.ok(args.some(arg => arg.startsWith('mcp_servers.whitebox_panel.command=')), 'provider must receive panel MCP');
assert.ok(process.env.WHITEBOX_SURFACE_ID, 'provider must identify its adopted surface');
process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
process.stdin.resume();
let draft = '', answer = '';
function render() {
  // Keep the input near the bottom and redraw on resize, as a provider TUI does.
  process.stdout.write('\x1b[2J\x1b[H\x1b[999;1H' +
    'PANEL_TOOLS_READY ' + process.env.WHITEBOX_SURFACE_ID + '\r\n' + answer +
    '› Ask Codex to do anything\r\n  GPT-6 high · fixture\r\n');
}
render();
process.on('SIGWINCH', render);
process.stdin.on('data', data => {
  draft += data.replace(/\x1b\[(?:200|201)~/g, '');
  if (!draft.includes('\r')) return;
  const message = draft.split('\r')[0];
  draft = '';
  answer = '› ' + message + '\r\n• 반가워요! ' + message + '\r\nWorked for 2s • 3:40 PM\r\n';
  render();
});
