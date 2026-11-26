'use strict';
// The phone page: a small web page Whitebox serves on this computer's
// Tailscale address only. A phone signed in to the same Tailscale account
// opens https://<tailscale name>:7790 (http://<tailscale ip>:7790 while the
// tailnet has no HTTPS) and reads every Claude and Codex terminal
// as a conversation (the same transcript the desktop chat panes read). There
// is no terminal view on the phone: input goes through the guarded chat send,
// and an AI's question is answered with a few fixed keys.
//
// Who may come in:
// - The server listens on the Tailscale address only, never on Wi-Fi.
// - Every request's peer address is looked up with `tailscale whois`; only a
//   device signed in as this computer's Tailscale user gets through. A lookup
//   failure refuses the request.
// - The Host header must be this computer's Tailscale name or address, which
//   stops DNS rebinding. API calls need the page's token (a custom header, so
//   another site cannot send them without a CORS preflight we never answer).
//
// HTTPS: with HTTPS turned on in the tailnet, Tailscale hands out a real
// certificate for this computer's name; the page is then served over https so
// the phone can install it as an app (service worker, standalone window).
// One port answers both: a TLS hello goes to https, anything else to plain
// http, which then only redirects to the https address.
const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { EventEmitter } = require('events');

const PORT = 7790;
const PORT_TRIES = 10;
const MAX_BODY = 64 * 1024;
const CHAT_PROVIDERS = new Set(['claude', 'codex']);
// The phone gets the latest part of a conversation; older turns stay on the computer.
const PHONE_MESSAGES = 150;
// Keys an AI's question is answered with. Nothing else reaches the terminal raw.
const ANSWER_KEYS = new Set(['1', '2', '3', '4', '5', '6', '7', '8', '9', 'enter', 'esc']);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
// Shared with the desktop chat panes so both draw a conversation the same way.
const SHARED = { '/chat-render.js': 'chat-render.js', '/chat.css': 'styles-terminal-chat.css' };
// Tailscale renews the certificate itself; ask again twice a day for the current one.
const CERT_TTL_MS = 12 * 60 * 60 * 1000;
const CERT_RETRY_MS = 10 * 60 * 1000;

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

function peerAddress(socket) { return String(socket?.remoteAddress || '').replace(/^::ffff:/, ''); }

