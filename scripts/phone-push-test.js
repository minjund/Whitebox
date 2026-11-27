'use strict';
// Phone notifications: RFC 8291 encryption matches the RFC's own example,
// the VAPID signature verifies, only browser push services are accepted, the
// keys and phones are kept in a file only this user reads, a phone that is
// gone is dropped, and the panel sync turns into exactly one notification per
// finished turn or question (none for what was already there, none for the
// chat open on the phone, none while the phone page is off). The phone page
// API hands out the key and takes a phone's push address with its page token.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { PhonePush, PhonePushStore, PhoneAlerts, encrypt, vapidKeys, vapidAuthorization, pushEndpoint, clip, MAX_DEVICES } = require('../src/phonePush');
const { PhoneWeb, PhoneWebStore } = require('../src/phoneWeb');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-phone-push-'));
const b64 = value => Buffer.from(value).toString('base64url');

// The receiving side of RFC 8291, written from the RFC, to read what was sent.
function decrypt(body, { privateKey, publicKey, auth }) {
  const salt = body.subarray(0, 16), idlen = body[20], asPublic = body.subarray(21, 21 + idlen);
  const hkdf = (s, ikm, info, n) => crypto.createHmac('sha256', crypto.createHmac('sha256', s).update(ikm).digest()).update(Buffer.concat([info, Buffer.from([1])])).digest().subarray(0, n);
  const ecdh = crypto.createECDH('prime256v1'); ecdh.setPrivateKey(privateKey);
  const ikm = hkdf(auth, ecdh.computeSecret(asPublic), Buffer.concat([Buffer.from('WebPush: info\0'), publicKey, asPublic]), 32);
  const key = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16), nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const data = body.subarray(21 + idlen);
  const decipher = crypto.createDecipheriv('aes-128-gcm', key, nonce);
  decipher.setAuthTag(data.subarray(-16));
  const plain = Buffer.concat([decipher.update(data.subarray(0, -16)), decipher.final()]);
  assert.equal(plain.at(-1), 2, 'one final record');
  return plain.subarray(0, -1).toString('utf8');
}
function phone() {
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return { privateKey: ecdh.getPrivateKey(), publicKey: ecdh.getPublicKey(), auth, keys: { p256dh: b64(ecdh.getPublicKey()), auth: b64(auth) } };
}
function fetchRaw({ port, pathname, method = 'GET', headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method, agent: false, headers: { host: `127.0.0.1:${port}`, ...headers } }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body) req.end(JSON.stringify(body)); else req.end();
  });
}

