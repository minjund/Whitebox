'use strict';
// The phone page lets in only this computer's own Tailscale user, from the
// right host name, with the page token; it shows Claude and Codex terminals as
// conversations, sends through the guarded chat send and answers with fixed keys.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { PhoneWeb, PhoneWebStore, chatList } = require('../../src/phoneWeb');
const { parseStatus, parseWhois, findCli } = require('../../src/tailscale');

const root = path.join(__dirname, '..', '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-phone-web-'));
const BASE = 27790 + Math.floor(Math.random() * 500);

function fetchRaw({ port, pathname = '/', host, method = 'GET', headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method, headers: { host: host || `127.0.0.1:${port}`, ...headers } }, res => {
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

  const off = await web.setEnabled(false);
  assert.equal(off.state, 'off');
  assert.equal(off.url, '');
  await assert.rejects(fetchRaw({ port }), 'turning it off closes the port');
  await web.dispose();
  blocker.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('PASS phone web: Tailscale address only, same Tailscale user, host check, page token, Claude/Codex list, gzipped conversation (latest 150), guarded send and stop, answer keys only, no terminal engine, busy port, switch saved');
})().catch(error => { console.error(error); process.exit(1); });
