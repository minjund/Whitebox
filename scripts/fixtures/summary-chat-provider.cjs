'use strict';
// Real PTY fixture; no network or AI account. Each request has a distinct turn marker.
process.stdin.setRawMode(true); process.stdin.setEncoding('utf8'); process.stdin.resume();
let draft = '', request = '', turn = 0, waiting = false;
const provider = process.argv[2] || 'codex';
const draw = body => process.stdout.write(`\x1b[2J\x1b[H\x1b[999;1H\x1b[?2004hSUMMARY_READY ${process.pid}\r\n${body}\r\n`);
const finish = () => {
  waiting = false;
  const footer = provider === 'claude' ? `✻ Baked for ${++turn}s` : `Worked for 1s • 3:${String(40 + ++turn).padStart(2, '0')} PM`;
  // Real providers can retain the preceding working line in scrollback.
  // The explicit later finish and empty input must release the queued request.
  draw(`› ${request}\r\n• Working (esc to interrupt)\r\n• SUMMARY_REPLY ${request}\r\n${footer}\r\n› ${provider === 'claude' ? '' : 'Ask Codex to do anything'}\r\n  ${provider === 'claude' ? '[Sonnet]' : 'GPT-6'} · fixture`);
};
draw('› Ask Codex to do anything\r\n  GPT-6 · fixture');
process.stdin.on('data', data => {
  if (data.includes('\x03')) process.exit(0);
  if (waiting) { if (/[ya\x1b]/u.test(data)) finish(); return; }
  draft += data.replace(/\x1b\[(?:200|201)~/gu, '');
  if (!draft.includes('\r')) return;
  request = draft.split('\r')[0]; draft = '';
  if (request.includes('PERMISSION')) {
    waiting = true;
    draw("Edited src/example.js\r\nWould you like to make the following edits?\r\n1. Yes, proceed (y)\r\n2. Yes, and don't ask again (a)\r\n3. No, and tell Codex what to do differently (esc)");
  } else {
    draw(`› ${request}\r\n• Working (esc to interrupt)`);
    setTimeout(finish, request.includes('HOLD') ? 1800 : 350);
  }
});
