// Whitebox phone page: every Claude and Codex terminal as a conversation.
// The conversation is drawn by renderer/chat-render.js, the same code as the
// desktop chat panes. There is no terminal view: a message goes through the
// guarded chat send (it waits while the AI works), and an AI's question is
// shown as the screen's own words with a few keys to answer it.
const token = document.querySelector('meta[name="wb-token"]').content;
const $ = selector => document.querySelector(selector);
const POLL_MS = 1500;

const lang = (navigator.language || 'ko').toLowerCase();
const LANG = lang.startsWith('ko') ? 'ko' : lang.startsWith('zh') ? 'zh' : 'en';
document.documentElement.lang = LANG === 'zh' ? 'zh-CN' : LANG;
// Keyed by the Korean text, like the desktop's translations.
const STRINGS = {
  '작업 중': ['Working', '工作中'],
  '답을 기다림': ['Waiting for you', '等待回复'],
  '끝남': ['Done', '完成'],
  '쉬는 중': ['Idle', '空闲'],
  '열린 Claude·Codex 터미널이 없어요.': ['No Claude or Codex terminals are open.', '没有打开的 Claude 或 Codex 终端。'],
  '컴퓨터의 Whitebox 화면이 준비되지 않았어요. 앱이 켜져 있는지 확인하세요.': ['Whitebox on the computer is not ready. Check that the app is open.', '电脑上的 Whitebox 尚未就绪，请确认应用已打开。'],
  '컴퓨터에 연결할 수 없어요. Whitebox와 Tailscale이 켜져 있는지 확인하세요. 다시 시도하는 중…': ['Cannot reach the computer. Check that Whitebox and Tailscale are on. Retrying…', '无法连接电脑。请确认 Whitebox 和 Tailscale 已打开。正在重试…'],
  '앱으로 설치': ['Install app', '安装应用'],
  '공유 버튼 › 홈 화면에 추가를 누르면 앱처럼 쓸 수 있어요.': ['Tap Share › Add to Home Screen to use this as an app.', '点按“共享” › “添加到主屏幕”即可像应用一样使用。'],
  '컴퓨터의 Whitebox 설정 › 원격에서 HTTPS를 켜면 앱으로 설치할 수 있어요.': ['Turn on HTTPS in Whitebox Settings › Remote on the computer to install this as an app.', '在电脑上的 Whitebox 设置 › 远程 中开启 HTTPS 后即可安装为应用。'],
  '보내기': ['Send', '发送'],
  'AI에게 보낼 메시지': ['Message to the AI', '发给 AI 的消息'],
  '멈추기': ['Stop', '停止'],
  '지금 작업을 멈출까요?': ['Stop the current work?', '要停止当前工作吗？'],
  '취소': ['Cancel', '取消'],
  'AI가 답을 기다려요. 화면 내용을 보고 키를 눌러 답하세요.': ['The AI is waiting for you. Read the screen below and answer with a key.', 'AI 正在等待回复。请查看下方画面并按键回答。'],
  'AI가 꺼져 있어요. 지난 대화만 볼 수 있어요.': ['The AI is not running. Only the earlier conversation is shown.', 'AI 未运行，只能查看之前的对话。'],
  '대화를 불러오는 중…': ['Loading the conversation…', '正在加载对话…'],
  '이 터미널의 대화 기록을 아직 찾지 못했어요.': ["This terminal's conversation log was not found yet.", '尚未找到此终端的对话记录。'],
  '아직 대화가 없어요. 아래에 첫 요청을 써 보세요.': ['No conversation yet. Write the first request below.', '还没有对话。请在下方写下第一个请求。'],
  '더 이전 대화는 컴퓨터에서 볼 수 있어요.': ['Earlier conversation is on the computer.', '更早的对话请在电脑上查看。'],
  '앞 작업이 끝나면 보낼게요': ['Sends when the current work finishes', '当前工作结束后发送'],
  '쓰던 글이 입력창에 있어서 기다려요': ['Waiting: the AI input has unsent text', '等待中：输入框中有未发送的文字'],
  'AI의 질문에 먼저 답해 주세요': ["Answer the AI's question first", '请先回答 AI 的问题'],
  '터미널 상태를 확인하는 중이에요': ['Checking the terminal', '正在确认终端状态'],
  '보낼 차례를 기다려요': ['Waiting to send', '等待发送'],
  '보내는 중…': ['Sending…', '正在发送…'],
  '보냈어요': ['Sent', '已发送'],
  '보내지 못했어요': ['Not sent', '未能发送'],
  '다시 보내기': ['Send again', '重新发送'],
  '지우기': ['Remove', '删除'],
  'AI 세션이 바뀌어서 보내지 않았어요.': ['Not sent: the AI session changed.', '未发送：AI 会话已更改。'],
  '메시지가 너무 길어요. 8000자 이하로 나눠 보내 주세요.': ['The message is too long. Send at most 8000 characters at a time.', '消息太长，请分成 8000 字以内发送。'],
  '멈추지 못했어요': ['Could not stop', '未能停止'],
  '키를 보내지 못했어요': ['Could not send the key', '未能发送按键'],
  // chat-render.js
  '파일 {n}개 편집': ['Files edited: {n}', '编辑了 {n} 个文件'],
  '명령 {n}개 실행': ['Commands run: {n}', '运行了 {n} 条命令'],
  '파일 {n}개 읽음': ['Files read: {n}', '读取了 {n} 个文件'],
  '{n}회 검색': ['Searches: {n}', '搜索了 {n} 次'],
  '기타 도구 {n}개': ['Other tools: {n}', '其他工具 {n} 个'],
  '도구': ['Tool', '工具'],
  '추가 세부 정보가 없어요': ['No further details', '没有更多详情'],
  '이전 대화 요약': ['Earlier conversation summary', '之前的对话摘要'],
  '접기': ['Collapse', '收起'],
  '더 보기': ['Show more', '显示更多'],
  '복사': ['Copy', '复制'],
  '작업 자세히 보기': ['Show the work', '查看工作详情'],
  '답 복사': ['Copy answer', '复制回答'],
};
const t = key => LANG === 'ko' ? key : (STRINGS[key]?.[LANG === 'en' ? 0 : 1] ?? key);
const esc = value => String(value ?? '').replace(/[&<>"']/gu, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const render = window.WhiteboxChatRender({ t, esc });

function stateOf(terminal) {
  const state = String(terminal.state || '');
  if (state === 'working' || state === 'running') return { kind: 'working', label: t('작업 중') };
  if (/wait|input|question|permission|needs/.test(state)) return { kind: 'waiting', label: t('답을 기다림') };
  if (state === 'completed' || state === 'done') return { kind: 'done', label: t('끝남') };
  return { kind: 'idle', label: t('쉬는 중') };
}

async function api(path, body) {
  // A computer that is off does not answer at all over Tailscale; give up and retry instead of hanging.
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'x-whitebox-token': token, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
    signal: AbortSignal.timeout?.(10000)
  });
  const value = await response.json().catch(() => ({}));
  // The page was kept on the phone while Whitebox restarted with a new token: load the current page once.
  if (response.status === 401) reloadOnce();
  if (!response.ok) throw new Error(value.error || String(response.status));
  return value;
}
function reloadOnce() {
  let last = 0;
  try { last = Number(sessionStorage.getItem('wb-reloaded')) || 0; } catch {}
  if (Date.now() - last < 30000) return;
  try { sessionStorage.setItem('wb-reloaded', String(Date.now())); } catch {}
  location.reload();
}

