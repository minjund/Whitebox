'use strict';
const assert = require('node:assert/strict');

exports.run = async evaluate => {
  const result = await evaluate(`(async () => {
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));
    const check = (condition, message) => { if (!condition) throw Error(message); };
    function make(options = {}) {
      const root = document.createElement('div');
      root.append(document.querySelector('.wb-mode-switch').cloneNode(true), document.querySelector('#wbSummary').cloneNode(true), document.querySelector('#wbCanvas').cloneNode(false));
      const data = { tasks: [], review: { state: 'ready' }, jobs: [], visibility: 'always', ...options };
      const member = { creationId: 'epoch', pid: 100, providerPid: 101, provider: 'codex', ready: true,
        observedAt: Date.now(), activity: { state: 'idle' } };
      const stats = { sends: 0, captures: 0, lookups: [], payloads: [] };
      const chat = WhiteboxSummaryChat({ root, t: text => text, esc: WhiteboxRendererUtils.esc,
        activeId: () => 'states', session: () => ({ status: 'running', creationId: 'epoch', pid: 100 }),
        member: () => member, tasks: () => data.tasks, review: () => data.review,
        snapshot: () => ({ text: '' }), label: () => 'states', groupId: () => 'group',
        gameVisibility: () => data.visibility, save: () => {}, reveal: () => {}, report: () => {}, submitted: () => {},
        refresh: async () => {
          stats.lookups.push(chat.pendingJobs());
          chat.observe([...data.jobs, ...(data.archived ? chat.pendingJobs().map(request => data.archived[request.id]).filter(Boolean) : [])]);
        }, captureReply: async () => { stats.captures++; return true; },
        api: { terminalCollaboration: async payload => { stats.sends++; stats.payloads.push(payload); if (data.deliveryError) throw Error('ack lost'); return { ok: true, job: { id: payload.id, state: 'running', sentAt: Date.now() } }; } } });
      chat.restore([{ id: 'states', creationId: 'epoch', mode: 'summary', messages: structuredClone(data.messages || []) }]);
      chat.render();
      const text = id => root.querySelector('#' + id).textContent;
      return { root, chat, data, member, stats, text,
        state: () => ({ title: text('wbSummaryStateTitle'), reply: text('wbSummaryReplyState'),
          review: text('wbSummaryReviewState'), loading: !root.querySelector('#wbSummaryWorking').hidden,
          thinking: text('wbSummaryThinking'), next: !root.querySelector('#wbSummaryNext').hidden }),
        send: async () => { root.querySelector('#wbSummaryInput').value = '다음 요청';
          root.querySelector('#wbSummaryForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await tick(); await tick(); } };
    }
    const user = (id, extra = {}) => ({ id, role: 'user', text: '검사해줘', state: 'sent',
      targetCreationId: 'epoch', targetProviderPid: 101, targetProvider: 'codex', ...extra });
    const task = (id, extra = {}) => ({ taskId: id, submissionId: id, request: '검사해줘', actual: '검사를 완료했습니다.',
      lifecycle: 'completed', analysisLifecycle: 'completed', ...extra });
    const deferred = task('a', { recordOnly: true, deferred: true, analysisDepth: 'deferred', actual: '결과가 수집되면 분석할게요.' });
    const cases = [];
    let f = make({ tasks: [deferred], messages: [user('a')] });
    check(!f.state().loading && f.state().review === '분석 대기', 'completed deferred result must not spin'); cases.push('deferred');
    f = make({ messages: [user('a')], review: { state: 'awaiting-answer' } });
    check(f.state().thinking === 'AI 답변을 기다리고 있어요' && f.state().reply !== '완료', 'reply waiting is not summary generation'); cases.push('awaiting-answer');
    f = make({ tasks: [deferred], messages: [user('a')], review: { state: 'collecting', phase: 'backoff', retryAt: Date.now() + 60000 } });
    check(!f.state().loading && f.state().title === '분석 재시도 대기', 'rate-limit backoff must not claim to summarize'); cases.push('backoff');
    f = make({ tasks: [task('a')], messages: [user('a')], review: { state: 'reviewing', analysisTaskId: 'a', preview: { taskId: 'a', submissionId: 'a', lifecycle: 'completed' } } });
    check(f.state().loading && f.state().thinking === '요약 중…', 'actual current analysis keeps the summary loader'); cases.push('analyzing');
    f = make({ tasks: [task('b')], messages: [user('a', { replyCaptured: true }), user('b')] });
    check(f.state().next && !f.state().loading && f.state().review === '완료', 'old unmatched request cannot block the newest completed summary'); cases.push('old-unmatched');
    f = make({ tasks: [task('a', { submittedAt: 1 })], messages: [user('b', { at: 2 })], review: { state: 'awaiting-answer', preview: { taskId: 'b', submissionId: 'b', lifecycle: 'in-progress' } } });
    check(f.state().reply !== '완료' && f.state().title === 'AI 답변을 기다리고 있어요', 'late historical reply cannot complete the newer request');
    check(f.chat.serialize()[0].messages[0].id === 'request:a', 'historical reply is inserted before the newer request'); cases.push('late-history');
    f = make({ tasks: [task('b')], messages: [user('b')], review: { state: 'reviewing', analysisTaskId: 'a', preview: { taskId: 'b', submissionId: 'b', lifecycle: 'completed' } } });
    check(f.state().next && !f.state().loading, 'older model analysis cannot invalidate a completed newer summary'); cases.push('old-analysis');
    f = make({ tasks: [task('a', { lifecycle: 'interrupted', recordOnly: true })], messages: [user('a')] });
    check(f.state().title === '요청이 중단됐어요' && f.state().reply === '중단됨' && !f.state().loading, 'interruption is terminal, not answer waiting'); cases.push('interrupted');
    const archived = { a: { id: 'a', operation: 'summary', state: 'completed' } };
    f = make({ tasks: [task('a')], messages: [user('a')], jobs: Array.from({ length: 80 }, (_, i) => ({ id: 'other-' + i, operation: 'summary', state: 'completed' })), archived });
    await f.send();
    check(f.stats.lookups[0][0]?.id === 'a' && f.stats.captures === 1 && f.stats.sends === 1,
      'lookup and archive an old completion outside 80 jobs before exactly one next send'); cases.push('archived-job');
    const trust = "2. Trust all and continue\\n3. Continue without trusting (hooks won't run)";
    const bogus = task('trust', { request: trust, lifecycle: 'interrupted', recordOnly: true, actual: '요청이 중단됐어요. 수행 결과는 수집되지 않았어요.' });
    f = make({ tasks: [bogus], messages: [{ role: 'user', id: 'request:trust', text: trust, state: 'sent', answerKey: 'trust' },
      { role: 'answer', id: 'answer:trust', key: 'trust', task: bogus }] });
    check(!f.text('wbSummaryTranscript').includes('Trust all') && !f.text('wbSummaryTranscript').includes('수행 결과는 수집되지'), 'restored startup-menu cards disappear');
    check(f.chat.serialize()[0].messages.length === 0 && f.stats.sends === 0, 'menu filtering removes saved bogus messages without sending anything'); cases.push('trust-history');
    f = make();
    check(!f.root.querySelector('.wb-2048-panel').hidden && !f.root.querySelector('#wbSummaryGame').hidden, '2048 opens by default while idle');
    const before = JSON.stringify(f.chat.serialize()[0].game2048.cells);
    f.data.visibility = 'summarizing'; f.chat.render(); check(f.root.querySelector('#wbSummaryGame').hidden, 'summarizing-only hides an idle board');
    f.member.activity.state = 'working'; f.chat.render(); check(f.root.querySelector('#wbSummaryGame').hidden, 'provider work without summary generation does not reveal summarizing-only game');
    f.member.activity.state = 'idle';
    f.data.review = { state: 'collecting', phase: 'backoff', retryAt: Date.now() + 60000 }; f.chat.render();
    check(f.root.querySelector('#wbSummaryGame').hidden, 'summarizing-only also hides during retry wait');
    f.data.review = { state: 'reviewing' }; f.chat.render(); check(!f.root.querySelector('#wbSummaryGame').hidden, 'summarizing-only reveals actual analysis');
    f.data.review = { state: 'ready' }; f.chat.render(); check(f.root.querySelector('#wbSummaryGame').hidden, 'analysis completion hides summarizing-only game');
    f.data.visibility = 'always'; f.chat.render();
    check(!f.root.querySelector('#wbSummaryGame').hidden && JSON.stringify(f.chat.serialize()[0].game2048.cells) === before, 'visibility changes preserve the board');
    f.root.querySelector('[data-game-close]').click(); f.chat.render(); check(f.root.querySelector('.wb-2048-panel').hidden, 'explicit collapse remains respected'); cases.push('game-visibility');
    f = make({ review: { state: 'reviewing' } });
    f.member.ready = false; f.member.activity.state = 'working';
    const composer = f.root.querySelector('#wbSummaryInput'); composer.value = 'send me now';
    f.root.querySelector('#wbSummaryForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await tick();
    check(f.stats.sends === 0 && f.root.querySelector('[data-summary-send-now]'), 'busy request remains queued with send anyway control');
    const sendButton = f.root.querySelector('[data-summary-send-now]'); sendButton.click(); sendButton.click();
    await tick(); await tick();
    check(f.stats.sends === 1 && f.stats.payloads[0].sendNow === true && f.stats.captures === 0, 'send anyway immediately dispatches once without awaiting old analysis or reply capture');
    check(f.chat.serialize()[0].messages.find(m => m.text === 'send me now').state === 'sent', 'immediate request leaves queue after acknowledgement');
    f.chat.observe([]); await tick(); check(f.stats.sends === 1, 'polling cannot resend explicit delivery'); cases.push('send-anyway');
    f = make({ deliveryError: true }); f.member.ready = false;
    f.root.querySelector('#wbSummaryInput').value = 'unknown delivery';
    f.root.querySelector('#wbSummaryForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await tick();
    f.root.querySelector('[data-summary-send-now]').click(); await tick(); await tick();
    check(f.chat.serialize()[0].messages[0].state === 'interrupted', 'lost immediate acknowledgement is explicit');
    f.member.ready = true; f.chat.observe([]); await tick(); check(f.stats.sends === 1, 'lost immediate delivery is never replayed'); cases.push('send-anyway-unknown');
    return cases;
  })()`);
  assert.equal(result.length, 13);
  console.log('PASS summary state regressions: deferred/reply/backoff/active/old analysis, historical ordering, interruption, archived job lookup, saved trust controls and default/settings-aware 2048');
};
