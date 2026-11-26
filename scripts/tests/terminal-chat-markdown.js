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
console.log('PASS chat Markdown and turns: nested lists, kept numbering, quotes and rules, https-only links, escaped HTML, tables, Paseo-style turns, work labels and tool details');
