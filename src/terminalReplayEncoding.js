'use strict';

// Cache only immutable encoding work, never successful writes or transaction
// acknowledgements. Each caller must still atomically persist every ledger.
//
// Records are keyed by the session's replayRevision (bumped on every replay
// mutation) plus length, so the cache never retains a stale copy of an older
// multi-MiB replay string. Encoded bytes are kept only for replays that were
// unchanged since the previous store write: a streaming session would miss on
// every write anyway, so caching it only doubles its memory.
function replayRevision(session) {
  return Number.isSafeInteger(session?.replayRevision) ? session.replayRevision : 0;
}

class TerminalReplayEncoding {
  constructor(maxBytes) { this.maxBytes = maxBytes; this.records = new Map(); this.bytes = 0; }
  prune(sessions) {
    const live = new Set(sessions);
    for (const [session, record] of this.records) if (!live.has(session)) {
      this.release(record); this.records.delete(session);
    }
  }
  release(record) {
    this.bytes -= record.encoded?.length || 0;
    record.encoded = null; record.encodedLength = -1;
  }
  hold(session, record, encoded, length) {
    this.release(record);
    record.encoded = encoded; record.encodedLength = length;
    this.records.delete(session); this.records.set(session, record);
    this.bytes += encoded.length;
    for (const item of this.records.values()) {
      if (this.bytes <= this.maxBytes) break;
      if (item !== record) this.release(item);
    }
    if (this.bytes > this.maxBytes) this.release(record);
  }
  matches(session, record, source) {
    return Boolean(record) && record.revision === replayRevision(session) && record.length === source.length;
  }
  full(session, source, tail) {
    let record = this.records.get(session);
    if (this.matches(session, record, source)) {
      record.stable = true;
      return { replay: record.trimmed ? tail(source) : source, bytes: record.fullBytes };
    }
    if (record) this.release(record);
    const replay = tail(source), encoded = Buffer.from(JSON.stringify(replay), 'utf8');
    record = {
      revision: replayRevision(session), length: source.length, trimmed: replay !== source,
      fullBytes: encoded.length - 2, stable: false, encoded: null, encodedLength: -1,
    };
    // Hand this write's encoding to encode() so it is not computed twice.
    this.hold(session, record, encoded, replay.length);
    return { replay, bytes: record.fullBytes };
  }
  encode(session, replay) {
    const record = this.records.get(session);
    const current = record && record.revision === replayRevision(session);
    // Within one revision, a suffix of the replay is identified by its length.
    if (current && record.encoded && record.encodedLength === replay.length) {
      const encoded = record.encoded;
      if (!record.stable) this.release(record);
      return encoded;
    }
    const encoded = Buffer.from(JSON.stringify(replay), 'utf8');
    if (current && record.stable) this.hold(session, record, encoded, replay.length);
    else if (record) this.release(record);
    return encoded;
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
