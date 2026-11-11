'use strict';

// V8 represents `text.slice(...)` of a long string as a view that keeps the
// whole parent alive. A short excerpt stored for hours can therefore pin a
// multi-megabyte tool output or transcript. Copy through a UTF-16 buffer so the
// result owns its characters (lossless, including unpaired surrogates).
function detach(value) {
  return typeof value === 'string' && value.length ? Buffer.from(value, 'utf16le').toString('utf16le') : value;
}

// Truncate `text` to `limit` characters (optionally with a suffix) without
// retaining the original string.
function detachedPrefix(text, limit, suffix = '') {
  const value = String(text ?? '');
  return value.length > limit ? detach(value.slice(0, Math.max(0, limit)) + suffix) : value;
}

module.exports = { detach, detachedPrefix };
