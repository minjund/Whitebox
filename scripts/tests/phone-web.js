'use strict';
// The phone page lets in only this computer's own Tailscale user, from the
// right host name, with the page token; the live socket relays one terminal.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { PhoneWeb, PhoneWebStore, encodeFrame, decodeFrames, acceptKey } = require('../../src/phoneWeb');
const { parseStatus, parseWhois, findCli } = require('../../src/tailscale');

const root = path.join(__dirname, '..', '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-phone-web-'));
const BASE = 27790 + Math.floor(Math.random() * 500);

function fetchRaw({ port, pathname = '/', host, method = 'GET', headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method, headers: { host: host || `127.0.0.1:${port}`, ...headers } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body) req.end(JSON.stringify(body)); else req.end();
  });
}

// A raw WebSocket client: masked frames out, server frames in.
function openSocket({ port, query, origin, host }) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    const key = crypto.randomBytes(16).toString('base64');
    let buffer = Buffer.alloc(0), upgraded = false;
    const messages = [], waiters = [];
    const deliver = () => { while (waiters.length && messages.length) waiters.shift()(messages.shift()); };
    const client = {
      status: 0,
      next: () => new Promise(done => { waiters.push(done); deliver(); }),
      send(value, opcode = 1) {
        const body = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
        const mask = crypto.randomBytes(4);
        const header = body.length < 126 ? Buffer.from([0x80 | opcode, 0x80 | body.length]) : Buffer.concat([Buffer.from([0x80 | opcode, 0x80 | 126]), Buffer.from([body.length >> 8, body.length & 255])]);
        const masked = Buffer.from(body.map((byte, index) => byte ^ mask[index & 3]));
        socket.write(Buffer.concat([header, mask, masked]));
      },
      closed: new Promise(done => socket.on('close', done)),
      end() { socket.end(); }
    };
    socket.on('error', reject);
    socket.on('connect', () => socket.write([`GET /api/attach?${query} HTTP/1.1`, `Host: ${host || `127.0.0.1:${port}`}`, 'Upgrade: websocket', 'Connection: Upgrade',
      `Sec-WebSocket-Key: ${key}`, 'Sec-WebSocket-Version: 13', origin ? `Origin: ${origin}` : '', '', ''].filter((line, index, all) => line || index >= all.length - 2).join('\r\n')));
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!upgraded) {
        const end = buffer.indexOf('\r\n\r\n');
        if (end < 0) return;
        const head = buffer.subarray(0, end).toString();
        client.status = Number(head.split(' ')[1]);
        buffer = buffer.subarray(end + 4);
        if (client.status !== 101) { resolve(client); return; }
        assert.ok(head.includes(`Sec-WebSocket-Accept: ${acceptKey(key)}`), 'the handshake answers the key');
        upgraded = true;
        resolve(client);
      }
      // Server frames are unmasked.
      while (buffer.length >= 2) {
        let length = buffer[1] & 0x7f, at = 2;
        if (length === 126) { if (buffer.length < 4) break; length = buffer.readUInt16BE(2); at = 4; }
        if (buffer.length < at + length) break;
        const opcode = buffer[0] & 0x0f, data = buffer.subarray(at, at + length);
        buffer = buffer.subarray(at + length);
        if (opcode === 1) messages.push(JSON.parse(data.toString('utf8')));
        if (opcode === 8) messages.push({ type: '__close' });
      }
      deliver();
    });
  });
}

