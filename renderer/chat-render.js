'use strict';
// Conversation rendering shared by the desktop chat panes
// (renderer/terminal-chat.js) and the phone page (renderer/phone/phone.js):
// escaped Markdown, the request bubble, work rows and turns. Pure string
// building; the caller supplies t() and esc() and owns the DOM.
(function exposeChatRender(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  if (root) root.WhiteboxChatRender = factory;
})(typeof window !== 'undefined' ? window : globalThis, function createChatRender({ t, esc }) {
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
  // Laid out like a messenger: the request on the right, the AI's work and
  // answer in one bubble on the left under the AI's name.
  function turnHtml(id, turn, live, sender = '') {
    const user = turn.user ? userHtml(id, turn.user) : '';
    const rows = turn.rows;
    if (!rows.length) return `<section class="wb-chat-turn">${user}</section>`;
    const parts = [];
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
    const name = sender ? `<div class="wb-chat-sender">${esc(sender)}</div>` : '';
    return `<section class="wb-chat-turn">${user}<div class="wb-chat-ai">${name}<div class="wb-chat-ai-bubble">${parts.join('')}</div></div></section>`;
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

  // The "/" list of a composer (the one DOM helper here): typing "/" (or "$"
  // for a Codex skill) at the start of the message lists the AI's commands and
  // skills; arrows move, Tab or Enter picks, Esc closes. `load()` resolves the
  // catalog items { name, description, source, insert }.
  const SOURCE = { builtin: '기본 명령', skill: '스킬', plugin: '플러그인', user: '내 명령', project: '프로젝트 명령' };
  function slashMenu({ input, box, load }) {
    let items = [], index = 0, token = 0;
    const query = () => {
      const match = input.value.slice(0, input.selectionStart ?? input.value.length).match(/^\s*([/$])([\w.:-]*)$/u);
      return match ? match[2].toLowerCase() : null;
    };
    function close() { token += 1; items = []; box.hidden = true; box.innerHTML = ''; }
    function draw() {
      box.hidden = false;
      box.innerHTML = items.length ? items.map((item, n) => `<button type="button" role="option" aria-selected="${n === index}" data-slash="${n}"><b>${esc(item.insert)}</b><span>${esc(item.description)}</span><small>${esc(t(SOURCE[item.source] || ''))}</small></button>`).join('')
        : `<p>${esc(t('맞는 명령이나 스킬이 없어요'))}</p>`;
      box.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
    }
    async function update() {
      const q = query();
      if (q === null) { close(); return; }
      const mine = ++token;
      let all = [];
      try { all = await load(); } catch { all = []; }
      if (mine !== token || query() !== q) return;
      const key = item => `${item.name} ${item.insert}`.toLowerCase();
      items = [...all.filter(item => item.name.toLowerCase().startsWith(q) || item.insert.slice(1).toLowerCase().startsWith(q)),
        ...all.filter(item => !(item.name.toLowerCase().startsWith(q) || item.insert.slice(1).toLowerCase().startsWith(q))
          && (key(item).includes(q) || String(item.description || '').toLowerCase().includes(q)))].slice(0, 80);
      index = 0; draw();
    }
    function pick(n) {
      const item = items[n];
      if (!item) return;
      const rest = input.value.slice(input.selectionStart ?? input.value.length).replace(/^\S*/u, '').trimStart();
      input.value = `${item.insert} ${rest}`;
      const caret = item.insert.length + 1;
      input.setSelectionRange?.(caret, caret);
      close(); input.focus();
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    input.addEventListener('input', update);
    input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== input) close(); }, 150));
    box.addEventListener('mousedown', event => event.preventDefault());
    box.addEventListener('click', event => { const button = event.target.closest('[data-slash]'); if (button) pick(Number(button.dataset.slash)); });
    return {
      open: () => !box.hidden,
      close,
      // Call first from the composer's keydown; true when the list used the key.
      keydown(event) {
        if (box.hidden || event.isComposing || event.keyCode === 229) return false;
        if (event.key === 'Escape') { event.preventDefault(); close(); return true; }
        if (!items.length) return false;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          index = (index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length; draw(); return true;
        }
        if ((event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey) || event.key === 'Tab') { event.preventDefault(); pick(index); return true; }
        return false;
      },
    };
  }

  return { markdown, inline, svg, isOpen, toggle, copies, workLabel, toolDetail, toolKind, rowsHtml, userHtml, turnHtml, turnsOf, slashMenu };
});
