'use strict';

const { randomUUID } = require('node:crypto');
const { deflateSync } = require('node:zlib');

// Only native, process-bound AI turn evidence may create unread completions.
// An acknowledgement names the exact completion so a late click cannot erase
// the next answer. One unread answer per terminal is counted.
class TerminalCompletionTracker {
  constructor(onChange = () => {}) { this.entries = new Map(); this.onChange = onChange; this.count = 0; }
  update(result, groups) {
    const roster = new Map((groups || []).flatMap(group => group.members || []).map(member => [member.id, member]));
    for (const [id, entry] of this.entries) {
      const member = roster.get(id);
      if (!member || member.creationId !== entry.creationId || member.pid !== entry.pid) this.entries.delete(id);
    }
    for (const panel of result.panels || []) for (const member of panel.members || []) {
      const activity = member.activity;
      if (!activity || activity.creationId !== member.creationId || activity.pid !== member.pid) continue;
      let entry = this.entries.get(member.id);
      if (!entry) {
        entry = { creationId: member.creationId, pid: member.pid, armed: '', completed: '', unread: '' };
        this.entries.set(member.id, entry);
      }
      const turn = activity.requestId && activity.providerPid ? `${activity.providerPid}:${activity.requestId}` : '';
      if (turn && activity.state === 'working') entry.armed = turn;
      if (turn && activity.completed && activity.state === 'idle' && entry.completed !== turn) {
        if (entry.armed === turn) entry.unread = randomUUID();
        entry.completed = turn; entry.armed = '';
      }
    }
    this.publish();
    return { ...result, panels: (result.panels || []).map(panel => ({ ...panel, members: (panel.members || []).map(member => ({
      ...member, activity: member.activity ? { ...member.activity, unreadCompletionId: this.entries.get(member.id)?.unread || '' } : member.activity,
    })) })) };
  }
  read(payload) {
    const entry = this.entries.get(payload?.id);
    if (entry && entry.creationId === payload.creationId && entry.pid === payload.pid && entry.unread === payload.completionId) entry.unread = '';
    this.publish();
    return { count: this.count };
  }
  publish() {
    const count = [...this.entries.values()].filter(entry => entry.unread).length;
    if (count !== this.count) { this.count = count; this.onChange(count); }
  }
}

// NativeImage accepts PNG on every target. Generate a small crisp numeric
// overlay without SVG support, a hidden renderer, or external image libraries.
function badgePng(count) {
  const glyphs = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001', '111100111001111', '111100111101111', '111001001001001', '111101111101111', '111101111001111'];
  const label = count > 99 ? '99+' : String(count);
  const size = 32, pixels = Buffer.alloc(size * (1 + size * 4));
  const dot = (x, y, color) => { const at = y * 129 + 1 + x * 4; color.forEach((v, i) => { pixels[at + i] = v; }); };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if ((x - 15.5) ** 2 + (y - 15.5) ** 2 <= 15.5 ** 2) dot(x, y, [211, 44, 54, 255]);
  }
  const scale = label.length === 1 ? 4 : 2, width = label.length * 4 * scale - scale;
  [...label].forEach((char, index) => {
    const glyph = char === '+' ? '000010111010000' : glyphs[Number(char)];
    for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) if (glyph[y * 3 + x] === '1') {
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) dot(Math.floor((32 - width) / 2) + index * 4 * scale + x * scale + dx, Math.floor((32 - 5 * scale) / 2) + y * scale + dy, [255, 255, 255, 255]);
    }
  });
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]); let crc = 0xffffffff;
    for (const byte of body) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
    const out = Buffer.alloc(body.length + 8); out.writeUInt32BE(data.length); body.copy(out, 4); out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, out.length - 4); return out;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(32); header.writeUInt32BE(32, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

function applyCompletionBadge({ app, window, nativeImage, platform = process.platform }, count) {
  if (platform === 'win32') {
    if (window && !window.isDestroyed()) window.setOverlayIcon(count ? nativeImage.createFromBuffer(badgePng(count)) : null, count ? `${count} unread completed AI tasks` : '');
  } else app.setBadgeCount(count);
}

module.exports = { TerminalCompletionTracker, applyCompletionBadge, badgePng };
