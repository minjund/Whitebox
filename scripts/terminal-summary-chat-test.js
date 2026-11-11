'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { TerminalCollaboration } = require('../src/terminalCollaboration');
require('./summary-2048-test');
(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-summary-delivery-'));
  let now = Date.now(), providerPid = 1100, hasProvider = true, uncertain = false, draft = '', text = '› Ask Codex to do anything\n  GPT-6 · test';
  const session = { id: 'terminal:chat', creationId: 'workspace:test', pid: 100, status: 'running', outputSequence: 1 };
  const writes = [], responses = [];
  const manager = { list: () => [session], get: async id => id === session.id ? session : null,
    rawWriteDeliverySupported: () => true,
    write: async (id, data, options) => { if (options.expectedOutputSequence !== undefined) assert.equal(options.expectedOutputSequence, session.outputSequence); writes.push({ id, data, options }); if (uncertain) throw Object.assign(Error('ack lost'), { deliveryState: 'unknown' }); },
    respond: async (id, key, options) => { if (key !== 'Escape') assert.equal(options.expectedOutputSequence, session.outputSequence); responses.push({ id, key, options }); } };
  const options = { directory, manager: () => manager, enableControl: false, now: () => now,
    activity: { observe: async () => new Map() }, completion: { observe: async () => ({ available: false }) },
    monitor: { scan: () => ({ available: true, processes: hasProvider ? [{ pid: providerPid, ancestorPids: [session.pid], provider: 'codex' }] : [] }) } };
  const c = new TerminalCollaboration(options);
  const sync = () => c.sync({ groups: [{ id: 'panel', cwd: directory, members: [session] }], frames: [{ id: session.id, creationId: session.creationId, outputSequence: session.outputSequence, text, inputDraft: draft }] });
  const request = (message = '안녕\n다음 줄') => ({ id: randomUUID(), groupId: 'panel', targetId: session.id, targetCreationId: session.creationId, targetProviderPid: providerPid, targetProvider: 'codex', message });
  try {
    await sync();
    const pending = request();
    draft = 'typed in terminal'; await sync();
    assert.deepEqual(await c.summarySend(pending), { deferred: true, reason: 'draft' }); assert.equal(writes.length, 0);
    draft = ''; text = '› \n• Working (esc to interrupt)'; await sync();
    assert.deepEqual(await c.summarySend(pending), { deferred: true, reason: 'working' });
    text = '› Ask Codex to do anything'; await sync();
    const sent = await c.summarySend(pending); assert.equal(sent.ok, true);
    assert.equal(writes[0].data, '\x1b[200~안녕\n다음 줄\x1b[201~\r');
    assert.equal((await c.summarySend(pending)).job.id, sent.job.id); assert.equal(writes.length, 1);
    await assert.rejects(c.summarySend({ ...pending, message: 'different' }), /식별자/);
    assert.deepEqual(await c.summarySend(request('queued next')), { deferred: true, reason: 'previous' }, 'running delivery blocks later messages');
    session.outputSequence++; text = '› 안녕\n다음 줄\n• 답변입니다\nWorked for 2s • 3:40 PM\n› Ask Codex to do anything'; await sync();
    assert.equal(c.jobs.get(pending.id).state, 'completed');
    const slash = request('/compact');
    assert.equal((await c.summarySend(slash)).ok, true, 'slash commands are still delivered to the AI CLI');
    await sync(); assert.equal(c.jobs.get(slash.id).state, 'running', 'a command is not released before its prompt returns');
    now += 3000; session.outputSequence++; await sync();
    assert.equal(c.jobs.get(slash.id).state, 'completed', 'a finished slash command no longer blocks later chat messages');
    const oldIdentity = request(); providerPid++; await sync();
    await assert.rejects(c.summarySend(oldIdentity), /세션이 바뀌/);
    // A process scan that misses the AI keeps the request queued; the renderer
    // ends it only when the AI session is really gone or replaced.
    hasProvider = false; await sync(); assert.deepEqual(await c.summarySend(request()), { deferred: true, reason: 'screen' }); hasProvider = true;
    await sync();
    await assert.rejects(c.summarySend({ ...request(), targetId: 'terminal:foreign' }), /같은 패널/);
    await assert.rejects(c.summarySend(request('\x1b[31m')), /올바른 채팅/);
    now += 11000; assert.deepEqual(await c.summarySend(request()), { deferred: true, reason: 'screen' }); await sync();
    uncertain = true; text = '› '; session.outputSequence++; await sync();
    const lost = request('no duplicate'); assert.equal((await c.summarySend(lost)).job.state, 'interrupted');
    const writeCount = writes.length; await c.summarySend(lost); assert.equal(writes.length, writeCount);
    const restored = new TerminalCollaboration(options); await restored.sync({ groups: [], frames: [] }); assert.equal(writes.length, writeCount);
    uncertain = false;
    text = 'Edited src/app.js\nWould you like to make the following edits?\n1. Yes, proceed (y)\n2. Yes, and don\'t ask again (a)\n3. No, and tell Codex what to do differently (esc)'; session.outputSequence++; await sync();
    const prompt = require('../renderer/terminal-prompt').detectPendingPrompt(text); assert(prompt);
    const approval = { ...request(), fingerprint: prompt.fingerprint, choiceId: 'proceed' };
    await assert.rejects(c.summaryRespond({ ...approval, fingerprint: 'old' }), /승인 요청/); assert.equal(responses.length, 0);
    assert.equal((await c.summaryRespond(approval)).ok, true); assert.equal(responses[0].key, 'y');
    await assert.rejects(c.summaryRespond({ ...approval, choiceId: 'always' }), /이미 응답/); assert.equal(responses.length, 1);
    const old = request('old completed reply');
    c.jobs.set(old.id, { id: old.id, operation: 'summary', sourceId: session.id, targetId: session.id, groupId: 'panel',
      expectedCreationId: session.creationId, expectedProviderPid: providerPid, expectedProvider: 'codex', state: 'completed', answer: 'old result' });
    for (let i = 0; i < 80; i++) { const id = randomUUID(); c.jobs.set(id, { id, operation: 'summary', sourceId: session.id, targetId: session.id, state: 'completed' }); }
    text = '› Ask Codex to do anything'; session.outputSequence++;
    const roster = { groups: [{ id: 'panel', cwd: directory, members: [session] }], frames: [{ id: session.id, creationId: session.creationId, outputSequence: session.outputSequence, text }] };
    assert(!(await c.sync(roster)).jobs.some(job => job.id === old.id), 'old reply is outside the recent display window');
    assert.equal((await c.sync({ ...roster, summaryJobs: [old] })).jobs.find(job => job.id === old.id).answer, 'old result', 'exact owned job lookup survives 80 newer jobs');
    const missing = request('unknown delivery');
    assert.equal((await c.sync({ ...roster, summaryJobs: [missing] })).jobs.find(job => job.id === missing.id).state, 'interrupted', 'missing delivery is explicit, never fabricated completion');
    assert.equal((await c.sync({ ...roster, summaryJobs: [{ ...old, targetId: 'foreign' }] })).jobs.some(job => job.id === old.id), false, 'foreign terminal cannot read an archived reply');
    assert.equal((await c.sync({ ...roster, summaryJobs: [{ ...old, targetProviderPid: providerPid + 1 }] })).jobs.find(job => job.id === old.id).answer, undefined, 'wrong provider identity cannot expose the old reply');
    const monitor = c.monitor; c.monitor = { scan: () => ({ available: false, processes: [] }) };
    assert(!(await c.sync({ ...roster, summaryJobs: [old] })).jobs.some(job => job.id === old.id && job.state === 'interrupted'), 'unavailable process observation cannot declare a replaced provider');
    c.monitor = monitor;
    assert.equal(writes.length, writeCount, 'status lookups never send or replay input');
    text = '› \n• Working (esc to interrupt)'; session.outputSequence++; await sync();
    const immediate = { ...request('send while busy'), sendNow: true };
    c.completion = { observe: async () => ({ available: true, state: 'working', requestId: 'busy' }) };
    assert.equal((await c.summarySend(immediate)).ok, true, 'explicit send bypasses busy readiness and running job queue');
    assert.equal(writes.at(-1).data, '\x1b[200~send while busy\x1b[201~\r');
    const immediateCount = writes.length;
    await c.summarySend(immediate); assert.equal(writes.length, immediateCount, 'immediate send remains idempotent');
    // A working AI repaints its spinner, so the captured frame's output
    // sequence is always behind the live one: explicit send still delivers.
    session.outputSequence += 3;
    const spinning = { ...request('send during spinner'), sendNow: true };
    assert.equal((await c.summarySend(spinning)).ok, true, 'send anyway tolerates output that moved on since the frame capture');
    assert.equal(writes.at(-1).data, '\x1b[200~send during spinner\x1b[201~\r');
    assert.equal(writes.at(-1).options.expectedOutputSequence, undefined, 'explicit send does not pin a sequence the spinner will have passed');
    assert.deepEqual(await c.summarySend(request('queued behind spinner')), { deferred: true, reason: 'screen' }, 'automatic delivery still waits for a current frame');
    await sync();
    draft = 'terminal draft'; await sync();
    assert.deepEqual(await c.summarySend({ ...request(), sendNow: true }), { deferred: true, reason: 'draft' }, 'send anyway preserves an existing terminal draft');
    draft = ''; text = "Would you like to make the following edits?\n1. Yes, proceed (y)\n2. Yes, and don't ask again (a)\n3. No, and tell Codex what to do differently (esc)"; session.outputSequence++; await sync();
    assert.deepEqual(await c.summarySend({ ...request(), sendNow: true }), { deferred: true, reason: 'prompt' }, 'send anyway cannot type a task into an approval menu');
    assert.equal(writes.length, immediateCount + 1, 'only the spinner-time explicit send wrote');
    const stopIdentity = { groupId: 'panel', targetId: session.id, targetCreationId: session.creationId, targetProviderPid: providerPid, targetProvider: 'codex' };
    await assert.rejects(c.summaryStop({ ...stopIdentity, targetProviderPid: providerPid + 1 }), /세션이 바뀌/, 'stop never reaches a replaced provider');
    const responseCount = responses.length;
    const stopped = await c.summaryStop(stopIdentity);
    assert.equal(stopped.ok, true); assert.equal(responses.at(-1).key, 'Escape', 'stop sends exactly one Escape');
    assert.equal(responses.length, responseCount + 1);
    assert(stopped.stopped.includes(immediate.id) && c.jobs.get(immediate.id).state === 'stopped', 'the running request is marked stopped, not interrupted');
    c.completion = { observe: async () => ({ available: true, state: 'completed', requestId: 'done' }) };
    await assert.rejects(c.summaryStop(stopIdentity), /멈출 작업/, 'nothing running means no stray Escape');
    assert.equal(responses.length, responseCount + 1);
    const reloaded = new TerminalCollaboration(options); assert.equal(reloaded.jobs.get(immediate.id).state, 'stopped', 'a stopped job survives restart as stopped');
    // Claude wraps a bracketed paste in <pasted_content> tags in its log. The
    // finished reply must still release the queue instead of a 15-minute wait.
    draft = ''; text = '› Ask Codex to do anything'; session.outputSequence++; await sync();
    c.completion = { observe: async () => ({ available: true, state: 'completed', requestId: 'before-paste', requestAt: now - 1000, completedAt: now - 500 }) };
    const pasted = request('@ElementCollection\n    @OrderColumn(name = "cell_order")\n    private List<Cell> cells;');
    assert.equal((await c.summarySend(pasted)).ok, true);
    now += 1000; const pasteFrame = text;
    c.completion = { observe: async () => ({ available: true, state: 'completed', requestId: 'paste-turn', requestAt: now, completedAt: now + 10,
      request: `\n\n<pasted_content id="07fc">\n${pasted.message}\n</pasted_content>`, evidence: 'USER: paste\nASSISTANT: done' }) };
    text = pasteFrame; await sync();
    assert.equal(c.jobs.get(pasted.id).state, 'completed', 'a pasted request recorded inside <pasted_content> completes');
    // "Send anyway" while the AI works is absorbed into the running turn; its
    // completion after the send releases the job.
    c.completion = { observe: async () => ({ available: true, state: 'working', requestId: 'running-turn', requestAt: now - 5000 }) };
    const absorbed = { ...request('수정해서 커밋,배포까지 진행해줘'), sendNow: true };
    assert.equal((await c.summarySend(absorbed)).ok, true);
    c.completion = { observe: async () => ({ available: true, state: 'completed', requestId: 'running-turn', requestAt: now - 5000, completedAt: now - 1, request: 'earlier', evidence: 'earlier' }) };
    await sync(); assert.equal(c.jobs.get(absorbed.id).state, 'running', 'a turn finished before the send is not its answer');
    now += 2000;
    c.completion = { observe: async () => ({ available: true, state: 'completed', requestId: 'running-turn', requestAt: now - 7000, completedAt: now, request: 'earlier', evidence: 'USER: earlier\nASSISTANT: committed' }) };
    await sync(); assert.equal(c.jobs.get(absorbed.id).state, 'completed', 'the absorbing turn finishing after the send completes it');
    const automatic = request('automatic same turn');
    c.jobs.set(automatic.id, { id: automatic.id, operation: 'summary', sourceId: session.id, targetId: session.id, groupId: 'panel', request: automatic.message,
      state: 'running', sentAt: now - 10, baseline: 'running-turn', providerPid, creationId: session.creationId, provider: 'codex' });
    await sync(); assert.equal(c.jobs.get(automatic.id).state, 'running', 'only an explicit send-anyway may match the turn it was absorbed into');
    c.jobs.delete(automatic.id);
    console.log('PASS summary chat guarded delivery: busy/draft queue, Unicode, exact AI/session, foreign/shell rejection, no duplicate/restart/unknown replay, current approval and duplicate-choice guard');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