// --- List: Claude and Codex terminals only.
let listTimer = 0, listLoading = false;
function notice(text) { const element = $('#notice'); element.textContent = text || ''; element.hidden = !text; }
async function loadList() {
  if (listLoading) return;
  listLoading = true;
  try {
    const { panels } = await api('/api/list');
    notice('');
    renderList(panels || []);
  } catch (error) {
    notice(/not ready/i.test(error.message) ? t('컴퓨터의 Whitebox 화면이 준비되지 않았어요. 앱이 켜져 있는지 확인하세요.') : t('컴퓨터에 연결할 수 없어요. Whitebox와 Tailscale이 켜져 있는지 확인하세요. 다시 시도하는 중…'));
  } finally { listLoading = false; }
}
function renderList(panels) {
  const root = $('#panels');
  root.replaceChildren();
  if (!panels.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = t('열린 Claude·Codex 터미널이 없어요.'); root.append(empty); return; }
  for (const panel of panels) {
    const section = document.createElement('section');
    section.className = 'panel';
    const heading = document.createElement('h2');
    heading.textContent = panel.name || 'Panel';
    section.append(heading);
    for (const terminal of panel.terminals) {
      const state = stateOf(terminal);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'row';
      row.dataset.surface = terminal.id;
      const dot = document.createElement('span');
      dot.className = `dot ${state.kind}`;
      const name = document.createElement('span');
      name.className = 'name';
      const title = document.createElement('strong');
      title.textContent = terminal.title || terminal.provider || terminal.id;
      const meta = document.createElement('span');
      meta.textContent = [terminal.provider === 'codex' ? 'Codex' : 'Claude', state.label].join(' · ');
      name.append(title, meta);
      const chev = document.createElement('span');
      chev.className = 'chev';
      chev.textContent = '›';
      row.append(dot, name, chev);
      row.addEventListener('click', () => openChat({ id: terminal.id, panelId: panel.id, panel: panel.name, title: title.textContent, provider: terminal.provider }));
      section.append(row);
    }
    root.append(section);
  }
}
function showList() {
  closeChat();
  $('#chat').hidden = true;
  $('#list').hidden = false;
  loadList();
  clearInterval(listTimer);
  listTimer = setInterval(loadList, 3000);
  if (location.hash) history.replaceState(null, '', location.pathname);
}

