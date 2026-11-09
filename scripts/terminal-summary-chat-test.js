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
    write: async (id, data, options) => { assert.equal(options.expectedOutputSequence, session.outputSequence); writes.push({ id, data, options }); if (uncertain) throw Object.assign(Error('ack lost'), { deliveryState: 'unknown' }); },
    respond: async (id, key, options) => { assert.equal(options.expectedOutputSequence, session.outputSequence); responses.push({ id, key, options }); } };
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
    assert.deepEqual(await c.summarySend(pending), { deferred: true }); assert.equal(writes.length, 0);
    draft = ''; text = '› \n• Working (esc to interrupt)'; await sync();
    assert.deepEqual(await c.summarySend(pending), { deferred: true });
    text = '› Ask Codex to do anything'; await sync();
    const sent = await c.summarySend(pending); assert.equal(sent.ok, true);
    assert.equal(writes[0].data, '\x1b[200~안녕\n다음 줄\x1b[201~\r');
    assert.equal((await c.summarySend(pending)).job.id, sent.job.id); assert.equal(writes.length, 1);
    await assert.rejects(c.summarySend({ ...pending, message: 'different' }), /식별자/);
    assert.deepEqual(await c.summarySend(request('queued next')), { deferred: true }, 'running delivery blocks later messages');
    session.outputSequence++; text = '› 안녕\n다음 줄\n• 답변입니다\nWorked for 2s • 3:40 PM\n› Ask Codex to do anything'; await sync();
    assert.equal(c.jobs.get(pending.id).state, 'completed');
    const slash = request('/compact');
    assert.equal((await c.summarySend(slash)).ok, true, 'slash commands are still delivered to the AI CLI');
    await sync(); assert.equal(c.jobs.get(slash.id).state, 'running', 'a command is not released before its prompt returns');
    now += 3000; session.outputSequence++; await sync();
    assert.equal(c.jobs.get(slash.id).state, 'completed', 'a finished slash command no longer blocks later chat messages');
    const oldIdentity = request(); providerPid++; await sync();
    await assert.rejects(c.summarySend(oldIdentity), /세션이 바뀌/);
    hasProvider = false; await sync(); await assert.rejects(c.summarySend(request()), /먼저 실행/); hasProvider = true;
    await sync();
    await assert.rejects(c.summarySend({ ...request(), targetId: 'terminal:foreign' }), /같은 패널/);
    await assert.rejects(c.summarySend(request('\x1b[31m')), /올바른 채팅/);
    now += 11000; assert.deepEqual(await c.summarySend(request()), { deferred: true }); await sync();
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
    draft = 'terminal draft'; await sync();
    assert.deepEqual(await c.summarySend({ ...request(), sendNow: true }), { deferred: true }, 'send anyway preserves an existing terminal draft');
    draft = ''; text = "Would you like to make the following edits?\n1. Yes, proceed (y)\n2. Yes, and don't ask again (a)\n3. No, and tell Codex what to do differently (esc)"; session.outputSequence++; await sync();
    assert.deepEqual(await c.summarySend({ ...request(), sendNow: true }), { deferred: true }, 'send anyway cannot type a task into an approval menu');
    assert.equal(writes.length, immediateCount);
    console.log('PASS summary chat guarded delivery: busy/draft queue, Unicode, exact AI/session, foreign/shell rejection, no duplicate/restart/unknown replay, current approval and duplicate-choice guard');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
