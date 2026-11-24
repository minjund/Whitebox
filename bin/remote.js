'use strict';
// Phone access over SSH. `whitebox phone` is a narrow screen for a phone SSH
// app; `whitebox connect` carries the same calls as JSON-RPC 2.0 lines on
// stdin/stdout (ssh mac whitebox connect) for a future phone app. Both reach
// the running app through the panel control socket, as the Mac account owner.
const readline = require('readline');
const { request } = require('./panel-control');

const PROTOCOL = 1;
const RPC = { 'terminal.list': 'remote.list', 'terminal.read': 'remote.read', 'terminal.send': 'remote.send', 'terminal.key': 'remote.key' };

function refuseInsideWhitebox(env = process.env) {
  if (env.WHITEBOX_SURFACE_ID) throw new Error('휴대폰 연결은 Whitebox 터미널 밖(휴대폰 SSH)에서 실행하세요.');
}

function connect({ input = process.stdin, output = process.stdout, call = request, version = '' } = {}) {
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  const reply = frame => output.write(`${JSON.stringify({ jsonrpc: '2.0', ...frame })}\n`);
  let queue = Promise.resolve();
  lines.on('line', line => {
    if (!line.trim()) return;
    queue = queue.then(async () => {
      let message;
      try { message = JSON.parse(line); } catch { return reply({ id: null, error: { code: -32700, message: 'Parse error' } }); }
      const id = message?.id ?? null;
      if (message?.jsonrpc !== '2.0' || typeof message.method !== 'string') return reply({ id, error: { code: -32600, message: 'Invalid request' } });
      if (message.method === 'hello') return reply({ id, result: { app: 'whitebox', protocol: PROTOCOL, version, methods: ['hello', ...Object.keys(RPC)] } });
      if (!RPC[message.method]) return reply({ id, error: { code: -32601, message: `Unknown method ${message.method}` } });
      try { reply({ id, result: await call(RPC[message.method], message.params && typeof message.params === 'object' ? message.params : {}) }); }
      catch (error) { reply({ id, error: { code: -32000, message: String(error?.message || error) } }); }
    });
  });
  return new Promise(resolve => lines.on('close', () => queue.then(resolve)));
}

// Hangul, CJK and emoji take two columns on a phone terminal.
function charWidth(code) {
  if (code < 32 || code >= 0x7f && code < 0xa0 || code >= 0x300 && code <= 0x36f || code === 0x200d || code >= 0xfe00 && code <= 0xfe0f) return 0;
  return code >= 0x1100 && code <= 0x115f || code >= 0x2e80 && code <= 0xa4cf || code >= 0xac00 && code <= 0xd7a3
    || code >= 0xf900 && code <= 0xfaff || code >= 0xfe30 && code <= 0xfe4f || code >= 0xff00 && code <= 0xff60
    || code >= 0xffe0 && code <= 0xffe6 || code >= 0x1f300 && code <= 0x1faff || code >= 0x20000 && code <= 0x3fffd ? 2 : 1;
}
function wrap(line, cols) {
  const rows = []; let row = '', used = 0;
  for (const char of String(line).replace(/\s+$/u, '')) {
    const width = charWidth(char.codePointAt(0));
    if (used + width > cols) { rows.push(row); row = ''; used = 0; }
    row += char; used += width;
  }
  rows.push(row);
  return rows;
}
const clip = (line, cols) => wrap(line, cols)[0];

const STATES = { working: '● 작업 중', waiting: '? 답 기다림', idle: '○ 쉬는 중', unknown: '· 상태 모름', stopped: '× 멈춤', exited: '× 끝남', failed: '× 실패', removed: '× 사라짐' };
const PROVIDERS = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini', grok: 'Grok' };
const KEY_COMMANDS = { esc: 'esc', c: 'ctrl-c', up: 'up', down: 'down', left: 'left', right: 'right', tab: 'tab', stab: 'shift-tab', enter: 'enter', bs: 'backspace' };

// What a typed line does on a terminal screen.
function parseLine(line) {
  const text = String(line);
  if (!text) return { key: 'enter' };
  if (text.startsWith('::')) return { text: text.slice(1), submit: true };
  if (!text.startsWith(':')) return { text, submit: true };
  const command = text.slice(1).trim();
  if (['b', 'q', 'back'].includes(command)) return { back: true };
  if (KEY_COMMANDS[command]) return { key: KEY_COMMANDS[command] };
  if (/^[a-zA-Z0-9]$/u.test(command)) return { key: command };
  if (/^k\s/u.test(command)) return { text: command.slice(2), submit: false };
  return { error: `모르는 명령이에요: ${text} (:h 도움말)` };
}