class PhoneWeb extends EventEmitter {
  constructor({ tailscale, request, chat, root, store, port = PORT, bindHost = '', log = () => {}, pollMs = 15000, now = Date.now, user = safeUser(),
    certTtlMs = CERT_TTL_MS, certRetryMs = CERT_RETRY_MS } = {}) {
    super();
    this.tailscale = tailscale;
    this.request = request;
    this.chat = chat;
    this.root = root;
    this.store = store;
    this.basePort = port;
    // Tests bind a loopback address instead of asking Tailscale for one.
    this.bindHost = bindHost;
    this.certTtlMs = certTtlMs;
    this.certRetryMs = certRetryMs;
    this.secureContext = null;
    this.certTask = null;
    this.certFailedAt = 0;
    this.httpsReason = '';
    this.sockets = new Set();
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

  // One update at a time; a refresh asked for meanwhile (a certificate that just
  // arrived) runs once more right after it instead of being dropped.
  refresh() {
    if (this.refreshing) { this.again = true; return this.refreshing; }
    this.refreshing = (async () => { do { this.again = false; await this.update(); } while (this.again); })().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  async update() {
    if (!this.enabled) { await this.close(); this.self = null; this.setState('off'); return; }
    const self = this.bindHost
      ? { state: 'running', ip: this.bindHost, dnsName: '', shortName: '', userId: 'local', certDomains: [] }
      : await this.tailscale.status();
    this.self = self;
    if (self.state !== 'running') { await this.close(); this.setState(self.state === 'missing' ? 'no-tailscale' : 'tailscale-off'); return; }
    const secure = this.secure(self);
    const mode = secure ? 'https' : 'http';
    if (this.server && this.listening?.host === self.ip && this.listening.mode === mode) {
      // A renewed certificate is swapped in without dropping open pages.
      if (secure && this.listening.cert !== secure.cert) { this.servers.encrypted.setSecureContext({ cert: secure.cert, key: secure.key }); this.listening.cert = secure.cert; }
      this.setState('on');
      return;
    }
    const port = this.listening?.port;
    await this.close();
    // Keep the port the page had when only the protocol changes.
    const ports = [port, ...Array.from({ length: PORT_TRIES }, (_, index) => this.basePort + index)].filter((value, index, all) => value && all.indexOf(value) === index);
    for (const port of ports) {
      try {
        await this.listen(self.ip, port, secure);
        if (this.state === 'on') this.emit('change', this.status()); else this.setState('on');
        return;
      }
      catch (error) {
        if (error.code !== 'EADDRINUSE') { this.log(error); this.setState('error'); return; }
      }
    }
    this.setState('port-busy');
  }

  // The current certificate for this computer's Tailscale name, or null while
  // the page has to stay on http. Getting one can take a minute the first time,
  // so it runs in the background and the page switches to https when it lands.
  secure(self) {
    const name = String(self.dnsName || '').toLowerCase();
    const current = this.secureContext?.name === name ? this.secureContext : null;
    if (!name) { this.httpsReason = 'no-magicdns'; return null; }
    if (!(self.certDomains || []).includes(name)) { this.httpsReason = 'https-off'; return null; }
    const fresh = current && this.now() - current.at < this.certTtlMs;
    const waiting = this.certFailedAt && this.now() - this.certFailedAt < this.certRetryMs;
    if (!fresh && !waiting && !this.certTask) {
      if (!current) this.httpsReason = 'cert-pending';
      this.certTask = Promise.resolve().then(() => this.tailscale.cert(name)).then(pem => {
        tls.createSecureContext(pem);
        this.secureContext = { ...pem, name, at: this.now() };
        this.certFailedAt = 0;
        this.httpsReason = '';
      }).catch(error => {
        this.certFailedAt = this.now();
        if (!this.secureContext) this.httpsReason = 'cert-failed';
        this.log(error);
      }).finally(() => {
        this.certTask = null;
        if (this.enabled) this.refresh().catch(() => {});
      });
    }
    if (current) this.httpsReason = '';
    return current;
  }

  setState(state) {
    if (this.state === state) return;
    this.state = state;
    this.emit('change', this.status());
  }

  listen(host, port, secure = null) {
    const handle = (req, res) => this.handle(req, res).catch(error => this.fail(res, 500, error.message));
    const plain = http.createServer(secure ? (req, res) => this.redirect(req, res).catch(error => this.fail(res, 500, error.message)) : handle);
    const encrypted = secure ? https.createServer({ cert: secure.cert, key: secure.key }, handle) : null;
    for (const inner of [plain, encrypted].filter(Boolean)) {
      inner.headersTimeout = 10000;
      inner.requestTimeout = 15000;
    }
    // The first byte of a connection tells TLS (0x16, a handshake record) from plain http.
    const server = net.createServer(socket => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
      socket.on('error', () => {});
      socket.setTimeout(15000, () => socket.destroy());
      socket.once('data', chunk => {
        socket.setTimeout(0);
        socket.pause();
        socket.unshift(chunk);
        (encrypted && chunk[0] === 0x16 ? encrypted : plain).emit('connection', socket);
        process.nextTick(() => socket.resume());
      });
    });
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.removeListener('error', reject);
        server.on('error', error => this.log(error));
        this.server = server;
        this.servers = { plain, encrypted };
        this.listening = { host, port, mode: secure ? 'https' : 'http', cert: secure?.cert || '' };
        resolve();
      });
    });
  }

  async close() {
    const server = this.server;
    this.server = null;
    this.servers = null;
    this.listening = null;
    if (!server) return;
    const closed = new Promise(resolve => server.close(() => resolve()));
    // Open pages keep their connections alive; a switch to https must not wait for them.
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    await closed;
  }

  async dispose() {
    clearInterval(this.timer);
    this.timer = null;
    await this.close();
  }

  url() {
    if (!this.listening) return '';
    if (this.listening.mode === 'https') return `https://${this.self.dnsName}:${this.listening.port}`;
    return `http://${this.listening.host}:${this.listening.port}`;
  }

  // In https mode plain http only sends the phone to the https address
  // (an old http bookmark keeps working).
  async redirect(req, res) {
    const admitted = await this.admit(req);
    if (!admitted.ok) return this.fail(res, admitted.code, admitted.error);
    const { pathname } = new URL(req.url, 'http://phone.invalid');
    res.writeHead(308, { location: `${this.url()}${pathname}`, 'cache-control': 'no-store' });
    res.end();
  }

  status() {
    const port = this.listening?.port || this.basePort;
    const secure = this.listening?.mode === 'https';
    const cutoff = this.now() - 2 * 60 * 1000, live = this.now() - 10 * 1000;
    // An open page polls every few seconds, so a request in the last 10 s means it is open now.
    const devices = [...this.devices.values()].filter(device => device.at >= cutoff)
      .map(device => ({ device: device.device, os: device.os, live: device.at >= live, at: device.at }));
    return {
      enabled: this.enabled,
      state: this.state,
      url: this.state === 'on' ? this.url() : '',
      nameUrl: this.state === 'on' && !secure && this.self?.dnsName ? `http://${this.self.shortName}:${port}` : '',
      https: this.state === 'on' && secure,
      // Why the page is still on http: no-magicdns, https-off, cert-pending, cert-failed.
      httpsReason: this.state === 'on' && !secure ? this.httpsReason : '',
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

  seen(address, device) {
    const entry = this.devices.get(address) || { device: device.device || address, os: device.os || '', at: 0 };
    const fresh = this.now() - entry.at > 10 * 1000;
    entry.at = this.now();
    if (device.device) entry.device = device.device;
    this.devices.set(address, entry);
    if (fresh) this.emit('change', this.status());
  }

  fail(res, code, error) {
    if (res.headersSent) { res.destroy(); return; }
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ error }));
  }

  // Conversations are text; gzip makes a long one a fraction of its size on a phone link.
  send(res, req, headers, body) {
    if (body.length > 1024 && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) {
      body = zlib.gzipSync(body);
      headers = { ...headers, 'content-encoding': 'gzip', vary: 'accept-encoding' };
    }
    res.writeHead(200, { ...headers, 'content-length': body.length });
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  json(res, req, value) {
    this.send(res, req, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, Buffer.from(JSON.stringify(value)));
  }

  headers(type) {
    return {
      'content-type': type,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
      'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
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
    return this.file(req, res, url.pathname);
  }

  file(req, res, pathname) {
    const phone = path.join(this.root, 'renderer', 'phone');
    let file;
    if (pathname === '/' || pathname === '/index.html') file = path.join(phone, 'index.html');
    else if (SHARED[pathname]) file = path.join(this.root, 'renderer', SHARED[pathname]);
    else if (/^\/[a-z0-9-]+\.(js|css|webmanifest|png)$/.test(pathname) && pathname !== '/icon.png') file = path.join(phone, pathname.slice(1));
    else if (pathname === '/icon.png') file = path.join(this.root, 'build', 'icon.png');
    if (!file) return this.fail(res, 404, 'Not found');
    let body;
    try { body = fs.readFileSync(file); } catch { return this.fail(res, 404, 'Not found'); }
    if (path.basename(file) === 'index.html') body = Buffer.from(String(body).replace('__WHITEBOX_TOKEN__', this.token).replace('__WHITEBOX_HOST__', escapeHtml(os.hostname())));
    this.send(res, req, this.headers(TYPES[path.extname(file)] || 'application/octet-stream'), body);
  }

  async api(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/list') return this.json(res, req, chatList(await this.request('remote.list', {})));
    if (req.method === 'GET' && url.pathname === '/api/chat') {
      const result = await this.chat.read({ surfaceId: String(url.searchParams.get('surface_id') || ''), revision: String(url.searchParams.get('revision') || '') });
      return this.json(res, req, phoneConversation(result));
    }
    if (req.method !== 'POST') return this.fail(res, 404, 'Not found');
    const body = await readJson(req);
    const target = {
      groupId: String(body.panel_id || ''), targetId: String(body.surface_id || ''),
      targetCreationId: String(body.creation_id || ''), targetProviderPid: Number(body.provider_pid), targetProvider: String(body.provider || '')
    };
    if (url.pathname === '/api/chat/send') return this.json(res, req, await this.chat.send({ id: String(body.id || ''), message: String(body.text || ''), ...target }));
    if (url.pathname === '/api/chat/stop') return this.json(res, req, await this.chat.stop(target));
    if (url.pathname === '/api/key') {
      const key = String(body.key || '');
      if (!ANSWER_KEYS.has(key)) return this.fail(res, 400, 'Unknown key');
      return this.json(res, req, await this.request('remote.key', { surface_id: target.targetId, key }));
    }
    return this.fail(res, 404, 'Not found');
  }
}

// Only terminals running Claude or Codex: the rest have no conversation to show.
function chatList(value) {
  const panels = (value?.panels || []).map(panel => ({ id: panel.id, name: panel.name,
    terminals: (panel.terminals || []).filter(item => item.running && CHAT_PROVIDERS.has(item.provider)) }));
  return { panels: panels.filter(panel => panel.terminals.length) };
}

function phoneConversation(result) {
  if (!result?.messages || result.messages.length <= PHONE_MESSAGES) return result;
  return { ...result, messages: result.messages.slice(-PHONE_MESSAGES), truncated: true };
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

module.exports = { PhoneWeb, PhoneWebStore, chatList, PORT };
