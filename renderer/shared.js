'use strict';

/**
 * Small, dependency-free helpers shared by classic renderer scripts.
 * Keeping these on one frozen namespace avoids duplicate implementations
 * without introducing a bundler or changing Electron's preload boundary.
 */
let bootstrapPromise = null;

window.WhiteboxRendererUtils = Object.freeze({
  $: selector => document.querySelector(selector),
  $$: selector => [...document.querySelectorAll(selector)],
  esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  },
  uiLocale() {
    return window.WhiteboxI18n?.getLocaleTag() || 'en-US';
  },
  providerLabel(provider) {
    return ({ claude: 'Claude', gpt: 'GPT', codex: 'GPT', gemini: 'Gemini', grok: 'Grok' })[provider] || 'AI';
  },
  canForkCodexDesktopSession(session) {
    const sourcePlugin = session?.sourcePlugin;
    const sourcePluginId = String(session?.sourcePluginId
      || (typeof sourcePlugin === 'string' ? sourcePlugin : sourcePlugin?.id || (sourcePlugin ? '__present__' : ''))).trim();
    const controlAuthority = String(session?.controlAuthority || '').trim();
    const importMode = String(session?.importMode || '').trim();
    if (String(session?.provider || '').toLowerCase() !== 'codex'
      || String(session?.clientKind || '').toLowerCase() !== 'codex-desktop'
      || session?.parentId
      || sourcePluginId
      || session?.readOnly === true
      || controlAuthority
      || importMode) return false;
    const externalId = String(session.externalId || '').trim();
    const sourceSessionId = String(session.id || '').trim();
    const runId = String(session.runId || '').trim();
    return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,193}$/.test(externalId)
      && sourceSessionId === `codex:${externalId}`
      && !/^(?:terminal|bridge):/i.test(externalId)
      && !/^process-\d+$/i.test(externalId)
      && (!runId || runId !== externalId);
  },
  preserveScrollPositions(targets) {
    const positions = (Array.isArray(targets) ? targets : [targets]).map(target => {
      const element = typeof target === 'string' ? document.querySelector(target) : target;
      return element ? { element, left: element.scrollLeft, top: element.scrollTop } : null;
    }).filter(Boolean);
    return () => {
      positions.forEach(({ element, left, top }) => {
        if (!element.isConnected) return;
        element.scrollLeft = left;
        element.scrollTop = top;
      });
    };
  },
  isScrolledToEnd(element, tolerance = 2) {
    if (!element) return true;
    return element.scrollHeight - element.scrollTop - element.clientHeight <= tolerance;
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
  reportRecoverableError(operation, error) {
    const message = error && error.message ? error.message : String(error || 'unknown error');
    console.warn(`[Whitebox:${operation}] ${message}`);
  },
});
