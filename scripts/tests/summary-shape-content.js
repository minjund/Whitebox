'use strict';

const assert = require('node:assert/strict');
const { assessContent } = require('../../src/terminalReviewContent');
const { conversationReset } = require('../../src/terminalReviewTurns');
const { TerminalReview, draftSource } = require('../../src/terminalReview');

const source = '초안 본문: 기준 스펙을 백엔드로 바꿔 주세요. 27건을 넷으로 나눴습니다. 첫째 문제 둘째 문제 셋째 문제 넷째 문제';
const claim = (text, quote = text) => ({ text, basis: 'reported', quote });
const content = extra => ({ version: 2, answer: claim('기준 스펙을 백엔드로 바꿔 달라고 먼저 부탁해요.', '기준 스펙을 백엔드로 바꿔 주세요.'), details: [], limitations: [], deliverables: [], background: [], nextAction: null,
  handoff: { kind: 'finish', temporal: null, priority: claim('보낼 준비가 됐어요.', '27건을 넷으로 나눴습니다.'), prompt: null }, ...extra });

const tests = [
  {
    name: 'Summary content keeps a known shape, falls back to the default for an unknown one, and lets a review list four findings',
    run() {
      assert.equal(assessContent(content({ shape: 'draft' }), { source }).content.shape, 'draft');
      const unknown = assessContent(content({ shape: 'poem' }), { source });
      assert.deepEqual(unknown.issues, [], 'an unknown shape never triggers a repair call');
      assert.equal(unknown.content.shape, 'general');
      const findings = ['첫째 문제', '둘째 문제', '셋째 문제', '넷째 문제'].map(text => claim(text));
      assert.equal(assessContent(content({ shape: 'review', details: findings }), { source }).content.details.length, 4);
      assert.ok(assessContent(content({ shape: 'change', details: findings }), { source }).issues.includes('details'), 'only a review lists more than two details');
    },
  },
  {
    name: 'Clear and compact commands are recognized for Claude and Codex, and nothing else is',
    run() {
      for (const text of ['/clear', '/new', '/reset', '/resume', '<command-name>/clear</command-name>']) assert.equal(conversationReset(text), 'clear', text);
      assert.equal(conversationReset('/compact 앞부분만'), 'compact');
      for (const text of ['/clearance', '/plugin:clear', '/grill 내가 /clear를 하면', 'clear', '/Users/me/clear']) assert.equal(conversationReset(text), '', text);
    },
  },
  {
    name: 'A draft points at the document its turn wrote, or carries the reply, and only that file is readable',
    run() {
      const write = { kind: 'write', path: '/Users/me/Desktop/answer.md', after: '# 답변\n본문', outline: ['# 답변'], acknowledgement: 'File created successfully' };
      assert.deepEqual(draftSource({ tools: { changes: [{ ...write, path: '/repo/a.js' }, write] }, text: 'ASSISTANT: 저장했습니다.' }),
        { path: write.path, outline: ['# 답변'], opening: '# 답변\n본문' });
      assert.equal(draftSource({ tools: { changes: [{ ...write, acknowledgement: undefined }] }, text: 'ASSISTANT: 안녕하세요.\n안내드립니다.' }).text.includes('안내드립니다'), true, 'an unacknowledged write is not the draft');
      const review = new TerminalReview({ manager: () => ({}), runner: {}, file: '' });
      review.entries.set('t', { result: { tasks: [{ taskId: 'd', content: { shape: 'draft' }, draft: { path: write.path } },
        { taskId: 'c', content: { shape: 'change' }, draft: { path: write.path } }, { taskId: 'x', content: { shape: 'draft' }, draft: { path: 'relative.md' } },
        { taskId: 'y', content: { shape: 'draft' }, draft: { path: '/etc/passwd' } }] } });
      assert.equal(review.draftFile('t', 'd'), write.path);
      for (const taskId of ['c', 'x', 'y', 'missing']) assert.equal(review.draftFile('t', taskId), '', taskId);
      assert.equal(review.draftFile('other', 'd'), '');
    },
  },
];

module.exports = { registerSummaryShapeContentTests: context => {
  for (const item of tests) context.test(item.name, item.run);
} };
