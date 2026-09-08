'use strict';

// Coalesce bursts without letting continuous output postpone the first scan.
function createMonitorScanScheduler(scan, clock = {}) {
  const now = clock.now || Date.now;
  const schedule = clock.setTimeout || setTimeout;
  const cancel = clock.clearTimeout || clearTimeout;
  let timer = null;
  let dueAt = 0;
  function stop() {
    if (timer !== null) cancel(timer);
    timer = null;
    dueAt = 0;
  }
  function request(delayMs = 80) {
    const delay = Math.max(0, Number(delayMs) || 0);
    const nextAt = now() + delay;
    if (timer !== null && dueAt <= nextAt) return;
    stop();
    dueAt = nextAt;
    timer = schedule(() => {
      timer = null;
      dueAt = 0;
      scan();
    }, delay);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }
  return { request, stop };
}

module.exports = { createMonitorScanScheduler };
