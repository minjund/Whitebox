'use strict';
// The phone page: a small web page Whitebox serves on this computer's
// Tailscale address only. A phone signed in to the same Tailscale account
// opens http://<tailscale ip>:7790 and sees every panel's terminals live.
//
// Who may come in:
// - The server listens on the Tailscale address only, never on Wi-Fi.
// - Every request's peer address is looked up with `tailscale whois`; only a
//   device signed in as this computer's Tailscale user gets through. A lookup
//   failure refuses the request.
// - The Host header must be this computer's Tailscale name or address, which
//   stops DNS rebinding. API calls need the page's token (a custom header, so
//   another site cannot send them without a CORS preflight we never answer);
//   the live socket checks Origin and the token.
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const PORT = 7790;
const PORT_TRIES = 10;
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_BODY = 64 * 1024;
const MAX_MESSAGE = 1024 * 1024;
const SEND_BACKLOG = 1024 * 1024;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

class PhoneWebStore {
  constructor(file, fileSystem = fs) { this.file = file; this.fileSystem = fileSystem; }
  load() {
    try { return JSON.parse(this.fileSystem.readFileSync(this.file, 'utf8')).enabled === true; } catch { return false; }
  }
  save(enabled) {
    const temporary = `${this.file}.${process.pid}.tmp`;
    this.fileSystem.mkdirSync(path.dirname(this.file), { recursive: true });
    this.fileSystem.writeFileSync(temporary, JSON.stringify({ version: 1, enabled: Boolean(enabled) }, null, 2), { encoding: 'utf8', mode: 0o600 });
    this.fileSystem.renameSync(temporary, this.file);
  }
}

// --- Minimal WebSocket (RFC 6455) server side: text frames, ping/pong, close.
function acceptKey(key) { return crypto.createHash('sha1').update(String(key) + WS_GUID).digest('base64'); }
function encodeFrame(payload, opcode = 1) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  const length = body.length;
  const header = length < 126 ? Buffer.alloc(2) : length < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
  header[0] = 0x80 | opcode;
  if (length < 126) header[1] = length;
  else if (length < 65536) { header[1] = 126; header.writeUInt16BE(length, 2); }
  else { header[1] = 127; header.writeBigUInt64BE(BigInt(length), 2); }
  return Buffer.concat([header, body]);
}
// Client frames must be masked. Returns { frames, rest } or throws on a
// protocol error.
function decodeFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (buffer.length - offset >= 2) {
    const first = buffer[offset], second = buffer[offset + 1];
    if (!(second & 0x80)) throw new Error('Unmasked client frame');
    let length = second & 0x7f, at = offset + 2;
    if (length === 126) { if (buffer.length < at + 2) break; length = buffer.readUInt16BE(at); at += 2; }
    else if (length === 127) {
      if (buffer.length < at + 8) break;
      const big = buffer.readBigUInt64BE(at);
      if (big > BigInt(MAX_MESSAGE)) throw new Error('Frame too large');
      length = Number(big); at += 8;
    }
    if (length > MAX_MESSAGE) throw new Error('Frame too large');
    if (buffer.length < at + 4 + length) break;
    const mask = buffer.subarray(at, at + 4), data = Buffer.from(buffer.subarray(at + 4, at + 4 + length));
    for (let i = 0; i < data.length; i += 1) data[i] ^= mask[i & 3];
    frames.push({ fin: Boolean(first & 0x80), opcode: first & 0x0f, data });
    offset = at + 4 + length;
  }
  return { frames, rest: buffer.subarray(offset) };
}

function peerAddress(socket) { return String(socket?.remoteAddress || '').replace(/^::ffff:/, ''); }

