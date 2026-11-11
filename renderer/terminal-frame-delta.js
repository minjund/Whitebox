(function exposeTerminalFrameDelta(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WhiteboxTerminalFrameDelta = api;
})(typeof window !== 'undefined' ? window : globalThis, function createTerminalFrameDelta() {
  'use strict';

  // Main keeps the last full frame per terminal and refreshes its time from
  // each matching `unchanged` marker. A full resend on this beat (below the
  // 10 s readiness window) recovers if main lost or replaced the stored frame.
  const DEFAULT_HEARTBEAT_MS = 8_000;
  const FIELDS = ['creationId', 'text', 'readinessText', 'inputDraft', 'bracketedPaste', 'outputSequence'];

  function sameFrame(previous, frame, identity) {
    if (!previous || previous.identity !== identity) return false;
    return FIELDS.every(key => previous.frame[key] === frame[key]);
  }

  // Send a pane's screen text only when it changed since the last delivered
  // frame. Unchanged panes send a small marker; main keeps the previous
  // frame and marks it current when identity and output sequence match.
  function createFrameTracker({ heartbeatMs = DEFAULT_HEARTBEAT_MS, now = () => Date.now() } = {}) {
    const sent = new Map();
    function prepare(frames, identities = new Map()) {
      const at = now();
      const full = new Map();
      const outgoing = (Array.isArray(frames) ? frames : []).map(frame => {
        const id = String(frame?.id || '');
        const identity = String(identities.get(id) ?? '');
        const previous = sent.get(id);
        if (sameFrame(previous, frame, identity) && at - previous.at < heartbeatMs) {
          return { id, creationId: frame.creationId, outputSequence: frame.outputSequence, unchanged: true };
        }
        full.set(id, { frame, identity, at });
        return frame;
      });
      // Record only after main accepted the batch; a failed send resends full.
      const commit = () => {
        const present = new Set(outgoing.map(frame => String(frame?.id || '')));
        for (const id of [...sent.keys()]) if (!present.has(id)) sent.delete(id);
        for (const [id, record] of full) sent.set(id, record);
      };
      return { frames: outgoing, commit };
    }
    return { prepare, forget: id => sent.delete(String(id || '')), size: () => sent.size };
  }

  return { createFrameTracker, DEFAULT_HEARTBEAT_MS };
});
