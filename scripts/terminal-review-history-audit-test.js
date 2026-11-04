'use strict';

const assert = require('node:assert/strict');
const { visibleText } = require('./terminal-review-followup-evaluation');
const { writerPrompt, auditorPrompt, validateWriting, validateAudit, exactPassages } = require('./terminal-review-history-audit');

function main() {
  const content = { version: 2,
    answer: { text: '설정 검사 명령은 안내됐고 실행 결과는 미확인입니다.', basis: 'reported', quote: 'SOURCE_ONLY_SENTINEL' },
    details: [], limitations: [], background: [{ text: 'HIDDEN_BACKGROUND', basis: 'reported', quote: 'OTHER_SECRET' }],
    nextAction: null, deliverables: [{ label: '설정 검사', kind: 'command', value: 'docker compose config --quiet', basis: 'reported', quote: 'SOURCE_ONLY_SENTINEL' }] };
  const visible = visibleText(content), prompt = writerPrompt(visible);
  assert.ok(prompt.includes('docker compose config --quiet'));
  assert.ok(!prompt.includes('SOURCE_ONLY_SENTINEL') && !prompt.includes('HIDDEN_BACKGROUND'), 'blind writer never receives collapsed source or background');
  assert.ok(auditorPrompt({ task: { request: '원래 요청' } }, visible, {}, 'ORIGINAL_SOURCE').includes('ORIGINAL_SOURCE'), 'only the separate auditor receives original evidence');
  const writing = { canWrite: true, draft: '설정 검사를 안내합니다.', gaps: [], support: [{ claim: '검사', quote: '설정 검사 명령은 안내됐고 실행 결과는 미확인입니다.' }] };
  assert.deepEqual(validateWriting(writing, visible), []);
  assert.ok(validateWriting({ ...writing, support: [{ quote: '실제로 검사를 통과했습니다.' }] }, visible).length);
  assert.ok(validateWriting({ ...writing, draft: '```sh\ndocker compose down\n```' }, visible).length, 'draft cannot invent or substitute executable content');
  const wrapped={...writing,draft:'```sh\necho first second\n```'};
  assert.deepEqual(validateWriting(wrapped,visible+'\necho first\n  second'),[]);
  assert.ok(wrapped.draft.includes('echo first\n  second'), 'only original literal bytes survive whitespace recovery');
  const longCommand = 'echo ' + 'x'.repeat(650);
  assert.deepEqual(validateWriting({ ...writing, draft: '기록된 명령입니다.\n```sh\n' + longCommand + '\n```' }, visible + '\n' + longCommand), [], 'source-exact literal output is exempt from prose cap');
  assert.ok(validateWriting({ ...writing, draft: '가'.repeat(601) }, visible).length);
  assert.deepEqual(validateWriting({ ...writing, draft: '가'.repeat(601) }, visible, { longCommands: true }), [], 'explicit long-command mode allows required conditions alongside requested literal commands');
  const source = '첫 번째 원문\n중간의 다른 정보\n마지막 원문';
  const passages = exactPassages('첫 번째 원문\n마지막 원문', source);
  assert.equal(passages.length, 2);
  assert.ok(passages.every(item => item.contiguous === false && source.slice(item.start, item.start + item.quote.length) === item.quote), 'separate audit citations remain explicitly separate with original offsets');
  assert.equal(exactPassages('첫 번째 원문\n만든 원문', source), null, 'one fabricated passage rejects the whole proof');
  const audit = { verdict: 'ready', reason: '기록 범위에서 충분', essential: '핵심', sourceQuote: '첫 번째 원문\n마지막 원문', visibleQuote: '설정 검사', fix: '' };
  assert.deepEqual(validateAudit(audit, visible, source), []);
  assert.equal(audit.visibleQuoteOrigin, 'analysis');
  assert.ok(validateAudit({ ...audit, sourceQuote: '없는 원문' }, visible, source).length);
  const draftAudit = { ...audit, visibleQuote: '초안에서 만든 문장' };
  assert.deepEqual(validateAudit(draftAudit, visible, source, '초안에서 만든 문장'), []);
  assert.equal(draftAudit.visibleQuoteOrigin, 'draft', 'draft mistakes cannot be silently attributed to the analysis');
  console.log('PASS history audit: blind source isolation, separate proof offsets, fabricated citations/commands rejected, literal/prose budgets, draft attribution');
}
if (require.main === module) main();
module.exports = main;
