'use strict';
// Phone notifications: when an AI terminal finishes the work it was given, or
// stops to wait for an answer, the phones that turned on notifications on the
// phone page get a notification, even with the page closed.
//
// This is standard Web Push. The phone's browser hands the page a push
// address (its browser vendor's push service, e.g. fcm.googleapis.com for
// Chrome on Android) and two keys; Whitebox stores them on this computer.
// - The message is encrypted for that phone only (RFC 8291, aes128gcm): the
//   push service carries it but cannot read it. It does see when one is sent.
// - Whitebox signs each request with its own key pair (VAPID, RFC 8292), made
//   once on this computer. No account, no Whitebox server, nothing about the
//   user goes into the signature.
// - Only push services of the major browsers are accepted as addresses.
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');

// A VAPID "sub" is a contact for the push service. It names no person.
const SUBJECT = 'mailto:push@whitebox.invalid';
const PUSH_HOSTS = [/(^|\.)fcm\.googleapis\.com$/u, /(^|\.)push\.services\.mozilla\.com$/u, /(^|\.)notify\.windows\.com$/u, /(^|\.)push\.apple\.com$/u];
const RECORD_SIZE = 4096;
// The payload plus its padding byte and the GCM tag must fit in one record.
const MAX_PAYLOAD = 3000;
const MAX_DEVICES = 10;
// A notification older than this is no longer worth showing.
const TTL_SECONDS = 3600;
const PROVIDERS = new Set(['claude', 'codex']);

const b64 = value => Buffer.from(value).toString('base64url');
const unb64 = value => Buffer.from(String(value || ''), 'base64url');

function hkdf(salt, ikm, info, length) {
  const prk = crypto.createHmac('sha256', salt).update(ikm).digest();
  return crypto.createHmac('sha256', prk).update(Buffer.concat([info, Buffer.from([1])])).digest().subarray(0, length);
}

// RFC 8291: one aes128gcm record for the phone's p256dh key and auth secret.
// `salt` and `senderPrivateKey` are for the RFC's test vector only.
function encrypt(payload, subscription, { salt = crypto.randomBytes(16), senderPrivateKey = null } = {}) {
  const uaPublic = unb64(subscription.p256dh), authSecret = unb64(subscription.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4 || authSecret.length !== 16) throw new Error('Bad push keys');
  const plaintext = Buffer.from(payload);
  if (plaintext.length > MAX_PAYLOAD) throw new Error('Push message too long');
  const ecdh = crypto.createECDH('prime256v1');
  if (senderPrivateKey) ecdh.setPrivateKey(senderPrivateKey); else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const ikm = hkdf(authSecret, ecdh.computeSecret(uaPublic), Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  // 0x02 marks the last (only) record; no further padding.
  const body = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  Buffer.from(salt).copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header[20] = asPublic.length;
  return Buffer.concat([header, asPublic, body]);
}

function vapidKeys() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: b64(ecdh.getPublicKey()), privateKey: b64(ecdh.getPrivateKey()) };
}

// RFC 8292: a short-lived ES256 JWT for the push service's origin.
function vapidAuthorization(endpoint, keys, now = Date.now()) {
  const publicKey = unb64(keys.publicKey);
  const d = Buffer.alloc(32);
  const raw = unb64(keys.privateKey);
  raw.copy(d, 32 - raw.length);
  const key = crypto.createPrivateKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', d: b64(d), x: b64(publicKey.subarray(1, 33)), y: b64(publicKey.subarray(33, 65)) } });
  const header = b64(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: SUBJECT }));
  const signature = crypto.sign('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${header}.${claims}.${b64(signature)}, k=${keys.publicKey}`;
}

function pushEndpoint(value) {
  let url;
  try { url = new URL(String(value || '')); } catch { return ''; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || String(value).length > 2048) return '';
  return PUSH_HOSTS.some(pattern => pattern.test(url.hostname)) ? url.href : '';
}

function post(endpoint, body, headers, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const request = https.request(endpoint, { method: 'POST', headers: { ...headers, 'content-length': body.length }, timeout: timeoutMs }, response => {
      response.resume();
      response.on('end', () => resolve({ status: response.statusCode }));
    });
    request.on('timeout', () => request.destroy(new Error('Push service timed out')));
    request.on('error', reject);
    request.end(body);
  });
}

// Keys and the phones' push addresses, readable by this user only.
class PhonePushStore {
  constructor(file, fileSystem = fs) { this.file = file; this.fileSystem = fileSystem; }
  load() {
    try {
      const value = JSON.parse(this.fileSystem.readFileSync(this.file, 'utf8'));
      return { keys: value.keys?.publicKey && value.keys?.privateKey ? value.keys : null, devices: Array.isArray(value.devices) ? value.devices : [] };
    } catch { return { keys: null, devices: [] }; }
  }
  save(state) {
    this.fileSystem.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    this.fileSystem.writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
    this.fileSystem.renameSync(temporary, this.file);
  }
}

