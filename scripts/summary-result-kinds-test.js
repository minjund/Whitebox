'use strict';

// Result cards: a short reply without work is shown as written (pass-through)
// with no model call, keeping a question's options verbatim; work and bare
// completion claims are always summarized.
const assert = require('node:assert/strict');
const { TerminalReview } = require('../src/terminalReview');
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };

function fixture(answer, tools = []) {
  const request = '대학마다 화면이 다른데 GraphQL 써야 해?', session = { id: 'kinds', creationId: 'one', pid: 1, status: 'running' }, calls = [];
  const service = new TerminalReview({ manager: () => ({ get: () => session }), now: () => 2000, quietMs: 0,
    monitor: { scan: () => ({ available: true, processes: [{ provider: 'claude', pid: 2, ancestorPids: [1] }] }) },
    completion: { observe: async () => ({ available: true, state: 'completed', requestAt: 1000, requestId: 'r', request,
      evidence: `USER:\n${request}\n\nASSISTANT (completed answer):\n${answer}`, tools: { source: 'session', items: tools } }) },
    runner: { generateTerminalReview: options => new Promise(resolve => calls.push({ ...options, resolve })) } });
  return { service, calls, session, request,
    capture: () => service.capture({ id: session.id, creationId: session.creationId, text: '', submission: { id: 'r', request, at: 1000 } }) };
}

async function main() {
  const question = `맞춰 보겠습니다.\n\n❓ Q12 - "화면이 다르다"는 어떤 형태인가요?\n- (a) 대학마다 프론트를 따로 만든다\n- (b) 코드베이스는 하나, 화면 구성이 다르다\n- (c) 같은 화면, 항목만 다르다\n\n➡️ (b)라고 봅니다. (a)는 권하지 않습니다`;
  let f = fixture(question); await f.capture(); await settle();
  assert.equal(f.calls.length, 0, 'a short question without work needs no model call');
  let card = f.service.entries.get('kinds').result.tasks[0];
  assert.equal(card.passThrough, true); assert.equal(card.actual, question);
  assert.deepEqual(card.choices[0].options.map(item => item.label), ['a', 'b', 'c']);
  assert.equal(card.choices[0].recommendation.label, 'b');

  f = fixture('완료했습니다.', [{ name: 'Edit', status: 'returned', excerpt: 'Updated src/auth.js' }]); await f.capture(); await settle();
  assert.equal(f.calls.length, 1, '"완료했습니다" with a work record is summarized from that record');
  f = fixture('완료했습니다.'); await f.capture(); await settle();
  assert.equal(f.calls.length, 1, '"완료했습니다" without a record is summarized from the conversation');
  f = fixture('버튼 문구를 변경했습니다.'); await f.capture(); await settle();
  assert.equal(f.calls.length, 1, 'a short work claim is summarized');
  console.log('PASS result kinds: pass-through without a model call keeps question options verbatim; work and completion claims are summarized');
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = main;