function phone({ input = process.stdin, output = process.stdout, call = request, refreshMs = 1000, now = Date.now } = {}) {
  const rl = readline.createInterface({ input, output, terminal: Boolean(output.isTTY), historySize: 50 });
  const cols = () => Math.max(20, output.columns || 40), height = () => Math.max(8, output.rows || 24);
  let view = { kind: 'list', items: [] }, note = '', help = false, drawn = '', timer = null, busy = false, closed = false;
  const draw = lines => {
    const body = lines.map(line => clip(line, cols())).join('\n');
    if (body === drawn) return;
    drawn = body;
    output.write(`\x1b[H\x1b[2J${body}\n`);
    rl.setPrompt('> '); rl.prompt(true);
  };
  const label = item => `${PROVIDERS[item.provider] || ''}${item.provider && item.title ? ' · ' : ''}${item.title || (item.provider ? '' : '터미널')}`;
  async function refresh() {
    if (busy || closed) return; busy = true;
    try {
      if (view.kind === 'list') {
        const { panels = [] } = await call('remote.list', {});
        const lines = ['Whitebox · 휴대폰'], items = [];
        for (const panel of panels) {
          lines.push(`— ${panel.name || '패널'}`);
          for (const item of panel.terminals) {
            if (!item.running) continue;
            items.push(item);
            lines.push(`${String(items.length).padStart(2)} ${STATES[item.state] || STATES.unknown} · ${label(item)}`);
          }
        }
        if (!items.length) lines.push('실행 중인 터미널이 없어요.');
        view.items = items;
        lines.push('', '번호: 열기 · Enter: 새로고침 · q: 끝');
        if (note) lines.push(note);
        draw(lines);
      } else {
        const screen = await call('remote.read', { surface_id: view.id, lines: 400 });
        const age = screen.capturedAt ? Math.round((now() - screen.capturedAt) / 1000) : null;
        const header = `${label({ ...screen, title: screen.title })} · ${STATES[screen.state] || STATES.unknown}${age != null && age > 5 ? ` · ${age}초 전 화면` : ''}`;
        const footer = help
          ? ['글 + Enter: 보내기 · 빈 Enter: Enter 키', ':1 / :y 그 키만 · :esc · :c 중단(Ctrl+C)', ':up :down :tab :stab · :k 글(Enter 없이)', ':b 목록 · :h 도움말 닫기']
          : [':b 목록 · :esc · :c 중단 · :1 키만 · :h 도움말'];
        const room = height() - 2 - footer.length - (note ? 1 : 0);
        const rows = screen.text ? screen.text.replace(/\n+$/u, '').split('\n').flatMap(line => wrap(line, cols())) : ['(아직 화면을 받지 못했어요)'];
        draw([header, ...rows.slice(-room), ...footer, ...note ? [note] : []]);
      }
    } catch (error) {
      if (view.kind === 'terminal' && /changed|Choose a running/u.test(error.message)) { view = { kind: 'list', items: [] }; note = '터미널이 바뀌었어요. 목록으로 돌아왔어요.'; busy = false; return refresh(); }
      draw([`연결하지 못했어요: ${error.message}`, '', 'Whitebox 앱이 이 맥에서 열려 있어야 해요.', 'Enter: 다시 시도 · q: 끝']);
    } finally { busy = false; }
  }
  const schedule = () => { clearInterval(timer); timer = setInterval(refresh, view.kind === 'list' ? refreshMs * 3 : refreshMs); timer.unref?.(); };
  const act = async (method, params) => {
    try { await call(method, params); note = ''; } catch (error) { note = `보내지 못했어요: ${error.message}`; }
    drawn = ''; setTimeout(refresh, 250).unref?.();
  };
  rl.on('line', line => {
    const text = line.replace(/\r$/u, '');
    if (view.kind === 'list') {
      const choice = Number(text.trim());
      if (/^q$/iu.test(text.trim())) return rl.close();
      if (text.trim() && Number.isInteger(choice) && view.items[choice - 1]) {
        view = { kind: 'terminal', id: view.items[choice - 1].id }; note = ''; help = false; schedule();
      } else note = text.trim() ? '목록의 번호를 입력하세요.' : '';
      drawn = ''; return refresh();
    }
    if (text.trim() === ':h') { help = !help; drawn = ''; return refresh(); }
    const step = parseLine(text);
    if (step.back) { view = { kind: 'list', items: [] }; note = ''; schedule(); drawn = ''; return refresh(); }
    if (step.error) { note = step.error; drawn = ''; return refresh(); }
    if (step.key) return act('remote.key', { surface_id: view.id, key: step.key });
    return act('remote.send', { surface_id: view.id, text: step.text, submit: step.submit });
  });
  rl.on('SIGINT', () => rl.close());
  const done = new Promise(resolve => rl.on('close', () => { closed = true; clearInterval(timer); output.write('\n'); resolve(); }));
  output.on?.('resize', () => { drawn = ''; refresh(); });
  schedule(); refresh();
  return done;
}

module.exports = { connect, phone, parseLine, wrap, charWidth, refuseInsideWhitebox, RPC, PROTOCOL };
