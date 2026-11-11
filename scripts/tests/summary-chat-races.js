'use strict';
const assert = require('node:assert/strict');
exports.run = async evaluate => {
  const result = await evaluate(`(async () => {
    const root = document.createElement('div');
    root.append(document.querySelector('.wb-mode-switch').cloneNode(true), document.querySelector('#wbSummary').cloneNode(true), document.querySelector('#wbCanvas').cloneNode(false));
    let tasks = [], resolveSend, calls = 0, captures = 0, starts = 0;
    const member = { creationId: 'epoch', pid: 100, providerPid: 101, provider: 'codex', ready: true, observedAt: Date.now() };
    const chat = WhiteboxSummaryChat({ root, t: text => text, esc: text => String(text),
      activeId: () => 'race', session: () => ({ status: 'running', creationId: 'epoch', pid: 100 }), member: () => member,
      tasks: () => tasks, snapshot: () => ({ text: '' }), review: () => ({ state: 'reviewing' }), label: () => 'race', groupId: () => 'group',
      save: () => {}, refresh: async () => {}, reveal: () => {}, report: () => {}, submitted: () => {},
      captureReply: async () => { captures++; return true; },
      startSummary: async () => { starts++; },
      api: { terminalCollaboration: () => { calls++; return new Promise(resolve => { resolveSend = resolve; }); } } });
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));
    const send = text => { root.querySelector('#wbSummaryInput').value = text; root.querySelector('#wbSummaryForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); };
    chat.setMode('summary'); chat.setMode('summary'); send('repeat'); await tick();
    const first = chat.serialize()[0].messages.find(message => message.state === 'sending');
    if (!first) throw Error('First delivery missing: ' + JSON.stringify(chat.serialize()));
    tasks = [{ taskId: 'early', submissionId: first.id, request: 'repeat', actual: 'early answer', lifecycle: 'completed' }];
    chat.render(); // The answer is visible before the acknowledgement arrives.
    resolveSend({ ok: true, job: { id: first.id, state: 'running' } }); await tick(); chat.render();
    let saved = chat.serialize()[0];
    const early = { users: saved.messages.filter(message => message.role === 'user').length,
      answerKey: saved.messages.find(message => message.id === first.id).answerKey };
    tasks = []; // Model summary deliberately missing on the next request.
    chat.observe([{ id: first.id, operation: 'summary', state: 'completed' }]);
    send('repeat'); await tick();
    const second = chat.serialize()[0].messages.find(message => message.state === 'sending');
    if (!second) throw Error('Second delivery missing: ' + JSON.stringify(chat.serialize()) + ' notice=' + root.querySelector('#wbSummaryNotice').textContent);
    resolveSend({ ok: true, job: { id: second.id, state: 'running' } }); await tick();
    tasks = [{ taskId: 'deferred', submissionId: second.id, request: 'repeat', lifecycle: 'completed', deferred: true, analysisDepth: 'deferred', actual: 'insufficient evidence' }];
    chat.render(); saved = chat.serialize()[0];
    tasks = [{ request:'recorded without IDs', actual:'recorded answer stays readable', recordOnly:true, lifecycle:'completed' }];
    chat.render();
    const recordedVisible = root.querySelector('#wbSummary').textContent.includes('recorded answer stays readable');
    return { early, calls, captures, starts, recordedVisible, users: saved.messages.filter(message => message.role === 'user').length,
      deferredKey: saved.messages.find(message => message.id === second.id).answerKey };
  })()`);
  assert.equal(result.early.users, 1, 'early answer must not duplicate the submitted request');
  assert.equal(result.early.answerKey, 'early', 'late acknowledgement still binds the already rendered answer');
  assert.equal(result.calls, 2, 'missing model summary cannot block a completed request');
  assert.equal(result.captures, 1, 'previous completion is archived before sending');
  assert.equal(result.deferredKey, 'deferred', 'completed deferred reviews settle the matching request');
  assert.equal(result.starts, 1, 'opening an empty summary explicitly requests existing-answer analysis exactly once');
  assert.equal(result.users, 2, 'each submitted request has exactly one user bubble');
  assert.equal(result.recordedVisible, true, 'a recorded answer without IDs renders without matching a nonexistent failure');
  console.log('PASS summary renderer races: early answer/late acknowledgement, no duplicate request, archived completion before next send, deferred result binding');
  // Send must always end visibly: delivered, queued with a reason, or an error
  // with a retry. Modeled on v2.0.27 jobs where a send did nothing or failed.
  const delivery = await evaluate(`(async () => {
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));
    const root = document.createElement('div');
    root.append(document.querySelector('.wb-mode-switch').cloneNode(true), document.querySelector('#wbSummary').cloneNode(true), document.querySelector('#wbCanvas').cloneNode(false));
    const member = { creationId: 'epoch', pid: 100, providerPid: 101, provider: 'claude', ready: true, observedAt: Date.now() };
    let jobs = [], replies = [], payloads = [], captureError = null;
    const chat = WhiteboxSummaryChat({ root, t: text => text, esc: text => String(text),
      activeId: () => 'send', session: () => ({ status: 'running', creationId: 'epoch', pid: 100 }), member: () => member,
      tasks: () => [], snapshot: () => ({ text: '' }), review: () => ({ state: 'ready' }), label: () => 'send', groupId: () => 'group',
      save: () => {}, refresh: async () => { chat.observe(jobs); }, reveal: () => {}, report: () => {}, submitted: () => {},
      captureReply: async () => { if (captureError) throw captureError; return true; },
      api: { terminalCollaboration: async payload => { payloads.push(payload); return replies.shift() || { ok: true, job: { id: payload.id, state: 'running', sentAt: Date.now() } }; } } });
    const input = root.querySelector('#wbSummaryInput'), notice = () => root.querySelector('#wbSummaryNotice').textContent;
    const submit = async text => { input.value = text; root.querySelector('#wbSummaryForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await tick(); await tick(); };
    const messages = () => chat.serialize()[0].messages;
    chat.setMode('summary');
    const out = {};
    // 1. A slow observation (AI known, last seen 6s ago) used to drop Enter silently.
    member.observedAt = Date.now() - 6000; chat.render();
    out.buttonEnabledWhileStale = !root.querySelector('#wbSummarySend').disabled;
    member.observedAt = Date.now() - 6000;
    jobs = []; await submit('느린 관찰 중 보낸 요청');
    out.staleQueued = messages().map(m => m.state).join(',');
    out.staleNote = root.querySelector('[data-summary-wait]')?.dataset.summaryWait || '';
    out.staleSends = payloads.length;
    member.observedAt = Date.now(); chat.observe([]); await tick(); await tick();
    out.afterFresh = messages().map(m => m.state).join(',');
    // 2. A missed process scan (no provider PID for one tick) must not end a queued request.
    member.ready = false; await submit('스캔 누락 중 대기');
    const keepPid = member.providerPid; member.providerPid = null; chat.observe([{ id: messages()[0].id, operation: 'summary', state: 'running' }]); await tick();
    out.missedScan = messages().at(-1).state;
    member.providerPid = keepPid; member.ready = true;
    // 3. A deferred send names its wait.
    replies.push({ deferred: true, reason: 'previous' });
    jobs = [{ id: messages()[0].id, operation: 'summary', state: 'completed', finishedAt: Date.now() }];
    chat.observe(jobs); await tick(); await tick(); await tick();
    out.deferredNote = root.querySelector('[data-summary-wait]')?.textContent || '';
    // 4. A real provider change still ends the queue with a reason.
    member.providerPid = 202; chat.observe(jobs); await tick();
    out.changed = messages().at(-1).state + ':' + (messages().at(-1).error || '');
    member.providerPid = keepPid;
    // 5. Too long or invalid input explains itself and keeps the text.
    await submit('x'.repeat(8001));
    out.tooLong = { notice: notice(), kept: input.value.length, count: messages().length };
    await submit('제어\\u001b[0m문자');
    out.stripped = messages().at(-1).text;
    // 6. An interrupted request offers a retry that queues it again under a new ID.
    replies.push({ ok: false, job: { state: 'failed', error: '상대가 작업 중이거나 입력 중인 글이 있습니다.' } });
    jobs = jobs.concat(messages().filter(m => m.state === 'sent').map(m => ({ id: m.id, operation: 'summary', state: 'completed', finishedAt: Date.now() - 60000 })));
    await submit('실패 후 다시 보내기'); chat.observe(jobs); await tick(); await tick();
    const failed = messages().find(m => m.text === '실패 후 다시 보내기');
    out.failed = failed.state;
    const resend = root.querySelector('[data-summary-resend="' + failed.id + '"]');
    out.resendButton = Boolean(resend);
    const oldId = failed.id, before = payloads.length;
    resend.click(); await tick(); await tick(); await tick();
    const retried = messages().find(m => m.text === '실패 후 다시 보내기');
    out.retried = { state: retried.state, newId: retried.id !== oldId, sends: payloads.length - before, lastId: payloads.at(-1).id === retried.id, error: retried.error || '' };
    // 7. A settled reply whose archiving throws no longer holds the queue forever.
    captureError = new Error('capture failed');
    jobs = jobs.concat(messages().filter(m => m.state === 'sent').map(m => ({ id: m.id, operation: 'summary', state: 'completed', finishedAt: Date.now() - 60000 })));
    chat.observe(jobs); await tick(); await tick();
    const beforeCapture = payloads.length;
    await submit('보관 실패 뒤 요청'); chat.observe(jobs); await tick(); await tick(); await tick();
    out.afterCaptureError = { state: messages().find(m => m.text === '보관 실패 뒤 요청').state, sends: payloads.length - beforeCapture };
    chat.forget('send');
    return out;
  })()`);
  assert.equal(delivery.buttonEnabledWhileStale, true, 'a known AI keeps the send button usable while its observation is late');
  assert.equal(delivery.staleQueued, 'queued', 'Enter during a slow observation queues the request instead of dropping it');
  assert.equal(delivery.staleNote, 'connection', 'the queued request says it waits for the connection');
  assert.equal(delivery.staleSends, 0);
  assert.equal(delivery.afterFresh, 'sent', 'the queue drains once the AI is observed again');
  assert.equal(delivery.missedScan, 'queued', 'one missed process scan keeps the request queued');
  assert.equal(delivery.deferredNote, '앞의 요청이 끝나면 자동으로 보내요.', 'a deferred send shows its reason');
  assert.match(delivery.changed, /^interrupted:AI 세션이 종료되거나 바뀌었습니다/u, 'a replaced AI session still ends the queue visibly');
  assert.match(delivery.tooLong.notice, /8000자/u, 'an over-long request explains why it was not sent');
  assert.equal(delivery.tooLong.kept, 8001, 'the composer keeps the refused text');
  assert.equal(delivery.stripped, '제어[0m문자', 'invisible control characters are dropped instead of refusing the send');
  assert.equal(delivery.failed, 'interrupted');
  assert.equal(delivery.resendButton, true, 'a failed request offers a retry');
  assert.deepEqual(delivery.retried, { state: 'sent', newId: true, sends: 1, lastId: true, error: '' }, 'retry sends exactly once under a new ID');
  assert.deepEqual(delivery.afterCaptureError, { state: 'sent', sends: 1 }, 'a failing archive of a settled reply cannot block the next send');
  console.log('PASS summary send outcomes: late observation queues, missed scan keeps queue, wait reasons, visible refusals, retry, settled capture failure');
};
