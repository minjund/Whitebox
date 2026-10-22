'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { bounded, isSocialRecord, gitSnapshot, changedEvidence } = require('../src/terminalReviewBudget');
const { TerminalReview } = require('../src/terminalReview');
const tick = () => new Promise(resolve => setImmediate(resolve));

module.exports = async function budgetChecks() {
  const answer = 'USER: ㅎㅇ\nASSISTANT (completed answer):\nㅎㅇ! 뭐 도와줄까?';
  assert.equal(isSocialRecord('ㅎㅇ', answer), true);
  assert.equal(isSocialRecord('hello!', 'ASSISTANT: Hello!'), true);
  for (const request of ['네', 'ㅇㅇ', 'yes', 'ok', 'hi 수정해줘', '제목을 안녕으로 바꿔줘']) assert.equal(isSocialRecord(request, answer), false);
  assert.equal(isSocialRecord('ㅎㅇ', answer, { changed: true }), false);
  assert.equal(isSocialRecord('안녕', 'ASSISTANT: 안녕, 파일을 수정했습니다.'), false);
  assert.equal(isSocialRecord('ㅎㅇ', '› ㅎㅇ\n• Ran command\n• ㅎㅇ!\nWorked for 1s • 3:00 PM\n› '), false);
  assert.equal(isSocialRecord('ㅎㅇ', '› ㅎㅇ\n• ㅎㅇ!\nWorked for 1s • 3:00 PM\n› '), true);
  for (const limit of [0, 12, 2400, 18000]) assert.ok(bounded('a'.repeat(20000), limit).length <= limit);
  assert.match(bounded('a'.repeat(20000), 2400), /omitted/);

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'whitebox-budget-'));
  try {
    const git = args => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
    git(['init']);
    await fs.writeFile(path.join(root, 'copy.txt'), '안녕\n');
    git(['add', 'copy.txt']);
    git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'fixture']);
    const before = await gitSnapshot(root);
    await fs.writeFile(path.join(root, 'copy.txt'), '반가워\n');
    const after = await gitSnapshot(root);
    const changes = changedEvidence(before, after);
    assert.equal(changes.changed, true);
    assert.match(changes.text, /-안녕\n\+반가워/u);
    assert.match(changes.text, /other terminals/);
    assert.equal(changedEvidence(after, after).changed, false);
    await fs.writeFile(path.join(root, 'untracked.txt'), 'PRIVATE_UNTRACKED_BODY');
    const untracked = changedEvidence(after, await gitSnapshot(root));
    assert.equal(untracked.changed, true);
    assert.match(untracked.text, /untracked file contents are NOT inspected/);
    assert.doesNotMatch(untracked.text, /PRIVATE_UNTRACKED_BODY/);
    assert.equal(await gitSnapshot(path.join(root, 'missing')), null);
  } finally { await fs.rm(root, { recursive: true, force: true }); }

  let completion = { available: false }, now = 1000, snapshots = 0;
  const calls = [];
  const session = { id: 'budget', creationId: 'epoch', pid: 100, status: 'running' };
  const service = new TerminalReview({ manager: () => ({ get: () => session }), now: () => now,
    completion: { observe: async () => completion }, snapshot: async () => { snapshots++; return null; },
    monitor: { scan: () => ({ available: true, processes: [{ provider: 'codex', pid: 101, ancestorPids: [100] }] }) },
    runner: { generateTerminalReview: async options => {
      calls.push(options);
      const request = JSON.parse(options.prompt.match(/\nREQUEST: (.*)\n/)[1]);
      return { text: JSON.stringify({ tasks: [{ requestQuote: request, evidenceQuote: 'ㅎㅇ!', actual: '인사 응답', alignment: 'aligned' }] }), usage: { input: 100, output: 20, total: 120 } };
    } } });
  const capture = extra => service.capture({ id: session.id, creationId: session.creationId, text: 'frame', ...extra });
  const submit = async (id, request, evidence = answer) => {
    now += 1000;
    completion = { available: true, requestAt: now, requestId: id, request, state: 'completed', evidence };
    await capture({ submission: { id, request, at: now } });
    await tick();
    return (await capture()).result.tasks;
  };
  await capture(); assert.equal(snapshots, 0);
  let tasks = await submit('one', 'ㅎㅇ');
  assert.equal(calls.length, 0, 'greeting invokes no AI runner');
  assert.equal(tasks[0].analysisUsage.total, 0);
  assert.equal(tasks[0].alignment, 'not-reviewed');
  assert.equal(tasks[0].recordOnly, true);
  assert.equal(snapshots, 0, 'analysis never independently inspects the working tree');
  for (let i = 0; i < 3; i++) await capture();
  assert.equal(snapshots, 0); assert.equal(calls.length, 0);
  tasks = await submit('two', 'ㅎㅇ');
  assert.equal(tasks.length, 2, 'identical greeting commands remain separate tasks');
  const detail = { requestId: 'detail-one', task: tasks[0], providerPid: 101 };
  await capture({ detail: { ...detail, providerPid: 999 } }); await tick();
  assert.equal(calls.length, 0, 'other process cannot trigger detailed review');
  await capture({ detail }); await tick();
  tasks = (await capture({ detail })).result.tasks;
  assert.equal(calls.length, 0, 'removed detailed analysis never invokes the model');
  assert.equal(tasks.length, 2);
  tasks = await submit('small-edit', '문구만 바꿔줘', 'ASSISTANT: ㅎㅇ!\n' + 'evidence '.repeat(4000));
  assert.equal(calls.length, 1, 'substantive change receives an explanation');
  assert.match(calls[0].prompt, /"understanding"/);
  assert.match(calls[0].prompt, /omitted/);
  assert.ok(calls[0].prompt.length < 8500, 'basic evidence plus context-aware instructions is bounded');
  assert.equal(tasks.length, 3);
  assert.equal(tasks[2].analysisUsage.total, 120);
  assert.equal(snapshots, 0, 'all explanations use collected evidence only');
  console.log('PASS review budget: no-call social records, no automatic Git inspection, bounded first explanation, removed paid detail, per-call usage and command history');
};
