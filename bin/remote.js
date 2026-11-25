'use strict';
// Phone access over SSH, as herdr does it: no app server, no account.
// `whitebox phone` is a narrow list of every terminal; opening one attaches
// the real terminal live (screen first, then raw output; keys go straight in),
// like `hc attach`. Ctrl+\ goes back to the list. `whitebox connect` carries
// the same calls as JSON-RPC 2.0 lines on stdin/stdout (ssh mac whitebox
// connect), like `hc connect`, for a phone app.
const fs = require('fs');
const net = require('net');
const path = require('path');
const readline = require('readline');
const { StringDecoder } = require('string_decoder');
const { request, directory } = require('./panel-control');

const PROTOCOL = 2;
const RPC = { 'terminal.list': 'remote.list', 'terminal.read': 'remote.read', 'terminal.send': 'remote.send', 'terminal.key': 'remote.key' };
const STREAM_METHODS = ['terminal.attach', 'terminal.input', 'terminal.resize', 'terminal.focus', 'terminal.detach'];
// hc attach's default detach key.
const DETACH = 0x1c;

function refuseInsideWhitebox(env = process.env) {
  if (env.WHITEBOX_SURFACE_ID) throw new Error('휴대폰 연결은 Whitebox 터미널 밖(휴대폰 SSH)에서 실행하세요.');
}

// One live view: a long-lived panel control connection.
function attach(params, { dir } = {}) {
  const discovery = JSON.parse(fs.readFileSync(path.join(dir || directory(), 'control.json'), 'utf8'));
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(discovery.endpoint);
    // Frames that arrive before anyone listens (the first paint can share a
    // read with the reply) wait for the first listener.
    const listeners = { frame: [], close: [] }, early = { frame: [], close: [] };
    let buffer = '', opened = false;
    const emit = (type, value) => { if (listeners[type].length) listeners[type].forEach(callback => callback(value)); else early[type].push(value); };
    const view = {
      on(type, callback) { listeners[type].push(callback); for (const value of early[type].splice(0)) callback(value); return view; },
      send(message) { if (!socket.destroyed) socket.write(`${JSON.stringify(message)}\n`); },
      close() { view.send({ type: 'detach' }); socket.end(); },
      // The phone web page relays frames to a slower network; holding the
      // control socket lets the panel's backpressure mark the view stale.
      pause() { socket.pause(); },
      resume() { socket.resume(); },
    };
    socket.setEncoding('utf8');
    socket.setTimeout(10000, () => { if (!opened) { socket.destroy(); reject(new Error('Whitebox panel control timed out')); } });
    socket.on('error', error => { if (!opened) reject(error); });
    socket.on('close', () => { if (!opened) reject(new Error('Whitebox panel control disconnected')); else emit('close'); });
    socket.on('connect', () => socket.write(`${JSON.stringify({ id: 'attach', token: discovery.token, method: 'remote.attach', params })}\n`));
    socket.on('data', chunk => {
      buffer += chunk;
      for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
        const text = buffer.slice(0, at); buffer = buffer.slice(at + 1);
        let frame; try { frame = JSON.parse(text); } catch { continue; }
        if (!opened) {
          if (!frame.ok) { socket.destroy(); return reject(new Error(frame.error || 'Could not open the terminal')); }
          opened = true; socket.setTimeout(0); resolve(Object.assign(view, { result: frame.result }));
        } else emit('frame', frame);
      }
    });
  });
}