class PhonePush {
  constructor({ store, send = post, now = Date.now, log = () => {} } = {}) {
    this.store = store;
    this.sendRequest = send;
    this.now = now;
    this.log = log;
    const state = store ? store.load() : { keys: null, devices: [] };
    this.keys = state.keys;
    this.devices = state.devices.filter(device => pushEndpoint(device.endpoint) && device.p256dh && device.auth).slice(-MAX_DEVICES);
  }
  save() { this.store?.save({ keys: this.keys, devices: this.devices }); }
  publicKey() {
    if (!this.keys) { this.keys = vapidKeys(); this.save(); }
    return this.keys.publicKey;
  }
  list() { return this.devices.map(({ id, device, os, at }) => ({ id, device, os, at })); }
  has(endpoint) { return this.devices.some(device => device.endpoint === endpoint); }
  subscribe({ endpoint, p256dh, auth, device = '', os = '' }) {
    const address = pushEndpoint(endpoint);
    if (!address) throw new Error('Unsupported push address');
    const ua = unb64(p256dh), secret = unb64(auth);
    if (ua.length !== 65 || ua[0] !== 4 || secret.length !== 16) throw new Error('Bad push keys');
    this.publicKey();
    const previous = this.devices.find(item => item.endpoint === address);
    const entry = { id: previous?.id || crypto.randomUUID(), endpoint: address, p256dh: b64(ua), auth: b64(secret),
      device: String(device || '').slice(0, 120), os: String(os || '').slice(0, 40), at: this.now() };
    this.devices = [...this.devices.filter(item => item.endpoint !== address), entry].slice(-MAX_DEVICES);
    this.save();
    return { id: entry.id };
  }
  remove({ id = '', endpoint = '' } = {}) {
    const before = this.devices.length;
    this.devices = this.devices.filter(device => device.id !== id && device.endpoint !== endpoint);
    if (this.devices.length !== before) this.save();
    return { removed: before - this.devices.length };
  }
  // Sends one message to every phone. A phone whose address is gone (404/410)
  // is dropped; anything else is logged and kept.
  async notify(message) {
    if (!this.devices.length || !this.keys) return [];
    const payload = JSON.stringify(message);
    // A newer message about the same terminal replaces one not yet delivered.
    const topic = crypto.createHash('sha256').update(String(message.tag || '')).digest('base64url').slice(0, 32);
    const results = await Promise.all(this.devices.map(async device => {
      try {
        const body = encrypt(payload, device);
        const { status } = await this.sendRequest(device.endpoint, body, {
          'content-type': 'application/octet-stream', 'content-encoding': 'aes128gcm', ttl: String(TTL_SECONDS),
          urgency: 'high', topic, authorization: vapidAuthorization(device.endpoint, this.keys, this.now()),
        });
        if (status === 404 || status === 410) return { id: device.id, status, gone: true };
        if (status < 200 || status >= 300) this.log(new Error(`Push service answered ${status}`));
        return { id: device.id, status };
      } catch (error) { this.log(error); return { id: device.id, error: error.message }; }
    }));
    const gone = new Set(results.filter(result => result.gone).map(result => result.id));
    if (gone.size) { this.devices = this.devices.filter(device => !gone.has(device.id)); this.save(); }
    return results;
  }
}

// Turns the panel sync into notifications. A completion is the same exact
// turn-bound evidence as the Dock badge (a new unreadCompletionId); "waiting"
// must be seen on two syncs in a row so a screen caught mid-redraw does not
// notify. What a terminal shows when first seen is never announced.
class PhoneAlerts {
  constructor({ push, enabled = () => true, viewing = () => false, summary = async () => '', text = key => key, log = () => {} } = {}) {
    this.push = push;
    this.enabled = enabled;
    this.viewing = viewing;
    this.summary = summary;
    this.text = text;
    this.log = log;
    this.records = new Map();
  }
  observe(result) {
    const present = new Set();
    for (const panel of result?.panels || []) for (const member of panel.members || []) {
      const activity = member.activity;
      if (!PROVIDERS.has(member.provider) || !activity || activity.creationId !== member.creationId || activity.pid !== member.pid) continue;
      present.add(member.id);
      const identity = `${member.creationId}:${member.pid}`;
      const unread = String(activity.unreadCompletionId || '');
      const waiting = activity.state === 'waiting';
      const record = this.records.get(member.id);
      if (!record || record.identity !== identity) {
        this.records.set(member.id, { identity, unread, waitingSeen: waiting ? 2 : 0 });
        continue;
      }
      if (unread && unread !== record.unread) this.fire('completed', panel, member);
      record.unread = unread;
      record.waitingSeen = waiting ? record.waitingSeen + 1 : 0;
      if (record.waitingSeen === 2) this.fire('waiting', panel, member);
    }
    for (const id of this.records.keys()) if (!present.has(id)) this.records.delete(id);
  }
  fire(kind, panel, member) {
    if (!this.push?.devices.length || !this.enabled() || this.viewing(member.id)) return;
    this.send(kind, panel, member).catch(error => this.log(error));
  }
  async send(kind, panel, member) {
    const provider = member.provider === 'codex' ? 'Codex' : 'Claude';
    const where = [panel.name, member.title].map(value => String(value || '').trim()).filter(Boolean)[0] || '';
    const detail = kind === 'completed' ? await this.summary(member).catch(() => '') : '';
    const head = this.text(kind === 'completed' ? 'phonePushDone' : 'phonePushWaiting', { provider });
    await this.push.notify({
      kind,
      title: where ? `${head} · ${where}` : head,
      body: clip(detail) || this.text(kind === 'completed' ? 'phonePushDoneBody' : 'phonePushWaitingBody', { provider }),
      surfaceId: member.id,
      panelId: panel.id,
      tag: `whitebox:${member.id}`,
    });
  }
}

// The first lines of an answer, without Markdown marks.
function clip(value, max = 140) {
  const text = String(value || '').replace(/```[\s\S]*?```/gu, ' ').replace(/[`*_#>|]/gu, '').replace(/\[([^\]]*)\]\([^)]*\)/gu, '$1').replace(/\s+/gu, ' ').trim();
  const chars = [...text];
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : text;
}

module.exports = { PhonePush, PhonePushStore, PhoneAlerts, encrypt, vapidKeys, vapidAuthorization, pushEndpoint, clip, MAX_DEVICES };