// --- Chat
let current = null, view = null, pollTimer = 0, polling = false, flushing = false, queue = [], lastHtml = '', pinned = true;
const WAIT = { working: '앞 작업이 끝나면 보낼게요', previous: '앞 작업이 끝나면 보낼게요', draft: '쓰던 글이 입력창에 있어서 기다려요',
  prompt: 'AI의 질문에 먼저 답해 주세요', screen: '터미널 상태를 확인하는 중이에요', connection: '터미널 상태를 확인하는 중이에요' };
// crypto.randomUUID needs a secure context; the page is plain http until the tailnet has HTTPS.
function uuid() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
const same = (a, b) => String(a || '').replace(/\s+/gu, ' ').trim() === String(b || '').replace(/\s+/gu, ' ').trim();

function openChat(target) {
  clearInterval(listTimer);
  current = target; view = null; queue = []; lastHtml = ''; pinned = true;
  $('#list').hidden = true;
  $('#chat').hidden = false;
  $('#chatTitle').textContent = target.title;
  $('#chatMeta').textContent = [target.panel, target.provider === 'codex' ? 'Codex' : 'Claude'].filter(Boolean).join(' · ');
  $('#log').innerHTML = `<div class="wb-chat-column"><p class="wb-chat-empty">${esc(t('대화를 불러오는 중…'))}</p></div>`;
  $('#question').hidden = true; $('#off').hidden = true; $('#stopConfirm').hidden = true; $('#stop').hidden = true;
  setOff(false);
  if (location.hash !== '#c') history.pushState(null, '', '#c');
  poll();
  clearInterval(pollTimer);
  pollTimer = setInterval(poll, POLL_MS);
}
function closeChat() { clearInterval(pollTimer); current = null; view = null; queue = []; }

