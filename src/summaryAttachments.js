'use strict';

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

// Screenshots attached in the Summary composer. The renderer sends bytes
// only; the main process decides the type from the file's own signature,
// writes an app-owned copy and later appends that copy's path to the request
// text, which every AI CLI can open.
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;
const ATTACHMENT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(png|jpg|gif|webp)$/u;
const TYPES = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

function attachmentError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

// The extension the bytes really are, or '' for anything that is not a PNG,
// JPEG, GIF or WebP image.
function detectImageType(bytes) {
  if (!bytes || bytes.length < 12) return '';
  const at = (offset, values) => values.every((value, index) => bytes[offset + index] === value);
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (at(0, [0xff, 0xd8, 0xff])) return 'jpg';
  if (at(0, [0x47, 0x49, 0x46, 0x38]) && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) return 'gif';
  if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return 'webp';
  return '';
}

function toBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  return null;
}

// Throws a coded error for anything that must not be saved.
function validateImage(payload) {
  const bytes = toBuffer(payload?.data);
  if (!bytes || !bytes.length) throw attachmentError('ATTACHMENT_EMPTY', '이미지 내용을 읽지 못했어요.');
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw attachmentError('ATTACHMENT_TOO_LARGE', '이미지는 한 장에 10MB까지 첨부할 수 있어요.');
  const declared = typeof payload?.type === 'string' ? payload.type.toLowerCase() : '';
  if (declared && !declared.startsWith('image/')) throw attachmentError('ATTACHMENT_NOT_IMAGE', 'PNG, JPG, GIF, WebP 이미지만 첨부할 수 있어요.');
  const ext = detectImageType(bytes);
  if (!ext) throw attachmentError('ATTACHMENT_NOT_IMAGE', 'PNG, JPG, GIF, WebP 이미지만 첨부할 수 있어요.');
  return { bytes, ext, type: TYPES[ext] };
}

class SummaryAttachments {
  constructor({ directory, now = () => Date.now() }) {
    if (!directory) throw new TypeError('Attachment directory is required.');
    this.directory = path.resolve(directory);
    this.now = now;
  }

  ensureDirectory() {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(this.directory, 0o700); } catch {}
  }

  save(payload) {
    const { bytes, ext, type } = validateImage(payload);
    this.ensureDirectory();
    const id = `${randomUUID()}.${ext}`;
    const file = path.join(this.directory, id);
    fs.writeFileSync(file, bytes, { mode: 0o600, flag: 'wx' });
    try { fs.chmodSync(file, 0o600); } catch {}
    return { id, path: file, type, size: bytes.length };
  }

  // The saved copy for an ID, or null. IDs never carry a directory part.
  file(id) {
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) return null;
    const file = path.join(this.directory, id);
    try {
      const stat = fs.lstatSync(file);
      return stat.isFile() ? file : null;
    } catch { return null; }
  }

  remove(ids) {
    let removed = 0;
    for (const id of (Array.isArray(ids) ? ids : [ids]).slice(0, 50)) {
      const file = this.file(id);
      if (!file) continue;
      try { fs.unlinkSync(file); removed += 1; } catch {}
    }
    return { removed };
  }

  // Every ID must still have its file; a missing one fails the whole send.
  resolve(ids) {
    if (!Array.isArray(ids) || ids.length > MAX_ATTACHMENTS) throw attachmentError('ATTACHMENT_COUNT', '이미지는 한 번에 5장까지 보낼 수 있어요.');
    return ids.map(id => {
      const file = this.file(id);
      if (!file) throw attachmentError('ATTACHMENT_MISSING', '첨부한 이미지를 찾지 못했어요. 이미지를 다시 첨부해 주세요.');
      return file;
    });
  }

  // Copies older than the age limit are removed at startup.
  prune(maxAgeMs = ATTACHMENT_MAX_AGE_MS) {
    let names = [];
    try { names = fs.readdirSync(this.directory); } catch { return { removed: 0 }; }
    let removed = 0;
    const cutoff = this.now() - maxAgeMs;
    for (const name of names) {
      if (!ID_PATTERN.test(name)) continue;
      const file = path.join(this.directory, name);
      try {
        const stat = fs.lstatSync(file);
        if (stat.isFile() && stat.mtimeMs < cutoff) { fs.unlinkSync(file); removed += 1; }
      } catch {}
    }
    return { removed };
  }
}

// A WSL shell reads Windows drives under /mnt/<drive>.
function wslPath(file) {
  const match = /^([a-zA-Z]):[\\/](.*)$/u.exec(String(file || ''));
  return match ? `/mnt/${match[1].toLowerCase()}/${match[2].replace(/\\/gu, '/')}` : String(file || '');
}

// The request text the AI receives: the user's words, then one line per image.
function messageWithAttachments(message, files, label = '첨부 이미지') {
  const text = String(message || '').trim();
  const lines = (files || []).map(file => `${label}: ${file}`);
  return [text, lines.join('\n')].filter(Boolean).join('\n\n');
}

// A summary-send payload as the AI receives it: attachment IDs resolved to
// their saved copies and appended to the text. Without IDs it is unchanged.
async function payloadWithAttachments(payload, { store, shell = async () => '', platform = process.platform, label } = {}) {
  const { attachments, ...rest } = payload || {};
  if (attachments === undefined || (Array.isArray(attachments) && !attachments.length)) return rest;
  let files = store.resolve(attachments);
  if (platform === 'win32' && await shell(rest.targetId) === 'wsl') files = files.map(wslPath);
  return { ...rest, message: messageWithAttachments(rest.message, files, label) };
}

module.exports = {
  SummaryAttachments, validateImage, detectImageType, messageWithAttachments, wslPath, payloadWithAttachments,
  MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, ATTACHMENT_MAX_AGE_MS,
};
