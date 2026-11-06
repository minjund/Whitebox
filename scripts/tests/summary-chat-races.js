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
};
