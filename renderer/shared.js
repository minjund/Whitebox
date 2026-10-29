'use strict';

// One bootstrap request shared by the PTY runtime and the workspace.
let bootstrapPromise = null;
// Retain discovery events arriving before the workspace has mounted.
let latestUpdateState = null;
const unsubscribeEarlyUpdates = window.whitebox?.onUpdateState?.(update => { latestUpdateState = update; });
window.addEventListener('beforeunload', () => unsubscribeEarlyUpdates?.(), { once: true });
window.WhiteboxRendererUtils = Object.freeze({
  $: selector => document.querySelector(selector),
  esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  },
  bootstrap() {
    if (!window.whitebox?.bootstrap) return Promise.reject(new Error('Whitebox preload bridge is unavailable.'));
    if (!bootstrapPromise) {
      bootstrapPromise = Promise.resolve(window.whitebox.bootstrap()).catch(error => {
        bootstrapPromise = null;
        throw error;
      });
    }
    return bootstrapPromise;
  },
  latestUpdateState() { return latestUpdateState; },
  reportRecoverableError(operation, error) {
    const message = error && error.message ? error.message : String(error || 'unknown error');
    console.warn(`[Whitebox:${operation}] ${message}`);
  }
});
window.WhiteboxA11y = Object.freeze({
  announce(message) {
    const status = document.querySelector('#globalStatus');
    if (status) status.textContent = String(message || '');
  },
});