async function poll() {
  const target = current;
  if (!target || polling || document.hidden) return;
  polling = true;
  try {
    const query = new URLSearchParams({ surface_id: target.id, revision: view?.revision || '' });
    const result = await api(`/api/chat?${query}`);
    if (current !== target) return;
    if (!result.available) {
      // The AI exited or the terminal closed: keep what was read, read-only.
      view = { ...(view || { messages: [] }), off: true, working: false, state: '', question: '',
        error: view?.messages?.length ? '' : t('이 터미널의 대화 기록을 아직 찾지 못했어요.') };
    } else {
      const base = { off: false, error: '', working: result.working || result.state === 'working', state: result.state, question: result.question || '',
        creationId: result.creationId, provider: result.provider, providerPid: result.providerPid, revision: result.revision };
      view = result.unchanged && view ? { ...view, ...base } : { ...base, messages: result.messages || [], truncated: result.truncated };
    }
    // A sent message leaves the queue once the conversation shows it.
    const users = (view.messages || []).filter(message => message.role === 'user');
    queue = queue.filter(item => !(item.state === 'sent' && (users.some(message => same(message.text, item.text) && Date.parse(message.timestamp) >= item.at - 5000) || Date.now() - item.sentAt > 120000)));
  } catch (error) {
    if (current === target) view = { ...(view || { messages: [] }), error: view?.messages?.length ? '' : String(error.message || error) };
  } finally {
    polling = false;
  }
  if (current === target) { draw(); flush(); }
}

function logHtml() {
  const parts = [];
  if (!view) parts.push(`<p class="wb-chat-empty">${esc(t('대화를 불러오는 중…'))}</p>`);
  else if (view.error) parts.push(`<p class="wb-chat-empty">${esc(view.error)}</p>`);
  else {
    if (view.truncated) parts.push(`<p class="wb-chat-more">${esc(t('더 이전 대화는 컴퓨터에서 볼 수 있어요.'))}</p>`);
    if (!view.messages.length) parts.push(`<p class="wb-chat-empty">${esc(t('아직 대화가 없어요. 아래에 첫 요청을 써 보세요.'))}</p>`);
    render.copies.set(current.id, []);
    const turns = render.turnsOf(view.messages);
    turns.forEach((turn, index) => parts.push(render.turnHtml(current.id, turn, view.working && index === turns.length - 1)));
  }
  for (const item of queue) {
    const status = item.state === 'sending' ? t('보내는 중…') : item.state === 'sent' ? t('보냈어요')
      : item.state === 'failed' ? `${t('보내지 못했어요')} · ${item.error || ''}` : t(WAIT[item.reason] || '보낼 차례를 기다려요');
    const actions = item.state === 'failed' ? `<button type="button" data-retry="${esc(item.id)}">${esc(t('다시 보내기'))}</button><button type="button" data-discard="${esc(item.id)}">${esc(t('지우기'))}</button>`
      : item.state === 'queued' ? `<button type="button" data-discard="${esc(item.id)}">${esc(t('취소'))}</button>` : '';
    parts.push(`<div class="wb-chat-msg is-user is-pending" data-state="${esc(item.state)}"><div class="wb-chat-bubble"><div class="wb-chat-user-text">${esc(item.text).replace(/\n/gu, '<br>')}</div></div><div class="wb-chat-status">${esc(status)}${actions}</div></div>`);
  }
  if (view?.working) parts.push(`<div class="wb-chat-working"><i aria-hidden="true"></i>${esc(t('작업 중'))}</div>`);
  return `<div class="wb-chat-column">${parts.join('')}</div>`;
}

