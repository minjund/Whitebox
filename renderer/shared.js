'use strict';

/**
 * Small, dependency-free helpers shared by classic renderer scripts.
 * Keeping these on one frozen namespace avoids duplicate implementations
 * without introducing a bundler or changing Electron's preload boundary.
 */
let bootstrapPromise = null;
const dateTimeFormatCache = new Map();
let dateTimeFormatTimeZone = "";
let dateTimeFormatOffset = Number.NaN;
let dateTimeFormatZoneCheckedAt = 0;

function refreshDateTimeFormatZone(force = false) {
  const now = Date.now();
  const offset = new Date().getTimezoneOffset();
  if (!force && offset === dateTimeFormatOffset && now - dateTimeFormatZoneCheckedAt < 30_000) return;
  let timeZone = `offset:${offset}`;
  try {
    timeZone = new Intl.DateTimeFormat().resolvedOptions().timeZone || timeZone;
  } catch (_unsupportedTimeZone) {
    // The numeric offset still invalidates formatters when the host zone moves.
  }
  if (timeZone !== dateTimeFormatTimeZone || offset !== dateTimeFormatOffset) dateTimeFormatCache.clear();
  dateTimeFormatTimeZone = timeZone;
  dateTimeFormatOffset = offset;
  dateTimeFormatZoneCheckedAt = now;
}

refreshDateTimeFormatZone(true);
if (typeof window.addEventListener === "function") {
  window.addEventListener("focus", () => refreshDateTimeFormatZone(true));
}
if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshDateTimeFormatZone(true);
  });
}

function isWritableDirectSession(session) {
  if (!session || session.parentId || session.readOnly === true) return false;
  const sourcePlugin = session.sourcePlugin;
  const sourcePluginPresent = typeof sourcePlugin === 'string'
    || (sourcePlugin !== null && typeof sourcePlugin === 'object');
  const sourcePluginId = String(session.sourcePluginId || '').trim();
  const provenancePluginId = String(session.provenance?.source?.pluginId || '').trim();
  const controlAuthority = String(session.controlAuthority || '').trim();
  const importMode = String(session.importMode || '').trim();
  const externalSourcePattern = /(?:^|[.:/_-])(?:opencode|omo|aside)(?:$|[.:/_-])/i;
  const sourceMarkers = [session.source, session.clientKind, session.provenance?.source?.id]
    .map(value => String(value || '').trim())
    .filter(Boolean);
  return !sourcePluginPresent
    && !sourcePluginId
    && !provenancePluginId
    && !controlAuthority
    && !importMode
    && !sourceMarkers.some(value => String(value).toLowerCase() === 'whitebox-bridge' || externalSourcePattern.test(value));
}

window.WhiteboxRendererUtils = Object.freeze({
  // Intl.DateTimeFormat construction is far more expensive than format();
  // reuse one instance per locale+options combination across render passes.
  dateTimeFormat(locale, options) {
    refreshDateTimeFormatZone();
    const key = `${dateTimeFormatTimeZone}|${locale}|${JSON.stringify(options || {})}`;
    let formatter = dateTimeFormatCache.get(key);
    if (!formatter) {
      if (dateTimeFormatCache.size > 64) dateTimeFormatCache.clear();
      formatter = new Intl.DateTimeFormat(locale, options);
      dateTimeFormatCache.set(key, formatter);
    }
    return formatter;
  },
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
  isWritableDirectSession,
  canForkCodexDesktopSession(session) {
    const sourcePlugin = session?.sourcePlugin;
    const sourcePluginId = String(session?.sourcePluginId
      || (typeof sourcePlugin === 'string' ? sourcePlugin : sourcePlugin?.id || (sourcePlugin ? '__present__' : ''))).trim();
    const controlAuthority = String(session?.controlAuthority || '').trim();
    const importMode = String(session?.importMode || '').trim();
    if (String(session?.provider || '').toLowerCase() !== 'codex'
      || String(session?.clientKind || '').toLowerCase() !== 'codex-desktop'
      || String(session?.status || '').toLowerCase() !== 'completed'
      || session?.parentId
      || sourcePluginId
      || session?.readOnly === true
      || controlAuthority
      || importMode
      || !isWritableDirectSession(session)) return false;
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
