'use strict';

(() => {
  const api = window.trayPopover;
  const root = document.documentElement;
  const card = document.getElementById('card');
  const byId = id => document.getElementById(id);
  const confirmCard = byId('confirm');
  const quitButton = byId('quit');

  const PROVIDER_BADGE = { claude: 'C', codex: 'X' };

  function setText(id, value) {
    const node = byId(id);
    if (node) node.textContent = value == null ? '' : String(value);
  }

  function relativeTime(value, locale) {
    const time = Date.parse(value || '');
    if (!Number.isFinite(time)) return '';
    const seconds = Math.round((time - Date.now()) / 1000);
    const abs = Math.abs(seconds);
    try {
      const format = new Intl.RelativeTimeFormat(locale || 'ko', { numeric: 'auto' });
      if (abs < 45) return format.format(0, 'second');
      if (abs < 3600) return format.format(Math.round(seconds / 60), 'minute');
      if (abs < 86400) return format.format(Math.round(seconds / 3600), 'hour');
      return format.format(Math.round(seconds / 86400), 'day');
    } catch {
      return '';
    }
  }

  function rowFor(item, copy, locale) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'row';
    const provider = String(item.provider || '').toLowerCase();
    const badge = document.createElement('span');
    badge.className = `prov ${PROVIDER_BADGE[provider] ? provider : ''}`.trim();
    badge.textContent = PROVIDER_BADGE[provider] || '>_';
    badge.setAttribute('aria-hidden', 'true');

    const text = document.createElement('span');
    text.className = 'row-text';
    const title = document.createElement('span');
    title.className = 'row-title';
    title.textContent = item.title || '';
    const meta = document.createElement('span');
    meta.className = 'row-meta';
    meta.textContent = [item.meta, relativeTime(item.updatedAt, locale)].filter(Boolean).join(' · ');
    text.append(title, meta);

    const tag = document.createElement('span');
    tag.className = item.kind === 'run' ? 'tag run' : 'tag';
    tag.textContent = item.kind === 'run' ? copy.tagRun : copy.tagTerminal;

    row.append(badge, text, tag);
    row.addEventListener('click', () => { void api.openMain(); });
    return row;
  }

  function render(next) {
    if (!next || typeof next !== 'object') return;
    const copy = next.copy || {};
    root.lang = next.locale || 'ko';
    root.dataset.theme = next.theme === 'light' ? 'light' : 'dark';

    setText('summary', copy.summary);
    setText('terminalsLabel', copy.terminalsLabel);
    setText('terminalsCount', next.terminals || 0);
    setText('terminalsUnit', copy.unit);
    setText('terminalsNote', copy.terminalsNote);
    setText('runsLabel', copy.runsLabel);
    setText('runsCount', next.runs || 0);
    setText('runsUnit', copy.unit);
    setText('runsNote', copy.runsNote);
    setText('openMain', copy.open);
    setText('quitLabel', copy.quit);
    setText('quitHint', copy.quitHint);
    setText('confirmTitle', copy.confirmTitle);
    setText('confirmKeep', copy.confirmKeep);
    setText('confirmStop', copy.confirmStop);
    byId('confirmStopRow').hidden = !(next.runs > 0);
    setText('cancelQuit', copy.cancel);
    setText('confirmQuit', copy.confirmQuit);

    const items = Array.isArray(next.items) ? next.items : [];
    const list = byId('list');
    list.replaceChildren(...items.map(item => rowFor(item, copy, next.locale)));
    if (next.more > 0) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'more';
      more.textContent = copy.more || '';
      more.addEventListener('click', () => { void api.openMain(); });
      list.append(more);
    }
    setText('recentLabel', copy.recent);
    setText('recentCount', copy.recentCount);
    byId('recent').hidden = items.length === 0;

    reportHeight();
    requestAnimationFrame(() => card.classList.add('shown'));
  }

  // The main process sizes the window from this and waits for it before
  // revealing a freshly opened popover.
  function reportHeight() {
    const height = Math.ceil(card.getBoundingClientRect().height);
    if (height) void api.resize(height);
  }

  function setConfirm(open) {
    confirmCard.hidden = !open;
    quitButton.classList.toggle('active', open);
    quitButton.setAttribute('aria-expanded', String(open));
    reportHeight();
  }

  byId('openMain').addEventListener('click', () => { void api.openMain(); });
  quitButton.addEventListener('click', () => setConfirm(confirmCard.hidden));
  byId('cancelQuit').addEventListener('click', () => setConfirm(false));
  byId('confirmQuit').addEventListener('click', () => { void api.quit(); });

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    if (!confirmCard.hidden) setConfirm(false);
    else void api.dismiss();
  });

  api.onState(render);
  api.onHidden(() => {
    card.classList.remove('shown');
    confirmCard.hidden = true;
    quitButton.classList.remove('active');
  });

  api.ready().then(render).catch(() => {});
})();