function draw() {
  if (!current) return;
  const log = $('#log'), html = logHtml();
  if (html !== lastHtml) {
    log.innerHTML = html; lastHtml = html;
    for (const preview of log.querySelectorAll('[data-chat-preview]')) {
      const more = preview.scrollHeight > 241 || preview.classList.contains('is-open') && preview.scrollHeight > 240;
      preview.classList.toggle('has-more', more);
      preview.nextElementSibling.hidden = !more;
    }
    if (pinned) log.scrollTop = log.scrollHeight;
  }
  const state = view?.off ? { kind: 'idle' } : stateOf({ state: view?.working ? 'working' : view?.state });
  $('#chatState').className = `dot ${state.kind}`;
  const question = $('#question');
  question.hidden = !(view && !view.off && view.state === 'waiting' && view.question);
  if (!question.hidden) {
    question.querySelector('strong').textContent = t('AI가 답을 기다려요. 화면 내용을 보고 키를 눌러 답하세요.');
    const pre = question.querySelector('pre');
    if (pre.textContent !== view.question) { pre.textContent = view.question; pre.scrollTop = pre.scrollHeight; }
  }
  $('#stop').hidden = !(view?.working && !view.off);
  if ($('#stop').hidden) $('#stopConfirm').hidden = true;
  setOff(Boolean(view?.off));
}
let flash = { text: '', until: 0 };
function setOff(off) {
  const line = $('#off'), text = off ? t('AI가 꺼져 있어요. 지난 대화만 볼 수 있어요.') : Date.now() < flash.until ? flash.text : '';
  line.hidden = !text; line.textContent = text;
  $('#text').disabled = off; $('#send').disabled = off;
}

function submit() {
  const box = $('#text'), text = box.value.replace(/[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]/gu, '').trim();
  if (!text || !current || !view || view.off || !view.providerPid) return;
  if (text.length > 8000) { alertLine(t('메시지가 너무 길어요. 8000자 이하로 나눠 보내 주세요.')); return; }
  queue.push({ id: uuid(), text, state: 'queued', reason: '', at: Date.now(),
    target: { panel_id: current.panelId, surface_id: current.id, creation_id: view.creationId, provider_pid: view.providerPid, provider: view.provider } });
  box.value = ''; box.style.height = '';
  pinned = true; draw(); flush();
}
async function flush() {
  const item = queue.find(entry => entry.state === 'queued');
  if (!item || flushing || !view || view.off) return;
  if (view.creationId !== item.target.creation_id || view.providerPid !== item.target.provider_pid) {
    Object.assign(item, { state: 'failed', error: t('AI 세션이 바뀌어서 보내지 않았어요.') }); draw(); return;
  }
  if (queue.some(entry => entry.state === 'sending')) return;
  flushing = true; item.state = 'sending'; draw();
  try {
    const result = await api('/api/chat/send', { id: item.id, text: item.text, ...item.target });
    if (result?.deferred) Object.assign(item, { state: 'queued', reason: result.reason });
    else if (result?.ok) Object.assign(item, { state: 'sent', sentAt: Date.now() });
    else Object.assign(item, { state: 'failed', error: result?.job?.error || '' });
  } catch (error) {
    Object.assign(item, { state: 'failed', error: String(error.message || error) });
  } finally {
    flushing = false; draw();
  }
}
// A short line above the composer for an error that has no message bubble.
function alertLine(text) { flash = { text, until: Date.now() + 5000 }; setOff(Boolean(view?.off)); setTimeout(() => setOff(Boolean(view?.off)), 5100); }

function copy(text) {
  // http pages have no clipboard API; a selected textarea still copies.
  const area = document.createElement('textarea');
  area.value = text; area.setAttribute('readonly', ''); area.style.position = 'fixed'; area.style.opacity = '0';
  document.body.append(area); area.select();
  try { document.execCommand('copy'); } catch {}
  area.remove();
}

