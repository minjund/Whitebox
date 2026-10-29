'use strict';

(() => {
  const STORAGE_KEY = 'whitebox:locale:v1';
  const DEFAULT_LOCALE = 'en';
  const SUPPORTED_LOCALES = Object.freeze(['ko', 'en', 'zh-CN']);
  const SUPPORTED = new Set(SUPPORTED_LOCALES);
  const LOCALE_TAGS = Object.freeze({ ko: 'ko-KR', en: 'en-US', 'zh-CN': 'zh-CN' });
  const TRANSLATED_ATTRIBUTES = Object.freeze(['aria-label', 'placeholder', 'title']);

  const messages = window.WhiteboxMessages || {};
  let locale = readLocale();

  function readLocale() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return SUPPORTED.has(saved) ? saved : DEFAULT_LOCALE;
    } catch (error) {
      window.WhiteboxRendererUtils?.reportRecoverableError('locale-storage-read', error);
      return DEFAULT_LOCALE;
    }
  }

  function interpolate(template, params = {}) {
    return String(template).replace(/\{([a-zA-Z][\w]*)\}/g, (match, name) => (
      Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
    ));
  }

  /** Resolve a stable message key for the active locale. */
  function t(key, params) {
    const message = messages[key];
    if (!message) return String(key ?? '');
    return interpolate(message[locale] ?? message.ko ?? key, params);
  }

  /** Forms can include the failure reason alongside their translated summary. */
  function errorText(error, fallbackKey, params, { includeDetails = false } = {}) {
    const message = String(error?.message || (typeof error === 'string' ? error : '')).trim();
    if (includeDetails && message) {
      const summary = t(fallbackKey, params);
      const detail = message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/u, '').trim();
      return !detail || detail === summary ? summary : `${summary} ${detail}`;
    }
    if (locale === 'ko') return t(fallbackKey, params);
    if (message && !/[가-힣]/.test(message)) return message;
    return t(fallbackKey, params);
  }



  function readParams(element) {
    const serialized = element.dataset.i18nParams;
    if (!serialized) return undefined;
    try {
      return JSON.parse(serialized);
    } catch (_nonJsonTranslationValue) {
      // Plain strings are the common case; only serialized objects need parsing.
      return undefined;
    }
  }

  function translateElement(element) {
    if (!(element instanceof Element)) return;
    const params = readParams(element);
    const textKey = element.dataset.i18n;
    if (textKey) element.textContent = t(textKey, params);
    for (const attribute of TRANSLATED_ATTRIBUTES) {
      const key = element.getAttribute(`data-i18n-${attribute}`);
      if (key) element.setAttribute(attribute, t(key, params));
    }
  }

  /** Translate only elements that opt in with explicit data-i18n keys. */
  function translateTree(root = document.documentElement) {
    if (!(root instanceof Element) && !(root instanceof Document)) return;
    if (root instanceof Element && root.matches('[data-i18n], [data-i18n-aria-label], [data-i18n-placeholder], [data-i18n-title]')) {
      translateElement(root);
    }
    root.querySelectorAll?.('[data-i18n], [data-i18n-aria-label], [data-i18n-placeholder], [data-i18n-title]')
      .forEach(translateElement);
  }

  function syncDocument() {
    document.documentElement.lang = locale === 'zh-CN' ? 'zh-CN' : locale;
    document.documentElement.dataset.locale = locale;
    const select = document.querySelector('#languageSelect');
    if (select) select.value = locale;
  }

  function setLocale(nextLocale) {
    if (!SUPPORTED.has(nextLocale)) return false;
    const changed = nextLocale !== locale;
    locale = nextLocale;
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch (error) {
      window.WhiteboxRendererUtils?.reportRecoverableError?.('locale-save', error);
    }
    syncDocument();
    translateTree();
    if (changed) {
      window.dispatchEvent(new CustomEvent('whitebox:locale-changed', {
        detail: { locale, localeTag: LOCALE_TAGS[locale] },
      }));
    }
    return changed;
  }

  const explicitNodeObserver = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') translateElement(record.target);
      else record.addedNodes.forEach(node => {
        if (node instanceof Element) translateTree(node);
      });
    }
  });

  window.WhiteboxI18n = Object.freeze({
    getLocale: () => locale,
    getLocaleTag: () => LOCALE_TAGS[locale],
    getSupportedLocales: () => [...SUPPORTED_LOCALES],
    setLocale,
    t,
    errorText,
    translateTree,
  });

  syncDocument();
  translateTree();
  explicitNodeObserver.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['data-i18n', 'data-i18n-params', 'data-i18n-aria-label', 'data-i18n-placeholder', 'data-i18n-title'],
  });
})();
