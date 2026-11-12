'use strict';
const assert = require('node:assert/strict');

// /clear and /compact dividers, the folded conversation before a clear, and
// summary shapes (a draft shows its own content) in the real renderer.
exports.run = async evaluate => {
  const result = await evaluate(`(async () => {
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));
    const check = (condition, message) => { if (!condition) throw Error(message); };
    function make(options = {}) {
      const root = document.createElement('div');
      root.append(document.querySelector('.wb-mode-switch').cloneNode(true), document.querySelector('#wbSummary').cloneNode(true), document.querySelector('#wbCanvas').cloneNode(false));
      const data = { tasks: [], review: { state: 'ready' }, ...options };
      const member = { creationId: 'epoch', pid: 100, providerPid: 101, provider: 'claude', ready: true, observedAt: Date.now(), activity: { state: 'idle' } };
      const stats = { sends: [], drafts: [], clip: '' };
      const chat = WhiteboxSummaryChat({ root, t: text => text, esc: WhiteboxRendererUtils.esc,
        activeId: () => 'shapes', session: () => ({ status: 'running', creationId: 'epoch', pid: 100 }),
        member: () => member, tasks: () => data.tasks, review: () => data.review,
        snapshot: () => ({ text: '' }), label: () => 'shapes', groupId: () => 'group',
        gameVisibility: () => 'always', gameBehavior: () => 'auto-collapse', save: () => {}, reveal: () => {}, focusTerminal: () => {}, report: () => {}, submitted: () => {},
        refresh: async () => chat.observe([]), captureReply: async () => true, interrupted: () => {},
        api: { providerUsage: async () => ({ providers: {} }), slashCommands: async () => [],
          writeClipboard: async text => { stats.clip = text; },
          summaryDraft: async payload => { stats.drafts.push(payload); return payload.action === 'open' ? { ok: true } : { text: '# 답변\\n파일에서 읽은 전체 초안' }; },
          terminalCollaboration: async payload => { stats.sends.push(payload.message); return { ok: true, job: { id: payload.id, state: 'running', sentAt: Date.now() } }; } } });
      chat.restore([{ id: 'shapes', creationId: 'epoch', mode: 'summary', messages: structuredClone(data.messages || []), marks: data.marks || [] }]);
      chat.render();
      return { root, chat, data, stats, q: selector => root.querySelector(selector), qa: selector => [...root.querySelectorAll(selector)] };
    }
    const user = (id, sentAt, text = '검사해줘') => ({ id, role: 'user', text, state: 'sent', sentAt, at: sentAt,
      targetCreationId: 'epoch', targetProviderPid: 101, targetProvider: 'claude' });
    const task = (id, submittedAt, extra = {}) => ({ taskId: id, submissionId: id, request: '검사해줘', actual: '요약 ' + id,
      explanation: '요약 ' + id, lifecycle: 'completed', analysisLifecycle: 'completed', submittedAt, ...extra });
    const cases = [];

    // A clear folds what came before it; past requests stay listed with a divider.
    let f = make({ tasks: [task('a', 1000), task('b', 3000)], messages: [user('a', 1000), user('b', 3000)] });
    f.chat.markReset('shapes', 'clear', 2000);
    const folded = f.q('[data-summary-cleared]');
    check(folded && !folded.open && folded.querySelector('[data-summary-message=a]'), 'requests before a clear fold away');
    check(!folded.querySelector('[data-summary-message=b]') && f.q('#wbSummaryTranscript > [data-summary-message=b]'), 'requests after a clear stay on screen');
    check(f.q('#wbSummaryTranscript > [data-summary-mark=clear]'), 'the clear divider is shown');
    check(f.qa('#wbSummaryPast > li').map(li => li.dataset.summaryMark || (li.dataset.cleared ? 'old' : 'new')).join() === 'new,clear,old', 'past requests keep both sides of the divider');
    f.q('[data-summary-past=a]').click(); await tick();
    check(f.q('[data-summary-cleared]').open, 'choosing an older past request opens the folded conversation');
    const saved = f.chat.serialize()[0];
    check(saved.marks.length === 1 && saved.marks[0].kind === 'clear', 'dividers are saved');
    cases.push('clear-fold');

    // Compact only adds a divider; nothing folds.
    f = make({ tasks: [task('a', 1000), task('b', 3000)], messages: [user('a', 1000), user('b', 3000)], marks: [{ kind: 'compact', at: 2000 }] });
    check(!f.q('[data-summary-cleared]') && f.q('[data-summary-mark=compact]') && f.qa('.wb-summary-answer').length === 2, 'compact keeps every summary');
    cases.push('compact');

    // Clearing from Summary is delivered to the AI and empties the screen.
    f = make({ tasks: [task('a', 1000)], messages: [{ ...user('a', 1000), replyCaptured: true }] });
    f.q('#wbSummaryInput').value = '/clear';
    f.q('#wbSummaryForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    for (let i = 0; i < 20 && !f.stats.sends.length; i++) await tick();
    await tick(); f.chat.render();
    check(f.stats.sends[0] === '/clear', '/clear still reaches the AI');
    check(f.q('[data-summary-cleared-empty]') && f.q('[data-summary-cleared]'), 'the screen is emptied and the earlier summary folded');
    check(!f.qa('#wbSummaryPast [data-summary-past]').some(node => node.textContent.includes('/clear')), '/clear is not a past request');
    f.chat.markReset('shapes', 'clear', f.chat.serialize()[0].marks[0].at + 500);
    check(f.chat.serialize()[0].marks.length === 1, 'the same clear seen twice is one divider');
    cases.push('clear-send');

    // A draft summary shows the draft itself, its outline, and its file.
    const content = { version: 2, shape: 'draft', answer: { text: '기준 스펙을 백엔드로 바꿔 달라고 먼저 부탁해요.', basis: 'reported', quote: 'x' },
      details: [{ text: '27건을 넷으로 나눠 답했어요.', basis: 'reported', quote: 'x' }], limitations: [], deliverables: [],
      handoff: { kind: 'decide', temporal: null, priority: { text: '약속 두 곳을 그대로 둘지 정해야 해요.', basis: 'inference', quote: 'x' }, prompt: { text: '낮춰서 반영해줘', basis: 'inference', quote: 'x' } } };
    f = make({ tasks: [task('d', 1000, { content, draft: { path: '/Users/me/Desktop/answer.md', outline: ['# API 변경 요청 답변', '## 먼저: 기준 스펙', '## ① 이미 있음'], opening: '# API 변경 요청 답변\\n요청서의 operationId는 Pylon 공통 명세의 이름입니다.' } })], messages: [user('d', 1000)] });
    check(f.q('.wb-draft [data-shape=draft]') && f.q('.wb-draft-lead').textContent.includes('기준 스펙'), 'the draft card leads with what the draft says');
    check(f.qa('.wb-draft-outline li').length === 3 && f.q('.wb-draft-opening').textContent.startsWith('요청서의'), 'outline and opening come from the draft itself');
    check(f.q('.wb-draft-tools code').textContent === '~/Desktop/answer.md', 'the file path is shown');
    check(f.q('.wb-draft-check').textContent.includes('보내기 전에 정할 것'), 'open decisions are asked before sending');
    f.q('[data-summary-draft-copy=d]').click();
    for (let i = 0; i < 10 && !f.stats.clip; i++) await tick();
    check(f.stats.clip.includes('파일에서 읽은 전체 초안') && f.stats.drafts[0].taskId === 'd', 'copy takes the full draft from its file');
    f.q('[data-summary-draft-open=d]').click(); await tick();
    check(f.stats.drafts.at(-1).action === 'open', 'the file opens on request');
    const past = f.q('#wbSummaryPast [data-summary-past=d]').textContent;
    check(past.includes('초안') && past.includes('기준 스펙'), 'the past request names the draft and its message');
    cases.push('draft-file');

    f = make({ tasks: [task('r', 1000, { content, draft: { text: '안녕하세요.\\n다음 주 배포를 안내드립니다.' } })], messages: [user('r', 1000)] });
    check(f.q('.wb-draft-text').textContent.includes('다음 주 배포') && !f.q('[data-summary-draft-open]'), 'a draft written in the reply carries its own text');
    cases.push('draft-reply');

    f = make({ tasks: [task('c', 1000, { content: { ...content, shape: 'change' } })], messages: [user('c', 1000)] });
    check(f.q('.wb-content-shape[data-shape=change]') && !f.q('.wb-draft'), 'other shapes keep the summary layout with their chip');
    cases.push('shape-chip');
    return cases;
  })()`);
  assert.deepEqual(result, ['clear-fold', 'compact', 'clear-send', 'draft-file', 'draft-reply', 'shape-chip']);
  console.log('PASS summary shapes: clear folds earlier summaries, compact divides, /clear delivered without a wait, draft card from file and reply, shape chips');
};