(async () => {
  assert.deepEqual(parseStatus({ BackendState: 'Running', Self: { TailscaleIPs: ['100.1.2.3', 'fd7a::1'], DNSName: 'mac.tail1.ts.net.', UserID: 42 }, CurrentTailnet: { MagicDNSEnabled: true } }),
    { state: 'running', ip: '100.1.2.3', dnsName: 'mac.tail1.ts.net', shortName: 'mac', userId: '42' }, 'status reads the IPv4 address, name and user');
  assert.equal(parseStatus({ BackendState: 'NeedsLogin' }).state, 'stopped', 'a signed-out Tailscale is stopped');
  assert.deepEqual(parseWhois({ UserProfile: { ID: 42 }, Node: { ComputedName: 's23', Hostinfo: { OS: 'android' } } }), { userId: '42', device: 's23', os: 'android' });
  assert.equal(findCli({ platform: 'win32', exists: file => file.endsWith('tailscale.exe') && file.includes('Program Files\\') }).endsWith('tailscale.exe'), true, 'Windows finds tailscale.exe');
  assert.equal(findCli({ platform: 'darwin', exists: () => false }), '', 'no CLI, no Tailscale');
  // The Mac binary must be told to act as the CLI when no terminal started the app.
  const { Tailscale } = require('../../src/tailscale');
  let seen = null;
  const probe = new Tailscale({ platform: 'darwin', exists: () => true, run: (file, args, options, done) => { seen = { file, args, env: options.env }; done(null, JSON.stringify({ BackendState: 'Running', Self: { TailscaleIPs: ['100.9.9.9'], DNSName: 'm.t.ts.net.', UserID: 7 } })); } });
  assert.equal((await probe.status()).ip, '100.9.9.9');
  assert.equal(seen.env.TAILSCALE_BE_CLI, '1', 'the Tailscale CLI runs in CLI mode');
  assert.deepEqual(seen.args, ['status', '--json']);

  // Frames round-trip, masked from the client.
  const masked = Buffer.concat([Buffer.from([0x81, 0x80 | 2]), Buffer.from([1, 2, 3, 4]), Buffer.from([0x68 ^ 1, 0x69 ^ 2])]);
  assert.equal(decodeFrames(masked).frames[0].data.toString(), 'hi', 'client frames are unmasked');
  assert.throws(() => decodeFrames(encodeFrame('x')), /Unmasked/, 'an unmasked client frame is refused');

  let who = { userId: 'u1', device: 's23', os: 'android' }, whoisFails = false, tailscaleState = 'running';
  const tailscale = {
    status: async () => tailscaleState === 'running' ? { state: 'running', ip: '127.0.0.1', dnsName: 'mac.tail1.ts.net', shortName: 'mac', userId: 'u1' } : { state: tailscaleState },
    whois: async () => { if (whoisFails) throw new Error('no whois'); return who; }
  };
  const calls = [];
  const request = async (method, params) => { calls.push({ method, params }); return method === 'remote.list' ? { panels: [{ id: 'p1', name: 'Panel', terminals: [{ id: 't1', title: 'claude', running: true, state: 'working' }] }] } : { ok: true }; };
  const views = [];
  const attach = async params => {
    if (params.surface_id === 'missing') throw new Error('Choose a running terminal ID from the list.');
    const listeners = { frame: [], close: [] };
    const view = { params, sent: [], closed: false, result: { surface_id: params.surface_id, title: 'claude' },
      on(type, callback) { listeners[type].push(callback); if (type === 'frame') setImmediate(() => callback({ type: 'paint', data: '\x1b[Hhello', cols: params.cols, rows: params.rows })); return view; },
      send(message) { view.sent.push(message); }, close() { view.closed = true; }, pause() {}, resume() {},
      emit(type, value) { listeners[type].forEach(callback => callback(value)); } };
    views.push(view);
    return view;
  };
  const store = new PhoneWebStore(path.join(dir, 'phone-web.json'));
  const web = new PhoneWeb({ tailscale, request, attach, root, store, port: BASE, pollMs: 60000 });

  await web.start();
  assert.equal(web.status().state, 'off', 'the phone page is off by default');
  assert.equal(web.server, null, 'nothing listens while it is off');

  // Another program holds the first port; the next one is used.
  const blocker = net.createServer().listen(BASE, '127.0.0.1');
  await new Promise(resolve => blocker.once('listening', resolve));
  const on = await web.setEnabled(true);
  assert.equal(on.state, 'on');
  const port = web.listening.port;
  assert.equal(port, BASE + 1, 'a busy port moves to the next one');
  assert.equal(on.url, `http://127.0.0.1:${port}`);
  assert.equal(on.nameUrl, `http://mac:${port}`, 'the MagicDNS name is offered too');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'phone-web.json'), 'utf8')).enabled, true, 'the switch is saved');
  assert.equal(new PhoneWebStore(path.join(dir, 'phone-web.json')).load(), true, 'and read back');

  const page = await fetchRaw({ port });
  assert.equal(page.status, 200);
  assert.ok(page.text.includes(web.token), 'the page carries its token');
  assert.ok(!page.text.includes('__WHITEBOX_TOKEN__'));
  assert.match(page.headers['content-security-policy'], /default-src 'self'/);
  assert.equal(page.headers['x-frame-options'], 'DENY');
  assert.equal((await fetchRaw({ port, host: `mac:${port}` })).status, 200, 'the MagicDNS short name is accepted');
  assert.equal((await fetchRaw({ port, host: `evil.example:${port}` })).status, 421, 'another host name (DNS rebinding) is refused');
  assert.equal((await fetchRaw({ port, pathname: '/phone.js' })).headers['content-type'], 'text/javascript; charset=utf-8');
  assert.equal((await fetchRaw({ port, pathname: '/engine/ghostty-web.es.js' })).status, 200, 'the terminal engine is served');
  assert.equal((await fetchRaw({ port, pathname: '/../package.json' })).status, 404, 'no other files');
  assert.equal((await fetchRaw({ port, pathname: '/engine/../../package.json' })).status, 404);

  who = { userId: 'someone-else', device: 'laptop', os: 'linux' };
  assert.equal((await fetchRaw({ port })).status, 403, 'a different Tailscale user is refused');
  whoisFails = true;
  assert.equal((await fetchRaw({ port })).status, 403, 'a failed lookup refuses (fail closed)');
  whoisFails = false;
  who = { userId: 'u1', device: 's23', os: 'android' };

  assert.equal((await fetchRaw({ port, pathname: '/api/list' })).status, 401, 'the API needs the page token');
  const list = await fetchRaw({ port, pathname: '/api/list', headers: { 'x-whitebox-token': web.token } });
  assert.equal(list.status, 200);
  assert.equal(JSON.parse(list.text).panels[0].terminals[0].id, 't1');
  const sent = await fetchRaw({ port, pathname: '/api/send', method: 'POST', headers: { 'x-whitebox-token': web.token, 'content-type': 'application/json' }, body: { surface_id: 't1', text: '안녕' } });
  assert.equal(sent.status, 200);
  assert.deepEqual(calls.at(-1), { method: 'remote.send', params: { surface_id: 't1', text: '안녕', submit: true } }, 'the compose box sends text and Enter');

  const query = new URLSearchParams({ surface_id: 't1', cols: 40, rows: 20, t: web.token }).toString();
  assert.equal((await openSocket({ port, query, origin: 'http://evil.example' })).status, 403, 'another origin cannot open the live socket');
  assert.equal((await openSocket({ port, query: 'surface_id=t1&t=wrong', origin: `http://127.0.0.1:${port}` })).status, 401, 'the live socket needs the token');
  const live = await openSocket({ port, query, origin: `http://127.0.0.1:${port}` });
  assert.equal(live.status, 101);
  const opened = await live.next();
  assert.equal(opened.type, 'open');
  assert.equal(opened.result.surface_id, 't1');
  const paint = await live.next();
  assert.deepEqual(paint, { type: 'paint', data: '\x1b[Hhello', cols: 40, rows: 20 }, 'the screen arrives first');
  assert.deepEqual(views[0].params, { surface_id: 't1', cols: 40, rows: 20 }, 'the phone size is passed on');
  live.send({ type: 'input', data: 'y' });
  live.send({ type: 'resize', cols: 50, rows: 22 });
  live.send({ type: 'focus' });
  live.send({ type: 'bogus' });
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.deepEqual(views[0].sent, [{ type: 'input', data: 'y' }, { type: 'resize', cols: 50, rows: 22 }, { type: 'focus' }], 'keys, size and focus go to the terminal; nothing else');
  const connected = web.status().devices;
  assert.deepEqual(connected.map(device => [device.device, device.live]), [['s23', true]], 'the connected phone is listed');
  views[0].emit('frame', { type: 'output', data: 'more' });
  assert.deepEqual(await live.next(), { type: 'output', data: 'more' });
  live.end();
  await live.closed;
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(views[0].closed, true, 'closing the page detaches the view');
  assert.equal(web.status().devices[0].live, false);

  const missing = await openSocket({ port, query: new URLSearchParams({ surface_id: 'missing', t: web.token }).toString(), origin: `http://127.0.0.1:${port}` });
  assert.equal((await missing.next()).type, 'end', 'a terminal that is gone ends the socket with a reason');

  // Tailscale signs out: the page closes; it comes back with Tailscale.
  tailscaleState = 'stopped';
  await web.refresh();
  assert.equal(web.status().state, 'tailscale-off');
  assert.equal(web.server, null, 'nothing listens without Tailscale');
  tailscaleState = 'missing';
  await web.refresh();
  assert.equal(web.status().state, 'no-tailscale');
  tailscaleState = 'running';
  await web.refresh();
  assert.equal(web.status().state, 'on');

  const off = await web.setEnabled(false);
  assert.equal(off.state, 'off');
  assert.equal(off.url, '');
  await assert.rejects(fetchRaw({ port }), 'turning it off closes the port');
  await web.dispose();
  blocker.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('PASS phone web: Tailscale address only, same Tailscale user, host and origin checks, page token, live relay, busy port, switch saved');
})().catch(error => { console.error(error); process.exit(1); });
