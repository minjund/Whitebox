'use strict';

function normalizedSourceSnapshot(value) {
  return {
    sessions: Array.isArray(value?.sessions) ? value.sessions : [],
    statuses: Array.isArray(value?.statuses) ? value.statuses : [],
  };
}

/**
 * Publishes core provider observations immediately from the last known source
 * snapshot while source plugins refresh independently. A slow source adapter
 * must never hold a newly completed core session behind its I/O timeout.
 */
function createSnapshotPublicationCoordinator(options = {}) {
  if (typeof options.scanSource !== 'function' || typeof options.publish !== 'function') {
    throw new TypeError('scanSource와 publish 함수가 필요합니다.');
  }

  const onError = typeof options.onError === 'function' ? options.onError : () => {};
  let lastSourceSnapshot = normalizedSourceSnapshot(options.initialSourceSnapshot);
  let latestCoreSnapshot = null;
  let sourceScanPromise = null;
  let sourceRescanRequested = false;
  let stopped = false;

  function report(scope, error) {
    try {
      onError(scope, error);
    } catch (_reportFailure) {
      // Error reporting must not break future monitor publication.
    }
  }

  async function publishSafely(coreSnapshot, sourceSnapshot) {
    if (stopped || !coreSnapshot) return false;
    try {
      await options.publish(coreSnapshot, sourceSnapshot);
      return true;
    } catch (error) {
      report('publish', error);
      return false;
    }
  }

  function refreshSource() {
    if (stopped) return null;
    if (sourceScanPromise) {
      sourceRescanRequested = true;
      return sourceScanPromise;
    }

    sourceScanPromise = Promise.resolve()
      .then(() => options.scanSource())
      .then(async sourceSnapshot => {
        if (stopped) return;
        lastSourceSnapshot = normalizedSourceSnapshot(sourceSnapshot);
        await publishSafely(latestCoreSnapshot, lastSourceSnapshot);
      })
      .catch(error => report('scan', error))
      .finally(() => {
        sourceScanPromise = null;
        if (sourceRescanRequested && !stopped) {
          sourceRescanRequested = false;
          refreshSource();
        }
      });
    return sourceScanPromise;
  }

  function observeCore(coreSnapshot) {
    if (stopped || !coreSnapshot) return Promise.resolve(false);
    latestCoreSnapshot = coreSnapshot;
    // Invoke publication before starting plugin I/O. publishSnapshot currently
    // performs its projection synchronously, and callers can await this promise
    // without waiting for the source refresh below.
    const immediatePublication = publishSafely(coreSnapshot, lastSourceSnapshot);
    refreshSource();
    return immediatePublication;
  }

  async function whenIdle() {
    while (sourceScanPromise) await sourceScanPromise;
  }

  function stop() {
    stopped = true;
    sourceRescanRequested = false;
  }

  return { observeCore, refreshSource, stop, whenIdle };
}

module.exports = { createSnapshotPublicationCoordinator, normalizedSourceSnapshot };
