'use strict';

// Cache only immutable encoding work, never successful writes or transaction
// acknowledgements. Each caller must still atomically persist every ledger.
class TerminalReplayEncoding {
  constructor(maxBytes) { this.maxBytes = maxBytes; this.records = new Map(); this.bytes = 0; }
  prune(sessions) {
    const live = new Set(sessions);
    for (const [session, record] of this.records) if (!live.has(session)) {
      this.bytes -= record.encoded?.length || 0; this.records.delete(session);
    }
  }
  remember(session, record, replay, encoded) {
    this.bytes -= record.encoded?.length || 0;
    record.encodedReplay = replay; record.encoded = encoded;
    this.records.delete(session); this.records.set(session, record);
    this.bytes += encoded.length;
    for (const item of this.records.values()) {
      if (this.bytes <= this.maxBytes) break;
      this.bytes -= item.encoded?.length || 0; item.encoded = null; item.encodedReplay = null;
    }
    return encoded;
  }
  full(session, source, tail) {
    let record = this.records.get(session);
    if (record?.source === source) return { replay: record.fullReplay, bytes: record.fullBytes };
    if (record) this.bytes -= record.encoded?.length || 0;
    const replay = tail(source), encoded = Buffer.from(JSON.stringify(replay), 'utf8');
    record = { source, fullReplay: replay, fullBytes: encoded.length - 2, encoded: null };
    this.records.delete(session); this.records.set(session, record);
    this.remember(session, record, replay, encoded);
    return { replay, bytes: record.fullBytes };
  }
  encode(session, replay) {
    const record = this.records.get(session);
    if (record?.encoded && record.encodedReplay === replay) return record.encoded;
    const encoded = Buffer.from(JSON.stringify(replay), 'utf8');
    return record ? this.remember(session, record, replay, encoded) : encoded;
  }
}

// Preserve JSON.stringify's field order and bytes without converting all the
// unchanged replay strings to JSON and UTF-8 on every metadata-only mutation.
function encodedStore(records, sessions, provenance, version, cache) {
  const parts = [Buffer.from(`{"version":${version},"sessions":[`)];
  records.forEach((record, index) => {
    if (index) parts.push(Buffer.from(','));
    const fields = Object.entries(record), at = fields.findIndex(([key]) => key === 'replay');
    const prefix = JSON.stringify(Object.fromEntries(fields.slice(0, at)));
    const suffix = JSON.stringify(Object.fromEntries(fields.slice(at + 1)));
    parts.push(Buffer.from(prefix === '{}' ? '{"replay":' : prefix.slice(0, -1) + ',"replay":'));
    parts.push(cache.encode(sessions[index], record.replay));
    parts.push(Buffer.from(suffix === '{}' ? '}' : ',' + suffix.slice(1)));
  });
  parts.push(Buffer.from(provenance.length ? `],"comprehensionProvenance":${JSON.stringify(provenance)}}` : ']}'));
  return Buffer.concat(parts);
}

module.exports = { TerminalReplayEncoding, encodedStore };
