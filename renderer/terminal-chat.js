'use strict';
// Chat panes: a Claude or Codex terminal can be read as a conversation inside its
// own pane on the shared canvas. The bubbles come from that terminal's own
// transcript (no model call). A message typed here goes to that exact AI session
// through the guarded collaboration delivery: while the AI works it goes in at
// once and the AI takes it at its next gap; "stop and send" ends the current
// turn first. It waits only for a terminal draft or question, and is never
// resent after a restart. "/" lists the AI's commands and skills.
// The terminal keeps running and keeps its size under the chat.
window.WhiteboxTerminalChat = function createTerminalChat(context) {
  const { root, api, t, esc } = context;
  const ui = window.WhiteboxWorkspaceUI;
  const PROVIDERS = ['claude', 'codex'];
  const POLL_MS = 1500;
  const modes = new Map();          // id -> { creationId, mode: 'chat' | 'terminal' }
  const queues = new Map();         // id -> messages typed here, until the transcript shows them
  const views = new Map();          // id -> { creationId, revision, messages, truncated, working, error }
  const loading = new Set(), flushing = new Set();
  const nodes = new Map();          // id -> chat element inside the pane
  let modeKey = '';

  const session = id => context.session(id);
  const member = id => context.member(id);
  // The AI running in this exact terminal process, as the last sync saw it.
  function supported(id) {
    const s = session(id), m = member(id);
    return Boolean(s?.status === 'running' && m && m.creationId === s.creationId && m.pid === s.pid
      && m.providerPid > 0 && PROVIDERS.includes(m.provider));
  }
  const fresh = id => supported(id) && Date.now() - (member(id).observedAt || 0) < 5000;
  function mode(id) {
    const s = session(id), saved = modes.get(id);
    return saved && s && saved.creationId === s.creationId ? saved.mode : 'terminal';
  }
  const isChat = id => mode(id) === 'chat' && supported(id);
  function setMode(id, value) {
    const s = session(id);
    if (!s) return;
    if (value === 'chat') modes.set(id, { creationId: s.creationId, mode: 'chat' });
    else modes.delete(id);
  }

  const chatRender = window.WhiteboxChatRender({ t, esc });
  const { markdown, toggle, copies, workLabel, toolDetail, turnHtml, turnsOf, slashMenu } = chatRender;
  const commands = new Map();       // id -> { at, providerPid, promise } of the "/" list
  const menus = new Map();          // id -> slash menu of the pane's composer
  const SENDER = { claude: 'Claude', codex: 'Codex' };
  const working = id => Boolean(views.get(id)?.working || member(id)?.activity?.state === 'working');

  const WAIT = {
    working: '앞 작업이 끝나면 보낼게요',
    previous: '앞 작업이 끝나면 보낼게요',
    draft: '터미널 입력창에 쓰던 글이 있어서 기다려요',
    prompt: '터미널의 질문에 먼저 답해 주세요',
    screen: '터미널 상태를 확인하는 중이에요',
    connection: '터미널 상태를 확인하는 중이에요',
  };
  const same = (a, b) => String(a || '').replace(/\s+/gu, ' ').trim() === String(b || '').replace(/\s+/gu, ' ').trim();

  function logHtml(id) {
    const view = views.get(id), parts = [];
    if (!view) parts.push(`<p class="wb-chat-empty">${esc(t('대화를 불러오는 중…'))}</p>`);
    else if (view.error) parts.push(`<p class="wb-chat-empty">${esc(view.error)}</p>`);
    else {
      if (view.truncated) parts.push(`<p class="wb-chat-more">${esc(t('더 이전 대화는 터미널에서 볼 수 있어요.'))}</p>`);
      if (!view.messages.length) parts.push(`<p class="wb-chat-empty">${esc(t('아직 대화가 없어요. 아래에 첫 요청을 써 보세요.'))}</p>`);
      copies.set(id, []);
      const busy = working(id), sender = SENDER[member(id)?.provider] || '';
      const turns = turnsOf(view.messages);
      turns.forEach((turn, index) => parts.push(turnHtml(id, turn, busy && index === turns.length - 1, sender)));
    }
    for (const item of queues.get(id) || []) {
      const status = item.state === 'sending' ? t(item.interrupt ? '작업을 멈추고 보내는 중…' : '보내는 중…')
        : item.state === 'sent' ? t(item.job?.interrupted ? '작업을 멈추고 보냈어요' : item.job?.midTurn ? '작업 중에 넣었어요 · AI가 틈이 나면 읽어요' : '보냈어요')
          : item.state === 'failed' ? `${t('보내지 못했어요')} · ${item.error || ''}`
            : t(WAIT[item.reason] || '보낼 차례를 기다려요');
      const actions = item.state === 'failed' ? `<button type="button" data-chat-retry="${esc(item.id)}">${esc(t('다시 보내기'))}</button><button type="button" data-chat-discard="${esc(item.id)}">${esc(t('지우기'))}</button>`
        : item.state === 'queued' ? `${['draft', 'prompt'].includes(item.reason) ? '' : `<button type="button" data-chat-force="${esc(item.id)}">${esc(t('멈추고 보내기'))}</button>`}<button type="button" data-chat-discard="${esc(item.id)}">${esc(t('취소'))}</button>` : '';
      parts.push(`<div class="wb-chat-msg is-user is-pending" data-state="${esc(item.state)}"><div class="wb-chat-bubble"><div class="wb-chat-user-text">${esc(item.text).replace(/\n/gu, '<br>')}</div></div><div class="wb-chat-status">${esc(status)}${actions}</div></div>`);
    }
    const activity = member(id)?.activity;
    if (view?.working || activity?.state === 'working') {
      const detail = activity?.progress?.detail ? ` · ${activity.progress.detail}` : '';
      parts.push(`<div class="wb-chat-working"><i aria-hidden="true"></i>${esc(t('작업 중'))}${esc(detail)}</div>`);
    }
    return parts.join('');
  }

  function chatNode(id) {
    let node = nodes.get(id);
    if (node?.isConnected) return node;
    const pane = context.panes().get(id);
    if (!pane) return null;
    node = document.createElement('div');
    node.className = 'wb-chat';
    const forceTitle = `${t('지금 하던 작업을 멈추고 바로 보내요')} (${/Mac/u.test(navigator.platform) ? '⌘' : 'Ctrl'}+Enter)`;
    node.innerHTML = `<div class="wb-chat-log" role="log" aria-live="polite" tabindex="0"></div><div class="wb-chat-notice" hidden></div><form class="wb-chat-composer"><div class="wb-chat-slash" role="listbox" aria-label="${esc(t('명령과 스킬'))}" hidden></div><textarea rows="2" aria-label="${esc(t('AI에게 보낼 메시지'))}" placeholder="${esc(t('AI에게 보낼 메시지 · / 명령·스킬 · Enter로 보내기, Shift+Enter 줄바꿈'))}"></textarea><button type="button" class="wb-chat-force" title="${esc(forceTitle)}" hidden>${esc(t('멈추고 보내기'))}</button><button type="submit" class="wb-chat-send">${esc(t('보내기'))}</button></form>`;
    pane.node.querySelector('.wb-terminal-mount').after(node);
    const input = node.querySelector('textarea');
    const menu = slashMenu({ input, box: node.querySelector('.wb-chat-slash'), load: () => slashCommands(id) });
    menus.set(id, menu);
    input.addEventListener('keydown', event => {
      if (menu.keydown(event)) return;
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); submit(id, input, { interrupt: event.metaKey || event.ctrlKey }); }
    });
    node.querySelector('form').addEventListener('submit', event => { event.preventDefault(); submit(id, input); });
    node.querySelector('.wb-chat-force').addEventListener('click', () => submit(id, input, { interrupt: true }));
    node.addEventListener('click', event => {
      const link = event.target.closest('a[data-chat-link]');
      if (link) { event.preventDefault(); if (/^https:\/\//u.test(link.href)) api.openExternal?.(link.href)?.catch?.(() => {}); return; }
      const button = event.target.closest('button');
      if (!button) return;
      if (button.dataset.chatToggle) { toggle(id, button.dataset.chatToggle); renderPane(id); return; }
      if (button.dataset.chatCopy !== undefined) {
        const text = copies.get(id)?.[Number(button.dataset.chatCopy)];
        if (typeof text === 'string') Promise.resolve(api.writeClipboard ? api.writeClipboard(text) : navigator.clipboard?.writeText(text)).then(() => { button.dataset.copied = 'true'; setTimeout(() => delete button.dataset.copied, 1200); }).catch(() => {});
        return;
      }
      if (button.dataset.chatTerminalView !== undefined) { setMode(id, 'terminal'); context.save(); render(); context.focusTerminal(id); }
      if (button.dataset.chatRetry) { const item = (queues.get(id) || []).find(entry => entry.id === button.dataset.chatRetry); if (item) retry(id, item); }
      if (button.dataset.chatForce) { const item = (queues.get(id) || []).find(entry => entry.id === button.dataset.chatForce); if (item?.state === 'queued') { item.interrupt = true; renderPane(id); flush(id); } }
      if (button.dataset.chatDiscard) { queues.set(id, (queues.get(id) || []).filter(entry => entry.id !== button.dataset.chatDiscard)); renderPane(id); }
    });
    // Whether the reader is at the latest message; a hidden log reads as scrolled to the top.
    const log = node.querySelector('.wb-chat-log');
    log.addEventListener('scroll', () => {
      if (log.clientHeight) node.dataset.pinned = String(log.scrollHeight - log.scrollTop - log.clientHeight < 48);
    }, { passive: true });
    nodes.set(id, node);
    return node;
  }

  function renderPane(id) {
    const node = nodes.get(id);
    if (!node || node.hidden) return;
    const log = node.querySelector('.wb-chat-log'), html = logHtml(id);
    if (node.dataset.html !== html) {
      const atBottom = node.dataset.pinned !== 'false' || !node.dataset.html;
      log.innerHTML = `<div class="wb-chat-column">${html}</div>`; node.dataset.html = html;
      // A request taller than the preview shows a fade and "더 보기" (Paseo's MessagePreview).
      for (const preview of log.querySelectorAll('[data-chat-preview]')) {
        const more = preview.scrollHeight > 241 || preview.classList.contains('is-open') && preview.scrollHeight > 240;
        preview.classList.toggle('has-more', more);
        preview.nextElementSibling.hidden = !more;
      }
      if (atBottom) log.scrollTop = log.scrollHeight;
    }
    node.querySelector('.wb-chat-force').hidden = !working(id);
    const prompt = window.WhiteboxTerminalPrompts?.detectPendingPrompt(context.readTerminal(id) || '');
    const notice = node.querySelector('.wb-chat-notice');
    notice.hidden = !prompt;
    if (prompt) {
      const markup = `<span>${esc(t('AI가 터미널에서 답을 기다려요. 터미널에서 답해 주세요.'))}</span><button type="button" data-chat-terminal-view>${esc(t('터미널로 보기'))}</button>`;
      if (notice.innerHTML !== markup) notice.innerHTML = markup;
    }
  }

  // The "/" list of this terminal's AI, read again after 30 s or a new AI process.
  function slashCommands(id) {
    const m = member(id);
    if (!m || !PROVIDERS.includes(m.provider) || typeof api.slashCommands !== 'function') return Promise.resolve([]);
    const cached = commands.get(id);
    if (cached && cached.providerPid === m.providerPid && Date.now() - cached.at < 30000) return cached.promise;
    const promise = Promise.resolve(api.slashCommands({ id, provider: m.provider, providerPid: m.providerPid })).then(items => Array.isArray(items) ? items : []).catch(() => []);
    commands.set(id, { at: Date.now(), providerPid: m.providerPid, promise });
    return promise;
  }

  function submit(id, input, { interrupt = false } = {}) {
    const text = input.value.replace(/[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]/gu, '').trim();
    if (!text) return;
    if (text.length > 8000) { context.report(t('메시지가 너무 길어요. 8000자 이하로 나눠 보내 주세요.'), id); return; }
    const m = member(id), s = session(id);
    if (!supported(id)) { context.report(t('이 터미널의 AI를 아직 확인하지 못했어요. 잠시 뒤 다시 보내 주세요.'), id); return; }
    const queue = queues.get(id) || [];
    if (queue.filter(item => item.state === 'queued').length >= 20) { context.report(t('보낼 메시지가 너무 많이 쌓였어요.'), id); return; }
    menus.get(id)?.close();
    queue.push({ id: crypto.randomUUID(), text, state: 'queued', reason: '', at: Date.now(), interrupt,
      targetCreationId: s.creationId, targetProviderPid: m.providerPid, targetProvider: m.provider });
    queues.set(id, queue);
    input.value = '';
    renderPane(id);
    flush(id);
  }
  function retry(id, item) {
    const m = member(id), s = session(id);
    if (!supported(id)) return;
    Object.assign(item, { id: crypto.randomUUID(), state: 'queued', reason: '', error: '', job: null,
      targetCreationId: s.creationId, targetProviderPid: m.providerPid, targetProvider: m.provider });
    renderPane(id); flush(id);
  }

  async function flush(id) {
    const queue = queues.get(id) || [];
    const item = queue.find(entry => entry.state === 'queued');
    if (!item || flushing.has(id)) return;
    const s = session(id), m = member(id);
    if (!s || s.creationId !== item.targetCreationId || (m?.providerPid > 0 && (m.providerPid !== item.targetProviderPid || m.provider !== item.targetProvider))) {
      Object.assign(item, { state: 'failed', error: t('AI 세션이 바뀌어서 보내지 않았어요.') }); renderPane(id); return;
    }
    if (!fresh(id)) { item.reason = 'connection'; renderPane(id); return; }
    // One delivery at a time; a message typed while the AI works goes in now.
    if (queue.some(entry => entry.state === 'sending')) return;
    flushing.add(id); item.state = 'sending'; renderPane(id);
    try {
      const result = await api.terminalCollaboration({ operation: 'chat-send', id: item.id, groupId: context.groupId(id), targetId: id, message: item.text, interrupt: item.interrupt === true,
        targetCreationId: item.targetCreationId, targetProviderPid: item.targetProviderPid, targetProvider: item.targetProvider });
      if (result?.deferred) Object.assign(item, { state: 'queued', reason: result.reason });
      else if (result?.ok) { Object.assign(item, { state: 'sent', sentAt: Date.now(), job: result.job }); context.submitted?.(result.job); }
      else Object.assign(item, { state: 'failed', error: result?.job?.error || t('터미널을 확인해 주세요.') });
    } catch (error) {
      Object.assign(item, { state: 'failed', error: String(error.message || error) });
    } finally {
      flushing.delete(id); renderPane(id);
    }
  }

  async function load(id) {
    const s = session(id);
    if (!s || loading.has(id)) return;
    loading.add(id);
    try {
      const previous = views.get(id);
      const result = await api.terminalConversation({ id, creationId: s.creationId, revision: previous?.creationId === s.creationId ? previous.revision : '' });
      if (session(id)?.creationId !== s.creationId) return;
      if (!result?.available) views.set(id, { creationId: s.creationId, revision: '', messages: previous?.messages || [], error: previous?.messages?.length ? '' : t('이 터미널의 대화 기록을 아직 찾지 못했어요.') });
      else if (result.unchanged) views.set(id, { ...previous, working: result.working });
      else views.set(id, { creationId: s.creationId, revision: result.revision, messages: result.messages || [], truncated: result.truncated, working: result.working, error: '' });
      // A typed message leaves the queue once the transcript shows it.
      const users = (views.get(id).messages || []).filter(message => message.role === 'user');
      const queue = queues.get(id);
      // A mid-turn message shows up when the AI takes it in, which can take a long tool run.
      if (queue) queues.set(id, queue.filter(item => !(item.state === 'sent' && (users.some(message => same(message.text, item.text) && Date.parse(message.timestamp) >= item.at - 5000) || Date.now() - item.sentAt > (item.job?.midTurn ? 900000 : 120000)))));
    } catch (error) {
      views.set(id, { ...(views.get(id) || { messages: [] }), error: String(error.message || error) });
    } finally {
      loading.delete(id); renderPane(id);
    }
  }

  function renderMode() {
    const host = root.querySelector('.wb-mode-switch');
    const visible = context.visibleIds().filter(supported);
    const chat = visible.length > 0 && visible.every(isChat);
    const key = JSON.stringify([chat, visible.length > 0, t('터미널'), t('채팅')]);
    if (host && ui?.choices && key !== modeKey) {
      ui.choices(host, { value: chat ? 'chat' : 'terminal', label: t('보기 방식'),
        options: [{ value: 'terminal', label: t('터미널') }, { value: 'chat', label: t('채팅'), disabled: !visible.length }],
        onChange: switchAll });
      host.removeAttribute('role'); host.removeAttribute('aria-label');
      host.querySelectorAll('[role="radio"]').forEach((button, index) => { button.dataset.workspaceMode = index ? 'chat' : 'terminal'; });
      modeKey = key;
    }
    for (const button of root.querySelectorAll('[data-workspace-mode]')) {
      button.disabled = button.dataset.workspaceMode === 'chat' && !visible.length;
      button.setAttribute('aria-pressed', String(button.dataset.workspaceMode === (chat ? 'chat' : 'terminal')));
      button.title = button.disabled ? t('Claude나 Codex를 실행한 터미널이 화면에 있으면 채팅으로 볼 수 있어요.') : button.textContent;
    }
  }
  // The switch turns every Claude/Codex terminal on screen at once.
  function switchAll(value) {
    for (const id of context.visibleIds()) if (supported(id)) setMode(id, value);
    context.save(); render();
    const id = context.activeId();
    if (isChat(id)) focus(id); else if (id) context.focusTerminal(id);
  }
  function focus(id) { requestAnimationFrame(() => chatNode(id)?.querySelector('textarea')?.focus({ preventScroll: true })); }

  function render() {
    for (const [id, pane] of context.panes()) {
      const chat = isChat(id);
      pane.node.classList.toggle('is-chat', chat);
      const toggle = pane.node.querySelector('[data-chat-terminal]');
      if (toggle) {
        toggle.hidden = !supported(id);
        toggle.setAttribute('aria-pressed', String(chat));
        toggle.title = chat ? t('터미널로 보기') : t('채팅으로 보기');
        toggle.setAttribute('aria-label', toggle.title);
      }
      if (chat) {
        const node = chatNode(id);
        if (!node) continue;
        // Switching to chat opens at the latest message. A hidden log also
        // loses its scroll position, so a log the user left at the bottom stays there.
        if (node.hidden || node.dataset.shown !== 'true') node.dataset.pinned = 'true';
        node.hidden = false; node.dataset.shown = 'true';
        node.style.top = `${pane.node.querySelector(':scope > header')?.offsetHeight || 40}px`;
        if (!views.has(id)) load(id);
        renderPane(id);
        if (node.dataset.pinned !== 'false') scrollToEnd(node);
      } else if (nodes.get(id)) { nodes.get(id).hidden = true; delete nodes.get(id).dataset.shown; }
    }
    renderMode();
  }
  function scrollToEnd(node) {
    const log = node.querySelector('.wb-chat-log'), end = () => { log.scrollTop = log.scrollHeight; };
    end(); requestAnimationFrame(end);
  }

  root.addEventListener('click', event => {
    const toggle = event.target.closest('[data-chat-terminal]');
    if (toggle) {
      const id = toggle.dataset.chatTerminal, next = isChat(id) ? 'terminal' : 'chat';
      setMode(id, next); context.save(); render();
      if (next === 'chat') focus(id); else context.focusTerminal(id);
    }
  });
  root.querySelectorAll('[data-workspace-mode]').forEach(button => button.addEventListener('click', () => switchAll(button.dataset.workspaceMode === 'chat' ? 'chat' : 'terminal')));
  setInterval(() => {
    for (const id of context.visibleIds()) if (isChat(id)) load(id);
  }, POLL_MS);

  return {
    render, isChat, focus,
    // Exposed for tests: the escaped Markdown and the request bubble.
    markdown, turnsOf, workLabel, toolDetail,
    // Called after each collaboration sync with the backend's job list.
    observe(jobs) {
      const byId = new Map((jobs || []).filter(job => job.operation === 'chat').map(job => [job.id, job]));
      for (const [id, queue] of queues) {
        for (const item of queue) {
          const job = byId.get(item.id);
          if (!job || item.state !== 'sent') continue;
          item.job = job;
          if (['failed', 'interrupted', 'stopped'].includes(job.state)) Object.assign(item, { state: 'failed', error: job.error || (job.state === 'stopped' ? t('작업을 멈췄어요.') : t('터미널을 확인해 주세요.')) });
        }
        if (queue.some(item => item.state === 'queued')) flush(id);
      }
      render();
    },
    pendingJobs() {
      return [...queues].flatMap(([id, queue]) => queue.filter(item => ['sending', 'sent'].includes(item.state))
        .map(item => ({ id: item.id, targetId: id, targetCreationId: item.targetCreationId, targetProviderPid: item.targetProviderPid, targetProvider: item.targetProvider })));
    },
    forget(id) { modes.delete(id); queues.delete(id); views.delete(id); commands.delete(id); menus.delete(id); nodes.get(id)?.remove(); nodes.delete(id); },
    // Only the chosen view is kept; typed messages are never resent after a restart.
    serialize() { return [...modes].map(([id, value]) => ({ id, creationId: value.creationId, mode: value.mode })); },
    restore(saved) {
      for (const value of Array.isArray(saved) ? saved.slice(0, 200) : []) {
        if (typeof value?.id === 'string' && typeof value.creationId === 'string' && value.mode === 'chat') modes.set(value.id, { creationId: value.creationId, mode: 'chat' });
      }
    },
  };
};
