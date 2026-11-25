// Whitebox phone page: every panel's terminals, and one terminal live.
const token = document.querySelector('meta[name="wb-token"]').content;
const $ = selector => document.querySelector(selector);

const STRINGS = {
  ko: { working: '작업 중', waiting: '답을 기다림', done: '끝남', idle: '쉬는 중', stopped: '꺼짐', empty: '열린 터미널이 없어요.',
    notReady: '컴퓨터의 Whitebox 화면이 준비되지 않았어요. 앱이 켜져 있는지 확인하세요.', offline: '컴퓨터에 연결할 수 없어요. 다시 시도하는 중…',
    send: '보내기', placeholder: '보낼 글 (한글은 여기서)', ended: '연결이 끊겼어요.', reconnect: '다시 연결', sendFailed: '보내지 못했어요' },
  en: { working: 'Working', waiting: 'Waiting for you', done: 'Done', idle: 'Idle', stopped: 'Stopped', empty: 'No open terminals.',
    notReady: 'Whitebox on the computer is not ready. Check that the app is open.', offline: 'Cannot reach the computer. Retrying…',
    send: 'Send', placeholder: 'Message to send', ended: 'Disconnected.', reconnect: 'Reconnect', sendFailed: 'Could not send' },
  zh: { working: '工作中', waiting: '等待回复', done: '完成', idle: '空闲', stopped: '已停止', empty: '没有打开的终端。',
    notReady: '电脑上的 Whitebox 尚未就绪，请确认应用已打开。', offline: '无法连接电脑，正在重试…',
    send: '发送', placeholder: '要发送的内容', ended: '连接已断开。', reconnect: '重新连接', sendFailed: '发送失败' }
};
const lang = (navigator.language || 'ko').toLowerCase();
const t = STRINGS[lang.startsWith('ko') ? 'ko' : lang.startsWith('zh') ? 'zh' : 'en'];
document.documentElement.lang = lang.startsWith('ko') ? 'ko' : lang.startsWith('zh') ? 'zh-CN' : 'en';

const KEYS = { esc: '\x1b', tab: '\t', up: '\x1b[A', down: '\x1b[B', right: '\x1b[C', left: '\x1b[D', 'ctrl-c': '\x03', enter: '\r' };

function stateOf(terminal) {
  if (!terminal.running) return { kind: 'idle', label: t.stopped };
  const state = String(terminal.state || '');
  if (state === 'working' || state === 'running') return { kind: 'working', label: t.working };
  if (/wait|input|question|permission|needs/.test(state)) return { kind: 'waiting', label: t.waiting };
  if (state === 'completed' || state === 'done') return { kind: 'done', label: t.done };
  return { kind: 'idle', label: t.idle };
}

async function api(path, body) {
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'x-whitebox-token': token, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store'
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value.error || String(response.status));
  return value;
}

// --- List
let listTimer = 0;
function notice(text) { const element = $('#notice'); element.textContent = text || ''; element.hidden = !text; }
async function loadList() {
  try {
    const { panels } = await api('/api/list');
    notice('');
    renderList(panels || []);
  } catch (error) {
    notice(/not ready/i.test(error.message) ? t.notReady : t.offline);
  }
}
function renderList(panels) {
  const root = $('#panels');
  root.replaceChildren();
  const visible = panels.filter(panel => panel.terminals.length);
  if (!visible.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = t.empty; root.append(empty); return; }
  for (const panel of visible) {
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
      row.disabled = !terminal.running;
      const dot = document.createElement('span');
      dot.className = `dot ${state.kind}`;
      const name = document.createElement('span');
      name.className = 'name';
      const title = document.createElement('strong');
      title.textContent = terminal.title || terminal.provider || terminal.id;
      const meta = document.createElement('span');
      meta.textContent = [terminal.provider, state.label].filter(Boolean).join(' · ');
      name.append(title, meta);
      const chev = document.createElement('span');
      chev.className = 'chev';
      chev.textContent = '›';
      row.append(dot, name, chev);
      row.addEventListener('click', () => openTerminal({ id: terminal.id, title: title.textContent, panel: panel.name, provider: terminal.provider, state }));
      section.append(row);
    }
    root.append(section);
  }
}
function showList() {
  closeTerminal();
  $('#terminal').hidden = true;
  $('#list').hidden = false;
  loadList();
  clearInterval(listTimer);
  listTimer = setInterval(loadList, 3000);
  if (location.hash) history.replaceState(null, '', location.pathname);
}

