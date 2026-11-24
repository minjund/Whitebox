'use strict';
// A terminal is named by its request even before its analysis runs: with
// several terminals only the selected one is analysed first, the rest are
// deferred, and they still need a name in the sidebar.
const assert = require('node:assert/strict');
const { terminalName } = require('../../src/terminalReviewTurns');

assert.equal(terminalName([{ request: '로그인 버그 고쳐줘', summary: '로그인 버그 수정', analysisDepth: 'full' }]), '로그인 버그 수정', 'an analysed task names the terminal');
assert.equal(terminalName([
  { request: '로그인 버그 고쳐줘', summary: '로그인 버그 수정', analysisDepth: 'full' },
  { request: '다음 요청', recordOnly: true, deferred: true, analysisDepth: 'deferred', summary: '' },
]), '로그인 버그 수정', 'the latest analysed name is kept while the next request waits');
assert.equal(terminalName([{ request: '채팅창 가독성 고쳐줘\n자세한 설명', recordOnly: true, deferred: true, analysisDepth: 'deferred', summary: '' }]), '채팅창 가독성 고쳐줘', 'a deferred request names the terminal by its first line');
assert.equal(terminalName([], { request: '배포해줘' }), '배포해줘', 'a request seen before any task names the terminal');
assert.equal(terminalName([{ request: 'This session is being continued from a previous conversation that ran out of context.', deferred: true }]), '', 'a resumed session summary never names a terminal');
assert.equal(terminalName([], { request: '/clear' }), '', 'a slash command never names a terminal');
assert.equal(terminalName([{ request: 'x'.repeat(200), deferred: true }]).length, 80, 'a long request is shortened');
assert.equal(terminalName(null, null), '');
console.log('PASS terminal names: analysed name first, then the deferred or observed request, never summaries or slash commands');
