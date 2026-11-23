'use strict';
// Chat panes: a Claude or Codex terminal can be read as a conversation inside its
// own pane on the shared canvas. The bubbles come from that terminal's own
// transcript (no model call). A message typed here goes to that exact AI session
// through the guarded collaboration delivery: it waits while the AI works or
// the terminal has a draft or a question, and is never resent after a restart.
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

  // Minimal, escaped Markdown: paragraphs, headings, lists, fenced code,
  // inline code, bold and tables. Links show their text only.
  function inline(value) {
    return esc(value)
      .replace(/`([^`\n]+)`/gu, '<code>$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/gu, '<strong>$1</strong>')
      .replace(/\[([^\]\n]+)\]\([^)\n]+\)/gu, '$1');
  }
  function markdown(text) {
    const lines = String(text || '').split('\n');
    let html = '', list = '', para = [], code = null, table = [];
    const flushPara = () => { if (para.length) html += `<p>${para.map(inline).join('<br>')}</p>`; para = []; };
    const flushList = () => { if (list) html += `</${list}>`; list = ''; };
    const flushTable = () => {
      if (!table.length) return;
      const rows = table.filter(row => !/^\s*\|?\s*:?-{2,}/u.test(row)).map(row => row.trim().replace(/^\||\|$/gu, '').split('|').map(cell => cell.trim()));
      html += `<div class="wb-chat-table"><table>${rows.map((row, index) => `<tr>${row.map(cell => index ? `<td>${inline(cell)}</td>` : `<th>${inline(cell)}</th>`).join('')}</tr>`).join('')}</table></div>`;
      table = [];
    };
    for (const line of lines) {
      if (code) {
        if (/^\s*```/u.test(line)) { html += `<pre><code>${esc(code.join('\n'))}</code></pre>`; code = null; } else code.push(line);
        continue;
      }
      if (/^\s*```/u.test(line)) { flushPara(); flushList(); flushTable(); code = []; continue; }
      if (/^\s*\|.*\|\s*$/u.test(line)) { flushPara(); flushList(); table.push(line); continue; }
      flushTable();
      const heading = line.match(/^#{1,6}\s+(.*)$/u);
      const bullet = line.match(/^\s*[-*•]\s+(.*)$/u), number = line.match(/^\s*\d+[.)]\s+(.*)$/u);
      if (heading) { flushPara(); flushList(); html += `<h4>${inline(heading[1])}</h4>`; continue; }
      if (bullet || number) {
        flushPara();
        const tag = bullet ? 'ul' : 'ol';
        if (list !== tag) { flushList(); html += `<${tag}>`; list = tag; }
        html += `<li>${inline((bullet || number)[1])}</li>`;
        continue;
      }
      if (!line.trim()) { flushPara(); flushList(); continue; }
      flushList(); para.push(line);
    }
    if (code) html += `<pre><code>${esc(code.join('\n'))}</code></pre>`;
    flushPara(); flushList(); flushTable();
    return html;
  }

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
      let tools = [];
      const flushTools = () => {
        if (!tools.length) return;
        const names = [...new Set(tools.map(tool => tool.title).filter(Boolean))].slice(0, 3).join(', ');
        parts.push(`<details class="wb-chat-tools"><summary>${esc(t('도구'))} ${tools.length}${esc(t('개'))}${names ? ` · ${esc(names)}` : ''}</summary><ul>${tools.map(tool => `<li><b>${esc(tool.title || t('도구'))}</b><span>${esc(tool.text.split('\n')[0].slice(0, 200))}</span></li>`).join('')}</ul></details>`);
        tools = [];
      };
      for (const message of view.messages) {
        if (message.role === 'tool') { tools.push(message); continue; }
        flushTools();
        if (message.role === 'user') parts.push(`<div class="wb-chat-msg is-user"><div class="wb-chat-bubble">${esc(message.text).replace(/\n/gu, '<br>')}</div></div>`);
        else parts.push(`<div class="wb-chat-msg is-ai"><div class="wb-chat-text">${markdown(message.text)}</div></div>`);
      }
      flushTools();
    }
    for (const item of queues.get(id) || []) {
      const status = item.state === 'sending' ? t('보내는 중…')
        : item.state === 'sent' ? t('보냈어요')
          : item.state === 'failed' ? `${t('보내지 못했어요')} · ${item.error || ''}`
            : t(WAIT[item.reason] || '보낼 차례를 기다려요');
      const actions = item.state === 'failed' ? `<button type="button" data-chat-retry="${esc(item.id)}">${esc(t('다시 보내기'))}</button><button type="button" data-chat-discard="${esc(item.id)}">${esc(t('지우기'))}</button>`
        : item.state === 'queued' ? `<button type="button" data-chat-discard="${esc(item.id)}">${esc(t('취소'))}</button>` : '';
      parts.push(`<div class="wb-chat-msg is-user is-pending" data-state="${esc(item.state)}"><div class="wb-chat-bubble">${esc(item.text).replace(/\n/gu, '<br>')}</div><div class="wb-chat-status">${esc(status)}${actions}</div></div>`);
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
    node.innerHTML = `<div class="wb-chat-log" role="log" aria-live="polite" tabindex="0"></div><div class="wb-chat-notice" hidden></div><form class="wb-chat-composer"><textarea rows="2" aria-label="${esc(t('AI에게 보낼 메시지'))}" placeholder="${esc(t('AI에게 보낼 메시지 · Enter로 보내기, Shift+Enter 줄바꿈'))}"></textarea><button type="submit" class="wb-chat-send">${esc(t('보내기'))}</button></form>`;
    pane.node.querySelector('.wb-terminal-mount').after(node);
    const input = node.querySelector('textarea');
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); submit(id, input); }
    });
    node.querySelector('form').addEventListener('submit', event => { event.preventDefault(); submit(id, input); });
    node.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button) return;
      if (button.dataset.chatTerminalView !== undefined) { setMode(id, 'terminal'); context.save(); render(); context.focusTerminal(id); }
      if (button.dataset.chatRetry) { const item = (queues.get(id) || []).find(entry => entry.id === button.dataset.chatRetry); if (item) retry(id, item); }
      if (button.dataset.chatDiscard) { queues.set(id, (queues.get(id) || []).filter(entry => entry.id !== button.dataset.chatDiscard)); renderPane(id); }
    });
    nodes.set(id, node);
    return node;
  }

  function renderPane(id) {
    const node = nodes.get(id);
    if (!node || node.hidden) return;
    const log = node.querySelector('.wb-chat-log'), html = logHtml(id);
    if (node.dataset.html !== html) {
      const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 48 || !node.dataset.html;
      log.innerHTML = html; node.dataset.html = html;
      if (atBottom) log.scrollTop = log.scrollHeight;
    }
    const prompt = window.WhiteboxTerminalPrompts?.detectPendingPrompt(context.readTerminal(id) || '');
    const notice = node.querySelector('.wb-chat-notice');
    notice.hidden = !prompt;
    if (prompt) {
      const markup = `<span>${esc(t('AI가 터미널에서 답을 기다려요. 터미널에서 답해 주세요.'))}</span><button type="button" data-chat-terminal-view>${esc(t('터미널로 보기'))}</button>`;
      if (notice.innerHTML !== markup) notice.innerHTML = markup;
    }
  }

  function submit(id, input) {
    const text = input.value.replace(/[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]/gu, '').trim();
    if (!text) return;
    if (text.length > 8000) { context.report(t('메시지가 너무 길어요. 8000자 이하로 나눠 보내 주세요.'), id); return; }
    const m = member(id), s = session(id);
    if (!supported(id)) { context.report(t('이 터미널의 AI를 아직 확인하지 못했어요. 잠시 뒤 다시 보내 주세요.'), id); return; }
    const queue = queues.get(id) || [];
    if (queue.filter(item => item.state === 'queued').length >= 20) { context.report(t('보낼 메시지가 너무 많이 쌓였어요.'), id); return; }
    queue.push({ id: crypto.randomUUID(), text, state: 'queued', reason: '', at: Date.now(),
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
    if (queue.some(entry => entry.state === 'sending' || entry.state === 'sent' && entry.job?.state === 'running')) { item.reason = 'previous'; renderPane(id); return; }
    flushing.add(id); item.state = 'sending'; renderPane(id);
    try {
      const result = await api.terminalCollaboration({ operation: 'chat-send', id: item.id, groupId: context.groupId(id), targetId: id, message: item.text,
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
      if (queue) queues.set(id, queue.filter(item => !(item.state === 'sent' && (users.some(message => same(message.text, item.text) && Date.parse(message.timestamp) >= item.at - 5000) || Date.now() - item.sentAt > 120000))));
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
        node.hidden = false;
        node.style.top = `${pane.node.querySelector(':scope > header')?.offsetHeight || 40}px`;
        if (!views.has(id)) load(id);
        renderPane(id);
      } else if (nodes.get(id)) nodes.get(id).hidden = true;
    }
    renderMode();
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
    // Called after each collaboration sync with the backend's job list.
    observe(jobs) {
      const byId = new Map((jobs || []).filter(job => job.operation === 'chat').map(job => [job.id, job]));
      for (const [id, queue] of queues) {
        for (const item of queue) {
          const job = byId.get(item.id);
          if (!job || item.state !== 'sent') continue;
          item.job = job;
          if (['failed', 'interrupted', 'stopped'].includes(job.state)) Object.assign(item, { state: 'failed', error: job.error || t('터미널을 확인해 주세요.') });
        }
        if (queue.some(item => item.state === 'queued')) flush(id);
      }
      render();
    },
    pendingJobs() {
      return [...queues].flatMap(([id, queue]) => queue.filter(item => ['sending', 'sent'].includes(item.state))
        .map(item => ({ id: item.id, targetId: id, targetCreationId: item.targetCreationId, targetProviderPid: item.targetProviderPid, targetProvider: item.targetProvider })));
    },
    forget(id) { modes.delete(id); queues.delete(id); views.delete(id); nodes.get(id)?.remove(); nodes.delete(id); },
    // Only the chosen view is kept; typed messages are never resent after a restart.
    serialize() { return [...modes].map(([id, value]) => ({ id, creationId: value.creationId, mode: value.mode })); },
    restore(saved) {
      for (const value of Array.isArray(saved) ? saved.slice(0, 200) : []) {
        if (typeof value?.id === 'string' && typeof value.creationId === 'string' && value.mode === 'chat') modes.set(value.id, { creationId: value.creationId, mode: 'chat' });
      }
    },
  };
};