// --- Terminal
let engine = null, term = null, fit = null, socket = null, current = null, ctrl = false, resizeTimer = 0;
async function loadEngine() {
  if (!engine) {
    const module = await import('/engine/ghostty-web.es.js');
    engine = { module, ghostty: await module.Ghostty.load() };
  }
  return engine;
}
function setCtrl(on) { ctrl = on; $('[data-mod="ctrl"]').classList.toggle('on', on); }
function input(data) {
  if (ctrl && data.length === 1) {
    const code = data.toUpperCase().charCodeAt(0);
    if (code >= 64 && code <= 95) data = String.fromCharCode(code & 0x1f);
    setCtrl(false);
  }
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'input', data }));
}
function size() {
  const proposed = fit?.proposeDimensions?.();
  return { cols: Math.max(20, Math.min(500, proposed?.cols || 60)), rows: Math.max(5, Math.min(200, proposed?.rows || 24)) };
}
function ended(reason) {
  const box = $('#ended');
  box.querySelector('span').textContent = reason ? `${t.ended} ${reason}` : t.ended;
  box.hidden = false;
}
async function openTerminal(target) {
  clearInterval(listTimer);
  current = target;
  $('#list').hidden = true;
  $('#terminal').hidden = false;
  $('#termTitle').textContent = target.title;
  $('#termMeta').textContent = [target.panel, target.provider].filter(Boolean).join(' · ');
  $('#termState').className = `dot ${target.state.kind}`;
  $('#ended').hidden = true;
  if (location.hash !== '#t') history.pushState(null, '', '#t');
  const { module, ghostty } = await loadEngine();
  if (current !== target) return;
  const screen = $('#screen');
  screen.replaceChildren();
  term = new module.Terminal({ ghostty, fontSize: 13, cursorBlink: true, focusOnOpen: false, emitTerminalResponses: false,
    theme: { background: '#0c0d0e', foreground: '#e8e9eb' } });
  fit = new module.FitAddon();
  term.loadAddon(fit);
  term.open(screen);
  fit.fit();
  term.onData(input);
  connect(target);
}
function connect(target) {
  const { cols, rows } = size();
  const query = new URLSearchParams({ surface_id: target.id, cols, rows, t: token });
  const ws = new WebSocket(`ws://${location.host}/api/attach?${query}`);
  socket = ws;
  ws.onmessage = event => {
    if (socket !== ws) return;
    let frame; try { frame = JSON.parse(event.data); } catch { return; }
    if (frame.type === 'paint' || frame.type === 'output') term?.write(frame.data);
    else if (frame.type === 'end') ended(frame.reason);
  };
  ws.onclose = () => { if (socket === ws) ended(''); };
}
function closeTerminal() {
  const ws = socket;
  socket = null;
  current = null;
  if (ws) { try { ws.send(JSON.stringify({ type: 'detach' })); } catch {} ws.close(); }
  try { term?.dispose(); } catch {}
  term = null; fit = null;
  setCtrl(false);
}
function refit() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!term || !fit) return;
    fit.fit();
    const { cols, rows } = size();
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'resize', cols, rows }));
  }, 120);
}

$('#back').addEventListener('click', () => history.length > 1 && location.hash === '#t' ? history.back() : showList());
window.addEventListener('popstate', () => { if (location.hash !== '#t') showList(); });
$('#reconnect').textContent = t.reconnect;
$('#reconnect').addEventListener('click', () => { if (current) { $('#ended').hidden = true; term?.reset?.(); connect(current); } });
$('#keys').addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.mod === 'ctrl') { setCtrl(!ctrl); return; }
  input(KEYS[button.dataset.key] || '');
});
// Touching the screen makes this phone the active viewer (the terminal takes
// the phone's size until the computer is used again).
$('#screen').addEventListener('pointerdown', () => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'focus' })); });
$('#send').textContent = t.send;
$('#text').placeholder = t.placeholder;
$('#text').addEventListener('input', event => { event.target.style.height = 'auto'; event.target.style.height = `${Math.min(120, event.target.scrollHeight)}px`; });
$('#compose').addEventListener('submit', async event => {
  event.preventDefault();
  const box = $('#text'), text = box.value.trim();
  if (!text || !current) return;
  $('#send').disabled = true;
  try { await api('/api/send', { surface_id: current.id, text }); box.value = ''; box.style.height = ''; }
  catch (error) { ended(`${t.sendFailed}: ${error.message}`); }
  finally { $('#send').disabled = false; }
});
window.addEventListener('resize', refit);
window.visualViewport?.addEventListener('resize', refit);
document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('#list').hidden) loadList(); });

showList();