(async () => {
  // RFC 8291 section 5 / appendix A, byte for byte.
  const vector = encrypt(Buffer.from('When I grow up, I want to be a watermelon'), {
    p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  }, { salt: Buffer.from('DGv6ra1nlYgDCS1FRnbzlw', 'base64url'), senderPrivateKey: Buffer.from('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', 'base64url') });
  assert.equal(vector.toString('base64url'), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
    'aes128gcm output equals the RFC 8291 example');
  assert.equal(decrypt(vector, { privateKey: Buffer.from('q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94', 'base64url'),
    publicKey: Buffer.from('BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', 'base64url'), auth: Buffer.from('BTBZMqHH6r4Tts7J_aSIgg', 'base64url') }),
  'When I grow up, I want to be a watermelon', 'and the test receiver reads it');
  assert.throws(() => encrypt('x', { p256dh: b64(Buffer.alloc(65)), auth: b64(Buffer.alloc(3)) }), /Bad push keys/);
  assert.throws(() => encrypt('x'.repeat(3001), phone().keys), /too long/);

  // VAPID (RFC 8292): ES256 over the push service's origin, verifiable with the public key.
  const keys = vapidKeys();
  const header = vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', keys, Date.UTC(2026, 10, 27));
  const [, jwt, key] = header.match(/^vapid t=([^,]+), k=(.+)$/u);
  const [h, c, s] = jwt.split('.');
  const pub = Buffer.from(key, 'base64url');
  const verifier = crypto.createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: b64(pub.subarray(1, 33)), y: b64(pub.subarray(33)) } });
  assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key: verifier, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')), 'the signature verifies');
  const claims = JSON.parse(Buffer.from(c, 'base64url'));
  assert.deepEqual(claims, { aud: 'https://fcm.googleapis.com', exp: Date.UTC(2026, 10, 27) / 1000 + 12 * 3600, sub: 'mailto:push@whitebox.invalid' }, 'origin audience, 12 h, a contact that names no one');

  // Only the major browsers' push services.
  assert.ok(pushEndpoint('https://fcm.googleapis.com/fcm/send/x'));
  assert.ok(pushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x'));
  for (const bad of ['http://fcm.googleapis.com/x', 'https://fcm.googleapis.com.evil.example/x', 'https://127.0.0.1/x', 'https://evil.example/fcm.googleapis.com', 'https://u:p@fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'nope'])
    assert.equal(pushEndpoint(bad), '', `refused: ${bad}`);

  // Store: keys made once, phones kept, file readable by this user only.
  const file = path.join(dir, 'phone-push.json');
  const sent = [];
  let answer = 201;
  const send = async (endpoint, body, headers) => { sent.push({ endpoint, body, headers }); return { status: typeof answer === 'function' ? answer(endpoint) : answer }; };
  const push = new PhonePush({ store: new PhonePushStore(file), send, now: () => Date.UTC(2026, 10, 27) });
  assert.deepEqual(await push.notify({ title: 'x' }), [], 'no phone, nothing sent');
  const s23 = phone(), tablet = phone();
  assert.throws(() => push.subscribe({ endpoint: 'https://evil.example/x', p256dh: s23.keys.p256dh, auth: s23.keys.auth }), /Unsupported push address/);
  assert.throws(() => push.subscribe({ endpoint: 'https://fcm.googleapis.com/fcm/send/a', p256dh: 'AAAA', auth: s23.keys.auth }), /Bad push keys/);
  const first = push.subscribe({ endpoint: 'https://fcm.googleapis.com/fcm/send/a', ...s23.keys, device: 's23', os: 'android' });
  push.subscribe({ endpoint: 'https://fcm.googleapis.com/fcm/send/b', ...tablet.keys, device: 'tab', os: 'android' });
  assert.equal(push.subscribe({ endpoint: 'https://fcm.googleapis.com/fcm/send/a', ...s23.keys, device: 's23', os: 'android' }).id, first.id, 'the same address again is the same phone');
  assert.equal(push.list().length, 2);
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'the key file is this user\'s only');
  const reloaded = new PhonePush({ store: new PhonePushStore(file), send });
  assert.equal(reloaded.publicKey(), push.publicKey(), 'the key pair is made once and kept');
  assert.deepEqual(reloaded.list().map(item => item.device), ['tab', 's23'], 'phones are kept across restarts (the latest last)');
  assert.deepEqual(Object.keys(reloaded.list()[0]).sort(), ['at', 'device', 'id', 'os'], 'the list shown on the computer has no keys or addresses');

  // Sending: encrypted for each phone, signed, short-lived, one topic per terminal.
  const results = await push.notify({ kind: 'completed', title: 'Claude 작업 완료 · Panel', body: '다 고쳤어요', surfaceId: 't1', tag: 'whitebox:t1' });
  assert.deepEqual(results.map(result => result.status), [201, 201]);
  const toS23 = sent.find(item => item.endpoint.endsWith('/a'));
  assert.deepEqual(JSON.parse(decrypt(toS23.body, s23)), { kind: 'completed', title: 'Claude 작업 완료 · Panel', body: '다 고쳤어요', surfaceId: 't1', tag: 'whitebox:t1' }, 'only that phone can read it');
  assert.equal(toS23.headers['content-encoding'], 'aes128gcm');
  assert.equal(toS23.headers.ttl, '3600', 'a stale notification is dropped after an hour');
  assert.match(toS23.headers.topic, /^[A-Za-z0-9_-]{32}$/u, 'a newer message on the same terminal replaces an undelivered one');
  assert.match(toS23.headers.authorization, new RegExp(`^vapid t=.+, k=${push.publicKey()}$`, 'u'));
  assert.ok(!toS23.body.includes(Buffer.from('다 고쳤어요')), 'the push service sees no words');
  // A phone whose address is gone (410) is dropped; a failing service is kept.
  answer = endpoint => endpoint.endsWith('/b') ? 410 : 500;
  const logged = [];
  push.log = error => logged.push(error.message);
  await push.notify({ title: 'x', tag: 't' });
  assert.deepEqual(push.list().map(item => item.device), ['s23'], 'an unsubscribed phone is forgotten');
  assert.deepEqual(logged, ['Push service answered 500']);
  answer = 201;
  for (let index = 0; index < MAX_DEVICES + 2; index += 1) push.subscribe({ endpoint: `https://fcm.googleapis.com/fcm/send/n${index}`, ...phone().keys });
  assert.equal(push.list().length, MAX_DEVICES, 'at most ten phones');
  assert.equal(push.remove({ id: push.list()[0].id }).removed, 1);

  // Alerts from the panel sync.
  const quiet = new PhonePush({ send });
  quiet.subscribe({ endpoint: 'https://fcm.googleapis.com/fcm/send/q', ...s23.keys, device: 's23' });
  const fired = [];
  quiet.notify = async message => { fired.push(message); return []; };
  let viewing = '', enabled = true;
  const alerts = new PhoneAlerts({ push: quiet, enabled: () => enabled, viewing: id => id === viewing, summary: async member => member.id === 't1' ? '## 끝\n**버그**를 고쳤어요. `npm test` 통과' : '',
    text: (key, values) => ({ phonePushDone: `${values.provider} 작업 완료`, phonePushWaiting: `${values.provider} 확인 필요`, phonePushDoneBody: '작업이 끝났어요.', phonePushWaitingBody: '답을 기다리고 있어요.' })[key] });
  const member = (id, provider, activity) => ({ id, creationId: `c-${id}`, pid: 10, provider, title: `${provider} 터미널`, activity: activity && { creationId: `c-${id}`, pid: 10, ...activity } });
  const sync = members => { alerts.observe({ panels: [{ id: 'p1', name: 'Panel', members }] }); return new Promise(resolve => setImmediate(resolve)); };
  // What a terminal shows when first seen (an old unread answer, a question already up) is not announced.
  await sync([member('t1', 'claude', { state: 'idle', unreadCompletionId: 'old' }), member('t2', 'codex', { state: 'waiting' }), member('t3', '', { state: 'idle', unreadCompletionId: 'x' })]);
  await sync([member('t1', 'claude', { state: 'idle', unreadCompletionId: 'old' }), member('t2', 'codex', { state: 'waiting' })]);
  assert.deepEqual(fired, [], 'nothing on first sight');
  await sync([member('t1', 'claude', { state: 'working', unreadCompletionId: '' }), member('t2', 'codex', { state: 'working' })]);
  await sync([member('t1', 'claude', { state: 'idle', unreadCompletionId: 'u1' }), member('t2', 'codex', { state: 'waiting' })]);
  assert.equal(fired.length, 1, 'a finished turn is told at once; a question waits for a second look');
  assert.deepEqual(fired[0], { kind: 'completed', title: 'Claude 작업 완료 · Panel', body: '끝 버그를 고쳤어요. npm test 통과', surfaceId: 't1', panelId: 'p1', tag: 'whitebox:t1' }, 'the answer\'s first words, without Markdown');
  await sync([member('t1', 'claude', { state: 'idle', unreadCompletionId: 'u1' }), member('t2', 'codex', { state: 'waiting' })]);
  assert.equal(fired.length, 2);
  assert.deepEqual(fired[1], { kind: 'waiting', title: 'Codex 확인 필요 · Panel', body: '답을 기다리고 있어요.', surfaceId: 't2', panelId: 'p1', tag: 'whitebox:t2' });
  await sync([member('t1', 'claude', { state: 'idle', unreadCompletionId: 'u1' }), member('t2', 'codex', { state: 'waiting' })]);
  assert.equal(fired.length, 2, 'each finished turn and each question once');
  // The chat open on the phone is not notified; nor anything while the phone page is off.
  viewing = 't1';
  await sync([member('t1', 'claude', { state: 'idle', unreadCompletionId: 'u2' }), member('t2', 'codex', { state: 'idle' })]);
  viewing = ''; enabled = false;
  await sync([member('t1', 'claude', { state: 'idle', unreadCompletionId: 'u3' }), member('t2', 'codex', { state: 'waiting' })]);
  await sync([member('t1', 'claude', { state: 'idle', unreadCompletionId: 'u3' }), member('t2', 'codex', { state: 'waiting' })]);
  assert.equal(fired.length, 2, 'not while it is on the phone\'s screen or the phone page is off');
  enabled = true;
  // A replaced terminal (new creation) starts over without announcing.
  await sync([{ ...member('t1', 'claude', { state: 'idle', unreadCompletionId: 'u9' }), creationId: 'new', activity: { creationId: 'new', pid: 10, state: 'idle', unreadCompletionId: 'u9' } }]);
  assert.equal(fired.length, 2);
  // Activity of another process is ignored.
  await sync([{ ...member('t1', 'claude', { state: 'idle', unreadCompletionId: 'zz' }), creationId: 'new', activity: { creationId: 'other', pid: 10, state: 'idle', unreadCompletionId: 'zz' } }]);
  assert.equal(fired.length, 2);
  assert.equal(clip('a'.repeat(200)).length, 140, 'long answers are cut');

  // The phone page API.
  let who = { userId: 'u1', device: 's23', os: 'android' };
  const tailscale = { status: async () => ({ state: 'running', ip: '127.0.0.1', dnsName: 'mac.tail1.ts.net', shortName: 'mac', userId: 'u1' }), whois: async () => who };
  const webPush = new PhonePush({ store: new PhonePushStore(path.join(dir, 'web-push.json')), send });
  const chat = { read: async () => ({ available: true, revision: 'r', messages: [] }), send: async () => ({}), stop: async () => ({}) };
  const web = new PhoneWeb({ tailscale, request: async () => ({ panels: [] }), chat, root: path.join(__dirname, '..'), push: webPush, store: new PhoneWebStore(path.join(dir, 'web.json')),
    port: 28790 + crypto.randomInt(500), bindHost: '127.0.0.1', pollMs: 60000 });
  await web.setEnabled(true);
  const port = web.listening.port;
  const token = { 'x-whitebox-token': web.token, 'content-type': 'application/json' };
  const post = (pathname, body, headers = token) => fetchRaw({ port, pathname, method: 'POST', headers, body });
  assert.equal((await post('/api/push', {}, { 'content-type': 'application/json' })).status, 401, 'the key needs the page token');
  const state = JSON.parse((await post('/api/push', { endpoint: '' })).text);
  assert.deepEqual(state, { public_key: webPush.publicKey(), on: false });
  const endpoint = 'https://fcm.googleapis.com/fcm/send/page';
  assert.equal((await post('/api/push/on', { endpoint, keys: s23.keys }, { 'content-type': 'application/json' })).status, 401, 'turning on needs the page token');
  assert.equal((await post('/api/push/on', { endpoint: 'https://evil.example/x', keys: s23.keys })).status, 400, 'a push address outside the push services is refused');
  assert.equal((await post('/api/push/on', { endpoint, keys: { p256dh: 'x', auth: 'y' } })).status, 400, 'bad keys are refused');
  assert.equal((await post('/api/push/on', { endpoint, expirationTime: null, keys: s23.keys })).status, 200, 'PushSubscription.toJSON() is taken as is');
  assert.deepEqual(web.status().pushDevices.map(item => [item.device, item.os]), [['test', '']], 'the phone is named by its Tailscale device');
  assert.equal(JSON.parse((await post('/api/push', { endpoint })).text).on, true, 'the page sees it is on');
  assert.equal(web.viewing('t9'), false);
  await fetchRaw({ port, pathname: '/api/chat?surface_id=t9', headers: token });
  assert.equal(web.viewing('t9'), true, 'a chat the phone just read is on its screen');
  assert.equal((await post('/api/push/off', { endpoint })).status, 200);
  assert.deepEqual(web.status().pushDevices, [], 'turning off forgets the phone');
  const sw = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'phone', 'sw.js'), 'utf8');
  assert.match(sw, /addEventListener\('push'/u, 'the service worker shows pushed notifications');
  assert.match(sw, /notificationclick[\s\S]*\?open=/u, 'and opens that chat when one is tapped');
  await web.dispose();
  who = null;
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('PASS phone push: RFC 8291 example byte for byte, VAPID ES256 verifies, browser push services only, keys made once in a 0600 file, encrypted per phone, gone phones dropped, ten phones at most, one notification per finished turn (first words, no Markdown) and per question (seen twice), nothing on first sight, on the phone\'s screen, or with the page off; page API needs the token and names the phone by its Tailscale device');
})().catch(error => { console.error(error); process.exit(1); });
