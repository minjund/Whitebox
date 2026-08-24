'use strict';

const TRANSIENT_WINDOWS_LOG_READ_CODES = new Set(['EBUSY', 'EPERM']);

function readWindowsUpdateLogForPolling(readOperation) {
  if (typeof readOperation !== 'function') {
    throw new TypeError('The Windows update log read operation must be a function.');
  }
  try {
    const rawLog = readOperation();
    if (typeof rawLog !== 'string') {
      throw new TypeError('The Windows update log read result must be a primitive string.');
    }
    return { status: 'read', rawLog };
  } catch (error) {
    if (!TRANSIENT_WINDOWS_LOG_READ_CODES.has(error && error.code)) throw error;
    return { status: 'retry', error };
  }
}

module.exports = { readWindowsUpdateLogForPolling };
