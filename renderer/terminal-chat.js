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

  // Minimal, escaped Markdown: paragraphs, headings, nested lists (numbering
  // kept across blank lines), fenced code, quotes, rules, inline code, bold and
  // tables. https links open in the browser; other links show their text only.
  function inline(value) {
    const codes = [];
    return esc(value)
      .replace(/`([^`\n]+)`/gu, (_, code) => `\u0000${codes.push(`<code>${code}</code>`) - 1}\u0000`)
      .replace(/\*\*([^*\n]+)\*\*/gu, '<strong>$1</strong>')
      .replace(/\[([^\]\n]+)\]\((https:\/\/[^)\s]+)\)/gu, (_, text, url) => `<a href="${url}" data-chat-link>${text}</a>`)
      .replace(/\[([^\]\n]+)\]\([^)\n]+\)/gu, '$1')
      .replace(/(^|[\s(（])(https:\/\/[^\s<>()（）]+[^\s<>()（）.,;:!?。，、'"])/gu, (_, lead, url) => `${lead}<a href="${url}" data-chat-link>${url}</a>`)
      .replace(/\u0000(\d+)\u0000/gu, (_, index) => codes[Number(index)]);
  }
  function markdown(text) {
    const lines = String(text || '').split('\n');
    let html = '', para = [], code = null, table = [], quote = [], blank = false;
    const stack = []; // open lists: { indent, tag }
    const flushPara = () => { if (para.length) html += `<p>${para.map(inline).join('<br>')}</p>`; para = []; };
    const closeLists = (indent = -1) => { while (stack.length && stack.at(-1).indent > indent) html += `</li></${stack.pop().tag}>`; };
    const flushQuote = () => { if (quote.length) html += `<blockquote>${quote.map(inline).join('<br>')}</blockquote>`; quote = []; };
    const flushTable = () => {
      if (!table.length) return;
      const rows = table.filter(row => !/^\s*\|?\s*:?-{2,}/u.test(row)).map(row => row.trim().replace(/^\||\|$/gu, '').split('|').map(cell => cell.trim()));
      html += `<div class="wb-chat-table"><table>${rows.map((row, index) => `<tr>${row.map(cell => index ? `<td>${inline(cell)}</td>` : `<th>${inline(cell)}</th>`).join('')}</tr>`).join('')}</table></div>`;
      table = [];
    };
    const flushBlocks = () => { flushPara(); flushQuote(); flushTable(); closeLists(); };
    for (const line of lines) {
      if (code) {
        if (/^\s*```/u.test(line)) { html += `<pre><code>${esc(code.join('\n'))}</code></pre>`; code = null; } else code.push(line);
        continue;
      }
      if (/^\s*```/u.test(line)) { flushBlocks(); code = []; blank = false; continue; }
      if (!line.trim()) { flushPara(); flushQuote(); flushTable(); blank = true; continue; }
      const item = line.match(/^(\s*)(?:([-*•])|(\d+)[.)])\s+(.*)$/u);
      if (item) {
        flushPara(); flushQuote(); flushTable();
        const indent = item[1].replace(/\t/gu, '    ').length, tag = item[2] ? 'ul' : 'ol';
        closeLists(indent);
        if (stack.at(-1)?.indent === indent && stack.at(-1).tag !== tag) html += `</li></${stack.pop().tag}>`;
        if (!stack.length || indent > stack.at(-1).indent) {
          const start = tag === 'ol' && Number(item[3]) > 1 ? ` start="${Number(item[3])}"` : '';
          html += `<${tag}${start}>`; stack.push({ indent, tag });
        } else html += '</li>';
        html += `<li>${inline(item[4])}`;
        blank = false;
        continue;
      }
      // An indented line right under a list item continues that item.
      if (stack.length && !blank && /^\s{2,}\S/u.test(line)) { html += `<br>${inline(line.trim())}`; continue; }
      if (stack.length && blank && line.match(/^\s*/u)[0].length > stack.at(-1).indent) { html += `<p>${inline(line.trim())}</p>`; blank = false; continue; }
      closeLists();
      blank = false;
      if (/^\s*\|.*\|\s*$/u.test(line)) { flushPara(); flushQuote(); table.push(line); continue; }
      flushTable();
      const heading = line.match(/^(#{1,6})\s+(.*)$/u);
      if (heading) { flushPara(); flushQuote(); html += `<h4 data-level="${heading[1].length}">${inline(heading[2])}</h4>`; continue; }
      if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/u.test(line)) { flushPara(); flushQuote(); html += '<hr>'; continue; }
      const quoted = line.match(/^\s*>\s?(.*)$/u);
      if (quoted) { flushPara(); quote.push(quoted[1]); continue; }
      flushQuote(); para.push(line);
    }
    if (code) html += `<pre><code>${esc(code.join('\n'))}</code></pre>`;
    flushBlocks();
    return html;
  }

  // The conversation layout follows Paseo's agent stream (Apache-2.0, Copyright
  // (c) 2025-present Mohamed Boudra; see renderer/THIRD_PARTY_NOTICES.md): the request in
  // a right-aligned bubble capped at 240px with "더 보기", the answer as plain
  // Markdown with no bubble, consecutive tool calls in one disclosure row, and a
  // finished turn's work folded into one summary row above its final answer.
  // Ported from packages/app/src/components/message.tsx,
  // components/user-message/index.tsx, agent-stream/spacing.ts,
  // agent-stream/turn-collapse/ and tool-calls/detail-level/overview/.
  const CONTINUED = /^This session is being continued from a previous conversation/u;
  const ICONS = {
    shell: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 10 3 2-3 2M12 15h5"/>',
    read: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m14 6 4 4"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>',
    agent: '<rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 8V4M9 13v2M15 13v2"/>',
    other: '<path d="M14 6.5a4 4 0 0 0 5 5l-8 8a2 2 0 0 1-3-3l8-8z"/>',
    summary: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  };
  const svg = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  const open = new Map();   // id -> disclosure keys the person opened
  const copies = new Map(); // id -> texts behind the copy buttons of the last render
  const isOpen = (id, key) => open.get(id)?.has(key) || false;
  function toggle(id, key) {
    const keys = open.get(id) || new Set();
    if (keys.has(key)) keys.delete(key); else keys.add(key);
    open.set(id, keys);
  }
  function clock(value) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  }
  const fmt = (key, count) => t(key).replace('{n}', String(count));
  // What a tool call did and on what, from its name and recorded input.
  function toolKind(tool) {
    const name = String(tool.title || '').toLowerCase();
    if (/^(bash|shell|exec|exec_command|local_shell|command|run_command|terminal)/u.test(name)) return 'shell';
    if (/^(read|view|cat|notebookread|open_file)/u.test(name)) return 'read';
    if (/^(edit|write|multiedit|apply_patch|notebookedit|str_replace|create_file|update_file)/u.test(name)) return 'edit';
    if (/^(grep|glob|search|websearch|web_search|webfetch|fetch|ls|find|toolsearch|list)/u.test(name)) return 'search';
    if (/^(task|agent|subagent)/u.test(name)) return 'agent';
    return 'other';
  }
  function toolDetail(tool) {
    const text = String(tool.text || '').trim();
    try {
      const value = JSON.parse(text);
      if (value && typeof value === 'object') {
        const pick = ['command', 'file_path', 'path', 'pattern', 'query', 'url', 'description', 'prompt'].map(key => value[key]).find(item => typeof item === 'string' && item.trim());
        return (pick || Object.values(value).find(item => typeof item === 'string') || '').split('\n')[0];
      }
    } catch { /* plain text input */ }
    return text.split('\n')[0];
  }
  // One sentence of what a stretch of work did, as Paseo's overview label.
  function workLabel(tools) {
    const edited = new Set(), read = new Set();
    let commands = 0, searches = 0, other = 0;
    for (const tool of tools) {
      const kind = toolKind(tool);
      if (kind === 'edit') edited.add(toolDetail(tool));
      else if (kind === 'read') read.add(toolDetail(tool));
      else if (kind === 'shell') commands += 1;
      else if (kind === 'search') searches += 1;
      else other += 1;
    }
    return [[edited.size, '파일 {n}개 편집'], [commands, '명령 {n}개 실행'], [read.size, '파일 {n}개 읽음'], [searches, '{n}회 검색'], [other, '기타 도구 {n}개']]
      .filter(([count]) => count > 0).map(([count, key]) => fmt(key, count)).join(' · ');
  }
  function disclosure(key, expanded, icon, label, secondary = '', extra = '') {
    return `<button type="button" class="wb-chat-badge ${extra}" data-chat-toggle="${esc(key)}" aria-expanded="${expanded}"><span class="wb-chat-badge-icon">${svg(icon)}</span><span class="wb-chat-badge-label">${esc(label)}</span>${secondary ? `<span class="wb-chat-badge-detail">${esc(secondary)}</span>` : ''}<span class="wb-chat-badge-chevron">${svg('chevron')}</span></button>`;
  }
  function toolHtml(id, tool) {
    const key = `tool:${tool.id}`, expanded = isOpen(id, key), kind = toolKind(tool);
    return `<div class="wb-chat-work">${disclosure(key, expanded, kind, tool.title || t('도구'), toolDetail(tool))}${expanded ? `<pre class="wb-chat-tool-detail">${esc(tool.text || t('추가 세부 정보가 없어요'))}</pre>` : ''}</div>`;
  }
  // Rows of agent work: consecutive tool calls share one row that opens to each call.
  function rowsHtml(id, rows) {
    const parts = [];
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      if (row.role !== 'tool') { parts.push(`<div class="wb-chat-msg is-ai"><div class="wb-chat-text">${markdown(row.text)}</div></div>`); continue; }
      let end = index;
      while (rows[end + 1]?.role === 'tool') end += 1;
      const group = rows.slice(index, end + 1);
      if (group.length === 1) parts.push(toolHtml(id, row));
      else {
        const key = `group:${row.id}`, expanded = isOpen(id, key);
        parts.push(`<div class="wb-chat-work">${disclosure(key, expanded, toolKind(group.at(-1)), workLabel(group))}${expanded ? `<div class="wb-chat-rail">${group.map(tool => toolHtml(id, tool)).join('')}</div>` : ''}</div>`);
      }
      index = end;
    }
    return parts.join('');
  }
  function copyButton(id, text, label) {
    const list = copies.get(id) || [];
    list.push(text); copies.set(id, list);
    return `<button type="button" class="wb-chat-copy" data-chat-copy="${list.length - 1}" title="${esc(label)}" aria-label="${esc(label)}">${svg('copy')}</button>`;
  }
  function userHtml(id, message) {
    if (CONTINUED.test(message.text)) {
      const key = `summary:${message.id}`, expanded = isOpen(id, key);
      return `<div class="wb-chat-compaction">${disclosure(key, expanded, 'summary', t('이전 대화 요약'))}${expanded ? `<div class="wb-chat-text">${markdown(message.text)}</div>` : ''}</div>`;
    }
    const key = `user:${message.id}`, expanded = isOpen(id, key), time = clock(message.timestamp);
    return `<div class="wb-chat-msg is-user"><div class="wb-chat-bubble"><div class="wb-chat-preview${expanded ? ' is-open' : ''}" data-chat-preview="${esc(key)}"><div class="wb-chat-user-text">${esc(message.text).replace(/\n/gu, '<br>')}</div></div><button type="button" class="wb-chat-more-toggle" data-chat-toggle="${esc(key)}" hidden>${esc(t(expanded ? '접기' : '더 보기'))}</button></div><div class="wb-chat-trailing">${time ? `<time>${esc(time)}</time>` : ''}${copyButton(id, message.text, t('복사'))}</div></div>`;
  }
  // A turn: the request, its work, and the answer. A finished turn folds the work
  // (tool calls and the notes between them) into one row above its last answer.
  function turnHtml(id, turn, live) {
    const parts = [];
    if (turn.user) parts.push(userHtml(id, turn.user));
    const rows = turn.rows;
    let last = -1;
    for (let index = rows.length - 1; index >= 0; index--) if (rows[index].role === 'assistant') { last = index; break; }
    const work = last > 0 ? rows.slice(0, last) : [];
    if (!live && work.some(row => row.role === 'tool')) {
      const key = `turn:${turn.user?.id || rows[0]?.id}`, expanded = isOpen(id, key);
      parts.push(`<div class="wb-chat-work is-turn">${disclosure(key, expanded, 'summary', workLabel(work.filter(row => row.role === 'tool')) || t('작업 자세히 보기'), '', 'is-summary')}${expanded ? `<div class="wb-chat-rail">${rowsHtml(id, work)}</div>` : ''}</div>`);
      parts.push(rowsHtml(id, rows.slice(last)));
    } else parts.push(rowsHtml(id, rows));
    if (!live && last >= 0) {
      const time = clock(rows[last].timestamp);
      parts.push(`<div class="wb-chat-footer">${copyButton(id, rows[last].text, t('답 복사'))}${time ? `<time>${esc(time)}</time>` : ''}</div>`);
    }
    return `<section class="wb-chat-turn">${parts.join('')}</section>`;
  }
  function turnsOf(messages) {
    const turns = [];
    let turn = null;
    for (const message of messages) {
      if (message.role === 'user') { turn = { user: message, rows: [] }; turns.push(turn); continue; }
      if (!turn) { turn = { user: null, rows: [] }; turns.push(turn); }
      // The same words again in one turn are a repeated record, not a new answer.
      if (message.role === 'assistant' && turn.rows.some(row => row.role === 'assistant' && row.text === message.text)) continue;
      turn.rows.push(message);
    }
    return turns;
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
      copies.set(id, []);
      const working = Boolean(view.working || member(id)?.activity?.state === 'working');
      const turns = turnsOf(view.messages);
      turns.forEach((turn, index) => parts.push(turnHtml(id, turn, working && index === turns.length - 1)));
    }
    for (const item of queues.get(id) || []) {
      const status = item.state === 'sending' ? t('보내는 중…')
        : item.state === 'sent' ? t('보냈어요')
          : item.state === 'failed' ? `${t('보내지 못했어요')} · ${item.error || ''}`
            : t(WAIT[item.reason] || '보낼 차례를 기다려요');
      const actions = item.state === 'failed' ? `<button type="button" data-chat-retry="${esc(item.id)}">${esc(t('다시 보내기'))}</button><button type="button" data-chat-discard="${esc(item.id)}">${esc(t('지우기'))}</button>`
        : item.state === 'queued' ? `<button type="button" data-chat-discard="${esc(item.id)}">${esc(t('취소'))}</button>` : '';
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
    node.innerHTML = `<div class="wb-chat-log" role="log" aria-live="polite" tabindex="0"></div><div class="wb-chat-notice" hidden></div><form class="wb-chat-composer"><textarea rows="2" aria-label="${esc(t('AI에게 보낼 메시지'))}" placeholder="${esc(t('AI에게 보낼 메시지 · Enter로 보내기, Shift+Enter 줄바꿈'))}"></textarea><button type="submit" class="wb-chat-send">${esc(t('보내기'))}</button></form>`;
    pane.node.querySelector('.wb-terminal-mount').after(node);
    const input = node.querySelector('textarea');
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); submit(id, input); }
    });
    node.querySelector('form').addEventListener('submit', event => { event.preventDefault(); submit(id, input); });
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
      log.innerHTML = `<div class="wb-chat-column">${html}</div>`; node.dataset.html = html;
      // A request taller than the preview shows a fade and "더 보기" (Paseo's MessagePreview).
      for (const preview of log.querySelectorAll('[data-chat-preview]')) {
        const more = preview.scrollHeight > 241 || preview.classList.contains('is-open') && preview.scrollHeight > 240;
        preview.classList.toggle('has-more', more);
        preview.nextElementSibling.hidden = !more;
      }
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