$('#log').addEventListener('scroll', () => { const log = $('#log'); if (log.clientHeight) pinned = log.scrollHeight - log.scrollTop - log.clientHeight < 48; }, { passive: true });
$('#log').addEventListener('click', event => {
  const link = event.target.closest('a[data-chat-link]');
  if (link) { event.preventDefault(); if (/^https:\/\//u.test(link.href)) window.open(link.href, '_blank', 'noopener'); return; }
  const button = event.target.closest('button');
  if (!button || !current) return;
  if (button.dataset.chatToggle) { render.toggle(current.id, button.dataset.chatToggle); lastHtml = ''; draw(); return; }
  if (button.dataset.chatCopy !== undefined) {
    const text = render.copies.get(current.id)?.[Number(button.dataset.chatCopy)];
    if (typeof text === 'string') { copy(text); button.dataset.copied = 'true'; setTimeout(() => delete button.dataset.copied, 1200); }
    return;
  }
  if (button.dataset.retry) {
    const item = queue.find(entry => entry.id === button.dataset.retry);
    if (item && view && !view.off) {
      Object.assign(item, { id: uuid(), state: 'queued', reason: '', error: '',
        target: { ...item.target, creation_id: view.creationId, provider_pid: view.providerPid, provider: view.provider } });
      draw(); flush();
    }
  }
  if (button.dataset.discard) { queue = queue.filter(entry => entry.id !== button.dataset.discard); draw(); }
});
$('#question').addEventListener('click', async event => {
  const button = event.target.closest('button[data-key]');
  if (!button || !current) return;
  button.disabled = true;
  try { await api('/api/key', { surface_id: current.id, key: button.dataset.key }); setTimeout(poll, 300); }
  catch (error) { alertLine(`${t('키를 보내지 못했어요')}: ${error.message}`); }
  finally { button.disabled = false; }
});
$('#stop').textContent = t('멈추기');
$('#stop').addEventListener('click', () => { $('#stopConfirm').hidden = false; });
$('#stopConfirm span').textContent = t('지금 작업을 멈출까요?');
$('#stopConfirm [data-stop=yes]').textContent = t('멈추기');
$('#stopConfirm [data-stop=no]').textContent = t('취소');
$('#stopConfirm').addEventListener('click', async event => {
  const button = event.target.closest('button[data-stop]');
  if (!button) return;
  $('#stopConfirm').hidden = true;
  if (button.dataset.stop !== 'yes' || !current || !view) return;
  try { await api('/api/chat/stop', { panel_id: current.panelId, surface_id: current.id, creation_id: view.creationId, provider_pid: view.providerPid, provider: view.provider }); setTimeout(poll, 300); }
  catch (error) { alertLine(`${t('멈추지 못했어요')}: ${error.message}`); }
});

$('#back').addEventListener('click', () => history.length > 1 && location.hash === '#c' ? history.back() : showList());
window.addEventListener('popstate', () => { if (location.hash !== '#c') showList(); });
$('#send').textContent = t('보내기');
$('#text').placeholder = t('AI에게 보낼 메시지');
$('#text').setAttribute('aria-label', t('AI에게 보낼 메시지'));
$('#text').addEventListener('input', event => { event.target.style.height = 'auto'; event.target.style.height = `${Math.min(140, event.target.scrollHeight)}px`; });
$('#compose').addEventListener('submit', event => { event.preventDefault(); submit(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) return; if (current) poll(); else loadList(); });

showList();

// --- Installing as an app. Needs https (a secure context) for the service worker.
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let installPrompt = null;
function hint(text) { $('#installHint').textContent = text || ''; $('#installHint').hidden = !text; }
if (isSecureContext && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
if (!standalone) {
  if (!isSecureContext) hint(t('컴퓨터의 Whitebox 설정 › 원격에서 HTTPS를 켜면 앱으로 설치할 수 있어요.'));
  else if (ios) hint(t('공유 버튼 › 홈 화면에 추가를 누르면 앱처럼 쓸 수 있어요.'));
}
$('#install').textContent = t('앱으로 설치');
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; $('#install').hidden = false; });
window.addEventListener('appinstalled', () => { installPrompt = null; $('#install').hidden = true; hint(''); });
$('#install').addEventListener('click', async () => {
  if (!installPrompt) return;
  const prompt = installPrompt;
  installPrompt = null;
  $('#install').hidden = true;
  try { await prompt.prompt(); } catch {}
});
