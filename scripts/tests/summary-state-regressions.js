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
        gameVisibility: () => data.visibility, gameBehavior: () => data.behavior || 'auto-collapse', save: () => {}, reveal: () => {}, report: (message, id) => { stats.reports = [...(stats.reports || []), { message, id }]; }, submitted: () => {},
        refresh: async () => {
          stats.lookups.push(chat.pendingJobs());
          chat.observe([...data.jobs, ...(data.archived ? chat.pendingJobs().map(request => data.archived[request.id]).filter(Boolean) : [])]);
        }, captureReply: async () => { stats.captures++; return data.captureResult ?? true; },
        interrupted: () => { stats.interrupts = (stats.interrupts || 0) + 1; },
        api: { slashCommands: async ({ provider }) => { stats.catalogs = (stats.catalogs || 0) + 1; return provider === 'codex' ? [{ name: 'compact', description: '대화 압축', source: 'builtin' }, { name: 'model', description: '모델 선택', source: 'builtin' }, { name: 'khala:khala', description: 'Khala', source: 'plugin' }] : []; }, terminalCollaboration: async payload => { if (payload.operation === 'summary-stop') { stats.stops = (stats.stops || 0) + 1; return { ok: true, stopped: data.jobs.filter(job => job.state === 'running').map(job => job.id) }; } stats.sends++; stats.payloads.push(payload); if (data.deliveryError) throw Error('ack lost'); return { ok: true, job: { id: payload.id, state: 'running', sentAt: Date.now() } }; } } });
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
    { const items = [...f.root.querySelector('#wbSummaryTranscript').children].map(node => node.className);
      check(items.indexOf('wb-summary-answer') >= 0 && items.indexOf('wb-summary-answer') < items.lastIndexOf('wb-summary-user'), 'historical reply is shown before the newer request: ' + items.join(',')); }
    cases.push('late-history');
    f = make({ tasks: [task('b')], messages: [user('b')], review: { state: 'reviewing', analysisTaskId: 'a', preview: { taskId: 'b', submissionId: 'b', lifecycle: 'completed' } } });
    check(f.state().next && !f.state().loading, 'older model analysis cannot invalidate a completed newer summary'); cases.push('old-analysis');
    f = make({ tasks: [task('a', { lifecycle: 'interrupted', recordOnly: true })], messages: [user('a')] });
    check(f.state().title === '요청이 중단됐어요' && f.state().reply === '중단됨' && !f.state().loading, 'interruption is terminal, not answer waiting'); cases.push('interrupted');
    const archived = { a: { id: 'a', operation: 'summary', state: 'completed' } };
    f = make({ tasks: [task('a')], messages: [user('a')], jobs: Array.from({ length: 80 }, (_, i) => ({ id: 'other-' + i, operation: 'summary', state: 'completed' })), archived });
    await f.send();
    check(f.stats.lookups[0][0]?.id === 'a' && f.stats.captures === 1 && f.stats.sends === 1,
      'lookup and archive an old completion outside 80 jobs before exactly one next send'); cases.push('archived-job');
    f = make({ messages: [user('a')], review: { state: 'reviewing', analysisTaskId: 'a' }, jobs: [{ id: 'a', operation: 'summary', state: 'completed' }] });
    await f.send();
    check(f.stats.captures === 1 && f.stats.sends === 1 && f.stats.payloads[0].sendNow === false,
      'completed reply releases the queue automatically while model analysis is still reviewing');
    f.chat.observe(f.data.jobs); await tick(); check(f.stats.sends === 1, 'completed reply releases exactly once'); cases.push('automatic-after-answer');
    f = make({ messages: [user('a')], captureResult: false, jobs: [{ id: 'a', operation: 'summary', state: 'completed', finishedAt: Date.now() }] });
    await f.send();
    check(f.stats.sends === 0 && f.chat.serialize()[0].messages.at(-1).state === 'queued', 'a fresh completed reply is archived before the next send');
    f.data.jobs = [{ id: 'a', operation: 'summary', state: 'completed', finishedAt: Date.now() - 20000 }];
    f.chat.observe(f.data.jobs); await tick(); await tick();
    check(f.stats.sends === 1, 'a confirmed finished reply cannot hold the next message in the queue forever'); cases.push('finished-reply-release');
    f = make();
    f.root.querySelector('#wbSummaryInput').value = '/compact';
    f.root.querySelector('#wbSummaryForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await tick(); await tick();
    check(f.stats.sends === 1 && f.stats.payloads[0].message === '/compact', 'a slash command typed in summary mode is delivered, not silently dropped');
    check(!f.chat.serialize()[0].messages.length && !f.chat.pendingJobs().length, 'a delivered slash command never waits for a summary reply'); cases.push('slash-command');
    f = make({ messages: [user('q')], tasks: [task('q', { lifecycle: 'in-progress', awaitingResponse: true, analysisLifecycle: 'completed' })], review: { state: 'awaiting-answer', preview: { taskId: 'q', submissionId: 'q', lifecycle: 'in-progress', awaitingResponse: true } } });
    check(f.state().thinking !== 'AI 답변을 기다리고 있어요' && f.state().title !== 'AI 답변을 기다리고 있어요' && f.state().reply === '완료', 'a reply that asks the user a question is a finished reply, not still awaited');
    f = make({ messages: [user('j')], review: { state: 'awaiting-answer', preview: { taskId: 'j', submissionId: 'j', lifecycle: 'in-progress' } }, jobs: [{ id: 'j', operation: 'summary', state: 'completed', finishedAt: Date.now() }] });
    f.chat.observe(f.data.jobs); await tick();
    check(f.state().title !== 'AI 답변을 기다리고 있어요' && f.state().thinking !== 'AI 답변을 기다리고 있어요' && f.state().reply === '완료', 'a confirmed finished reply never shows the reply-waiting loader'); cases.push('reply-finished-status');
    f = make({ messages: [user('s')], review: { state: 'awaiting-answer', preview: { taskId: 's', submissionId: 's', lifecycle: 'in-progress' } }, jobs: [{ id: 's', operation: 'summary', state: 'running' }] });
    f.chat.observe(f.data.jobs); await tick();
    const stopHost = f.root.querySelector('#wbSummaryStopHost');
    check(!stopHost.hidden, 'stop is offered while the AI is replying to my request');
    stopHost.querySelector('button').click(); await tick(); await tick();
    check(f.stats.stops === 1 && f.stats.interrupts === 1, 'stop sends one guarded stop and marks the review interrupted');
    check(f.chat.serialize()[0].messages[0].state === 'stopped' && f.state().title === '요청을 멈췄어요' && !f.state().loading, 'a stopped request is shown as stopped without a loader');
    check(f.root.querySelector('#wbSummaryStopHost').hidden, 'stop disappears once stopped');
    f.data.jobs = [{ id: 's', operation: 'summary', state: 'stopped' }]; f.chat.observe(f.data.jobs); await tick();
    f.root.querySelector('#wbSummaryInput').value = '다음'; f.root.querySelector('#wbSummaryForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await tick(); await tick();
    check(f.stats.sends === 1, 'the next request is not held behind a stopped one'); cases.push('stop');
    const trust = "2. Trust all and continue\\n3. Continue without trusting (hooks won't run)";
    const bogus = task('trust', { request: trust, lifecycle: 'interrupted', recordOnly: true, actual: '요청이 중단됐어요. 수행 결과는 수집되지 않았어요.' });
    f = make({ tasks: [bogus], messages: [{ role: 'user', id: 'request:trust', text: trust, state: 'sent', answerKey: 'trust' },
      { role: 'answer', id: 'answer:trust', key: 'trust', task: bogus }] });
    check(!f.text('wbSummaryTranscript').includes('Trust all') && !f.text('wbSummaryTranscript').includes('수행 결과는 수집되지'), 'restored startup-menu cards disappear');
    check(f.chat.serialize()[0].messages.length === 0 && f.stats.sends === 0, 'menu filtering removes saved bogus messages without sending anything'); cases.push('trust-history');
    f = make();
    check(!f.root.querySelector('.wb-2048-panel').hidden && !f.root.querySelector('#wbSummaryGame').hidden, '2048 opens by default while idle');
    const before = JSON.stringify(f.chat.serializeGame().cells);
    const game = () => f.root.querySelector('#wbSummaryGame'), panel = () => f.root.querySelector('.wb-2048-panel'), opener = () => f.root.querySelector('[data-game-open]');
    f.data.visibility = 'summarizing'; f.chat.render(); check(!game().hidden, 'the game is never removed, even while idle');
    f.member.activity.state = 'working'; f.chat.render(); check(!game().hidden && game().dataset.waiting === 'true' && !panel().hidden, 'the AI working is part of the wait: the board is playable');
    f.member.activity.state = 'waiting'; f.chat.render(); check(!game().hidden && panel().hidden && !opener().hidden, 'a terminal that needs the user folds the board and keeps the open button');
    opener().click(); f.member.activity.state = 'idle'; f.chat.render(); check(!panel().hidden, 'the user can reopen it any time; nothing re-folds without a new wait ending');
    f.data.review = { state: 'collecting', phase: 'backoff', retryAt: Date.now() + 60000 }; f.chat.render();
    check(!game().hidden && game().dataset.waiting === 'false', 'a retry wait is not playable wait time but never hides the game');
    f.data.review = { state: 'reviewing' }; f.chat.render(); check(!panel().hidden && game().dataset.waiting === 'true', 'actual analysis is wait time');
    f.data.review = { state: 'ready' }; f.chat.render(); check(!game().hidden && panel().hidden && !opener().hidden, 'analysis completion folds the board, never hides the game');
    f.data.visibility = 'always'; f.chat.render(); opener().click();
    check(!f.root.querySelector('#wbSummaryGame').hidden && JSON.stringify(f.chat.serializeGame().cells) === before, 'visibility changes preserve the board');
    f.root.querySelector('[data-game-close]').click(); f.chat.render(); check(f.root.querySelector('.wb-2048-panel').hidden, 'explicit collapse remains respected'); cases.push('game-visibility');
    f = make({ messages: [user('a')], review: { state: 'awaiting-answer' } });
    const boardBeforeReply = JSON.stringify(f.chat.serializeGame());
    check(!f.root.querySelector('.wb-2048-panel').hidden, 'default board is open while waiting');
    f.data.tasks = [task('a', { analysisLifecycle: 'in-progress' })]; f.data.review = { state: 'reviewing', analysisTaskId: 'a' }; f.chat.render();
    check(!f.root.querySelector('.wb-2048-panel').hidden, 'reply arrival keeps the board open while the summary is still running');
    f.data.tasks = [task('a')]; f.data.review = { state: 'ready' }; f.chat.render();
    check(f.root.querySelector('.wb-2048-panel').hidden, 'default collapses once the summary completes');
    check(JSON.stringify({ ...f.chat.serializeGame(), open: true }) === boardBeforeReply, 'collapse preserves cells, score and best');
    f.root.querySelector('[data-game-open]').click(); f.chat.render();
    check(!f.root.querySelector('.wb-2048-panel').hidden, 'manual reopen survives repeated completion polls');
    f.data.tasks = [task('b')]; f.data.review = { state: 'ready' };
    f.chat.restore([{ id: 'states', creationId: 'epoch', mode: 'summary', messages: [user('b')], game2048: f.chat.serializeGame() }]); f.chat.render();
    check(f.root.querySelector('.wb-2048-panel').hidden, 'a different reply collapses again');
    f.data.behavior = 'always-open'; f.chat.render();
    check(!f.root.querySelector('.wb-2048-panel').hidden, 'keep expanded immediately reopens the board');
    f.chat.render(); check(!f.root.querySelector('.wb-2048-panel').hidden, 'keep expanded survives completed reply polls');
    f.data.behavior = 'auto-collapse'; f.chat.render();
    check(f.root.querySelector('.wb-2048-panel').hidden, 'switching back applies auto collapse to arrived reply');
    cases.push('game-auto-collapse');
    f = make();
    const sharedBoard = f.chat.serializeGame();
    f.root.querySelector('[data-game-direction="left"]').click(); f.root.querySelector('[data-game-direction="up"]').click();
    const played = JSON.stringify(f.chat.serializeGame());
    f.chat.forget('states'); f.chat.render();
    check(sharedBoard && JSON.stringify(f.chat.serializeGame()) === played, 'a new session continues the same shared board');
    check(f.chat.serialize().every(value => !('game2048' in value)), 'the board is no longer saved per terminal');
    f = make();
    const far = { cells: [1024, 512, ...Array(14).fill(0)], score: 9000, best: 9000, open: false };
    const near = { cells: [2, 2, ...Array(14).fill(0)], score: 4, best: 12000, open: true };
    f.chat.restore([{ id: 'other', creationId: 'gone', game2048: near }, { id: 'old', creationId: 'gone', game2048: far }]);
    check(f.chat.serializeGame().score === 9000 && f.chat.serializeGame().cells[0] === 1024 && f.chat.serializeGame().best === 12000, 'legacy per-terminal boards migrate to the furthest game and best score');
    f = make();
    f.chat.restoreGame(far); check(f.chat.serializeGame().score === 9000 && f.chat.serializeGame().best === 9000, 'a saved shared board replaces an untouched fresh board');
    cases.push('game-shared');
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
    f = make({ review: { state: 'error', message: 'analysis failed' } });
    check(!f.stats.reports && f.chat.serialize()[0].mode === 'summary', 'an analysis error never forces the terminal view; its card explains it');
    cases.push('error-stays-in-summary');
    f = make();
    const type = async text => { f.root.querySelector('#wbSummaryInput').value = text; f.root.querySelector('#wbSummaryInput').dispatchEvent(new Event('input')); await tick(); await tick(); };
    const key = (k, init = {}) => f.root.querySelector('#wbSummaryInput').dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
    const commands = () => f.root.querySelector('#wbSummaryCommands');
    await type('/');
    check(!commands().hidden && [...commands().querySelectorAll('[data-command-index] code')].map(node => node.textContent).join(',') === '/compact,/model,/khala:khala', 'typing "/" lists the provider commands');
    await type('/mo'); check([...commands().querySelectorAll('[data-command-index] code')].map(node => node.textContent).join(',') === '/model', 'prefix filtering');
    await type('/kha'); check(commands().textContent.includes('/khala:khala') && commands().textContent.includes('플러그인'), 'namespaced plugin commands match with their source');
    await type('/'); key('ArrowDown'); check(commands().querySelector('[aria-selected=true] code').textContent === '/model', 'arrow keys move the selection');
    key('Enter'); await tick();
    check(f.root.querySelector('#wbSummaryInput').value === '/model ' && commands().hidden && f.stats.sends === 0, 'Enter inserts the chosen command without sending');
    await type('/compact'); key('Enter'); await tick();
    // requestSubmit() is inert on this detached fixture form; the real form submits.
    check(commands().hidden && f.root.querySelector('#wbSummaryInput').value === '/compact', 'an exactly typed command is kept and sent on Enter instead of being re-inserted');
    f.root.querySelector('#wbSummaryForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await tick(); await tick();
    check(f.stats.sends === 1 && f.stats.payloads.at(-1).message === '/compact', 'the typed command is delivered');
    await type('/'); key('Escape'); check(commands().hidden, 'Escape closes the list');
    await type('hello /compact'); check(commands().hidden, 'a slash inside text is not a command');
    check(f.stats.catalogs === 1, 'the catalog is fetched once per terminal and provider'); cases.push('slash-commands');
    // A saved transcript can hold an old, never-finished turn after a newer
    // finished one (imports, restarts). Progress follows the latest turn by
    // time, and the transcript is shown in time order.
    {
      const now = Date.now(), early = now - 3 * 3600000;
      const latest = task('latest', { request: '최근 요청', submittedAt: now - 60000, actual: '최근 요청을 처리했습니다.' });
      const stale = task('stale', { request: '오래된 요청', submittedAt: early, lifecycle: 'in-progress', analysisLifecycle: 'in-progress', deferred: true, analysisDepth: 'deferred', actual: '결과가 수집되면 분석할게요.' });
      f = make({ tasks: [latest], messages: [
        user('latest', { text: '최근 요청', at: now - 60000, sentAt: now - 60000, answerKey: 'latest' }), { role: 'answer', id: 'answer:latest', key: 'latest', task: latest },
        user('stale', { text: '오래된 요청', at: early, sentAt: early, answerKey: 'stale' }), { role: 'answer', id: 'answer:stale', key: 'stale', task: stale }] });
      check(f.state().title === '답변과 요약이 도착했어요' && !f.state().loading, 'progress follows the latest finished turn, not an older one saved later: ' + JSON.stringify(f.state()));
      check(f.root.querySelector('#wbSummaryTranscript').textContent.indexOf('오래된 요청') < f.root.querySelector('#wbSummaryTranscript').textContent.indexOf('최근 요청'), 'transcript is shown in time order');
      check(f.chat.serialize()[0].messages.every(message => message.role === 'user' && !message.id.startsWith('request:')), 'only own sends are saved; answers are derived from review results');
      // A saved answer copy that the review no longer has is not shown.
      f = make({ tasks: [latest], messages: [user('latest', { text: '최근 요청', at: now - 60000, sentAt: now - 60000, answerKey: 'latest' }),
        { role: 'answer', id: 'answer:ghost', key: 'ghost', task: task('ghost', { request: '사라진 요청', actual: '요청 결과를 판단할 구체적인 내용이 아직 기록에 없어요.' }) }] });
      check(!f.root.querySelector('#wbSummaryTranscript').textContent.includes('구체적인 내용이 아직 기록에 없어요'), 'stale saved answer copies are not restored');
      // Content follows the review result: an updated analysis replaces the shown text.
      f.data.tasks = [{ ...latest, actual: '분석이 갱신됐습니다.' }]; f.chat.render();
      check(f.root.querySelector('#wbSummaryTranscript').textContent.includes('분석이 갱신됐습니다.'), 'Summary shows the same, current content as the review panel');
      cases.push('latest-turn-by-time');
    }
    // While its summary is still being made, a finished reply is not shown raw:
    // only the status. Once no summary is coming, the reply itself is shown.
    const rawReply = task('raw', { recordOnly: true, deferred: true, analysisDepth: 'deferred', actual: 'RAW_REPLY_TEXT 원문 그대로' });
    f = make({ tasks: [rawReply], messages: [user('raw')], review: { state: 'reviewing', analysisTaskId: 'raw', phase: 'model' } });
    check(!f.text('wbSummaryTranscript').includes('RAW_REPLY_TEXT') && f.state().loading && f.state().thinking === '요약 중…', 'a summary in progress shows status, not the raw reply');
    f.data.review = { state: 'collecting', analysisTaskId: 'raw', phase: 'queue' }; f.chat.render();
    check(!f.text('wbSummaryTranscript').includes('RAW_REPLY_TEXT') && f.state().loading && f.state().thinking.endsWith('답변 완료 · 요약 준비 중…'), 'a queued summary also shows status only');
    f.data.review = { state: 'ready' }; f.chat.render();
    check(f.text('wbSummaryTranscript').includes('RAW_REPLY_TEXT'), 'a reply that will not be summarized is shown as it is');
    cases.push('no-raw-while-summarizing');
    // The live step of a working AI replaces the generic "working" text.
    f = make({ messages: [user('live')], review: { state: 'awaiting-answer' } });
    f.member.activity = { state: 'working', progress: { kind: 'test', phase: 'running' } }; f.chat.render();
    check(f.state().thinking.endsWith('테스트 실행 중…') && f.state().reply === '테스트 실행 중…', 'live step: running tests');
    f.member.activity = { state: 'working', progress: { kind: 'edit', detail: 'auth.js', phase: 'running' } }; f.chat.render();
    check(f.state().thinking.endsWith('파일 수정 중 · auth.js…') && f.state().reply === '파일 수정 중 · auth.js…', 'live step: the edited file');
    f.member.activity = { state: 'working', progress: { kind: 'note', detail: '<b>인증</b> 원인을 찾고 있습니다.', phase: 'note' } }; f.chat.render();
    check(f.state().thinking.endsWith('<b>인증</b> 원인을 찾고 있습니다.') && !f.root.querySelector('#wbSummaryThinking b'), 'live step: the own progress line of the AI, as inert text');
    f.member.activity = { state: 'working' }; f.chat.render();
    check(f.state().thinking.endsWith('AI가 작업 중입니다.') && f.state().reply === '작업 중', 'without a live step the generic text remains');
    cases.push('live-step');
    // Each result card says what it is: summary, reply shown as written, or
    // a failed summary that stays in Summary mode with a reason and a retry.
    const passCard = task('pass', { recordOnly: true, deferred: true, analysisDepth: 'deferred', passThrough: true,
      actual: '## 결론\\n**설정 구조**가 핵심입니다.\\n<b>x</b>',
      choices: [{ question: '어떤 형태인가요?', options: [{ label: 'a', text: '따로 만든다' }, { label: 'b', text: '구성이 다르다' }], recommendation: { label: 'b', text: '(b)라고 봅니다.' } }] });
    f = make({ tasks: [passCard], messages: [user('pass')], review: { state: 'ready' } });
    const passArticle = f.root.querySelector('#wbSummaryTranscript [data-result-kind="pass-through"]');
    check(passArticle && passArticle.textContent.includes('AI 답변 · 짧아서 그대로 보여요') && passArticle.textContent.includes('설정 구조가 핵심입니다.')
      && !passArticle.textContent.includes('**') && passArticle.textContent.includes('<b>x</b>') && passArticle.querySelector('.wb-content-choices [data-recommended="true"]'),
      'a pass-through reply is labeled, readable, inert and keeps its question options');
    check(f.state().title === '답변이 도착했어요' && f.state().review === '요약 필요 없음' && !f.state().loading, 'a pass-through reply needs no summary and ends the wait');
    const failedCard = task('fail', { recordOnly: true, deferred: true, analysisDepth: 'deferred', actual: 'AI 원문입니다.', summaryFailure: { kind: 'auth' } });
    f = make({ tasks: [failedCard], messages: [user('fail')], review: { state: 'error', message: 'Invalid API key' } });
    const failArticle = f.root.querySelector('#wbSummaryTranscript [data-result-kind="failed"]');
    check(failArticle && failArticle.textContent.includes('요약하지 못했어요 · AI 원문') && failArticle.textContent.includes('로그인되어 있지 않거나')
      && failArticle.querySelector('[data-summary-retry]') && failArticle.textContent.includes('AI 원문입니다.'), 'a failed summary shows the reply, the reason and a retry');
    check(f.chat.serialize()[0].mode === 'summary' && !f.stats.reports, 'a failed summary never forces the terminal view');
    check(f.state().title === '요약하지 못했어요' && f.state().review === '요약 실패' && !f.state().loading, 'a failed summary ends the wait');
    const recordCard = task('rec', { recordOnly: true, analysisDepth: 'record', actual: '‘a’의 이름을 ‘b’로 변경한 실행 결과가 확인됐어요.' });
    f = make({ tasks: [recordCard], messages: [user('rec')], review: { state: 'ready' } });
    check(f.root.querySelector('#wbSummaryTranscript [data-result-kind="summary"]')?.textContent.includes('Whitebox 요약'), 'a result settled by the record alone is a summary');
    cases.push('result-kinds');
    return cases;
  })()`);
  assert.equal(result.length, 26);
  console.log('PASS summary state regressions: deferred/reply/backoff/active/old analysis, historical ordering, interruption, archived job lookup, saved trust controls, default/settings-aware 2048, no raw reply while summarizing, live AI step, result card kinds');
};
