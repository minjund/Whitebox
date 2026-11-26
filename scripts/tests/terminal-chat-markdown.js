'use strict';
// Chat pane text: escaped Markdown with nested lists, numbering kept across
// blank lines, quotes, rules, https links only; Paseo-style turns and work labels.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const esc = value => String(value ?? '').replace(/[&<>"']/gu, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const root = { addEventListener() {}, querySelectorAll: () => [], querySelector: () => null };
const sandbox = { window: {}, setInterval() {}, requestAnimationFrame() {}, crypto: { randomUUID: () => 'x' } };
vm.createContext(sandbox);
for (const file of ['chat-render.js', 'terminal-chat.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../../renderer', file), 'utf8'), sandbox);
const chat = sandbox.window.WhiteboxTerminalChat({ root, api: {}, t: value => value, esc, session: () => null, member: () => null, panes: () => new Map(), visibleIds: () => [] });

const nested = chat.markdown('- 원인\n  - 하위 항목\n  - https://github.com/minjund/Whitebox/pull/191\n- 다음');
assert.equal(nested, '<ul><li>원인<ul><li>하위 항목</li><li><a href="https://github.com/minjund/Whitebox/pull/191" data-chat-link>https://github.com/minjund/Whitebox/pull/191</a></li></ul></li><li>다음</li></ul>');
assert.equal(chat.markdown('1. 첫째\n\n2. 둘째'), '<ol><li>첫째</li><li>둘째</li></ol>', 'a blank line between items keeps one numbered list');
assert.equal(chat.markdown('설명\n\n3. 셋째'), '<p>설명</p><ol start="3"><li>셋째</li></ol>', 'a list that starts later keeps its number');
assert.equal(chat.markdown('> 인용\n\n---'), '<blockquote>인용</blockquote><hr>');
assert.equal(chat.markdown('[링크](javascript:void) http://a.test `https://b.test`'), '<p>링크 http://a.test <code>https://b.test</code></p>', 'only https links become links; code stays code');
assert.equal(chat.markdown('<img src=x onerror=alert(1)>'), '<p>&lt;img src=x onerror=alert(1)&gt;</p>', 'HTML is escaped');
assert.equal(chat.markdown('| a | b |\n|---|---|\n| 1 | 2 |'), '<div class="wb-chat-table"><table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table></div>');

// Paseo-style turns and work labels.
const turns = chat.turnsOf([
  { id: 'u1', role: 'user', text: '고쳐줘' },
  { id: 't1', role: 'tool', title: 'Read', text: '{"file_path":"/a.js"}' },
  { id: 't2', role: 'tool', title: 'Bash', text: 'npm test' },
  { id: 'a1', role: 'assistant', text: '확인할게요' },
  { id: 'a2', role: 'assistant', text: '확인할게요' },
  { id: 't3', role: 'tool', title: 'Edit', text: '{"file_path":"/a.js","old_string":"x"}' },
  { id: 'a3', role: 'assistant', text: '고쳤어요' },
  { id: 'u2', role: 'user', text: '다음' },
]);
assert.equal(turns.length, 2, 'each request starts a turn');
assert.deepEqual([...turns[0].rows].map(row => row.id), ['t1', 't2', 'a1', 't3', 'a3'], 'a repeated answer record in one turn is dropped');
assert.equal(chat.workLabel(turns[0].rows.filter(row => row.role === 'tool')), '파일 1개 편집 · 명령 1개 실행 · 파일 1개 읽음', 'work is summarised like Paseo\'s overview label');
assert.equal(chat.toolDetail({ text: '{"command":"git status\\nmore"}' }), 'git status', 'the command of a shell call');
assert.equal(chat.toolDetail({ text: '{"file_path":"/x/y.md"}' }), '/x/y.md', 'the file of a read call');
assert.equal(chat.toolDetail({ text: 'plain first line\nsecond' }), 'plain first line');
// Messenger layout: the request stays a right bubble; the AI's rows share one left bubble under its name.
const render = sandbox.window.WhiteboxChatRender({ t: value => value, esc });
const bubbleTurn = render.turnHtml('layout', turns[0], false, 'Claude');
assert.match(bubbleTurn, /^<section class="wb-chat-turn"><div class="wb-chat-msg is-user">[\s\S]*<div class="wb-chat-ai"><div class="wb-chat-sender">Claude<\/div><div class="wb-chat-ai-bubble">/u);
assert.equal(render.turnHtml('layout', { user: turns[1].user, rows: [] }, true, 'Claude').includes('wb-chat-ai'), false, 'a request with no answer yet has no empty AI bubble');
assert.equal(render.turnHtml('layout', turns[0], false, '<b>').includes('<b>'), false, 'the AI name is escaped');

// A message Claude took in mid-turn (a queued_command attachment) shows where Claude read it.
{
  const os = require('node:os');
  const { claudeQueued, mergeQueued } = require('../../src/terminalConversation');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-queued-'));
  const file = path.join(dir, 'log.jsonl');
  const rows = [
    { type: 'user', uuid: 'u', timestamp: '2026-11-26T10:00:00Z', message: { role: 'user', content: '첫 요청' } },
    { type: 'user', uuid: 'r', timestamp: '2026-11-26T10:00:20Z', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } },
    // Written where Claude took it in, stamped with the time it was typed.
    { type: 'attachment', uuid: 'q1', timestamp: '2026-11-26T10:00:05Z', attachment: { type: 'queued_command', prompt: '이것도 해줘', commandMode: 'prompt', origin: { kind: 'human' } } },
    { type: 'attachment', uuid: 'q2', timestamp: '2026-11-26T10:00:06Z', attachment: { type: 'queued_command', prompt: '<task-notification>done</task-notification>', commandMode: 'task-notification', origin: { kind: 'task-notification' } } },
    { type: 'attachment', uuid: 'q3', timestamp: '2026-11-26T10:00:07Z', isSidechain: true, attachment: { type: 'queued_command', prompt: 'subagent', commandMode: 'prompt' } },
  ];
  fs.writeFileSync(file, `${rows.map(row => JSON.stringify(row)).join('\n')}\n`);
  try {
    const queued = claudeQueued(file, fs.statSync(file).size, 1 << 20);
    assert.deepEqual(queued.map(row => [row.id, row.role, row.text]), [['queued:q1', 'user', '이것도 해줘']], 'only human messages, never notifications or subagents');
    const merged = mergeQueued([
      { id: 'a', role: 'tool', text: 'sleep', timestamp: '2026-11-26T10:00:03Z' },
      { id: 'b', role: 'assistant', text: '반영했어요', timestamp: '2026-11-26T10:00:21Z' },
    ], queued);
    assert.deepEqual(merged.map(row => row.id), ['a', 'queued:q1', 'b'], 'placed where Claude took it in, not when it was typed');
    const { cleanUserText } = require('../../src/terminalConversation');
    assert.equal(cleanUserText('The user sent a new message while you were working:\n이것도 해줘\n\nThis is how Claude Code surfaces messages the user sends mid-turn — within the running turn.'), '이것도 해줘', 'newer Claude wraps it in the next user row: only the message is shown');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
console.log('PASS chat Markdown and turns: nested lists, kept numbering, quotes and rules, https-only links, escaped HTML, tables, Paseo-style turns, work labels and tool details, messenger bubbles, mid-turn messages from the Claude log');
