'use strict';
// The phone page lets in only this computer's own Tailscale user, from the
// right host name, with the page token; it shows Claude and Codex terminals as
// conversations, sends through the guarded chat send and answers with fixed keys.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { PhoneWeb, PhoneWebStore, chatList } = require('../../src/phoneWeb');
const { parseStatus, parseWhois, parsePem, findCli } = require('../../src/tailscale');

const root = path.join(__dirname, '..', '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-phone-web-'));
const BASE = 27790 + Math.floor(Math.random() * 500);

function fetchRaw({ port, pathname = '/', host, method = 'GET', headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method, agent: false, headers: { host: host || `127.0.0.1:${port}`, ...headers } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: res.headers, raw, text: (res.headers['content-encoding'] === 'gzip' ? zlib.gunzipSync(raw) : raw).toString('utf8') });
      });
    });
    req.on('error', reject);
    if (body) req.end(JSON.stringify(body)); else req.end();
  });
}

function fetchTls({ port, pathname = '/', name }) {
  return new Promise((resolve, reject) => {
    const req = https.request({ host: '127.0.0.1', port, path: pathname, agent: false, servername: name, ca: fetchTls.ca, headers: { host: `${name}:${port}` } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

// A self-signed certificate for one DNS name, built with node:crypto only
// (DER by hand), standing in for the one Tailscale hands out.
function selfSigned(name) {
  const length = n => { if (n < 128) return Buffer.from([n]); const bytes = []; while (n) { bytes.unshift(n & 255); n >>= 8; } return Buffer.from([0x80 | bytes.length, ...bytes]); };
  const tlv = (tag, body) => Buffer.concat([Buffer.from([tag]), length(body.length), body]);
  const seq = (...parts) => tlv(0x30, Buffer.concat(parts));
  const oid = text => {
    const parts = text.split('.').map(Number), out = [40 * parts[0] + parts[1]];
    for (const value of parts.slice(2)) { const bytes = [value & 127]; let rest = value >> 7; while (rest) { bytes.unshift((rest & 127) | 128); rest >>= 7; } out.push(...bytes); }
    return tlv(6, Buffer.from(out));
  };
  const time = date => tlv(0x17, Buffer.from(`${date.toISOString().replace(/[-:T]/g, '').slice(2, 14)}Z`));
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const subject = seq(tlv(0x31, seq(oid('2.5.4.3'), tlv(0x0c, Buffer.from(name)))));
  const algorithm = seq(oid('1.2.840.10045.4.3.2'));
  const tbs = seq(tlv(0xa0, tlv(2, Buffer.from([2]))), tlv(2, Buffer.from([0x12, 0x34, 0x56])), algorithm, subject,
    seq(time(new Date(Date.now() - 86400000)), time(new Date(Date.now() + 30 * 86400000))), subject, publicKey.export({ type: 'spki', format: 'der' }),
    tlv(0xa3, seq(seq(oid('2.5.29.17'), tlv(4, seq(tlv(0x82, Buffer.from(name))))))));
  const der = seq(tbs, algorithm, tlv(3, Buffer.concat([Buffer.from([0]), crypto.sign('sha256', tbs, privateKey)])));
  return { cert: `-----BEGIN CERTIFICATE-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`, key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
}

(async () => {
  assert.deepEqual(parseStatus({ BackendState: 'Running', Self: { TailscaleIPs: ['100.1.2.3', 'fd7a::1'], DNSName: 'mac.tail1.ts.net.', UserID: 42 }, CurrentTailnet: { MagicDNSEnabled: true }, CertDomains: ['mac.tail1.ts.net'] }),
    { state: 'running', ip: '100.1.2.3', dnsName: 'mac.tail1.ts.net', shortName: 'mac', userId: '42', certDomains: ['mac.tail1.ts.net'] }, 'status reads the IPv4 address, name, user and the names HTTPS certificates exist for');
  assert.deepEqual(parseStatus({ BackendState: 'Running', Self: { TailscaleIPs: ['100.1.2.3'], DNSName: 'mac.tail1.ts.net.', UserID: 42 } }).certDomains, [], 'no CertDomains: HTTPS is off in the tailnet');
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
  const sample = selfSigned('mac.tail1.ts.net');
  const certProbe = new Tailscale({ platform: 'darwin', exists: () => true, run: (file, args, options, done) => { seen = { args, timeout: options.timeout }; done(null, `${sample.cert}${sample.key}`); } });
  assert.deepEqual(await certProbe.cert('mac.tail1.ts.net'), { cert: sample.cert, key: sample.key }, 'the certificate and key are read from stdout');
  assert.deepEqual(seen.args, ['cert', '--min-validity', '168h', '--cert-file', '-', '--key-file', '-', 'mac.tail1.ts.net'], 'nothing is written to disk (the Mac CLI is sandboxed)');
  assert.ok(seen.timeout >= 60000, 'a first certificate may take a minute');
  assert.throws(() => parsePem('error: your tailnet does not have HTTPS enabled'), /did not return a certificate/);

  let who = { userId: 'u1', device: 's23', os: 'android' }, whoisFails = false, tailscaleState = 'running';
  const tailscale = {
    status: async () => tailscaleState === 'running' ? { state: 'running', ip: '127.0.0.1', dnsName: 'mac.tail1.ts.net', shortName: 'mac', userId: 'u1' } : { state: tailscaleState },
    whois: async () => { if (whoisFails) throw new Error('no whois'); return who; }
  };
  const calls = [];
  const panels = [{ id: 'p1', name: 'Panel', terminals: [
    { id: 't1', title: 'claude', running: true, provider: 'claude', state: 'working' },
    { id: 't2', title: 'zsh', running: true, provider: '', state: 'idle' },
    { id: 't3', title: 'gemini', running: true, provider: 'gemini', state: 'idle' },
    { id: 't4', title: 'codex', running: false, provider: 'codex', state: 'idle' }] },
    { id: 'p2', name: 'Shells', terminals: [{ id: 't5', title: 'zsh', running: true, provider: '' }] }];
  const request = async (method, params) => { calls.push({ method, params }); return method === 'remote.list' ? { panels } : { ok: true }; };
  const messages = Array.from({ length: 200 }, (_, index) => ({ id: `m${index}`, role: index % 2 ? 'assistant' : 'user', text: `말 ${index} `.repeat(20), timestamp: '' }));
  const chatCalls = [];
  const chat = {
    read: async params => { chatCalls.push({ read: params }); return params.revision === 'r1' ? { available: true, unchanged: true, revision: 'r1', state: 'waiting', question: 'Do you want to proceed?\n❯ 1. Yes\n  2. No' }
      : { available: true, revision: 'r1', provider: 'claude', providerPid: 42, creationId: 'c1', state: 'working', messages }; },
    send: async payload => { chatCalls.push({ send: payload }); return { ok: true, job: { id: payload.id } }; },
    stop: async payload => { chatCalls.push({ stop: payload }); return { ok: true }; },
  };
  const store = new PhoneWebStore(path.join(dir, 'phone-web.json'));
  const web = new PhoneWeb({ tailscale, request, chat, root, store, port: BASE, pollMs: 60000 });

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
  assert.equal((await fetchRaw({ port, pathname: '/engine/ghostty-web.es.js' })).status, 404, 'no terminal engine: the phone shows conversations only');
  const shared = await fetchRaw({ port, pathname: '/chat-render.js', headers: { 'accept-encoding': 'gzip' } });
  assert.equal(shared.status, 200);
  assert.equal(shared.text, fs.readFileSync(path.join(root, 'renderer', 'chat-render.js'), 'utf8'), 'the desktop chat renderer is served as is');
  assert.equal(shared.headers['content-encoding'], 'gzip', 'text is gzipped for the phone');
  assert.ok(shared.raw.length < shared.text.length / 2);
  assert.equal((await fetchRaw({ port, pathname: '/chat.css' })).text, fs.readFileSync(path.join(root, 'renderer', 'styles-terminal-chat.css'), 'utf8'), 'and the desktop chat styles');
  assert.doesNotMatch(page.headers['content-security-policy'], /wasm|ws:/, 'no WebAssembly or socket is allowed any more');
  assert.equal((await fetchRaw({ port, pathname: '/../package.json' })).status, 404, 'no other files');
  assert.equal((await fetchRaw({ port, pathname: '/terminal-chat.js' })).status, 404, 'only the shared files from renderer/');

  who = { userId: 'someone-else', device: 'laptop', os: 'linux' };
  assert.equal((await fetchRaw({ port })).status, 403, 'a different Tailscale user is refused');
  whoisFails = true;
  assert.equal((await fetchRaw({ port })).status, 403, 'a failed lookup refuses (fail closed)');
  whoisFails = false;
  who = { userId: 'u1', device: 's23', os: 'android' };

  const token = { 'x-whitebox-token': web.token };
  const post = (pathname, body) => fetchRaw({ port, pathname, method: 'POST', headers: { ...token, 'content-type': 'application/json' }, body });
  assert.equal((await fetchRaw({ port, pathname: '/api/list' })).status, 401, 'the API needs the page token');
  const list = await fetchRaw({ port, pathname: '/api/list', headers: token });
  assert.equal(list.status, 200);
  assert.deepEqual(JSON.parse(list.text), { panels: [{ id: 'p1', name: 'Panel', terminals: [panels[0].terminals[0]] }] }, 'only running Claude and Codex terminals are listed; shells, Gemini and empty panels are hidden');
  assert.deepEqual(chatList({ panels: [{ id: 'p', name: 'n', terminals: [{ id: 'a', running: true, provider: 'codex' }] }] }).panels[0].terminals.map(item => item.id), ['a'], 'Codex is listed');

  const read = await fetchRaw({ port, pathname: '/api/chat?surface_id=t1', headers: { ...token, 'accept-encoding': 'gzip' } });
  assert.equal(read.status, 200);
  const conversation = JSON.parse(read.text);
  assert.equal(read.headers['content-encoding'], 'gzip', 'the conversation is gzipped');
  assert.equal(conversation.messages.length, 150, 'the phone gets the latest 150 rows');
  assert.equal(conversation.messages.at(-1).id, 'm199');
  assert.equal(conversation.truncated, true, 'and is told there is more');
  assert.deepEqual(chatCalls.at(-1), { read: { surfaceId: 't1', revision: '' } });
  const again = JSON.parse((await fetchRaw({ port, pathname: '/api/chat?surface_id=t1&revision=r1', headers: token })).text);
  assert.equal(again.unchanged, true, 'an unchanged conversation is not sent again');
  assert.match(again.question, /1\. Yes/, 'a waiting AI comes with the screen words of its question');

  const target = { panel_id: 'p1', surface_id: 't1', creation_id: 'c1', provider_pid: 42, provider: 'claude' };
  const id = '0b3a5c1e-1111-4222-8333-444455556666';
  assert.equal((await post('/api/chat/send', { id, text: '고쳐줘', ...target })).status, 200);
  assert.deepEqual(chatCalls.at(-1), { send: { id, message: '고쳐줘', groupId: 'p1', targetId: 't1', targetCreationId: 'c1', targetProviderPid: 42, targetProvider: 'claude' } },
    'a message goes through the guarded chat send with the exact AI session');
  assert.equal((await post('/api/chat/stop', target)).status, 200);
  assert.deepEqual(chatCalls.at(-1), { stop: { groupId: 'p1', targetId: 't1', targetCreationId: 'c1', targetProviderPid: 42, targetProvider: 'claude' } }, 'stop names the exact AI session');
  for (const key of ['1', '2', '3', 'enter', 'esc']) {
    assert.equal((await post('/api/key', { surface_id: 't1', key })).status, 200);
    assert.deepEqual(calls.at(-1), { method: 'remote.key', params: { surface_id: 't1', key } });
  }
  const before = calls.length;
  for (const key of ['ctrl-c', 'y', 'up', 'tab']) assert.equal((await post('/api/key', { surface_id: 't1', key })).status, 400, `${key} is not an answer key`);
  assert.equal(calls.length, before, 'refused keys never reach the terminal');
  assert.equal((await post('/api/send', { surface_id: 't1', text: 'ls' })).status, 404, 'there is no raw text input');
  assert.equal((await fetchRaw({ port, pathname: '/api/attach', headers: token })).status, 404, 'and no live terminal');
  const connected = web.status().devices;
  assert.deepEqual(connected.map(device => [device.device, device.live]), [['s23', true]], 'a phone that polls is listed as connected');

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

  assert.equal(web.status().https, false, 'no CertDomains: the page stays on http');
  assert.equal(web.status().httpsReason, 'https-off', 'and says HTTPS is off in the tailnet');
  assert.equal((await fetchRaw({ port, pathname: '/sw.js' })).headers['content-type'], 'text/javascript; charset=utf-8', 'the service worker is served');
  const manifest = JSON.parse((await fetchRaw({ port, pathname: '/manifest.webmanifest' })).text);
  assert.equal(manifest.display, 'standalone');
  for (const icon of manifest.icons) {
    const served = await fetchRaw({ port, pathname: icon.src });
    assert.equal(served.status, 200, `${icon.src} is served`);
    const [w, h] = [served.raw.readUInt32BE(16), served.raw.readUInt32BE(20)];
    assert.equal(`${w}x${h}`, icon.sizes, `${icon.src} really is ${icon.sizes}`);
  }
  assert.deepEqual(manifest.icons.map(icon => icon.sizes).sort(), ['192x192', '512x512'], 'Chrome needs a 192 and a 512 icon to install');

  const off = await web.setEnabled(false);
  assert.equal(off.state, 'off');
  assert.equal(off.url, '');
  await assert.rejects(fetchRaw({ port }), 'turning it off closes the port');
  await web.dispose();
  blocker.close();

  // HTTPS on: the certificate arrives in the background, then the same port
  // serves https and plain http only redirects there.
  const name = 'mac.tail1.ts.net';
  fetchTls.ca = sample.cert;
  let certCalls = 0, releaseCert;
  const certGate = new Promise(resolve => { releaseCert = resolve; });
  const secureTailscale = {
    status: async () => ({ state: 'running', ip: '127.0.0.1', dnsName: name, shortName: 'mac', userId: 'u1', certDomains: [name] }),
    whois: async () => who,
    cert: async domain => { certCalls += 1; assert.equal(domain, name); await certGate; return sample; }
  };
  const secureStore = new PhoneWebStore(path.join(dir, 'secure.json'));
  const secureWeb = new PhoneWeb({ tailscale: secureTailscale, request, chat, root, store: secureStore, port: BASE + 20, pollMs: 60000 });
  const first = await secureWeb.setEnabled(true);
  assert.equal(first.state, 'on', 'the page opens at once on http while the certificate is on its way');
  assert.equal(first.https, false);
  assert.equal(first.httpsReason, 'cert-pending');
  const securePort = secureWeb.listening.port;
  assert.equal((await fetchRaw({ port: securePort })).status, 200, 'http works meanwhile');
  const changed = new Promise(resolve => secureWeb.once('change', resolve));
  releaseCert();
  const switched = await changed;
  assert.equal(switched.https, true, 'the page switches to https when the certificate lands');
  assert.equal(switched.url, `https://${name}:${securePort}`, 'on the same port, under the Tailscale name');
  assert.equal(switched.nameUrl, '', 'the http short name is not offered on https');
  const securePage = await fetchTls({ port: securePort, name });
  assert.equal(securePage.status, 200, 'https serves the page with the Tailscale certificate');
  assert.ok(securePage.text.includes(secureWeb.token));
  assert.equal((await fetchTls({ port: securePort, pathname: '/sw.js', name })).status, 200, 'and the service worker');
  const moved = await fetchRaw({ port: securePort, pathname: '/index.html?x=1' });
  assert.equal(moved.status, 308, 'plain http now only redirects');
  assert.equal(moved.headers.location, `https://${name}:${securePort}/index.html`, 'to the https address (an old http bookmark keeps working)');
  assert.equal((await fetchRaw({ port: securePort, host: `evil.example:${securePort}` })).status, 421, 'the redirect keeps the host check');
  who = { userId: 'someone-else', device: 'laptop', os: 'linux' };
  assert.equal((await fetchRaw({ port: securePort })).status, 403, 'and the same-user check');
  assert.equal((await fetchTls({ port: securePort, name })).status, 403, 'https too');
  who = { userId: 'u1', device: 's23', os: 'android' };
  await secureWeb.refresh();
  assert.equal(certCalls, 1, 'a fresh certificate is not asked for again on every refresh');
  assert.equal(secureWeb.status().https, true);
  await secureWeb.dispose();

  // A failed certificate keeps http and waits before asking again.
  let failures = 0;
  const failing = new PhoneWeb({ tailscale: { ...secureTailscale, cert: async () => { failures += 1; throw new Error('HTTPS is not enabled'); } }, request, chat, root,
    store: new PhoneWebStore(path.join(dir, 'failing.json')), port: BASE + 40, pollMs: 60000, log: () => {} });
  await failing.setEnabled(true);
  await new Promise(resolve => setTimeout(resolve, 50));
  await failing.refresh();
  assert.equal(failing.status().https, false);
  assert.equal(failing.status().httpsReason, 'cert-failed', 'a failed certificate is reported');
  assert.equal(failures, 1, 'and not retried at once');
  assert.equal((await fetchRaw({ port: failing.listening.port })).status, 200, 'the page still works on http');
  await failing.dispose();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('PASS phone web: Tailscale address only, same Tailscale user, host check, page token, Claude/Codex list, gzipped conversation (latest 150), guarded send and stop, answer keys only, no terminal engine, busy port, switch saved; installable app: service worker, 192/512 icons, https from the Tailscale certificate on the same port with http redirect, cert-pending/https-off/cert-failed reasons');
})().catch(error => { console.error(error); process.exit(1); });