function connect({ input = process.stdin, output = process.stdout, call = request, open = attach, version = '' } = {}) {
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  const write = frame => output.write(`${JSON.stringify({ jsonrpc: '2.0', ...frame })}\n`);
  const reply = (id, result) => write({ id, result });
  const views = new Map();
  let queue = Promise.resolve(), channels = 0;
  async function stream(method, params) {
    if (method === 'terminal.attach') {
      const channel = ++channels;
      const view = await open({ surface_id: params.terminal ?? params.surface_id, cols: params.cols, rows: params.rows, observe: Boolean(params.observe) });
      views.set(channel, view);
      view.on('frame', frame => {
        if (frame.type === 'paint' || frame.type === 'output') write({ method: 'terminal.output', params: { channel, data: frame.data, paint: frame.type === 'paint', ...(frame.type === 'paint' ? { cols: frame.cols, rows: frame.rows } : {}) } });
        else if (frame.type === 'end') write({ method: 'terminal.closed', params: { channel, reason: frame.reason } });
      });
      view.on('close', () => { if (views.delete(channel)) write({ method: 'terminal.closed', params: { channel, reason: 'detached' } }); });
      return { channel, ...view.result };
    }
    const view = views.get(Number(params.channel));
    if (!view) throw new Error('Unknown channel');
    if (method === 'terminal.input') view.send({ type: 'input', data: String(params.data ?? '') });
    else if (method === 'terminal.resize') view.send({ type: 'resize', cols: params.cols, rows: params.rows });
    else if (method === 'terminal.focus') view.send({ type: 'focus' });
    else { views.delete(Number(params.channel)); view.close(); }
    return { ok: true };
  }
  lines.on('line', line => {
    if (!line.trim()) return;
    queue = queue.then(async () => {
      let message;
      try { message = JSON.parse(line); } catch { return write({ id: null, error: { code: -32700, message: 'Parse error' } }); }
      const id = message?.id ?? null;
      if (message?.jsonrpc !== '2.0' || typeof message.method !== 'string') return write({ id, error: { code: -32600, message: 'Invalid request' } });
      const params = message.params && typeof message.params === 'object' ? message.params : {};
      if (message.method === 'hello') return reply(id, { app: 'whitebox', protocol: PROTOCOL, version, methods: ['hello', ...Object.keys(RPC), ...STREAM_METHODS] });
      if (!RPC[message.method] && !STREAM_METHODS.includes(message.method)) return write({ id, error: { code: -32601, message: `Unknown method ${message.method}` } });
      try { reply(id, RPC[message.method] ? await call(RPC[message.method], params) : await stream(message.method, params)); }
      catch (error) { write({ id, error: { code: -32000, message: String(error?.message || error) } }); }
    });
  });
  return new Promise(resolve => lines.on('close', () => queue.then(() => { for (const view of views.values()) view.close(); resolve(); })));
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
const label = item => `${PROVIDERS[item.provider] || ''}${item.provider && item.title ? ' · ' : ''}${item.title || (item.provider ? '' : '터미널')}`;

// The list of every running terminal, narrow enough for a phone.
function chooseTerminal({ input, output, call, refreshMs, note: firstNote = '' }) {
  const rl = readline.createInterface({ input, output, terminal: Boolean(output.isTTY), historySize: 20 });
  const cols = () => Math.max(20, output.columns || 40);
  let items = [], note = firstNote, drawn = '', busy = false, closed = false, timer = null, chosen = null;
  const draw = lines => {
    const body = lines.map(line => clip(line, cols())).join('\n');
    if (body === drawn) return;
    drawn = body;
    output.write(`\x1b[H\x1b[2J${body}\n`);
    rl.setPrompt('> '); rl.prompt(true);
  };
  async function refresh() {
    if (busy || closed) return; busy = true;
    try {
      const { panels = [] } = await call('remote.list', {});
      if (closed) return;
      const lines = ['Whitebox · 휴대폰'], next = [];
      for (const panel of panels) {
        lines.push(`— ${panel.name || '패널'}`);
        for (const item of panel.terminals) {
          if (!item.running) continue;
          next.push(item);
          lines.push(`${String(next.length).padStart(2)} ${STATES[item.state] || STATES.unknown} · ${label(item)}`);
        }
      }
      if (!next.length) lines.push('실행 중인 터미널이 없어요.');
      items = next;
      lines.push('', '번호: 열기 · 열고 나서 Ctrl+\\: 목록', 'Enter: 새로고침 · q: 끝');
      if (note) lines.push(note);
      draw(lines);
    } catch (error) {
      if (!closed) draw([`연결하지 못했어요: ${error.message}`, '', 'Whitebox 앱이 이 컴퓨터에서 열려 있어야 해요.', 'Enter: 다시 시도 · q: 끝']);
    } finally { busy = false; }
  }
  return new Promise(resolve => {
    rl.on('line', line => {
      const text = line.trim(), choice = Number(text);
      if (/^q$/iu.test(text)) return rl.close();
      if (text && Number.isInteger(choice) && items[choice - 1]) { chosen = items[choice - 1]; return rl.close(); }
      note = text ? '목록의 번호를 입력하세요.' : ''; drawn = ''; refresh();
    });
    rl.on('SIGINT', () => rl.close());
    const onResize = () => { drawn = ''; refresh(); };
    output.on?.('resize', onResize);
    rl.on('close', () => { closed = true; clearInterval(timer); output.off?.('resize', onResize); resolve(chosen); });
    timer = setInterval(refresh, refreshMs); timer.unref?.();
    refresh();
  });
}

// The real terminal, live, until Ctrl+\ or the terminal ends.
async function liveTerminal(item, { input, output, open }) {
  const size = () => ({ cols: Math.max(2, output.columns || 80), rows: Math.max(1, output.rows || 24) });
  const view = await open({ surface_id: item.id, ...size() });
  return new Promise(resolve => {
    const decoder = new StringDecoder('utf8');
    let done = false;
    const finish = message => {
      if (done) return; done = true;
      input.off('data', onInput); output.off?.('resize', onResize);
      input.setRawMode?.(false); input.pause();
      // Undo the program's modes (mouse, paste, cursor keys), leave the view.
      output.write('\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?2004l\x1b[?1l\x1b[?25h\x1b[0m\x1b[?1049l');
      view.close();
      resolve(message);
    };
    const onInput = chunk => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      const at = bytes.indexOf(DETACH);
      const text = decoder.write(at >= 0 ? bytes.subarray(0, at) : bytes);
      if (text) view.send({ type: 'input', data: text });
      if (at >= 0) finish('');
    };
    const onResize = () => view.send({ type: 'resize', ...size() });
    view.on('frame', frame => {
      if (frame.type === 'paint' || frame.type === 'output') output.write(frame.data);
      else if (frame.type === 'end') finish(`터미널이 끝났어요. ${frame.reason || ''}`.trim());
    });
    view.on('close', () => finish('연결이 끊겼어요.'));
    output.write('\x1b[?1049h\x1b[H\x1b[2J');
    input.setRawMode?.(true);
    input.on('data', onInput);
    input.resume();
    output.on?.('resize', onResize);
  });
}

async function phone({ input = process.stdin, output = process.stdout, call = request, open = attach, refreshMs = 3000 } = {}) {
  let note = '';
  for (;;) {
    const item = await chooseTerminal({ input, output, call, refreshMs, note });
    if (!item) break;
    try { note = await liveTerminal(item, { input, output, open }); }
    catch (error) { note = `열지 못했어요: ${error.message}`; }
  }
  output.write('\n');
}

module.exports = { connect, phone, attach, liveTerminal, wrap, charWidth, refuseInsideWhitebox, RPC, STREAM_METHODS, PROTOCOL, DETACH };