class PhoneWeb extends EventEmitter {
  constructor({ tailscale, request, attach, root, store, port = PORT, bindHost = '', log = () => {}, pollMs = 15000, now = Date.now, user = safeUser() } = {}) {
    super();
    this.tailscale = tailscale;
    this.request = request;
    this.attach = attach;
    this.root = root;
    this.store = store;
    this.basePort = port;
    // Tests bind a loopback address instead of asking Tailscale for one.
    this.bindHost = bindHost;
    this.log = log;
    this.pollMs = pollMs;
    this.now = now;
    this.user = user;
    this.enabled = store ? store.load() : false;
    this.token = crypto.randomBytes(24).toString('base64url');
    this.server = null;
    this.listening = null;
    this.self = null;
    this.state = this.enabled ? 'starting' : 'off';
    this.devices = new Map();
    this.sockets = new Set();
    this.timer = null;
    this.refreshing = null;
  }

  start() {
    if (!this.timer) { this.timer = setInterval(() => this.refresh().catch(() => {}), this.pollMs); this.timer.unref?.(); }
    return this.refresh();
  }

  async setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    this.store?.save(this.enabled);
    await this.refresh();
    return this.status();
  }

  refresh() {
    if (!this.refreshing) this.refreshing = this.update().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  async update() {
    if (!this.enabled) { await this.close(); this.self = null; this.setState('off'); return; }
    const self = this.bindHost ? { state: 'running', ip: this.bindHost, dnsName: '', shortName: '', userId: 'local' } : await this.tailscale.status();
    this.self = self;
    if (self.state !== 'running') { await this.close(); this.setState(self.state === 'missing' ? 'no-tailscale' : 'tailscale-off'); return; }
    if (this.server && this.listening?.host === self.ip) { this.setState('on'); return; }
    await this.close();
    for (let port = this.basePort; port < this.basePort + PORT_TRIES; port += 1) {
      try { await this.listen(self.ip, port); this.setState('on'); return; }
      catch (error) {
        if (error.code !== 'EADDRINUSE') { this.log(error); this.setState('error'); return; }
      }
    }
    this.setState('port-busy');
  }

  setState(state) {
    if (this.state === state) return;
    this.state = state;
    this.emit('change', this.status());
  }

  listen(host, port) {
    const server = http.createServer((req, res) => this.handle(req, res).catch(error => this.fail(res, 500, error.message)));
    server.on('upgrade', (req, socket, head) => this.upgrade(req, socket, head).catch(() => socket.destroy()));
    server.headersTimeout = 10000;
    server.requestTimeout = 15000;
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.removeListener('error', reject);
        server.on('error', error => this.log(error));
        this.server = server;
        this.listening = { host, port };
        resolve();
      });
    });
  }

  async close() {
    const server = this.server;
    this.server = null;
    this.listening = null;
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    if (server) await new Promise(resolve => server.close(() => resolve()));
  }

  async dispose() {
    clearInterval(this.timer);
    this.timer = null;
    await this.close();
  }

  url() {
    if (!this.listening) return '';
    return `http://${this.listening.host}:${this.listening.port}`;
  }

  status() {
    const port = this.listening?.port || this.basePort;
    const cutoff = this.now() - 2 * 60 * 1000;
    const devices = [...this.devices.values()].filter(device => device.live > 0 || device.at >= cutoff)
      .map(device => ({ device: device.device, os: device.os, live: device.live > 0, at: device.at }));
    return {
      enabled: this.enabled,
      state: this.state,
      url: this.state === 'on' ? this.url() : '',
      nameUrl: this.state === 'on' && this.self?.dnsName ? `http://${this.self.shortName}:${port}` : '',
      ip: this.self?.ip || '',
      port,
      user: this.user,
      devices
    };
  }

  // Host names this server answers to.
  hosts() {
    const port = this.listening?.port;
    const names = [this.listening?.host, this.self?.dnsName, this.self?.shortName].filter(Boolean);
    return new Set(names.map(name => `${String(name).toLowerCase()}:${port}`));
  }

  // Same Tailscale user as this computer, from the right Host name.
  async admit(req) {
    if (!this.hosts().has(String(req.headers.host || '').toLowerCase())) return { ok: false, code: 421, error: 'Unknown host' };
    const address = peerAddress(req.socket);
    if (this.bindHost) return { ok: true, address, device: { device: 'test', os: '' } };
    let who;
    try { who = await this.tailscale.whois(address); } catch { return { ok: false, code: 403, error: 'Tailscale could not identify this device' }; }
    if (!who.userId || !this.self?.userId || who.userId !== this.self.userId) return { ok: false, code: 403, error: 'This device is signed in to a different Tailscale account' };
    return { ok: true, address, device: who };
  }

  seen(address, device, delta = 0) {
    const entry = this.devices.get(address) || { device: device.device || address, os: device.os || '', live: 0, at: 0 };
    entry.at = this.now();
    entry.live = Math.max(0, entry.live + delta);
    if (device.device) entry.device = device.device;
    this.devices.set(address, entry);
    if (delta) this.emit('change', this.status());
  }

  fail(res, code, error) {
    if (res.headersSent) { res.destroy(); return; }
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ error }));
  }

  json(res, value) {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(value));
  }

  headers(type, host) {
    return {
      'content-type': type,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
      'content-security-policy': `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws://${host} data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`
    };
  }

  async handle(req, res) {
    const admitted = await this.admit(req);
    if (!admitted.ok) return this.fail(res, admitted.code, admitted.error);
    this.seen(admitted.address, admitted.device);
    const url = new URL(req.url, 'http://phone.invalid');
    if (url.pathname.startsWith('/api/')) {
      if (req.headers['x-whitebox-token'] !== this.token) return this.fail(res, 401, 'Reload the page');
      return this.api(req, res, url);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return this.fail(res, 405, 'Method not allowed');
    return this.file(res, url.pathname, req.headers.host);
  }

  file(res, pathname, host) {
    const phone = path.join(this.root, 'renderer', 'phone');
    const engine = path.join(this.root, 'node_modules', '@crunchloop', 'ghostty-web', 'dist');
    let file;
    if (pathname === '/' || pathname === '/index.html') file = path.join(phone, 'index.html');
    else if (/^\/[a-z-]+\.(js|css|webmanifest)$/.test(pathname)) file = path.join(phone, pathname.slice(1));
    else if (pathname === '/icon.png') file = path.join(this.root, 'build', 'icon.png');
    else if (/^\/engine\/[A-Za-z0-9_-]+(\.es)?\.js$/.test(pathname)) file = path.join(engine, pathname.slice('/engine/'.length));
    if (!file) return this.fail(res, 404, 'Not found');
    let body;
    try { body = fs.readFileSync(file); } catch { return this.fail(res, 404, 'Not found'); }
    if (path.basename(file) === 'index.html') body = Buffer.from(String(body).replace('__WHITEBOX_TOKEN__', this.token).replace('__WHITEBOX_HOST__', escapeHtml(os.hostname())));
    res.writeHead(200, this.headers(TYPES[path.extname(file)] || 'application/octet-stream', host));
    res.end(body);
  }

  async api(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/list') return this.json(res, await this.request('remote.list', {}));
    if (req.method === 'POST' && url.pathname === '/api/send') {
      const body = await readJson(req);
      return this.json(res, await this.request('remote.send', { surface_id: String(body.surface_id || ''), text: String(body.text || ''), submit: body.submit !== false }));
    }
    if (req.method === 'POST' && url.pathname === '/api/key') {
      const body = await readJson(req);
      return this.json(res, await this.request('remote.key', { surface_id: String(body.surface_id || ''), key: String(body.key || '') }));
    }
    return this.fail(res, 404, 'Not found');
  }

  async upgrade(req, socket) {
    socket.on('error', () => {});
    const reject = (code, text) => { socket.end(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); };
    const admitted = await this.admit(req);
    if (!admitted.ok) return reject(admitted.code, 'Forbidden');
    const url = new URL(req.url, 'http://phone.invalid');
    const host = String(req.headers.host || '').toLowerCase();
    if (url.pathname !== '/api/attach' || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') return reject(404, 'Not Found');
    if (String(req.headers.origin || '').toLowerCase() !== `http://${host}`) return reject(403, 'Forbidden');
    if (url.searchParams.get('t') !== this.token) return reject(401, 'Unauthorized');
    const key = req.headers['sec-websocket-key'];
    if (!key) return reject(400, 'Bad Request');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`);
    socket.setNoDelay(true);
    this.sockets.add(socket);
    this.seen(admitted.address, admitted.device, 1);
    this.relay(socket, {
      surface_id: url.searchParams.get('surface_id') || '',
      cols: Number(url.searchParams.get('cols')) || 80,
      rows: Number(url.searchParams.get('rows')) || 24
    }, () => { this.sockets.delete(socket); this.seen(admitted.address, admitted.device, -1); });
  }

  // One browser socket <-> one panel-control live view.
  relay(socket, params, onClose) {
    let view = null, closed = false, buffer = Buffer.alloc(0), parts = [];
    const send = value => { if (!socket.destroyed) socket.write(encodeFrame(JSON.stringify(value))); };
    const finish = () => {
      if (closed) return;
      closed = true;
      clearInterval(ping);
      try { view?.close(); } catch {}
      onClose();
      if (!socket.destroyed) socket.end(encodeFrame(Buffer.alloc(0), 8));
    };
    const ping = setInterval(() => { if (!socket.destroyed) socket.write(encodeFrame(Buffer.alloc(0), 9)); }, 25000);
    ping.unref?.();
    socket.on('close', finish);
    // The HTTP server keeps upgraded sockets half-open; a phone that drops
    // the connection without a close frame still ends the view.
    socket.on('end', finish);
    socket.on('drain', () => view?.resume?.());
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      let decoded;
      try { decoded = decodeFrames(buffer); } catch { socket.destroy(); return; }
      buffer = Buffer.from(decoded.rest);
      for (const frame of decoded.frames) {
        if (frame.opcode === 8) { finish(); return; }
        if (frame.opcode === 9) { socket.write(encodeFrame(frame.data, 10)); continue; }
        if (frame.opcode === 10) continue;
        if (frame.opcode === 1 || frame.opcode === 0) {
          parts.push(frame.data);
          if (parts.reduce((sum, part) => sum + part.length, 0) > MAX_MESSAGE) { socket.destroy(); return; }
          if (!frame.fin) continue;
          const text = Buffer.concat(parts).toString('utf8');
          parts = [];
          let message;
          try { message = JSON.parse(text); } catch { continue; }
          if (!view) continue;
          if (message?.type === 'input' && typeof message.data === 'string') view.send({ type: 'input', data: message.data });
          else if (message?.type === 'resize') view.send({ type: 'resize', cols: Number(message.cols), rows: Number(message.rows) });
          else if (message?.type === 'focus') view.send({ type: 'focus' });
          else if (message?.type === 'detach') finish();
        }
      }
    });
    Promise.resolve().then(() => this.attach(params)).then(opened => {
      if (closed) { opened.close(); return; }
      view = opened;
      send({ type: 'open', result: opened.result || {} });
      view.on('frame', frame => {
        send(frame);
        if (socket.writableLength > SEND_BACKLOG) view.pause?.();
        if (frame?.type === 'end') finish();
      });
      view.on('close', finish);
    }, error => { send({ type: 'end', reason: error.message }); finish(); });
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', chunk => { size += chunk.length; if (size > MAX_BODY) { reject(new Error('Too large')); req.destroy(); } else chunks.push(chunk); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Error('Bad JSON')); } });
    req.on('error', reject);
  });
}

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`); }
function safeUser() { try { return os.userInfo().username; } catch { return ''; } }

module.exports = { PhoneWeb, PhoneWebStore, encodeFrame, decodeFrames, acceptKey, PORT };
